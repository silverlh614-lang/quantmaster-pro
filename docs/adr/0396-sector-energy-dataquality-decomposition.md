# ADR-0396 — Sector Energy DataQuality Decomposition

**상태**: Accepted (2026-05-06)

**의도된 정책 명칭**: ADR-0371 — Sector Energy DataQuality Decomposition (사용자 명시, 실제 발급 0396 — INDEX.md `다음 발급` SSOT 정합, ADR-0148 발급 룰 준수)

**관련 ADR**:
- ADR-0125 (sectorEnergy dataQuality 단일 라벨) — 본 ADR 가 5단계 union 으로 분해
- ADR-0157 (ENV 정확 비교 의무) — `=== 'true'` / `!== 'false'` 패턴 정합
- ADR-0185~0189 (ENV 헬퍼 SSOT 위임) — 호출자 측 inline ENV 검사 0건 정합

## 배경

### 결함 — 단일 STALE 라벨이 너무 많은 상태 뭉개기

ADR-0125 가 `dataQuality: 'OK' | 'PARTIAL' | 'STALE' | 'FAILED'` 4-state 단일 라벨로 SSOT 정착했지만, **`STALE` 라벨이 4 종류 결함을 동시에 표현** — 운영자가 *왜 STALE 인지* 즉시 인지 불가능:

1. **source/freshness 결함** — KRX 응답이 오기는 했지만 cache 에서 옴
2. **coverage 결함** — 12 섹터 중 일부만 산출
3. **fallback 진입** — KRX→stock-daily 합성 fallback 진입
4. **synthetic** — indexName fallback ENV opt-in 활성

신규 fallback 체인 (ADR-0397 Yahoo ETF L4) 도입 시 **5번째 결함 종류** 추가 필요 — 단일 라벨로는 *어디까지 신뢰 가능한지* 측정 불가능.

### 메타 모델 — 4-axis 분리 + dataQuality 5단계 요약

사용자 명시 정책 (ADR-0371) 직접 반영:

- **`sourceTier`** — 원천 데이터 출처 (4 fallback chain + FAILED)
- **`freshness`** — cache age 임계 분기
- **`coverage`** — 12 섹터 중 유효 섹터 수 비율
- **`confidence`** — 위 3 axis 가중 합성 (0~1)
- **`dataQuality`** — 위 4 필드 합성한 *UI/게이트용 요약값* (5단계)

각 필드는 별도 SSOT (진짜 판단 입력) — `dataQuality` 는 메시지 출력용.

## 결정

### 1. `SectorEnergyDataQuality` 5단계 union 격상

```typescript
type SectorEnergyDataQuality = 'OK' | 'PARTIAL' | 'STALE' | 'DEGRADED' | 'FAILED';
```

**기존 4-state 와 차이**: `DEGRADED` 신규 — *심각한 부족 / 보조 신호로만 사용 가능* 의미.

### 2. 4-axis 별도 필드 분리

```typescript
type SectorEnergySourceTier = 'KRX_CODE' | 'STOCK_DAILY' | 'CACHE' | 'YAHOO_ETF' | 'FAILED';
type SectorEnergyFreshness = 'FRESH' | 'DEGRADED' | 'EXPIRED';
// coverage: number; // 0~1 (validSectorCount / totalSectorCount)
// confidence: number; // 0~1 (sourceWeight × freshnessWeight × coverage)
```

### 3. `validSectorCount` 계단화 매트릭스 SSOT

```
12     → OK              (dataQuality='OK')
9~11   → PARTIAL         (dataQuality='PARTIAL')
6~8    → STALE_SYNTHETIC (dataQuality='STALE')
3~5    → STALE_DEGRADED  (dataQuality='DEGRADED')
0~2    → FAILED          (dataQuality='FAILED')
```

### 4. `confidence` 산출 가중치 SSOT (절대 변경 금지)

```
sourceWeight:
  KRX_CODE     = 1.00
  STOCK_DAILY  = 0.85
  CACHE        = 0.70
  YAHOO_ETF    = 0.50
  FAILED       = 0.00

freshnessWeight:
  FRESH        = 1.00
  DEGRADED     = 0.70
  EXPIRED      = 0.40

coverageWeight = coverage (0~1)

confidence = clamp(sourceWeight × freshnessWeight × coverageWeight, 0, 1)
```

