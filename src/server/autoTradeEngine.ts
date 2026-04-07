/**
 * autoTradeEngine.ts — 서버사이드 24시간 자동매매 엔진
 *
 * Railway에서 브라우저 없이 실행됩니다.
 * - process.env 사용 (import.meta.env 없음)
 * - KIS REST API 직접 호출 (프록시 경유 없음)
 * - 파일시스템 기반 상태 저장 (watchlist.json, shadow-trades.json)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import nodemailer from 'nodemailer';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR  = path.resolve(process.cwd(), 'data');
const WATCHLIST_FILE    = path.join(DATA_DIR, 'watchlist.json');
const SHADOW_FILE       = path.join(DATA_DIR, 'shadow-trades.json');
const SHADOW_LOG_FILE   = path.join(DATA_DIR, 'shadow-log.json');

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

// ─── 워치리스트 파일 I/O ────────────────────────────────────────────────────────

export interface WatchlistEntry {
  code: string;          // 종목코드 6자리
  name: string;
  entryPrice: number;    // 관심 진입가
  stopLoss: number;      // 절대가 손절선
  targetPrice: number;   // 목표가
  addedAt: string;       // ISO
}

export function loadWatchlist(): WatchlistEntry[] {
  ensureDataDir();
  if (!fs.existsSync(WATCHLIST_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(WATCHLIST_FILE, 'utf-8'));
  } catch {
    return [];
  }
}

export function saveWatchlist(list: WatchlistEntry[]): void {
  ensureDataDir();
  fs.writeFileSync(WATCHLIST_FILE, JSON.stringify(list, null, 2));
}

// ─── Shadow Trade 파일 I/O ──────────────────────────────────────────────────────

interface ServerShadowTrade {
  id: string;
  stockCode: string;
  stockName: string;
  signalTime: string;
  signalPrice: number;
  shadowEntryPrice: number;
  quantity: number;
  stopLoss: number;
  targetPrice: number;
  status: 'PENDING' | 'ACTIVE' | 'HIT_TARGET' | 'HIT_STOP';
  exitPrice?: number;
  exitTime?: string;
  returnPct?: number;
}

export function loadShadowTrades(): ServerShadowTrade[] {
  ensureDataDir();
  if (!fs.existsSync(SHADOW_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(SHADOW_FILE, 'utf-8'));
  } catch {
    return [];
  }
}

function saveShadowTrades(trades: ServerShadowTrade[]): void {
  ensureDataDir();
  fs.writeFileSync(SHADOW_FILE, JSON.stringify(trades, null, 2));
}

function appendShadowLog(entry: Record<string, unknown>): void {
  ensureDataDir();
  const logs: unknown[] = fs.existsSync(SHADOW_LOG_FILE)
    ? JSON.parse(fs.readFileSync(SHADOW_LOG_FILE, 'utf-8'))
    : [];
  logs.push({ ...entry, ts: new Date().toISOString() });
  // 최근 500건만 보관
  fs.writeFileSync(SHADOW_LOG_FILE, JSON.stringify(logs.slice(-500), null, 2));
}

// ─── KIS API 헬퍼 (서버사이드 전용) ────────────────────────────────────────────

const KIS_IS_REAL = process.env.KIS_IS_REAL === 'true';
const KIS_BASE    = KIS_IS_REAL
  ? 'https://openapi.koreainvestment.com:9443'
  : 'https://openapivts.koreainvestment.com:29443';
const BUY_TR_ID   = KIS_IS_REAL ? 'TTTC0802U' : 'VTTC0802U';
const CCLD_TR_ID  = KIS_IS_REAL ? 'TTTC8001R' : 'VTTC8001R';

let cachedToken: { token: string; expiry: number } | null = null;

export async function refreshKisToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiry) return cachedToken.token;
  const res = await fetch(`${KIS_BASE}/oauth2/tokenP`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'client_credentials',
      appkey: process.env.KIS_APP_KEY,
      appsecret: process.env.KIS_APP_SECRET,
    }),
  });
  const data = await res.json() as { access_token?: string };
  if (!data.access_token) throw new Error(`KIS 토큰 갱신 실패: ${JSON.stringify(data)}`);
  cachedToken = { token: data.access_token, expiry: Date.now() + 23 * 60 * 60 * 1000 };
  console.log('[AutoTrade] KIS 토큰 갱신 완료');
  return cachedToken.token;
}

async function kisGet(trId: string, apiPath: string, params: Record<string, string>) {
  const token = await refreshKisToken();
  const url = `${KIS_BASE}${apiPath}?${new URLSearchParams(params)}`;
  const res = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      appkey: process.env.KIS_APP_KEY!,
      appsecret: process.env.KIS_APP_SECRET!,
      tr_id: trId,
      custtype: 'P',
    },
  });
  const text = await res.text();
  if (!text.trim()) return null;
  try { return JSON.parse(text); } catch { return null; }
}

async function kisPost(trId: string, apiPath: string, body: Record<string, string>) {
  const token = await refreshKisToken();
  const res = await fetch(`${KIS_BASE}${apiPath}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      appkey: process.env.KIS_APP_KEY!,
      appsecret: process.env.KIS_APP_SECRET!,
      tr_id: trId,
      custtype: 'P',
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!text.trim()) return null;
  try { return JSON.parse(text); } catch { return null; }
}

// ─── 현재가 조회 ────────────────────────────────────────────────────────────────

async function fetchCurrentPrice(code: string): Promise<number | null> {
  const data = await kisGet('FHKST01010100', '/uapi/domestic-stock/v1/quotations/inquire-price', {
    FID_COND_MRKT_DIV_CODE: 'J',
    FID_INPUT_ISCD: code,
  });
  const price = parseInt(data?.output?.stck_prpr ?? '0', 10);
  return price > 0 ? price : null;
}

// ─── 아이디어 1: 신호 스캔 ──────────────────────────────────────────────────────

/**
 * 장중 5분 간격 자동 신호 스캔
 * - 관심 종목 현재가 조회
 * - 진입 조건 판정: 현재가 ≥ entryPrice AND 손절선 이상
 * - 조건 충족 시 Shadow 또는 실 주문 실행
 */
