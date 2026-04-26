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
 *
 * ── Catalyst Timing Matrix ──────────────────────────────────────────────────
 * catalystTimingFilter() — 촉매제 유형별 최적 진입 타이밍 필터
 *
 * 기존 Gate 27(촉매제 분석)은 존재 여부만 확인한다.
 * 촉매제 유형에 따라 최적 매수 타이밍이 완전히 다르므로:
 *   ① 대형 수주 공시       → 공시 당일 갭상승 안정화 후 즉일 50% 진입
 *   ② 실적 서프라이즈     → 2~3거래일 조정 후 첫 양봉 진입
 *   ③ 애널리스트 목표가 상향 → 당일 오전 10시 이후 안정화 시 진입
 *   ④ 정책 수혜 발표       → 3~5거래일 눌림목 진입 (즉일 금지)
 *   ⑤ 외국인 대량 매수     → 당일 장마감 분석 후 익일 10시 재확인
 *
 * ── Sniper Entry ────────────────────────────────────────────────────────────
 * sniperEntryCheck() — 호가창 체결 강도 기반 마이크로 타이밍 레이어
 *
 * Gates를 모두 통과한 후, 실제 발주 직전 30초~2분 단위의 호가창 데이터로
 * '올바른 종목, 올바른 타이밍, 올바른 가격'의 마지막 체크포인트:
 *   - 매수호가 잔량 ÷ 매도호가 잔량 ≥ 1.5
 *   - 최근 5분간 체결이 매수 우세
 *   - 매도벽 두텁거나 대량 매도 체결 시 → 1분 지연 후 재판단
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
import { safePctChange } from '../../utils/safePctChange';

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

  // ADR-0028: stale breakoutPrice 시 0 fallback — 눌림목 매수 결정 보호.
  const pricePct = safePctChange(currentPrice, breakoutPrice, {
    label: 'autoTradeEngine.pricePct',
  }) ?? 0;
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

// ══════════════════════════════════════════════════════════════════════════════
// ── Catalyst Timing Matrix ──────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════════════

/** 촉매제 유형 — Gate 27(촉매제 분석)에서 세분화 */
export type CatalystType =
  | 'LARGE_ORDER'           // ① 대형 수주 공시
  | 'EARNINGS_SURPRISE'     // ② 실적 서프라이즈
  | 'TARGET_UPGRADE'        // ③ 애널리스트 목표가 상향
  | 'POLICY_BENEFIT'        // ④ 정책 수혜 발표
  | 'FOREIGN_BULK_BUY';     // ⑤ 외국인 갑작스러운 대량 매수

/** 촉매제 유형별 타이밍 규칙 */
export interface CatalystTimingRule {
  /** 촉매 발생 후 최소 대기 거래일 수 (0 = 즉일 가능) */
  minDelayDays: number;
  /** 촉매 발생 후 최대 대기 거래일 수 (이 기간 초과 시 촉매 효력 소멸) */
  maxDelayDays: number;
  /** 즉일 진입 시 최소 장 경과 시간 (분, KST 09:00 기준) — 0이면 장 시작 즉시 */
  minMarketMinutes: number;
  /** 즉일 진입 허용 비율 (0~1) — 0이면 즉일 진입 금지 */
  sameDayEntryRatio: number;
  /** 진입 조건 설명 */
  description: string;
}

