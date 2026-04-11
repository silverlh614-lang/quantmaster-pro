/**
 * autoTrading.ts — 클라이언트사이드 수동 트리거 전용
 *
 * ⚠️  역할 분리: 이 모듈은 UI에서 사용자가 직접 트리거하는 수동 매매 전용입니다.
 *     24시간 자동매매는 서버사이드 autoTradeEngine.ts가 단독으로 담당합니다.
 *     서버 자동매매(AUTO_TRADE_ENABLED=true)가 활성화되면
 *     이 모듈의 실주문 함수는 중복 방지를 위해 실행을 차단합니다.
 *
 * 제공 기능 (수동 전용):
 * - Shadow Trading 모드 (가상 시뮬레이션) — buildShadowTrade, resolveShadowTrade
 * - 슬리피지 측정 & 보정 Kelly — measureSlippage, adjustedKelly
 * - Gate별 수익 귀인 분석 — runAttributionAnalysis
 *
 * 수동 실주문 (서버 자동매매 OFF일 때만 작동):
 * - Kelly% → KIS 주문 변환 — convertSignalToOrder
 * - KIS 매수/매도 주문 — placeKISOrder
 * - OCO 자동 등록 — registerOCOAfterFill
 * - 장중 타임 필터 + 주문 큐 — placeKISOrderWithFilter
 * - 분할매수 트랜치 플랜 — executeTranchePlan
 */

import type {
  EvaluationResult,
  KISOrderParams,
  ShadowTrade,
  FilledOrder,
  PendingOrder,
  SlippageRecord,
  ConditionId,
} from '../types/quant';
import type { Gate0Result } from '../types/core';
import type { MacroEnvironment } from '../types/macro';

// ─── 상시 가동 안전장치 상수 ───────────────────────────────────────────────────

/** 하루 -3% 손실 초과 시 당일 신규 매수 전면 중단 */
export const DAILY_MAX_LOSS_RATE = -0.03;

/** 동시 보유 최대 종목 수 — 초과 시 신규 매수 신호 무시 */
export const MAX_POSITIONS = 6;

// ─── 공통 KIS 프록시 헬퍼 ──────────────────────────────────────────────────────

interface KISProxyRequest {
  path: string;
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: Record<string, string>;
  params?: Record<string, string>;
}

