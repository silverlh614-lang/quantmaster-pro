/**
 * @responsibility ADR-0452 — Shadow Entry Liveness for Near-Breakout Candidates SSOT.
 *
 * shadowNearBreakoutEntryPolicy.ts (ADR-0452)
 * ===========================================
 *
 * 한 줄 정의 (사용자 §"한 줄 정의" — 절대 변경 금지):
 *   "ADR-0452 는 Live 매수 조건은 그대로 유지하되, near-breakout 후보가 Live 에서는
 *    WAIT 이더라도 Shadow 에서는 가상 진입을 생성하여 학습을 지속하게 만드는 패치다."
 *
 * 사용자 핵심 의도 (사용자 §2 — 절대 변경 금지):
 *   - Live 매수 조건 완화 금지.
 *   - Shadow 매수만 near-breakout 후보에 별도 liveness lane 개방.
 *   - executionImpact 반드시 NONE.
 *   - 실제 KIS 주문 / paper 주문 / approval queue 와 절대 연결 금지.
 *
 * 본 SSOT 는 *결정 트리만* — Shadow trade 영속은 호출자 (buyListLoop) 가 buildBuyTrade +
 * shadowTradeRepo 로 처리. 본 SSOT 는 외부 의존성 0 (순수 함수).
 *
 * **절대 불변식 (literal type 강제)**:
 *   - createLiveOrder: false (literal type)
 *   - createPaperOrder: false (literal type)
 *   - executionImpact: 'NONE' (literal type)
 *   - learningTag: 'SHADOW_NEAR_BREAKOUT_ENTRY' (literal type)
 *   TypeScript 컴파일 타임 강제로 호출자 측 invariant 위반 시 즉시 fail.
 */

/* ───────── 5-value cause union (사용자 §4 정합 — 절대 변경 금지) ───────── */

type ShadowNearBreakoutEntryCause =
  | 'NEAR_ENTRY_PRICE'
  | 'RETRY_ELIGIBLE_WAIT'
  | 'LIVE_WAIT_BUT_SHADOW_OBSERVABLE'
  | 'GATE_RECHECK_SOFT_FAIL'
  | 'UNKNOWN';

/* ───────── 9-value blockReason union (사용자 §4 정합 — 절대 변경 금지) ───────── */

export type ShadowNearBreakoutBlockReason =
  | 'RISK_BLOCKED'
  | 'ENTRY_PRICE_NOT_REACHED'
  | 'REPEATED_WAIT_COOLDOWN'
  | 'BREAKOUT_MOMENTUM_GAP'
  | 'VOLUME_SURGE_GAP'
  | 'PULLBACK_NOT_CONFIRMED'
  | 'DATA_UNAVAILABLE_PER_EARNINGS_SUPPLY'
  | 'SECTOR_DATA_DEGRADED'
  | 'SIZING_BLOCKED'
  | 'PRICE_TOO_FAR'
  | 'VOLUME_TOO_WEAK'
  | 'QUOTE_STALE'
  | 'DUPLICATE_SHADOW_ENTRY'
  | 'DAILY_CAP_REACHED'
  | 'LIVE_ALREADY_ENTERED'
  | 'NOT_SHADOW_MODE'
  | 'UNKNOWN';

/* ───────── 7-value preBreakoutState union (ADR-0449 정합) ───────── */

type PreBreakoutWaitStateName =
  | 'WAIT_RETRY_ELIGIBLE'
  | 'WAIT_PRICE_TOO_FAR'
  | 'WAIT_VOLUME_WEAK'
  | 'WAIT_GATE_RECHECK_FAILED'
  | 'WAIT_COOLDOWN'
  | 'WAIT_SHADOW_ONLY'
  | 'WAIT_REJECTED';

/* ───────── Input schema (사용자 §4 정합) ───────── */