/** 촉매제 유형별 타이밍 매트릭스 (상수 테이블) */
export const CATALYST_TIMING_MATRIX: Readonly<Record<CatalystType, CatalystTimingRule>> = {
  // ① 대형 수주 공시 → 갭상승 안정화 확인 후 즉일 50% 진입
  LARGE_ORDER: {
    minDelayDays: 0,
    maxDelayDays: 3,
    minMarketMinutes: 60,      // 장 시작 후 1시간 (10:00 KST)
    sameDayEntryRatio: 0.5,    // 즉일 50% 진입
    description: '공시 당일 장중 갭상승 안정화 확인 후 진입 (갭 메꿈 없이 유지 시 즉일 50%)',
  },
  // ② 실적 서프라이즈 → 2~3거래일 조정 후 첫 양봉에서 진입
  EARNINGS_SURPRISE: {
    minDelayDays: 2,
    maxDelayDays: 5,
    minMarketMinutes: 0,
    sameDayEntryRatio: 0,      // 즉일 진입 자제 (기관 차익실현 가능성)
    description: '실적 발표 후 2~3거래일 조정 후 첫 양봉에서 진입 (어닝 갭 즉일 진입 자제)',
  },
  // ③ 애널리스트 목표가 상향 → 당일 오전 10시 이후 안정화 시 진입
  TARGET_UPGRADE: {
    minDelayDays: 0,
    maxDelayDays: 2,
    minMarketMinutes: 60,      // 10:00 KST 이후
    sameDayEntryRatio: 1.0,    // 안정화 확인 시 전량 진입 가능
    description: '공시 당일 오전 10시 이후 안정화 시 진입 (뉴스 흥분 가라앉은 뒤 지지 확인)',
  },
  // ④ 정책 수혜 발표 → 3~5거래일 내 첫 번째 눌림목에서 진입
  POLICY_BENEFIT: {
    minDelayDays: 3,
    maxDelayDays: 7,
    minMarketMinutes: 0,
    sameDayEntryRatio: 0,      // 발표 즉일 진입 금지 (과열 가능성)
    description: '발표 즉일 진입 금지 — 3~5거래일 내 첫 번째 눌림목에서 진입',
  },
  // ⑤ 외국인 갑작스러운 대량 매수 → 익일 오전 10시 재확인
  FOREIGN_BULK_BUY: {
    minDelayDays: 1,
    maxDelayDays: 3,
    minMarketMinutes: 60,      // 익일 10:00 KST 이후
    sameDayEntryRatio: 0,      // 당일 진입 금지 — 장마감 체결 분석 필요
    description: '당일 장마감 체결 분석 후 익일 오전 10시 재확인 진입',
  },
};

/** catalystTimingFilter 입력 */
export interface CatalystTimingInput {
  /** 촉매제 유형 */
  catalystType: CatalystType;
  /** 촉매 발생 일자 (ISO 8601, e.g., "2026-04-10") */
  catalystDate: string;
  /** 현재 일자 (ISO 8601) — 테스트 주입용, 미지정 시 현재 시각 사용 */
  currentDate?: string;
  /** 현재 KST 시각의 장 시작(09:00) 이후 경과 분 — 미지정 시 현재 시각에서 계산 */
  marketMinutesSinceOpen?: number;
  /** 촉매 당일 시가 대비 현재가 변동률 (%, 양수 = 상승) — 갭 안정화 판단용 */
  gapChangePercent?: number;
  /** 촉매 발생 이후 첫 양봉 출현 여부 (실적 서프라이즈 진입 조건) */
  firstBullishCandleAppeared?: boolean;
  /** 촉매 발생 이후 눌림목 출현 여부 (정책 수혜 진입 조건) */
  pullbackAppeared?: boolean;
}

/** catalystTimingFilter 결과 */
export interface CatalystTimingResult {
  /** 진입 가능 여부 */
  canEnter: boolean;
  /** 진입 가능 시 허용 포지션 비율 (0~1) — canEnter=false이면 0 */
  entryRatio: number;
  /** 촉매 발생 이후 경과 거래일 수 */
  tradingDaysElapsed: number;
  /** 판정 근거 */
  reason: string;
  /** 적용된 타이밍 규칙 */
  rule: CatalystTimingRule;
}

/**
 * 두 날짜 사이의 거래일 수를 계산한다 (주말 제외, 공휴일 미반영).
 * startDate 자체는 포함하지 않고, endDate까지의 경과 거래일을 반환한다.
 */