### 5. cache age 정책 명문화 (FRESH/DEGRADED/EXPIRED 임계)

```
ageMs ≤ 30분  → FRESH
30분 < ageMs ≤ 4h → DEGRADED
4h < ageMs       → EXPIRED
```

### 6. 기존 `STALE` 단일 라벨 migration 정책

- **사용자 4/30 정책 정합**: *"강제 마이그레이션 금지"* — 기존 영속 데이터 (`macroState.sectorEnergyDataQuality === 'STALE'`) 그대로 보존.
- 신규 영속 시점부터 5단계 union 사용 + `sourceTier`/`freshness`/`coverage`/`confidence` 동시 영속.
- macroStateRepo schema 옵셔널 4 필드 추가 (후방호환 — 기존 영속 무수정).

### 7. emptyScanClassifier wiring 갱신

```
기존:   sectorEnergyQuality === 'FAILED' → DATA_INVALID
신규:   dataQuality ∈ {DEGRADED, FAILED} → DATA_INVALID 후보
```

`STALE` (validSectorCount 6~8) 은 *fallback 진입 후 충분한 표본* 이라 차단 부적합.
`DEGRADED` (validSectorCount 3~5) 은 *심각한 부족* 이라 DATA_INVALID 격상.

### 8. ENV 우회

```
SECTOR_ENERGY_DATAQUALITY_DECOMPOSITION_DISABLED=true (default OFF)
```

- 정확 비교 (`=== 'true'`, ADR-0157 의무 정합)
- 활성화 시 ADR-0125 4-state 동작 100% 복원 (회귀 위험 격리 1줄 즉시 롤백)
- `isSectorEnergyDataQualityDecompositionDisabled()` SSOT 헬퍼 위임 — 호출자 측 inline ENV 검사 0건 (ADR-0185~0189 정합)

## 안전 invariant (절대 변경 금지)

1. **LIVE 매매 본체 0줄 변경** — signalScanner/entryEngine/exitEngine/orchestrator/autoTradeEngine 본체 무수정.
2. **KIS 주문 함수 5종 import 0건** — 정적 grep 가드 회귀 테스트 의무.
3. **macroStateRepo schema 옵셔널 필드만** — 후방호환 (기존 영속 무수정).
4. **호출자 측 inline ENV 검사 0건** — SSOT 위임 (ADR-0185~0189 정합).
5. **사용자 정책 그대로** — confidence/sourceTier/freshness/coverage 산출식 + dataQuality 5단계 union + 계단화 매트릭스 절대 변경 금지.

## 잘못된 해결 방법 (영구 차단)

1. **단일 라벨 확장 (예: `STALE_SYNTHETIC` / `STALE_DEGRADED` 단일 union 추가)** — 4-axis 결함 정보 손실 유지.
2. **호출자 측 inline 산출** — drift 위험 (SSOT 단일 진입점 위배).
3. **`confidence` 산출식 임의 변경** — 사용자 정책 SSOT 위배.
4. **기존 `STALE` 영속 강제 migration** — 사용자 4/30 정책 정합 위배.
5. **ENV default ON** — 5단계 union 정합 default 정책, 회귀 발견 시 1줄 롤백.

## 검증

- vitest **신규 ≥10 케이스** (heuristic 5/100 LoC 충족) — 5단계 union 분기 + 4-axis 산출 + ENV gate + 계단화 매트릭스 boundary.
- `npm run lint` EXIT=0 (변경 파일 자체).
- `npm run validate:all` 16종 baseline 무회귀.
- vitest 영향 영역 무회귀.
- `ALLOW_DEPLOY_WINDOW=1 npm run precommit` EXIT=0.

## 후속 PR (scope 외)

- **ADR-0397 (= 사용자 명시 0372)** — Yahoo ETF L4 fallback wiring (sourceTier='YAHOO_ETF' + confidence × 0.5 + allowStrongBuy=false 정책).
- **ADR-0398 (= 사용자 명시 0373)** — STRONG_BUY confidence gate + UI Language SSOT + `/sector_energy_diag` 명령.
