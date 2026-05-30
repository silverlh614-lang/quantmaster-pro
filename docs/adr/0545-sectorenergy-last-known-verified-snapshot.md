# ADR-0545: SectorEnergy Last-Known Verified Snapshot (Display + Shadow-Only)

@responsibility sector-energy/display — 휴일/세션닫힘에 직전 verified sector snapshot 영속·표시(LAST_KNOWN_VALID). 표시+shadowEvidence 전용, live promotion 절대 비활성, executionImpact NONE, ENV gated byte-equivalent.

## Status

Accepted / Display + shadow-only. ENV `SECTOR_ENERGY_LAST_KNOWN_SNAPSHOT_ENABLED` default OFF.
ADR-0544(Session-Not-Verifiable Display Isolation) 후속(PR-2). ADR-0534/0488 게이팅 결정 상속 — 변경하지 않는다.

Tags: sector-energy / display-classification / last-known-snapshot / persistence / shadow-only

## Context

ADR-0544(PR-1)는 휴일/비장중 verify-skip 을 `SESSION_NOT_VERIFIABLE` 로 표시 분리하되,
last-known snapshot 정책은 전용 persistent store 부재로 분리·보류했다
(`sectorEnergyCanonicalStateRef.ts` 는 in-memory 단일 ref — 재시작 소실, 날짜별 store 아님).
그 결과 휴일엔 직전 거래일의 verified sector 상태를 "no last-known" 으로만 표시했다.

본 PR(PR-2)은 직전 장중 verify 성공 시점의 검증 스냅샷을 영속하는 전용 repo 를 도입하여,
휴일/세션닫힘에 직전 verified 상태를 **표시 + shadowEvidence 근거**로 노출한다.
게이팅(`promotionCoveragePass = 당일 verified/11 ≥ 0.8`)은 당일 verified=0 기준을 유지하므로
last-known 이 있어도 **live promotion 은 절대 활성화하지 않는다**.

## Decision

1. **신규 persistent repo** `server/persistence/sectorEnergyVerifiedSnapshotRepo.ts` — 기존
   `*Repo.ts` 영속 패턴(atomic tmp+rename, validRecord 필터, MAX rows 트림) 재사용.
   레코드: `{snapshotId, asOf, tradeDate, verifiedOfficialSectorCount, promotionCoverage, selectedSourceTier}`.
   write/read(latest, byTradeDate, last-known) API.
2. **write (verify 성공 시에만).** 어댑터 `deriveSectorEnergyCanonicalState` 가 resolver 결과의
   `verifiedOfficialSectorCount > 0` 이고 **세션 open**(sessionVerifiability 부재)일 때만 snapshot
   영속. 휴일/세션닫힘·verified=0 이면 write 안 함. repo 도 `count<=0`·잘못된 tradeDate 이면 미저장.
3. **read 우선순위 (휴일/세션닫힘).** same tradeDate intraday verified → previous trading day EOD
   verified → 그 이전 가장 최근 EOD → 없으면 부재. 세션닫힘일 때만 read 한다.
4. **표시 필드 (휴일/세션닫힘일 때만).** last-known 존재 시
   `sectorIndexVerifyMode=LAST_KNOWN_VALID` + `lastKnown{ lastKnownSectorSnapshotId/AsOf,
   lastKnownVerifiedOfficialSectorCount, lastKnownPromotionCoverage, lastKnownSourceTier,
   lastKnownAgeTradingDays, lastKnownUsableForLivePromotion=false, lastKnownUsableForShadowEvidence=true }`.
   부재 시 `reason=SESSION_CLOSED_NO_LAST_KNOWN_SECTOR_SNAPSHOT` +
   `sectorIndexVerifyMode=VERIFY_SKIPPED_SESSION_CLOSED`.
5. **게이팅 불변 (★).** last-known 표시 블록은 `promotionAllowed/sectorBoostAllowed/strongBuyAllowed/
   promotionCoveragePass` 라인을 읽지도 쓰지도 않는다. 당일 verified=0 이므로 promotion=false 유지.
   `lastKnownUsableForLivePromotion` 은 타입 레벨로 `false` 고정 (세션닫힘 live promotion 금지 SSOT).
   공식 11섹터 정책 상수·promotionCoveragePass 산식 0줄 변경.
6. **ENV 게이트.** `SECTOR_ENERGY_LAST_KNOWN_SNAPSHOT_ENABLED` default OFF → 미설정 시 write·read
   모두 미수행 = PR-1(ADR-0544) 동작 그대로 (byte-equivalent). 1줄 롤백.

## Consequences

휴일/세션닫힘 표시 정합성 ↑ (직전 verified 근거 노출 + shadow evidence 가용). 게이팅·실거래·공식
11섹터 정책 0 변경. executionImpact=NONE. ENV OFF 시 byte-equivalent. KIS/KRX quota 0 침범
(verify 스킵 로직 그대로, repo 는 로컬 파일 I/O 만).

## Invariants 유지

- #4 SourceSnapshot 불변 (canonical state·repo 는 SourceSnapshot 산식 미접촉).
- #6 providerIssue ≠ bearish (휴일을 bearish 변환·providerIssue 승격 안 함).
- #7 L4 미사용 (snapshot 은 L1 KIS/KRX official verify 결과 영속, live promotion 미사용).
- #8 실거래 차단과 Shadow 차단 분리 (last-known shadowEvidence 전용, live promotion=false 유지).
