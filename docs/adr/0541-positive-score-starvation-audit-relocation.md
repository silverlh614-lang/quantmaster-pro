# ADR-0541: Positive Score Starvation Audit Relocation to persistScanResults

@responsibility gate-system/diagnostics — ADR-0467 starvation audit 누적을 per-symbol intraday re-check 단계에서 persistScanResults(entryFilterDecomposition 직후)로 이전하여 canonical minSignalScoreTrace.components 를 공급, CORE_SIGNAL 오귀속 정정. executionImpact=NONE.

## Status

Accepted (구현 완료 — `90d8e68`). 본 문서는 **구현된 결정**을 반영한다 (§Decision 2 스케일 정합은
DESIGN.md §6.4 의 `÷scale` 안을 코드 확인 후 대체 — 아래 근거 참조).

## Context

ADR-0467 Positive Score Starvation Audit 의 "momentum 0 starvation" 은 진단 귀속 오류로
확정됐다. 직전 PR #1316(`4386ae8`)이 소비 로직을 머지했다:
`buildGate1ScoreStarvationTraceFromGateResult`(`gate1PositiveScoreStarvation.ts:534`)가
옵셔널 `minSignalComponents` 공급 시 CORE_SIGNAL 기여(PRICE_MOMENTUM 등)를 canonical
`minimumSignalScoreTrace.components[code].weightedScore` 에서 읽고, 미공급 시 기존
Gate2-level outputs 폴백(byte-equivalent, infra-only)을 유지한다.

미해결: 런타임이 `minSignalComponents` 를 공급하지 못한다. 누적 시점 문제 때문이다.

- per-symbol 루프(`buyListLoop.ts:353`)의 `kisIntradayCorrectionStep`
  (`perSymbol/steps/kisIntradayCorrection.ts:125`)에서
  `accumulatePositiveScoreStarvation` 이 `reCheckGate`(ServerGateResult)만 가진 채 누적한다.
  이 시점엔 `minimumSignalScoreTrace` 가 **아직 미생성** → minSignalComponents 공급 불가
  → CORE_SIGNAL 이 Gate2-level outputs 에서 추정되어 OTHER_POSITIVE 로 leak 되고
  PRICE_MOMENTUM 이 거짓 zeroContribution 으로 표시된다.
- 루프 종료 후 `persistScanResults`(`scanDiagnostics/persistScanResults.ts:678`)에서
  `buildEntryFilterDecomposition` → `decompositionBuilder.ts:433 buildGate1CandidateTrace`
  → `gate1CandidateTrace.ts:307 buildMinimumSignalScoreTrace` 가 per-candidate
  `minSignalScoreTrace.components`(PRICE_MOMENTUM weightedScore 등)를 **비로소 생성**한다.
  ADR-0505/0507 forensic 도 동일 단계에 거주한다.

즉 audit 이 components 보다 **먼저** 누적되어 공급이 구조적으로 불가능하다.

조사 산출물: `_workspace/2026-05-29_starvation-wiring/architect/DESIGN.md`.

## Decision

1. **누적 위치 이전**: `accumulatePositiveScoreStarvation` 호출을 per-symbol
   `kisIntradayCorrection.ts:122-139` 에서 제거하고, `persistScanResults.ts` 의
   `buildEntryFilterDecomposition`(line 678) 직후로 이전한다. 후단에서
   `entryFilter.gate1CandidateTraces[]` 를 순회하며 각 candidate 의
   `minSignalScoreTrace.components`(canonical `{code,weightedScore,maxScore,confidence}`)를
   `minSignalComponents` 로 공급한다. 소비 로직(gate1PositiveScoreStarvation.ts)은 무변경.

