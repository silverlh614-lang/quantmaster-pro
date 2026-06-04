# ADR-0570 — Sector Index 20d/5d Return Cycle Wiring (Gate2 sectorReturn20d 배선)

- **Status**: Accepted (2026-06-04)
- **Context**: PR-Sector-Index-Cycle-Wiring (ADR-0423 후속)
- **Related ADRs**: ADR-0423 (SectorEnergy indexCode coverage / symmetry repair), ADR-0422 (Gate2 leadership attribution / SECTOR_DATA_STALE_DOMINANT), ADR-0448 (Trading Engine Liveness First — auxiliary no hard-block), ADR-0534/0545 (SectorEnergyCanonicalResolver baseline lock / verifiedMapping), ADR-0075/0400 (sector score boost LEADING +2 / LAGGING -1), ADR-0157 (ENV 정확 비교), ADR-0561 (KIS Primary Absolute).
- **Boundary**: `server/clients/sectorIndexCycleProvider.ts` (신규 SSOT), `server/clients/sectorEnergyProvider.ts` (buildInputsFromDeltas 배선), `.env.example` (flag 문서화). 신규 데이터 경로 = KIS 섹터 index daily (`fetchKisSectorIndexDaily`).

## Context

ADR-0423 가 SectorEnergy indexCode coverage 진단을 정정했고, ADR-0422 가 Gate2 `SECTOR_DATA_STALE_DOMINANT` 를 분해했다. 그러나 `/scan_blockers` Gate2 sector cycle 진단축은 여전히 "Sector 0/25"(SECTOR_THEME_CYCLE_MISSING) 로 비어 있었다.

근본원인 (확정):

- Gate2 sector cycle 정규화기 `sectorThemeLeaderCycleNormalizer.ts` 의 `REQUIRED_FIELDS = [sector, stockReturn20d, sectorReturn20d]` 중 `sectorReturn20d` 가 항상 null → `providerStatus=FIELD_MISSING` → `gateLayerDiagnostics.sectorReturn20d=false` → "Sector 0/25".
- 이유: `sectorEnergyProvider.ts:buildInputsFromDeltas`(KRX_CODE·STOCK_DAILY·indexName fallback 모든 경로의 단일 chokepoint)가 `SectorEnergyInput` 에 `return4w / volumeChangePct / foreignConcentration` 만 채우고 **`sectorReturn20d` 는 전혀 채우지 않는다**.
- 결과: `evaluateSectorEnergy`(src/services/quant/sectorEnergyEngine.ts)의 `hasKisSectorMetrics` 분기 미점화 → `scores[].sectorReturn20d` 부재 → 정규화기 `sectorEnergyScore.sectorReturn20d` undefined → return4w fallback 도 동작하나, live 경로의 sectorEnergyResult 에 해당 sector score 가 매칭되지 않거나 sector cycle 축이 채워지지 않음 → MISSING.

KIS(L1)가 공급 가능한 공식 섹터 index daily(`fetchKisSectorIndexDaily`, FHKUP03500100, `realDataKisGet` SSOT 경유)는 이미 가용하나 cycle 입력으로 미배선이었다.

## Decision

공식 섹터 index 20d/5d return 을 `SectorEnergyInput.sectorReturn20d`(+`sectorReturn5d`)에 배선한다. **flag default OFF — byte-equivalent(미배선·KIS 추가콜 0) 유지가 기본.**

### D1 — fetch 재사용 (raw KIS 0)

`fetchKisSectorIndexDaily(iscd, fromDate?, toDate?, priority)` (`server/clients/kisClient/query/sectorIndex.ts:302`) 를 그대로 재사용. 이미 `realDataKisGet`(kisClient SSOT, 회로차단/blacklist/jitter 자동) 경유 → **§2.2-2 KIS 단일 통로 충족, raw KIS 0**. default 윈도우 today-30d~today(≥20 거래일), `KisSectorIndexDaily.series[].close` 반환.

