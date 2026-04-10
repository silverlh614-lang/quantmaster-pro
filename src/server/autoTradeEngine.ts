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
import { GoogleGenAI } from '@google/genai';
import { AI_MODELS } from '../constants/aiConfig.js';
import {
  evaluateServerGate,
  DEFAULT_CONDITION_WEIGHTS,
  type ConditionWeights,
} from './serverQuantFilter.js';

// ─── Gemini 서버사이드 헬퍼 ─────────────────────────────────────────────────────

function getGeminiClient(): GoogleGenAI | null {
  const key = process.env.GEMINI_API_KEY ?? process.env.API_KEY;
  if (!key) return null;
  return new GoogleGenAI({ apiKey: key });
}

/**
 * Gemini Flash 간단 호출 (서버사이드 전용, googleSearch 없음 — 비용 절감).
 * API 키 미설정 시 null 반환.
 */
async function callGemini(prompt: string): Promise<string | null> {
  const ai = getGeminiClient();
  if (!ai) {
    console.warn('[Gemini] API 키 미설정 — AI 기능 비활성화');
    return null;
  }
  try {
    const res = await ai.models.generateContent({
      model: AI_MODELS.SERVER_SIDE,
      contents: prompt,
      config: { temperature: 0.4, maxOutputTokens: 1024 },
    });
    return res.text ?? null;
  } catch (e: unknown) {
    console.error('[Gemini] 호출 실패:', e instanceof Error ? e.message : e);
    return null;
  }
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Railway Volume 마운트 경로 우선, 미설정 시 기본 data/
const DATA_DIR  = process.env.PERSIST_DATA_DIR
  ? path.resolve(process.env.PERSIST_DATA_DIR)
  : path.resolve(process.cwd(), 'data');
const WATCHLIST_FILE          = path.join(DATA_DIR, 'watchlist.json');
const SHADOW_FILE             = path.join(DATA_DIR, 'shadow-trades.json');
const SHADOW_LOG_FILE         = path.join(DATA_DIR, 'shadow-log.json');
const MACRO_STATE_FILE        = path.join(DATA_DIR, 'macro-state.json');
const CONDITION_WEIGHTS_FILE  = path.join(DATA_DIR, 'condition-weights.json');
const BLACKLIST_FILE          = path.join(DATA_DIR, 'blacklist.json');

// ─── 블랙리스트 (Cascade -30% 진입 금지 목록) ──────────────────────────────────

interface BlacklistEntry {
  stockCode: string;
  stockName: string;
  bannedAt: string;    // ISO — 편입 시각
  bannedUntil: string; // ISO — 해제 시각 (180일 후)
  reason: string;      // 예: "Cascade -30%"
}

function loadBlacklist(): BlacklistEntry[] {
  ensureDataDir();
  if (!fs.existsSync(BLACKLIST_FILE)) return [];
  try { return JSON.parse(fs.readFileSync(BLACKLIST_FILE, 'utf-8')); } catch { return []; }
}

function saveBlacklist(list: BlacklistEntry[]): void {
  ensureDataDir();
  fs.writeFileSync(BLACKLIST_FILE, JSON.stringify(list, null, 2));
}

function addToBlacklist(stockCode: string, stockName: string, reason = 'Cascade -30%'): void {
  const list = loadBlacklist();
  const now = new Date();
  const until = new Date(now.getTime() + 180 * 24 * 60 * 60 * 1000);
  // 이미 편입된 경우 만료일 연장
  const existing = list.find(e => e.stockCode === stockCode);
  if (existing) {
    existing.bannedUntil = until.toISOString();
    existing.bannedAt    = now.toISOString();
    existing.reason      = reason;
  } else {
    list.push({ stockCode, stockName, bannedAt: now.toISOString(), bannedUntil: until.toISOString(), reason });
  }
  saveBlacklist(list);
  console.log(`[Blacklist] ${stockName}(${stockCode}) 편입 — 해제: ${until.toISOString().split('T')[0]}`);
}

function isBlacklisted(stockCode: string): boolean {
  const list = loadBlacklist();
  const now = Date.now();
  // 만료된 항목 자동 정리
  const active = list.filter(e => new Date(e.bannedUntil).getTime() > now);
  if (active.length !== list.length) saveBlacklist(active);
  return active.some(e => e.stockCode === stockCode);
}

// ─── RRR 필터 (Risk-Reward Ratio) ──────────────────────────────────────────────

const RRR_MIN_THRESHOLD = Number(process.env.RRR_MIN_THRESHOLD || 2.0);

function calcRRR(entryPrice: number, targetPrice: number, stopLoss: number): number {
  const reward = targetPrice - entryPrice;
  const risk   = entryPrice - stopLoss;
  if (risk <= 0) return 0;
  return reward / risk;
}

// ─── 아이디어 6: 조건별 가중치 파일 I/O ────────────────────────────────────────

function loadConditionWeights(): ConditionWeights {
  ensureDataDir();
  if (!fs.existsSync(CONDITION_WEIGHTS_FILE)) return { ...DEFAULT_CONDITION_WEIGHTS };
  try {
    const raw = JSON.parse(fs.readFileSync(CONDITION_WEIGHTS_FILE, 'utf-8')) as Partial<ConditionWeights>;
    // 누락된 키는 기본값 1.0으로 채움
    return { ...DEFAULT_CONDITION_WEIGHTS, ...raw };
  } catch {
    return { ...DEFAULT_CONDITION_WEIGHTS };
  }
}

function saveConditionWeights(w: ConditionWeights): void {
  ensureDataDir();
  fs.writeFileSync(CONDITION_WEIGHTS_FILE, JSON.stringify(w, null, 2));
}

// 아이디어 7: 동시 최대 보유 종목 수 (환경변수로 오버라이드 가능)
const MAX_CONCURRENT_POSITIONS = Number(process.env.MAX_CONCURRENT_POSITIONS || 5);
// 아이디어 4: 동일 섹터 최대 동시 보유 수 (Correlation Guard)
const MAX_SECTOR_CONCENTRATION = Number(process.env.MAX_SECTOR_CONCENTRATION || 2);

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
  // 아이디어 6: 진입 근거 메모 & 메타데이터
  addedBy: 'AUTO' | 'MANUAL';     // 자동 발굴 vs 수동 추가
  memo?: string;                   // 진입 근거 ("외국인 5일 연속 순매수, 52주 신고가 돌파")
  sector?: string;                 // 섹터 정보 (섹터별 성과 분석용)
  rrr?: number;                    // Risk-Reward Ratio (목표가-진입가) / (진입가-손절가)
  conditionKeys?: string[];        // 아이디어 6: 진입 당시 통과한 Gate 조건 키 목록
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

// ─── 아이디어 8: Macro State 파일 I/O ──────────────────────────────────────────

export interface MacroState {
  mhs: number;        // Macro Health Score (0~100)
  regime: string;     // 'GREEN' | 'YELLOW' | 'RED'
  updatedAt: string;  // ISO
  // 아이디어 10: Bear Regime 보조 지표 (optional — 클라이언트에서 전달 시 저장)
  vkospi?: number;                  // 한국 변동성 지수
  foreignFuturesSellDays?: number;  // 외국인 선물 연속 순매도 일수
  iri?: number;                     // IRI 위험 지표 델타 (pt)
  // 아이디어 11: IPS 변곡점 엔진 보조 지표 (optional)
  vix?: number;                     // VIX 공포지수
  mhsTrend?: 'IMPROVING' | 'STABLE' | 'DETERIORATING'; // MHS 추세
  vkospiRising?: boolean;           // VKOSPI 상승 추세
  bearRegimeTriggeredCount?: number; // Bear Regime 발동 조건 수
  bearDefenseMode?: boolean;        // Bear 방어 모드 여부
  oeciCliKorea?: number;            // OECD 경기선행지수 한국
  exportGrowth3mAvg?: number;       // 수출 증가율 3개월 이동평균 (%)
  dxyBullish?: boolean;             // DXY 달러 강세 여부
  kospiBelow120ma?: boolean;        // KOSPI 120일선 하회 여부
  ips?: number;                     // 마지막 IPS 점수 (캐시)
}

export function loadMacroState(): MacroState | null {
  ensureDataDir();
  if (!fs.existsSync(MACRO_STATE_FILE)) return null;
  try { return JSON.parse(fs.readFileSync(MACRO_STATE_FILE, 'utf-8')); } catch { return null; }
}

export function saveMacroState(state: MacroState): void {
  ensureDataDir();
  fs.writeFileSync(MACRO_STATE_FILE, JSON.stringify(state, null, 2));
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
  status: 'PENDING' | 'ACTIVE' | 'HIT_TARGET' | 'HIT_STOP' | 'EUPHORIA_PARTIAL';
  exitPrice?: number;
  exitTime?: string;
  returnPct?: number;
  price7dAgo?: number;       // 과열 탐지 신호 3용 (7일 전 가격)
  originalQuantity?: number; // 최초 진입 수량 — EUPHORIA 부분 매도 후 실보유 추적용
  cascadeStep?: 0 | 1 | 2;  // 0=없음, 1=-7% 경고, 2=-15% 반매도
  addBuyBlocked?: boolean;   // -7% 이후 추가 매수 차단 플래그
  halfSoldAt?: string;       // -15% 반매도 시각 (ISO)
  stopApproachAlerted?: boolean; // 손절가 5% 이내 접근 경고 발송 여부 (중복 방지)
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
const SELL_TR_ID  = KIS_IS_REAL ? 'TTTC0801U' : 'VTTC0801U';
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

// ─── 실제 KIS 매도 주문 ─────────────────────────────────────────────────────────
async function placeKisSellOrder(
  stockCode: string,
  stockName: string,
  quantity: number,
  reason: 'STOP_LOSS' | 'TAKE_PROFIT' | 'EUPHORIA',
): Promise<void> {
  const emoji = reason === 'STOP_LOSS' ? '🔴' : reason === 'TAKE_PROFIT' ? '🟢' : '🌡️';
  const label = reason === 'STOP_LOSS' ? '손절' : reason === 'TAKE_PROFIT' ? '익절' : '과열부분매도';

  // Shadow 모드: 실주문 없이 로그 + Telegram만
  if (!KIS_IS_REAL) {
    console.log(`[AutoTrade SELL Shadow] ${emoji} ${stockName}(${stockCode}) ${label} — ${quantity}주 (Shadow 모드, 실주문 없음)`);
    await sendTelegramAlert(
      `${emoji} <b>[Shadow ${label}] ${stockName} (${stockCode})</b>\n` +
      `수량: ${quantity}주 | Shadow 모드 — 실주문 없음`
    ).catch(console.error);
    return;
  }

  if (!process.env.KIS_APP_KEY) {
    console.warn(`[AutoTrade] KIS 미설정 — ${stockName} 매도 건너뜀`);
    return;
  }

  try {
    console.log(`[AutoTrade SELL] ${emoji} ${stockName}(${stockCode}) ${label} 매도 주문 — ${quantity}주`);

    const orderData = await kisPost(SELL_TR_ID, '/uapi/domestic-stock/v1/trading/order-cash', {
      CANO:            process.env.KIS_ACCOUNT_NO ?? '',
      ACNT_PRDT_CD:    process.env.KIS_ACCOUNT_PROD ?? '01',
      PDNO:            stockCode.padStart(6, '0'),
      ORD_DVSN:        '01',   // 시장가 (즉시 체결 우선)
      ORD_QTY:         quantity.toString(),
      ORD_UNPR:        '0',
      SLL_BUY_DVSN_CD: '01',  // 01 = 매도
      CTAC_TLNO:       '',
      MGCO_APTM_ODNO:  '',
      ORD_SVR_DVSN_CD: '0',
    });

    const ordNo = (orderData as { output?: { ODNO?: string } } | null)?.output?.ODNO;
    console.log(`[AutoTrade SELL] ${emoji} ${stockName} ${label} 완료 — ODNO: ${ordNo}`);

    await sendTelegramAlert(
      `${emoji} <b>[${label}] ${stockName} (${stockCode})</b>\n` +
      `수량: ${quantity}주 | 주문번호: ${ordNo ?? 'N/A'}`
    ).catch(console.error);
  } catch (err: unknown) {
    console.error(`[AutoTrade SELL] ${stockName} 매도 실패:`, err instanceof Error ? err.message : err);
    // 매도 실패는 치명적 → Telegram 긴급 알림
    await sendTelegramAlert(
      `🚨 <b>[긴급] ${stockName} ${label} 매도 실패!</b>\n` +
      `수동으로 즉시 매도하세요!\n` +
      `오류: ${err instanceof Error ? err.message : String(err)}`
    ).catch(console.error);
  }
}

// ─── 아이디어 7: 과열 탐지 (Euphoria Detector) ──────────────────────────────────
interface EuphoriaResult {
  triggered: boolean;
  count: number;
  signals: string[];
}

function checkEuphoria(shadow: ServerShadowTrade, currentPrice: number): EuphoriaResult {
  const signals: string[] = [];

  // 신호 1: 목표가 근접 (현재가 ≥ 목표가의 95%)
  if (shadow.targetPrice > 0 && currentPrice >= shadow.targetPrice * 0.95) {
    signals.push(`목표가 근접 (${((currentPrice / shadow.targetPrice) * 100).toFixed(1)}%)`);
  }

  // 신호 2: 수익률 ≥ 30% (RSI 80 대용)
  const returnPct = ((currentPrice - shadow.shadowEntryPrice) / shadow.shadowEntryPrice) * 100;
  if (returnPct >= 30) {
    signals.push(`수익률 ${returnPct.toFixed(1)}% (≥30%)`);
  }

  // 신호 3: 7일 급등 ≥ 20%
  if (shadow.price7dAgo && shadow.price7dAgo > 0) {
    const spike7d = ((currentPrice - shadow.price7dAgo) / shadow.price7dAgo) * 100;
    if (spike7d >= 20) {
      signals.push(`7일 급등 +${spike7d.toFixed(1)}%`);
    }
  }

  // 신호 4: 30일 보유 + 수익률 ≥ 40%
  const holdDays = (Date.now() - new Date(shadow.signalTime).getTime()) / (1000 * 60 * 60 * 24);
  if (holdDays >= 30 && returnPct >= 40) {
    signals.push(`30일 보유 + 수익률 ${returnPct.toFixed(1)}%`);
  }

  // 신호 5: 목표가 5% 이상 초과
  if (shadow.targetPrice > 0 && currentPrice > shadow.targetPrice * 1.05) {
    signals.push(`목표가 초과 +${(((currentPrice / shadow.targetPrice) - 1) * 100).toFixed(1)}%`);
  }

  return {
    triggered: signals.length >= 2,
    count: signals.length,
    signals,
  };
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

  // ── 아이디어 5: MHS 하드 게이트 (서버사이드 매크로 브레이커) ──
  const macroState = loadMacroState();
  const macroRegime = macroState?.regime ?? (
    macroState ? (macroState.mhs < 30 ? 'RED' : macroState.mhs < 60 ? 'YELLOW' : 'GREEN') : 'GREEN'
  );

  if (macroRegime === 'RED') {
    await sendTelegramAlert(
      `🔴 <b>[매크로 RED] 신규 진입 전면 차단</b>\n` +
      `MHS: ${macroState?.mhs ?? 'N/A'} | 기존 포지션 모니터링만 수행`
    ).catch(console.error);
    console.warn(`[AutoTrade] 매크로 RED (MHS=${macroState?.mhs}) — 신규 진입 전면 차단`);
    await updateShadowResults(shadows);
    saveShadowTrades(shadows);
    return;
  }

  // 아이디어 9: MAPC — 조정 켈리 = 기본 켈리 × (MHS / 100), 최소 30% 유지
  const mapcMhs = macroState?.mhs ?? 100;
  const mapcFactor = Math.max(0.30, mapcMhs / 100);
  if (mapcFactor < 1) {
    console.warn(`[AutoTrade] MAPC 적용 (MHS=${mapcMhs}) — 포지션 ${Math.round(mapcFactor * 100)}% 수준으로 자동 조절`);
  }

  // ── 아이디어 7: 동시 최대 보유 종목 제한 ──
  const activeCount = shadows.filter(
    (s) => s.status === 'PENDING' || s.status === 'ACTIVE'
  ).length;
  if (activeCount >= MAX_CONCURRENT_POSITIONS) {
    console.log(
      `[AutoTrade] 최대 동시 포지션 도달 (${activeCount}/${MAX_CONCURRENT_POSITIONS}) — 신규 진입 스킵`
    );
    await updateShadowResults(shadows);
    saveShadowTrades(shadows);
    return;
  }

  for (const stock of watchlist) {
    // 아이디어 7: 루프 내에서도 포지션 수 재확인 (같은 스캔 중 복수 진입 방지)
    const currentActive = shadows.filter(
      (s) => s.status === 'PENDING' || s.status === 'ACTIVE'
    ).length;
    if (currentActive >= MAX_CONCURRENT_POSITIONS) {
      console.log(`[AutoTrade] 최대 포지션 도달 (${currentActive}/${MAX_CONCURRENT_POSITIONS}) — 나머지 종목 스킵`);
      break;
    }

    try {
      const currentPrice = await fetchCurrentPrice(stock.code).catch(() => null);
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

      // ── 블랙리스트 확인 (Cascade -30% 편입 종목) ──
      if (isBlacklisted(stock.code)) {
        console.log(`[AutoTrade] 🚫 ${stock.name}(${stock.code}) 블랙리스트 — 진입 차단`);
        continue;
      }

      // ── 추가 매수 차단 플래그 확인 (Cascade -7% 이후) ──
      const blockedShadow = shadows.find(
        s => s.stockCode === stock.code && s.addBuyBlocked === true
      );
      if (blockedShadow) {
        console.log(`[AutoTrade] ⚠️  ${stock.name}(${stock.code}) 추가 매수 차단 중 (Cascade -7%)`);
        continue;
      }

      // ── RRR 필터 (Risk-Reward Ratio 최소값 미달 종목 제외) ──
      const rrr = calcRRR(stock.entryPrice, stock.targetPrice, stock.stopLoss);
      if (rrr < RRR_MIN_THRESHOLD) {
        console.log(
          `[AutoTrade] 📐 ${stock.name}(${stock.code}) RRR ${rrr.toFixed(2)} < ${RRR_MIN_THRESHOLD} — 진입 제외`
        );
        continue;
      }

      // ── 아이디어 4: 섹터 집중도 가드 (Correlation Guard) ──
      if (stock.sector) {
        const activeSectorCodes = watchlist
          .filter(w => shadows.some(
            s => s.stockCode === w.code && (s.status === 'PENDING' || s.status === 'ACTIVE')
          ))
          .map(w => w.sector)
          .filter(Boolean);
        const sectorCount = activeSectorCodes.filter(s => s === stock.sector).length;
        if (sectorCount >= MAX_SECTOR_CONCENTRATION) {
          console.log(
            `[CorrelationGuard] ${stock.name}(${stock.sector}) 진입 보류 — ` +
            `동일 섹터 ${sectorCount}/${MAX_SECTOR_CONCENTRATION}개 포화`
          );
          await sendTelegramAlert(
            `🚧 <b>[가드] ${stock.name} 진입 보류</b>\n` +
            `섹터: ${stock.sector}\n` +
            `동일 섹터 보유 ${sectorCount}/${MAX_SECTOR_CONCENTRATION}개 → 분산 한도 초과`
          ).catch(console.error);
          continue;
        }
      }

      const slippage = 0.003;
      const shadowEntryPrice = Math.round(currentPrice * (1 + slippage));
      // 버그 5 수정: Gate 점수 기반 간이 Kelly 포지션 사이징
      const gateScore = stock.gateScore ?? 0;
      const isStrongBuy = gateScore >= 25;

      const rawPositionPct = isStrongBuy       ? 0.12
                           : gateScore >= 20   ? 0.08
                           : gateScore >= 15   ? 0.05
                           : 0.03;
      // 아이디어 9: MAPC — 조정 켈리 = 기본 켈리 × (MHS / 100)
      const positionPct = rawPositionPct * mapcFactor;
      const quantity = Math.floor((totalAssets * positionPct) / shadowEntryPrice);

      if (quantity < 1) continue;

      // 아이디어 8: STRONG_BUY → 분할 매수 1차 진입 (전체 수량의 50%)
      // 잔여 30%·20%는 trancheExecutor가 3일·7일 후 실행
      const execQty = isStrongBuy ? Math.max(1, Math.floor(quantity * 0.5)) : quantity;

      const trade: ServerShadowTrade = {
        id: `srv_${Date.now()}_${stock.code}`,
        stockCode: stock.code,
        stockName: stock.name,
        signalTime: new Date().toISOString(),
        signalPrice: currentPrice,
        shadowEntryPrice,
        quantity: execQty,
        originalQuantity: execQty,  // 최초 진입 수량 보존 — EUPHORIA 부분 매도 후 감사용
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
        signalType:       isStrongBuy ? 'STRONG_BUY' : 'BUY',
        conditionKeys:    stock.conditionKeys ?? [],
      });

      const trancheLabel = isStrongBuy ? ` (1차/${execQty}주, 총${quantity}주)` : '';

      if (shadowMode) {
        shadows.push(trade);
        console.log(`[AutoTrade SHADOW] ${stock.name}(${stock.code}) 신호 등록 @${currentPrice}${trancheLabel}`);
        appendShadowLog({ event: 'SIGNAL', ...trade });

        await sendTelegramAlert(
          `⚡ <b>[Shadow] 매수 신호${isStrongBuy ? ' — 분할 1차' : ''}</b>\n` +
          `종목: ${stock.name} (${stock.code})\n` +
          `현재가: ${currentPrice.toLocaleString()}원 × ${execQty}주${isStrongBuy ? ` (총${quantity}주)` : ''}\n` +
          `손절: ${stock.stopLoss.toLocaleString()}원 | 목표: ${stock.targetPrice.toLocaleString()}원`
        ).catch(console.error);
      } else {
        // LIVE 모드: 실제 주문 (1차 수량만)
        const orderData = await kisPost(BUY_TR_ID, '/uapi/domestic-stock/v1/trading/order-cash', {
          CANO: process.env.KIS_ACCOUNT_NO ?? '',
          ACNT_PRDT_CD: process.env.KIS_ACCOUNT_PROD ?? '01',
          PDNO: stock.code.padStart(6, '0'),
          ORD_DVSN: '01', // 시장가
          ORD_QTY: execQty.toString(),
          ORD_UNPR: '0',
          SLL_BUY_DVSN_CD: '02',
          CTAC_TLNO: '',
          MGCO_APTM_ODNO: '',
          ORD_SVR_DVSN_CD: '0',
        });
        const ordNo = orderData?.output?.ODNO;
        console.log(`[AutoTrade LIVE] ${stock.name} 매수 주문 완료 — ODNO: ${ordNo}${trancheLabel}`);
        appendShadowLog({ event: 'ORDER', code: stock.code, price: currentPrice, ordNo, tranche: isStrongBuy ? 1 : 0 });

        if (ordNo) {
          fillMonitor.addOrder({
            ordNo,
            stockCode:      stock.code,
            stockName:      stock.name,
            quantity:       execQty,
            orderPrice:     shadowEntryPrice,
            placedAt:       new Date().toISOString(),
            relatedTradeId: trade.id,
          });
        }

        trade.status = 'ACTIVE';
        shadows.push(trade);

        await sendTelegramAlert(
          `🚀 <b>[LIVE] 매수 주문${isStrongBuy ? ' — 분할 1차' : ''}</b>\n` +
          `종목: ${stock.name} (${stock.code})\n` +
          `체결가: ${currentPrice.toLocaleString()}원 × ${execQty}주${isStrongBuy ? ` (총${quantity}주)` : ''}\n` +
          `주문번호: ${ordNo ?? 'N/A'}\n` +
          `손절: ${stock.stopLoss.toLocaleString()}원 | 목표: ${stock.targetPrice.toLocaleString()}원`
        ).catch(console.error);
      }

      // 아이디어 8: STRONG_BUY → 2·3차 분할 매수 스케줄 등록
      if (isStrongBuy && quantity > 1) {
        trancheExecutor.scheduleTranches({
          parentTradeId: trade.id,
          stockCode:     stock.code,
          stockName:     stock.name,
          totalQuantity: quantity,
          firstQuantity: execQty,
          entryPrice:    shadowEntryPrice,
          stopLoss:      stock.stopLoss,
          targetPrice:   stock.targetPrice,
        });
      }
    } catch (err: unknown) {
      console.error(`[AutoTrade] ${stock.code} 스캔 실패:`, err instanceof Error ? err.message : err);
    }
  }

  await updateShadowResults(shadows);
  saveShadowTrades(shadows);
}

/** Shadow 진행 중 거래 결과 업데이트 — Macro/포지션 제한 시에도 재사용 */
async function updateShadowResults(shadows: ServerShadowTrade[]): Promise<void> {
  for (const shadow of shadows) {
    // PENDING: 4분 경과 후 ACTIVE 전환
    if (shadow.status === 'PENDING') {
      const ageMs = Date.now() - new Date(shadow.signalTime).getTime();
      if (ageMs < 4 * 60 * 1000) continue;
      shadow.status = 'ACTIVE';
      continue;
    }

    if (shadow.status !== 'ACTIVE' && shadow.status !== 'EUPHORIA_PARTIAL') continue;

    const currentPrice = await fetchCurrentPrice(shadow.stockCode).catch(() => null);
    if (!currentPrice) continue;

    const returnPct = ((currentPrice - shadow.shadowEntryPrice) / shadow.shadowEntryPrice) * 100;

    // ① 목표가 달성 → 익절 전량 매도
    if (currentPrice >= shadow.targetPrice) {
      Object.assign(shadow, { status: 'HIT_TARGET', exitPrice: currentPrice, exitTime: new Date().toISOString(), returnPct });
      appendShadowLog({ event: 'HIT_TARGET', ...shadow });
      console.log(`[AutoTrade] ✅ ${shadow.stockName} 목표가 달성 +${returnPct.toFixed(2)}% @${currentPrice.toLocaleString()}`);
      await placeKisSellOrder(shadow.stockCode, shadow.stockName, shadow.quantity, 'TAKE_PROFIT');
      continue;
    }

    // ② -30% 블랙리스트 편입 / -25% 전량 청산 (Final Exit)
    if (returnPct <= -25) {
      const isBlacklistStep = returnPct <= -30;
      Object.assign(shadow, { status: 'HIT_STOP', exitPrice: currentPrice, exitTime: new Date().toISOString(), returnPct });
      appendShadowLog({ event: isBlacklistStep ? 'CASCADE_STOP_BLACKLIST' : 'CASCADE_STOP_FINAL', ...shadow });
      console.log(`[AutoTrade] ❌ ${shadow.stockName} Cascade ${returnPct.toFixed(2)}% — 전량 청산${isBlacklistStep ? ' + 블랙리스트 180일' : ''}`);
      await placeKisSellOrder(shadow.stockCode, shadow.stockName, shadow.quantity, 'STOP_LOSS');
      if (isBlacklistStep) {
        addToBlacklist(shadow.stockCode, shadow.stockName, `Cascade ${returnPct.toFixed(1)}%`);
        await sendTelegramAlert(
          `🚫 <b>[블랙리스트] ${shadow.stockName} (${shadow.stockCode})</b>\n` +
          `손실 ${returnPct.toFixed(1)}% → 180일 재진입 금지`
        ).catch(console.error);
      }
      continue;
    }

    // ③ -15% 반매도 (cascadeStep 2, 1회만)
    if (returnPct <= -15 && (shadow.cascadeStep ?? 0) < 2) {
      const halfQty = Math.max(1, Math.floor(shadow.quantity / 2));
      shadow.cascadeStep = 2;
      shadow.halfSoldAt  = new Date().toISOString();
      shadow.originalQuantity ??= shadow.quantity;
      shadow.quantity -= halfQty;
      appendShadowLog({ event: 'CASCADE_HALF_SELL', ...shadow, soldQty: halfQty, returnPct });
      console.log(`[AutoTrade] 🔶 ${shadow.stockName} Cascade -15% — 반매도 ${halfQty}주 (잔여 ${shadow.quantity}주)`);
      await placeKisSellOrder(shadow.stockCode, shadow.stockName, halfQty, 'STOP_LOSS');
      await sendTelegramAlert(
        `🔶 <b>[Cascade -15%] ${shadow.stockName} (${shadow.stockCode})</b>\n` +
        `손실 ${returnPct.toFixed(1)}% — 반매도 ${halfQty}주 (잔여 ${shadow.quantity}주)`
      ).catch(console.error);
      continue;
    }

    // ④ -7% 추가 매수 차단 + 경고 (cascadeStep 1, 1회만)
    if (returnPct <= -7 && (shadow.cascadeStep ?? 0) < 1) {
      shadow.cascadeStep    = 1;
      shadow.addBuyBlocked  = true;
      appendShadowLog({ event: 'CASCADE_WARN', ...shadow, returnPct });
      console.warn(`[AutoTrade] ⚠️  ${shadow.stockName} Cascade -7% — 추가 매수 차단`);
      await sendTelegramAlert(
        `⚠️ <b>[Cascade -7%] ${shadow.stockName} (${shadow.stockCode})</b>\n` +
        `손실 ${returnPct.toFixed(1)}% — 추가 매수 차단 (모니터링 강화)`
      ).catch(console.error);
      continue;
    }

    // ⑤ 손절선 터치 → 전량 청산
    if (currentPrice <= shadow.stopLoss) {
      Object.assign(shadow, { status: 'HIT_STOP', exitPrice: currentPrice, exitTime: new Date().toISOString(), returnPct });
      appendShadowLog({ event: 'HIT_STOP', ...shadow });
      console.log(`[AutoTrade] ❌ ${shadow.stockName} 손절 ${returnPct.toFixed(2)}% @${currentPrice.toLocaleString()}`);
      await placeKisSellOrder(shadow.stockCode, shadow.stockName, shadow.quantity, 'STOP_LOSS');
      continue;
    }

    // ⑥ 손절가 5% 이내 접근 경고 (1회만 발송)
    if (!shadow.stopApproachAlerted) {
      const distToStop = (currentPrice - shadow.stopLoss) / shadow.stopLoss * 100;
      if (distToStop > 0 && distToStop < 5) {
        shadow.stopApproachAlerted = true;
        await sendTelegramAlert(
          `🟡 <b>[손절 접근 경고] ${shadow.stockName} (${shadow.stockCode})</b>\n` +
          `현재가: ${currentPrice.toLocaleString()}원\n` +
          `손절까지: -${distToStop.toFixed(1)}%\n` +
          `손절가: ${shadow.stopLoss.toLocaleString()}원`
        ).catch(console.error);
      }
    }

    // ⑦ 과열 탐지 — ACTIVE 상태에서만 첫 번째 부분 매도 발동
    if (shadow.status === 'ACTIVE') {
      const euphoria = checkEuphoria(shadow, currentPrice);
      if (euphoria.triggered) {
        const halfQty = Math.max(1, Math.floor(shadow.quantity / 2));
        console.log(
          `[AutoTrade] 🌡️ ${shadow.stockName} 과열 감지 (${euphoria.count}개 신호) — 절반 매도 ${halfQty}주\n  신호: ${euphoria.signals.join(', ')}`
        );
        shadow.originalQuantity ??= shadow.quantity;
        shadow.quantity -= halfQty;
        shadow.status = 'EUPHORIA_PARTIAL';
        appendShadowLog({
          event: 'EUPHORIA_PARTIAL',
          ...shadow,
          exitPrice: currentPrice,
          euphoriaSoldQty: halfQty,
          originalQuantity: shadow.originalQuantity,
        });
        await placeKisSellOrder(shadow.stockCode, shadow.stockName, halfQty, 'EUPHORIA');
      }
    }
  }
}

// ─── 아이디어 3: 일일 리포트 이메일 ────────────────────────────────────────────

/**
 * 아이디어 9: 일일 리포트 2.0 — Gemini AI 내러티브 리포트
 * 1. 거래 데이터 + MHS + 월간 통계를 Gemini에 주입 (googleSearch 없음)
 * 2. 자연어 요약 리포트 생성
 * 3. Telegram으로 즉시 발송 (이메일은 보조)
 */
export async function generateDailyReport(): Promise<void> {
  const shadows = loadShadowTrades();
  const macro   = loadMacroState();
  const stats   = getMonthlyStats();
  const today   = new Date().toISOString().split('T')[0];
  const todayTrades = shadows.filter((s) => s.signalTime.startsWith(today));
  const closed = todayTrades.filter((s) => s.status === 'HIT_TARGET' || s.status === 'HIT_STOP');
  const wins   = closed.filter((s) => s.status === 'HIT_TARGET');
  const totalReturn = closed.reduce((sum, s) => sum + (s.returnPct ?? 0), 0);
  const winRate = closed.length > 0 ? Math.round((wins.length / closed.length) * 100) : 0;
  const watchlist = loadWatchlist();

  // ── 기본 수치 리포트 (이메일 / 폴백용) ────────────────────────────────────────
  const tradeLines = closed.map((s) =>
    `  ${s.status === 'HIT_TARGET' ? '✅' : '❌'} ${s.stockName}(${s.stockCode}) ${(s.returnPct ?? 0).toFixed(2)}%`
  ).join('\n') || '  (결산 없음)';

  const baseReport = [
    `[QuantMaster Pro] ${today} 자동매매 일일 리포트`,
    '',
    `▶ 당일 신호: ${todayTrades.length}건`,
    `▶ 결산 완료: ${closed.length}건 (승 ${wins.length} / 패 ${closed.length - wins.length})`,
    `▶ 적중률: ${winRate}%  |  일일 P&L: ${totalReturn >= 0 ? '+' : ''}${totalReturn.toFixed(2)}%`,
    `▶ MHS: ${macro?.mhs ?? 'N/A'} (${macro?.regime ?? 'N/A'})`,
    `▶ 워치리스트: ${watchlist.length}개`,
    '',
    tradeLines,
    '',
    `[월간 ${stats.month}] WIN률 ${stats.winRate.toFixed(1)}% | PF ${
      stats.wins > 0 && stats.losses > 0
        ? (stats.wins / (stats.losses || 1)).toFixed(2)
        : 'N/A'
    } | 평균수익 ${stats.avgReturn.toFixed(2)}%`,
    `모드: ${process.env.AUTO_TRADE_MODE !== 'LIVE' ? 'SHADOW (가상매매)' : 'LIVE (실매매)'}`,
  ].join('\n');

  // ── Gemini AI 내러티브 생성 (googleSearch 없음 — 비용 절감) ─────────────────
  const dataBlock = [
    `날짜: ${today} (KST)`,
    `거래 모드: ${process.env.AUTO_TRADE_MODE !== 'LIVE' ? 'Shadow (가상매매)' : 'LIVE (실매매)'}`,
    `당일 신호: ${todayTrades.length}건 | 결산 ${closed.length}건 (승 ${wins.length} / 패 ${closed.length - wins.length})`,
    `일일 P&L: ${totalReturn >= 0 ? '+' : ''}${totalReturn.toFixed(2)}%`,
    `MHS: ${macro?.mhs ?? 'N/A'} | 레짐: ${macro?.regime ?? 'N/A'}`,
    `워치리스트: ${watchlist.length}개 (${watchlist.slice(0, 5).map(w => w.name).join(', ')}${watchlist.length > 5 ? ' 외' : ''})`,
    `월간 통계 (${stats.month}): 전체 ${stats.total}건 / WIN률 ${stats.winRate.toFixed(1)}% / 평균수익 ${stats.avgReturn.toFixed(2)}%`,
    `STRONG_BUY 적중률: ${stats.strongBuyWinRate.toFixed(1)}%`,
    closed.length > 0 ? `오늘 결산 종목: ${closed.map(s => `${s.stockName} ${(s.returnPct ?? 0).toFixed(2)}%`).join(', ')}` : '',
  ].filter(Boolean).join('\n');

  const geminiPrompt = [
    '당신은 한국 주식 자동매매 시스템의 일일 리포트 작성 AI입니다.',
    '아래 오늘의 거래 데이터를 바탕으로 트레이더가 내일 아침 읽을 간결한 한국어 내러티브 리포트를 작성하세요.',
    '형식: 오늘 요약 2~3문장 + 주목할 점 1~2개 bullet + 내일 주의사항 1~2개 bullet.',
    '반드시 한국어로, 300자 이내로 작성하세요. 외부 검색은 필요 없습니다.',
    '',
    '=== 오늘 데이터 ===',
    dataBlock,
  ].join('\n');

  const narrative = await callGemini(geminiPrompt);

  // ── Telegram 발송 (메인 채널) ──────────────────────────────────────────────
  const telegramMsg = narrative
    ? `📊 <b>[QuantMaster] ${today} 일일 리포트</b>\n\n${narrative}\n\n` +
      `<i>P&L ${totalReturn >= 0 ? '+' : ''}${totalReturn.toFixed(2)}% | ` +
      `WIN ${winRate}% (${wins.length}/${closed.length}) | MHS ${macro?.mhs ?? 'N/A'}</i>`
    : `📊 <b>[QuantMaster] ${today} 일일 리포트</b>\n\n${baseReport}`;

  await sendTelegramAlert(telegramMsg).catch(console.error);

  // ── 이메일 발송 (보조 채널, 미설정 시 스킵) ────────────────────────────────
  if (process.env.EMAIL_USER && process.env.EMAIL_PASS) {
    const emailBody = narrative ? `${narrative}\n\n---\n${baseReport}` : baseReport;
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
    });
    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: process.env.REPORT_EMAIL ?? process.env.EMAIL_USER,
      subject: `[QuantMaster] ${today} 일일 리포트 — WIN률 ${winRate}%`,
      text: emailBody,
    }).catch((e: unknown) => console.error('[AutoTrade] 이메일 발송 실패:', e instanceof Error ? e.message : e));
    console.log('[AutoTrade] 일일 리포트 이메일 발송 →', process.env.REPORT_EMAIL ?? process.env.EMAIL_USER);
  }

  console.log('[AutoTrade] 일일 리포트 완료 (Telegram + 이메일)');
}

