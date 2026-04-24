# PR-22 engine-dev Handoff

ADR 참조: `docs/adr/0007-learning-feedback-loop-policy.md`, `docs/adr/0008-kelly-time-decay-wiring.md`.

## 구현 순서 (권장)

1. **C**: `syntheticReplay.ts` 삭제 (영향 최소, 빠른 win).
2. **A2**: `probingBandit` armKey 해상도 복원.
3. **A1**: `kellyHalfLife` rename + `accountRiskBudget.sizePosition` timeDecayInput 옵션.
4. **B**: `suggestNotifier` 공통 인프라 + 4개 모듈 wiring.
5. 각 단계 끝에서 관련 테스트만 vitest 로 로컬 실행 후 다음 단계.

---

## A1 — kellyHalfLife 실 사이징 연결 (최소 침습)

**사용자 결정**: 실 사이징에 시간감쇠 연결. 단 "동일 종목 신규 진입" 에는
daysHeld=0 이라 결과 불변. 실제 행동 변화 지점은 **트레일링·재평가**.

### 수정 1 — `server/trading/kellyHalfLife.ts`

- `HalfLifeSnapshot.effectiveKelly` 필드를 `decayedKelly` 로 rename (76번째 줄).
- `halfLifeSnapshot` 반환 객체의 `effectiveKelly: ...` 를 `decayedKelly: ...` 로.
- 파일 상단 주석의 `effectiveKelly(t) = ...` 표현은 유지 (수학 공식의 개념 명칭).
- 새 export: `applyHalfLifeDecay(staticKelly, halfLifeInput): number` — 
  `staticKelly × computePositionRiskWeight(daysHeld, halfLifeDays)` 반환. 
  halfLifeInput 이 null/undefined 또는 `KELLY_TIME_DECAY_ENABLED=false` 시 
  staticKelly 그대로 반환.

### 수정 2 — `server/trading/kellyHealthCard.ts`

- 라인 99, 100, 179, 180, 185 의 `snap.effectiveKelly` → `snap.decayedKelly`.
- 주석 중 "effectiveKelly" 언급은 그대로 두되 필드 접근만 교체.

### 수정 3 — `server/trading/accountRiskBudget.ts`

- `SizePositionInput` (195줄 전후) 에 옵셔널 필드 추가:
  ```ts
  timeDecayInput?: { daysHeld: number; halfLifeDays: number };
  ```
- `sizePosition` 의 `kelly.capped` 계산 직후, `timeDecayInput` 이 있고
  `KELLY_TIME_DECAY_ENABLED !== 'false'` 이면:
  ```ts
  const decayedKelly = applyHalfLifeDecay(kelly.capped, timeDecayInput);
  ```
  를 계산하고, 아래쪽 `capitalByKelly = totalAssets × kelly.capped × confidence`
  을 `totalAssets × decayedKelly × confidence` 로 교체.
- `SizePositionOutput.effectiveKelly` 는 **의미 보존적으로 유지** — 반환값만
  decayedKelly (timeDecayInput 없으면 kelly.capped 와 동일, 있으면 감쇠 적용값).
- 파일 상단 주석에 "timeDecayInput 제공 시 decayed, 미제공 시 capped 과 동일"
  한 줄 추가.
- `computeKellyCoverageRatio` 는 그대로 — 호출자가 decayedKelly 를 전달하면
  그 기준으로 계산됨.

### 수정 4 — import 정리

- `accountRiskBudget.ts` 상단에 
  `import { applyHalfLifeDecay } from './kellyHalfLife.js';` 추가.

### 수정 5 — 신규 테스트 `server/trading/accountRiskBudgetTimeDecay.test.ts`

케이스:
1. `timeDecayInput` 없음 → `effectiveKelly === kelly.capped` (기존 등가성).
2. `daysHeld=0` → weight=1 → effectiveKelly === kelly.capped.
3. `daysHeld=halfLifeDays` → weight ≈ 0.5 → effectiveKelly ≈ kelly.capped × 0.5.
4. `daysHeld=2×halfLifeDays` → weight ≈ 0.25.
5. `KELLY_TIME_DECAY_ENABLED=false` env → timeDecayInput 있어도 decayedKelly = staticKelly.
6. halfLifeDays ≤ 0 → weight=1 (kellyHalfLife 가드).

### 수정 6 — 호출부 `signalScanner.ts`

- 라인 1403 `effectiveKelly: sized.effectiveKelly,` 은 SizingResult 의 필드 — 
  `SizingResult` 는 rename 하지 **않음**. sizingTier 의 `TierGradeComposition` 
  및 `SizingResult` 는 그대로 유지. accountRiskBudget 의 `SizePositionOutput` 
  도 `effectiveKelly` 유지 — 의미는 "capped × timeDecay".