export interface ShadowNearBreakoutEntryInput {
  symbol: string;
  name?: string;
  currentPrice: number;
  entryPrice: number;
  stopLoss?: number;
  targetPrice?: number;
  priceDistancePct?: number;
  gate1Passed?: boolean;
  liveGateScore?: number;
  conditionsPassed?: number;
  recheckPassed?: boolean;
  volumeRatio?: number;
  preBreakoutState?: PreBreakoutWaitStateName;
  shadowMode: boolean;
  riskBlocked?: boolean;
  quoteStale?: boolean;
  alreadyHasOpenShadow?: boolean;
  alreadyEnteredToday?: boolean;
  dailyCreatedCount?: number;
  /** ADR-P0-8 diagnostic-only fallback reasons, never used to allow live execution. */
  unavailableConditions?: readonly string[];
  thresholdNotMetConditions?: readonly string[];
  sizingBlocked?: boolean;
}

/* ───────── Decision schema (사용자 §4 정합 — literal type 강제) ───────── */

export interface ShadowNearBreakoutEntryDecision {
  allowed: boolean;
  cause?: ShadowNearBreakoutEntryCause;
  blockReason?: ShadowNearBreakoutBlockReason;
  /** 절대 불변식 — 실제 주문 영향 항상 NONE (literal type, TypeScript 컴파일 타임 강제) */
  executionImpact: 'NONE';
  createShadowTrade: boolean;
  /** 절대 불변식 — Live 주문 절대 생성 금지 (literal type) */
  createLiveOrder: false;
  /** 절대 불변식 — Paper 주문 절대 생성 금지 (literal type) */
  createPaperOrder: false;
  /** 절대 불변식 — 학습 tag SSOT (literal type) */
  learningTag: 'SHADOW_NEAR_BREAKOUT_ENTRY';
  operatorMessage: string;
  allBlockReasons?: ShadowNearBreakoutBlockReason[];
}


function uniqueReasons(reasons: ShadowNearBreakoutBlockReason[]): ShadowNearBreakoutBlockReason[] {
  return Array.from(new Set(reasons));
}

function deriveShadowNearBreakoutBlockReasons(input: ShadowNearBreakoutEntryInput): ShadowNearBreakoutBlockReason[] {
  const reasons: ShadowNearBreakoutBlockReason[] = [];
  if (input.sizingBlocked) reasons.push('SIZING_BLOCKED');
  if (input.quoteStale) reasons.push('SECTOR_DATA_DEGRADED');
  const unavailable = input.unavailableConditions ?? [];
  if (unavailable.some((c) => ['per', 'earnings_quality', 'supply_confluence'].includes(c))) {
    reasons.push('DATA_UNAVAILABLE_PER_EARNINGS_SUPPLY');
  }
  const threshold = input.thresholdNotMetConditions ?? [];
  if (threshold.includes('breakout_momentum') || threshold.includes('trend_acceleration') || threshold.includes('turtle_high')) reasons.push('BREAKOUT_MOMENTUM_GAP');
  if (threshold.includes('volume_surge') || threshold.includes('volume_breakout')) reasons.push('VOLUME_SURGE_GAP');
  if (threshold.includes('pullback') || threshold.includes('vcp')) reasons.push('PULLBACK_NOT_CONFIRMED');
  if (input.preBreakoutState === 'WAIT_COOLDOWN') reasons.push('REPEATED_WAIT_COOLDOWN');
  if (input.preBreakoutState === 'WAIT_RETRY_ELIGIBLE') reasons.push('ENTRY_PRICE_NOT_REACHED');
  if (input.preBreakoutState === 'WAIT_PRICE_TOO_FAR') reasons.push('PRICE_TOO_FAR');
  if (input.preBreakoutState === 'WAIT_VOLUME_WEAK') reasons.push('VOLUME_TOO_WEAK');
  if (input.preBreakoutState === 'WAIT_GATE_RECHECK_FAILED') reasons.push('BREAKOUT_MOMENTUM_GAP');
  return uniqueReasons(reasons.length > 0 ? reasons : ['ENTRY_PRICE_NOT_REACHED']);
}

/* ───────── 정책 임계 SSOT (사용자 §5 정합 — 절대 변경 금지) ───────── */

