/**
 * autoTradeEngine.ts — 서버사이드 24시간 자동매매 엔진 (주문 집행 메인 채널)
 *
 * ⚠️  역할 분리: 이 모듈이 실주문 집행의 유일한 채널입니다.
 *     클라이언트사이드 autoTrading.ts는 수동 Shadow Trading + 분석 전용이며,
 *     AUTO_TRADE_ENABLED=true일 때 클라이언트 실주문은 자동 차단됩니다.
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
import { evaluateServerGate } from './serverQuantFilter.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Railway Volume 마운트 경로 우선, 미설정 시 기본 data/
const DATA_DIR  = process.env.PERSIST_DATA_DIR
  ? path.resolve(process.env.PERSIST_DATA_DIR)
  : path.resolve(process.cwd(), 'data');
const WATCHLIST_FILE    = path.join(DATA_DIR, 'watchlist.json');
const SHADOW_FILE       = path.join(DATA_DIR, 'shadow-trades.json');
const SHADOW_LOG_FILE   = path.join(DATA_DIR, 'shadow-log.json');

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  // Railway 배포 시 파일시스템 초기화 경고
  if (process.env.RAILWAY_STATIC_URL && !process.env.PERSIST_DATA_DIR) {
    console.warn(
      '[AutoTrade] ⚠️  Railway 감지됨 — PERSIST_DATA_DIR 미설정. ' +
      '배포마다 data/ 가 초기화됩니다. Railway Volume을 /app/data에 마운트한 뒤 ' +
      'PERSIST_DATA_DIR=/app/data 를 환경변수에 추가하세요.'
    );
  }
}

// ─── 워치리스트 파일 I/O ────────────────────────────────────────────────────────

export interface WatchlistEntry {
  code: string;          // 종목코드 6자리
  name: string;
  entryPrice: number;    // 관심 진입가
  stopLoss: number;      // 절대가 손절선
  targetPrice: number;   // 목표가
  addedAt: string;       // ISO
  gateScore?: number;    // 스크리닝 신뢰도 점수 (0~27)
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

// ─── 계좌 잔고 조회 ──────────────────────────────────────────────────────────────

async function fetchAccountBalance(): Promise<number | null> {
  const trId = KIS_IS_REAL ? 'TTTC8434R' : 'VTTC8434R';
  const data = await kisGet(trId, '/uapi/domestic-stock/v1/trading/inquire-balance', {
    CANO: process.env.KIS_ACCOUNT_NO ?? '',
    ACNT_PRDT_CD: process.env.KIS_ACCOUNT_PROD ?? '01',
    AFHR_FLPR_YN: 'N',
    OFL_YN: '',
    INQR_DVSN: '02',
    UNPR_DVSN: '01',
    FUND_STTL_ICLD_YN: 'N',
    FNCG_AMT_AUTO_RDPT_YN: 'N',
    PRCS_DVSN: '01',
    CTX_AREA_FK100: '',
    CTX_AREA_NK100: '',
  });
  const cash = Number(data?.output2?.[0]?.dnca_tot_amt ?? 0);
  return cash > 0 ? cash : null;
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

  // 투자 총자산: KIS 계좌 잔고 → 환경변수 → 기본값 순으로 결정
  let totalAssets = Number(process.env.AUTO_TRADE_ASSETS || 0);
  if (!totalAssets) {
    const balance = await fetchAccountBalance().catch(() => null);
    totalAssets = balance ?? 30_000_000; // 모의계좌 기본 3천만원
    console.log(`[AutoTrade] 계좌 잔고 조회 → ${totalAssets.toLocaleString()}원`);
  }

  console.log(`[AutoTrade] 스캔 시작 — ${watchlist.length}개 종목 / 모드: ${shadowMode ? 'SHADOW' : 'LIVE'} / 총자산: ${totalAssets.toLocaleString()}원`);

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

      // 버그 6 수정: 당일 재진입 방지 — PENDING/ACTIVE 및 당일 이미 거래한 종목 제외
      const today = new Date().toISOString().split('T')[0];
      const alreadyTraded = shadows.some(
        (s) => s.stockCode === stock.code &&
        (s.status === 'PENDING' || s.status === 'ACTIVE' ||
         s.signalTime.startsWith(today))
      );
      if (alreadyTraded) continue;

      const slippage = 0.003;
      const shadowEntryPrice = Math.round(currentPrice * (1 + slippage));
      // 버그 5 수정: Gate 점수 기반 간이 Kelly 포지션 사이징
      const gateScore = stock.gateScore ?? 0;
      const positionPct = gateScore >= 25 ? 0.12
                        : gateScore >= 20 ? 0.08
                        : gateScore >= 15 ? 0.05
                        : 0.03;
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

      // 아이디어 10: 추천 기록 — 신호 발생 즉시 저장 (WIN/LOSS 추후 평가)
      // 버그 4 수정: gateScore·signalType을 워치리스트 entry에서 가져와 자기학습 통계 정상화
      addRecommendation({
        stockCode:        stock.code,
        stockName:        stock.name,
        signalTime:       new Date().toISOString(),
        priceAtRecommend: currentPrice,
        stopLoss:         stock.stopLoss,
        targetPrice:      stock.targetPrice,
        kellyPct:         Math.round(positionPct * 100),
        gateScore:        gateScore,
        signalType:       gateScore >= 25 ? 'STRONG_BUY' : 'BUY',
      });

      if (shadowMode) {
        shadows.push(trade);
        console.log(`[AutoTrade SHADOW] ${stock.name}(${stock.code}) 신호 등록 @${currentPrice}`);
        appendShadowLog({ event: 'SIGNAL', ...trade });

        // 아이디어 12: Telegram 알림
        await sendTelegramAlert(
          `⚡ <b>[Shadow] 매수 신호</b>\n` +
          `종목: ${stock.name} (${stock.code})\n` +
          `현재가: ${currentPrice.toLocaleString()}원\n` +
          `손절: ${stock.stopLoss.toLocaleString()}원 | 목표: ${stock.targetPrice.toLocaleString()}원\n` +
          `모드: Shadow (가상매매)`
        ).catch(console.error);
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

        // LIVE 주문도 shadows에 등록 → 다음 스캔 시 alreadyActive로 중복 주문 방지
        trade.status = 'ACTIVE';
        shadows.push(trade);

        // 아이디어 12: Telegram 알림 (실매매)
        await sendTelegramAlert(
          `🚀 <b>[LIVE] 매수 주문 체결</b>\n` +
          `종목: ${stock.name} (${stock.code})\n` +
          `체결가: ${currentPrice.toLocaleString()}원\n` +
          `주문번호: ${ordNo ?? 'N/A'}\n` +
          `손절: ${stock.stopLoss.toLocaleString()}원 | 목표: ${stock.targetPrice.toLocaleString()}원`
        ).catch(console.error);
      }
    } catch (err: unknown) {
      console.error(`[AutoTrade] ${stock.code} 스캔 실패:`, err instanceof Error ? err.message : err);
    }
  }

  // Shadow 진행 중 거래 결과 업데이트
  for (const shadow of shadows) {
    if (shadow.status === 'PENDING') {
      // 신규 등록(4분 이내)은 건너뜀 — 다음 스캔에서 ACTIVE 전환
      const ageMs = Date.now() - new Date(shadow.signalTime).getTime();
      if (ageMs < 4 * 60 * 1000) continue;
      shadow.status = 'ACTIVE';
    } else if (shadow.status === 'ACTIVE') {
      const currentPrice = await fetchCurrentPrice(shadow.stockCode).catch(() => null);
      if (!currentPrice) continue;
      if (currentPrice >= shadow.targetPrice) {
        // 목표가 돌파: 현재가로 체결 (목표가보다 높을 수 있음 — 유리한 슬리피지)
        const actualExit = currentPrice;
        const returnPct = ((actualExit - shadow.shadowEntryPrice) / shadow.shadowEntryPrice) * 100;
        Object.assign(shadow, { status: 'HIT_TARGET', exitPrice: actualExit, exitTime: new Date().toISOString(), returnPct });
        appendShadowLog({ event: 'HIT_TARGET', ...shadow });
        console.log(`[AutoTrade SHADOW] ✅ ${shadow.stockName} 목표가 달성 +${returnPct.toFixed(2)}% (체결 ${actualExit.toLocaleString()})`);
      } else if (currentPrice <= shadow.stopLoss) {
        // 손절: 현재가로 체결 (갭다운 시 손절가보다 낮을 수 있음 — 불리한 슬리피지)
        const actualExit = currentPrice;
        const returnPct = ((actualExit - shadow.shadowEntryPrice) / shadow.shadowEntryPrice) * 100;
        Object.assign(shadow, { status: 'HIT_STOP', exitPrice: actualExit, exitTime: new Date().toISOString(), returnPct });
        appendShadowLog({ event: 'HIT_STOP', ...shadow });
        console.log(`[AutoTrade SHADOW] ❌ ${shadow.stockName} 손절 ${returnPct.toFixed(2)}% (체결 ${actualExit.toLocaleString()})`);
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

  // FHPST01710000 (거래량 순위)은 실계좌 전용 TR — VTS에서 미지원
  if (!KIS_IS_REAL) {
    console.warn(
      '[Screener] 모의투자(VTS) 모드 — 거래량 순위 TR(FHPST01710000) 미지원. ' +
      '캐시된 스크리너 결과를 반환합니다. 실계좌 전환(KIS_IS_REAL=true) 후 사용 가능.'
    );
    return getScreenerCache();
  }

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

// ─── 자동 워치리스트 채우기 (Yahoo Finance 기반 — VTS 호환) ─────────────────────

// 버그 7 수정: KOSPI/KOSDAQ 주요 종목 풀 확장 (30 → 120개) — 스크리닝 다양성 확보
const STOCK_UNIVERSE: { symbol: string; code: string; name: string }[] = [
  // ── KOSPI 대형주 (시총 상위) ──
  { symbol: '005930.KS', code: '005930', name: '삼성전자' },
  { symbol: '000660.KS', code: '000660', name: 'SK하이닉스' },
  { symbol: '373220.KS', code: '373220', name: 'LG에너지솔루션' },
  { symbol: '207940.KS', code: '207940', name: '삼성바이오로직스' },
  { symbol: '005380.KS', code: '005380', name: '현대차' },
  { symbol: '000270.KS', code: '000270', name: '기아' },
  { symbol: '068270.KS', code: '068270', name: '셀트리온' },
  { symbol: '035420.KS', code: '035420', name: 'NAVER' },
  { symbol: '006400.KS', code: '006400', name: '삼성SDI' },
  { symbol: '051910.KS', code: '051910', name: 'LG화학' },
  { symbol: '035720.KS', code: '035720', name: '카카오' },
  { symbol: '105560.KS', code: '105560', name: 'KB금융' },
  { symbol: '055550.KS', code: '055550', name: '신한지주' },
  { symbol: '012330.KS', code: '012330', name: '현대모비스' },
  { symbol: '066570.KS', code: '066570', name: 'LG전자' },
  { symbol: '086790.KS', code: '086790', name: '하나금융지주' },
  { symbol: '003550.KS', code: '003550', name: 'LG' },
  { symbol: '034730.KS', code: '034730', name: 'SK' },
  { symbol: '028260.KS', code: '028260', name: '삼성물산' },
  { symbol: '032830.KS', code: '032830', name: '삼성생명' },
  { symbol: '009150.KS', code: '009150', name: '삼성전기' },
  { symbol: '000810.KS', code: '000810', name: '삼성화재' },
  { symbol: '017670.KS', code: '017670', name: 'SK텔레콤' },
  { symbol: '010130.KS', code: '010130', name: '고려아연' },
  { symbol: '047050.KS', code: '047050', name: '포스코인터내셔널' },
  { symbol: '003670.KS', code: '003670', name: '포스코퓨처엠' },
  // ── KOSPI 중형주 ──
  { symbol: '096770.KS', code: '096770', name: 'SK이노베이션' },
  { symbol: '015760.KS', code: '015760', name: '한국전력' },
  { symbol: '034020.KS', code: '034020', name: '두산에너빌리티' },
  { symbol: '011200.KS', code: '011200', name: 'HMM' },
  { symbol: '036570.KS', code: '036570', name: '엔씨소프트' },
  { symbol: '009540.KS', code: '009540', name: '한국조선해양' },
  { symbol: '010950.KS', code: '010950', name: 'S-Oil' },
  { symbol: '018260.KS', code: '018260', name: '삼성에스디에스' },
  { symbol: '011170.KS', code: '011170', name: '롯데케미칼' },
  { symbol: '030200.KS', code: '030200', name: 'KT' },
  { symbol: '033780.KS', code: '033780', name: 'KT&G' },
  { symbol: '000720.KS', code: '000720', name: '현대건설' },
  { symbol: '011070.KS', code: '011070', name: 'LG이노텍' },
  { symbol: '010620.KS', code: '010620', name: '현대미포조선' },
  { symbol: '042660.KS', code: '042660', name: '한화오션' },
  { symbol: '267260.KS', code: '267260', name: '현대일렉트릭' },
  { symbol: '352820.KS', code: '352820', name: '하이브' },
  { symbol: '009830.KS', code: '009830', name: '한화솔루션' },
  { symbol: '024110.KS', code: '024110', name: '기업은행' },
  { symbol: '316140.KS', code: '316140', name: '우리금융지주' },
  { symbol: '138930.KS', code: '138930', name: 'BNK금융지주' },
  { symbol: '139480.KS', code: '139480', name: '이마트' },
  { symbol: '004020.KS', code: '004020', name: '현대제철' },
  { symbol: '005490.KS', code: '005490', name: 'POSCO홀딩스' },
  { symbol: '000100.KS', code: '000100', name: '유한양행' },
  { symbol: '326030.KS', code: '326030', name: 'SK바이오팜' },
  { symbol: '161390.KS', code: '161390', name: '한국타이어앤테크놀로지' },
  { symbol: '036460.KS', code: '036460', name: '한국가스공사' },
  { symbol: '006800.KS', code: '006800', name: '미래에셋증권' },
  { symbol: '003490.KS', code: '003490', name: '대한항공' },
  { symbol: '180640.KS', code: '180640', name: '한진칼' },
  { symbol: '002790.KS', code: '002790', name: '아모레G' },
  { symbol: '090430.KS', code: '090430', name: '아모레퍼시픽' },
  { symbol: '251270.KS', code: '251270', name: '넷마블' },
  { symbol: '323410.KS', code: '323410', name: '카카오뱅크' },
  { symbol: '377300.KS', code: '377300', name: '카카오페이' },
  { symbol: '035250.KS', code: '035250', name: '강원랜드' },
  { symbol: '271560.KS', code: '271560', name: '오리온' },
  { symbol: '004170.KS', code: '004170', name: '신세계' },
  { symbol: '021240.KS', code: '021240', name: '코웨이' },
  { symbol: '006260.KS', code: '006260', name: 'LS' },
  { symbol: '078930.KS', code: '078930', name: 'GS' },
  { symbol: '069500.KS', code: '069500', name: 'KODEX 200' },
  { symbol: '003410.KS', code: '003410', name: '쌍용C&E' },
  { symbol: '051900.KS', code: '051900', name: 'LG생활건강' },
  { symbol: '259960.KS', code: '259960', name: '크래프톤' },
  { symbol: '402340.KS', code: '402340', name: 'SK스퀘어' },
  // ── KOSDAQ 주요 종목 ──
  { symbol: '247540.KS', code: '247540', name: '에코프로비엠' },
  { symbol: '086520.KS', code: '086520', name: '에코프로' },
  { symbol: '042700.KS', code: '042700', name: '한미반도체' },
  { symbol: '196170.KS', code: '196170', name: '알테오젠' },
  { symbol: '403870.KQ', code: '403870', name: 'HPSP' },
  { symbol: '328130.KQ', code: '328130', name: '루닛' },
  { symbol: '145020.KQ', code: '145020', name: '휴젤' },
  { symbol: '293490.KQ', code: '293490', name: '카카오게임즈' },
  { symbol: '263750.KQ', code: '263750', name: '펄어비스' },
  { symbol: '112040.KQ', code: '112040', name: '위메이드' },
  { symbol: '357780.KQ', code: '357780', name: '솔브레인' },
  { symbol: '035900.KQ', code: '035900', name: 'JYP Ent.' },
  { symbol: '041510.KQ', code: '041510', name: 'SM' },
  { symbol: '091990.KQ', code: '091990', name: '셀트리온헬스케어' },
  { symbol: '067630.KQ', code: '067630', name: 'HLB생명과학' },
  { symbol: '028300.KQ', code: '028300', name: 'HLB' },
  { symbol: '141080.KQ', code: '141080', name: '레고켐바이오' },
  { symbol: '039030.KQ', code: '039030', name: '이오테크닉스' },
  { symbol: '095340.KQ', code: '095340', name: 'ISC' },
  { symbol: '336260.KQ', code: '336260', name: '두산테스나' },
  { symbol: '240810.KQ', code: '240810', name: '원익IPS' },
  { symbol: '058470.KQ', code: '058470', name: '리노공업' },
  { symbol: '078600.KQ', code: '078600', name: '대주전자재료' },
  { symbol: '006580.KQ', code: '006580', name: '대양전기공업' },
  { symbol: '214150.KQ', code: '214150', name: '클래시스' },
  { symbol: '298380.KQ', code: '298380', name: '에이비엘바이오' },
  { symbol: '383310.KQ', code: '383310', name: '에코프로에이치엔' },
  { symbol: '222160.KQ', code: '222160', name: 'NPX반도체' },
  { symbol: '060310.KQ', code: '060310', name: '3S' },
  { symbol: '253450.KQ', code: '253450', name: '스튜디오드래곤' },
  { symbol: '036930.KQ', code: '036930', name: '주성엔지니어링' },
  { symbol: '067160.KQ', code: '067160', name: '아프리카TV' },
  { symbol: '298020.KQ', code: '298020', name: '효성티앤씨' },
  { symbol: '950160.KQ', code: '950160', name: '코오롱티슈진' },
  { symbol: '108860.KQ', code: '108860', name: '셀바스AI' },
  { symbol: '257720.KQ', code: '257720', name: '실리콘투' },
  { symbol: '039200.KQ', code: '039200', name: '오스코텍' },
  { symbol: '122870.KQ', code: '122870', name: '와이지엔터테인먼트' },
  { symbol: '041920.KQ', code: '041920', name: '메디아나' },
  { symbol: '099190.KQ', code: '099190', name: '아이센스' },
];

// 아이디어 5: 확장된 Yahoo 시세 인터페이스 (MA/고가/ATR 포함)
export interface YahooQuoteExtended {
  price: number;
  changePercent: number;
  volume: number;
  avgVolume: number;
  ma5: number;           // 5일 이동평균
  ma20: number;          // 20일 이동평균
  ma60: number;          // 60일 이동평균
  high20d: number;       // 20일 최고가
  atr: number;           // 최근 14일 ATR (Average True Range)
  atr20avg: number;      // 20일 ATR 평균 (VCP 판단용)
  per: number;           // PER (Yahoo 제공 시)
}

async function fetchYahooQuote(symbol: string): Promise<YahooQuoteExtended | null> {
  try {
    // 아이디어 5: range를 60d로 확장하여 MA/ATR 계산에 필요한 데이터 확보
    const url = `https://query2.finance.yahoo.com/v8/finance/chart/${symbol}?range=60d&interval=1d`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    });
    if (!res.ok) return null;
    const data = await res.json();
    const result = data.chart?.result?.[0];
    if (!result) return null;

    const meta = result.meta;
    const rawCloses: (number | null)[] = result.indicators?.quote?.[0]?.close ?? [];
    const rawHighs: (number | null)[]  = result.indicators?.quote?.[0]?.high ?? [];
    const rawLows: (number | null)[]   = result.indicators?.quote?.[0]?.low ?? [];
    const rawVolumes: (number | null)[] = result.indicators?.quote?.[0]?.volume ?? [];

    // null 값 제거한 유효 데이터
    const closes  = rawCloses.filter((v): v is number => v != null && v > 0);
    const highs   = rawHighs.filter((v): v is number => v != null && v > 0);
    const lows    = rawLows.filter((v): v is number => v != null && v > 0);
    const volumes = rawVolumes.filter((v): v is number => v != null && v > 0);

    if (closes.length < 5) return null;

    const price = meta.regularMarketPrice ?? closes[closes.length - 1] ?? 0;
    const prevClose = meta.chartPreviousClose ?? closes[closes.length - 2] ?? price;
    const changePercent = prevClose > 0 ? ((price - prevClose) / prevClose) * 100 : 0;
    const volume = volumes[volumes.length - 1] ?? 0;

    // 5일 평균 거래량 (당일 제외)
    const pastVolumes = volumes.slice(0, -1);
    const avgVolume = pastVolumes.length > 0
      ? pastVolumes.reduce((s, v) => s + v, 0) / pastVolumes.length
      : volume;

    // 이동평균 계산
    const avg = (arr: number[], n: number) => {
      const slice = arr.slice(-n);
      return slice.length >= n ? slice.reduce((a, b) => a + b, 0) / n : 0;
    };
    const ma5  = avg(closes, 5);
    const ma20 = avg(closes, 20);
    const ma60 = avg(closes, 60);

    // 20일 최고가
    const high20d = highs.length >= 20
      ? Math.max(...highs.slice(-20))
      : Math.max(...highs);

    // ATR (Average True Range) 계산 — 14일 기준
    const trueRanges: number[] = [];
    const minLen = Math.min(closes.length, highs.length, lows.length);
    for (let i = 1; i < minLen; i++) {
      const tr = Math.max(
        highs[i] - lows[i],
        Math.abs(highs[i] - closes[i - 1]),
        Math.abs(lows[i] - closes[i - 1]),
      );
      trueRanges.push(tr);
    }
    const atr = trueRanges.length >= 14
      ? trueRanges.slice(-14).reduce((a, b) => a + b, 0) / 14
      : trueRanges.length > 0
        ? trueRanges.reduce((a, b) => a + b, 0) / trueRanges.length
        : 0;
    const atr20avg = trueRanges.length >= 20
      ? trueRanges.slice(-20).reduce((a, b) => a + b, 0) / 20
      : atr;

    // PER — Yahoo meta에서 제공 시 사용
    const per = parseFloat(meta.trailingPE ?? '999');

    return {
      price: Math.round(price), changePercent, volume, avgVolume,
      ma5, ma20, ma60, high20d, atr, atr20avg, per,
    };
  } catch {
    return null;
  }
}

/**
 * Yahoo Finance 기반 자동 워치리스트 채우기
 *
 * - KIS 실계좌: preScreenStocks() 결과를 워치리스트로 승격
 * - VTS/모의계좌: Yahoo Finance로 KOSPI 주요 종목 스캔, 상승 모멘텀 종목 자동 추가
 *
 * 선정 기준: 전일 대비 +2% 이상 상승 + 거래량 50만주 이상
 * 손절: 현재가 -8%, 목표: 현재가 +15%
 */
