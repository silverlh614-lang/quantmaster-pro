// server/clients/kisClient.ts
// KIS (한국투자증권) API 클라이언트 — 토큰 관리 · HTTP 헬퍼 · 주문 실행
// 기존 server/clients/kisClient.ts + src/server/clients/kisClient.ts 통합

import { sendTelegramAlert } from '../alerts/telegramClient.js';

export const KIS_IS_REAL = process.env.KIS_IS_REAL === 'true';
export const KIS_BASE    = KIS_IS_REAL
  ? 'https://openapi.koreainvestment.com:9443'
  : 'https://openapivts.koreainvestment.com:29443';
export const BUY_TR_ID   = KIS_IS_REAL ? 'TTTC0802U' : 'VTTC0802U';
export const SELL_TR_ID  = KIS_IS_REAL ? 'TTTC0801U' : 'VTTC0801U';
export const CCLD_TR_ID  = KIS_IS_REAL ? 'TTTC8001R' : 'VTTC8001R';

let cachedToken: { token: string; expiry: number } | null = null;

// ─── 실계좌 데이터 전용 클라이언트 설정 ───────────────────────────────────────
// 모의계좌 앱키 → 자동매매 주문 집행 (안전한 테스트)
// 실계좌 앱키   → 시장 데이터 조회만 (거래량 순위, 현재가, 투자자 수급 등)
// 주문은 모의계좌로, 데이터는 실계좌 키로 가져오는 하이브리드 구조

const REAL_DATA_BASE = 'https://openapi.koreainvestment.com:9443';

/** 실계좌 데이터 전용 키가 설정되어 있는지 여부 */
export const HAS_REAL_DATA_CLIENT =
  !!(process.env.KIS_REAL_DATA_APP_KEY && process.env.KIS_REAL_DATA_APP_SECRET);

let cachedRealDataToken: { token: string; expiry: number } | null = null;

// ─── 토큰 관리 ──────────────────────────────────────────────────────────────

/** KIS 기본 URL 반환 (기존 server/ 호환) */
export function getKisBase(): string { return KIS_BASE; }

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
  console.log('[KIS] 토큰 갱신 완료');
  return cachedToken.token;
}

/** refreshKisToken 호환 별칭 (기존 server/ 호환) */
export const getKisToken = refreshKisToken;

/** 토큰 만료까지 남은 시간(시간 단위). 토큰 미발급 시 0 반환 */
export function getKisTokenRemainingHours(): number {
  if (!cachedToken) return 0;
  return Math.floor((cachedToken.expiry - Date.now()) / 1000 / 60 / 60);
}

// ─── 실계좌 데이터 전용 토큰 관리 ────────────────────────────────────────────

/** 실계좌 데이터 전용 토큰 갱신. 실계좌 키 미설정 시 에러 */
async function refreshRealDataToken(): Promise<string> {
  if (cachedRealDataToken && Date.now() < cachedRealDataToken.expiry) return cachedRealDataToken.token;
  const res = await fetch(`${REAL_DATA_BASE}/oauth2/tokenP`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'client_credentials',
      appkey: process.env.KIS_REAL_DATA_APP_KEY,
      appsecret: process.env.KIS_REAL_DATA_APP_SECRET,
    }),
  });
  const data = await res.json() as { access_token?: string };
  if (!data.access_token) throw new Error(`KIS 실계좌 데이터 토큰 갱신 실패: ${JSON.stringify(data)}`);
  cachedRealDataToken = { token: data.access_token, expiry: Date.now() + 23 * 60 * 60 * 1000 };
  console.log('[KIS-RealData] 실계좌 데이터 전용 토큰 갱신 완료');
  return cachedRealDataToken.token;
}

/** 실계좌 데이터 전용 토큰 잔여 시간 */
export function getRealDataTokenRemainingHours(): number {
  if (!cachedRealDataToken) return 0;
  return Math.floor((cachedRealDataToken.expiry - Date.now()) / 1000 / 60 / 60);
}

// ─── HTTP 헬퍼 ──────────────────────────────────────────────────────────────

export async function kisGet(trId: string, apiPath: string, params: Record<string, string>) {
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

export async function kisPost(trId: string, apiPath: string, body: Record<string, string>) {
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

// ─── 실계좌 데이터 전용 HTTP 헬퍼 ────────────────────────────────────────────
// 시장 데이터(거래량 순위, 현재가, 투자자 수급 등) 조회 전용.
// 실계좌 키 미설정 시 모의계좌 kisGet으로 자동 폴백.

/**
 * 실계좌 데이터 전용 GET 요청.
 * KIS_REAL_DATA_APP_KEY 설정 시 실계좌 서버로, 미설정 시 기존 kisGet 폴백.
 */
export async function realDataKisGet(trId: string, apiPath: string, params: Record<string, string>) {
  if (_overrides.realDataKisGet) return _overrides.realDataKisGet(trId, apiPath, params);
  if (!HAS_REAL_DATA_CLIENT) return kisGet(trId, apiPath, params);

  const token = await refreshRealDataToken();
  const url = `${REAL_DATA_BASE}${apiPath}?${new URLSearchParams(params)}`;
  const res = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      appkey: process.env.KIS_REAL_DATA_APP_KEY!,
      appsecret: process.env.KIS_REAL_DATA_APP_SECRET!,
      tr_id: trId,
      custtype: 'P',
    },
  });
  const text = await res.text();
  if (!text.trim()) return null;
  try { return JSON.parse(text); } catch { return null; }
}