export const SHADOW_NEAR_BREAKOUT_ENTRY_POLICY = Object.freeze({
  /** near-breakout: |currentPrice - entryPrice| / entryPrice 가 1.5% 이내 */
  MAX_DISTANCE_PCT: 1.5,
  /** soft near-breakout: 2.0% 이내 (Gate recheck soft fail 케이스만) */
  SOFT_DISTANCE_PCT: 2.0,
  /** 최소 Gate Score — Live 진입 임계 (10) 보다 낮음, Shadow 학습 가치 임계 */
  MIN_LIVE_GATE_SCORE: 5.0,
  /** 27조건 중 최소 통과 수 */
  MIN_CONDITIONS_PASSED: 5,
  /** 거래량 비율 최소치 (volumeRatio = 당일 / 20일 평균) */
  MIN_VOLUME_RATIO: 0.25,
  /** 일일 Shadow near-breakout entry 최대 생성 수 */
  DAILY_CAP: 3,
} as const);

/* ───────── ENV gate SSOT (ADR-0157 정확 비교) ───────── */

/**
 * ENV `SHADOW_NEAR_BREAKOUT_ENTRY_DISABLED=true` (default OFF).
 *
 * 활성 시 본 SSOT 의 모든 결정이 `allowed=false` 로 강제 — Shadow near-breakout entry
 * 생성 미작동, ADR-0449 기존 WAIT 만 유지.
 */
export function isShadowNearBreakoutEntryDisabled(): boolean {
  return process.env.SHADOW_NEAR_BREAKOUT_ENTRY_DISABLED === 'true';
}

/* ───────── 결정 트리 SSOT (사용자 §5 정합 — 절대 변경 금지) ───────── */

/**
 * Live WAIT 후보 중 near-breakout 학습 가치가 큰 후보를 Shadow 가상 진입으로 기록할지 결정.
 *
 * **사용자 §3 핵심 원칙 (절대 변경 금지)**:
 *   - Live 주문 조건 절대 변경 안 함.
 *   - executionImpact: NONE (literal type 강제).
 *   - 실제 KIS / Paper / approval queue 연결 금지.
 *   - 별도 ledger 또는 shadowTradeRepo SHADOW 경로에만 기록.
 *
 * 우선순위 (위에서 아래 첫 매칭):
 *   1. ENV DISABLED → blocked
 *   2. !shadowMode → NOT_SHADOW_MODE
 *   3. riskBlocked → RISK_BLOCKED
 *   4. quoteStale → QUOTE_STALE
 *   5. alreadyHasOpenShadow OR alreadyEnteredToday → DUPLICATE_SHADOW_ENTRY
 *   6. dailyCreatedCount >= DAILY_CAP → DAILY_CAP_REACHED
 *   7. preBreakoutState !== WAIT_RETRY_ELIGIBLE 분기:
 *      - WAIT_REJECTED → RISK_BLOCKED (HARD_RISK_BLOCK 정합)
 *      - WAIT_SHADOW_ONLY → 보조 분기 (soft distance 검증)
 *      - 그 외 (PRICE_TOO_FAR / VOLUME_WEAK / GATE_RECHECK_FAILED / COOLDOWN)
 *        → 각각 PRICE_TOO_FAR / VOLUME_TOO_WEAK / UNKNOWN
 *   8. WAIT_RETRY_ELIGIBLE + 기본 임계 통과 → NEAR_ENTRY_PRICE allowed
 *   9. soft distance + recheckPassed=false → GATE_RECHECK_SOFT_FAIL allowed
 *   10. 그 외 → UNKNOWN blocked
 */