- 이번 PR 에서 신규 진입 경로는 timeDecayInput 을 전달하지 않음 (daysHeld=0 
  이므로 결과 불변). 트레일링에서 호출하는 wiring 은 후속 PR.

### 변경 비용 총합

- 수정 파일 3: kellyHalfLife.ts, kellyHealthCard.ts, accountRiskBudget.ts.
- 신규 파일 1: accountRiskBudgetTimeDecay.test.ts.
- 기존 테스트 영향: 없음 (SizingResult/SizePositionOutput 필드명 유지).

---

## A2 — probingBandit armKey 해상도 복원

### 수정 — `server/learning/probingBandit.ts`

- `armStatsFromHistory` (141~170줄) 의 매칭 로직 재작성:
  ```
  const [sigType, profile] = armKey.split(':');
  const isLegacyArm = profile === 'X';
  const matched = history.filter(r => {
    if (r.status !== 'WIN' && r.status !== 'LOSS') return false;
    if (r.signalType !== sigType) return false;
    if (isLegacyArm) return true;            // 하위 호환
    const rProfile = r.profileType ?? 'X';
    return rProfile === profile;             // 정확 매칭
  });
  ```
- 단, `RecommendationRecord` 에 `profileType` 필드가 존재하는지 확인 
  (`server/learning/recommendationTracker.ts`). 없으면:
  a. 필드가 없으면 주석 갱신 후 매칭 조건에서 profile 을 legacy-only 로 retain 
     (즉 기존 동작 유지 + legacy 경고 로그만 추가).
  b. 필드가 있으면 위 코드 그대로 적용.
- 결정: recommendationTracker.ts 확인 후 a/b 선택. 보고서에 명시.
- Legacy fallback 경고: `console.warn('[probingBandit] armKey profile=X matched
  legacy signal-only history. Migration pending.')` — isLegacyArm 분기에서.

### 신규 테스트 `server/learning/probingBanditArmKey.test.ts`

- `RecommendationRecord.profileType` 존재 여부에 따라 케이스 분기.
- BUY:A / BUY:B / BUY:C 가 서로 다른 arm 으로 집계.
- BUY:X (legacy) 는 모든 BUY 레코드를 포함.
- 경고 로그 1회 발생 검증.

---

## B — 학습 모듈 하이브리드 파이프라인

### 신규 — `server/learning/suggestNotifier.ts`

공통 알림 파이프라인. @responsibility 포함:

```ts
/**
 * @responsibility 학습 모듈의 임계 충족 suggest 알림을 Telegram 으로 송출·dedupe.
 */
```

API:
```ts
export interface SuggestPayload {
  moduleKey: 'counterfactual' | 'ledger' | 'kellySurface' | 'regimeCoverage';
  signature: string;               // 24h dedupe 키
  title: string;                   // Telegram 메시지 제목
  rationale: string;               // 임계 근거 (샘플수/CI 등)
  currentValue: string;            // 현재 운용 파라미터
  suggestedValue: string;          // 권고 파라미터
  threshold: string;               // 발동 임계 표현
}

export async function sendSuggestAlert(payload: SuggestPayload): Promise<boolean>;
export function isSuggestEnabled(): boolean;  // env 플래그 체크
```

구현:
- env: `LEARNING_SUGGEST_ENABLED` (기본 'true'). `'false'` 만 disable.
- dedupe: 모듈별 최근 signature → lastSentAt 을 `Map<string, number>` 로 보관. 
  서버 메모리 기반 (프로세스 재시작 시 초기화되는 MVP). 24h 내 같은 signature 
  재호출은 false 반환 + warn 로그.
- 메시지 포맷:
  ```
  💡 *학습 모듈 Suggest — {moduleKey}*
  {title}
  근거: {rationale}
  현재: {currentValue}
  권고: {suggestedValue}
  임계: {threshold}
  반영: 수동 (/accept-suggest 는 Phase 2)
  ```
- `sendTelegramMessage` 또는 기존 `telegramClient` 재활용.

### 신규 — `server/learning/suggestThresholds.ts`

ADR-0007 의 모듈별 임계 상수화. 각 모듈이 import.

```ts
export const SUGGEST_MIN_SAMPLE_COUNTERFACTUAL = 30;
export const SUGGEST_COUNTERFACTUAL_RATIO_THRESHOLD = 0.8;
export const SUGGEST_MIN_SAMPLE_LEDGER = 30;
export const SUGGEST_LEDGER_EDGE_PCT = 0.05;
export const SUGGEST_MIN_SAMPLE_KELLY_SURFACE = 20;
export const SUGGEST_KELLY_CI_THRESHOLD = 0.10;
export const SUGGEST_KELLY_DELTA_THRESHOLD = 0.5;
export const SUGGEST_REGIME_COVERAGE_RATIO = 0.5;
export const SUGGEST_REGIME_DRY_DAYS = 30;
```