// ─── 현재가 조회 ────────────────────────────────────────────────────────────

// ─── 종목별 투자자 수급 조회 ─────────────────────────────────────────────────

export interface KisInvestorFlow {
  foreignNetBuy:      number;  // 외국인 당일 순매수량 (주)
  institutionalNetBuy: number; // 기관 당일 순매수량 (주)
  individualNetBuy:   number;  // 개인 당일 순매수량 (주)
  source: 'KIS_API';
}

// ─── Mock 오버라이드 시스템 ──────────────────────────────────────────────────
// VTS 모드에서 실 API 호출 없이 전체 파이프라인을 테스트할 수 있도록
// 데이터 조회 함수들을 오버라이드 가능하게 한다.
// 주문 함수(placeKisSellOrder 등)는 이미 Shadow 모드에서 실주문을 건너뛰므로 제외.

export interface KisClientOverrides {
  fetchCurrentPrice?: (code: string) => Promise<number | null>;
  fetchStockName?: (code: string) => Promise<string | null>;
  fetchAccountBalance?: () => Promise<number | null>;
  fetchKisInvestorFlow?: (code: string) => Promise<KisInvestorFlow | null>;
  realDataKisGet?: (trId: string, apiPath: string, params: Record<string, string>) => Promise<unknown>;
}

let _overrides: KisClientOverrides = {};

/**
 * KIS 클라이언트 데이터 조회 함수를 mock으로 교체한다.
 * VTS 모드에서 실 API 호출 없이 전체 파이프라인을 작동시키는 핵심.
 */
export function setKisClientOverrides(overrides: KisClientOverrides): void {
  _overrides = overrides;
  console.log(`[KIS] 클라이언트 오버라이드 설정 완료: ${Object.keys(overrides).join(', ')}`);
}

/** 현재 오버라이드 설정 여부 */
export function hasKisClientOverrides(): boolean {
  return Object.keys(_overrides).length > 0;
}

// ─── 데이터 조회 함수 (오버라이드 가능) ────────────────────────────────────────

/**
 * FHKST01010300 — 주식현재가 투자자별 순매수 조회.
 * KIS_APP_KEY 미설정 시 null 반환. 실계좌/VTS 모두 지원.
 */
export async function fetchKisInvestorFlow(code: string): Promise<KisInvestorFlow | null> {
  if (_overrides.fetchKisInvestorFlow) return _overrides.fetchKisInvestorFlow(code);
  if (!process.env.KIS_APP_KEY && !HAS_REAL_DATA_CLIENT) return null;
  try {
    const data = await realDataKisGet(
      'FHKST01010300',
      '/uapi/domestic-stock/v1/quotations/inquire-investor',
      {
        FID_COND_MRKT_DIV_CODE: 'J',
        FID_INPUT_ISCD: code.padStart(6, '0'),
      },
    );
    const out = (data as { output?: Record<string, string> } | null)?.output;
    if (!out) return null;
    return {
      foreignNetBuy:       parseInt(out.frgn_ntby_qty ?? '0', 10),
      institutionalNetBuy: parseInt(out.orgn_ntby_qty  ?? '0', 10),
      individualNetBuy:    parseInt(out.prsn_ntby_qty  ?? '0', 10),
      source: 'KIS_API',
    };
  } catch { return null; }
}

export async function fetchCurrentPrice(code: string): Promise<number | null> {
  if (_overrides.fetchCurrentPrice) return _overrides.fetchCurrentPrice(code);
  const data = await realDataKisGet('FHKST01010100', '/uapi/domestic-stock/v1/quotations/inquire-price', {
    FID_COND_MRKT_DIV_CODE: 'J',
    FID_INPUT_ISCD: code,
  });
  const price = parseInt(data?.output?.stck_prpr ?? '0', 10);
  return price > 0 ? price : null;
}

/**
 * KIS FHKST01010100 응답의 hts_kor_isnm 필드로 한국 종목명을 조회한다.
 * KIS 미설정 시 null 반환 — 호출자가 fallback 처리 필요.
 */
export async function fetchStockName(code: string): Promise<string | null> {
  if (_overrides.fetchStockName) return _overrides.fetchStockName(code);
  try {
    const data = await realDataKisGet('FHKST01010100', '/uapi/domestic-stock/v1/quotations/inquire-price', {
      FID_COND_MRKT_DIV_CODE: 'J',
      FID_INPUT_ISCD: code.padStart(6, '0'),
    });
    const name = (data as { output?: Record<string, string> } | null)?.output?.hts_kor_isnm?.trim();
    return name && name.length > 0 ? name : null;
  } catch { return null; }
}

