# ADR-0399: Sector Energy Source Restoration

**의도된 정책 명칭**: ADR-0374 — Sector Energy Source Restoration (사용자 명시, 실제 발급 0399).
**머지일**: 2026-05-06.
**상위 시리즈**: ADR-0396 (5단계 + 4-axis SSOT) → ADR-0397 (Yahoo ETF L4) → ADR-0398 (STRONG_BUY gate) → **본 PR (KRX 원천 복구)**.

## 배경

ADR-0396/0397/0398 시리즈가 *5단계 dataQuality + 4-axis SSOT + L4 보험 + STRONG_BUY 게이트* 인프라를 신설했지만 *KRX 원천 데이터 파이프라인 복구* 부재 —

1. ADR-0370 default OFF 강화 후에도 `aggregateIndexDeltas` 의 indexName 단독 매칭 fallback 잔존 가능성 (ENV 활성 시).
2. T 날짜만 단발 조회 시 휴장일 클러스터 (5/1·5/5) 진입 시 빈 응답.
3. `KrxIndexDailyRow` → 정규화 SSOT 부재 — 호출자마다 즉석 sanity 가드.
4. ADR-0396 `sectorEnergySourceTier` 영속 schema 신설됐으나 **writer 0건** (silent degradation).
5. 진단 메타 (`candidateDates`/`sourceTierAttempts`) 부재 — 운영자 *어느 layer 가 작동했는지* 추적 불가능.

본 PR 은 위 5 갭을 단일 PR 로 차단하고 ADR-0396/0397/0398 SSOT 위에서 **KRX_CODE → STOCK_DAILY → CACHE → YAHOO_ETF** 4-tier 호출 순서를 SSOT 로 명문화한다.

## 핵심 정책 (사용자 명시 절대 변경 금지)

1. **indexName 단독 매칭 금지** (ADR-0370 default OFF 강화 + 본 PR 영구 차단).
2. krxIndexCode 또는 sectorKey 기반 **SSOT 매핑** 사용 (`SECTOR_INDEX_MASTER`).
3. 오늘 날짜만 조회하지 말고 최근 유효 거래일 **T/T-1/T-2/T-3 자동 탐색**.
4. KRX 응답은 **NormalizedSectorIndexRow** 로 정규화한 뒤 엔진에 전달.
5. `sourceTier` 와 `freshness` 분리 (ADR-0396 SSOT 정합).
6. `KRX_CODE > STOCK_DAILY > CACHE > YAHOO_ETF` 신뢰도 가중치 (ADR-0396 정합).
7. Yahoo ETF 는 원천이 아니라 **저신뢰 보험** (ADR-0397 정합).
8. 데이터 신뢰도 낮으면 **STRONG BUY 금지** (ADR-0398 정합).
9. fallback 작동 시 UI 와 diagnostics 에 **반드시 표시**.

## 호출 순서 SSOT (절대 변경 금지)

```
L1: KRX_CODE exact match
    └─ findLatestValidSectorIndexDate (T → T-1 → T-2 → T-3 → T-5 candidate, validCount ≥ 9 첫 성공)
    └─ aggregateIndexDeltas (indexCode 우선, indexName fallback 영구 차단 — useNameFallback=false)

L2: STOCK_DAILY synthetic
    └─ buildStockDailyFallbackResult (sectorMap + KRX 종목별 일별거래)
    └─ validSectorCount ≥ minValid (default 8) 시 채택

L3: CACHE (≤ 30분 FRESH, ADR-0396 정합)
    └─ macroState.sectorEnergyInputs + sectorEnergyInputsUpdatedAt
    └─ ageHours < 48h (ADR-0343)

L4: YAHOO_ETF (ADR-0397 — 저신뢰 보험)
    └─ buildSectorEnergyFromYahooETF
    └─ confidence × 0.5 + dataQuality='DEGRADED' 강제 + allowStrongBuy=false (ADR-0398)
```

**indexName fallback 사용 금지** — ADR-0370 default OFF + 본 PR 영구 차단. ENV `SECTOR_ENERGY_INDEX_NAME_FALLBACK=true` 명시 활성 시에만 회귀 분석용으로 사용 (운영자 명시 의도).

## sourceTier 별 confidence 정책 (ADR-0396 SSOT)

| sourceTier | sourceWeight | dataQuality 정합 | allowStrongBuy |
|------------|--------------|------------------|----------------|
| KRX_CODE | 1.0 | OK / PARTIAL | ✅ (ADR-0398 통과 시) |
| STOCK_DAILY | 0.85 | STALE | ❌ (ADR-0398 차단) |
| CACHE | 0.7 | STALE | ❌ |
| YAHOO_ETF | 0.5 | DEGRADED 강제 | ❌ (ADR-0397 강제) |
| FAILED | 0 | FAILED | — |

confidence = clamp(sourceWeight × freshnessWeight × coverage, 0, 1).

## 신규 진입점

### 1. `SECTOR_INDEX_MASTER` SSOT (`server/clients/sectorEnergyMaster.ts`)
12 표준 섹터 entry — `sectorKey` / `displayName` / `krxIndexCode` / `market` / `aliases[]` / `yahooProxySymbol?`.
3 lookup 헬퍼 — `getSectorByIndexCode` / `getSectorByKey` / `getSectorByAlias`.
ENV: `SECTOR_ENERGY_SOURCE_RESTORATION_DISABLED=true` (default OFF, ADR-0157 정확 비교).