export async function autoPopulateWatchlist(): Promise<number> {
  const watchlist = loadWatchlist();
  const existingCodes = new Set(watchlist.map(w => w.code));
  let added = 0;

  // 실계좌: preScreenStocks 결과 → 워치리스트 승격
  if (KIS_IS_REAL) {
    const screened = getScreenerCache();
    for (const s of screened) {
      if (existingCodes.has(s.code)) continue;
      if (s.changeRate < 2 || s.foreignNetBuy < 0) continue; // +2% 이상 & 외국인 순매수

      watchlist.push({
        code: s.code,
        name: s.name,
        entryPrice: s.currentPrice,
        stopLoss: Math.round(s.currentPrice * 0.92),
        targetPrice: Math.round(s.currentPrice * 1.15),
        addedAt: new Date().toISOString(),
      });
      existingCodes.add(s.code);
      added++;
      console.log(`[AutoPopulate] 스크리너 → 워치리스트: ${s.name}(${s.code}) @${s.currentPrice.toLocaleString()}`);
    }
  }

  // VTS 및 공통: Yahoo Finance 기반 모멘텀 스캔 + 서버사이드 Gate 평가 (아이디어 2)
  for (const stock of STOCK_UNIVERSE) {
    if (existingCodes.has(stock.code)) continue;

    const quote = await fetchYahooQuote(stock.symbol);
    if (!quote || quote.price <= 0) continue;

    // 필터: +1.5% 이상 상승 + 거래량이 5일 평균의 1.5배 이상 (상대 기준)
    if (quote.changePercent < 1.5 || quote.volume < quote.avgVolume * 1.5) continue;

    // 아이디어 2: 서버사이드 Gate 평가 — SKIP 종목 제외
    const gate = evaluateServerGate(quote);
    if (gate.signalType === 'SKIP') {
      console.log(`[AutoPopulate] SKIP: ${stock.name}(${stock.code}) gateScore=${gate.gateScore}/8`);
      continue;
    }

    watchlist.push({
      code: stock.code,
      name: stock.name,
      entryPrice: quote.price,
      stopLoss: Math.round(quote.price * 0.92),
      targetPrice: Math.round(quote.price * 1.15),
      addedAt: new Date().toISOString(),
      gateScore: gate.gateScore,
    });
    existingCodes.add(stock.code);
    added++;
    console.log(
      `[AutoPopulate] Yahoo → 워치리스트: ${stock.name}(${stock.code}) ` +
      `@${quote.price.toLocaleString()} (+${quote.changePercent.toFixed(1)}% / ${(quote.volume / 10000).toFixed(0)}만주) ` +
      `gate=${gate.gateScore}/8 [${gate.signalType}] ${gate.details.join(', ')}`
    );

    // Yahoo rate limit 방지
    await new Promise(r => setTimeout(r, 300));
  }

  if (added > 0) {
    saveWatchlist(watchlist);
    console.log(`[AutoPopulate] 워치리스트 자동 추가 완료 — ${added}개 신규 (총 ${watchlist.length}개)`);
  } else {
    console.log('[AutoPopulate] 조건 충족 종목 없음 — 워치리스트 변동 없음');
  }

  return added;
}

