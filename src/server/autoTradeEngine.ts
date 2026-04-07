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

// ─── Shadow Trades REST용 공개 조회 ────────────────────────────────────────────

export function getShadowTrades() { return loadShadowTrades(); }
export function getWatchlist()    { return loadWatchlist(); }
