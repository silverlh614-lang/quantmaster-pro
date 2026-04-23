# ADR 0002 — 테스트 파일 co-location 정책

- **상태**: Proposed
- **제안일**: 2026-04-23
- **관련 파일**: `src/services/quantEngine.*.test.ts` (28개), `server/**/__tests__/` 또는 인접 `*.test.ts` (63개)

## Context

현재 테스트 배치가 혼재되어 있다:

1. `src/services/` 루트에 `quantEngine.X.test.ts`, `autoTrading.X.test.ts` 형태 20+ 파일이
   구현 파일과 나란히 쌓여 있다 → 구현 vs 테스트 가독 저하.
2. `server/trading/__tests__/` 처럼 폴더 분리된 곳도 있고, `server/trading/X.test.ts` 처럼
   인접 배치된 곳도 있음 → 규칙이 일관되지 않음.
3. `engine-dev` / `dashboard-dev` 에이전트가 "내 모듈 테스트"를 명확히 식별하려면
   테스트 배치 규칙이 일관적이어야 한다.

## Decision

**테스트는 구현 파일과 동일 폴더 또는 직속 `__tests__/` 하위에 둔다 (co-location).**
단 아래 세부 규칙을 따른다.

### 규칙

1. **기본**: `X.ts` 의 테스트는 같은 폴더의 `X.test.ts` 또는 `__tests__/X.test.ts`
2. **도메인 묶음 테스트** (예: `quantEngine.bearSeasonality.test.ts` 처럼 한 파일의
   특정 기능군만 다루는 테스트): 구현 파일과 동일 폴더 유지. 단 해당 도메인에 이미
   서브 폴더가 있으면 서브 폴더로 이동 (예: `src/services/quant/`).
3. **테스트 전용 공용 fixture / 헬퍼**: 구현 폴더 옆 `__tests__/shared/` 에 배치.
4. **E2E / 통합 테스트**: `tests/integration/` 루트 디렉토리에 별도 격리.

### 이동 대상 (Phase 3 기록, 실행은 후속 PR)

| 현재 위치 | 이동 제안 위치 | 비고 |
|-----------|----------------|------|
| `src/services/quantEngine.bearSeasonality.test.ts` | `src/services/quant/__tests__/bearSeasonality.test.ts` | bear engine 전용 |
| `src/services/quantEngine.macroEngine.test.ts` | `src/services/quant/__tests__/macroEngine.test.ts` | macro 전용 |
| `src/services/quantEngine.marketRegimeClassifier.test.ts` | `src/services/quant/__tests__/marketRegimeClassifier.test.ts` | regime 전용 |
| `src/services/quantEngine.evFilter.test.ts` | `src/services/quant/__tests__/evFilter.test.ts` | 필터 전용 |
| `src/services/quantEngine.fss.test.ts` | `src/services/quant/__tests__/fss.test.ts` | FSS 전용 |
| `src/services/quantEngine.contradictionDetector.test.ts` | `src/services/quant/__tests__/contradictionDetector.test.ts` | |
| `src/services/quantEngine.sectorOverheat.test.ts` | `src/services/quant/__tests__/sectorOverheat.test.ts` | |
| `src/services/quantEngine.positionLifecycle.test.ts` | `src/services/quant/__tests__/positionLifecycle.test.ts` | |
| `src/services/quantEngine.failurePattern.test.ts` | `src/services/quant/__tests__/failurePattern.test.ts` | |
| `src/services/quantEngine.fxRateCycleEngine.test.ts` | `src/services/quant/__tests__/fxRateCycleEngine.test.ts` | |
| `src/services/quantEngine.timingSync.test.ts` | `src/services/quant/__tests__/timingSync.test.ts` | |
| `src/services/quantEngine.feedbackLoop.test.ts` | `src/services/quant/__tests__/feedbackLoop.test.ts` | |
| `src/services/quantEngine.percentileClassifier.test.ts` | `src/services/quant/__tests__/percentileClassifier.test.ts` | |
| `src/services/quantEngine.dynamicStop.test.ts` | `src/services/quant/__tests__/dynamicStop.test.ts` | |
| `src/services/quantEngine.sectorEnergy.test.ts` | `src/services/quant/__tests__/sectorEnergy.test.ts` | |
| `src/services/quantEngine.test.ts` | `src/services/quant/__tests__/quantEngine.test.ts` | 최상위 계통 테스트 |
| `src/services/autoTrading.autoTradeEngine.test.ts` | `src/services/trading/__tests__/autoTradeEngine.test.ts` | trading 서브폴더 |
| `src/services/autoTrading.trancheEngine.test.ts` | `src/services/trading/__tests__/trancheEngine.test.ts` | |
| `src/services/autoTrading.tradeSafety.test.ts` | `src/services/trading/__tests__/tradeSafety.test.ts` | |
| `src/services/autoTrading.slippageEngine.test.ts` | `src/services/trading/__tests__/slippageEngine.test.ts` | |
| `src/services/autoTrading.catalystSniper.test.ts` | `src/services/trading/__tests__/catalystSniper.test.ts` | |

> 참고: `src/services/quant/` 는 이미 존재하며 `regimeContext.test.ts` 등을 담고 있다.
> `src/services/trading/` 하위 폴더는 신규 생성. 이동 시 구현 본체도 함께 옮길지는
> 후속 ADR에서 결정 (현재 구현은 `src/services/` 루트에 `quantEngine.ts` 단일 파일로
> 있으므로, 테스트만 `quant/__tests__/` 로 옮기는 것이 1차 목표).

## Consequences

### 긍정
- `engine-dev` / `dashboard-dev` 가 "내 모듈 테스트" 를 glob 1줄(`./__tests__/**`)로 식별
- 검색·리팩토링 시 구현-테스트 쌍이 직관적
- vitest workspace 구성 단순화

### 부정
- 기존 import 경로 변경 → 테스트 파일 내 상대 경로 `../` 조정 필요
- git blame 연속성 감소 (파일 이동으로) — `git log --follow` 필요

### 위험 관리
- 이동은 "한 번에 한 테스트" 단위로 커밋. 실패 시 즉시 해당 커밋만 revert.
- `npm run lint` + 해당 테스트 통과를 각 이동 커밋마다 검증.

## Alternatives Considered

### A. 루트 `tests/` 디렉토리 집중
- 장점: 구현 폴더 정리
- 단점: 테스트와 구현이 멀어져 리팩토링 시 "어느 테스트가 이 모듈을 커버하는지" 추적 곤란

### B. 현상 유지
- 장점: 이동 리스크 0
- 단점: 혼재 구조가 굳어져 하네스 조율에 지속적 비용

## Migration Plan

**본 ADR은 방침 결정만 수행.** 실제 이동은 후속 PR에서 아래 순서로:

1. `src/services/quant/__tests__/` 폴더 생성
2. quantEngine 관련 16개 테스트를 "한 번에 한 파일씩" 이동 + 커밋
3. `src/services/trading/__tests__/` 생성 후 autoTrading 관련 5개 이동
4. 각 이동 커밋마다 `npm run lint` + 해당 테스트 실행 + 커밋
5. 이동 완료 후 `vitest.config` 에 경로 변경 불필요 (기본 glob `**/*.test.ts` 유지)

## References

- `CLAUDE.md` — 에이전트 팀 DoD 의 "해당 모듈 `*.test.ts` 통과"
- `.claude/agents/engine-dev.md` — "멱등성 테스트 동반"
- `package.json` — `scripts.lint` = `tsc --noEmit` (테스트 파일 포함)