섹터→iscd 매핑 SSOT 재사용: `OFFICIAL_SECTOR_ENERGY_BASE_VERIFY_TARGETS`(`src/domain/sector-energy/SectorEnergyCanonicalResolver.ts:299`, verifiedMapping key→sectorName→indexCode: 반도체→4003, 자동차→4002, 화학→0008, 금융→0021 …). **신규 매핑 생성 0** — StrategicSector(KRX 12-섹터명)→공식 섹터명 bridge 만 추가하고 iscd 값은 base targets SSOT 에서 조회.

### D2 — 캐시 / 배치 (KIS quota)

`sectorIndexCycleProvider.getSectorCycleReturns()` 가 섹터당 1콜(~11콜)만, refresh 당 1회. 6h+ TTL 캐시(휴장 인지). **후보당 재fetch 0** — `buildSectorEnergyInputsWithMetaRaw` 진입 시 1회 fetch 후 module-local Map 으로 `buildInputsFromDeltas` 가 read. ADR-0561 정합(KIS primary, Yahoo 0).

### D3 — 배선 지점

`buildInputsFromDeltas` 가 per-sector `sectorCycleInputFields(cycleMap, sector)` 를 spread. finite 한 `sectorReturn20d`/`sectorReturn5d` 만 부착. → `evaluateSectorEnergy` `hasKisSectorMetrics` 점화 → `scores[].sectorReturn20d` 살아남 → `normalizeSectorThemeCycleForGate2:320` 이 값 획득 → sectorCycle `OK_WITH_DATA`/`PARTIAL_WITH_DATA`.

### D4 — flag

`SECTOR_INDEX_CYCLE_WIRING_ENABLED` default **OFF**(ADR-0157 정확 비교 `=== 'true'`). OFF = 현행(빈 Map → 미배선 → MISSING 유지, KIS 추가콜 0, byte-equivalent). ON = 배선. throw 격리(`getSectorCycleReturnsForBuild` 내부 try/catch) — fetch 실패가 sectorEnergy build 전체를 막지 않음(graceful 미배선 복귀).

### D5 — executionImpact 판정 (b: Gate Score/STRONG_BUY 영향 — execution-adjacent)

배선된 `sectorReturn20d` 는 **(a) Gate2 sector cycle 진단축에만 들어가는 것이 아니라** **(b) 실제 Gate Score sector boost 에도 영향한다**:

추적: `buildInputsFromDeltas` → `evaluateSectorEnergy(meta.inputs)`(marketDataRefresh.ts:1348) → live `sectorEnergyResult` 영속 → `applySectorScoreBoost`(server/trading/sectorScoreBoost.ts)가 `classifySectorTier`(leadingSectors/laggingSectors)로 +2/-1 부여.

`hasKisSectorMetrics`(sectorEnergyEngine.ts:90) 가 `sectorReturn20d` finite 시 true → **scoring formula 분기 변경**(return4w×0.4 → sectorReturn5d×0.30 + sectorReturn20d×0.25 …) → `energyScore` 변경 → tier ranking(LEADING/LAGGING) 변경 → `applySectorScoreBoost` +2/-1 변경 → STRONG_BUY 게이팅(Gate Score≥9)에 영향 → **매수 후보 점수 변동 가능**.

∴ **execution-adjacent → default OFF + shadow 검증 필수**(본 PR 은 wiring + flag 제공, shadow A/B 는 운영 활성 전 별건). diagnostic-only(a) 가 아님을 명시 보고.

### D6 — sector=UNKNOWN 잔존

종목→sector 매칭이 UNKNOWN 이면 `normalizeSectorThemeCycleForGate2` 가 `sector=null → FIELD_MISSING` 으로 그 종목은 여전히 MISSING(sectorReturn20d 배선과 무관, 분류 SSOT 별건). 본 PR 은 분류 SSOT 를 건드리지 않는다(ADR-0534 verifiedMapping 무접촉). **핵심 승리 = 분류된 종목의 sectorReturn20d 배선**. 잔존 UNKNOWN 종목 분류 보강은 별건(분류 SSOT PR).

## Patch Scope Guard (ADR-530)

