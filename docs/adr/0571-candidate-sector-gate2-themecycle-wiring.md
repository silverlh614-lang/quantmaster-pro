# ADR-0571 — 후보 sector → Gate2 sectorThemeCycle.sector 합성 배선 (flag-gated, ADR-0423/0568/0570 완결편)

> 상태: Accepted (flag-gated 런타임 — `SECTOR_ENERGY_GATE2_WIRING_ENABLED` default OFF = byte-equal).
> 정식 발급 번호 `0571` — 출처: `docs/adr/INDEX.md` §"다음 발급: 0571" (2026-06-04, 마지막 발급 0570).
> 작성: 2026-06-04 / engine
> 계승: ADR-0423(sector cycle), ADR-0568(sectorEnergyResult→Gate2 confluence thread), ADR-0570(sectorReturn20d 데이터).

---

## Context

`/scan_blockers` 장중 덤프(2026-06-04 15:18 KST)에서 ADR-0568(threading)·ADR-0570(데이터) flag 를 모두
켰는데도 **"Gate2 Sector Cycle: MISSING | sector=UNKNOWN | sector20d=null"** 가 지속됐다. KIS 섹터 index
verify 는 성공(14 verified)했고 sectorEnergyResult 도 흘러들어왔으나, **후보별 `sectorThemeCycle.sector`
가 항상 null** 이라 `normalizeSectorThemeCycleForGate2` 가 `getSectorEnergyScore(result, sector=null)` 매칭에
실패 → `sectorReturn20d=null` → REQUIRED_FIELDS(sector, stockReturn20d, sectorReturn20d) 미충족 →
`SECTOR_THEME_CYCLE_MISSING` → "Sector 0/25".

근본원인 — **repo 전체에서 `sectorThemeCycle` 를 *생산*하는 코드가 0건**이다. Gate2 external coverage 입력은
`sectorThemeCycle: input.sectorThemeCycle` passthrough 뿐이라 항상 undefined → sector 무산출. 0568 은
`sectorEnergyResult` *결과* 를 thread 했고 0570 은 `sectorReturn20d` *데이터* 를 정확화했으나, 둘을 잇는
**후보 sector 분류 → canonical 섹터명 매칭** 고리가 비어 있었다.

(추가: quote/stockMaster 의 sector 라벨은 세분화 어휘('반도체소재'·'2차전지'·'헬스케어' 등)라 canonical
11/12 KRX 섹터명('반도체'·'바이오/헬스케어')과 직접 매칭되지 않는다 — 정규화 없이는 매칭 실패.)

## Decision

### D1 — 후보별 sectorThemeCycle.sector producer 신설 (flag-gated)
`server/quant/gate2Diagnostics/sectorThemeCycleProducer.ts`:
`produceSectorThemeCycleForGate2({ symbol, stockSector, existingSectorThemeCycle })` 가
`canonicalizeSectorName(stockSector) ?? canonicalizeSectorName(getSectorByCode(symbol))` 로 canonical
KRX 섹터명을 합성한다. `canonicalizeSectorName` 은 이미 canonical 이면 그대로, 세분화 라벨이면
`SECTOR_LABEL_TO_CANONICAL` regex 로 12 canonical 에 귀속(신규 섹터 0).

### D2 — external coverage 소비 지점 배선
`externalCoverage.ts` 에서 `isSectorEnergyGate2WiringEnabled()` ON 일 때만 producer 호출 →
`sectorThemeCycle: input.sectorThemeCycle ?? producedSectorThemeCycle`. 호출자가 이미 명시 제공한
sectorThemeCycle 은 producer 가 미개입(override 금지). normalizer 가 producer 의 canonical `sector`
→ `getSectorEnergyScore` 매칭 → `sectorReturn20d` 획득 → `OK_WITH_DATA`.

### D3 — graceful 미분류 → byte-equal 보존
canonical 매칭 실패('미분류'·빈·UNKNOWN·미지 영문 라벨)·종목코드 미해소 → undefined →
normalizer 가 기존 quote/stockMaster.sector fallback 경로로 복귀(그 종목만 FIELD_MISSING, crash 0).

### D4 — flag default OFF = byte-equal
**ADR-0568 과 동일 flag `SECTOR_ENERGY_GATE2_WIRING_ENABLED`(default OFF) 재사용** — 신규 flag 0.
OFF 면 producer 미호출 → `sectorThemeCycle` 미합성 → 현행 byte-identical. ON 일 때만 sector 합성.

## 제약 (불변식 정합)

- flag OFF = byte-equal(sectorCycle 빌드·live 게이팅 불변). flag ON = sector 축 데이터 충실화.
- `executionImpact=(b) execution-adjacent` — sectorReturn20d 가 살아나면 ADR-0570 과 동일하게
  sectorScoreBoost(+2/-1) → STRONG_BUY 게이팅에 영향 → default OFF + shadow 검증 필수(diagnostic-only 아님).
- ADR-0448 정합 — sector 는 보조 신호, **hardBlockAllowed 신설 0**(일반 BUY hard-block 불가).
- 불변식 #6 — `marketSignal:false` 유지(provider/분류 라벨은 약세 신호 아님). 9대 불변식 VERBATIM 0줄.
- §2.2-2 — KIS 신규콜 0(sectorMap SSOT·getSectorByCode 재사용). raw KIS 0.

## Patch Scope Guard (ADR-530)

- `targetDomain`: Gate2 external coverage(sectorThemeCycle 생산) + 섹터 분류 정규화.
- `allowedFiles`: `sectorThemeCycleProducer.ts`(신규) · `externalCoverage.ts`(producer 호출 배선) ·
  `sectorThemeCycleProducer.test.ts`(신규) · `gate2Diagnostics.test.ts`(fixture canonical 화) ·
  `docs/adr/0571-*.md` · `INDEX.md` · `docs/ai/10-patch-history-index.md`.
- `forbiddenFiles`: 실주문 경로 · 섹터 분류 SSOT(sectorMap/pipelineHelpers 본체) · sectorEnergyProvider 본체.
- `expectedBehaviorChange`: flag OFF 없음(byte-equal). flag ON 후보 sector=canonical 합성 → Gate2 sector 축 OK.
- `sourceSnapshotImpact`/`shadowLearningImpact`/`telegramImpact`/`providerImpact`: NONE.
  `executionImpact`: flag OFF NONE / flag ON (b) execution-adjacent(sectorScoreBoost→STRONG_BUY).
- `testsRequired`: producer 진리표(canonical pass-through·세분화 귀속·미분류 graceful·override 금지) +
  ADR-0568 E2E(flag ON sectorEnergyResult→sector 축) + precommit.
- `rollbackPlan`: `SECTOR_ENERGY_GATE2_WIRING_ENABLED` OFF 또는 producer 호출 분기 revert(byte-equivalent).

## 결과

- "Sector 0/25"(SECTOR_THEME_CYCLE_MISSING)의 마지막 배선 갭(후보 sector=UNKNOWN) 해소 — flag ON 시.
  ADR-0568(threading)·0570(데이터)·0571(분류 매칭) 3단 완결.
- flag OFF byte-equal. canonical 매칭 실패 종목은 graceful FIELD_MISSING 잔존(분류 커버리지는 별건).
- 테스트: producer 7 pass + gate2Diagnostics 45 pass(ADR-0568 fixture canonical 화) + 회귀 no-regression.
- INDEX 0571 → 0572 갱신.
