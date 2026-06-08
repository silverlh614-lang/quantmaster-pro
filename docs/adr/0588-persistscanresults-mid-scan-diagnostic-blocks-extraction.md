# ADR-0588: persistScanResults mid-scan diagnostic blocks extraction

@responsibility refactor — persistScanResults mid-scan diagnostic blocks extraction

## Status

Accepted

## Context

`server/trading/signalScanner/scanDiagnostics/persistScanResults.ts` 가 1,989 LoC 로 ACMA 1,500줄 한계를
초과해 `BASELINE_TECHNICAL_DEBT` 카탈로그에 등재된 마지막 잔존 baseline 이었다(2026-05-24 governance
unblock). god 함수 `persistScanResults()`(~1,784 LoC, cc=249)가 파일 대부분을 차지하며, 함수 본체는
ADR-0420~0527 의 ~25개 독립적 진단 블록(각 `try { build; await persist } catch { warn }`) 시퀀스다.

## Decision

god 함수 중 **ADR-0477~0527 진단 블록 구간(라인 1051~1727, 677 LoC)** 을 신규 동일-디렉토리 leaf 모듈
`scanDiagnostics/persistScanResultsMidBlocks.ts` 의 `persistMidScanDiagnosticBlocksAdr0588(ctx)` 로 추출한다.

- 추출 전 정적 검증: 해당 구간에 함수-스코프 const 누출 0건(유일 const `canonicalRuntimeResolutionForRootCause`
  는 구간 내 소비, 1731+ 참조 0), 모듈-level `let` 사용 0건 확인. 구간이 읽는 prologue local 은 10개
  (`kstNow`/`timeLabel`/`totalCandidates`/`sourceSnapshotId`/`scanCandidateSnapshots`/`scanEvaluation`/
  `gateLayerAudit`/`summaryDraft`/`counters`/`options`)뿐 → 단일 ctx 객체로 명시 전달.
- **`summaryDraft` 는 참조 전달** — 추출 helper 가 동일 객체를 변형(`summaryDraft.X = ...`)하므로, 호출자
  persistScanResults 의 후속 canonical 영속(`_lastScanSummary = summaryDraft`)이 모든 변형을 관찰(byte-equivalent).
- import 블록은 동일 디렉토리 배치로 상대경로 재작성 없이 그대로 사용. ctx 타입은 `ReturnType<typeof build*>`
  /인덱스 접근으로 정확 바인딩.

## Consequences

- `persistScanResults.ts` 1,989 → 1,316 LoC, 신규 모듈 878 LoC — 둘 다 ACMA 1,500 한계 자연 통과.
  `check_complexity.js` BASELINE_TECHNICAL_DEBT 에서 정식 제거 → **baseline 0건, 파일한계 enforcement 완전 복원.**
- 판단/진단 로직·실행 순서·`await` 영속 호출 인자 전부 보존(byte-equivalent). 신규 outbound(KIS/KRX/Yahoo) 0건,
  executionImpact=NONE (스캔 진단 영속 = read-only consumer). 9대 불변식 무영향.
- lint EXIT=0 (client `tsc --noEmit` + server `tsconfig.server.json`), scanDiagnostics 회귀 126/126 pass(무회귀).
- 잔존 god 함수 cc 추가 축소(나머지 블록 추출)는 후속 ADR 로 분리.

## Guardrails

- No live trading path change unless explicitly stated.
- No KIS/order import or invocation unless explicitly stated.
- No Gate/Kelly/STRONG_BUY behavior change unless explicitly stated.
- No Shadow policy change unless explicitly stated.
- No provider fetch behavior change unless explicitly stated.
- No data promotion behavior change unless explicitly stated.
