# ADR-0122: sectorEnergy KRX 매칭 결함 차단 + dataQuality 분류 + SELL_ONLY 시간 조정

**상태:** 채택 (PR-D, 2026-04-30)
**시리즈:** 옵션 B PR-A → PR-B → PR-C → **PR-D** (사용자 추가 분석 후속)

## 컨텍스트

사용자 4/30 PM 후속 분석 — *진짜 R3 매수 차단 원인은 sectorEnergy 데이터 오염*:

> 로그 한 줄씩 읽으면 진실이 명확. "종이·목재" today=282.61 vs past=8372.2 — 이건 데이터 오류가 아니라 **서로 다른 두 지수가 같은 이름으로 분류되는 응답 비대칭**. KRX OpenAPI 는 동일 IDX_NM 을 가진 여러 sub-index 를 반환할 수 있고, today 와 past 응답에서 어떤 코드가 어떤 이름으로 매핑되느냐가 일관되지 않을 수 있다.

기존 `aggregateIndexDeltas` 의 `indexName` fallback 매칭은 본질적으로 불안전 — KRX 가 *동일 indexName + 다른 indexCode* sub-index 쌍을 반환할 때 잘못된 지수쌍을 매칭. 자릿수 격차 검증 (±10배) 은 *최후의 방어선* 이고, 매칭 자체의 무결성 부재.

추가로 사용자 추가 보고: SELL_ONLY 시작 시간이 14:55 부터 — *15:00 부터* 가 정합 (KRX 정규 매매 14:30~15:20, 동시호가 15:20~15:30).

## 결정

### 1. validateIndexResponseSymmetry SSOT (사용자 §1)

```typescript
export function validateIndexResponseSymmetry(
  todayRows: KrxIndexDailyRow[],
  pastRows: KrxIndexDailyRow[],
): SymmetryValidationResult;
```

- today/past 양쪽 indexCode 충실도 ≥ 90% 검증
- 미통과 시 `valid=false` + reasons[]
- `buildSectorEnergyInputsWithMeta` 진입 직후 호출 → 실패 시 응답 페어 폐기

### 2. indexName fallback 매칭 제거 (사용자 §2 — default OFF)

`aggregateIndexDeltas` 의 `pastByName` fallback 매칭을 ENV gated 로 변경:
- `SECTOR_ENERGY_INDEX_NAME_FALLBACK=true` 명시 시에만 복원 (회귀 분석용)
- default: indexCode 매칭만 신뢰

### 3. 유효 섹터 임계 (사용자 §4 — SECTOR_ENERGY_MIN_VALID=8)

12 섹터 중 `returns.length > 0` 섹터 수가 8 미만이면 결과 폐기 (`STALE`):
- `getSectorEnergyMinValid()` ENV 우회 (1~12 범위)
- 부분 결과 → 잘못된 LEADING/LAGGING 격상 차단

### 4. SectorEnergyDataQuality 4값 + BuildResult SSOT (사용자 §7)

```typescript
export type SectorEnergyDataQuality = 'OK' | 'PARTIAL' | 'STALE' | 'FAILED';

export interface SectorEnergyBuildResult {
  inputs: SectorEnergyInput[];
  dataQuality: SectorEnergyDataQuality;
  validSectorCount: number;
  totalSectorCount: number;
  symmetryValidation?: SymmetryValidationResult;
  reasons: string[];
}

export async function buildSectorEnergyInputsWithMeta(): Promise<SectorEnergyBuildResult>;
```

- `OK` — 12 섹터 모두 통과 + symmetry 정상
- `PARTIAL` — 8~11 섹터 통과 (일부 skip)
- `STALE` — 유효 섹터 < 8 (이전 캐시 fallback 권장)
- `FAILED` — symmetry 미통과 또는 fetch 실패

기존 `buildSectorEnergyInputs(): Promise<SectorEnergyInput[]>` 유지 (후방호환). 호출자 wiring (sectorScoreBoost 의 dataQuality 활용) 은 후속 PR.

### 5. ENV 우회 3종

- `SECTOR_ENERGY_SYMMETRY_DISABLED=true` — symmetry 검증 무력화
- `SECTOR_ENERGY_INDEX_NAME_FALLBACK=true` — indexName fallback 복원
- `SECTOR_ENERGY_MIN_VALID=N` — 유효 섹터 임계 조정 (1~12)

### 6. SELL_ONLY 시간 조정 (사용자 추가 보고)

`adaptiveScanScheduler.ts` 의 마감 SELL_ONLY 시작 시간 14:55 → **15:00 KST**:
- 변경 전: `t < 1455 (마감전 급변, base=2)` → `else (t≥1455 마감동시호가, SELL_ONLY)`
- 변경 후: `t < 1500 (마감전 급변, base=2)` → `else (t≥1500 마감, SELL_ONLY)`
- phase 라벨: "마감동시호가(SELL_ONLY)" → "마감(SELL_ONLY)" (정확성 — 동시호가는 15:20 부터)
- 점심 SELL_ONLY (11:30~13:00) 보존

## 결과

### 변경 파일

- `server/clients/sectorEnergyProvider.ts` (validateIndexResponseSymmetry + ENV 헬퍼 + buildSectorEnergyInputsWithMeta + indexName fallback ENV gated)
- `server/clients/sectorEnergyProvider.adr0122.test.ts` (신규 20 케이스 — symmetry 검증 + ENV + 1차 로그 시나리오)
- `server/clients/sectorEnergyProvider.test.ts` (기존 ADR-0059 indexName fallback 케이스 정합화 — default OFF + ENV 복원 검증)
- `server/orchestrator/adaptiveScanScheduler.ts` (SELL_ONLY 14:55 → 15:00 + phase 라벨)
- `server/orchestrator/sellOnlyTimeAdjustment.test.ts` (신규 6 케이스 — 정적 grep 회귀 가드)

### 검증

- vitest 33/33 pass (sectorEnergyProvider 13 + adr0122 20)
- vitest 6/6 pass (sellOnlyTimeAdjustment)
- lint(client + server tsc) 0 에러
- KIS/KRX 자동매매 quota 0 침범
- LIVE 매매 본체 0줄 변경 (호출자 wiring 부재)

### 운영 효과

1. **1차 로그 시나리오 영구 차단** — 종이·목재 0.034x / 전기전자 45.557x 자릿수 격차가 발생해도 indexCode 매칭으로만 통과 → 잘못된 sub-index 매칭 자체 차단
2. **응답 비대칭 자동 폐기** — KRX 가 일시적으로 indexCode 충실도 80% 같은 비정상 응답 반환 시 페어 전체 폐기 + 이전 캐시 fallback
3. **유효 섹터 8개 미만 → STALE** — 부분 결과로 잘못된 LEADING/LAGGING 격상 차단
4. **dataQuality 4값 진단** — sectorScoreBoost 호출자가 PARTIAL 시 boost 반감, FAILED 시 boost=0 분기 가능 (후속 PR wiring)
5. **SELL_ONLY 15:00 정합** — 14:55 부터 신규 진입 차단되던 5분 회귀 해소 → 14:55~15:00 5분간 매수 기회 회복

### 후속 PR

- sectorScoreBoost 호출자가 buildSectorEnergyInputsWithMeta 사용 + dataQuality 기반 boost 분기
- KRX → Naver Finance cross-validation (사용자 §10)
- sectorEnergy "shadow" 7일 무결성 비교 (사용자 §9)
- 텔레그램 critical 알림 (KRX skip 5회 이상 시, 사용자 §8)