### 2. `SectorEnergyDiagnosticsMeta` 영속 schema (옵셔널, 후방호환)
```typescript
interface SectorEnergyDiagnosticsMeta {
  candidateDates: string[];              // 시도한 날짜 후보
  sourceTierAttempts: Array<{ tier: SectorEnergySourceTier; validCount: number; reason?: string }>;
  finalSourceTier: SectorEnergySourceTier;
  confidence: number;
  fallbackReason?: string;
}
```
`macroState.sectorEnergyDiagnostics?` 옵셔널 필드 신규.

### 3. saver wiring — `marketDataRefresh.ts`
기존 `sectorEnergyDataQuality / sectorEnergyValidSectorCount / sectorEnergyReasons` 3 필드 영속에 더해 ADR-0396 4-axis (`sectorEnergySourceTier` / `sectorEnergyFreshness` / `sectorEnergyCoverage` / `sectorEnergyConfidence`) + ADR-0399 diagnostics meta 추가 영속.

`buildSectorEnergyQualityComposite` (ADR-0396 SSOT) 호출만 — 신규 산출식 도입 금지.

### 4. `/sector_energy_diag` 명령 진단 메타 노출
`sectorEnergyDiagnostics.candidateDates` + `sourceTierAttempts` + `fallbackReason` 표시 (ADR-0398 명령 본문 갱신).

## 안전 invariant

1. **LIVE 매매 본체 0줄 변경** (signalScanner / entryEngine / exitEngine / orchestrator / autoTradeEngine 본체 무수정).
2. KIS 주문 함수 5종 import 0건 (정적 grep 가드).
3. `macroStateRepo` schema 변경 시 옵셔널 필드만 (후방호환).
4. ENV 정확 비교 (`=== 'true'`) ADR-0157 정합.
5. 호출자 측 inline ENV 검사 0건 (SSOT 위임).
6. ADR-0396/0397/0398 SSOT 무수정 (호출자 wiring 만).
7. confidence < 0.6 상태에서 STRONG_BUY 허용 금지 (ADR-0398 정합).
8. UI 에서 sourceTier 숨기지 않음 (`/sector_energy_diag` 본문 갱신 의무).

## 잘못된 해결 방법 영구 차단

1. **indexName 단독 매칭 재도입** — ADR-0370 default OFF + 본 ADR §"호출 순서 SSOT" 영구 차단.
2. **Yahoo ETF 를 OK 품질로 분류** — ADR-0397 §"degradation 정책" + 본 ADR §"sourceTier 별 confidence" 표 강제.
3. **신규 sourceTier/freshness 산출식 도입** — ADR-0396 SSOT 호출만 의무.
4. **`SECTOR_INDEX_MASTER` 의 12 섹터 외 추가** — 사용자 명시 정책 (절대 변경 금지). 신규 섹터 등재 시 별도 ADR.
5. **호출자 측 inline `process.env.SECTOR_ENERGY_*` 검사** — SSOT 헬퍼 위임 의무 (ADR-0185~0189 정합).
6. **macroState schema 의 기존 필드 변경** — 사용자 4/30 정책 "강제 마이그레이션 금지" 정합. 옵셔널 신규 필드만.

## ENV 우회

- `SECTOR_ENERGY_SOURCE_RESTORATION_DISABLED=true` (default OFF) — 회귀 발견 시 1줄 즉시 ADR-0398 이전 동작 복원. 정확 비교 의무.

## 운영 효과 (배포 직후)

1. KRX OpenAPI 일시 장애 + 휴장일 클러스터 (5/1·5/5·9/24~26 추석·12/25) 자동 T-1/T-2/T-3 후퇴.
2. ADR-0396 4-axis 영속 writer 활성 — `/sector_energy_diag` 명령 처음 실제 데이터 표시 (sourceTier/freshness/coverage/confidence).
3. `sectorEnergyDiagnostics` 메타 영속 — 운영자 *어느 layer 가 작동했는지* 즉시 추적 (candidateDates/sourceTierAttempts/fallbackReason).
4. STRONG_BUY 게이트 (ADR-0398) 정확 평가 입력 확보.

## 잔여 후속 PR (scope 외)

1. `SECTOR_INDEX_MASTER` 의 KRX indexCode 운영 검증 — 실제 KRX OpenAPI 응답에서 어느 코드가 작동하는지 1주 누적 후 본 PR `aliases` 확장.
2. `findLatestValidSectorIndexDate` 의 KRX 직접 호출 — 본 PR 은 `recentBusinessDaysKst(5)` 재사용 (기존 인프라). 후속 PR 에서 별도 endpoint 분리 검토.
3. signalScanner / preflight 의 `sectorEnergyConfidence` read wiring — 현재 `sectorEnergyDataQuality` 만 read. confidence < 0.6 시 추가 보수화 게이트는 별도 ADR.

## 참고

- ADR-0125 (sectorEnergy dataQuality 4-state 시작점) — DECIDED_NOT_WIRING 격하, ADR-0396 5-state 로 격상.
- ADR-0343 (Phase 1 STALE cache fallback) — 본 PR 의 L3 진입점.
- ADR-0364 (Yahoo ETF 인프라) — 본 PR 의 L4 호출자.
- ADR-0369 (indexName fallback opt-in) — 본 ADR §"indexName fallback 영구 차단" 강화.
- ADR-0370 (Phase 1 RETURN_SANITY_BOUND_PCT 30 강화) — 본 ADR §L1 sanity 정합.
- ADR-0396/0397/0398 — 본 PR 의 직속 상위 시리즈.