// ─── 주간 리포트 ────────────────────────────────────────────────────────────────

/**
 * 주간 성과 리포트 — 매주 금요일 16:30 KST (UTC 07:30) 자동 발송
 * 직전 7일간의 Shadow 거래 결과를 집계하여 Telegram으로 발송
 */
export async function generateWeeklyReport(): Promise<void> {
  const shadows = loadShadowTrades();
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const week = shadows.filter(s => new Date(s.signalTime).getTime() > weekAgo);
  const closed = week.filter(s => s.status !== 'ACTIVE' && s.status !== 'PENDING');
  const wins = closed.filter(s => s.status === 'HIT_TARGET');
  const winRate = closed.length > 0 ? Math.round(wins.length / closed.length * 100) : 0;

  const msg =
    `📅 <b>주간 성과 리포트</b>\n` +
    `━━━━━━━━━━━━━━━━━\n` +
    `이번 주 신호: ${week.length}건\n` +
    `결산: ${closed.length}건 (승 ${wins.length} / 패 ${closed.length - wins.length})\n` +
    `주간 WIN률: ${winRate}%`;

  await sendTelegramAlert(msg).catch(console.error);
  console.log('[AutoTrade] 주간 리포트 완료');
}

// ─── 장 시작 전 워치리스트 브리핑 ──────────────────────────────────────────────

