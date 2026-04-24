/**
 * probingBandit.ts — Idea 6: PROBING 슬롯의 Multi-Arm Bandit 확장.
 *
 * 기존: PROBING_MAX_SLOTS = 1 (고정).
 * 신규: "arm" (= signalType + profileType + entryRegime-family) 별 Beta(1+wins, 1+losses)
 *       사후 분포를 유지하고 Thompson Sampling 으로 불확실성이 큰 arm 에 추가 슬롯을 배분.
 *
 * 안전성:
 *   1. PROBING 티어 자체가 TIER_KELLY_FACTOR.PROBING = 0.25 로 강제 Kelly 축소.
 *   2. 활성 PROBING 슬롯 상한 = PROBING_MAX_SLOTS_WITH_BANDIT (기본 3). 기본 1 슬롯 +
 *      arm 당 최대 2개 추가 — 총 계좌 영향은 0.25×3 = 0.75 Kelly 한도.
 *   3. 이미 ESS ≥ MIN_OBS 인 "확정된" arm 은 보너스에서 제외 (수학적으로 최적 exploration 조절).
 *
 * 수학:
 *   Beta(α, β) 의 분산 = αβ / ((α+β)²(α+β+1)).
 *   α=β=1 (사전, 0관측) 일 때 분산 = 1/12 ≈ 0.083, ESS=0.
 *   ESS 증가와 함께 분산이 1/N 속도로 감소 → "이 arm 에 대해 더 배울 게 있는가" 신호.
 *
 *   Thompson Sampling 샘플 = Beta(α, β) 에서 1회 추출. 여기서는 결정 결과는
 *   ESS 기반 보너스 공식에 따르되, 샘플값은 로깅·진단용으로 반환 (재현성을 위해 seed 지원).
 */

import type { RecommendationRecord } from './recommendationTracker.js';
import { loadShadowTrades } from '../persistence/shadowTradeRepo.js';
import { getRecommendations } from './recommendationTracker.js';

/** 기존 상수 (sizingTier.ts) 와 정합. 이 모듈은 동적 확장만 담당. */
export const PROBING_BASE_SLOTS = 1;
/**
 * Bandit 이 동시에 허용하는 PROBING 슬롯의 절대 상한.
 * Kelly×0.25 × 3 = 0.75 — 단일 PROBING 로트의 3배까지만 용인.
 */
export const PROBING_MAX_SLOTS_WITH_BANDIT = 3;
/** 이 ESS 미만인 arm 은 "불확실 → 추가 탐색 가치" 로 판정. */
export const PROBING_MIN_OBS_FOR_CONFIDENT = 10;

export interface BanditArmStats {
  armKey: string;
  wins: number;
  losses: number;
  /** Beta(1+wins, 1+losses).mean = (wins+1)/(wins+losses+2) */
  posteriorMean: number;
  /** Beta 분산 — √분산 = 후험 표준편차 */
  variance: number;
  /** effective sample size — wins+losses */
  ess: number;
  /** Thompson sample — 본 스냅샷에서 한 번 추출된 p ~ Beta(α, β). */
  thompsonSample: number;
  /** 이 arm 은 추가 탐색 대상인가 (ess < MIN_OBS) */
  exploratory: boolean;
}

export interface BanditDecision {
  /** 허용 PROBING 슬롯 수 — 1 ~ PROBING_MAX_SLOTS_WITH_BANDIT */
  budget: number;
  /** 각 arm 의 진단 스탯 */
  arms: BanditArmStats[];
  /** 운영자 가독 근거 문자열 (Telegram 로그용) */
  rationale: string;
}

/**
 * 재현성을 위한 deterministic PRNG (xorshift32).
 * 테스트에서 `seed` 를 고정하면 Thompson sample 이 항상 같은 값이 나온다.
 * 프로덕션에서는 seed 미지정 → Math.random() 사용.
 */
export function makeRng(seed?: number): () => number {
  if (seed == null) return Math.random;
  let s = seed >>> 0;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 2 ** 30) / 2 ** 30;
  };
}

