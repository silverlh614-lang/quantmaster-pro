# ADR-0075 — 강세 섹터 Gate Score 가산점 SSOT

## Status
Accepted (2026-04-27, **인프라만** — wiring 후속 PR)

## Context

사용자 운영 보고 (2026-04-27): "선행지표를 가져오나 활용이 약하다. 원자재, 석유, 금, soxx, ewt등 참고자료는 충분하다. 매수추천은 gate위주라 그런지 관계없는 종목이 보인다. 그날의 강세섹터는 gate에 가산점을 주는건 어떨까."

### 기존 인프라 점검

| 모듈 | 기능 | 상태 |
|------|------|------|
| `sectorEnergyEngine.evaluateSectorEnergy()` | 12 KRX 섹터 4주 수익률+거래량+외인 합성 → LEADING/NEUTRAL/LAGGING 3 tier | ✅ 작동 |
| `sectorEnergyEngine.getSectorGate2Adjustment()` | LEADING 종목에 Gate 2 -1 (임계 완화) | ⚠️ 정의는 있지만 **호출자 0건** |
| `universeScanner.ts:225` | `leadingSectors × 1.5` 후보 점수 가중 | ✅ 작동 (후보 *선정* 단계만) |
| `entryEngine` Gate Score 산출 | 후보 선정 후 4-Gate 평가 | ❌ sectorEnergy 미반영 |

### 직접 원인 (사용자 갭)

`evaluateSectorEnergy()` 결과가 **entryEngine 의 Gate Score 산출 경로에 wiring 미적용**. 후보 *선정*에는 가중치 적용되지만 *Gate 평가*에는 무관.

→ AI 추천에서 강세 섹터 종목이 보너스를 받지 못해 "관계없는 종목" 이 보임.

## Decision

### 신규 SSOT 모듈: `server/trading/sectorScoreBoost.ts`

`applySectorScoreBoost(sectorName, sectorResult, regime)` 순수 함수 — Gate Score 가산점 매트릭스:

| Tier | Bonus | 적용 조건 |
|------|------:|-----------|
| **LEADING** | **+2** | 모든 레짐 (사용자 명시 "Gate 가산점") |
| **NEUTRAL** | 0 | 변경 없음 |
| **LAGGING** | **-1** | Bear/Caution 레짐만 (R5_CAUTION / R6_DEFENSE). BULL/EARLY/NEUTRAL 에서는 0. |
| 섹터 미상 / sectorResult 부재 | 0 | 안전 fallback |

### 환경 변수 롤백

`SECTOR_SCORE_BOOST_DISABLED=true` → 즉시 0 반환 (PR-1/PR-2 와 동일 패턴).

### 인프라만 — wiring 후속 PR

본 PR 은 **모듈 + 회귀 테스트 + ADR** 만. wiring (`entryEngine` Gate Score 적용 + `macroStateRepo.sectorEnergyResult` 영속 + `marketDataRefresh` 갱신 사이클 추가) 은 별도 PR — Gate Score 산출 본체 변경은 회귀 위험 큼.

## Wiring 후속 PR 설계 (참고용)

```
1. macroStateRepo.MacroState 에 sectorEnergyResult?: SectorEnergyResult 옵셔널 추가
2. marketDataRefresh.refreshMarketRegimeVars() 끝부분에:
     const sectorEnergyResult = await fetchSectorEnergyInputsAndEvaluate();
     saveMacroState({ ...prev, sectorEnergyResult });
3. entryEngine.evaluateBuy(): finalScore 산출 후
     const boost = applySectorScoreBoost(stock.sector, macro.sectorEnergyResult, regime);
     finalScore += boost;
     gateAdjustments.push(describeSectorBoost(stock.sector, boost, tier, regime));
4. /regime 텔레그램 메시지에 "🎯 강세 섹터: 반도체, 이차전지" 1줄 추가 (운영자 가시화)
```

## Effects (Wiring 완료 후)

### Positive
- **AI 추천 정합**: 사용자 보고 — "관계없는 종목 보임" 해소. 강세 섹터 종목이 Gate Score +2 부스트로 BUY/STRONG_BUY 진입 우선
- **선행지표 활용**: 원자재/석유/금/SOXX/EWT 등 사용자 명시 자료가 sectorEnergyEngine 입력으로 반영됨 (후속 PR 에서 KRX 외 입력 추가)
- **Bear regime 보호**: LAGGING 섹터 -1 (Bear 만) 으로 약세 시장에서 약한 섹터 자연 후순위

### Negative
- Gate Score 임계 (BUY ≥ 7 / STRONG_BUY ≥ 9) 에 ±2 영향 — 진입 종목 분포 변동 가능. 운영 데이터 누적 후 튜닝 필요.
- `evaluateSectorEnergy()` 가 KRX 12 섹터에 한정 — 미국 ETF 강세 (SOXX/EWT 등) 직접 매핑 부재. 후속 PR 에서 한국 섹터로 재투영 필요.

### Neutral
- LIVE 매매 본체 0줄 변경 (본 PR — 인프라만)
- 후속 wiring 시 `entryEngine` 본체 ~5줄 변경 + `marketDataRefresh` ~10줄 추가 예상

## Implementation

### 본 PR (인프라)

- 신규 모듈: `server/trading/sectorScoreBoost.ts` (≤120줄)
- 신규 회귀 테스트: `sectorScoreBoost.test.ts` (LEADING +2 / NEUTRAL 0 / LAGGING Bear vs Bull 분기 / 안전 fallback / ENV 롤백)
- 절대 규칙 #3 준수: 클라이언트 ↔ 서버 직접 import 금지 — 본 모듈은 `src/types/sectorEnergy` (타입만) import 으로 안전

### 후속 PR (wiring)

- macroStateRepo + marketDataRefresh + entryEngine + /regime 텔레그램 메시지

## References

- 사용자 운영 보고 (2026-04-27): "강세섹터 Gate 가산점"
- `sectorEnergyEngine.ts` (기존 SSOT, 호출자 미연결)
- `universeScanner.ts:225` (1.5x 후보 가중 — 본 PR 과 보완 관계: 본 PR 은 *Gate 점수*, 후보 가중은 *선정 단계*)
