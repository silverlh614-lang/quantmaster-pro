# ADR-0164 — peakEquity 영속 SSOT + 자동 갱신 정책 (drawdown 자동 차단 활성화)

**상태**: Accepted (Phase 2-D Drawdown 인프라 — 본 모듈 핵심 입력 활성화)
**날짜**: 2026-05-02
**관련 PR**: PR-Sizing-Drawdown-Tracking
**의존성**: ADR-0161 (Phase 1 인프라) / ADR-0162 (Phase 2-D 메인 wiring) / ADR-0163 (Phase 2-D Extension 3 경로)

## 1. 문제

ADR-0162 §"잔여 후속 PR" §"PR-DrawdownTracking" 명시: `peakEquity` 영속 SSOT 부재 → `mapToPositionSizingInput` 의 `peakEquity = ctx.totalAssets` 가정 → `drawdownAdapter.getDrawdownMultiplier(peakEquity, currentEquity)` 가 *항상 drawdown=0* → **drawdown 자동 차단 (-10/-15/-25/-30% 4단계) 영원히 비활성**.

본 모듈의 핵심 안전망 (계좌 MDD 기반 자동 압축) 이 코드만 존재하고 *데이터 입력 부재* 로 작동 안 함.

## 2. 결정

### 2.1 영속 SSOT 신설 — `server/persistence/peakEquityRepo.ts`

`PeakEquitySnapshot` schema:
```typescript
interface PeakEquitySnapshot {
  shadowPeakEquity: number;       // SHADOW 모드 peak (가상 자본)
  shadowPeakAt: string | null;    // 도달 시각 (ISO)
  livePeakEquity: number;         // LIVE 모드 peak (KIS 실잔고)
  livePeakAt: string | null;
  schemaVersion: number;          // = 1
}
```

영속 파일: `data/peak-equity.json` (atomic write tmp→rename + 손상 fallback).

**SHADOW vs LIVE 분리** — 두 모드의 peak 영속을 *완전히 격리*. SHADOW peak 가 LIVE 결정에 영향 안 함 (역도 동일). 사용자 자본 (3천만 미만, GROWTH 티어) SHADOW 검증 시 LIVE peak 무영향.

### 2.2 자동 갱신 정책 — `updatePeakEquityIfHigher`

`current > peak` 시 자동 갱신, 그 외 no-op (drawdown 의도된 보존).

| 조건 | 결과 |
|------|------|
| `current > peak` (HWM 갱신) | 영속 갱신 + `peakAt = now ISO` + `true` 반환 |
| `current <= peak` (drawdown 영역) | no-op + `false` 반환 |
| `current` NaN/0/음수 | no-op (부적합 입력 차단) |

### 2.3 wiring — `applyPositionSizingEngine` 자동 갱신 hook

`shouldApplyPositionSizingEngine` 통과 직후 (LIVE 회귀 격리 보장 후) `updatePeakEquityIfHigher(mode='SHADOW', ctx.totalAssets)` 호출. 갱신 시 진단 로그 (`[PeakEquity] SHADOW peak 갱신 → ...`). 갱신 실패는 silent skip (try/catch — 매매 흐름 무중단).

`mapToPositionSizingInput` 의 `peakEquity` 입력 = `getEffectivePeakEquity(mode, currentEquity)`:
- 영속 부재 / 0 → `currentEquity` fallback (drawdown=0, 안전)
- 영속 존재 → 영속값 사용 (drawdown 활성화)

### 2.4 모드 매핑 — `MapToInputContext.peakEquityMode`

옵셔널 `peakEquityMode?: 'SHADOW' | 'LIVE'`. 미전달 시 `'SHADOW'` default.

본 PR 호출자 (buyListLoop / intradayLoop 4 wiring) 는 `peakEquityMode` 미전달 → 항상 SHADOW. **LIVE peak 갱신 wiring 은 본 PR scope 밖** (LIVE 매매 본체 변경 회귀 위험 격리, 후속 PR `PR-Phase3-LiveActivation` 분리).

## 3. drawdown 임계값 활성화

`drawdownAdapter.ts` 의 4 단계 (ADR-0161 Phase 1 인프라):

| 임계 | multiplier | 효과 |
|------|------------|------|
| -10% | ×0.85 | 신규 진입 사이즈 15% 축소 |
| -15% | ×0.7 | 30% 축소 |
| -25% | ×0.5 | 50% 축소 |
| -30% | ×0.0 (blocked) | 신규 진입 전면 차단 |

본 PR 후 `POSITION_SIZING_ENGINE_SHADOW_APPLY=true` 활성 시 사용자 SHADOW 매매에서 drawdown 자동 적용.

**예시 시나리오 (사용자 GROWTH 티어, 자본 1500만)**:
- Day 0: peak 영속 = 1500만 → drawdown = 0% → multiplier = 1.0 (정상 사이징)
- Day 5: 자본 1700만 도달 → peak 자동 갱신 = 1700만
- Day 10: 자본 1530만 (peak 1700만 대비) → drawdown = -10% → multiplier = 0.85 (15% 축소)
- Day 20: 자본 1190만 (peak 1700만 대비) → drawdown = -30% → **BLOCKED** (신규 진입 차단)

## 4. ENV 우회