2. **스케일 정합 — score 소스는 minSignalScoreTrace (NOT gateRawScore)**: 구현 중 코드 확인
   결과 스케일이 이종(異種)임이 드러났다 — `minSignalScoreTrace.requiredScore` /
   `.actualScore` / `.components[].weightedScore` 는 모두 **절대 0~100 스케일**(컴포넌트
   maxScore 합 ≈ 84+)인 반면, `gateRawScore`(reCheckGate.rawScore)는 **별개의 0~15 float**
   라 컴포넌트와 incoherent 하다. 한편 소비측(`gate1PositiveScoreStarvation.ts:537,653-654`)은
   `requiredScore*scale` · `actualScore=rawScore*scale`(scale 기본 10)로 스케일을 곱하지만
   canonical components 의 `weightedScore` 는 raw 그대로 쓴다(line 594). 따라서 모든 수치를
   하나의 0~100 스케일로 정합시키고 이중 스케일을 막기 위해, 누적 호출에 **`scoreScale: 1`
   + `requiredScore = minSignalScoreTrace.requiredScore`(0~100) + `rawScore =
   minSignalScoreTrace.actualScore`(0~100, gateRawScore 아님)** 를 전달한다.
   `normalizedGateScore/availableMaxScore` 는 candidate trace 값을 컨텍스트로만 동반한다.
   - 이는 DESIGN.md §6.4 의 `requiredScore/scale`(÷10, scale=10 상쇄) 안을 대체한다 — 그 안은
     rawScore 도 0~10 임을 전제했으나 실제 gateRawScore 는 0~15 라 components(0~100)와
     맞지 않는다. 테스트 `T1b` 가 `scoreScale:10` 변형이 requiredScore 600/actualScore 560
     으로 깨짐을 명시 대조해 증명한다.
   - **부수효과 — 결정 3(gateResult parity) moot**: score 수치를 gateRawScore 가 아니라
     minSignalScoreTrace.actualScore 에서 취하므로, buyList 미진입 candidate 의 gateRawScore
     SSOT(워치리스트값) 논점은 actualScore 정합과 무관해진다. intraday reCheckGate 를 후단으로
     carry 하는 별도 SSOT 도 불필요하다.

3. **커버리지 모집단 변화 허용**: 누적 대상이 buyList subset(예 18)에서 candidateSet
   전체(예 24)로 바뀐다. starvation audit 의 목적은 positive-score 굶주림의 *모집단*
   진단이므로 전수가 대표성 측면에서 우월하다. report 의 totalCandidates 가 candidateSet
   기준임을 정책으로 명문화한다. per-symbol subset 별도 보존은 하지 않는다(gateScoreHealth/
   nearMiss 가 subset 통계를 이미 커버).

4. **report 빌드 순서**: `buildPositiveScoreStarvationReport` 호출을 summaryDraft 초기화
   (line 347)에서 신규 누적 루프 직후 + ADR-0467 fallback(line 736) 직전으로 재배치하여
   누적→집계 순서를 보장한다.

## Consequences

- starvation report 의 CORE_SIGNAL(PRICE_MOMENTUM/TECHNICAL_TREND/RELATIVE_STRENGTH/
  BREAKOUT_STRUCTURE/VOLUME_LIQUIDITY/WATCHLIST_UPSTREAM_SCORE) 귀속이 canonical
  weightedScore 로 정정된다. OTHER_POSITIVE leak 및 거짓 zeroContribution 제거.
- report.totalCandidates 및 ADR-0468~0472 dry-run 체인의 advisory 카운트가 분모 변화로
  변동한다. 모두 dry-run/advisory → executionImpact=NONE 유지.
- hot-path(per-symbol 루프)에서 누적 1건 제거 → 부하 감소. persistScanResults 후단에
  단일 try/catch 격리 루프 추가 → 빌드 실패가 엔진을 멈추지 않는다.
- /scan_blockers starvation 섹션 표시 수치 변동(display-only, HTML 구조 무변경).
- 9대 불변식 무위반: score curve / Gate pass-fail / LIVE / regime / engineMode /
  SourceSnapshot / Shadow / Provider 무변경. 진단 전용.

## Alternatives Considered

- **per-symbol 단계에서 trace 조기 빌드**: minimumSignalScoreTrace 의 입력
  (supplyConfluenceState, hasSectorEnergyDiagnostic 등 decomposition 전용 파생값)이
  미조립 → trace 부분 재구현 = 코드 중복 + SSOT 분기 위험. 기각.
- **components 를 ctx.scanCounters 에 carry 후 후단 소비**: 결국 조기 빌드를 요구하고
  hot-path 메모리/payload 증가. 최소위험 아님. 기각.
- **현행 infra-only 폴백 유지**: momentum 0 오귀속 영구 미해결. 요구 미충족. 기각.
- **fallback(ADR-0466 telemetry) 경로를 canonical 화**: report 의미 약화(min-signal
  telemetry 기반). 권고하지 않음. 기각.

## References

- PR #1316 (`4386ae8`) — 소비 로직 + 폴백 머지.
- ADR-0467 Positive Score Starvation Audit.
- ADR-0466 Minimum Signal Score Telemetry.
- ADR-0505 Gate1 Minimum Signal Forensic Audit / ADR-0507 forensic collector wiring.
- `_workspace/2026-05-29_starvation-wiring/architect/DESIGN.md` (경계 설계·patch-plan).
- 영향 파일: `server/trading/signalScanner/perSymbol/steps/kisIntradayCorrection.ts`,
  `server/trading/signalScanner/scanDiagnostics/persistScanResults.ts`.