export async function runAutoSignalScan(): Promise<void> {
  if (!process.env.KIS_APP_KEY) {
    console.warn('[AutoTrade] KIS_APP_KEY 미설정 — 스캔 건너뜀');
    return;
  }

  const watchlist = loadWatchlist();
  if (watchlist.length === 0) return;

  const shadowMode = process.env.AUTO_TRADE_MODE !== 'LIVE'; // 기본 Shadow 모드
  const totalAssets = Number(process.env.AUTO_TRADE_ASSETS ?? 100_000_000);

  console.log(`[AutoTrade] 스캔 시작 — ${watchlist.length}개 종목 / 모드: ${shadowMode ? 'SHADOW' : 'LIVE'}`);

  const shadows = loadShadowTrades();

  for (const stock of watchlist) {
    try {
      const currentPrice = await fetchCurrentPrice(stock.code);
      if (!currentPrice) continue;

      // 진입 조건: 현재가가 entryPrice ± 1% 이내로 도달
      const nearEntry = Math.abs(currentPrice - stock.entryPrice) / stock.entryPrice <= 0.01;
      // 손절 상향: 아직 손절선 위에 있어야 함
      const aboveStop = currentPrice > stock.stopLoss;
      // 상승 모멘텀: 현재가가 entry 이상
      const breakout = currentPrice >= stock.entryPrice;

      if (!(nearEntry || breakout) || !aboveStop) continue;

      // 이미 동일 종목 ACTIVE 신호 있으면 중복 방지
      const alreadyActive = shadows.some(
        (s) => s.stockCode === stock.code && (s.status === 'PENDING' || s.status === 'ACTIVE')
      );
      if (alreadyActive) continue;

      const slippage = 0.003;
      const shadowEntryPrice = Math.round(currentPrice * (1 + slippage));
      const positionPct = 0.10; // 기본 10% Kelly
      const quantity = Math.floor((totalAssets * positionPct) / shadowEntryPrice);

      if (quantity < 1) continue;

      const trade: ServerShadowTrade = {
        id: `srv_${Date.now()}_${stock.code}`,
        stockCode: stock.code,
        stockName: stock.name,
        signalTime: new Date().toISOString(),
        signalPrice: currentPrice,
        shadowEntryPrice,
        quantity,
        stopLoss: stock.stopLoss,
        targetPrice: stock.targetPrice,
        status: 'PENDING',
      };

      if (shadowMode) {
        shadows.push(trade);
        console.log(`[AutoTrade SHADOW] ${stock.name}(${stock.code}) 신호 등록 @${currentPrice}`);
        appendShadowLog({ event: 'SIGNAL', ...trade });
      } else {
        // LIVE 모드: 실제 주문
        const orderData = await kisPost(BUY_TR_ID, '/uapi/domestic-stock/v1/trading/order-cash', {
          CANO: process.env.KIS_ACCOUNT_NO ?? '',
          ACNT_PRDT_CD: process.env.KIS_ACCOUNT_PROD ?? '01',
          PDNO: stock.code.padStart(6, '0'),
          ORD_DVSN: '01', // 시장가
          ORD_QTY: quantity.toString(),
          ORD_UNPR: '0',
          SLL_BUY_DVSN_CD: '02',
          CTAC_TLNO: '',
          MGCO_APTM_ODNO: '',
          ORD_SVR_DVSN_CD: '0',
        });
        const ordNo = orderData?.output?.ODNO;
        console.log(`[AutoTrade LIVE] ${stock.name} 매수 주문 완료 — ODNO: ${ordNo}`);
        appendShadowLog({ event: 'ORDER', code: stock.code, price: currentPrice, ordNo });
      }
    } catch (err: unknown) {
      console.error(`[AutoTrade] ${stock.code} 스캔 실패:`, err instanceof Error ? err.message : err);
    }
  }

  // Shadow 진행 중 거래 결과 업데이트
  for (const shadow of shadows) {
    if (shadow.status === 'PENDING') {
      shadow.status = 'ACTIVE';
    } else if (shadow.status === 'ACTIVE') {
      const currentPrice = await fetchCurrentPrice(shadow.stockCode).catch(() => null);
      if (!currentPrice) continue;
      if (currentPrice >= shadow.targetPrice) {
        const returnPct = ((shadow.targetPrice - shadow.shadowEntryPrice) / shadow.shadowEntryPrice) * 100;
        Object.assign(shadow, { status: 'HIT_TARGET', exitPrice: shadow.targetPrice, exitTime: new Date().toISOString(), returnPct });
        appendShadowLog({ event: 'HIT_TARGET', ...shadow });
        console.log(`[AutoTrade SHADOW] ✅ ${shadow.stockName} 목표가 달성 +${returnPct.toFixed(2)}%`);
      } else if (currentPrice <= shadow.stopLoss) {
        const returnPct = ((shadow.stopLoss - shadow.shadowEntryPrice) / shadow.shadowEntryPrice) * 100;
        Object.assign(shadow, { status: 'HIT_STOP', exitPrice: shadow.stopLoss, exitTime: new Date().toISOString(), returnPct });
        appendShadowLog({ event: 'HIT_STOP', ...shadow });
        console.log(`[AutoTrade SHADOW] ❌ ${shadow.stockName} 손절 ${returnPct.toFixed(2)}%`);
      }
    }
  }

  saveShadowTrades(shadows);
}

