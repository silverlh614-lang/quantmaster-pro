# ADR-0525: Gate Debug Raw Canonical Summary Rebinding

@responsibility telegram / debug-raw / canonical-projection — Gate Debug Raw Canonical Summary Rebinding

## Status

Accepted

## Context

판단 결과를 출력하는 Telegram formatter 가 11개이고, 각자 pass/fail/topBlockReason 을
자기 기준으로 재추론한다. 같은 `ScanSummary` (단일 SourceSnapshot 파생) 를 보고도
`/scan_blockers` 와 `/gate_debug_raw` 가 서로 다른 gate3 숫자를 출력한다.

물증 (충돌의 정확한 한 줄):

- `/scan_blockers` → `formatScanBlockersMessage(summary)` 는 gate3 를 **persisted 정본**
  `summary.gateLayerAudit.gate3Consolidated` 에서 읽는다 (`scanBlockersFormatter.ts`).
  `buildSnapshotBundleFromScanSummary` (base) 도 같은 정본을 읽는다
  (`snapshotBundle.ts:208,249-265`).
- 그러나 `buildGateUxBundle` 가 base 의 정본 gate3 를 **렌더 시점 재계산값으로 덮어쓴다**:
  `gateUx.cmd.ts:157  gate3: gate3SummaryFromRuntimeClosure(buildGate3RuntimeClosureSummary({ traces }))`.
  gate2(:156), execution(:158) 도 `resolveFinalExecutionDecision(input, new Date('1970-01-01'))`
  로 더미 시각 재판정한다.
- `/gate_debug_raw` (`/debug_gate`) → `renderDebugRaw(buildGateUxBundle())` = `JSON.stringify(bundle)`
  (`gateFullRenderer.ts:15`) → 결국 **재계산 표본**을 출력한다.

따라서 두 명령은 서로 다른 표본을 보고 있다: scan_blockers 는 스캔 시점 persisted gate3
표본(ALL_CANDIDATES 집계), debug_raw 는 렌더 시점 traces 재계산 표본(GATE3_TIMING_SAMPLE).
이것은 9대 불변식 #3 "모든 판단은 단일 SourceSnapshot 에서 출발한다" 의 표면 위반이다 —
입력 snapshot 은 같지만, 파생 view 가 두 곳에서 독립 재계산되어 정본이 분기한다.

persisted `summary` 는 이미 정본을 담고 있다 (스캐너/엔진 변경 불요):

- gate3: `gateLayerAudit.gate3Consolidated` (`gateLayerDiagnostics.ts:84-128`) —
  `lastTriggerWaitCount`, `rrrMissingCount`, `executionImpact`, `executionReadyCount`,
  `samples` 등 완비.
- execution: `gate1Survival.liveBuyBlockedCount` / `shadowAllowedCount` +
  `gate3Consolidated.executionImpact` + `canonicalRuntimeResolution.sizing`.
- 입력 정본: `SourceSnapshot` (`server/ssotSnapshot.ts`, ADR-0519).

## Decision

`/gate_debug_raw` (`/debug_gate`) 를 **재계산 번들이 아니라 persisted 정본 슬라이스의 순수
투영**으로 재바인딩한다. 본 ADR 은 Phase 0 — 렌더 레이어 한정, 추론 0.

1. **정본 view 타입 신설** — `server/telegram/renderers/canonicalDebugRawView.ts` 에
   `CanonicalDebugRawView` interface 를 정의한다. persisted `ScanSummary` 에서
   `sourceSnapshotId`, `asOf`, `marketSession`, `engineMode`, `effectiveRegime`,
   `gateLayerAudit` 의 정본 슬라이스(gate3Consolidated 카운터 + gate1Survival 카운터),
   `canonicalRuntimeResolution` 슬라이스를 **순수 추출**한다 (계산/재판정 금지).
2. **scope 태그 의무** — view 의 모든 진단 count 는 `{ scope, value }` 형태로,
   각 숫자가 어떤 표본에서 왔는지 명시한다 (`ALL_CANDIDATES`, `GATE3_TIMING_SAMPLE`,
   `PAPER_OBSERVATIONAL` 등). debug_raw 와 scan_blockers 가 다른 표본을 비교하지
   못하도록 표본 출처를 직렬화한다.
