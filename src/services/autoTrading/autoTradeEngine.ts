/**
 * autoTradeEngine.ts — 자동 매매 핵심 엔진
 *
 * firstPullbackDetector() — 돌파 후 첫 번째 눌림목 자동 포착 (아이디어 18 연동)
 *
 * 설계:
 *   1. 터틀 돌파 발생 → breakoutDetected = true 플래그 + breakoutPrice / breakoutVolume 기록
 *   2. 이후 주가가 돌파 기준선의 -3 ~ -5% 구간으로 후퇴하면서
 *      거래량이 돌파 일의 30% 이하로 감소하면 → 'BUY' 신호
 *   3. -7% 초과 하락 시 돌파 무효 → 'INVALIDATED'
 *   4. 돌파 기준선 하단 -1% 이탈 시 즉시 손절 → 'STOP_LOSS'
 */

/** 돌파 이벤트 발생 시 외부에서 설정하는 상태 객체 */
export interface BreakoutState {
  /** 돌파 감지 여부 */
  breakoutDetected: boolean;
  /** 돌파 기준선 가격 (돌파 캔들 종가 또는 기준선) */
  breakoutPrice: number;
  /** 돌파 당일 거래량 */
  breakoutVolume: number;
  /**
   * 눌림목 매수 진입 여부.
   * BUY 신호를 받아 실제 포지션을 진입했을 때 true 로 설정.
   * true: 포지션 보유 중 → 손절 감시 활성화
   * false(기본): 진입 대기 중 → BUY/INVALIDATED 신호 감시
   */
  inPosition: boolean;
}

export interface FirstPullbackInput {
  /** 현재가 */
  currentPrice: number;
  /** 현재 거래량 */
  currentVolume: number;
  /** 돌파 상태 (외부에서 주입) */
  state: BreakoutState;
}

export type FirstPullbackSignal = 'BUY' | 'STOP_LOSS' | 'INVALIDATED' | 'NONE';

export interface FirstPullbackResult {
  /** 생성된 신호 */
  signal: FirstPullbackSignal;
  /**
   * BUY 신호 시 권장 손절가 (돌파 기준선 -1%).
   * 신호가 BUY 가 아닌 경우에는 0.
   */
  stopLoss: number;
  /** 신호 판정 근거 */
  reason: string;
}

// ── 내부 상수 ──────────────────────────────────────────────────────────────────

/** 눌림목 매수 구간 하한 (%) */
const PULLBACK_BUY_MIN_PCT = -5;
/** 눌림목 매수 구간 상한 (%) */
const PULLBACK_BUY_MAX_PCT = -3;
/** 돌파 무효 기준 하락 폭 (%) */
const PULLBACK_INVALIDATE_PCT = -7;
/** 눌림목 거래량 임계비율 (돌파 당일 대비) */
const PULLBACK_VOLUME_RATIO_THRESHOLD = 0.30;
/** 손절 기준: 돌파 기준선 하단 (%) */
const STOP_LOSS_PCT = -0.01;

// ── firstPullbackDetector ──────────────────────────────────────────────────────

/**
 * 터틀 돌파(#18 조건) 이후 첫 번째 눌림목 매수 타이밍을 포착한다.
 *
 * 호출 방법:
 *   - 돌파 캔들 확인 시 state.breakoutDetected = true, breakoutPrice, breakoutVolume 설정
 *     (state.inPosition = false 로 초기화)
 *   - 이후 매 가격 업데이트(또는 종가)마다 firstPullbackDetector() 호출
 *   - 'BUY' 신호 수신 후 진입 완료 시 state.inPosition = true 로 전환
 *   - 'STOP_LOSS' / 'INVALIDATED' 수신 시 state.breakoutDetected = false 로 초기화
 *
 * @returns FirstPullbackResult — 신호 종류, 권장 손절가, 판정 근거
 */
export function firstPullbackDetector(input: FirstPullbackInput): FirstPullbackResult {
  const { currentPrice, currentVolume, state } = input;

  if (!state.breakoutDetected) {
    return { signal: 'NONE', stopLoss: 0, reason: '돌파 미감지 상태' };
  }

  const { breakoutPrice, breakoutVolume, inPosition } = state;

  if (breakoutPrice <= 0) {
    return { signal: 'NONE', stopLoss: 0, reason: '돌파 기준선 미설정' };
  }

  const pricePct = ((currentPrice - breakoutPrice) / breakoutPrice) * 100;
  const stopLossPrice = breakoutPrice * (1 + STOP_LOSS_PCT);

  // ── 포지션 보유 중: 손절 감시 ─────────────────────────────────────────────────
  if (inPosition) {
    if (currentPrice < stopLossPrice) {
      return {
        signal: 'STOP_LOSS',
        stopLoss: 0,
        reason: `돌파 기준선(${breakoutPrice.toLocaleString()}원) 하단 -1% 이탈 → 즉시 손절`,
      };
    }
    return { signal: 'NONE', stopLoss: 0, reason: `포지션 보유 중 — 관망 (${pricePct.toFixed(1)}%)` };
  }

  // ── 진입 대기 중: 눌림목/무효 감시 ───────────────────────────────────────────

  // 돌파 무효: -7% 이상 하락
  if (pricePct <= PULLBACK_INVALIDATE_PCT) {
    return {
      signal: 'INVALIDATED',
      stopLoss: 0,
      reason: `돌파 기준선 대비 ${pricePct.toFixed(1)}% 하락 — 돌파 무효 처리`,
    };
  }

  // 눌림목 매수: -3 ~ -5% 구간 + 거래량 30% 이하
  const inPullbackZone = pricePct >= PULLBACK_BUY_MIN_PCT && pricePct <= PULLBACK_BUY_MAX_PCT;
  if (inPullbackZone) {
    const volumeRatio = breakoutVolume > 0 ? currentVolume / breakoutVolume : Infinity;
    if (volumeRatio <= PULLBACK_VOLUME_RATIO_THRESHOLD) {
      return {
        signal: 'BUY',
        stopLoss: Math.round(stopLossPrice),
        reason: `눌림목 구간(${pricePct.toFixed(1)}%) + 거래량 ${(volumeRatio * 100).toFixed(0)}%(≤30%) — First Pullback 매수 신호`,
      };
    }
    return {
      signal: 'NONE',
      stopLoss: 0,
      reason: `눌림목 구간이나 거래량 미감소 (${(volumeRatio * 100).toFixed(0)}% > 30%)`,
    };
  }

  return { signal: 'NONE', stopLoss: 0, reason: `관망 구간 (${pricePct.toFixed(1)}%)` };
}