/**
 * 장 시작 전 워치리스트 브리핑 — 평일 08:50 KST (UTC 23:50, 일~목 UTC)
 * 워치리스트 상위 5개 종목의 목표가/손절가를 요약하여 Telegram 발송
 */
export async function sendWatchlistBriefing(): Promise<void> {
  const list = loadWatchlist();
  if (list.length === 0) return;

  const lines = list.slice(0, 5).map(w =>
    `• ${w.name} | 목표 ${w.targetPrice.toLocaleString()} | 손절 ${w.stopLoss.toLocaleString()}`
  ).join('\n');

  const msg =
    `🌅 <b>장 시작 브리핑 (09:00)</b>\n` +
    `━━━━━━━━━━━━━━━━━\n` +
    `👀 워치리스트 ${list.length}개\n\n${lines}\n\n` +
    `<i>오늘도 원칙대로 ✊</i>`;

  await sendTelegramAlert(msg).catch(console.error);
  console.log('[AutoTrade] 워치리스트 브리핑 완료');
}

// ─── 장중 중간 점검 알림 ────────────────────────────────────────────────────────

/**
 * 장중 중간 점검 알림 — 포지션 보유 시에만 발송 (포지션 없는 날 생략)
 * @param type 'midday' | 'preclose
 *   - 'midday'   : 오전 11:30 KST (UTC 02:30)
 *   - 'preclose' : 오후 14:00 KST (UTC 05:00)
 */