// ─── 아이디어 6: DART 공시 폴링 + 이메일 알림 ─────────────────────────────────

const DART_ALERTS_FILE        = path.join(DATA_DIR, 'dart-alerts.json');
const RECOMMENDATIONS_FILE    = path.join(DATA_DIR, 'recommendations.json');

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

    // 워치리스트 종목 + MAJOR_POSITIVE → 이메일 + Telegram 알림
    if (sentiment === 'MAJOR_POSITIVE' && watchCodes.has(d.stock_code?.padStart(6, '0') ?? '')) {
      await sendDartAlert(alert).catch(console.error);
    }
    // NEGATIVE 공시도 Telegram으로 즉시 경고
    if ((sentiment === 'NEGATIVE' || sentiment === 'MAJOR_POSITIVE') &&
        watchCodes.has(d.stock_code?.padStart(6, '0') ?? '')) {
      const emoji = sentiment === 'MAJOR_POSITIVE' ? '📢' : '⚠️';
      await sendTelegramAlert(
        `${emoji} <b>[DART 공시] ${alert.corp_name}</b>\n` +
        `${alert.report_nm}\n` +
        `접수일: ${alert.rcept_dt}\n` +
        `감성: ${sentiment}\n` +
        `DART: https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${alert.rcept_no}`
      ).catch(console.error);
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

// ─── 아이디어 12: Telegram Bot 알림 ────────────────────────────────────────────

/**
 * Telegram Bot API를 통해 즉시 모바일 알림 전송
 * Railway 환경변수: TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID
 */
export async function sendTelegramAlert(message: string): Promise<void> {
  const token  = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return; // 미설정 시 조용히 패스

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: message, parse_mode: 'HTML' }),
    });
    if (!res.ok) {
      const err = await res.text();
      console.error('[Telegram] 전송 실패:', err.slice(0, 200));
    }
  } catch (e: unknown) {
    console.error('[Telegram] 오류:', e instanceof Error ? e.message : e);
  }
}