// ─── 아이디어 3: 일일 리포트 이메일 ────────────────────────────────────────────

export async function generateDailyReport(): Promise<void> {
  const email = process.env.EMAIL_USER;
  if (!email || !process.env.EMAIL_PASS) {
    console.warn('[AutoTrade] 이메일 미설정 — 일일 리포트 건너뜀');
    return;
  }

  const shadows = loadShadowTrades();
  const today = new Date().toISOString().split('T')[0];
  const todayTrades = shadows.filter((s) => s.signalTime.startsWith(today));
  const closed = todayTrades.filter((s) => s.status === 'HIT_TARGET' || s.status === 'HIT_STOP');
  const wins = closed.filter((s) => s.status === 'HIT_TARGET');
  const totalReturn = closed.reduce((sum, s) => sum + (s.returnPct ?? 0), 0);

  const body = `
[QuantMaster Pro] ${today} 자동매매 일일 리포트

▶ 당일 신호: ${todayTrades.length}건
▶ 결산 완료: ${closed.length}건 (승 ${wins.length} / 패 ${closed.length - wins.length})
▶ 적중률: ${closed.length > 0 ? Math.round((wins.length / closed.length) * 100) : 0}%
▶ 누적 수익률: ${totalReturn.toFixed(2)}%

${closed.map((s) => `  ${s.status === 'HIT_TARGET' ? '✅' : '❌'} ${s.stockName}(${s.stockCode}) ${(s.returnPct ?? 0).toFixed(2)}%`).join('\n')}

모드: ${process.env.AUTO_TRADE_MODE !== 'LIVE' ? 'SHADOW (가상매매)' : 'LIVE (실매매)'}
  `.trim();

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
  });

  await transporter.sendMail({
    from: process.env.EMAIL_USER,
    to: process.env.REPORT_EMAIL ?? process.env.EMAIL_USER,
    subject: `[QuantMaster] ${today} 자동매매 리포트 — 적중률 ${closed.length > 0 ? Math.round((wins.length / closed.length) * 100) : 0}%`,
    text: body,
  });

  console.log('[AutoTrade] 일일 리포트 이메일 발송 완료 →', process.env.REPORT_EMAIL ?? process.env.EMAIL_USER);
}

