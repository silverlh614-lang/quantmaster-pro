// @responsibility budgetPolicy 매매 엔진 자본 보호 정책 SSOT — 백테스트 주입 가능
/**
 * budgetPolicy.ts — Account Risk Budget Policy 정책 객체 (PR-T / 아이디어 8)
 *
 * 사용자 요청:
 *   "evaluateBuyList 내부 P1-2 섹션의 '계좌 리스크 예산 + Fractional Kelly 게이트' 는
 *    시스템 전체에서 가장 중요한 자본 보호 로직 중 하나. 이 로직을 별도 정책 객체
 *    BudgetPolicy 로 추출하면, 과거 거래 데이터에 정책 객체만 갈아끼워서
 *    'Kelly 0.25배 vs 0.5배' 백테스트가 즉시 가능해진다."
 *
 * 본 모듈은 임계값(env 기반) + Fractional Kelly 캡을 단일 정책 객체로 캡슐화한다.
 *   - production: defaultBudgetPolicy() — env 기반, getBudgetPolicy() 기본값
 *   - backtest:   setBudgetPolicy(p) 로 정책 주입, getBudgetPolicy() 가 주입값 반환
 *
 * `accountRiskBudget.getAccountRiskBudget` / `computeRiskAdjustedSize` 가 이 정책을
 * 옵셔널 인자로 받는다. 미주입 시 활성 정책(getBudgetPolicy()) 자동 사용.
 *
 * 절대 규칙: 본 모듈은 외부 의존성 0 (state/persistence/clients import 금지) — 순수 정책.
 */

export type SignalGrade = 'STRONG_BUY' | 'BUY' | 'HOLD' | 'PROBING';

export interface BudgetPolicy {
  /** 정책 식별자 — 백테스트 비교 시 결과에 부착해 어느 정책으로 돌렸는지 추적 */
  id: string;
  /** 일일 최대 손실 허용(%) — 신규 진입 차단 임계값 */
  dailyLossLimitPct: number;
  /** 동시 보유 총 리스크 한도(%) — 모든 활성 포지션 (entry-stop) 합 / 총자본 상한 */
  maxConcurrentRiskPct: number;
  /** 단일 포지션 최대 리스크(%) — (entry-stop)/총자본 상한, R-multiple 1단위 캡 */
  maxPerTradeRiskPct: number;
  /** 섹터 편중 한도(%) — 단일 섹터 합산 시장가 / 총자본 상한 */
  maxSectorWeightPct: number;
  /** Fractional Kelly 캡 — 신호 등급별 풀 Kelly 대비 최대 허용 비율 */
  fractionalKellyCap: Record<SignalGrade, number>;
}

/**
 * 환경 변수 기반 기본 정책. 각 호출 시점에 새 객체를 만들어 env 변경을 즉시 반영한다.
 *
 * `MAX_SECTOR_WEIGHT` 는 0~1 비율 입력 (기존 관습) → 100 곱해서 % 단위로 정규화.
 */
export function defaultBudgetPolicy(): BudgetPolicy {
  return {
    id: 'default-env',
    dailyLossLimitPct:    parseFloat(process.env.DAILY_LOSS_LIMIT          ?? '5'),
    maxConcurrentRiskPct: parseFloat(process.env.MAX_CONCURRENT_RISK_PCT   ?? '6'),
    maxPerTradeRiskPct:   parseFloat(process.env.MAX_PER_TRADE_RISK_PCT    ?? '1.5'),
    maxSectorWeightPct:   parseFloat(process.env.MAX_SECTOR_WEIGHT         ?? '0.30') * 100,
    fractionalKellyCap: {
      STRONG_BUY: 0.50,  // 최고 신뢰도라도 풀 Kelly 의 절반까지만
      BUY:        0.25,
      HOLD:       0.10,  // HOLD 성 신규 진입(레짐 보수화 등)
      PROBING:    0.10,  // 탐색적 소량 진입
    },
  };
}

// ── 활성 정책 슬롯 (백테스트 주입 hook) ──────────────────────────────────────

let _activePolicy: BudgetPolicy | null = null;

/**
 * 현재 활성 정책 반환. 주입된 정책이 없으면 매 호출마다 env 기반 기본 정책을 새로 빌드.
 */
export function getBudgetPolicy(): BudgetPolicy {
  return _activePolicy ?? defaultBudgetPolicy();
}

/**
 * 활성 정책 교체 — 백테스트 진입 시 사용.
 * `null` 을 넘기면 env 기본값으로 리셋.
 *
 * production 코드 경로에서는 호출하지 말 것 (백테스트 / 테스트 전용).
 */
export function setBudgetPolicy(policy: BudgetPolicy | null): void {
  _activePolicy = policy;
}

/**
 * 백테스트 시나리오 헬퍼 — 기존 정책 위에 일부 필드만 덮어쓴 새 정책 반환.
 *
 * @example
 *   const aggressive = withPolicyOverride({ id: 'kelly-half', fractionalKellyCap: { STRONG_BUY: 0.25, BUY: 0.125, HOLD: 0.05, PROBING: 0.05 }});
 *   setBudgetPolicy(aggressive);
 */
export function withPolicyOverride(
  overrides: Partial<BudgetPolicy>,
  base: BudgetPolicy = defaultBudgetPolicy(),
): BudgetPolicy {
  return {
    ...base,
    ...overrides,
    fractionalKellyCap: {
      ...base.fractionalKellyCap,
      ...(overrides.fractionalKellyCap ?? {}),
    },
  };
}

// ── 신호 등급 캡 적용 (정책 기반) ────────────────────────────────────────────

/**
 * 신호 등급에 정책의 Fractional Kelly 캡을 적용. 입력 multiplier 가 캡을 넘으면 캡으로 절단.
 *
 * 정책 미주입 시 활성 정책(getBudgetPolicy())의 캡 사용.
 */
export function applyFractionalKellyWithPolicy(
  grade: SignalGrade,
  kellyMultiplier: number,
  policy: BudgetPolicy = getBudgetPolicy(),
): { capped: number; wasCapped: boolean; cap: number } {
  const cap = policy.fractionalKellyCap[grade];
  const safe = Math.max(0, kellyMultiplier);
  if (safe > cap) return { capped: cap, wasCapped: true, cap };
  return { capped: safe, wasCapped: false, cap };
}