// ─── 아이디어 10: 추천 적중률 자기학습 루프 ─────────────────────────────────────

export interface RecommendationRecord {
  id: string;
  stockCode: string;
  stockName: string;
  signalTime: string;        // ISO — 신호 발생 시각
  priceAtRecommend: number;  // 추천 당시 현재가
  stopLoss: number;          // 절대가 손절선
  targetPrice: number;       // 목표가
  kellyPct: number;          // 포지션 비율 (%)
  gateScore: number;         // Gate 통과 점수 (0~27, 서버스캔 시 0)
  signalType: 'STRONG_BUY' | 'BUY';
  status: 'PENDING' | 'WIN' | 'LOSS' | 'EXPIRED';
  actualReturn?: number;     // 실현 수익률 (%)
  resolvedAt?: string;       // ISO
}

export interface MonthlyStats {
  month: string;         // "2026-04"
  total: number;         // 결산 완료 건수
  wins: number;
  losses: number;
  expired: number;
  winRate: number;       // %
  avgReturn: number;     // %
  strongBuyWinRate: number; // STRONG_BUY만 필터
}

function loadRecommendations(): RecommendationRecord[] {
  ensureDataDir();
  if (!fs.existsSync(RECOMMENDATIONS_FILE)) return [];
  try { return JSON.parse(fs.readFileSync(RECOMMENDATIONS_FILE, 'utf-8')); } catch { return []; }
}