// ─── 아이디어 4: 서버사이드 전종목 사전 스크리너 ───────────────────────────────

export interface ScreenedStock {
  code: string;
  name: string;
  currentPrice: number;
  changeRate: number;     // 등락률 (%)
  volume: number;
  turnoverRate: number;   // 회전율 (%)
  per: number;
  foreignNetBuy: number;  // 외국인 순매수량 (당일)
  screenedAt: string;
}

const SCREENER_FILE = path.join(DATA_DIR, 'screener-cache.json');

export function getScreenerCache(): ScreenedStock[] {
  ensureDataDir();
  if (!fs.existsSync(SCREENER_FILE)) return [];
  try { return JSON.parse(fs.readFileSync(SCREENER_FILE, 'utf-8')); } catch { return []; }
}

/**
 * 아이디어 4: 장 전 사전 스크리너
 *
 * 1단계: KIS 거래량 상위 종목 수집 (FHPST01710000)
 * 2단계: 정량 필터 — 가격·회전율·PER·외국인 순매수
 * 3단계: 상위 30개만 캐시 저장 → AI 분석 시 이 풀에서만 선택
 */
export async function preScreenStocks(): Promise<ScreenedStock[]> {
  if (!process.env.KIS_APP_KEY) return [];

  try {
    // 거래량 상위 종목 (최대 30개 반환)
    const volData = await kisGet(
      'FHPST01710000',
      '/uapi/domestic-stock/v1/ranking/volume',
      {
        fid_cond_mrkt_div_code: 'J',
        fid_cond_scr_div_code:  '20171',
        fid_input_iscd:         '0000',   // 전체
        fid_div_cls_code:       '0',
        fid_blng_cls_code:      '0',
        fid_trgt_cls_code:      '111111111',
        fid_trgt_exls_cls_code: '000000',
        fid_input_price_1:      '5000',   // 5,000원 이상
        fid_input_price_2:      '500000', // 50만원 이하
        fid_vol_cnt:            '100000', // 거래량 10만 이상
        fid_input_date_1:       '',
      }
    ) as { output?: Record<string, string>[] } | null;

    const raw = volData?.output ?? [];
    const now = new Date().toISOString();

    const candidates: ScreenedStock[] = raw.map((s) => ({
      code:          s.stck_shrn_iscd ?? '',
      name:          s.hts_kor_isnm   ?? '',
      currentPrice:  parseInt(s.stck_prpr   ?? '0', 10),
      changeRate:    parseFloat(s.prdy_ctrt ?? '0'),
      volume:        parseInt(s.acml_vol    ?? '0', 10),
      turnoverRate:  parseFloat(s.acml_tr_pbmn ?? '0'),
      per:           parseFloat(s.per         ?? '999'),
      foreignNetBuy: parseInt(s.frgn_ntby_qty ?? '0', 10),
      screenedAt:    now,
    })).filter((s) =>
      s.code &&
      s.currentPrice > 0 &&
      s.per > 0 && s.per < 40 &&       // PER 0~40
      s.foreignNetBuy >= 0 &&           // 외국인 순매수 유지
      s.changeRate > -3                 // 급락 제외
    );

    // 거래량 기준 상위 30개
    const top30 = candidates
      .sort((a, b) => b.volume - a.volume)
      .slice(0, 30);

    ensureDataDir();
    fs.writeFileSync(SCREENER_FILE, JSON.stringify(top30, null, 2));
    console.log(`[Screener] 사전 스크리닝 완료 — ${raw.length}개 → 필터 후 ${candidates.length}개 → 상위 ${top30.length}개`);
    return top30;
  } catch (e: unknown) {
    console.error('[Screener] 실패:', e instanceof Error ? e.message : e);
    return [];
  }
}

// ─── 아이디어 6: DART 공시 폴링 + 이메일 알림 ─────────────────────────────────

const DART_ALERTS_FILE = path.join(DATA_DIR, 'dart-alerts.json');

export interface DartAlert {
  corp_name: string;
  stock_code: string;
  report_nm: string;
  rcept_dt: string;      // 접수일자 YYYYMMDD
  rcept_no: string;
  sentiment: 'MAJOR_POSITIVE' | 'POSITIVE' | 'NEUTRAL' | 'NEGATIVE';
  alertedAt: string;
}

function loadDartAlerts(): DartAlert[] {
  ensureDataDir();
  if (!fs.existsSync(DART_ALERTS_FILE)) return [];
  try { return JSON.parse(fs.readFileSync(DART_ALERTS_FILE, 'utf-8')); } catch { return []; }
}