export async function sendIntradayCheckIn(type: 'midday' | 'preclose'): Promise<void> {
  const shadows = loadShadowTrades();
  const active = shadows.filter(s => s.status === 'ACTIVE' || s.status === 'EUPHORIA_PARTIAL');

  // 포지션 없는 날은 생략
  if (active.length === 0) return;

  const macro = loadMacroState();
  const today = new Date().toISOString().split('T')[0];
  const todaySignals = shadows.filter(s => s.signalTime.startsWith(today));

  // 각 활성 포지션에 대해 현재가 조회 (병렬)
  const positionLines: string[] = [];
  let nearStopLoss = false;
  let nearTarget = false;

  for (const shadow of active) {
    const currentPrice = await fetchCurrentPrice(shadow.stockCode).catch(() => null);
    if (!currentPrice) {
      positionLines.push(`• ${shadow.stockName} (시세 없음)`);
      continue;
    }
    const returnPct = ((currentPrice - shadow.shadowEntryPrice) / shadow.shadowEntryPrice) * 100;
    const distToTarget = ((shadow.targetPrice - currentPrice) / currentPrice) * 100;
    const distToStop   = ((currentPrice - shadow.stopLoss) / shadow.stopLoss) * 100;

    if (distToStop < 5) nearStopLoss = true;
    if (distToTarget < 3) nearTarget = true;

    const statusEmoji =
      distToTarget < 3  ? '🟢 목표 근접' :
      distToStop   < 5  ? '⚠️ 손절 모니터링' :
      returnPct    >= 0 ? '📈' : '📉';

    positionLines.push(
      `• ${shadow.stockName} ${returnPct >= 0 ? '+' : ''}${returnPct.toFixed(1)}% ${statusEmoji}`
    );
  }

  // 주목할 상황이 없는 날(preclose)은 생략
  if (type === 'preclose' && !nearStopLoss && !nearTarget) return;

  const header = type === 'midday'
    ? `📡 <b>[장 중간 현황] 11:30</b>`
    : `⏰ <b>[마감 2시간 전] 14:00</b>`;

  const msg =
    `${header}\n` +
    `━━━━━━━━━━━━━━━\n` +
    `활성 포지션: ${active.length}개\n` +
    positionLines.join('\n') + '\n\n' +
    `오늘 신호: ${todaySignals.length}건\n` +
    `MHS: ${macro?.mhs ?? 'N/A'} (${macro?.regime ?? 'N/A'})`;

  await sendTelegramAlert(msg).catch(console.error);
  console.log(`[AutoTrade] 장중 점검 알림 완료 (${type})`);
}

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

      const sl = Math.round(s.currentPrice * 0.92);
      const tp = Math.round(s.currentPrice * 1.15);
      watchlist.push({
        code: s.code,
        name: s.name,
        entryPrice: s.currentPrice,
        stopLoss: sl,
        targetPrice: tp,
        addedAt: new Date().toISOString(),
        addedBy: 'AUTO',
        rrr: parseFloat(((tp - s.currentPrice) / (s.currentPrice - sl || 1)).toFixed(2)),
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
    const gate = evaluateServerGate(quote, loadConditionWeights());
    if (gate.signalType === 'SKIP') {
      console.log(`[AutoPopulate] SKIP: ${stock.name}(${stock.code}) gateScore=${gate.gateScore}/8`);
      continue;
    }

    const sl = Math.round(quote.price * 0.92);
    const tp = Math.round(quote.price * 1.15);
    watchlist.push({
      code: stock.code,
      name: stock.name,
      entryPrice: quote.price,
      stopLoss: sl,
      targetPrice: tp,
      addedAt: new Date().toISOString(),
      gateScore: gate.gateScore,
      addedBy: 'AUTO',
      memo: `${gate.signalType} gate=${gate.gateScore.toFixed(1)}/8 ${gate.details.join(', ')}`,
      rrr: parseFloat(((tp - quote.price) / (quote.price - sl || 1)).toFixed(2)),
      conditionKeys: gate.conditionKeys,
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
  conditionKeys?: string[];        // 아이디어 6: 통과한 Gate 조건 키 목록 (Signal Calibrator용)
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
      const currentPrice = await fetchCurrentPrice(rec.stockCode).catch(() => null);
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

  // ── 아이디어 4+10: 실거래 전환 체크리스트 자동화 (6개 조건) ──
  const shadows = loadShadowTrades();
  const closedShadows = shadows.filter(
    (s) => s.status === 'HIT_TARGET' || s.status === 'HIT_STOP'
  );
  const shadowReturns = closedShadows.map((s) => s.returnPct ?? 0);

  // MDD 계산
  let peak = 0, mdd = 0, cumReturn = 0;
  for (const r of shadowReturns) {
    cumReturn += r;
    peak = Math.max(peak, cumReturn);
    mdd = Math.min(mdd, cumReturn - peak);
  }

  // Profit Factor 계산
  const totalWin  = shadowReturns.filter((r) => r > 0).reduce((a, b) => a + b, 0);
  const totalLoss = Math.abs(shadowReturns.filter((r) => r <= 0).reduce((a, b) => a + b, 0));
  const profitFactor = totalLoss > 0 ? totalWin / totalLoss : totalWin > 0 ? Infinity : 0;

  // 아이디어 4: 평균 보유기간 (거래일 기준)
  const holdingDays = closedShadows
    .filter((s) => s.exitTime && s.signalTime)
    .map((s) => {
      const ms = new Date(s.exitTime!).getTime() - new Date(s.signalTime).getTime();
      return ms / (1000 * 60 * 60 * 24);
    });
  const avgHoldingDays = holdingDays.length > 0
    ? holdingDays.reduce((a, b) => a + b, 0) / holdingDays.length
    : 0;

  // 아이디어 4: 연속 손절 최대 횟수 계산
  let maxConsecLoss = 0, currentStreak = 0;
  for (const s of closedShadows) {
    if (s.status === 'HIT_STOP') {
      currentStreak++;
      maxConsecLoss = Math.max(maxConsecLoss, currentStreak);
    } else {
      currentStreak = 0;
    }
  }

  // 아이디어 4: 6개 전환 요건 체크리스트
  const closedCount = closedShadows.length;
  const winRate = closedCount > 0 ? (closedShadows.filter(s => s.status === 'HIT_TARGET').length / closedCount) * 100 : 0;

  const readyChecks = {
    sampleSize:     closedCount >= 30,                          // ≥ 30건
    winRate:        winRate >= 55,                               // ≥ 55%
    profitFactor:   profitFactor >= 1.5,                         // ≥ 1.5
    mddSafe:        mdd > -10,                                  // > -10%
    holdingPeriod:  avgHoldingDays >= 3 && avgHoldingDays <= 15, // 3~15 거래일
    consecLoss:     maxConsecLoss <= 3,                          // 연속 손절 ≤ 3회
  };

  const passCount  = Object.values(readyChecks).filter(Boolean).length;
  const totalChecks = Object.keys(readyChecks).length;

  // 프로그레스 바 생성 헬퍼
  const progressBar = (current: number, target: number, width = 10): string => {
    const ratio = Math.min(current / (target || 1), 1);
    const filled = Math.round(ratio * width);
    return '▓'.repeat(filled) + '░'.repeat(width - filled) + ` ${Math.round(ratio * 100)}%`;
  };

  if (passCount === totalChecks) {
    // 아이디어 10: 전환 준비 완료 플래그 생성 + Telegram 단계별 안내
    const curStats = getMonthlyStats();
    writeRealTradeFlag(curStats);
    await sendTelegramAlert(
      `🎯 <b>[QuantMaster] 실거래 전환 준비 완료!</b>\n\n` +
      `Shadow ${closedCount}건 검증 완료 — 6개 조건 모두 충족 ✅\n\n` +
      `✅ 건수: ${closedCount}/30\n` +
      `✅ 승률: ${winRate.toFixed(1)}%\n` +
      `✅ PF: ${profitFactor.toFixed(2)}\n` +
      `✅ MDD: ${mdd.toFixed(2)}%\n` +
      `✅ 보유기간: ${avgHoldingDays.toFixed(1)}일\n` +
      `✅ 연속손절: 최대 ${maxConsecLoss}회\n\n` +
      `📋 <b>전환 절차 (반자동):</b>\n` +
      `1️⃣ Railway 대시보드 → Variables\n` +
      `2️⃣ KIS_IS_REAL = true 설정\n` +
      `3️⃣ 재배포(Redeploy) 클릭\n` +
      `4️⃣ 다음 장 시작 시 자동 실거래 전환\n\n` +
      `⚠️ data/real-trade-ready.flag 생성됨`
    ).catch(console.error);
    console.log('[자기학습] 🎯 실거래 전환 조건 모두 충족!');
  } else {
    const remaining = 30 - closedCount;
    await sendTelegramAlert(
      `📊 <b>[실거래 전환 진행률] ${passCount}/${totalChecks} 조건 충족</b>\n` +
      `건수: ${closedCount}/30 ${progressBar(closedCount, 30)} ${readyChecks.sampleSize ? '✅' : '⏳'}\n` +
      `승률: ${winRate.toFixed(1)}%/55% ${readyChecks.winRate ? '✅' : '❌'}\n` +
      `PF: ${profitFactor.toFixed(2)}/1.5 ${readyChecks.profitFactor ? '✅' : '❌'}\n` +
      `MDD: ${mdd.toFixed(2)}%/-10% ${readyChecks.mddSafe ? '✅' : '❌'}\n` +
      `보유기간: ${avgHoldingDays.toFixed(1)}일/3~15일 ${readyChecks.holdingPeriod ? '✅' : '❌'}\n` +
      `연속손절: ${maxConsecLoss}회/≤3회 ${readyChecks.consecLoss ? '✅' : '❌'}` +
      (remaining > 0 ? `\n→ ${remaining}건 더 쌓이면 전환 검토 가능` : '')
    ).catch(console.error);
    console.log(`[자기학습] 전환 진행률: ${passCount}/${totalChecks}`);
  }
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

// ─── 아이디어 3: FillMonitor — 체결 확인 폴링 루프 ─────────────────────────────

const PENDING_ORDERS_FILE = path.join(DATA_DIR, 'pending-orders.json');
const FILL_POLL_MAX = 10; // 최대 폴링 횟수 (cron 5분 간격 × 10 = 최대 50분 모니터링)

export interface PendingOrder {
  ordNo: string;           // KIS 주문번호 (ODNO)
  stockCode: string;
  stockName: string;
  quantity: number;
  orderPrice: number;
  placedAt: string;        // ISO
  pollCount: number;       // 현재까지 조회 횟수
  status: 'PENDING' | 'FILLED' | 'PARTIAL' | 'CANCELLED' | 'EXPIRED';
  fillPrice?: number;
  fillQty?: number;
  filledAt?: string;
  relatedTradeId?: string; // shadow trade ID (연관 포지션)
}

function loadPendingOrders(): PendingOrder[] {
  ensureDataDir();
  if (!fs.existsSync(PENDING_ORDERS_FILE)) return [];
  try { return JSON.parse(fs.readFileSync(PENDING_ORDERS_FILE, 'utf-8')); } catch { return []; }
}

function savePendingOrders(orders: PendingOrder[]): void {
  ensureDataDir();
  // 완료/취소된 주문은 최근 100건만 보관
  const active  = orders.filter(o => o.status === 'PENDING' || o.status === 'PARTIAL');
  const history = orders.filter(o => o.status !== 'PENDING' && o.status !== 'PARTIAL').slice(-100);
  fs.writeFileSync(PENDING_ORDERS_FILE, JSON.stringify([...active, ...history], null, 2));
}

export class FillMonitor {
  /** LIVE 주문 후 호출 — pending-orders.json에 추가 */
  addOrder(order: Omit<PendingOrder, 'pollCount' | 'status'>): void {
    const orders = loadPendingOrders();
    if (orders.some(o => o.ordNo === order.ordNo)) return; // 중복 방지
    orders.push({ ...order, pollCount: 0, status: 'PENDING' });
    savePendingOrders(orders);
    console.log(`[FillMonitor] 주문 등록: ${order.stockName}(${order.stockCode}) ODNO=${order.ordNo}`);
  }

  /** 5분 간격 cron에서 호출 — 모든 PENDING 주문의 체결 여부 확인 */
  async pollFills(): Promise<void> {
    if (!process.env.KIS_APP_KEY) return;
    const orders = loadPendingOrders();
    const pending = orders.filter(o => o.status === 'PENDING' || o.status === 'PARTIAL');
    if (pending.length === 0) return;

    console.log(`[FillMonitor] 미체결 조회 — ${pending.length}건`);
    const trId = KIS_IS_REAL ? 'TTTC0688R' : 'VTTC0688R';

    let data: { output?: { odno: string; ord_qty: string; tot_ccld_qty: string; avg_prvs: string; pdno: string }[] } | null = null;
    try {
      data = await kisGet(trId, '/uapi/domestic-stock/v1/trading/inquire-psbl-rvsecncl', {
        CANO: process.env.KIS_ACCOUNT_NO ?? '',
        ACNT_PRDT_CD: process.env.KIS_ACCOUNT_PROD ?? '01',
        CTX_AREA_FK100: '', CTX_AREA_NK100: '',
        INQR_DVSN_1: '0', INQR_DVSN_2: '0',
      });
    } catch (e) {
      console.error('[FillMonitor] KIS 미체결 조회 실패:', e instanceof Error ? e.message : e);
      return;
    }

    const unfilledOdnoSet = new Set((data?.output ?? []).map(o => o.odno));
    let changed = false;

    for (const order of pending) {
      order.pollCount++;

      if (!unfilledOdnoSet.has(order.ordNo)) {
        // KIS 미체결 목록에 없음 → 체결 완료
        const fillPrice = await fetchCurrentPrice(order.stockCode).catch(() => null) ?? order.orderPrice;
        Object.assign(order, {
          status: 'FILLED', fillPrice, fillQty: order.quantity,
          filledAt: new Date().toISOString(),
        });
        changed = true;
        console.log(`[FillMonitor] ✅ 체결 확인: ${order.stockName} @${fillPrice.toLocaleString()}원 (ODNO=${order.ordNo})`);
        await sendTelegramAlert(
          `✅ <b>[체결 확인]</b>\n` +
          `종목: ${order.stockName} (${order.stockCode})\n` +
          `체결가: ${fillPrice.toLocaleString()}원\n` +
          `수량: ${order.quantity}주\n` +
          `주문번호: ${order.ordNo}`
        ).catch(console.error);
      } else if (order.pollCount >= FILL_POLL_MAX) {
        // 10회 폴링 초과 → 만료 처리 (장 마감 취소와 별도)
        order.status = 'EXPIRED';
        changed = true;
        console.warn(`[FillMonitor] ⏱ 폴링 만료 (${FILL_POLL_MAX}회): ${order.stockName} ODNO=${order.ordNo}`);
        await sendTelegramAlert(
          `⏱ <b>[미체결 만료]</b> ${order.stockName}(${order.ordNo}) — 폴링 ${FILL_POLL_MAX}회 초과`
        ).catch(console.error);
      } else {
        console.log(`[FillMonitor] 미체결 유지 (${order.pollCount}/${FILL_POLL_MAX}): ${order.stockName} ODNO=${order.ordNo}`);
      }
    }

    if (changed) savePendingOrders(orders);
  }

  /**
   * 장 마감 10분 전(15:20) cron에서 호출 — PENDING 주문 전량 자동 취소.
   * Railway cron 설정: '20 6 * * 1-5' (UTC 기준 15:20 KST)
   */
  async autoCancelAtClose(): Promise<void> {
    if (!process.env.KIS_APP_KEY) return;
    const orders = loadPendingOrders();
    const pending = orders.filter(o => o.status === 'PENDING' || o.status === 'PARTIAL');
    if (pending.length === 0) return;

    console.warn(`[FillMonitor] 장 마감 전 미체결 취소 — ${pending.length}건`);
    const cancelTrId = KIS_IS_REAL ? 'TTTC0803U' : 'VTTC0803U';

    for (const order of pending) {
      try {
        await kisPost(cancelTrId, '/uapi/domestic-stock/v1/trading/order-rvsecncl', {
          CANO: process.env.KIS_ACCOUNT_NO ?? '',
          ACNT_PRDT_CD: process.env.KIS_ACCOUNT_PROD ?? '01',
          KRX_FWDG_ORD_ORGNO: '', ORGN_ODNO: order.ordNo,
          ORD_DVSN: '00', RVSE_CNCL_DVSN_CD: '02',
          ORD_QTY: order.quantity.toString(), ORD_UNPR: '0',
          QTY_ALL_ORD_YN: 'Y', PDNO: order.stockCode.padStart(6, '0'),
        });
        order.status = 'CANCELLED';
        console.log(`[FillMonitor] 취소 완료: ${order.stockName} ODNO=${order.ordNo}`);
        await sendTelegramAlert(
          `🚫 <b>[장마감 자동 취소]</b> ${order.stockName}(${order.stockCode})\n` +
          `주문번호: ${order.ordNo} | 미체결 ${order.quantity}주`
        ).catch(console.error);
      } catch (e) {
        console.error(`[FillMonitor] 취소 실패 ODNO=${order.ordNo}:`, e instanceof Error ? e.message : e);
      }
    }

    savePendingOrders(orders);
  }

  getPendingOrders(): PendingOrder[] {
    return loadPendingOrders();
  }
}

/** 싱글턴 인스턴스 (server.ts에서 import하여 cron 연결) */
export const fillMonitor = new FillMonitor();

// ─── 아이디어 6: Signal Calibrator — 자기학습 피드백 루프 ──────────────────────────

/**
 * 월간 추천 통계를 분석하여 조건별 가중치(condition-weights.json)를 자동 조정.
 * - 각 조건의 WIN률 < 40% → 가중치 10% 감소
 * - WIN률 > 65% → 가중치 10% 증가
 * - 가중치 범위: 0.3 ~ 1.8
 * - Gemini에게 월간 통계 입력 → 오탐 조건 분석 리포트 생성 (googleSearch 없음)
 */
export async function calibrateSignalWeights(): Promise<void> {
  const recs = loadRecommendations();
  const month = new Date().toISOString().slice(0, 7);
  const resolved = recs.filter(
    (r) => r.signalTime.startsWith(month) &&
    r.status !== 'PENDING' &&
    r.conditionKeys && r.conditionKeys.length > 0
  );

  if (resolved.length < 10) {
    console.log(`[Calibrator] 학습 데이터 부족 (${resolved.length}건 < 10) — 보정 건너뜀`);
    return;
  }

  // 조건별 WIN/LOSS 집계
  const condStats: Record<string, { wins: number; total: number }> = {};
  for (const rec of resolved) {
    for (const key of (rec.conditionKeys ?? [])) {
      if (!condStats[key]) condStats[key] = { wins: 0, total: 0 };
      condStats[key].total++;
      if (rec.status === 'WIN') condStats[key].wins++;
    }
  }

  const weights = loadConditionWeights();
  const adjustments: string[] = [];

  for (const [key, stat] of Object.entries(condStats)) {
    if (stat.total < 3) continue; // 샘플 부족 → 보정 안 함
    const winRate = stat.wins / stat.total;
    const prev = weights[key as keyof typeof weights] ?? 1.0;

    if (winRate < 0.40) {
      weights[key as keyof typeof weights] = parseFloat(Math.max(0.3, prev * 0.9).toFixed(2));
      adjustments.push(`${key}: ${prev.toFixed(2)} → ${weights[key as keyof typeof weights]} (WIN률 ${(winRate * 100).toFixed(0)}% 낮음)`);
    } else if (winRate > 0.65) {
      weights[key as keyof typeof weights] = parseFloat(Math.min(1.8, prev * 1.1).toFixed(2));
      adjustments.push(`${key}: ${prev.toFixed(2)} → ${weights[key as keyof typeof weights]} (WIN률 ${(winRate * 100).toFixed(0)}% 높음)`);
    }
  }

  if (adjustments.length > 0) {
    saveConditionWeights(weights);
    console.log(`[Calibrator] 가중치 조정: ${adjustments.join(' | ')}`);
  } else {
    console.log('[Calibrator] 가중치 변경 없음 — 현재 설정 유지');
  }

  // Gemini 메타 분석 (googleSearch 없음)
  const statsBlock = Object.entries(condStats)
    .map(([k, v]) => `${k}: ${v.wins}승/${v.total}건 (WIN률 ${((v.wins / v.total) * 100).toFixed(0)}%)`)
    .join(', ');

  const geminiPrompt = [
    '당신은 한국 주식 퀀트 시스템의 신호 품질 분석 AI입니다.',
    `아래는 ${month} 월간 Gate 조건별 적중률 통계입니다.`,
    '어떤 조건이 오탐을 많이 냈는지 분석하고, 트레이더에게 개선 방향을 1~3문장으로 한국어로 제안하세요.',
    '외부 검색 불필요. 주어진 데이터만 분석하세요.',
    '',
    `=== ${month} 조건별 통계 ===`,
    statsBlock,
    `총 해석 가능 추천: ${resolved.length}건`,
    adjustments.length > 0 ? `자동 조정: ${adjustments.join(' | ')}` : '자동 조정 없음',
  ].join('\n');

  const analysis = await callGemini(geminiPrompt);
  if (analysis) {
    await sendTelegramAlert(
      `🔬 <b>[Signal Calibrator] ${month} 자기학습 분석</b>\n\n${analysis}\n\n` +
      `<i>조정: ${adjustments.length > 0 ? adjustments.join(', ') : '없음'}</i>`
    ).catch(console.error);
  }
}

// ─── 아이디어 11: DART 공시 즉시 반응 엔진 (1분 간격 고속 폴링) ─────────────────

// 고영향 공시 키워드 (가격 이동 유발 가능성 높은 공시 유형)
const FAST_DART_KEYWORDS = [
  '무상증자', '자사주취득', '자사주소각', '영업이익', '잠정실적',
  '수주', '흑자전환', '분기실적', '연간실적', '대규모수주',
];

const DART_FAST_SEEN_FILE = path.join(DATA_DIR, 'dart-fast-seen.json');

function loadFastSeenNos(): Set<string> {
  ensureDataDir();
  if (!fs.existsSync(DART_FAST_SEEN_FILE)) return new Set();
  try {
    const arr = JSON.parse(fs.readFileSync(DART_FAST_SEEN_FILE, 'utf-8')) as string[];
    return new Set(arr);
  } catch { return new Set(); }
}

function saveFastSeenNos(seen: Set<string>): void {
  ensureDataDir();
  // 최근 2000건만 유지 (파일 비대화 방지)
  const arr = [...seen].slice(-2000);
  fs.writeFileSync(DART_FAST_SEEN_FILE, JSON.stringify(arr, null, 2));
}

/**
 * 아이디어 11: 1분 간격 DART 고속 폴링
 * - 오늘자 공시 목록에서 고영향 키워드 감지
 * - 워치리스트 종목 매칭 → Gemini 매수 관련성 판단 → Telegram 즉시 알림
 * - googleSearch 없음 (DART API 직접 호출 + Gemini 판단)
 */
export async function fastDartCheck(): Promise<void> {
  if (!process.env.DART_API_KEY) return;

  // 주말(토·일) 및 장외 시간(KST 08:00 미만 또는 16:30 초과)은 스킵 — 불필요한 API 소모 방지
  const { dow, t: kstT } = getKstTime();
  if (dow === 0 || dow === 6) return;
  if (kstT < 800 || kstT > 1630) return;

  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const url = `https://opendart.fss.or.kr/api/list.json` +
    `?crtfc_key=${process.env.DART_API_KEY}` +
    `&bgn_de=${today}&end_de=${today}` +
    `&sort=rcp_dt&sort_mth=desc&page_count=20`;

  let disclosures: Record<string, string>[] = [];
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    const data = await res.json() as { status: string; list?: Record<string, string>[] };
    if (data.status !== '000' || !data.list) return;
    disclosures = data.list;
  } catch {
    return; // 타임아웃/네트워크 오류는 조용히 무시 (1분마다 재시도)
  }

  const seen    = loadFastSeenNos();
  const watchlist = loadWatchlist();
  const watchCodes = new Set(watchlist.map(w => w.code.padStart(6, '0')));
  let changed = false;

  for (const d of disclosures) {
    const rceptNo  = d.rcept_no  ?? '';
    const corpName = d.corp_name ?? '';
    const reportNm = d.report_nm ?? '';
    const stockCode = (d.stock_code ?? '').padStart(6, '0');

    if (seen.has(rceptNo)) continue;
    seen.add(rceptNo);
    changed = true;

    // 고영향 키워드 체크
    const isHighImpact = FAST_DART_KEYWORDS.some(kw => reportNm.includes(kw));
    if (!isHighImpact) continue;

    const isWatchlistStock = watchCodes.has(stockCode);

    // Gemini로 매수 관련성 판단 (워치리스트 종목이거나 키워드 매칭 시)
    const geminiPrompt = [
      '한국 주식 공시 내용을 보고 단기 매수 관련성을 "긍정", "부정", "중립" 중 하나와 이유 한 문장으로만 답하세요.',
      `공시: ${reportNm}`,
      `법인명: ${corpName}`,
      `워치리스트 종목: ${isWatchlistStock ? '예' : '아니오'}`,
    ].join('\n');

    const judgment = await callGemini(geminiPrompt).catch(() => null);
    const isPositive = judgment?.includes('긍정') ?? false;

    // 긍정 판단이거나 워치리스트 종목이면 Telegram 즉시 알림
    if (isPositive || isWatchlistStock) {
      const emoji = isPositive ? '🚀' : '📢';
      await sendTelegramAlert(
        `${emoji} <b>[DART 즉시 반응] ${corpName}</b>\n` +
        `${reportNm}\n` +
        (isWatchlistStock ? `⭐ <b>워치리스트 종목!</b>\n` : '') +
        `판단: ${judgment ?? '분석 불가'}\n` +
        `DART: https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${rceptNo}`
      ).catch(console.error);

      console.log(`[FastDART] ${emoji} ${corpName} — ${reportNm} (watch=${isWatchlistStock})`);
    }
  }

  if (changed) saveFastSeenNos(seen);
}

// ─── 아이디어 10: Bear Regime 자동 알림 Push 시스템 ───────────────────────────────

/**
 * Bear Regime 감지 → 중복 알림 방지를 위한 마지막 알림 시각 저장 파일.
 * BEAR 구간에서 최소 4시간 간격으로 한 번만 Telegram 알림 발송.
 */
const BEAR_ALERT_FILE = path.join(DATA_DIR, 'bear-alert-state.json');

/** Bear 알림 재발송 최소 간격 (밀리초): 4시간 */
const BEAR_ALERT_COOLDOWN_MS = 4 * 60 * 60 * 1000;

interface BearAlertState {
  lastSentAt: string;   // ISO — 마지막 알림 발송 시각
  lastRegime: string;   // 마지막 알림 당시 regime
}

function loadBearAlertState(): BearAlertState | null {
  ensureDataDir();
  if (!fs.existsSync(BEAR_ALERT_FILE)) return null;
  try { return JSON.parse(fs.readFileSync(BEAR_ALERT_FILE, 'utf-8')); } catch { return null; }
}

function saveBearAlertState(state: BearAlertState): void {
  ensureDataDir();
  fs.writeFileSync(BEAR_ALERT_FILE, JSON.stringify(state, null, 2));
}

/**
 * 아이디어 10: Bear Regime 자동 알림 Push 시스템
 * - MacroState를 읽어 regime = 'RED' (Bear) 감지 시 Telegram 즉시 알림
 * - 쿨다운(4시간) 기반 중복 방지 — Bear 구간 내 반복 알림 억제
 * - KIS API 연동 없이 즉시 구현 가능한 세미-자동화 알림
 */
export async function pollBearRegime(): Promise<void> {
  const macro = loadMacroState();
  if (!macro) return; // 매크로 상태 없으면 패스

  // Gate0 buyingHalted 임계값(MHS < 40)과 명시적 RED 레짐 모두 Bear로 간주.
  // MHS < 40 은 evaluateGate0()의 buyingHalted 기준과 일치하며,
  // regime='RED' 는 클라이언트가 명시적으로 설정한 위험 상태를 반영한다.
  const isBear = macro.regime === 'RED' || macro.mhs < 40;
  if (!isBear) return; // Bear가 아니면 패스

  // 쿨다운 체크 — 마지막 알림 이후 4시간 미경과 시 스킵
  const alertState = loadBearAlertState();
  if (alertState) {
    const elapsed = Date.now() - new Date(alertState.lastSentAt).getTime();
    if (elapsed < BEAR_ALERT_COOLDOWN_MS) return;
  }

  // 알림 메시지 구성
  const mhs        = macro.mhs;
  const vkospi     = macro.vkospi;
  const sellDays   = macro.foreignFuturesSellDays;
  const iri        = macro.iri;

  const vkospiLine =
    vkospi !== undefined
      ? `VKOSPI: ${vkospi.toFixed(1)} (${vkospi >= 30 ? '↑ 위험' : '관찰'})`
      : 'VKOSPI: N/A';

  const foreignLine =
    sellDays !== undefined
      ? `외국인 선물: ${sellDays}일 연속 순매도`
      : '외국인 선물: N/A';

  const iriLine =
    iri !== undefined
      ? `IRI: ${iri >= 0 ? '+' : ''}${iri.toFixed(1)}pt (${Math.abs(iri) >= 3 ? '위험 임계 초과' : '관찰'})`
      : 'IRI: N/A';

  const message =
    `📱 <b>QuantMaster Pro Alert</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `🔴 <b>BEAR REGIME 감지</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `MHS: ${mhs}/100 (RED)\n` +
    `${vkospiLine}\n` +
    `${foreignLine}\n` +
    `${iriLine}\n` +
    `\n` +
    `<b>추천 액션:</b>\n` +
    `① KODEX 200선물인버스2X 검토\n` +
    `② 현금 비중 30% 확보\n` +
    `③ 롱 포지션 50% 축소`;

  await sendTelegramAlert(message).catch(console.error);
  console.log(`[BearRegime] BEAR 감지 알림 발송 완료 (MHS=${mhs})`);

  saveBearAlertState({ lastSentAt: new Date().toISOString(), lastRegime: macro.regime });
}

// ─── 아이디어 8: MHS 임계값 모닝 알림 시스템 ─────────────────────────────────────

/**
 * MHS 모닝 알림 상태 — 레짐 전환 감지용 이전 MHS 값 보존.
 * 매일 09:00 KST 실행 후 갱신.
 */
const MHS_MORNING_ALERT_FILE = path.join(DATA_DIR, 'mhs-morning-alert-state.json');

interface MhsMorningAlertState {
  prevMhs: number;   // 직전 알림 시점의 MHS
  checkedAt: string; // ISO — 마지막 체크 시각
}

function loadMhsMorningAlertState(): MhsMorningAlertState | null {
  ensureDataDir();
  if (!fs.existsSync(MHS_MORNING_ALERT_FILE)) return null;
  try { return JSON.parse(fs.readFileSync(MHS_MORNING_ALERT_FILE, 'utf-8')); } catch { return null; }
}

function saveMhsMorningAlertState(state: MhsMorningAlertState): void {
  ensureDataDir();
  fs.writeFileSync(MHS_MORNING_ALERT_FILE, JSON.stringify(state, null, 2));
}

/**
 * 아이디어 8: MHS 임계값 모닝 알림
 * - 매일 09:00 KST(평일) cron에서 호출.
 * - MHS < 40: RED 레짐 진입 — 전면 매수 중단 신호 (Telegram 알림).
 * - MHS ≥ 70 AND prevMhs < 70: GREEN 레짐 전환 진입 — 매수 재개 조건 충족 알림.
 * - prevMhs 를 파일에 저장하여 Railway 재시작 후에도 레짐 전환 감지 유지.
 */
export async function pollMhsMorningAlert(): Promise<void> {
  const macro = loadMacroState();
  if (!macro) return; // 매크로 상태 미설정 시 패스

  const mhs = macro.mhs;
  const alertState = loadMhsMorningAlertState();
  const prevMhs = alertState?.prevMhs ?? -1; // 초기값 -1 → 첫 실행에서 GREEN 전환 알림 억제

  if (mhs < 40) {
    const message =
      `📱 <b>QuantMaster Pro — MHS 아침 알림</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `🔴 <b>RED 레짐 진입</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `⚠️ MHS ${mhs}/100 — RED 레짐 진입\n` +
      `전면 매수 중단 신호\n` +
      `\n` +
      `<b>추천 액션:</b>\n` +
      `① 신규 매수 전면 중단\n` +
      `② 현금 비중 확대 검토\n` +
      `③ 기존 롱 포지션 리스크 점검`;
    await sendTelegramAlert(message).catch(console.error);
    console.log(`[MhsMorningAlert] RED 레짐 알림 발송 완료 (MHS=${mhs})`);
  }

  if (mhs >= 70 && prevMhs >= 0 && prevMhs < 70) {
    const message =
      `📱 <b>QuantMaster Pro — MHS 아침 알림</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `🟢 <b>GREEN 레짐 전환 진입</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `✅ MHS ${mhs}/100 — GREEN 레짐 진입\n` +
      `매수 재개 조건 충족\n` +
      `\n` +
      `<b>추천 액션:</b>\n` +
      `① 관심 종목 매수 재개 검토\n` +
      `② 퀀트 엔진 평가 신호 재활성화\n` +
      `③ 분할 매수 스케줄 점검`;
    await sendTelegramAlert(message).catch(console.error);
    console.log(`[MhsMorningAlert] GREEN 레짐 전환 알림 발송 완료 (MHS=${mhs}, prevMhs=${prevMhs})`);
  }

  saveMhsMorningAlertState({ prevMhs: mhs, checkedAt: new Date().toISOString() });
}

// ─── 아이디어 11: IPS 통합 변곡점 확률 엔진 알림 ─────────────────────────────────

/**
 * IPS 변곡점 경보 알림 상태 파일.
 * 마지막 알림 발송 시각 + 단계를 저장하여 중복 알림 억제.
 */
const IPS_ALERT_FILE = path.join(DATA_DIR, 'ips-alert-state.json');

/** IPS 알림 단계별 재발송 최소 간격 */
const IPS_ALERT_COOLDOWN_MS: Record<string, number> = {
  WARNING:  2 * 60 * 60 * 1000, // WARNING: 2시간
  CRITICAL: 4 * 60 * 60 * 1000, // CRITICAL: 4시간
  EXTREME:  6 * 60 * 60 * 1000, // EXTREME: 6시간
};

interface IpsAlertState {
  lastSentAt: string;  // ISO — 마지막 알림 발송 시각
  lastLevel: string;   // 마지막 발송 단계
  lastIps: number;     // 마지막 발송 IPS 점수
}

function loadIpsAlertState(): IpsAlertState | null {
  ensureDataDir();
  if (!fs.existsSync(IPS_ALERT_FILE)) return null;
  try { return JSON.parse(fs.readFileSync(IPS_ALERT_FILE, 'utf-8')); } catch { return null; }
}

function saveIpsAlertState(state: IpsAlertState): void {
  ensureDataDir();
  fs.writeFileSync(IPS_ALERT_FILE, JSON.stringify(state, null, 2));
}

/**
 * MacroState 필드를 사용하여 서버사이드 IPS를 계산한다.
 * 클라이언트 evaluateIPS()와 동일한 가중치 적용.
 *
 * IPS = THS역전(20%) + VDA(15%) + FSS음수(20%) +
 *       FBS_2단계(20%) + TMA감속(15%) + SRR역전(10%)
 */
function computeServerIps(macro: MacroState): { ips: number; signals: string[] } {
  const mhs       = macro.mhs;
  const regime    = macro.regime;
  const vkospi    = macro.vkospi ?? 0;
  const vix       = macro.vix ?? 0;

  const signals: string[] = [];
  let ips = 0;

  // THS 역전 (20%): MHS 하락 추세 / 매수 중단 임계 미달
  const thsTriggered =
    regime === 'RED' ||
    mhs < 40 ||
    macro.mhsTrend === 'DETERIORATING' ||
    mhs < 50;
  if (thsTriggered) { ips += 20; signals.push(`THS 역전 (MHS=${mhs})`); }

  // VDA (15%): VIX / VKOSPI 공포지수 상승 이탈
  const vdaTriggered = vix >= 22 || vkospi >= 22 || macro.vkospiRising === true;
  if (vdaTriggered) { ips += 15; signals.push(`VDA (VIX=${vix.toFixed(1)}, VKOSPI=${vkospi.toFixed(1)})`); }

  // FSS 음수 (20%): Bear Regime 조건 3개 이상 발동
  const bearCount = macro.bearRegimeTriggeredCount ?? 0;
  const fssTriggered = bearCount >= 3;
  if (fssTriggered) { ips += 20; signals.push(`FSS 음수 (Bear 조건 ${bearCount}개)`); }

  // FBS 2단계 (20%): Bear 레짐 진입 / 방어 모드
  const fbsTriggered = regime === 'RED' || macro.bearDefenseMode === true;
  if (fbsTriggered) { ips += 20; signals.push(`FBS 2단계 (${regime}${macro.bearDefenseMode ? ' 방어모드' : ''})`); }

  // TMA 감속 (15%): OECD CLI 하강 / 수출 증가율 음수
  const cli         = macro.oeciCliKorea ?? 100;
  const exportGrowth = macro.exportGrowth3mAvg ?? 0;
  const tmaTriggered = cli < 100 || exportGrowth < 0;
  if (tmaTriggered) { ips += 15; signals.push(`TMA 감속 (CLI=${cli.toFixed(1)}, 수출=${exportGrowth >= 0 ? '+' : ''}${exportGrowth.toFixed(1)}%)`); }

  // SRR 역전 (10%): DXY 강세 / KOSPI 120일선 하회
  const srrTriggered = macro.dxyBullish === true || macro.kospiBelow120ma === true;
  if (srrTriggered) { ips += 10; signals.push(`SRR 역전 (DXY강세:${macro.dxyBullish ?? false}, KOSPI<120MA:${macro.kospiBelow120ma ?? false})`); }

  return { ips, signals };
}

/**
 * 아이디어 11: IPS 변곡점 경보 폴링
 * - 15분 간격 24/7 실행 (장 외 시간 포함)
 * - IPS ≥ 60% → ⚠️ WARNING 텔레그램 알림
 * - IPS ≥ 80% → 🚨 CRITICAL 50% 비중 축소 트리거
 * - IPS ≥ 90% → 🔴 EXTREME Pre-Mortem 체크리스트
 * - 단계별 쿨다운(2/4/6시간)으로 중복 알림 억제
 */
export async function pollIpsAlert(): Promise<void> {
  const macro = loadMacroState();
  if (!macro) return; // 매크로 상태 미설정 시 패스

  const { ips, signals } = computeServerIps(macro);

  // IPS < 60 → NORMAL, 알림 없음
  if (ips < 60) return;

  const level = ips >= 90 ? 'EXTREME' : ips >= 80 ? 'CRITICAL' : 'WARNING';

  // 쿨다운 체크
  const alertState = loadIpsAlertState();
  if (alertState) {
    const elapsed   = Date.now() - new Date(alertState.lastSentAt).getTime();
    const cooldown  = IPS_ALERT_COOLDOWN_MS[level] ?? 2 * 60 * 60 * 1000;
    // 같은 단계이면 쿨다운 적용, 더 심각한 단계로 상승하면 즉시 발송
    const levelOrder = ['WARNING', 'CRITICAL', 'EXTREME'];
    const lastIdx    = levelOrder.indexOf(alertState.lastLevel);
    const curIdx     = levelOrder.indexOf(level);
    if (elapsed < cooldown && curIdx <= lastIdx) return;
  }

  // 단계별 이모지 및 행동 메시지
  let levelEmoji: string;
  let action1: string;
  let action2: string;
  let action3: string;
  if (level === 'EXTREME') {
    levelEmoji = '🔴';
    action1 = 'Pre-Mortem 체크리스트 즉시 실행';
    action2 = '포지션 전면 재검토 및 손절 라인 재설정';
    action3 = '현금 비중 50% 이상 확보 권고';
  } else if (level === 'CRITICAL') {
    levelEmoji = '🚨';
    action1 = '포지션 50% 비중 즉시 축소';
    action2 = '인버스 ETF 또는 현금 전환 검토';
    action3 = '손절 강화 및 신규 매수 중단';
  } else {
    levelEmoji = '⚠️';
    action1 = '신규 매수 자제';
    action2 = '기존 포지션 손절 라인 재점검';
    action3 = '변동성 대비 현금 10~20% 확보';
  }

  const signalLines = signals.map(s => `  • ${s}`).join('\n');

  const message =
    `📱 <b>QuantMaster Pro — IPS 변곡점 경보</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `${levelEmoji} <b>[${level}] IPS ${ips}%</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `<b>발동 신호:</b>\n${signalLines}\n` +
    `\n` +
    `<b>추천 액션:</b>\n` +
    `① ${action1}\n` +
    `② ${action2}\n` +
    `③ ${action3}`;

  await sendTelegramAlert(message).catch(console.error);
  console.log(`[IpsAlert] ${level} 경보 발송 완료 (IPS=${ips}%)`);

  saveIpsAlertState({ lastSentAt: new Date().toISOString(), lastLevel: level, lastIps: ips });
}

// ─── 아이디어 10: Shadow → Real 전환 준비 플래그 ─────────────────────────────────

const REAL_TRADE_FLAG_FILE = path.join(DATA_DIR, 'real-trade-ready.flag');

export function isRealTradeReady(): boolean {
  return fs.existsSync(REAL_TRADE_FLAG_FILE);
}

function writeRealTradeFlag(stats: ReturnType<typeof getMonthlyStats>): void {
  ensureDataDir();
  fs.writeFileSync(REAL_TRADE_FLAG_FILE, JSON.stringify({
    createdAt:       new Date().toISOString(),
    month:           stats.month,
    total:           stats.total,
    winRate:         stats.winRate,
    avgReturn:       stats.avgReturn,
    strongBuyWinRate: stats.strongBuyWinRate,
  }, null, 2));
  console.log('[RealTrade] real-trade-ready.flag 생성');
}

// ─── 아이디어 8: TrancheExecutor — 분할 매수 자동화 ─────────────────────────────

export interface TrancheSchedule {
  id: string;
  parentTradeId: string;
  stockCode: string;
  stockName: string;
  trancheNumber: 2 | 3;
  scheduledDate: string;   // YYYY-MM-DD KST — 이 날짜 이후 첫 장 개시에 실행
  quantity: number;
  entryPrice: number;      // 1차 진입가 (기준가)
  stopLoss: number;
  targetPrice: number;
  status: 'PENDING' | 'EXECUTED' | 'CANCELLED';
  executedAt?: string;
  cancelReason?: string;
}

const TRANCHE_FILE = path.join(DATA_DIR, 'tranche-schedule.json');

function loadTranches(): TrancheSchedule[] {
  ensureDataDir();
  if (!fs.existsSync(TRANCHE_FILE)) return [];
  try { return JSON.parse(fs.readFileSync(TRANCHE_FILE, 'utf-8')); } catch { return []; }
}

function saveTranches(list: TrancheSchedule[]): void {
  ensureDataDir();
  // PENDING만 무제한, 완료·취소는 최근 200건 보관
  const active  = list.filter(t => t.status === 'PENDING');
  const history = list.filter(t => t.status !== 'PENDING').slice(-200);
  fs.writeFileSync(TRANCHE_FILE, JSON.stringify([...active, ...history], null, 2));
}

/** KST 날짜 문자열 (YYYY-MM-DD) 반환 */
function kstDateStr(offsetDays = 0): string {
  const d = new Date(Date.now() + 9 * 60 * 60 * 1000 + offsetDays * 86400_000);
  return d.toISOString().slice(0, 10);
}

export class TrancheExecutor {
  /**
   * STRONG_BUY 1차 진입 직후 호출.
   * 2차(+3 영업일, 30%)·3차(+7 영업일, 20%) 스케줄 등록.
   */
  scheduleTranches(opts: {
    parentTradeId: string;
    stockCode: string;
    stockName: string;
    totalQuantity: number;
    firstQuantity: number;
    entryPrice: number;
    stopLoss: number;
    targetPrice: number;
  }): void {
    const remaining = opts.totalQuantity - opts.firstQuantity;
    if (remaining < 1) return;

    const qty2 = Math.max(1, Math.floor(opts.totalQuantity * 0.30));
    const qty3 = Math.max(1, opts.totalQuantity - opts.firstQuantity - qty2);

    const list = loadTranches();
    const base: Omit<TrancheSchedule, 'id' | 'trancheNumber' | 'scheduledDate' | 'quantity'> = {
      parentTradeId: opts.parentTradeId,
      stockCode:     opts.stockCode,
      stockName:     opts.stockName,
      entryPrice:    opts.entryPrice,
      stopLoss:      opts.stopLoss,
      targetPrice:   opts.targetPrice,
      status:        'PENDING',
    };
    list.push({ ...base, id: `tr2_${Date.now()}_${opts.stockCode}`, trancheNumber: 2, scheduledDate: kstDateStr(3),  quantity: qty2 });
    list.push({ ...base, id: `tr3_${Date.now()}_${opts.stockCode}`, trancheNumber: 3, scheduledDate: kstDateStr(7),  quantity: qty3 });
    saveTranches(list);
    console.log(`[Tranche] 스케줄 등록: ${opts.stockName}(${opts.stockCode}) 2차 ${qty2}주(+3일) / 3차 ${qty3}주(+7일)`);
  }

  /**
   * 장 전 OPENING_AUCTION 핸들러에서 호출.
   * scheduledDate <= 오늘 이고 PENDING인 트랜치를 실행 or 취소.
   * 가드: 현재가가 기준가(entryPrice) 대비 -3% 이하 → 해당 parentTradeId 전체 취소.
   */
  async checkPendingTranches(): Promise<void> {
    if (!process.env.KIS_APP_KEY) return;
    const list = loadTranches();
    const today = kstDateStr();
    const pending = list.filter(t => t.status === 'PENDING' && t.scheduledDate <= today);
    if (pending.length === 0) return;

    console.log(`[Tranche] 실행 대상 ${pending.length}건 점검`);
    const isLive = process.env.AUTO_TRADE_MODE === 'LIVE';
    let changed = false;

    // parentTradeId별로 취소 여부를 캐싱 (현재가는 한 번만 조회)
    const cancelledParents = new Set<string>();
    const priceCache: Record<string, number | null> = {};

    for (const t of pending) {
      try {
        // 이미 같은 parentTrade가 취소된 경우 연쇄 취소
        if (cancelledParents.has(t.parentTradeId)) {
          t.status = 'CANCELLED';
          t.cancelReason = '동일 포지션 취소 연쇄';
          changed = true;
          continue;
        }

        // 현재가 조회 (캐시 활용)
        if (!(t.stockCode in priceCache)) {
          priceCache[t.stockCode] = await fetchCurrentPrice(t.stockCode).catch(() => null);
        }
        const currentPrice = priceCache[t.stockCode];

        if (!currentPrice) {
          console.warn(`[Tranche] ${t.stockName} 현재가 조회 실패 — 다음 실행으로 연기`);
          continue;
        }

        // -3% 가드: 1차 진입가 기준
        const dropPct = ((currentPrice - t.entryPrice) / t.entryPrice) * 100;
        if (dropPct <= -3) {
          t.status = 'CANCELLED';
          t.cancelReason = `기준가 대비 ${dropPct.toFixed(1)}% 하락`;
          cancelledParents.add(t.parentTradeId);
          changed = true;
          console.warn(`[Tranche] ${t.stockName} ${t.trancheNumber}차 취소 — 손절 가드 (${dropPct.toFixed(1)}%)`);
          await sendTelegramAlert(
            `🚫 <b>[분할 매수 ${t.trancheNumber}차 취소]</b> ${t.stockName}(${t.stockCode})\n` +
            `기준가 ${t.entryPrice.toLocaleString()}원 대비 ${dropPct.toFixed(1)}% 하락`
          ).catch(console.error);
          continue;
        }

        // Gate 1 재검증: 시장 상황 변화 반영 (Yahoo Finance 기반 serverQuantFilter)
        const reCheckQuote = await fetchYahooQuote(`${t.stockCode}.KS`).catch(() => null)
                          ?? await fetchYahooQuote(`${t.stockCode}.KQ`).catch(() => null);
        if (reCheckQuote) {
          const gate = evaluateServerGate(reCheckQuote, loadConditionWeights());
          if (gate.signalType === 'SKIP') {
            t.status = 'CANCELLED';
            t.cancelReason = `Gate 재검증 실패 (score=${gate.gateScore.toFixed(1)}, SKIP)`;
            changed = true;
            console.warn(`[Tranche] ${t.stockName} ${t.trancheNumber}차 취소 — Gate 재검증 실패 (${gate.gateScore.toFixed(1)}/8)`);
            await sendTelegramAlert(
              `🚫 <b>[분할 매수 ${t.trancheNumber}차 취소]</b> ${t.stockName}(${t.stockCode})\n` +
              `Gate 재검증 SKIP (score=${gate.gateScore.toFixed(1)}/8) — 시장 상황 변화`
            ).catch(console.error);
            continue;
          }
        }

        // 실행
        if (isLive) {
          const orderData = await kisPost(BUY_TR_ID, '/uapi/domestic-stock/v1/trading/order-cash', {
            CANO:         process.env.KIS_ACCOUNT_NO ?? '',
            ACNT_PRDT_CD: process.env.KIS_ACCOUNT_PROD ?? '01',
            PDNO:         t.stockCode.padStart(6, '0'),
            ORD_DVSN:     '01', // 시장가
            ORD_QTY:      t.quantity.toString(),
            ORD_UNPR:     '0',
            SLL_BUY_DVSN_CD: '02',
            CTAC_TLNO: '', MGCO_APTM_ODNO: '', ORD_SVR_DVSN_CD: '0',
          }).catch(() => null);

          const ordNo = (orderData as { output?: { ODNO?: string } } | null)?.output?.ODNO;
          if (ordNo) {
            fillMonitor.addOrder({
              ordNo,
              stockCode:      t.stockCode,
              stockName:      t.stockName,
              quantity:       t.quantity,
              orderPrice:     currentPrice,
              placedAt:       new Date().toISOString(),
              relatedTradeId: t.parentTradeId,
            });
          }
          console.log(`[Tranche] LIVE ${t.trancheNumber}차 주문 — ${t.stockName} ${t.quantity}주 ODNO=${ordNo}`);
        }

        t.status     = 'EXECUTED';
        t.executedAt = new Date().toISOString();
        changed = true;

        await sendTelegramAlert(
          `📈 <b>[분할 매수 ${t.trancheNumber}차${isLive ? '' : ' Shadow'}]</b> ${t.stockName}(${t.stockCode})\n` +
          `${t.quantity}주 @${currentPrice.toLocaleString()}원 | 기준가 대비 ${dropPct >= 0 ? '+' : ''}${dropPct.toFixed(1)}%`
        ).catch(console.error);
      } catch (e) {
        console.error(`[Tranche] ${t.stockName}(${t.stockCode}) 오류:`, e instanceof Error ? e.message : e);
      }
    }

    if (changed) saveTranches(list);
  }

  getPendingTranches(): TrancheSchedule[] {
    return loadTranches().filter(t => t.status === 'PENDING');
  }
}

export const trancheExecutor = new TrancheExecutor();

// ─── 아이디어 2: 동시호가 예약 주문 (08:45 KST) ──────────────────────────────────

/**
 * OPENING_AUCTION 진입 시 (08:45 KST) 워치리스트 종목에 대해:
 * 1. Yahoo Finance로 전일 종가 조회
 * 2. 진입가 대비 ±2% 이내 괴리율 체크
 * 3. ServerGate 재평가 (8개 조건)
 * 4. NORMAL/STRONG → KIS 지정가 주문 or Shadow 알림
 */
export async function preMarketOrderPrep(): Promise<void> {
  const watchlist = loadWatchlist();
  if (watchlist.length === 0) {
    console.log('[PreMarket] 워치리스트 비어있음 — 예약 주문 건너뜀');
    return;
  }

  console.log(`[PreMarket] 동시호가 예약 주문 준비 — ${watchlist.length}개 종목`);
  const isLive = process.env.AUTO_TRADE_MODE === 'LIVE';
  const capital = (await fetchAccountBalance().catch(() => null)) ?? 10_000_000;

  for (const stock of watchlist) {
    try {
      // Yahoo Finance 시세 조회 (KS 접미사 → KQ 폴백)
      const quote = (await fetchYahooQuote(`${stock.code}.KS`).catch(() => null))
                 ?? (await fetchYahooQuote(`${stock.code}.KQ`).catch(() => null));

      if (!quote || quote.price <= 0) {
        console.log(`[PreMarket] ${stock.name}(${stock.code}) Yahoo 시세 없음 — 건너뜀`);
        continue;
      }

      // ±2% gap 체크: 전일 종가 대비 워치리스트 진입가 괴리율
      const gapPct = Math.abs((quote.price - stock.entryPrice) / stock.entryPrice) * 100;
      if (gapPct > 2) {
        console.log(`[PreMarket] ${stock.name}(${stock.code}) Gap ${gapPct.toFixed(1)}% > 2% — 스킵`);
        continue;
      }

      // Gate 재평가 (Yahoo 데이터 기반 8개 조건, 자기학습 가중치 적용)
      const gate = evaluateServerGate(quote, loadConditionWeights());
      if (gate.signalType === 'SKIP') {
        console.log(`[PreMarket] ${stock.name}(${stock.code}) Gate ${gate.gateScore}/8 SKIP — 미달`);
        continue;
      }

      const quantity = Math.floor((capital * gate.positionPct) / stock.entryPrice);
      if (quantity <= 0) continue;

      console.log(
        `[PreMarket] ${stock.name}(${stock.code}) 예약 — ${quantity}주 @${stock.entryPrice.toLocaleString()} ` +
        `(Gate=${gate.gateScore}/8 ${gate.signalType} gap=${gapPct.toFixed(1)}%)`
      );

      if (isLive && process.env.KIS_APP_KEY) {
        // KIS 지정가 매수 주문 (동시호가)
        const orderRes = await kisPost(BUY_TR_ID, '/uapi/domestic-stock/v1/trading/order-cash', {
          CANO:         process.env.KIS_ACCOUNT_NO ?? '',
          ACNT_PRDT_CD: process.env.KIS_ACCOUNT_PROD ?? '01',
          PDNO:         stock.code.padStart(6, '0'),
          ORD_DVSN:     '00', // 지정가
          ORD_QTY:      quantity.toString(),
          ORD_UNPR:     stock.entryPrice.toString(),
        }).catch((e: unknown) => {
          console.error(`[PreMarket] KIS 주문 오류 ${stock.code}:`, e instanceof Error ? e.message : e);
          return null;
        });

        const ordNo = (orderRes as { output?: { odno?: string } } | null)?.output?.odno;
        if (ordNo) {
          fillMonitor.addOrder({
            ordNo,
            stockCode:      stock.code,
            stockName:      stock.name,
            quantity,
            orderPrice:     stock.entryPrice,
            placedAt:       new Date().toISOString(),
            relatedTradeId: undefined,
          });
          await sendTelegramAlert(
            `📋 <b>[동시호가 예약 주문]</b>\n` +
            `종목: ${stock.name} (${stock.code})\n` +
            `가격: ${stock.entryPrice.toLocaleString()}원 × ${quantity}주\n` +
            `Gate: ${gate.gateScore}/8 (${gate.signalType}) | Gap: ${gapPct.toFixed(1)}%\n` +
            `주문번호: ${ordNo}`
          ).catch(console.error);
        }
      } else {
        // Shadow 모드: Telegram 알림만
        await sendTelegramAlert(
          `🎭 <b>[동시호가 Shadow 예약]</b>\n` +
          `종목: ${stock.name} (${stock.code})\n` +
          `예정가: ${stock.entryPrice.toLocaleString()}원 × ${quantity}주\n` +
          `Gate: ${gate.gateScore}/8 (${gate.signalType}) | Gap: ${gapPct.toFixed(1)}%`
        ).catch(console.error);
      }

      await new Promise(r => setTimeout(r, 300)); // Yahoo rate limit 방지
    } catch (e) {
      console.error(`[PreMarket] ${stock.name}(${stock.code}) 오류:`, e instanceof Error ? e.message : e);
    }
  }

  console.log('[PreMarket] 동시호가 예약 주문 준비 완료');
}

// ─── 아이디어 1: TradingDayOrchestrator — 장 사이클 State Machine ──────────────

export type TradingState =
  | 'PRE_MARKET'       // 장 시작 전 (KST < 08:00 or > 17:00)
  | 'OPENING_AUCTION'  // 동시호가 준비 (08:00–08:59)
  | 'MARKET_OPEN'      // 시초가 구간 (09:00–09:14)
  | 'INTRADAY'         // 장중 스캔 루프 (09:15–15:19)
  | 'CLOSING_PREP'     // 장 마감 전 취소 구간 (15:20–15:29)
  | 'POST_MARKET'      // 장 마감 후 (15:30–15:59)
  | 'REPORT_ANALYSIS'  // 리포트 + 자기학습 (16:00–16:59)
  | 'WEEKEND';         // 토·일

interface OrchestratorState {
  currentState: TradingState;
  lastTransition: string;   // ISO
  tradingDate: string;      // YYYY-MM-DD (KST 기준)
  handlerRanAt: Record<string, string>; // handler key → ISO timestamp
}

const ORCHESTRATOR_STATE_FILE = path.join(DATA_DIR, 'orchestrator-state.json');

function getKstTime(): { h: number; m: number; t: number; dow: number; dateStr: string } {
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const h = kst.getUTCHours();
  const m = kst.getUTCMinutes();
  return {
    h, m,
    t:       h * 100 + m,
    dow:     kst.getUTCDay(),             // 0=Sun, 6=Sat
    dateStr: kst.toISOString().slice(0, 10),
  };
}

function resolveState(h: number, m: number, dow: number): TradingState {
  if (dow === 0 || dow === 6) return 'WEEKEND';
  const t = h * 100 + m;
  if (t < 800)  return 'PRE_MARKET';
  if (t < 900)  return 'OPENING_AUCTION';
  if (t < 915)  return 'MARKET_OPEN';
  if (t < 1520) return 'INTRADAY';
  if (t < 1530) return 'CLOSING_PREP';
  if (t < 1600) return 'POST_MARKET';
  if (t < 1700) return 'REPORT_ANALYSIS';
  return 'PRE_MARKET';
}

export class TradingDayOrchestrator {
  private orch: OrchestratorState;

  constructor() {
    this.orch = this.load();
  }

  private load(): OrchestratorState {
    ensureDataDir();
    if (fs.existsSync(ORCHESTRATOR_STATE_FILE)) {
      try {
        return JSON.parse(fs.readFileSync(ORCHESTRATOR_STATE_FILE, 'utf-8')) as OrchestratorState;
      } catch { /* fallthrough */ }
    }
    return {
      currentState:  'PRE_MARKET',
      lastTransition: new Date().toISOString(),
      tradingDate:    '',
      handlerRanAt:   {},
    };
  }

  private save(): void {
    ensureDataDir();
    fs.writeFileSync(ORCHESTRATOR_STATE_FILE, JSON.stringify(this.orch, null, 2));
  }

  private hasRan(key: string): boolean {
    return !!this.orch.handlerRanAt[key];
  }

  private markRan(key: string): void {
    this.orch.handlerRanAt[key] = new Date().toISOString();
    this.save();
  }

  /** 현재 오케스트레이터 상태 조회 (모니터링 / API용) */
  getStatus(): OrchestratorState & { computedState: TradingState } {
    const { h, m, dow } = getKstTime();
    return { ...this.orch, computedState: resolveState(h, m, dow) };
  }

  /**
   * 5분 간격 cron에서 호출.
   * 상태 전환 감지 → 해당 핸들러 실행.
   * Railway 재시작 안전: handlerRanAt으로 당일 중복 실행 방지.
   */
  async tick(): Promise<void> {
    const { h, m, t, dow, dateStr } = getKstTime();
    const state = resolveState(h, m, dow);

    // 날짜 변경 → 핸들러 이력 초기화 (새 거래일)
    if (dateStr !== this.orch.tradingDate) {
      this.orch.tradingDate    = dateStr;
      this.orch.handlerRanAt   = {};
      console.log(`[Orchestrator] 새 거래일 (${dateStr}) — 핸들러 이력 초기화`);
    }

    // 상태 전환 로깅
    if (state !== this.orch.currentState) {
      console.log(
        `[Orchestrator] ${this.orch.currentState} → ${state} ` +
        `(KST ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')})`
      );
      this.orch.currentState   = state;
      this.orch.lastTransition = new Date().toISOString();
      this.save();
    }

    await this.dispatch(state, t);
  }

  private async dispatch(state: TradingState, t: number): Promise<void> {
    const enabled = process.env.AUTO_TRADE_ENABLED === 'true';

    switch (state) {
      case 'OPENING_AUCTION': {
        // 08:00 이후 최초 1회: 실거래 전환 플래그 확인 → 아침 리마인더
        if (!this.hasRan('realTradeReminder') && isRealTradeReady()) {
          await sendTelegramAlert(
            `🟡 <b>[전환 대기]</b> real-trade-ready.flag 감지\n` +
            `오늘 KIS_IS_REAL=true 설정 후 재배포하면 실거래 전환됩니다.\n` +
            `준비가 됐다면 Railway 대시보드에서 변수 설정 후 Redeploy하세요.`
          ).catch(console.error);
          this.markRan('realTradeReminder');
        }

        // 08:45 이후 한 번만: 토큰 갱신 → 분할 매수 체크 → 사전 스크리닝 → 워치리스트 자동 채우기 → 예약 주문
        if (t >= 845 && !this.hasRan('openAuction')) {
          console.log('[Orchestrator] 장 전 준비 시작 (KST 08:45+)');
          await refreshKisToken().catch(console.error);
          // 아이디어 8: 분할 매수 대기 트랜치 실행
          await trancheExecutor.checkPendingTranches().catch(console.error);
          await preScreenStocks().catch(console.error);
          const added = await autoPopulateWatchlist().catch(() => 0) ?? 0;
          if (added > 0) {
            await sendTelegramAlert(
              `📋 <b>[AutoPopulate] 워치리스트 자동 추가</b>\n신규 ${added}개 종목 추가됨`
            ).catch(console.error);
          }
          if (enabled) {
            await preMarketOrderPrep().catch(console.error);
          }
          this.markRan('openAuction');
        }
        break;
      }

      case 'MARKET_OPEN': {
        // 시초가 스캔 (한 번만)
        if (enabled && !this.hasRan('marketOpen')) {
          console.log('[Orchestrator] 시초가 스캔 (KST 09:00+)');
          await runAutoSignalScan().catch(console.error);
          await fillMonitor.pollFills().catch(console.error);
          this.markRan('marketOpen');
        }
        break;
      }

      case 'INTRADAY': {
        // 매 tick(5분): 신호 스캔 + 체결 확인
        // checkDailyLossLimit은 server.ts tick-wrapper에서 호출
        if (enabled) {
          await runAutoSignalScan().catch(console.error);
          await fillMonitor.pollFills().catch(console.error);
        }
        break;
      }

      case 'CLOSING_PREP': {
        // 15:20 도달 시 한 번만: 미체결 전량 취소
        if (enabled && !this.hasRan('closingPrep')) {
          console.log('[Orchestrator] 장 마감 전 미체결 자동 취소 (KST 15:20)');
          await fillMonitor.autoCancelAtClose().catch(console.error);
          this.markRan('closingPrep');
        }
        break;
      }

      case 'REPORT_ANALYSIS': {
        // 16:00+ 한 번만: 일일 리포트
        if (!this.hasRan('dailyReport')) {
          console.log('[Orchestrator] 일일 리포트 생성 (KST 16:00+)');
          await generateDailyReport().catch(console.error);
          this.markRan('dailyReport');
        }
        // 16:30+ 한 번만: 자기학습 추천 평가
        if (t >= 1630 && !this.hasRan('evalRecs')) {
          console.log('[Orchestrator] 자기학습 추천 평가 (KST 16:30+)');
          await evaluateRecommendations().catch(console.error);
          this.markRan('evalRecs');
        }
        // 월말(28일 이후) 16:45+ 한 번만: Signal Calibrator 가중치 보정
        {
          const kstDay = new Date(Date.now() + 9 * 60 * 60 * 1000).getUTCDate();
          if (kstDay >= 28 && t >= 1645 && !this.hasRan('calibrate')) {
            console.log('[Orchestrator] Signal Calibrator 가중치 보정 (월말)');
            await calibrateSignalWeights().catch(console.error);
            this.markRan('calibrate');
          }
        }
        break;
      }

      default:
        // PRE_MARKET, POST_MARKET, WEEKEND — 대기
        break;
    }
  }
}

/** 싱글턴 인스턴스 (server.ts에서 import하여 cron 연결) */
export const tradingOrchestrator = new TradingDayOrchestrator();
