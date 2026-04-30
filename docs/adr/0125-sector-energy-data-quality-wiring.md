# ADR-0125: sectorEnergy dataQuality wiring — 4값 분기 boost 강도 분기

**상태:** 채택 (PR-1, 2026-04-30)
**시리즈:** PR #442 후속 (사용자 명시 PR-1) — ADR-0122 인프라 위 wiring

## 컨텍스트

ADR-0122 (PR-D) 가 `buildSectorEnergyInputsWithMeta` SSOT + `SectorEnergyDataQuality` 4값 도입. 단 *호출자 wiring 부재* — 인프라만. 사용자 명시 후속 PR-1:

> sectorScoreBoost 또는 perSymbolEvaluation에서 buildSectorEnergyInputsWithMeta 사용
> 분기:
>   OK     → sector boost full 적용
>   PARTIAL→ sector boost 50% 또는 보수 적용
>   STALE  → sector boost 0, 단 기존 정상 cache reference 표시
>   FAILED → sector boost 0, scanDiagnostics.sectorEnergyQuality=FAILED, emptyScanReason 후보에 DATA_INVALID 가중

## 결정

### 1. macroState 영속 확장 — 3 옵셔널 필드 추가

```typescript
sectorEnergyDataQuality?: 'OK' | 'PARTIAL' | 'STALE' | 'FAILED';
sectorEnergyValidSectorCount?: number;
sectorEnergyReasons?: string[];
```

`marketDataRefresh` 가 `buildSectorEnergyInputsWithMeta` 호출 후 `dataQuality` + `validSectorCount` + `reasons` 영속. throw 시 `dataQuality='FAILED'` graceful.

### 2. `getSectorBoostMultiplier(dataQuality?)` SSOT

```typescript
OK / undefined → 1   (기본, 후방호환)
PARTIAL        → 0.5 (보수 적용)
STALE          → 0
FAILED         → 0
```

### 3. `applySectorScoreBoost` 시그니처 확장 — `dataQuality?` 옵셔널 4번째 인자

- multiplier=0 (STALE/FAILED) → 즉시 0 반환 (early return)
- multiplier=1 (OK) → raw boost 그대로
- multiplier=0.5 (PARTIAL) → `Math.round(raw * 0.5)` (예: +2 → +1, -1 → 0)
- 미전달 → OK 기본 동작 (후방호환 — 기존 호출자 무영향)

### 4. perSymbolEvaluation wiring

```typescript
const sectorEnergyResult = ctx.macroState?.sectorEnergyResult ?? null;
const sectorEnergyDataQuality = ctx.macroState?.sectorEnergyDataQuality;
const sectorBoost = applySectorScoreBoost(stock.sector, sectorEnergyResult, ctx.regime, sectorEnergyDataQuality);
```

### 5. 사용자 §3 STALE 정책 — sectorEnergyResult 캐시 보존

`marketDataRefresh` 가 `inputs.length === 0` (STALE) 일 때도 macroState.sectorEnergyResult 는 *덮어쓰지 않음* (이전 캐시 보존). 단 dataQuality='STALE' 영속 → applySectorScoreBoost 가 boost=0 반환. 사용자 의도 — "이전 cache reference 표시" 정합.

### 6. FAILED 분기 — emptyScanReason DATA_INVALID 가중

본 PR-1 scope 외 — *PR-3 (ScanSummary 확장) 후속*. `sectorEnergyDataQuality === 'FAILED'` 시 `emptyScanReason` 분류기가 DATA_INVALID 우선 부여. 본 PR 은 wiring 만, 분류기 격상은 PR-3.

## 결과

### 변경 파일

- `server/persistence/macroStateRepo.ts` (+3 옵셔널 필드)
- `server/trading/marketDataRefresh.ts` (`buildSectorEnergyInputsWithMeta` 사용 + 3 필드 영속)
- `server/trading/sectorScoreBoost.ts` (+SectorEnergyDataQuality 타입 + getSectorBoostMultiplier SSOT + applySectorScoreBoost 4번째 인자)
- `server/trading/sectorScoreBoostAdr0125.test.ts` (신규 18 케이스)
- `server/trading/signalScanner/perSymbolEvaluation.ts` (dataQuality propagate)

### 검증

- vitest server/trading **99/99 pass** (신규 18 + 기존 무회귀)
- lint 0 에러
- KIS/KRX 자동매매 quota 0 침범
- LIVE 매매 본체 — applySectorScoreBoost 결과 변경 (PARTIAL/STALE/FAILED 시 boost 감소). ENV `SECTOR_SCORE_BOOST_DISABLED=true` 1줄 우회 가능

### 운영 효과

- **사용자 1차 로그 시나리오 영구 차단** — 자릿수 격차 5건 발생 시 `validateIndexResponseSymmetry` 미통과 → `dataQuality='FAILED'` → boost=0 → sectorScoreBoost 오염이 매수 결정에 미치는 영향 차단
- **PARTIAL 보수 적용** — 12 섹터 중 8~11 섹터 통과 시 boost 50% 감속 (시스템 신뢰도 부분 낮춤 정합)
- **STALE cache reference** — 입력 0건일 때도 이전 sectorEnergyResult 보존 + boost=0 → 데이터 부족 시 자동 보수화

### 후속 PR

- **PR-2**: Price Source Policy execution wiring (`shouldAllowExecution` 매수 직전 final 방어선)
- **PR-3**: ScanSummary 에 sectorEnergyQuality? 추가 + /scan_blockers 노출 + emptyScanReason DATA_INVALID 가중
