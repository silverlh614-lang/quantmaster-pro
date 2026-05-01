# ADR-0133 — 파일 복잡도 게이트 무결성 회복 (1500줄 절대 규칙 강제)

**Status**: Accepted
**Date**: 2026-05-01
**Context**: PR-Refactor-1 (P0-2)

## Context

CLAUDE.md 절대 규칙 6번:

> 복잡도 한계: 파일당 1,500줄, 함수당 한계는 `scripts/check_complexity.js` 기준.
> 초과 시 즉시 분할.

그러나 `scripts/check_complexity.js` 의 구현은 **App.tsx 한 파일에만** 1500줄 한계를
강제하고, 나머지 src/* 파일은 *경고 (warning) 만*, server/* 파일은 *검사 자체가 없다*.

결과:
- `server/trading/signalScanner/perSymbolEvaluation.ts` (1616줄) 가 코드베이스에 존재
- precommit + CI 모두 절대 규칙 위반을 차단 못 함
- CLAUDE.md "기존 복잡도 위반" 표 (P0/P1/P2 분해 우선순위) 와 게이트 구현 단절

상세 진단: `_workspace/2026-05-01_pr-refactor-1-complexity-gate/architect/findings.md`

## Decision

### 1. 모든 ts/tsx 파일에 1500줄 한계 강제 차단

`scripts/check_complexity.js` 기본 동작을 변경:
- 인자 없이 호출 → `src/` + `server/` 전체 walk 후 1500줄 초과 파일 모두 fail
- 인자 명시 호출 → 해당 파일만 검사 (BASELINE 무시 — 강제 검증)
- 결과: precommit + CI 가 새 1500+ 파일을 즉시 차단

### 2. BASELINE_TECHNICAL_DEBT 카탈로그 도입

ADR-0094 (UI Language SSOT) 의 검증된 패턴 차용:
- 본 ADR 도입 시점의 *기존* 위반 파일 1건 (`perSymbolEvaluation.ts`) 일시 화이트리스트
- 분해 PR (PR-Refactor-2) 완료 시 카탈로그에서 *제거*
- 제거 시 회귀 가드 자동 강화 (해당 파일 1500+ 재발 시 즉시 fail)

```js
const BASELINE_TECHNICAL_DEBT = [
  'server/trading/signalScanner/perSymbolEvaluation.ts',  // PR-Refactor-2 에서 제거
];
```

### 3. CI workflow 이름 정합화

`.github/workflows/validation-hooks.yml`:
- `name: ACMA — App.tsx complexity` → `name: ACMA — file complexity (1500-line limit)`
- 인자 호출 동일 (`node scripts/check_complexity.js`) — walk 동작이 새 default

### 4. ENV 롤백 미도입

`COMPLEXITY_GATE_LEGACY_DISABLED` 같은 ENV 우회 도입 검토했으나 거부:
- 절대 규칙을 ENV 로 우회 가능한 패턴은 자기 모순
- 운영 사고 시에도 BASELINE 카탈로그에 *commit 영속* 으로 추가하는 방식만 허용
- 우회 흔적이 git log 에 남아 audit 가능

### 5. 함수 단위 검사 (GodFunctionGuard) 정책 미변경

본 PR scope: *파일* 단위 1500줄 한계 강제만. 함수 단위 (300줄 / cc=25) 는
`FUNCTION_GUARD=warn` default 유지 — 현재 135 함수 위반은 별도 분해 PR 시리즈로 처리.
함수 단위 strict 전환은 분해 누적 후 후속 ADR.

## Consequences

### Positive

- CLAUDE.md 절대 규칙 6번 ↔ 게이트 구현 정합 회복
- 새 거대 파일 (≥1500줄) 추가 시 precommit + CI 즉시 차단
- PR-Refactor-2/3/4/5 분해 진행 중 *다른* 거대 파일 회귀 위험 차단
- BASELINE 카탈로그가 분해 진행 상황 자체를 시각화 (PR 머지 시 1줄 제거)

### Negative

- precommit 빌드 시간 약간 증가 (src/ 1파일 → src/+server/ 약 800 파일 walk)
  - 영향: < 1초 추가 (라인 수 산출만)
- BASELINE 카탈로그 누락 시 우발적 fail 가능
  - 완화: 본 PR 회귀 테스트가 BASELINE 정합성 검증

### Neutral

- App.tsx 의 jsxDepth/useEffects/imports 임계 검사는 explicit 호출 또는 walk 자연 포함으로 보존
- BASELINE 카탈로그가 자동 *제거* 되는 게 아니라 분해 PR 이 *명시 제거* — drift 위험은
  회귀 테스트가 baseline 등록 파일이 실제로 1500+ 인지 검증으로 차단

## Rollback

비상 시:
1. `BASELINE_TECHNICAL_DEBT` 에 새 파일 추가 후 commit
2. 또는 본 PR revert (precommit + CI 가 다시 App.tsx-only 로 복원)

## Follow-up

- **PR-Refactor-2**: `perSymbolEvaluation.ts` 분해 → BASELINE 에서 제거
- **PR-Refactor-3/4/5**: kisClient.ts (1382) / dartPoller.ts (962) / shadowTradeRepo.ts (939) — 1500줄 미만이라 BASELINE 등록 불요, 직접 분해
- **함수 단위 strict 전환**: 135 god function 분해 누적 후 별도 ADR 로 `FUNCTION_GUARD=strict` default
- **ARCHITECTURE.md 갱신**: 본 ADR 의 BASELINE 패턴을 boundary rule 로 명문화