### 모듈별 `evaluateSuggestion` 추가

#### `counterfactualShadow.ts`
- 신규 export `evaluateCounterfactualSuggestion(): Promise<void>`.
- 로직: resolved (return30d not null) 샘플 30건 이상 + 탈락 후보 평균 수익 
  vs 통과 후보 평균 수익 비율 ≥ 0.8 → `sendSuggestAlert`.
- signature: `counterfactual-{YYYY-MM-DD}` (일 단위 1회).

#### `ledgerSimulator.ts`
- 신규 export `evaluateLedgerSuggestion(): Promise<void>`.
- 로직: resolved universe triplet 30쌍 이상 + Universe B 또는 C 누적 수익이 
  A 대비 +5%p 이상 + MaxDD 동등 이하 → suggest.
- signature: `ledger-{winner-universe}-{YYYY-MM-DD}`.

#### `kellySurfaceMap.ts`
- 신규 export `evaluateKellySurfaceSuggestion(currentKellyBy: Record<signal, kelly>): Promise<void>`.
- 로직: 각 셀 sample≥20 + CI 폭≤0.10 + (추정 Kelly − 현재 Kelly) 절대값 ≥ 0.5 
  → suggest (가장 큰 괴리 1건만).
- signature: `kellySurface-{signalType}-{regime}-{YYYY-MM-DD}`.

#### `regimeBalancedSampler.ts`
- 신규 export `evaluateRegimeCoverageSuggestion(): Promise<void>`.
- 로직: 목표 대비 50% 미만 + 최근 30일 해당 레짐 진입 0건 → suggest.
- signature: `regime-{regimeKey}-{YYYY-MM-DD}`.

### 스케줄러 wiring — `server/scheduler/learningJobs.ts`

기존 `resolveCounterfactuals` / `resolveLedger` 호출 직후 해당 모듈의 
`evaluateXxxSuggestion()` 을 catch 감싸서 호출. failure 는 warn 만, 전체 
작업을 깨뜨리지 않음.

`kellySurfaceMap` 과 `regimeBalancedSampler` 는 별도 resolve 가 없으므로 
`maintenanceJobs.ts` 에 "매일 16:20 KST" cron 으로 추가.

### 신규 테스트 — `server/learning/suggestNotifier.test.ts`

- `isSuggestEnabled` env 체크.
- `sendSuggestAlert` 24h 내 같은 signature 재호출 → false.
- 다른 signature → true.
- `LEARNING_SUGGEST_ENABLED=false` → false.

### 모듈별 no-op 테스트

기존 테스트 (`counterfactualShadow.test.ts` 등) 에 추가:
- `evaluateXxxSuggestion()` sample 부족 시 no-op (sendSuggestAlert 호출 안됨).
- 임계 충족 시 1회 호출.

---

## C — syntheticReplay.ts 삭제

### 확인
- `grep -rn "syntheticReplay" server/ src/ scripts/` 에서 자기 파일 외 import 0건.
- git log 상 작성 commit 외 수정 commit 없음.

### 삭제
- `server/learning/syntheticReplay.ts` 제거.
- `server/learning/syntheticReplay.test.ts` 가 있으면 함께 제거 (없을 것으로 추정).

### ARCHITECTURE.md / CLAUDE.md
- ARCHITECTURE.md 에 syntheticReplay 가 명시돼 있는지 확인. 있으면 제거.
- CLAUDE.md 는 PR-22 변경이력에서 일괄 설명.

---

## 공통 가이드

### @responsibility 태그
- 신규 `suggestNotifier.ts`, `suggestThresholds.ts` 는 헤더 20줄 내 @responsibility 
  25단어 이내 필수.
- 기존 파일 (kellyHalfLife, accountRiskBudget 등) 은 @responsibility 가 없으면 
  이번 수정 김에 추가하면 좋지만 **강제 아님** (rename 만으로 책임 정의 변하지 않음).

### ARCHITECTURE.md 경계
- `suggestNotifier` 는 `learning/` 에서 `telegram/` 으로 outbound 호출 허용 — 
  기존 `learningJobs.ts` 가 이미 동일 패턴이므로 경계 위반 아님.
- `accountRiskBudget` → `kellyHalfLife` import 는 `trading/` 내부 → 문제 없음.

### Feature flag 확인
- `KELLY_TIME_DECAY_ENABLED` — `.env.example` 에 주석과 함께 추가.
- `LEARNING_SUGGEST_ENABLED` — `.env.example` 에 주석과 함께 추가.

### 진행 중 체크리스트
- [ ] `npm run lint` 통과 (수정 단계마다)
- [ ] 관련 `*.test.ts` vitest 로 단독 실행 후 다음 단계
- [ ] `npm run validate:responsibility` — 신규 파일 태그 OK
- [ ] `npm run validate:complexity` — 어느 파일도 함수 임계 초과 안 함
