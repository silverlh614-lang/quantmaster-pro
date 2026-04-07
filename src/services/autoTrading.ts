/**
 * autoTrading.ts — 신호-주문 자동 변환 엔진
 *
 * 아이디어 4: Kelly% → 실제 KIS 주문 수량 변환
 * 아이디어 5: Shadow Trading 모드 (가상 시뮬레이션)
 * 아이디어 6: OCO 자동 등록 (매수 체결 즉시 손절/목표가 주문)
 * 아이디어 7: 장중 타임 필터 + 주문 큐
 * 아이디어 8: 슬리피지 측정 & 보정 Kelly
 * 아이디어 9: Gate별 수익 귀인 분석
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
 * KIS 현금 매수 주문 실행
 * @returns KIS 응답 (ORD_NO 등 포함)
 */
export async function placeKISOrder(
  params: KISOrderParams
): Promise<Record<string, unknown>> {
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
  // PENDING → ACTIVE: 다음 tick에 체결 진입으로 간주
  if (trade.status === 'PENDING') return { status: 'ACTIVE' };
  if (trade.status !== 'ACTIVE') return {};

  if (currentPrice >= trade.targetPrice) {
    const returnPct = parseFloat(
      (((trade.targetPrice - trade.shadowEntryPrice) / trade.shadowEntryPrice) * 100).toFixed(2)
    );
    return { status: 'HIT_TARGET', exitPrice: trade.targetPrice, exitTime: new Date().toISOString(), returnPct };
  }
  if (currentPrice <= trade.stopLoss) {
    const returnPct = parseFloat(
      (((trade.stopLoss - trade.shadowEntryPrice) / trade.shadowEntryPrice) * 100).toFixed(2)
    );
    return { status: 'HIT_STOP', exitPrice: trade.stopLoss, exitTime: new Date().toISOString(), returnPct };
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
