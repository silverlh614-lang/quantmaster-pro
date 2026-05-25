# ADR-0526: CandidateGateEvaluationView SSOT

@responsibility trading / gate-evaluation / candidate-view-ssot — CandidateGateEvaluationView SSOT

## Status

Accepted

## Context

ADR-0525 (Phase 0) 는 gate3 debug_raw 분기를 제거했으나, gate2 / execution 은 여전히
`buildGateUxBundle` (`gateUx.cmd.ts`) 에서 렌더 시점 재계산된다. 더 근본적으로, per-candidate
Gate0/1/2/3 판정에 대한 **정본이 없다**. 각 formatter 가 rich trace
(`entryFilterDecomposition.candidateTraces` — `CandidateEntryTrace`, 100+ 필드의 기질 객체)
에서 pass/fail/topBlockReason 을 독립 추론한다:

- `scanBlockersGate2.cmd.ts` 는 traces 로 `buildGate2ConfluenceSummary` 를 재실행하고
  `result.gate2Status` 를 재계산한다.
- `scanBlockersGate3.cmd.ts` 는 traces + gate2StatusBySymbol 로
  `buildGate3RuntimeClosureSummary` 를 재실행한다.
- `scanBlockersExecution.cmd.ts` 는 동일 traces 로 `resolveFinalExecutionDecision` 을
  재실행한다.
- `gate2ExternalRefresh.cmd.ts`, `scanBlockersFormatter.ts` 도 traces 에서 pass/fail 을
  자체 채굴(getByPath)한다.

`candidateTraces` 는 기질(raw feature) 컨테이너이지 판단 정본이 아니다. 같은 후보에 대해
formatter 별로 gate2Status / gate3Readiness / topBlockReason 이 달라질 수 있다.
9대 불변식 #3 (단일 SourceSnapshot) 의 파생층 분기다.

`entryFilterDecomposition` prod 28 소비자 분류 (`architect/entryFilterDecomposition-consumers.md`):
**생산자/스캔 로직 (rich trace 유지 OK)** 와 **formatter/소비자 (View 로 재바인딩 필요)** 로
분리 완료. 본 ADR 은 후자만 대상으로 한다.

## Decision

per-candidate Gate0/1/2/3 판단 **정본** `CandidateGateEvaluationView` 를 신설하고, formatter 의
pass/fail/topBlockReason 추론을 전면 제거하여 View read 로 대체한다.

1. **`CandidateGateEvaluationView` interface 신설** — 위치:
   `server/trading/signalScanner/scanDiagnostics/candidateGateEvaluationView.ts`.
   per-candidate 로 `symbol`, `sourceSnapshotId`, `asOf`, 각 게이트 판정
   (`gate0` / `gate1` / `gate2` / `gate3` 의 status + pass boolean), `topBlockReason`
   (정본이 계산 — formatter 아님), scope 태그를 담는다.
2. **permission vs count 이름 분리** — View 의 boolean 권한 필드와 집계 count 필드 이름을
   분리한다 (예: `gate3.timingReadyPermission: boolean` ≠ `timingReadyCount: number`).
   ADR-0527 의 permission/count 분리 규율과 정렬한다.
3. **정본이 topBlockReason 계산** — 우선순위 레지스트리(ADR-0478/0497 taxonomy)를 정본 빌더
   내부에 두고, formatter 는 `view.topBlockReason` 을 그대로 출력한다.
4. **entryFilterDecomposition / candidateTraces 정규화** — 생산자(decompositionBuilder,
   gate1*Audit, runtimeResolverTraceStep26 등)는 rich trace 를 계속 사용한다. formatter
   계열(scanBlockersGate2/Gate3/Execution.cmd, gate2ExternalRefresh.cmd, gateUx.cmd,
   snapshotBundle, scanBlockersFormatter 의 pass/fail 채굴부)은 `CandidateGateEvaluationView[]`
   를 읽도록 재바인딩한다.
5. **legacy read-guard** — formatter 가 `candidateTraces` 에서 `gate2Status` /
   `gate3Readiness` / `gate2Passed` 등을 직접 채굴하면 정적 가드(grep guard, ADR-0444 계열)가
   test fail. 단방향 가드: 정본 생성 후 formatter 의 legacy/raw read → lint/test fail.