export function countTradingDays(startDate: string, endDate: string): number {
  const start = new Date(startDate);
  const end = new Date(endDate);
  start.setHours(0, 0, 0, 0);
  end.setHours(0, 0, 0, 0);

  if (end <= start) return 0;

  let tradingDays = 0;
  const cursor = new Date(start);
  cursor.setDate(cursor.getDate() + 1); // startDate 다음날부터 카운트

  while (cursor <= end) {
    const dow = cursor.getDay();
    if (dow !== 0 && dow !== 6) {
      tradingDays++;
    }
    cursor.setDate(cursor.getDate() + 1);
  }

  return tradingDays;
}

/**
 * 현재 KST 시각의 장 시작(09:00) 이후 경과 분을 계산한다.
 * 장 시작 전이면 0을 반환한다.
 */
export function getMarketMinutesSinceOpen(): number {
  const now = new Date();
  const kstHour = (now.getUTCHours() + 9) % 24;
  const kstMinute = now.getUTCMinutes();
  const minutesSince9AM = (kstHour - 9) * 60 + kstMinute;
  return Math.max(0, minutesSince9AM);
}

/**
 * 촉매제 유형별 최적 진입 타이밍 필터.
 *
 * Gate 27(촉매제 분석) 통과 후, 촉매 유형에 따라 진입 지연/허용 판단을 한다.
 * 이 필터를 통과해야 실제 발주 프로세스로 넘어간다.
 */
