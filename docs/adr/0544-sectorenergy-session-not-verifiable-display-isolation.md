# ADR-0544: SectorEnergy Session-Not-Verifiable Display Isolation

@responsibility sector-energy/display — 휴일/비장중 KIS index verify-skip 을 소스 결함(MISSING) 과 표시상 분리. 게이팅(promotion/11섹터 정책) 1bit 무변경, executionImpact NONE, ENV gated byte-equivalent.

## Status

Accepted / Display-only. ENV `SECTOR_ENERGY_SESSION_ISOLATION_ADR0544_DISABLED` default unset (ON).
ADR-0534(SectorEnergy Canonical Baseline Lock) / ADR-0488 게이팅 결정 상속 — 변경하지 않는다.

Tags: sector-energy / display-classification / session-isolation / provider-policy / shadow-only

## Context

휴일(`marketSessionState=HOLIDAY`)에 KIS index quote verify 가 **의도적으로 스킵**된다
(`SectorIndexVerifier.buildOfficialSectorIndexMasterCoverage({marketClosed:true})` — KIS quota 0 침범).
이때 `verifiedOfficialSectorCount=0` 이 되는데, canonical resolver 입력에 세션 신호가 없어
휴일 스킵과 "장중 실제 verify 0건(소스 결함)" 을 구별하지 못했다. 결과적으로
`SectorEnergyCanonicalResolver` 가 `dataQuality=MISSING / reason=OFFICIAL_SECTOR_SOURCE_MISSING /
selectedSourceTier=NONE` 으로 **실제 소스 결함처럼 과장 표시**했다.

또한 휴일 스킵 시 `kisIndexQuoteClientStatus` 가 `undefined` 라서 render 기본값
(`enabled=false authReady=false tokenPresent=false`)이 **인증 장애처럼** 보였고, operator action 은
P1 "Repair SectorEnergy index master" 로 노출되어 휴일에 불필요한 수리 액션을 유발했다.

게이팅(`promotionCoveragePass = verified/11 ≥ 0.8`)은 휴일 verified=0 → false 로 **이미 정확**했다.
즉 결함은 게이팅이 아니라 **표시 과장**이다. 세션 신호(`SECTOR_INDEX_MARKET_CLOSED` /
`HOLIDAY_NO_SESSION_OBSERVE_ONLY`, `providerIssue:false`)는 이미 master.reasonCodes 까지 carry 되어
있었다 — 어댑터 매핑만 부재했다.

## Decision

1. **세션 분리 (표시 전용).** `SectorEnergyDataQuality` 에 `SESSION_NOT_VERIFIABLE`,
   `SectorEnergyCanonicalReason` 에 `SECTOR_INDEX_VERIFY_SKIPPED_SESSION_CLOSED` 추가.
   canonical state 에 표시 필드 `status` / `confidenceLabel` / `sectorIndexVerifyMode` 추가.
   resolver 입력에 **선택적** `sessionVerifiability { sessionClosed, verifySkipped }` 추가.
   어댑터(`deriveSectorEnergyCanonicalState`)가 master.reasonCodes 로부터 매핑한다.
   `sessionClosed && verifySkipped && verified===0` 3조건 AND 일 때만 표시 재분류:
   `dataQuality=SESSION_NOT_VERIFIABLE / reason=SECTOR_INDEX_VERIFY_SKIPPED_SESSION_CLOSED /
   status=OBSERVE_ONLY_SESSION_CLOSED / confidenceLabel=LAST_KNOWN_OR_OBSERVE_ONLY /
   sectorIndexVerifyMode=VERIFY_SKIPPED_SESSION_CLOSED`. **장중 실제 verify 0건은 기존
   MISSING/OFFICIAL_SECTOR_SOURCE_MISSING 유지** (분류 분리).
2. **게이팅 불변 (★).** `promotionAllowed / sectorBoostAllowed / strongBuyAllowed` 는 오직
   `promotionCoveragePass` 단일 식에서만 파생되며 재분류 블록은 이 라인을 읽지도 쓰지도 않는다.
   휴일 verified=0 → 전부 false 그대로. `shadowLeadershipAllowed / counterfactualAllowed = true`,
   `executionImpact = 'NONE'` 유지. 공식 11섹터 정책 상수·`promotionCoveragePass` 산식 0줄 변경.
3. **KIS index quote client status 표시 분리.** session-closed → `sessionCallable=false
   skipReason=SESSION_CLOSED_OR_HOLIDAY authReady=NOT_REQUIRED_FOR_SKIPPED_VERIFY
   tokenPresent=NOT_REQUIRED_FOR_SKIPPED_VERIFY providerIssue=false executionImpact=NONE`.
   실제 인증장애(verify 시도했으나 authReady=false) → `skipReason=AUTH_NOT_READY providerIssue=true`.
   **휴일 스킵을 providerIssue=true 로 승격하지 않는다** (불변식 #6: providerIssue ≠ bearish).
4. **operator action 세션별 우선순위.** 휴일/비장중 source → `REPAIR_SECTOR_INDEX_MASTER` P1→P3
   강등 + "Observe SectorEnergy verify on next trading session" 안내. 장중 실패 → P1 유지.
5. **Bottleneck Truth Summary SectorEnergy Health 블록** 추가 (Official sector master: LOADED /
   Live index verify: SKIPPED_SESSION_CLOSED / Promotion: DISABLED_FOR_SESSION / Shadow evidence:
   ALLOWED / ExecutionImpact: NONE / OperatorMessage).
6. **last-known snapshot 정책은 persistent store(infra) 필요 → 후속 PR(PR-2)로 분리.** 본 PR 은
   "no last-known" 정직 표시만.

## Consequences

표시 정합성 ↑. 게이팅·실거래·공식 11섹터 정책 0 변경. executionImpact=NONE.
ENV `SECTOR_ENERGY_SESSION_ISOLATION_ADR0544_DISABLED=true` 1줄로 어댑터가 세션 신호 전달을
중단 → 휴일 입력도 기존 MISSING 표시로 즉시 복귀(byte-equivalent rollback). 게이팅은 어차피
불변이므로 ENV on/off 와 무관하게 promotion=false.

## Invariants 유지

- #4 SourceSnapshot 불변 (canonical state 는 SourceSnapshot 산식 미접촉).
- #6 providerIssue ≠ bearish (휴일 스킵 providerIssue=false 보존).
- #7 L4 미사용 (KIS L1 verify 스킵 로직 그대로, KRX/KIS quota 0 침범).
- #8 실거래 차단과 Shadow 차단 분리 (shadowLeadershipAllowed/counterfactualAllowed=true 유지).