async function kisProxy(req: KISProxyRequest): Promise<Record<string, unknown>> {
  const res = await fetch('/api/kis/proxy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  });
  if (!res.ok) throw new Error(`KIS 프록시 오류: ${res.status}`);
  return res.json();
}

// 모의(VTS) vs 실계좌 TR ID 선택
const isReal = () => import.meta.env.VITE_KIS_IS_REAL === 'true';
const BUY_TR  = () => (isReal() ? 'TTTC0802U' : 'VTTC0802U');
const SELL_TR = () => (isReal() ? 'TTTC0801U' : 'VTTC0801U');

/**
 * 서버 자동매매가 활성화되어 있으면 true.
 * true일 때 클라이언트 실주문은 중복 방지를 위해 차단됩니다.
 */
function isServerAutoTradeActive(): boolean {
  return import.meta.env.VITE_AUTO_TRADE_ENABLED === 'true';
}

// ─── 아이디어 4: 신호-주문 변환 ────────────────────────────────────────────────

/**
 * EvaluationResult + 현재가 + 총자산 → KIS 주문 파라미터
 *
 * - STRONG_BUY → 시장가(01), 즉시 체결 우선 (Gate 3 라스트 트리거 개념)
 * - BUY        → 지정가(00), 현재가에 안전 진입
 */
export function convertSignalToOrder(
  signal: EvaluationResult,
  currentPrice: number,
  totalAssets: number,
  stockCode: string
): KISOrderParams {
  const kellyFraction = signal.positionSize / 100;
  const investAmount = totalAssets * kellyFraction;
  const quantity = Math.floor(investAmount / currentPrice);

  const isStrongBuy =
    signal.recommendation === '풀 포지션' || signal.lastTrigger;

  return {
    PDNO: stockCode.padStart(6, '0'),
    ORD_DVSN: isStrongBuy ? '01' : '00',           // 시장가 vs 지정가
    ORD_QTY: quantity.toString(),
    ORD_UNPR: isStrongBuy ? '0' : currentPrice.toString(),
  };
}

/**
 * KIS 현금 매수 주문 실행 (수동 트리거 전용)
 *
 * 서버 자동매매(AUTO_TRADE_ENABLED)가 켜져 있으면 중복 주문 방지를 위해 차단됩니다.
 * @returns KIS 응답 (ORD_NO 등 포함)
 * @throws 서버 자동매매 활성 시 Error
 */
export async function placeKISOrder(
  params: KISOrderParams
): Promise<Record<string, unknown>> {
  if (isServerAutoTradeActive()) {
    throw new Error(
      '[중복 방지] 서버 자동매매(AUTO_TRADE_ENABLED=true)가 활성 상태입니다. ' +
      '클라이언트 실주문은 차단됩니다. 주문은 서버 autoTradeEngine이 단독 실행합니다.'
    );
  }
  const data = await kisProxy({
    path: '/uapi/domestic-stock/v1/trading/order-cash',
    method: 'POST',
    headers: { tr_id: BUY_TR() },
    body: {
      ...params,
      CANO: import.meta.env.VITE_KIS_ACCOUNT_NO ?? '',        // 계좌번호 앞 8자리
      ACNT_PRDT_CD: import.meta.env.VITE_KIS_ACCOUNT_PROD ?? '01', // 상품코드
      SLL_BUY_DVSN_CD: '02',  // 02=매수
      CTAC_TLNO: '',
      MGCO_APTM_ODNO: '',
      ORD_SVR_DVSN_CD: '0',
    } as Record<string, string>,
  });
  console.log('[KIS 매수 체결]', params.PDNO, `${params.ORD_QTY}주 @`, params.ORD_UNPR || '시장가');
  return data;
}

// ─── 아이디어 5: Shadow Trading ────────────────────────────────────────────────

const SLIPPAGE = 0.003; // 0.3% 슬리피지 가정

/**
 * 실제 주문 없이 Shadow Trade 기록 생성
 *
 * 2~4주간 신호를 축적 → STRONG_BUY 적중률/슬리피지를 데이터로 검증.
 * 충분한 데이터가 쌓이면 placeKISOrder()로 전환.
 */
export function buildShadowTrade(
  signal: EvaluationResult,
  stockCode: string,
  stockName: string,
  currentPrice: number,
  totalAssets: number
): ShadowTrade {
  const kellyFraction = signal.positionSize / 100;
  const shadowEntryPrice = Math.round(currentPrice * (1 + SLIPPAGE));
  const quantity = Math.floor((totalAssets * kellyFraction) / shadowEntryPrice);

  return {
    id: `shadow_${Date.now()}_${stockCode}`,
    signalTime: new Date().toISOString(),
    stockCode,
    stockName,
    signalPrice: currentPrice,
    shadowEntryPrice,
    quantity,
    kellyFraction,
    // profile.stopLoss는 퍼센트값(-15 → -15%). 없으면 -8% 기본값 사용
    stopLoss: signal.profile?.stopLoss != null
      ? Math.round(shadowEntryPrice * (1 + signal.profile.stopLoss / 100))
      : Math.round(shadowEntryPrice * 0.92),
    // profile에 targetPrice 없음 → RRR 기반 계산
    targetPrice: Math.round(shadowEntryPrice * (1 + signal.rrr * 0.08)),
    status: 'PENDING',
  };
}

/**
 * 현재가로 ACTIVE 상태인 Shadow Trade의 결과를 갱신
 * useShadowTradeStore.updateShadowTrade()와 함께 사용
 */
export function resolveShadowTrade(
  trade: ShadowTrade,
  currentPrice: number
): Partial<ShadowTrade> {
  // PENDING → ACTIVE: 최소 1사이클(4분) 유예 후 전환
  if (trade.status === 'PENDING') {
    const ageMs = Date.now() - new Date(trade.signalTime).getTime();
    if (ageMs < 4 * 60 * 1000) return {};
    return { status: 'ACTIVE' };
  }
  if (trade.status !== 'ACTIVE') return {};

  if (currentPrice >= trade.targetPrice) {
    // 현재가로 체결 (목표가보다 높을 수 있음)
    const returnPct = parseFloat(
      (((currentPrice - trade.shadowEntryPrice) / trade.shadowEntryPrice) * 100).toFixed(2)
    );
    return { status: 'HIT_TARGET', exitPrice: currentPrice, exitTime: new Date().toISOString(), returnPct };
  }
  if (currentPrice <= trade.stopLoss) {
    // 현재가로 체결 (갭다운 시 손절가보다 낮을 수 있음)
    const returnPct = parseFloat(
      (((currentPrice - trade.shadowEntryPrice) / trade.shadowEntryPrice) * 100).toFixed(2)
    );
    return { status: 'HIT_STOP', exitPrice: currentPrice, exitTime: new Date().toISOString(), returnPct };
  }
  return {};
}

// ─── 아이디어 6: OCO 자동 등록 ─────────────────────────────────────────────────

/**
 * 매수 체결 확인 즉시 호출 — 손절 지정가 매도 + 목표가 지정가 매도를 동시 등록.
 *
 * KIS VTS는 네이티브 OCO 미지원 → 지정가 매도 2건으로 구현.
 * 먼저 체결되는 쪽이 이기면, 남은 주문은 수동 취소 필요 (향후 웹소켓 모니터링으로 자동화 가능).
 */
export async function registerOCOAfterFill(trade: FilledOrder): Promise<{
  stopLossOrder: Record<string, unknown>;
  targetOrder: Record<string, unknown>;
}> {
  const stopLossPct = trade.stopLossPct ?? 0.08;
  const stopLossPrice = Math.floor(trade.executedPrice * (1 - stopLossPct));
  const targetPrice   = Math.ceil(trade.executedPrice * (1 + trade.rrr * stopLossPct));

  const commonBody = {
    CANO: import.meta.env.VITE_KIS_ACCOUNT_NO ?? '',
    ACNT_PRDT_CD: import.meta.env.VITE_KIS_ACCOUNT_PROD ?? '01',
    PDNO: trade.stockCode.padStart(6, '0'),
    SLL_BUY_DVSN_CD: '01',  // 01=매도
    ORD_QTY: trade.quantity.toString(),
    CTAC_TLNO: '',
    MGCO_APTM_ODNO: '',
    ORD_SVR_DVSN_CD: '0',
    ORD_DVSN: '00',          // 지정가
  } as Record<string, string>;

  console.log(
    `[OCO 등록] ${trade.stockName} — 손절: ${stopLossPrice.toLocaleString()}원 / 목표: ${targetPrice.toLocaleString()}원`
  );

  const [stopLossOrder, targetOrder] = await Promise.all([
    kisProxy({
      path: '/uapi/domestic-stock/v1/trading/order-cash',
      method: 'POST',
      headers: { tr_id: SELL_TR() },
      body: { ...commonBody, ORD_UNPR: stopLossPrice.toString() },
    }),
    kisProxy({
      path: '/uapi/domestic-stock/v1/trading/order-cash',
      method: 'POST',
      headers: { tr_id: SELL_TR() },
      body: { ...commonBody, ORD_UNPR: targetPrice.toString() },
    }),
  ]);

  return { stopLossOrder, targetOrder };
}

// ─── 아이디어 2: 체결 확인 루프 (Fill Confirmation Loop) ───────────────────────

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** KIS 체결 내역 조회 → 체결/미체결 수량 반환 */
async function checkOrderStatus(orderId: string): Promise<{ filled: number; total: number }> {
  const today = new Date().toISOString().split('T')[0].replace(/-/g, '');
  const data = await kisProxy({
    path: '/uapi/domestic-stock/v1/trading/inquire-daily-ccld',
    method: 'GET',
    headers: { tr_id: isReal() ? 'TTTC8001R' : 'VTTC8001R' },
    params: {
      CANO: import.meta.env.VITE_KIS_ACCOUNT_NO ?? '',
      ACNT_PRDT_CD: import.meta.env.VITE_KIS_ACCOUNT_PROD ?? '01',
      INQR_STRT_DT: today,
      INQR_END_DT: today,
      SLL_BUY_DVSN_CD: '00',
      INQR_DVSN: '00',
      PDNO: '',
      CCLD_DVSN: '00',
      ORD_GNO_BRNO: '',
      ODNO: orderId,
      INQR_DVSN_3: '00',
      INQR_DVSN_1: '',
      CTX_AREA_FK100: '',
      CTX_AREA_NK100: '',
    },
  });
  const record = (data.output1 as any[])?.[0];
  if (!record) return { filled: 0, total: 0 };
  return {
    filled: parseInt(record.tot_ccld_qty ?? '0', 10),
    total:  parseInt(record.ord_qty       ?? '0', 10),
  };
}

/** 미체결 주문 취소 */
async function cancelOrder(orderId: string, stockCode: string, originalQty: string): Promise<void> {
  await kisProxy({
    path: '/uapi/domestic-stock/v1/trading/order-rvsecncl',
    method: 'POST',
    headers: { tr_id: isReal() ? 'TTTC0803U' : 'VTTC0803U' },
    body: {
      CANO: import.meta.env.VITE_KIS_ACCOUNT_NO ?? '',
      ACNT_PRDT_CD: import.meta.env.VITE_KIS_ACCOUNT_PROD ?? '01',
      KRX_FWDG_ORD_ORGNO: '',
      ORGN_ODNO: orderId,
      ORD_DVSN: '00',
      RVSE_CNCL_DVSN_CD: '02', // 02=취소
      ORD_QTY: originalQty,
      ORD_UNPR: '0',
      QTY_ALL_ORD_YN: 'Y',
      PDNO: stockCode,
    } as Record<string, string>,
  });
  console.log(`[KIS 주문 취소] ODNO: ${orderId}`);
}

/**
 * 주문 실행 + 체결 확인 폴링 (아이디어 2)
 *
 * 1. 주문 전송 → ODNO 수신
 * 2. 3초 간격으로 체결 수량 폴링 (최대 maxWaitSeconds)
 * 3. 완전 체결 → 'FILLED' + OCO 자동 등록
 * 4. 타임아웃 → 잔량 취소 → 'TIMEOUT'
 */
export async function placeAndConfirmOrder(
  params: KISOrderParams,
  stockName: string,
  rrr: number,
  maxWaitSeconds = 30,
): Promise<'FILLED' | 'PARTIAL' | 'REJECTED' | 'TIMEOUT'> {
  const orderResult = await placeKISOrder(params);
  const orderId = (orderResult as any)?.output?.ODNO as string | undefined;

  if (!orderId) {
    console.error('[체결확인] ODNO 없음 — 주문 거부 또는 오류:', orderResult);
    return 'REJECTED';
  }

  console.log(`[체결확인] 주문 접수 ODNO: ${orderId} — 폴링 시작 (최대 ${maxWaitSeconds}s)`);

  const polls = Math.floor(maxWaitSeconds / 3);
  let lastFilled = 0;

  for (let i = 0; i < polls; i++) {
    await sleep(3000);
    const { filled, total } = await checkOrderStatus(orderId);
    lastFilled = filled;

    if (total > 0 && filled >= total) {
      console.log(`[체결확인] ✅ 완전 체결 ${filled}/${total}주 — OCO 등록 시작`);
      // 체결 직후 손절/목표가 OCO 등록 (아이디어 6)
      await registerOCOAfterFill({
        stockCode: params.PDNO,
        stockName,
        executedPrice: parseInt(params.ORD_UNPR || '0', 10) || 0,
        quantity: filled,
        rrr,
      }).catch((e) => console.error('[OCO 등록 실패]', e));
      return 'FILLED';
    }
    if (filled > 0) {
      console.log(`[체결확인] 부분 체결 중 ${filled}/${total}주 ...`);
    }
  }

  // 타임아웃 — 잔량 취소
  if (lastFilled === 0) {
    await cancelOrder(orderId, params.PDNO, params.ORD_QTY).catch(console.error);
    console.warn(`[체결확인] ⏱ 타임아웃 — 주문 취소 완료`);
    return 'TIMEOUT';
  }

  // 부분 체결 상태에서 타임아웃
  console.warn(`[체결확인] ⚠ 부분 체결(${lastFilled}주) 후 타임아웃`);
  return 'PARTIAL';
}

// ─── 상시 가동 안전장치 ────────────────────────────────────────────────────────

/**
 * 일일 손실 한도 초과 여부 확인.
 * @param todayPnLRate 당일 손익률 (예: -0.035 = -3.5%)
 * @returns true = 한도 초과 → 당일 신규 매수 차단
 */
export function isDailyLossLimitReached(todayPnLRate: number): boolean {
  return todayPnLRate <= DAILY_MAX_LOSS_RATE;
}

/**
 * 최대 보유 종목 수 초과 여부 확인.
 * @param currentPositionCount 현재 보유 종목 수
 * @returns true = 상한 초과 → 신규 매수 차단
 */
export function isMaxPositionsReached(currentPositionCount: number): boolean {
  return currentPositionCount >= MAX_POSITIONS;
}

/**
 * 매수 전 종합 안전 체크.
 * 세 가지 조건 중 하나라도 걸리면 매수를 차단한다.
 *
 * @returns { blocked: true, reason } 또는 { blocked: false }
 */
export function checkTradeSafety(opts: {
  todayPnLRate: number;
  currentPositionCount: number;
  mhs: number;
}): { blocked: boolean; reason?: string } {
  if (opts.mhs < 30) {
    return { blocked: true, reason: `DEFENSE 모드 (MHS ${opts.mhs} < 30). 신규 매수 중단.` };
  }
  if (isDailyLossLimitReached(opts.todayPnLRate)) {
    return {
      blocked: true,
      reason: `일일 손실 한도 도달 (${(opts.todayPnLRate * 100).toFixed(2)}% ≤ ${DAILY_MAX_LOSS_RATE * 100}%). 당일 매수 중단.`,
    };
  }
  if (isMaxPositionsReached(opts.currentPositionCount)) {
    return {
      blocked: true,
      reason: `최대 보유 종목 수 도달 (${opts.currentPositionCount}/${MAX_POSITIONS}). 신규 매수 차단.`,
    };
  }
  return { blocked: false };
}

// ─── 아이디어 7: 장중 타임 필터 + 주문 큐 ──────────────────────────────────────

/** 한국 장 최적 매수 시간대 여부 확인 (KST 10:00~11:30, 13:00~14:00) */
export function isValidTradingWindow(): boolean {
  const now = new Date();
  const kstHour   = (now.getUTCHours() + 9) % 24;
  const kstMinute = now.getUTCMinutes();
  const kstTime   = kstHour * 100 + kstMinute;

  return (kstTime >= 1000 && kstTime <= 1130) ||
         (kstTime >= 1300 && kstTime <= 1400);
}

/** 세션 내 미실행 주문 큐 (메모리, 앱 새로고침 시 초기화) */
const pendingOrderQueue: PendingOrder[] = [];

export function getPendingOrders(): PendingOrder[] {
  return [...pendingOrderQueue];
}

export function removePendingOrder(id: string): void {
  const idx = pendingOrderQueue.findIndex((o) => o.id === id);
  if (idx !== -1) pendingOrderQueue.splice(idx, 1);
}

/**
 * 타임 필터 적용 매수 주문
 * - 유효 시간대면 즉시 실행
 * - 비유효 시간대면 큐에 보관 → { status: 'QUEUED' } 반환
 */
export async function placeKISOrderWithFilter(
  params: KISOrderParams,
  stockName: string
): Promise<{ status: 'EXECUTED' | 'QUEUED'; data?: Record<string, unknown>; reason?: string }> {
  if (!isValidTradingWindow()) {
    const pending: PendingOrder = {
      id: `pending_${Date.now()}_${params.PDNO}`,
      params,
      stockName,
      queuedAt: new Date().toISOString(),
      reason: '장중 타임 필터 - 유효 시간대(10:00~11:30, 13:00~14:00) 대기 중',
    };
    pendingOrderQueue.push(pending);
    console.warn(`[타임 필터] ${stockName} 주문 큐 등록 (${pending.reason})`);
    return { status: 'QUEUED', reason: pending.reason };
  }

  const data = await placeKISOrder(params);
  return { status: 'EXECUTED', data };
}

/**
 * 큐에 대기 중인 주문을 현재 타임 필터 상태로 일괄 처리
 * 호출 위치: 앱 포커스 복귀 or 주기적 폴링
 */
export async function flushPendingOrders(): Promise<void> {
  if (!isValidTradingWindow() || pendingOrderQueue.length === 0) return;

  const toProcess = [...pendingOrderQueue];
  pendingOrderQueue.length = 0;

  for (const order of toProcess) {
    try {
      await placeKISOrder(order.params);
      console.log(`[큐 처리 완료] ${order.stockName}`);
    } catch (e: unknown) {
      console.error(`[큐 처리 실패] ${order.stockName}:`, e instanceof Error ? e.message : e);
      pendingOrderQueue.push(order); // 실패 시 재큐
    }
  }
}

// ─── 아이디어 8: 슬리피지 측정 & 보정 Kelly ────────────────────────────────────

/**
 * 신호가와 실제 체결가를 비교해 SlippageRecord 생성
 * → useSlippageStore.addRecord()에 전달해 영속
 */
export function measureSlippage(
  stockCode: string,
  theoreticalPrice: number,
  executedPrice: number,
  orderType: 'MARKET' | 'LIMIT',
  volume: number
): SlippageRecord {
  const slippagePct = (executedPrice - theoreticalPrice) / theoreticalPrice;
  return {
    id: `slip_${Date.now()}_${stockCode}`,
    stockCode,
    signalTime: new Date().toISOString(),
    theoreticalPrice,
    executedPrice,
    slippagePct,
    orderType,
    volume,
  };
}

export function calculateAverageSlippage(records: SlippageRecord[]): number {
  if (records.length === 0) return 0;
  return records.reduce((sum, r) => sum + r.slippagePct, 0) / records.length;
}

/**
 * 슬리피지를 반영한 실효 Kelly 분수
 * @param winRate  과거 승률 (0~1)
 * @param rrr      Risk-Reward Ratio
 * @param avgSlippage  평균 슬리피지 (calculateAverageSlippage 반환값)
 */
export function adjustedKelly(
  winRate: number,
  rrr: number,
  avgSlippage: number
): number {
  const effectiveWinRate = winRate * (1 - Math.abs(avgSlippage));
  return Math.max(0, (effectiveWinRate * rrr - (1 - effectiveWinRate)) / rrr);
}

// ─── 아이디어 11: 분할매수 트랜치 플랜 자동 실행 ────────────────────────────────

/**
 * 피보나치 38.2% 눌림목 지지선 계산
 * 고점(entryPrice)과 저점(stopLoss) 사이에서 38.2% 눌림목 위치 반환
 */
export function calculateFibSupport(entryPrice: number, stopLoss: number): number {
  return Math.round(entryPrice - (entryPrice - stopLoss) * 0.382);
}

interface ConditionalOrder {
  id: string;
  stockCode: string;
  stockName: string;
  type: 'SUPPORT' | 'BREAKOUT';  // 눌림목 vs 돌파
  triggerPrice: number;
  investAmount: number;           // 투자금액 (원)
  registeredAt: string;
  executed: boolean;
}

/** 세션 내 조건부 주문 큐 (메모리) */
const conditionalOrderQueue: ConditionalOrder[] = [];

export function getConditionalOrders(): ConditionalOrder[] {
  return conditionalOrderQueue.filter((o) => !o.executed);
}

/**
 * 현재가로 조건부 주문 트리거 확인 → 조건 충족 시 즉시 시장가 매수
 * App 레벨에서 가격 업데이트마다 호출
 */
export async function checkConditionalOrders(
  stockCode: string,
  currentPrice: number
): Promise<void> {
  const pending = conditionalOrderQueue.filter(
    (o) => o.stockCode === stockCode && !o.executed
  );

  for (const order of pending) {
    const triggered =
      (order.type === 'SUPPORT'   && currentPrice <= order.triggerPrice) ||
      (order.type === 'BREAKOUT'  && currentPrice >= order.triggerPrice);

    if (!triggered) continue;

    order.executed = true;
    const qty = Math.floor(order.investAmount / currentPrice);
    if (qty < 1) {
      console.warn(`[트랜치] ${order.stockName} 수량 부족 (${qty}주) — 건너뜀`);
      continue;
    }

    const label = order.type === 'SUPPORT' ? '2차 눌림목' : '3차 브레이크아웃';
    console.log(
      `[트랜치 ${label}] ${order.stockName} @${currentPrice.toLocaleString()}원 ${qty}주 시장가 매수`
    );

    await placeKISOrder({
      PDNO: stockCode.padStart(6, '0'),
      ORD_DVSN: '01',             // 시장가
      ORD_QTY: qty.toString(),
      ORD_UNPR: '0',
    }).catch((e) => console.error(`[트랜치] ${order.stockName} 주문 실패:`, e));
  }
}

/**
 * 트랜치 플랜 자동 실행
 *
 * - 1차 (tranche1.size %): 즉시 시장가 매수
 * - 2차 (tranche2.size %): 피보나치 38.2% 눌림목 대기 → checkConditionalOrders() 트리거
 * - 3차 (tranche3.size %): 현재가 +3% 돌파 모멘텀 → checkConditionalOrders() 트리거
 *
 * tranchePlan이 없으면 단일 주문으로 폴백
 */
export async function executeTranchePlan(
  signal: EvaluationResult,
  currentPrice: number,
  totalAssets: number,
  stockCode: string,
  stockName: string
): Promise<void> {
  if (!signal.tranchePlan) {
    // 트랜치 없음 → 단일 주문 (기존 방식)
    const params = convertSignalToOrder(signal, currentPrice, totalAssets, stockCode);
    await placeKISOrder(params);
    return;
  }

  const { tranche1, tranche2, tranche3 } = signal.tranchePlan;

  // 손절가 (절대가): stopLoss %가 있으면 변환, 없으면 -8% 기본
  const stopLossAbs = signal.profile?.stopLoss != null
    ? Math.round(currentPrice * (1 + signal.profile.stopLoss / 100))
    : Math.round(currentPrice * 0.92);

  // ── 1차: 즉시 매수 (tranche1.size %) ───────────────────────────────────────
  const t1Amount = totalAssets * (tranche1.size / 100);
  const t1Qty    = Math.floor(t1Amount / currentPrice);

  if (t1Qty >= 1) {
    console.log(
      `[트랜치 1차] ${stockName} — ${t1Qty}주 즉시 매수 @${currentPrice.toLocaleString()}원 ` +
      `(${tranche1.size}% / ${t1Amount.toLocaleString()}원)`
    );
    await placeKISOrder({
      PDNO: stockCode.padStart(6, '0'),
      ORD_DVSN: '01',
      ORD_QTY: t1Qty.toString(),
      ORD_UNPR: '0',
    });
  }

  // ── 2차: 피보나치 38.2% 눌림목 대기 (tranche2.size %) ─────────────────────
  const fibSupport    = calculateFibSupport(currentPrice, stopLossAbs);
  const t2Amount      = totalAssets * (tranche2.size / 100);
  conditionalOrderQueue.push({
    id:           `t2_${Date.now()}_${stockCode}`,
    stockCode,
    stockName,
    type:         'SUPPORT',
    triggerPrice: fibSupport,
    investAmount: t2Amount,
    registeredAt: new Date().toISOString(),
    executed:     false,
  });
  console.log(
    `[트랜치 2차] ${stockName} — Fib38.2% 눌림목 대기 ` +
    `@${fibSupport.toLocaleString()}원 (${tranche2.size}% / ${t2Amount.toLocaleString()}원)`
  );

  // ── 3차: +3% 돌파 모멘텀 추격 (tranche3.size %) ───────────────────────────
  const breakoutPrice = Math.round(currentPrice * 1.03);
  const t3Amount      = totalAssets * (tranche3.size / 100);
  conditionalOrderQueue.push({
    id:           `t3_${Date.now()}_${stockCode}`,
    stockCode,
    stockName,
    type:         'BREAKOUT',
    triggerPrice: breakoutPrice,
    investAmount: t3Amount,
    registeredAt: new Date().toISOString(),
    executed:     false,
  });
  console.log(
    `[트랜치 3차] ${stockName} — +3% 브레이크아웃 대기 ` +
    `@${breakoutPrice.toLocaleString()}원 (${tranche3.size}% / ${t3Amount.toLocaleString()}원)`
  );

  console.log(
    `[트랜치 플랜 완료] ${stockName} — ` +
    `1차 즉시:${tranche1.size}% / 2차 Fib눌림목:${tranche2.size}% @${fibSupport.toLocaleString()} / ` +
    `3차 브레이크:${tranche3.size}% @${breakoutPrice.toLocaleString()}`
  );
}

// ─── 아이디어 9: Gate별 수익 귀인 분석 ─────────────────────────────────────────

/**
 * 거래 종료 시 호출 — 27조건 점수 × 수익/손실 결과를 귀인 스토어에 누적
 *
 * @param conditionScores  TradeRecord.conditionScores 스냅샷
 * @param pnlPct           수익률 (양수=WIN, 음수=LOSS)
 * @param accumulate       useAttributionStore.accumulate
 */
export function runAttributionAnalysis(
  conditionScores: Record<ConditionId, number>,
  pnlPct: number,
  accumulate: (scores: Record<ConditionId, number>, isWin: boolean) => void
): void {
  const isWin = pnlPct > 0;
  accumulate(conditionScores, isWin);
  console.log(
    `[귀인 분석] ${isWin ? '✅ WIN' : '❌ LOSS'} (${pnlPct.toFixed(2)}%) — ${Object.keys(conditionScores).length}개 조건 누적`
  );
}

// ─── 레짐 파이프라인 동기화 ──────────────────────────────────────────────────────

/**
 * Gate 0 평가 완료 후 서버 MacroState에 동기화.
 *
 * 프론트엔드가 Gemini에서 얻은 vkospi, vix, usdKrw와 Gate 0 MHS를 서버에 전달.
 * 서버 /macro/refresh(cron)는 KOSPI MA·SPX·DXY·FSS를 별도로 채운다.
 * 두 경로가 MERGE 저장되므로 어느 쪽이 먼저 실행되어도 덮어쓰지 않는다.
 *
 * @param macro Gemini가 반환한 MacroEnvironment
 * @param g0    evaluateGate0() 결과
 */
export async function syncGate0ToServer(
  macro: MacroEnvironment,
  g0: Gate0Result,
): Promise<void> {
  const mhsTrend: 'IMPROVING' | 'STABLE' | 'DETERIORATING' =
    macro.mhsTrend ?? 'STABLE';

  const payload: Record<string, unknown> = {
    mhs:    g0.macroHealthScore,
    // Gemini 정량 필드
    vkospi: macro.vkospi,
    vix:    macro.vix,
    usdKrw: macro.usdKrw,
    oeciCliKorea:     macro.oeciCliKorea,
    exportGrowth3mAvg: macro.exportGrowth3mAvg,
    mhsTrend,
    vkospiRising:         macro.vkospiRising,
    foreignFuturesSellDays: macro.foreignFuturesSellDays,
    dxyBullish:           macro.dxyBullish,
    kospiBelow120ma:      macro.kospiBelow120ma,
    samsungIriDelta:      macro.samsungIriDelta,
    // VKOSPI 파생 — 클라이언트 Yahoo Finance → 서버 MacroState 전송
    vkospiDayChange:      macro.vkospiDayChange,
    vkospi5dTrend:        macro.vkospi5dTrend,
  };

  try {
    await fetch('/api/auto-trade/macro/state', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    console.warn('[MacroSync] 서버 동기화 실패 (비치명적):', err);
  }
}