function saveRecommendations(recs: RecommendationRecord[]): void {
  ensureDataDir();
  // 최근 1000건만 보관 (오래된 것부터 제거)
  fs.writeFileSync(RECOMMENDATIONS_FILE, JSON.stringify(recs.slice(-1000), null, 2));
}

export function addRecommendation(rec: Omit<RecommendationRecord, 'id' | 'status'>): void {
  const recs = loadRecommendations();
  // 같은 종목의 PENDING 중복 방지
  const alreadyPending = recs.some(
    (r) => r.stockCode === rec.stockCode && r.status === 'PENDING'
  );
  if (alreadyPending) return;

  recs.push({ ...rec, id: `rec_${Date.now()}_${rec.stockCode}`, status: 'PENDING' });
  saveRecommendations(recs);
  console.log(`[자기학습] 추천 기록 추가: ${rec.stockName}(${rec.stockCode}) @${rec.priceAtRecommend.toLocaleString()}`);
}

export function getRecommendations(): RecommendationRecord[] {
  return loadRecommendations();
}

/**
 * 아이디어 10: 매일 장 마감 후 16:30 실행 — PENDING 추천 결과 평가
 * 손절가/목표가 도달 여부 확인 → WIN/LOSS 기록 → 월간 통계 출력
 */
export async function evaluateRecommendations(): Promise<void> {
  const recs    = loadRecommendations();
  const pending = recs.filter((r) => r.status === 'PENDING');

  if (pending.length === 0) {
    console.log('[자기학습] 평가할 PENDING 추천 없음');
    return;
  }

  console.log(`[자기학습] PENDING 추천 ${pending.length}건 평가 시작`);
  let changed = false;

  for (const rec of pending) {
    try {
      const currentPrice = await fetchCurrentPrice(rec.stockCode);
      if (!currentPrice) continue;

      const returnPct = ((currentPrice - rec.priceAtRecommend) / rec.priceAtRecommend) * 100;
      const ageMs     = Date.now() - new Date(rec.signalTime).getTime();
      const EXPIRE_MS = 30 * 24 * 60 * 60 * 1000; // 30일 (≈20 거래일)

      if (currentPrice <= rec.stopLoss) {
        rec.status       = 'LOSS';
        rec.actualReturn = parseFloat((((rec.stopLoss - rec.priceAtRecommend) / rec.priceAtRecommend) * 100).toFixed(2));
        rec.resolvedAt   = new Date().toISOString();
        changed = true;
        console.log(`[자기학습] ❌ LOSS: ${rec.stockName} ${rec.actualReturn}%`);
      } else if (currentPrice >= rec.targetPrice) {
        rec.status       = 'WIN';
        rec.actualReturn = parseFloat((((rec.targetPrice - rec.priceAtRecommend) / rec.priceAtRecommend) * 100).toFixed(2));
        rec.resolvedAt   = new Date().toISOString();
        changed = true;
        console.log(`[자기학습] ✅ WIN: ${rec.stockName} +${rec.actualReturn}%`);
      } else if (ageMs > EXPIRE_MS) {
        rec.status       = 'EXPIRED';
        rec.actualReturn = parseFloat(returnPct.toFixed(2));
        rec.resolvedAt   = new Date().toISOString();
        changed = true;
        console.log(`[자기학습] ⏱ EXPIRED: ${rec.stockName} ${rec.actualReturn}%`);
      }
    } catch (e: unknown) {
      console.error(`[자기학습] ${rec.stockCode} 평가 실패:`, e instanceof Error ? e.message : e);
    }
  }

  if (changed) saveRecommendations(recs);

  // 월간 통계 계산 + 출력
  const stats = getMonthlyStats();
  console.log(
    `[자기학습] ${stats.month} 통계 — 전체 WIN률: ${stats.winRate.toFixed(1)}% ` +
    `| STRONG_BUY: ${stats.strongBuyWinRate.toFixed(1)}% ` +
    `| 평균 수익: ${stats.avgReturn.toFixed(2)}%`
  );

  // Telegram으로 월간 요약 발송
  await sendTelegramAlert(
    `📊 <b>[QuantMaster] ${stats.month} 자기학습 일일 평가</b>\n` +
    `결산: ${stats.total}건 (승 ${stats.wins} / 패 ${stats.losses} / 만료 ${stats.expired})\n` +
    `WIN률: <b>${stats.winRate.toFixed(1)}%</b> | 평균 수익: ${stats.avgReturn.toFixed(2)}%\n` +
    `STRONG_BUY 적중률: <b>${stats.strongBuyWinRate.toFixed(1)}%</b>`
  ).catch(console.error);
}

