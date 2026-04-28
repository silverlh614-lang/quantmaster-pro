# ADR-0084 — Condition Lifecycle Status Policy (27조건 자연선택)

**상태**: Accepted (2026-04-28)
**배경**: 사용자 P10 진단 후속 — "27조건 자동 은퇴(Retirement) 정책 — NOISE_FACTOR 자동 제거 정책 없음"

## 문제

기존 인프라:
- `attributionRepo` (PR-19 ADR-0006) 가 `ServerAttributionRecord` 영속 — 27 조건의
  `conditionScores` + `isWin` + `returnPct` + `closedAt` + `entryRegime?` 누적
- `attributionAnalyzer.analyzeAttribution()` 가 27 조건별 `ConditionAttribution` 산출
  (winRate / avgReturn / sharpe / byRegime / recommendation: INCREASE / MAINTAIN /
  DECREASE / SUSPEND)

갭:
- `recommendation: SUSPEND` 가 *알고리즘적 권고* 일 뿐 *영구 은퇴* 정책 부재
- 운영자가 *어느 조건이 사실상 죽었는가* (활성률 1% 미만) 즉시 인지 불가
- "Aging" (firstSeenAt + lastSeenAt) 를 분리 추적하는 SSOT 없음
- PR-Y2 `reflectionImpactPolicy.ts` 의 13 모듈 자연선택 패턴이 27 조건에 미적용

사용자 명시:
> "신규 PR 은 신규 추가가 아니라 *측정 → 은퇴* 가 맞다.
>  6개월 운영 데이터 누적 후 NOISE_FACTOR 자동 silent"

## 결정

PR-Y2 `reflectionImpactPolicy.ts` 패턴을 27 조건에 그대로 적용.
**측정 전용** (실제 silent/deprecated 가드 wiring 은 데이터 누적 후 후속 PR).

기존 `attributionRepo` SSOT 위 *분류 레이어* — 별도 영속 SSOT 신설 *불필요*.

### 상태 4분기 (`ConditionLifecycleStatus`)

`normal` / `grace` / `silent` / `deprecated`

### 결정 트리 (우선순위 SSOT)

1. ENV `CONDITION_LIFECYCLE_DISABLED=true` → `'normal'` (정책 우회)
2. firstSeenAt 부재 (해당 조건 score≥HIGH 인 record 0건) → `'grace'`
3. firstSeenAt < 30일 (grace period) → `'grace'`
4. 표본 부족 (`activatedCount < MIN_SAMPLE_FOR_LIFECYCLE=30`) → `'grace'`
5. `activationRate < DEPRECATED_THRESHOLD=0.01` (1%) → `'deprecated'`
6. `activationRate < SILENT_THRESHOLD=0.05` (5%) → `'silent'`
7. 그 외 → `'normal'`

### 정의 SSOT

- `HIGH_SCORE_THRESHOLD = 6` (attributionAnalyzer 와 동일 — `score 0~10` 중 6 이상)
- `activatedCount(conditionId, records)` = `records.filter(r => r.conditionScores[conditionId] >= 6).length`
- `activationRate(conditionId, records)` = `activatedCount / records.length`
- `firstSeenAt(conditionId, records)` = `min(records.where score≥6).closedAt`
- `lastSeenAt(conditionId, records)` = `max(records.where score≥6).closedAt`
- `ageDays = (now - firstSeenAt) / 86400000` (firstSeenAt 부재 시 0)
- `windowDays` 기본 180일 (records 필터링 default — `ConditionLifecycleReport.windowDays`)

### 신규 모듈

- **`server/learning/conditionLifecyclePolicy.ts`** — 결정 트리 SSOT + 27 조건 카탈로그 +
  `getConditionLifecycleStatus(records, conditionId, opts)` + `getAllConditionLifecycleStatuses(records, opts)`
- **`learningRouter` `GET /condition-lifecycle?days=180`** — 27 조건 status 일괄
  read-only.
- **`/condition_lifecycle [N=27]`** (alias `/cl`) — 텔레그램 명령. status 4분기 이모지
  (✅normal / 🟡grace / 🟠silent / ❌deprecated) + activationRate Top N + summary.

### 비-범위 (후속 PR)

- 실제 silent/deprecated 가드 wiring (signalScanner / entryRevalidationStep 가 status
  를 읽어 score 가중치 0 처리) — **데이터 누적 6개월 후 후속 PR** (사용자 결정 2026-04-28)
- `f2wDriftDetector` 와 결합한 자동 deprecation 트리거 — 운영 데이터 검증 후
- 별도 영속 SSOT (일자별 활성률 추세) — attributionRepo 의 closedAt 시간 분포로 산출
  가능하므로 본 PR 미포함

### LIVE 영향

- `attributionRepo` 본체 무수정 (read-only 사용)
- `attributionAnalyzer.recommendation` 무영향 (SUSPEND vs deprecated 별도 책임)
- LIVE 매매 본체 0줄 변경 — 가중치 보정 정책 무영향
- KIS/KRX/Yahoo fetch 0건

### ENV 롤백

`CONDITION_LIFECYCLE_DISABLED=true` → 모든 조건 `'normal'` 반환 (정책 우회).

## 회귀 테스트 ≥30 케이스

- `conditionLifecyclePolicy.test.ts` 22 (결정 트리 7 분기 + 27 카탈로그 정합 1 +
  activatedCount 3 + activationRate 3 + firstSeenAt/lastSeenAt 3 + ageDays 2 +
  ENV 롤백 2 + getAllConditionLifecycleStatuses 1)
- `learningRouter.conditionLifecycle.test.ts` 4 (정상 / 빈 / throw 500 / windowDays 인자)
- `conditionLifecycle.cmd.test.ts` 8 (formatConditionLifecycleMessage 5 분기 + cmd
  execute 3: 정상 / alias /cl / load throw graceful)

총 34 케이스.

## 참조

- ADR-0006 attributionRepo 복합키 (PR-19)
- ADR-0024 entryRegime (PR-G)
- ADR-0083 walkForwardFramework (Rolling 윈도우 — 본 PR 의 시간 분포 설계와 정합)
- PR-Y2 reflectionImpactPolicy (동일 패턴)
- 사용자 P10 진단 (2026-04-26)