// ─── 계좌 잔고 조회 ─────────────────────────────────────────────────────────

export async function fetchAccountBalance(): Promise<number | null> {
  if (_overrides.fetchAccountBalance) return _overrides.fetchAccountBalance();
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

// ─── 실제 KIS 매도 주문 ─────────────────────────────────────────────────────
/**
 * KIS 현금 시장가 매수 주문 (서버 자동매매 전용).
 *
 * @returns 주문번호(ODNO) 또는 null (Shadow 모드·오류 시)
 */
export async function placeKisMarketBuyOrder(
  stockCode: string,
  quantity: number,
): Promise<string | null> {
  const orderData = await kisPost(BUY_TR_ID, '/uapi/domestic-stock/v1/trading/order-cash', {
    CANO:            process.env.KIS_ACCOUNT_NO ?? '',
    ACNT_PRDT_CD:    process.env.KIS_ACCOUNT_PROD ?? '01',
    PDNO:            stockCode.padStart(6, '0'),
    ORD_DVSN:        '01',  // 시장가
    ORD_QTY:         quantity.toString(),
    ORD_UNPR:        '0',
    SLL_BUY_DVSN_CD: '02',
    CTAC_TLNO:       '',
    MGCO_APTM_ODNO:  '',
    ORD_SVR_DVSN_CD: '0',
  });
  return (orderData as { output?: { ODNO?: string } } | null)?.output?.ODNO ?? null;
}

export async function placeKisSellOrder(
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

// ─── OCO 손절 지정가 매도 (체결 즉시 자동 등록) ─────────────────────────────────
/**
 * 매수 체결 확인 후 호출 — 손절 지정가 매도를 KIS에 즉시 등록.
 * exitEngine 주기적 모니터링과 별개로, 거래소 레벨 안전망 역할.
 *
 * @returns 주문번호(ODNO) 또는 null (Shadow 모드·오류 시)
 */
export async function placeKisStopLossLimitOrder(
  stockCode: string,
  stockName: string,
  quantity: number,
  stopPrice: number,
): Promise<string | null> {
  // Shadow 모드: 실주문 없이 로그 + Telegram만
  if (!KIS_IS_REAL) {
    console.log(`[StopLoss OCO] 🛡️ ${stockName}(${stockCode}) 손절 지정가 ${stopPrice.toLocaleString()}원 × ${quantity}주 (Shadow 모드)`);
    await sendTelegramAlert(
      `🛡️ <b>[Shadow 손절 등록] ${stockName} (${stockCode})</b>\n` +
      `손절가: ${stopPrice.toLocaleString()}원 × ${quantity}주 | Shadow 모드 — 실주문 없음`
    ).catch(console.error);
    return null;
  }

  if (!process.env.KIS_APP_KEY) {
    console.warn(`[StopLoss OCO] KIS 미설정 — ${stockName} 손절 주문 건너뜀`);
    return null;
  }

  try {
    console.log(`[StopLoss OCO] 🛡️ ${stockName}(${stockCode}) 손절 지정가 등록 — ${stopPrice.toLocaleString()}원 × ${quantity}주`);

    const orderData = await kisPost(SELL_TR_ID, '/uapi/domestic-stock/v1/trading/order-cash', {
      CANO:            process.env.KIS_ACCOUNT_NO ?? '',
      ACNT_PRDT_CD:    process.env.KIS_ACCOUNT_PROD ?? '01',
      PDNO:            stockCode.padStart(6, '0'),
      ORD_DVSN:        '00',   // 지정가
      ORD_QTY:         quantity.toString(),
      ORD_UNPR:        stopPrice.toString(),
      SLL_BUY_DVSN_CD: '01',  // 01 = 매도
      CTAC_TLNO:       '',
      MGCO_APTM_ODNO:  '',
      ORD_SVR_DVSN_CD: '0',
    });

    const ordNo = (orderData as { output?: { ODNO?: string } } | null)?.output?.ODNO ?? null;
    console.log(`[StopLoss OCO] 🛡️ ${stockName} 손절 등록 완료 — ${stopPrice.toLocaleString()}원 ODNO: ${ordNo}`);

    await sendTelegramAlert(
      `🛡️ <b>[손절 주문 등록] ${stockName} (${stockCode})</b>\n` +
      `손절가: ${stopPrice.toLocaleString()}원 × ${quantity}주\n` +
      `주문번호: ${ordNo ?? 'N/A'}`
    ).catch(console.error);

    return ordNo;
  } catch (err: unknown) {
    console.error(`[StopLoss OCO] ${stockName} 손절 주문 실패:`, err instanceof Error ? err.message : err);
    await sendTelegramAlert(
      `🚨 <b>[긴급] ${stockName} 손절 주문 등록 실패!</b>\n` +
      `수동으로 손절 주문을 등록하세요!\n` +
      `오류: ${err instanceof Error ? err.message : String(err)}`
    ).catch(console.error);
    return null;
  }
}