export function getMonthlyStats(): MonthlyStats {
  const all      = loadRecommendations();
  const month    = new Date().toISOString().slice(0, 7); // "2026-04"
  const monthly  = all.filter((r) => r.signalTime.startsWith(month) && r.status !== 'PENDING');
  const wins     = monthly.filter((r) => r.status === 'WIN');
  const losses   = monthly.filter((r) => r.status === 'LOSS');
  const expired  = monthly.filter((r) => r.status === 'EXPIRED');
  const total    = monthly.length;
  const avgReturn = total > 0
    ? monthly.reduce((s, r) => s + (r.actualReturn ?? 0), 0) / total
    : 0;

  const sbMonthly = monthly.filter((r) => r.signalType === 'STRONG_BUY');
  const sbWins    = sbMonthly.filter((r) => r.status === 'WIN');

  return {
    month,
    total,
    wins:    wins.length,
    losses:  losses.length,
    expired: expired.length,
    winRate: total > 0 ? (wins.length / total) * 100 : 0,
    avgReturn,
    strongBuyWinRate: sbMonthly.length > 0 ? (sbWins.length / sbMonthly.length) * 100 : 0,
  };
}

// ─── Shadow Trades REST용 공개 조회 ────────────────────────────────────────────

export function getShadowTrades() { return loadShadowTrades(); }
export function getWatchlist()    { return loadWatchlist(); }