3. **`renderDebugRaw` 재바인딩** — `JSON.stringify(buildGateUxBundle())` 대신
   `JSON.stringify(buildCanonicalDebugRawView(summary))` 를 직렬화한다.
   `buildCanonicalDebugRawView` 의 구현은 engine-dev 가 채운다 (본 ADR 은 계약·경계만 확정).
4. **`buildGateUxBundle` 의 gate3 override 제거** — `gateUx.cmd.ts:157` 의
   `gate3: gate3SummaryFromRuntimeClosure(...)` 를 제거하여 base 의 canonical gate3
   (`buildSnapshotBundleFromScanSummary` 의 `gateLayerAudit.gate3Consolidated` 투영)를
   그대로 쓴다. 이로써 `/gate`, `/gate_detail`, `/gate_full`, debug_raw 가 동시에
   동일 gate3 정본을 본다.
5. **gate2 / execution override 는 Phase 1 (ADR-0526) 까지 유지** — 단, debug_raw 경로는
   `buildGateUxBundle` 을 더 이상 거치지 않으므로 재계산 표본에서 분리된다.

## Consequences

긍정:

- `/gate_debug_raw` 와 `/scan_blockers` 의 gate3 숫자가 byte-equivalent 가 된다 (회귀 테스트로 고정).
- 전 Gate renderer (`/gate`, `/gate_detail`, `/gate_full`) 가 동일 gate3 정본에 정합한다.
- 9대 불변식 #3 (단일 SourceSnapshot) 의 파생 분기가 gate3 축에서 제거된다.
- L4(AI_ESTIMATED) 데이터는 view 에 투영되지 않는다 (정본 슬라이스는 스캔 시점 산출물이며
  순수 추출이므로 #7 격리 위반 없음).

부정 / 제약:

- gate2 / execution 은 본 Phase 에서 여전히 재계산 경로(`buildGateUxBundle`)를 거치는
  compact/detail renderer 와 debug_raw 사이에 잔류 분기가 남는다 (ADR-0526/0527 에서 해소).
- `CanonicalDebugRawView` 가 기존 `SnapshotBundle` 보다 좁은 표면을 직렬화하므로,
  debug_raw 출력의 JSON shape 가 바뀐다 (운영자 가시 변화 — 의도된 정합 정정).

## 영향 파일

- `server/telegram/renderers/canonicalDebugRawView.ts` (신규, 타입+추출 함수 — engine-dev 구현)
- `server/telegram/renderers/gateFullRenderer.ts` (`renderDebugRaw` 재바인딩)
- `server/telegram/commands/system/gateUx.cmd.ts` (gate3 override 제거, debug_raw 경로 분리)
- 회귀 테스트: `server/telegram/renderers/canonicalDebugRawView.test.ts` (신규),
  debug_raw vs scan_blockers gate3 byte-equivalent assertion.

## 회귀 테스트

1. `gate3.lastTriggerWaitCount` / `rrrMissingCount` / `executionReadyCount` / `samples` 가
   debug_raw view 와 `formatScanBlockersMessage` 출력에서 동일.
2. 동일 `ScanSummary` fixture 로 `buildCanonicalDebugRawView(summary)` 와
   `buildSnapshotBundleFromScanSummary(summary).gate3` 의 gate3 카운터 일치.
3. 모든 count 에 `scope` 태그가 부착됨 (스냅샷 테스트).

## 롤백 계획

렌더 레이어 한정 — LIVE 매매 본체 0줄 변경. `renderDebugRaw` 와 `gateUx.cmd.ts` 의 두 커밋을
revert 하면 즉시 이전 동작 복원. ENV 플래그 불요 (KIS/KRX quota 0 침범, 주문 경로 무관).

## 9대 불변식 영향

- #3 (단일 SourceSnapshot): **개선** — gate3 파생 분기 제거.
- #7 (L4 격리): 영향 없음 — view 는 스캔 시점 정본 슬라이스의 순수 추출, AI_ESTIMATED 미투영.
- #1/#2 (Trading Engine / Shadow Learning 생존): 영향 없음 — 렌더 전용.

## Guardrails

- No live trading path change unless explicitly stated.
- No KIS/order import or invocation unless explicitly stated.
- No Gate/Kelly/STRONG_BUY behavior change unless explicitly stated.
- No Shadow policy change unless explicitly stated.
- No provider fetch behavior change unless explicitly stated.
- No data promotion behavior change unless explicitly stated.
