# ADR-0036: BudgetPolicy 정책 객체 추출 (PR-T / 아이디어 8)

- **Status**: Accepted
- **Date**: 2026-04-26
- **Deciders**: architect (자동매매 자본 보호 SSOT)
- **Related**: PR-T, ADR-0008 (Kelly Time Decay Wiring)

## Context

`evaluateBuyList` 내부 P1-2 섹션의 "계좌 리스크 예산 + Fractional Kelly 게이트" 는
시스템 전체에서 가장 중요한 자본 보호 로직 중 하나다. 그러나 기존 구조는:

1. `accountRiskBudget.ts` 가 `DAILY_LOSS_LIMIT_PCT`/`MAX_CONCURRENT_RISK_PCT`/
   `MAX_PER_TRADE_RISK_PCT`/`MAX_SECTOR_WEIGHT_PCT` 를 모듈 로드 시점에 env 로 읽고
   파일 스코프 const 로 박제 → 백테스트가 정책을 swap 할 수 없다.
2. `FRACTIONAL_KELLY_CAP` 도 하드코딩 const → "Kelly 0.25배 vs 0.5배" 비교 불가.
3. 정책과 계산이 한 파일에 섞여 있어 정책의 "어떤 값으로 돌렸는가" 추적이 어렵다.

페르소나 자료의 ROE 듀퐁 분석처럼, 시스템도 분해 가능해야 진단 가능하다.

## Decision

`server/trading/budgetPolicy.ts` 신규 — 임계값 + Fractional Kelly 캡을 단일 정책
객체 `BudgetPolicy` 로 캡슐화한다.

### `BudgetPolicy` 인터페이스

```typescript
interface BudgetPolicy {
  id: string;                       // 백테스트 비교용 식별자
  dailyLossLimitPct: number;
  maxConcurrentRiskPct: number;
  maxPerTradeRiskPct: number;
  maxSectorWeightPct: number;
  fractionalKellyCap: Record<SignalGrade, number>;
}
```

### 활성 정책 슬롯 + 백테스트 hook

```typescript
defaultBudgetPolicy(): BudgetPolicy        // env 기반 default, 매 호출 신규 빌드
getBudgetPolicy(): BudgetPolicy            // 활성 정책 (주입 없으면 default)
setBudgetPolicy(p: BudgetPolicy | null)    // 백테스트 진입 시 swap
withPolicyOverride(overrides, base?)       // 부분 override 헬퍼
```

### `accountRiskBudget` 통합

- `getAccountRiskBudget` 에 `policy?: BudgetPolicy` 옵셔널 인자 추가.
- `computeRiskAdjustedSize` 에 `policy?: BudgetPolicy` 옵셔널 인자 추가.
- `applyFractionalKelly(grade, kelly)` → `applyFractionalKelly(grade, kelly, policy?)`.
- 미주입 시 `getBudgetPolicy()` 자동 사용 → 기존 호출자 0 변경.
- 후방호환: `FRACTIONAL_KELLY_CAP` const, `SignalGrade`, `BudgetPolicy` 등을
  `accountRiskBudget.ts` 에서 re-export → 기존 import 경로 무파괴.

## 백테스트 시나리오 예시

```typescript
import { setBudgetPolicy, withPolicyOverride } from './budgetPolicy.js';

// "Kelly 0.5배" baseline 측정
setBudgetPolicy(null);  // default
const baseline = runBacktest(historicalTrades);

// "Kelly 0.25배" 비교
const halfKelly = withPolicyOverride({
  id: 'kelly-quarter-strong',
  fractionalKellyCap: { STRONG_BUY: 0.25, BUY: 0.125, HOLD: 0.05, PROBING: 0.05 },
});
setBudgetPolicy(halfKelly);
const conservative = runBacktest(historicalTrades);

// 같은 거래 데이터 + 다른 정책 → Sharpe / MDD / Profit Factor 비교
```

## Consequences

**Positive**
- 백테스트가 정책 객체만 swap → "Kelly 0.25배 vs 0.5배" 비교 즉시 가능.
- 정책 식별자 `id` 가 결과에 부착되어 "어느 정책으로 돌렸나" 추적 가능.
- 정책 / 계산 책임 분리 → `budgetPolicy.ts` 외부 의존성 0 (순수 SSOT).
- `withPolicyOverride` 헬퍼로 부분 변형 정책 쉽게 생성.

**Negative / Trade-offs**
- 활성 정책 슬롯이 모듈 전역 mutable state → 테스트 간 격리 필요
  (`afterEach(() => setBudgetPolicy(null))` 패턴 정착).
- `FRACTIONAL_KELLY_CAP` const 가 default 정책의 스냅샷이라 setBudgetPolicy
  변경 후에도 const 자체는 변하지 않음 → 호출자가 `applyFractionalKelly` 를
  쓰면 정상 동작, const 를 직접 읽으면 default 만 보임 (의도된 후방호환).

**Production 보호**
- production 코드 경로(signalScanner perSymbolEvaluation)는 `setBudgetPolicy`
  호출하지 않음. 활성 정책은 항상 default-env → 기존 동작 100% 보존.
- `setBudgetPolicy` 는 백테스트 / 테스트 진입점 전용으로 명시 (JSDoc).

## 회귀 테스트

`server/trading/budgetPolicy.test.ts` 19 케이스:
- `defaultBudgetPolicy` env 기반 + override 2건
- `setBudgetPolicy` / `getBudgetPolicy` 활성 정책 슬롯 2건
- `withPolicyOverride` 부분 override 3건
- `applyFractionalKellyWithPolicy` 캡 / 음수 / 활성 정책 자동 사용 4건
- `applyFractionalKelly` accountRiskBudget re-export 후방호환 3건
- `computeRiskAdjustedSize` Kelly 0.25배 vs 0.5배 백테스트 시나리오 4건

기존 `accountRiskBudget.test.ts` 6건 + `accountRiskBudgetTimeDecay.test.ts` 6건
모두 무회귀 통과.

## 후속 작업 (본 ADR scope 밖)

- 정책 비교 백테스트 러너 (`server/learning/budgetPolicyBacktest.ts` 신규):
  CSV/JSON 입력 + 정책 배열 → Sharpe / MDD / PF 비교표.
- 텔레그램 `/budget_policy` 명령 — 활성 정책 식별자 + 캡 표시.
- `kellyDampener` / `sizingTier` 도 정책 객체로 추출하여 4-axis 백테스트 가능화.