export function evaluateShadowNearBreakoutEntry(
  input: ShadowNearBreakoutEntryInput,
): ShadowNearBreakoutEntryDecision {
  // (1) ENV DISABLED — Shadow entry 생성 미작동.
  if (isShadowNearBreakoutEntryDisabled()) {
    return {
      allowed: false,
      blockReason: 'UNKNOWN',
      executionImpact: 'NONE',
      createShadowTrade: false,
      createLiveOrder: false,
      createPaperOrder: false,
      learningTag: 'SHADOW_NEAR_BREAKOUT_ENTRY',
      operatorMessage: 'ENV SHADOW_NEAR_BREAKOUT_ENTRY_DISABLED=true (긴급 rollback)',
    };
  }

  // (2) shadowMode 가 아니면 즉시 차단 — Live 모드에서는 본 정책 자체 적용 안 함.
  if (!input.shadowMode) {
    return {
      allowed: false,
      blockReason: 'NOT_SHADOW_MODE',
      executionImpact: 'NONE',
      createShadowTrade: false,
      createLiveOrder: false,
      createPaperOrder: false,
      learningTag: 'SHADOW_NEAR_BREAKOUT_ENTRY',
      operatorMessage: 'Live 모드 — Shadow near-breakout entry 적용 안 함 (Live 매수 조건 무관)',
    };
  }

  // (3) riskBlocked — HARD_RISK_BLOCK 위반 시 학습조차 불허.
  if (input.riskBlocked === true) {
    return {
      allowed: false,
      blockReason: 'RISK_BLOCKED',
      executionImpact: 'NONE',
      createShadowTrade: false,
      createLiveOrder: false,
      createPaperOrder: false,
      learningTag: 'SHADOW_NEAR_BREAKOUT_ENTRY',
      operatorMessage: `${input.symbol} riskBlocked — Shadow entry 차단`,
    };
  }

  // (4) quoteStale — 가격 데이터 불신 시점 Shadow entry 의미 없음.
  if (input.quoteStale === true) {
    return {
      allowed: false,
      blockReason: 'QUOTE_STALE',
      executionImpact: 'NONE',
      createShadowTrade: false,
      createLiveOrder: false,
      createPaperOrder: false,
      learningTag: 'SHADOW_NEAR_BREAKOUT_ENTRY',
      operatorMessage: `${input.symbol} quote stale — Shadow entry 차단`,
    };
  }

  // (5) 중복 차단 — 이미 동일 종목 open shadow 또는 오늘 진입 기록 있음.
  if (input.alreadyHasOpenShadow === true || input.alreadyEnteredToday === true) {
    return {
      allowed: false,
      blockReason: 'DUPLICATE_SHADOW_ENTRY',
      executionImpact: 'NONE',
      createShadowTrade: false,
      createLiveOrder: false,
      createPaperOrder: false,
      learningTag: 'SHADOW_NEAR_BREAKOUT_ENTRY',
      operatorMessage: `${input.symbol} 중복 Shadow entry — 차단`,
    };
  }

  // (6) 일일 cap 도달.
  const dailyCount = input.dailyCreatedCount ?? 0;
  if (dailyCount >= SHADOW_NEAR_BREAKOUT_ENTRY_POLICY.DAILY_CAP) {
    return {
      allowed: false,
      blockReason: 'DAILY_CAP_REACHED',
      executionImpact: 'NONE',
      createShadowTrade: false,
      createLiveOrder: false,
      createPaperOrder: false,
      learningTag: 'SHADOW_NEAR_BREAKOUT_ENTRY',
      operatorMessage: `일일 Shadow near-breakout entry cap (${SHADOW_NEAR_BREAKOUT_ENTRY_POLICY.DAILY_CAP}) 도달`,
    };
  }

  // (7) preBreakoutState 분기.
  const state = input.preBreakoutState;
  const distance = input.priceDistancePct ?? Number.POSITIVE_INFINITY;
  const gate1Passed = input.gate1Passed === true;
  const liveGateScore = input.liveGateScore ?? 0;
  const conditionsPassed = input.conditionsPassed ?? 0;
  const volumeRatio = input.volumeRatio ?? 0;
  const recheckPassed = input.recheckPassed;
  const diagnosticReasons = deriveShadowNearBreakoutBlockReasons(input);

  if (state === 'WAIT_REJECTED') {
    return {
      allowed: false,
      blockReason: 'RISK_BLOCKED',
      executionImpact: 'NONE',
      createShadowTrade: false,
      createLiveOrder: false,
      createPaperOrder: false,
      learningTag: 'SHADOW_NEAR_BREAKOUT_ENTRY',
      operatorMessage: `${input.symbol} WAIT_REJECTED (riskBlocked) — Shadow entry 차단`,
    };
  }

  if (state === 'WAIT_PRICE_TOO_FAR') {
    return {
      allowed: false,
      blockReason: 'PRICE_TOO_FAR',
      executionImpact: 'NONE',
      createShadowTrade: false,
      createLiveOrder: false,
      createPaperOrder: false,
      learningTag: 'SHADOW_NEAR_BREAKOUT_ENTRY',
      operatorMessage: `${input.symbol} WAIT_PRICE_TOO_FAR (distance ${distance.toFixed(1)}%) — Shadow entry 차단`,
    };
  }

  if (state === 'WAIT_VOLUME_WEAK') {
    return {
      allowed: false,
      blockReason: 'VOLUME_TOO_WEAK',
      executionImpact: 'NONE',
      createShadowTrade: false,
      createLiveOrder: false,
      createPaperOrder: false,
      learningTag: 'SHADOW_NEAR_BREAKOUT_ENTRY',
      operatorMessage: `${input.symbol} WAIT_VOLUME_WEAK — Shadow entry 차단`,
    };
  }

  if (state === 'WAIT_COOLDOWN' || state === 'WAIT_GATE_RECHECK_FAILED') {
    // soft distance + recheckPassed=false 분기 (사용자 §5 두 번째 allowed 분기).
    if (
      distance <= SHADOW_NEAR_BREAKOUT_ENTRY_POLICY.SOFT_DISTANCE_PCT &&
      gate1Passed &&
      conditionsPassed >= SHADOW_NEAR_BREAKOUT_ENTRY_POLICY.MIN_CONDITIONS_PASSED &&
      recheckPassed === false
    ) {
      return {
        allowed: true,
        cause: 'GATE_RECHECK_SOFT_FAIL',
        executionImpact: 'NONE',
        createShadowTrade: true,
        createLiveOrder: false,
        createPaperOrder: false,
        learningTag: 'SHADOW_NEAR_BREAKOUT_ENTRY',
        operatorMessage: `${input.symbol} GATE_RECHECK_SOFT_FAIL (distance ${distance.toFixed(1)}%) — Shadow entry 허용`,
      };
    }
    return {
      allowed: false,
      blockReason: diagnosticReasons[0] ?? 'REPEATED_WAIT_COOLDOWN',
      allBlockReasons: diagnosticReasons,
      executionImpact: 'NONE',
      createShadowTrade: false,
      createLiveOrder: false,
      createPaperOrder: false,
      learningTag: 'SHADOW_NEAR_BREAKOUT_ENTRY',
      operatorMessage: `${input.symbol} ${state} — Shadow entry 차단 (${diagnosticReasons.join('/')})`,
    };
  }

  // (8) WAIT_RETRY_ELIGIBLE 또는 WAIT_SHADOW_ONLY — 핵심 분기.
  if (state === 'WAIT_RETRY_ELIGIBLE' || state === 'WAIT_SHADOW_ONLY') {
    // 기본 임계 통과 — NEAR_ENTRY_PRICE allowed.
    if (
      distance <= SHADOW_NEAR_BREAKOUT_ENTRY_POLICY.MAX_DISTANCE_PCT &&
      gate1Passed &&
      liveGateScore >= SHADOW_NEAR_BREAKOUT_ENTRY_POLICY.MIN_LIVE_GATE_SCORE &&
      conditionsPassed >= SHADOW_NEAR_BREAKOUT_ENTRY_POLICY.MIN_CONDITIONS_PASSED &&
      volumeRatio >= SHADOW_NEAR_BREAKOUT_ENTRY_POLICY.MIN_VOLUME_RATIO
    ) {
      const cause: ShadowNearBreakoutEntryCause =
        state === 'WAIT_SHADOW_ONLY' ? 'LIVE_WAIT_BUT_SHADOW_OBSERVABLE' : 'NEAR_ENTRY_PRICE';
      return {
        allowed: true,
        cause,
        executionImpact: 'NONE',
        createShadowTrade: true,
        createLiveOrder: false,
        createPaperOrder: false,
        learningTag: 'SHADOW_NEAR_BREAKOUT_ENTRY',
        operatorMessage: `${input.symbol} ${cause} (distance ${distance.toFixed(1)}%, gate ${liveGateScore.toFixed(1)}, vol ${volumeRatio.toFixed(2)}) — Shadow entry 허용`,
      };
    }

    // soft distance + recheckPassed=false 분기 (보조).
    if (
      distance <= SHADOW_NEAR_BREAKOUT_ENTRY_POLICY.SOFT_DISTANCE_PCT &&
      gate1Passed &&
      conditionsPassed >= SHADOW_NEAR_BREAKOUT_ENTRY_POLICY.MIN_CONDITIONS_PASSED &&
      recheckPassed === false
    ) {
      return {
        allowed: true,
        cause: 'GATE_RECHECK_SOFT_FAIL',
        executionImpact: 'NONE',
        createShadowTrade: true,
        createLiveOrder: false,
        createPaperOrder: false,
        learningTag: 'SHADOW_NEAR_BREAKOUT_ENTRY',
        operatorMessage: `${input.symbol} GATE_RECHECK_SOFT_FAIL (distance ${distance.toFixed(1)}%) — Shadow entry 허용`,
      };
    }

    // 임계 미달 — block reason 분류.
    let blockReason: ShadowNearBreakoutBlockReason = diagnosticReasons[0] ?? 'ENTRY_PRICE_NOT_REACHED';
    if (distance > SHADOW_NEAR_BREAKOUT_ENTRY_POLICY.SOFT_DISTANCE_PCT) {
      blockReason = 'PRICE_TOO_FAR';
    } else if (volumeRatio < SHADOW_NEAR_BREAKOUT_ENTRY_POLICY.MIN_VOLUME_RATIO) {
      blockReason = 'VOLUME_TOO_WEAK';
    } else if (!gate1Passed || liveGateScore < SHADOW_NEAR_BREAKOUT_ENTRY_POLICY.MIN_LIVE_GATE_SCORE) {
      blockReason = 'BREAKOUT_MOMENTUM_GAP';
    }
    return {
      allowed: false,
      blockReason,
      allBlockReasons: uniqueReasons([blockReason, ...diagnosticReasons]),
      executionImpact: 'NONE',
      createShadowTrade: false,
      createLiveOrder: false,
      createPaperOrder: false,
      learningTag: 'SHADOW_NEAR_BREAKOUT_ENTRY',
      operatorMessage: `${input.symbol} ${state} 임계 미달 (gate1=${gate1Passed} score=${liveGateScore.toFixed(1)} cond=${conditionsPassed} vol=${volumeRatio.toFixed(2)}) — Shadow entry 차단`,
    };
  }

  // (9) preBreakoutState 미상 — 보수 fallback.
  return {
    allowed: false,
    blockReason: diagnosticReasons[0] ?? 'ENTRY_PRICE_NOT_REACHED',
    allBlockReasons: diagnosticReasons,
    executionImpact: 'NONE',
    createShadowTrade: false,
    createLiveOrder: false,
    createPaperOrder: false,
    learningTag: 'SHADOW_NEAR_BREAKOUT_ENTRY',
    operatorMessage: `${input.symbol} preBreakoutState 미상 — Shadow entry 차단`,
  };
}