6. **재바인딩 우선, 삭제 후순위** — `candidateTraces` 자체는 생산자가 계속 쓰므로 유지.
   formatter 소비만 View 로 이동. 죽은 필드 삭제는 read-guard green + 소비자 0 확인 후.

빌더 구현(`buildCandidateGateEvaluationViews(summary)`)은 engine-dev 가 채운다 — 본 ADR 은
타입 계약·경계·read-guard 정책만 확정.

## Consequences

긍정:

- per-candidate Gate0/1/2/3 판정 정본 단일화 → 전 formatter 정합.
- `buildGateUxBundle` 의 gate2 / execution override 제거 가능 (Phase 0 의 gate3 정합을 gate2/3/exec 로 확장).
- topBlockReason 우선순위가 한 곳에서 결정됨 (formatter 별 추론 제거).
- 9대 불변식 #3 의 파생 분기가 per-candidate 축에서 제거됨.

부정 / 제약:

- formatter 5+ 파일의 입력 계약이 traces → View 로 바뀐다 (회귀 표면 큼 — 골든 출력 테스트 필수).
- `buildCandidateGateEvaluationViews` 는 스캔 시점 산출물(gate2 cache, gate3 closure)을
  소비하므로, 빌드 위치를 persist 시점으로 옮길지(권장) 렌더 시점으로 둘지 engine-dev 가
  결정한다 — 후자라면 동일 입력에 대해 결정론적이어야 한다 (더미 시각 재판정 금지).

## 영향 파일

생산자 (유지): `entryFilterDecomposition/*`, `runtimeResolverTraceStep26.ts`,
`gate1*Audit`, `minimumSignalScoreTrace.ts`, `injectPerSymbolSupplyContext.ts`,
`persistScanResults*.ts`, `scanCounter*.ts`, `gate1MinimumSignalForensic/*`,
`sectorEnergyMasterSupplyUnknownPolicyAdr0488*`.

소비자 (View 재바인딩): `scanBlockersGate2.cmd.ts`, `scanBlockersGate3.cmd.ts`,
`scanBlockersExecution.cmd.ts`, `gate2ExternalRefresh.cmd.ts`, `gateUx.cmd.ts`,
`snapshotBundle.ts`, `scanBlockersFormatter.ts` (pass/fail 채굴부).

신규: `candidateGateEvaluationView.ts` (타입+빌더), `candidateGateEvaluationView.test.ts`.

## 회귀 테스트

1. 동일 `ScanSummary` fixture → 모든 formatter 의 gate2/gate3/topBlockReason 출력이
   `CandidateGateEvaluationView[]` 와 일치 (골든 스냅샷).
2. read-guard: formatter 소스에서 `candidateTraces[...].gate2Status` 직접 read 가 0건.
3. permission(boolean) 필드와 count(number) 필드가 타입 레벨에서 분리됨.

## 롤백 계획

formatter 재바인딩 커밋과 View 빌더 커밋을 독립 revert. LIVE 매매 본체 0줄. View 빌더가
persist 시점에 산출되더라도 ScanSummary 의 옵셔널 필드이므로 미존재 시 formatter 는
기존 경로(traces)로 graceful degrade 하도록 read-guard 를 Phase 전환 동안 warn 모드로 둔다.

## 9대 불변식 영향

- #3 (단일 SourceSnapshot): **개선** — per-candidate 판정 정본 단일화.
- #7 (L4 격리): View 는 게이트 판정 정본이며 AI_ESTIMATED 를 live 결정에 쓰지 않는다
  (참조 필드는 scope=PAPER_OBSERVATIONAL 등으로 격리 표기).
- #6 (Provider 장애 ≠ market signal): topBlockReason 정본 계산 시 providerIssue 를
  bearish 로 변환하지 않는다 (ADR-0499 분류 유지).

## Guardrails

- No live trading path change unless explicitly stated.
- No KIS/order import or invocation unless explicitly stated.
- No Gate/Kelly/STRONG_BUY behavior change unless explicitly stated.
- No Shadow policy change unless explicitly stated.
- No provider fetch behavior change unless explicitly stated.
- No data promotion behavior change unless explicitly stated.