본 PR 미도입 — ADR-0162 의 `POSITION_SIZING_ENGINE_SHADOW_APPLY` ENV 우회를 그대로 상속. ENV OFF 시 `applyPositionSizingEngine` 진입 자체 skip → peak 자동 갱신 hook 도 미실행.

별도 ENV 우회 미신설 이유:
1. 본 PR 은 ADR-0162 wiring 의 *입력 정확도 향상* — 독립 정책 아님
2. 영속 SSOT 자체는 read-only fallback (영속 부재 시 currentEquity → drawdown 0) 으로 panic 차단
3. ENV 우회 추가 시 매트릭스 복잡도 ↑ (ADR-0162 ENV × peak ENV = 4 분기) — 운영자 인지 부담

## 5. LIVE 매매 영향 0

ADR-0162 §6 동일 4 보호층 + 추가 1 층:

1. ADR-0162 §6 4 보호층 (LIVE 모드 자동 skip / ENV OFF / wiring 위치 / fallback)
2. **ADR-0164 §추가**: peak 자동 갱신 hook 도 `shouldApplyPositionSizingEngine` 통과 *후* 실행 → LIVE 모드 시 hook 자체 미실행 → LIVE peak (`livePeakEquity`) 영원히 0 보존 → LIVE wiring 도입 시 깨끗한 영속 시작점

## 6. 회귀 테스트

`peakEquityRepo.test.ts` 22 케이스:
- loadPeakEquitySnapshot 6 (부재/손상/null/array/NaN-음수/round-trip)
- savePeakEquitySnapshot 3 (round-trip/NaN 정규화/atomic tmp 잔존 안 함)
- getPeakEquity / getEffectivePeakEquity 5 (영속 부재 0 / fallback / 영속값 우선 / SHADOW vs LIVE 분리 / WithMeta)
- updatePeakEquityIfHigher 8 (첫 갱신 / current>peak / current=peak no-op / current<peak no-op / NaN-음수-0 차단 / SHADOW↔LIVE 격리 / peakAt ISO)

`positionSizingEngineWiringDrawdown.test.ts` 13 케이스:
- mapToPositionSizingInput peakEquity 입력 4 (부재 fallback / 영속 존재 / LIVE 명시 / SHADOW default)
- applyPositionSizingEngine 자동 갱신 hook 5 (첫 호출 영속 / current>peak 갱신 / current<peak no-op / ENV OFF 미실행 / LIVE 미실행)
- drawdown multiplier 활성화 통합 4 (영속 부재 1.0 / -10% boundary 0.85 / -16.67% 0.7 / -30% blocked)

## 7. 잘못된 해결 방법 (영구 차단)

- ❌ `peakEquity` 를 `totalAssets` 직접 사용 (현재 ADR-0162 의도된 가정 → 본 PR 에서 정정) — drawdown 영원히 비활성.
- ❌ peak 영속 갱신을 호출자 (buyListLoop) 측 명시 호출 — 4 wiring 호출 site 모두 hook 호출 의무 → drift 위험. **자동 hook 단일 SSOT** 가 정합.
- ❌ SHADOW + LIVE peak 통합 영속 — SHADOW 가상 자본이 LIVE 결정에 영향 = 학습 데이터 오염. **반드시 분리**.
- ❌ ENV 우회 신규 도입 — 매트릭스 복잡도 ↑ (운영자 인지 부담). ADR-0162 ENV 상속이 정합.

## 8. 운영 효과 (ENV 활성화 후)

- 사용자 SHADOW 매매에서 자본 변동 추적 → peak 자동 영속 → drawdown 임계 도달 시 본 모듈 자동 차단 (사이즈 축소 또는 신규 진입 차단)
- 운영자가 `data/peak-equity.json` 직접 조회 → SHADOW 자본 곡선 추적 가능
- `[PeakEquity] SHADOW peak 갱신 → 18,000,000원` 진단 로그 → 운영자 사후 분석
- 후속 PR (`PR-Phase3-LiveActivation`) 시 LIVE peak 영속 자동 활성화 (본 PR 의 schema 그대로 사용)

## 9. 잔여 후속 PR

본 PR 후 PENDING_WIRING B8 잔여 4 → 3:
- **PR-Phase3-LiveActivation** (P0, SLA 만기 2026-05-23): `_LIVE_ENABLED=true` ENV + LIVE wiring + LIVE peak 갱신 hook 활성화 (`peakEquityMode='LIVE'` 명시 전달)
- **PR-LossStreakIntegration**: 외부 학습 SSOT 와 본 모듈 `LossStreakState` 연결 (현재 default streak 0건 가정)
- **PR-UniverseIntegration**: `preScreenStocks` 결과 (marketCap/avgDailyVolume) ctx 노출 → 본 모듈 universe 기준 정확 적용
- **PR-SectorWeightIntegration**: `sectorPreGuard` 결과 (currentSectorWeight) 결합

## 10. 운영자 활성화 절차 (변경 없음)

ADR-0162 §4 절차 그대로:
1. `AUTO_TRADE_MODE=SHADOW` + `POSITION_SIZING_ENGINE_SHADOW_APPLY=true`
2. 1주 SHADOW 매매 누적 (`sizingSource='NEW_TIER_ENGINE'` + `data/peak-equity.json` 영속 분석)
3. 본 모듈 quantity vs legacy quantity 차이 + drawdown multiplier 활성 빈도 검증
4. 만족 시 후속 PR LIVE 활성화
