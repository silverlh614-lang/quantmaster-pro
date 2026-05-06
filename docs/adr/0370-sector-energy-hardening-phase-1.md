# ADR-0370 — Sector Energy Hardening Phase 1: indexName fallback OFF + sanity bound 30 + 키 합성 강화

## Status

Accepted (2026-05-06).

## Context

ADR-0369 가 `SECTOR_ENERGY_INDEX_NAME_FALLBACK` 을 unsafe opt-in 으로 격하했으나
4 결함이 잔존:

1. **default 정책 미명문화** — `.env.example` 안내 부재로 운영자가 활성화 위험성 인지 불가.
2. **부팅 시점 진단 부재** — `SECTOR_ENERGY_INDEX_NAME_FALLBACK=true` 가 활성 상태여도
   로그에 흔적 없음. 운영자가 실수로 켠 채 잊혀질 위험.
3. **`aggregateIndexDeltas` 키 합성 약함** — `pastByCode` + `pastByName` 두 Map 분리로
   동일 indexName 다른 시장 (KOSPI:반도체 vs KOSDAQ:반도체) 매칭 시 silent overwrite.
   `validSectorCount=8/12` 같은 가짜 정상 상태 발생.
4. **`RETURN_SANITY_BOUND_PCT` default 90 너무 관대** — 한국 섹터 일일 ±15% / 주간
   ±30% 정상 상한. 90% 임계는 자릿수 격차 (94112 vs 2009 = 46x), 액면병합/분할,
   잘못된 indexName 매칭 같은 데이터 결함을 *정상값* 으로 흡수.

## Decision

Phase 1 — **운영 가시성 + 키 합성 + sanity bound 강화** 4 변경 (P0):

### 1. ENV 정책 명문화

`.env.example §[6.2] Sector Energy Hardening` 신규 섹션 — `SECTOR_ENERGY_INDEX_NAME_FALLBACK`
default OFF + `SECTOR_ENERGY_RETURN_SANITY_BOUND_PCT` default 30 명시. ADR-0369 정합.

### 2. 부팅 1회 console.warn (`emitIndexNameFallbackWarningIfEnabled`)

`sectorEnergyProvider.ts` 모듈 로드 시 1회 자동 호출. ENV `=== 'true'` (정확 비교, ADR-0157
정합) 시에만 발동. 메시지 — `[SECTOR_ENERGY] unsafe indexName fallback is enabled. This may
produce unreliable sector deltas (ADR-0369/0370).`. `_indexNameFallbackWarningEmitted` 모듈
로컬 latch 로 idempotent. `__resetIndexNameFallbackWarningForTests()` 격리 헬퍼.

### 3. composite key SSOT (`indexRowKey`)

`aggregateIndexDeltas` 의 `pastByCode` + `pastByName` 분리 Map → 단일 `pastByKey` Map +
composite key 합성 함수 `indexRowKey(row, useNameFallback)`:

- 우선순위 1: `${market}:code:${indexCode}` — indexCode 있을 때 (정확 매칭)
- 우선순위 2: `${market}:name:${indexName}` — `useNameFallback=true` 시에만
- `useNameFallback=false` (default) 시 indexName 단독 매칭 경로 호출 0건 보장

`indexRowMarket(row)` 헬퍼 — `KrxIndexDailyRow.market` 옵셔널 필드 안전 access (외부
타입 변경 없이 후방호환). 동일 composite key 중복 시 silent overwrite 금지 →
`console.warn` + skip (첫 번째 row 보존, 회귀 진단).

### 4. RETURN_SANITY_BOUND_PCT default 90 → 30

`RETURN_SANITY_BOUND_PCT_DEFAULT = 30` 상수 export. `pushDelta` sanity 위반 시
진단 로그 — `[SectorEnergy] sanity-violation pct=N% sector=... bound=30% (ADR-0370)`.
회귀 발견 시 `SECTOR_ENERGY_RETURN_SANITY_BOUND_PCT=90` ENV 1줄 즉시 롤백.

## 안전 invariant 7종 (ADR-0146 PR 자가 review 정합)

1. **KIS 주문 함수 5종 import 0건** — `placeKisMarketOrder` / `placeKisSellOrder` /
   `cancelKisOrder` / `placeKisStopLossOrder` / `placeKisTakeProfitOrder` 모두 미참조.
2. **LIVE 매매 본체 0줄 변경** — `signalScanner.ts` / `entryEngine.ts` / `exitEngine/**` /
   `orchestrator/**` / `autoTradeEngine*` 모두 0줄.
3. **ENV 정확 비교 의무** — `=== 'true'` (ADR-0157 정합). `'TRUE'` / `'1'` / `'yes'` 거부.
4. **additive 패턴** — `SECTOR_ENERGY_INDEX_NAME_FALLBACK=true` + `SECTOR_ENERGY_RETURN_SANITY_BOUND_PCT=90`
   ENV 1줄로 즉시 ADR-0370 이전 동작 byte-equivalent 복원.
5. **호출자 측 inline ENV 검사 0건** — SSOT 위임 (`isSectorEnergyIndexNameFallbackEnabled` /
   `RETURN_SANITY_BOUND_PCT` 모듈 상수, ADR-0185~0189 정합).
6. **회귀 테스트 정적 grep 가드 포함** — drift 차단 (RETURN_SANITY_BOUND_PCT_DEFAULT=30 /
   ADR-0370 주석 / fallback OFF 시 호출 0건).
7. **`macroStateRepo` schema 무변경** — silent degradation 자동 검증 baseline 무회귀.

## 잘못된 해결 방법 영구 차단

1. **indexName fallback 자체 제거** — 외부 호환 위험 (회귀 분석용 ENV 우회 가치 보존).
   ADR-0369 unsafe opt-in 정책 그대로.
2. **RETURN_SANITY_BOUND_PCT default 0** — 정상 데이터까지 차단 위험.
3. **STRONG BUY 차단 로직 통합** — ADR-0373 후속 (UI Language + STRONG_BUY Gate).
4. **SectorEnergyDataQuality FAILED 자동 격상** — ADR-0371 후속 (STALE 분해).
5. **Yahoo ETF fallback wiring** — ADR-0372 후속.

## 운영 효과 (배포 직후)

- 운영자 실수 활성화 시 부팅 로그에 즉시 노출 → 인지·해제 가능.
- KOSPI:반도체 vs KOSDAQ:반도체 silent overwrite 영구 차단 → `validSectorCount`
  가짜 정상 상태 차단.
- 자릿수 격차 / 액면병합 / 잘못된 indexName 매칭 같은 데이터 결함이 30% 임계로 즉시
  skip + 진단 로그.
- ENV 1줄 롤백 안전망 — 회귀 발견 시 즉시 ADR-0370 이전 동작 복원.

## 후속 ADR (별도 PR)

- **ADR-0371** — SectorEnergyDataQuality STALE 분해 (FAILED / DEGRADED / PARTIAL_VOLUME / STALE).
- **ADR-0372** — Yahoo ETF fallback wiring (KRX OpenAPI 장애 시).
- **ADR-0373** — UI Language SSOT 갱신 + STRONG_BUY Gate 활성화 (sectorBoost=0 시 STRONG_BUY 금지).

## 관련 ADR

- **ADR-0369** — sectorEnergy indexName fallback unsafe opt-in 격하 (직속 부모).
- **ADR-0157** — ENV 정확 비교 의무 (`=== 'true'`).
- **ADR-0146** — PR 자가 review 5 카테고리.
- **ADR-0185~0189** — ENV 헬퍼 SSOT 위임 패턴.