/**
 * 표준 정규 분포(N(0,1)) 샘플 — Marsaglia polar method.
 * Beta 분포 근사 샘플의 중간 단계로 쓰인다 (Wilson–Hilferty approx).
 */
function sampleNormal(rng: () => number): number {
  let u = 0, v = 0, s = 0;
  do {
    u = rng() * 2 - 1;
    v = rng() * 2 - 1;
    s = u * u + v * v;
  } while (s >= 1 || s === 0);
  return u * Math.sqrt(-2 * Math.log(s) / s);
}

/**
 * Gamma(shape, 1) 샘플 — Marsaglia–Tsang 2000 (shape ≥ 1 에서 O(1) acceptance ≈ 96%).
 */
function sampleGamma(shape: number, rng: () => number): number {
  if (shape < 1) {
    // Boost: Gamma(shape) = Gamma(shape+1) × U^(1/shape)
    const u = rng();
    return sampleGamma(shape + 1, rng) * Math.pow(u === 0 ? 1e-12 : u, 1 / shape);
  }
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (let i = 0; i < 1024; i++) {
    const x = sampleNormal(rng);
    const base = 1 + c * x;
    if (base <= 0) continue;
    const v = base ** 3;
    const u = rng();
    if (u < 1 - 0.0331 * (x ** 4)) return d * v;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
  // 극히 드문 경로 — 정규 근사 폴백.
  return shape;
}

/**
 * Beta(α, β) 샘플 — Gamma 비율 방법.
 *   X ~ Gamma(α), Y ~ Gamma(β) → X / (X + Y) ~ Beta(α, β).
 * α=β=1 은 uniform(0,1) 로 단락 처리.
 */
export function sampleBeta(alpha: number, beta: number, rng: () => number = Math.random): number {
  if (alpha === 1 && beta === 1) return rng();
  const x = sampleGamma(alpha, rng);
  const y = sampleGamma(beta, rng);
  const total = x + y;
  if (total <= 0) return alpha / (alpha + beta); // 이론적으로 0 확률, 안전망.
  return x / total;
}

/**
 * 후보의 arm key 를 결정한다. 간결하고 충돌이 적어 학습 신호가 집중되도록
 * `<signalType>:<profileType>` 로 축소한다. (2×4 = 최대 8 arms)
 */
export function buildArmKey(input: {
  signalType: 'STRONG_BUY' | 'BUY' | 'PROBING' | 'HOLD';
  profileType?: 'A' | 'B' | 'C' | 'D' | null;
}): string {
  return `${input.signalType}:${input.profileType ?? 'X'}`;
}

/**
 * 같은 process lifetime 내에서 legacy-fallback 경고가 범람하지 않도록 1회만 출력.
 * `RecommendationRecord.profileType` 이 장래에 추가되면 경고 경로는 자연 소거.
 */
let __legacyArmKeyWarnedOnce = false;

/**
 * @internal 테스트 전용 — 경고 플래그를 리셋한다.
 */
export function __resetLegacyArmKeyWarningForTests(): void {
  __legacyArmKeyWarnedOnce = false;
}

function armStatsFromHistory(
  armKey: string,
  history: RecommendationRecord[],
  rng: () => number,
): BanditArmStats {
  // armKey = `<signalType>:<profileType>` (profileType='X' 는 legacy/미지정).
  //
  // RecommendationRecord 는 현재 signalType 은 있지만 profileType 필드가 없다.
  // 따라서 "옵션 a (ADR-0007 / PR-22 engine-dev handoff)" 정책 —
  //   · legacy armKey (`:X`)  → 기존 동작 유지 (signalType 만으로 매칭)
  //   · 비-legacy armKey (`:A`/`:B`/...) → 동일하게 signalType 매칭으로 fallback 하되
  //     "profile 해상도가 복원되지 않은 legacy history" 임을 경고 (프로세스당 1회).
  //
  // 이 경고는 추후 RecommendationRecord 에 profileType 이 추가되면 즉시 정확 매칭으로
  // 전환할 수 있는 지점을 표시하기 위한 marker 다.
  const [sigType, profile] = armKey.split(':');
  const isLegacyArm = profile === 'X';

  if (!isLegacyArm && !__legacyArmKeyWarnedOnce) {
    console.warn(
      '[probingBandit] armKey profile=%s matched legacy signal-only history. Migration pending.',
      profile,
    );
    __legacyArmKeyWarnedOnce = true;
  }

  const matched = history.filter(r =>
    (r.status === 'WIN' || r.status === 'LOSS') &&
    r.signalType === sigType,
  );
  const wins   = matched.filter(r => r.status === 'WIN').length;
  const losses = matched.filter(r => r.status === 'LOSS').length;
  const ess    = wins + losses;
  const alpha  = 1 + wins;
  const beta   = 1 + losses;
  const posteriorMean = alpha / (alpha + beta);
  const variance      = (alpha * beta) / ((alpha + beta) ** 2 * (alpha + beta + 1));
  return {
    armKey,
    wins,
    losses,
    posteriorMean,
    variance,
    ess,
    thompsonSample: sampleBeta(alpha, beta, rng),
    exploratory: ess < PROBING_MIN_OBS_FOR_CONFIDENT,
  };
}

/**
 * 이번 스캔에서 허용할 PROBING 슬롯 수를 결정한다.
 *
 * @param candidateArmKeys 본 스캔에서 PROBING 티어로 분류된 후보들의 arm key 배열
 * @param options.recommendations 히스토리 주입 (테스트용). 미주입 시 파일 로드.
 * @param options.seed 재현성용 seed (테스트). 미주입 시 Math.random.
 */
export function decideProbingSlotBudget(
  candidateArmKeys: string[],
  options?: { recommendations?: RecommendationRecord[]; seed?: number },
): BanditDecision {
  const uniqueArms = Array.from(new Set(candidateArmKeys));
  if (uniqueArms.length === 0) {
    return {
      budget: PROBING_BASE_SLOTS,
      arms: [],
      rationale: 'PROBING 후보 없음 — 기본 슬롯 유지',
    };
  }

  const history = options?.recommendations ?? getRecommendations();
  const rng = makeRng(options?.seed);
  const arms = uniqueArms.map(k => armStatsFromHistory(k, history, rng));

  // Bonus = 탐색 가치가 있는 arm 의 개수 (절대 상한 캡).
  const exploratoryCount = arms.filter(a => a.exploratory).length;
  const bonus = Math.min(
    PROBING_MAX_SLOTS_WITH_BANDIT - PROBING_BASE_SLOTS,
    exploratoryCount,
  );
  const budget = PROBING_BASE_SLOTS + bonus;

  const rationale = arms.length === 0
    ? '후보 없음'
    : `${exploratoryCount}/${arms.length} arms < ESS${PROBING_MIN_OBS_FOR_CONFIDENT} → +${bonus} 슬롯` +
      ` (arms: ${arms.map(a => `${a.armKey}[α=${1 + a.wins},β=${1 + a.losses},p̂=${a.posteriorMean.toFixed(2)}]`).join(', ')})`;

  return { budget, arms, rationale };
}

/**
 * 스캔 시 `reservedProbingSlots` 와 비교하여 이 후보에 PROBING 슬롯을 배정할 수 있는지 결정.
 * sizingTier.canReserveProbingSlot() 와 동등하지만 bandit 이 결정한 동적 예산을 쓴다.
 */
export function canReserveBanditProbingSlot(
  currentProbingCount: number,
  banditBudget: number,
): boolean {
  return currentProbingCount < banditBudget;
}

/** 레거시 호환 래퍼 — 테스트 fixture 가 참조하는 shadow-level history 조회. */
export function getClosedTradesCount(): number {
  return loadShadowTrades()
    .filter(t => t.status === 'HIT_TARGET' || t.status === 'HIT_STOP')
    .length;
}
