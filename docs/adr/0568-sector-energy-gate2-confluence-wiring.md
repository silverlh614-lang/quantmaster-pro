# ADR-0568: sector energy gate2 confluence wiring

@responsibility quant — sector energy gate2 confluence wiring

## Status

Accepted

## Context

Gate2 confluence의 `SECTOR_LEADERSHIP` 축(weight 20)이 스캔 전 종목에서 MISSING 으로
관측됐다(`/scan_blockers_gate2` → "Sector 0/25", topMissing=SECTOR_LEADERSHIP_MISSING,
0 strong). 2026-06-04 원인조사 결과는 **데이터 부재가 아니라 배선 갭**이었다.

- `macroState.sectorEnergyResult`(evaluateSectorEnergy 산출)는 존재하고, score boost
  (entryRevalidationGate / buyListLoop), 포지션 상한(getSectorPositionLimit),
  표시용 `sectorLeadershipScore`(signalScanner/index.ts)에는 이미 소비된다.
- 그러나 Gate2 confluence external coverage 입력
  (`gate2ExternalCoverageInput.sectorEnergyResult`)으로는 어디서도 채워지지 않았다.
  타입 필드(`Gate2ExternalCoverageInput.sectorEnergyResult?`)와 소비부
  (`externalCoverage.ts`의 `normalizeSectorThemeCycleForGate2` 호출)는 이미 존재했으나,
  생산부(`evaluateServerGate` 호출처)가 값을 thread 하지 않았다.
- 결과적으로 `buildSectorAxis`(gate2ConfluenceScore.ts)가 sectorCycle/leaderCycle 을
  빈 값으로 받아 status≠VERIFIED → `missingAxis('SECTOR_LEADERSHIP')` → 전 종목 0/25.

이는 universe 反모멘텀 스크린(ADR-0550/0551 계열, "누가 평가받나")과 **별개의**, 더 하부
배선 문제다("평가축에 데이터가 안 옴"). clean 0/25 + MISSING 사유가 그 지문이다.

영향 메커니즘: 누락 축은 감점이 아니라 `coverageAdjustedScore = weightedSum / usableWeight`
(분모 제외·재정규화)라 직접 페널티는 아니다. 그러나 (1) GATE2_PASS_STRONG 의
`bullishAxisCount >= 3` 동시조건에서 섹터(weight 20)가 영구 MISSING 이면 5중 1 bullish
슬롯이 죽고, (2) 진짜 주도섹터 종목의 SECTOR 95/72 상단이 제외돼 우량 후보 천장이 눌린다 →
"0 strong" 지문.

## Decision

`SECTOR_ENERGY_GATE2_WIRING_ENABLED`(default OFF, 명시적 `=== 'true'` opt-in) 플래그로
배선 갭을 닫는다.

- **소비 지점 gate**(SSOT): `externalCoverage.ts`의 `normalizeSectorThemeCycleForGate2`
  입력에서 `sectorEnergyResult` 를 `isSectorEnergyGate2WiringEnabled() ? input.sectorEnergyResult : undefined`
  로 통과/차단. OFF 면 caller 가 thread 하더라도 undefined 로 무시 → sectorCycle 빌드가
  현행과 byte-identical.
- **생산 지점 thread**: scan caller(`stockScreener.ts`, `universeScanner.ts` ×2)에서
  `evaluateServerGate(..., { sectorEnergyResult: macroState?.sectorEnergyResult })` 로
  무조건 thread(8번째 인자 `gate2ExternalDiagnostics`는 기존 통로, `macroState` 는 이미 scope).
- 플래그 SSOT: `server/trading/gate2/sectorEnergyGate2WiringFlag.ts`.

## Consequences

- **executionImpact ≠ NONE (ON 시)**: SECTOR_LEADERSHIP 축이 채워지면
  `coverageAdjustedScore` 가 이동하고 일부 `gate2Status`(특히 STRONG 의 bullishAxisCount
  조건)가 바뀐다. 이는 명시적 의도다 — Gate2 confluence 가 섹터 리더십을 비로소 반영한다.
- **OFF(default) = byte-identical**: 소비 지점 gate 가 단일 reader 이므로, caller thread 가
  추가돼도 OFF 경로 출력은 불변. 회귀 테스트(gate2Diagnostics.test.ts ADR-0568)가
  OFF=미전달과 deep-equal, ON=흐름을 잠근다.
- **데이터 품질 의존**: 섹터 데이터가 VERIFIED/PARTIAL 일 때만 축이 채워진다. off-hours /
  sector-index-master 결손 시 ON 이어도 MISSING — 정상 동작(silent degradation 아님).
- 활성화: ENV `SECTOR_ENERGY_GATE2_WIRING_ENABLED=true`. 롤백: 제거/`false` 1줄.

## Guardrails

- No live trading path change while flag OFF (default). 실주문/Kelly/Shadow 경로 무변.
- **Gate2 behavior change is intentional and flag-gated**: ON 시 SECTOR_LEADERSHIP 축
  활성화로 coverageAdjustedScore/gate2Status 가 이동할 수 있다(위 Consequences). OFF 면 불변.
- No KIS/order import or invocation added.
- No provider fetch behavior change — sectorEnergyResult 는 이미 macroState 에 존재하는 값을
  재사용(신규 fetch 없음).
- No data promotion behavior change.