/* ───────── /scan_blockers compact section SSOT (사용자 §9 정합) ───────── */

export interface ShadowNearBreakoutScanCounters {
  created: number;
  blocked: number;
  blockReasons: Partial<Record<ShadowNearBreakoutBlockReason, number>>;
}

/**
 * `/scan_blockers` 메시지에 자동 첨부되는 ADR-0452 compact section.
 *
 * **Telegram HTML raw 태그 금지** (사용자 §9 — plain text 우선).
 *
 * 분기:
 *   - counters 부재 또는 created+blocked=0 → null (잡음 차단).
 *   - 그 외 → "🌘 Shadow Near-Breakout (ADR-0452)" + 3 라인 (created/blocked / topBlock /
 *     executionImpact).
 */
export function formatShadowNearBreakoutSection(
  counters: ShadowNearBreakoutScanCounters | null | undefined,
): string | null {
  if (!counters) return null;
  const total = counters.created + counters.blocked;
  if (total === 0) return null;

  const lines: string[] = [];
  lines.push('🌘 Shadow Near-Breakout (ADR-0452)');
  lines.push(`  • created ${counters.created} / blocked ${counters.blocked}`);

  // topBlock 산출 — desc 정렬 + Top 3.
  const reasonEntries = Object.entries(counters.blockReasons)
    .filter(([, count]) => (count ?? 0) > 0)
    .sort(([, a], [, b]) => (b ?? 0) - (a ?? 0))
    .slice(0, 3);
  if (reasonEntries.length > 0) {
    const reasonStr = reasonEntries.map(([reason, count]) => `${reason} ${count}`).join(', ');
    lines.push(`  • topBlock: ${reasonStr}`);
  }

  lines.push('  • executionImpact: NONE');
  return lines.join('\n');
}