function saveDartAlerts(alerts: DartAlert[]): void {
  ensureDataDir();
  fs.writeFileSync(DART_ALERTS_FILE, JSON.stringify(alerts.slice(-200), null, 2));
}

export function getDartAlerts(): DartAlert[] { return loadDartAlerts(); }

/** 공시 제목 키워드 기반 감성 분류 */
function classifyDisclosure(reportName: string): DartAlert['sentiment'] {
  const pos = ['수주', '계약', '영업이익', '흑자', '특허', '신약', '승인', '상장', '유상증자 철회'];
  const major = ['대규모 수주', '영업이익 서프라이즈', '임상 성공', '최대 실적'];
  const neg = ['유상증자', '전환사채', '소송', '적자', '손실', '부도', '상장폐지', '횡령'];

  if (major.some((k) => reportName.includes(k))) return 'MAJOR_POSITIVE';
  if (pos.some((k)   => reportName.includes(k))) return 'POSITIVE';
  if (neg.some((k)   => reportName.includes(k))) return 'NEGATIVE';
  return 'NEUTRAL';
}

/**
 * 아이디어 6: DART 공시 폴링
 * - 30분마다 신규 공시 수집
 * - MAJOR_POSITIVE + 워치리스트 종목 → 이메일 알림
 */
export async function pollDartDisclosures(): Promise<void> {
  if (!process.env.DART_API_KEY) {
    console.warn('[DART] DART_API_KEY 미설정 — 건너뜀');
    return;
  }

  const today = new Date().toISOString().split('T')[0].replace(/-/g, '');
  const url = `https://opendart.fss.or.kr/api/list.json` +
    `?crtfc_key=${process.env.DART_API_KEY}&bgn_de=${today}&sort=date&sort_mth=desc&page_no=1&page_count=40`;

  let disclosures: Record<string, string>[] = [];
  try {
    const res = await fetch(url);
    const data = await res.json() as { status: string; list?: Record<string, string>[] };
    if (data.status !== '000' || !data.list) return;
    disclosures = data.list;
  } catch (e: unknown) {
    console.error('[DART] 공시 조회 실패:', e instanceof Error ? e.message : e);
    return;
  }

  const existing = loadDartAlerts();
  const existingNos = new Set(existing.map((a) => a.rcept_no));
  const watchlist = loadWatchlist();
  const watchCodes = new Set(watchlist.map((w) => w.code.padStart(6, '0')));

  const newAlerts: DartAlert[] = [];

  for (const d of disclosures) {
    if (existingNos.has(d.rcept_no)) continue; // 이미 처리됨

    const sentiment = classifyDisclosure(d.report_nm ?? '');
    const alert: DartAlert = {
      corp_name:  d.corp_name  ?? '',
      stock_code: d.stock_code ?? '',
      report_nm:  d.report_nm  ?? '',
      rcept_dt:   d.rcept_dt   ?? today,
      rcept_no:   d.rcept_no   ?? '',
      sentiment,
      alertedAt:  new Date().toISOString(),
    };
    newAlerts.push(alert);

    // 워치리스트 종목 + MAJOR_POSITIVE → 이메일 알림
    if (sentiment === 'MAJOR_POSITIVE' && watchCodes.has(d.stock_code?.padStart(6, '0') ?? '')) {
      await sendDartAlert(alert).catch(console.error);
    }
  }

  if (newAlerts.length > 0) {
    saveDartAlerts([...existing, ...newAlerts]);
    console.log(`[DART] 신규 공시 ${newAlerts.length}건 수집`);
  }
}

async function sendDartAlert(alert: DartAlert): Promise<void> {
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) return;
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
  });
  await transporter.sendMail({
    from: process.env.EMAIL_USER,
    to: process.env.REPORT_EMAIL ?? process.env.EMAIL_USER,
    subject: `📢 [QuantMaster] 공시 알림: ${alert.corp_name} — ${alert.report_nm}`,
    text: `종목코드: ${alert.stock_code}\n공시명: ${alert.report_nm}\n접수일: ${alert.rcept_dt}\n\nDART 바로가기: https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${alert.rcept_no}`,
  });
  console.log(`[DART] 📧 알림 발송: ${alert.corp_name} — ${alert.report_nm}`);
}

// ─── Shadow Trades REST용 공개 조회 ────────────────────────────────────────────

export function getShadowTrades() { return loadShadowTrades(); }
export function getWatchlist()    { return loadWatchlist(); }