export function catalystTimingFilter(input: CatalystTimingInput): CatalystTimingResult {
  const {
    catalystType,
    catalystDate,
    currentDate,
    marketMinutesSinceOpen: marketMinutes,
    gapChangePercent,
    firstBullishCandleAppeared,
    pullbackAppeared,
  } = input;

  const rule = CATALYST_TIMING_MATRIX[catalystType];
  const now = currentDate ?? new Date().toISOString().split('T')[0];
  const tradingDaysElapsed = countTradingDays(catalystDate, now);
  const currentMarketMinutes = marketMinutes ?? getMarketMinutesSinceOpen();

  const base = { tradingDaysElapsed, rule };

  // ── 촉매 효력 소멸: maxDelayDays 초과 ──────────────────────────────────────
  if (tradingDaysElapsed > rule.maxDelayDays) {
    return {
      ...base,
      canEnter: false,
      entryRatio: 0,
      reason: `촉매(${catalystType}) 효력 소멸 — ${tradingDaysElapsed}거래일 경과 (최대 ${rule.maxDelayDays}일)`,
    };
  }

  // ── 최소 대기일 미달 ────────────────────────────────────────────────────────
  if (tradingDaysElapsed < rule.minDelayDays) {
    // 즉일 진입이 허용된 유형이고 당일인 경우 (minDelayDays=0)
    // → 이 분기에는 도달하지 않음 (minDelayDays > 0인 유형만 여기 도착)
    return {
      ...base,
      canEnter: false,
      entryRatio: 0,
      reason: `촉매(${catalystType}) 대기 중 — ${tradingDaysElapsed}/${rule.minDelayDays}거래일 (${rule.description})`,
    };
  }

  // ── 장중 시간 필터 (minMarketMinutes) ───────────────────────────────────────
  if (currentMarketMinutes < rule.minMarketMinutes) {
    return {
      ...base,
      canEnter: false,
      entryRatio: 0,
      reason: `촉매(${catalystType}) 장 경과 대기 — ${currentMarketMinutes}분/${rule.minMarketMinutes}분 (10시 이후 안정화 확인 필요)`,
    };
  }

  // ── 유형별 추가 조건 검증 ───────────────────────────────────────────────────

  // ① 대형 수주: 갭 안정화 확인 — 갭상승이 유지되고 있는지 (양수이면 OK)
  if (catalystType === 'LARGE_ORDER' && tradingDaysElapsed === 0) {
    if (gapChangePercent !== undefined && gapChangePercent < 0) {
      return {
        ...base,
        canEnter: false,
        entryRatio: 0,
        reason: `대형 수주 공시 갭 메꿈 발생 (${gapChangePercent.toFixed(1)}%) — 즉일 진입 보류`,
      };
    }
    return {
      ...base,
      canEnter: true,
      entryRatio: rule.sameDayEntryRatio,
      reason: `대형 수주 공시 갭상승 유지 — 즉일 ${(rule.sameDayEntryRatio * 100).toFixed(0)}% 진입 허용`,
    };
  }

  // ② 실적 서프라이즈: 첫 양봉 출현 확인
  if (catalystType === 'EARNINGS_SURPRISE') {
    if (!firstBullishCandleAppeared) {
      return {
        ...base,
        canEnter: false,
        entryRatio: 0,
        reason: `실적 서프라이즈 ${tradingDaysElapsed}거래일 경과 — 첫 양봉 미출현 (조정 진행 중)`,
      };
    }
    return {
      ...base,
      canEnter: true,
      entryRatio: 1.0,
      reason: `실적 서프라이즈 ${tradingDaysElapsed}거래일 조정 후 첫 양봉 출현 — 진입 허용`,
    };
  }

  // ④ 정책 수혜: 눌림목 출현 확인
  if (catalystType === 'POLICY_BENEFIT') {
    if (!pullbackAppeared) {
      return {
        ...base,
        canEnter: false,
        entryRatio: 0,
        reason: `정책 수혜 ${tradingDaysElapsed}거래일 경과 — 눌림목 미출현 (과열 지속)`,
      };
    }
    return {
      ...base,
      canEnter: true,
      entryRatio: 1.0,
      reason: `정책 수혜 ${tradingDaysElapsed}거래일 후 눌림목 출현 — 진입 허용`,
    };
  }

  // ③ 목표가 상향: minMarketMinutes 통과 시 즉시 진입 가능
  // ⑤ 외국인 대량 매수: minDelayDays + minMarketMinutes 통과 시 진입 가능
  return {
    ...base,
    canEnter: true,
    entryRatio: tradingDaysElapsed === 0 ? rule.sameDayEntryRatio : 1.0,
    reason: `촉매(${catalystType}) ${tradingDaysElapsed}거래일 경과 — 타이밍 조건 충족, 진입 허용`,
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// ── Sniper Entry — 호가창 체결 강도 기반 마이크로 타이밍 ─────────────────────
// ══════════════════════════════════════════════════════════════════════════════

/** 호가 데이터 (KIS API 실시간 호가 기반) */
export interface OrderBookSnapshot {
  /** 매수호가 총 잔량 (상위 5호가 합산) */
  totalBidQty: number;
  /** 매도호가 총 잔량 (상위 5호가 합산) */
  totalAskQty: number;
  /** 최근 5분간 매수 체결 수량 */
  recentBuyVolume: number;
  /** 최근 5분간 매도 체결 수량 */
  recentSellVolume: number;
  /** 최근 1분간 대량 매도 체결 연속 발생 여부 */
  largeSellBurstDetected: boolean;
}

/** Sniper Entry 입력 */
export interface SniperEntryInput {
  /** 호가 스냅샷 */
  orderBook: OrderBookSnapshot;
  /** 재판단 횟수 (첫 판단=0, 1분 지연 후 재판단=1, ...) */
  retryCount?: number;
}

export type SniperDecision = 'FIRE' | 'DELAY' | 'ABORT';

/** Sniper Entry 결과 */
export interface SniperEntryResult {
  /** 발주 결정 */
  decision: SniperDecision;
  /** 매수벽/매도벽 비율 (bidQty / askQty) */
  bidAskRatio: number;
  /** 최근 5분 체결 강도 (buyVol / sellVol) — 1 초과 = 매수 우세 */
  executionStrength: number;
  /** 판정 근거 */
  reason: string;
}

// ── Sniper 내부 상수 ─────────────────────────────────────────────────────────

/** 매수벽/매도벽 최소 비율 — 이상이어야 발주 */
const SNIPER_BID_ASK_RATIO_THRESHOLD = 1.5;
/** 체결 강도 최소값 — 매수 우세 확인 */
const SNIPER_EXECUTION_STRENGTH_THRESHOLD = 1.0;
/** 최대 재판단 횟수 — 초과 시 ABORT */
const SNIPER_MAX_RETRIES = 3;

/**
 * 호가창 체결 강도 기반 마이크로 타이밍 판단.
 *
 * Gates를 모두 통과하고, catalystTimingFilter도 통과한 후,
 * 실제 발주 직전에 호가창 상태를 확인하는 마지막 체크포인트다.
 *
 * - 매수벽/매도벽 ≥ 1.5 + 5분 체결 매수 우세 → FIRE (즉시 발주)
 * - 매도벽 우세 또는 대량 매도 연속 → DELAY (1분 후 재판단)
 * - 3회 재판단 후에도 조건 미충족 → ABORT (발주 취소, 다음 기회 대기)
 */
export function sniperEntryCheck(input: SniperEntryInput): SniperEntryResult {
  const { orderBook, retryCount = 0 } = input;
  const { totalBidQty, totalAskQty, recentBuyVolume, recentSellVolume, largeSellBurstDetected } = orderBook;

  // 매수/매도 잔량 비율
  const bidAskRatio = totalAskQty > 0
    ? totalBidQty / totalAskQty
    : (totalBidQty > 0 ? Infinity : 0);

  // 체결 강도 (매수 체결 ÷ 매도 체결)
  const executionStrength = recentSellVolume > 0
    ? recentBuyVolume / recentSellVolume
    : (recentBuyVolume > 0 ? Infinity : 0);

  const base = { bidAskRatio: parseFloat(bidAskRatio.toFixed(2)), executionStrength: parseFloat(executionStrength.toFixed(2)) };

  // ── 최대 재판단 초과 → ABORT ───────────────────────────────────────────────
  if (retryCount >= SNIPER_MAX_RETRIES) {
    return {
      ...base,
      decision: 'ABORT',
      reason: `Sniper 재판단 ${retryCount}회 초과 (최대 ${SNIPER_MAX_RETRIES}회) — 발주 취소, 다음 기회 대기`,
    };
  }

  // ── 대량 매도 연속 감지 → 즉시 DELAY ──────────────────────────────────────
  if (largeSellBurstDetected) {
    return {
      ...base,
      decision: 'DELAY',
      reason: `대량 매도 체결 연속 감지 — 1분 지연 후 재판단 (${retryCount + 1}/${SNIPER_MAX_RETRIES}회)`,
    };
  }

  // ── 매도벽 우세 (bidAskRatio < 1.5) → DELAY ──────────────────────────────
  if (bidAskRatio < SNIPER_BID_ASK_RATIO_THRESHOLD) {
    return {
      ...base,
      decision: 'DELAY',
      reason: `매수벽/매도벽 비율 ${bidAskRatio.toFixed(2)} < ${SNIPER_BID_ASK_RATIO_THRESHOLD} — 1분 지연 후 재판단 (${retryCount + 1}/${SNIPER_MAX_RETRIES}회)`,
    };
  }

  // ── 체결 강도 매도 우세 → DELAY ───────────────────────────────────────────
  if (executionStrength < SNIPER_EXECUTION_STRENGTH_THRESHOLD) {
    return {
      ...base,
      decision: 'DELAY',
      reason: `5분 체결 강도 ${executionStrength.toFixed(2)} < ${SNIPER_EXECUTION_STRENGTH_THRESHOLD} (매도 우세) — 1분 지연 후 재판단 (${retryCount + 1}/${SNIPER_MAX_RETRIES}회)`,
    };
  }

  // ── 모든 조건 충족 → FIRE ─────────────────────────────────────────────────
  return {
    ...base,
    decision: 'FIRE',
    reason: `Sniper 조건 충족 — 매수벽/매도벽 ${bidAskRatio.toFixed(2)}(≥${SNIPER_BID_ASK_RATIO_THRESHOLD}) + 체결강도 ${executionStrength.toFixed(2)}(≥${SNIPER_EXECUTION_STRENGTH_THRESHOLD}) → 즉시 발주`,
  };
}