- **targetDomain**: SectorEnergy provider 입력 합성 + Gate2 sector cycle 진단.
- **allowedFiles**: `server/clients/sectorIndexCycleProvider.ts`(신규), `server/clients/sectorEnergyProvider.ts`(buildInputsFromDeltas 배선 4줄), `.env.example`, 테스트 2종, 본 ADR + INDEX.md.
- **forbiddenFiles**: `sectorEnergyEngine.ts`(scoring formula 무변경), `sectorScoreBoost.ts`(boost matrix 무변경), `sectorThemeLeaderCycleNormalizer.ts`(REQUIRED_FIELDS·marketSignal 무변경), `SectorEnergyCanonicalResolver.ts`(verifiedMapping 무접촉), `kisClient/**`, `autoTradeEngine*`.
- **expectedBehaviorChange**: flag OFF → 없음(byte-equal). flag ON → sectorReturn20d 배선 → Gate2 Sector 진단축 채워짐 + Gate Score sector tier 변동 가능.
- **sourceSnapshotImpact**: 없음(불변식 #3·#9 — provider 우회 0, SourceSnapshot 구조 무변경).
- **executionImpact**: flag OFF NONE / flag ON execution-adjacent(D5).
- **shadowLearningImpact**: 없음(차단 0, 불변식 #2).
- **telegramImpact**: 없음(진단 출력은 기존 formatter 자동 반영).
- **providerImpact**: flag ON 시 refresh 당 ~11 KIS 콜(6h+ 캐시, 후보당 재fetch 0). flag OFF 시 0.
- **testsRequired**: return 계산(정상/거래일부족)·flag OFF byte-equal·캐시(재fetch 0)·graceful throw·배선 후 sectorCycle MISSING 해소·marketSignal=false·UNKNOWN 잔존.
- **rollbackPlan**: `SECTOR_INDEX_CYCLE_WIRING_ENABLED` 미설정/제거 → byte-equivalent 즉시 복원.

## Key Invariants (보존)

1. **불변식 #1 / ADR-0448** — SectorEnergy 는 auxiliary. sector cycle/축이 일반 BUY 를 **hard-block 하면 안 됨**(`sectorEnergyExecutionImpact.ts hardBlockAllowed:false` 무회귀). MISSING→OK 전환이 hardBlock 신설 0.
2. **불변식 #6** — provider 결손/섹터 약세가 `marketSignal=true`/bearish 로 변환 0(`normalizer marketSignal:false` 유지, 회귀 테스트).
3. **§2.2-2 KIS 단일 통로** — `fetchKisSectorIndexDaily=realDataKisGet` 경유. raw KIS 0.
4. **ADR-0534 canonical 11섹터 / verifiedMapping 무접촉** — 매핑 재사용만. 9대 불변식 VERBATIM 0줄.
5. **flag OFF=byte-equal** — KIS 추가콜 0 · Gate 출력 동일.

## Out of Scope

- sectorEnergy scoring formula / boost matrix / STRONG_BUY 조건 변경 0.
- sector classification SSOT(UNKNOWN 종목 분류) 보강 — 별건.
- shadow A/B 활성화 — 운영 활성 전 별건(본 PR 은 wiring + flag).
- 신규 외부 provider / Yahoo wiring 0.

## Verification

- `server/clients/sectorIndexCycleProviderAdr0570.test.ts` — return 계산(정상 20d=20/5d / 거래일 부족 null / close≤0 / null series / baseDate 역순 정렬 보정) + flag gate(OFF 빈 Map·KIS콜 0 / '1'·'TRUE' 거부 / ON 배치·iscd / 캐시 재fetch 0 / graceful throw).
- `server/clients/sectorCycleWiringAdr0570.test.ts` — 미배선 byte-equal(sectorReturn20d undefined) / 배선 후 scores[].sectorReturn20d 살아남 + normalizer OK_WITH_DATA(MISSING 해소) / marketSignal=false / UNKNOWN 종목 FIELD_MISSING 잔존.
- 인접: sectorEnergyProvider / kisSectorEnergyProvider / sectorScoreBoost / sectorEnergyExecutionImpact(ADR-0448 hardBlock) / gate2Diagnostics 무회귀.
- tsc client + server 0 errors. complexity / responsibility / sds 통과.
