# ADR-0390: 5 evaluator status 마이그레이션 (ADR-0389 직접 후속)

**Status**: Accepted (P1 후속 — 점진 적용)
**Date**: 2026-05-06

## 배경

ADR-0389 가 vcp/momentum/volume_surge 3 evaluator 만 status 적용. 16 evaluator 중 4 evaluator (per/vcp/momentum/volume_surge) status 적용 완료, 12 evaluator 미적용.

사용자 권장 다음 5 evaluator 점진 마이그레이션 — 5 evaluator 모두 Yahoo 시계열 의존이라 같은 패턴 (DATA_UNAVAILABLE 명시).

## 결정

### 5 evaluator status 마이그레이션 (3 분기 패턴)

각 evaluator 동일 패턴:
1. 입력 부재 → `DATA_UNAVAILABLE`
2. 임계 통과 → `FIRED`
3. 임계 미달 → `THRESHOLD_NOT_MET`

| Evaluator | DATA_UNAVAILABLE 트리거 | 변경 |
|---|---|---|
| **ma_alignment** | `ma5/ma20/ma60` 중 하나라도 0 | Yahoo 시계열 < 60일 시 정합 분류 |
| **volume_breakout** | `avgVolume<=0` 또는 `volume NaN` | 5일 평균 산출 불가 명시 |
| **turtle_high** | `high20d<=0` 또는 `price<=0` | Yahoo 시계열 < 20일 시 정합 분류 |
| **relative_strength** | `kospi20dReturn === undefined` 또는 NaN, `return20d NaN` | 벤치마크 부재 명시 |
| **breakout_momentum** | `high5d/price/avgVolume<=0` 또는 `volume NaN` | 4 입력 사전 검증 |

기존 점수 산출 + 임계 통과 시 동일 score 반환 — score-preserving migration.

### 결함 차단

ADR-0389 vcp 패턴과 동일 — 데이터 부재가 `null` 분기로 `failed` 카운트되던 결함을 `DATA_UNAVAILABLE` 정확 분류로 차단. 분할/액면 변경 직후 종목에서 Yahoo 시계열 ‹ 20일 인 경우 잘못된 종목 결함 분류 영구 종결.

## 안전 invariant

- KIS/KRX 자동매매 quota 0 침범 (절대 규칙 #2/#3/#4)
- LIVE 매매 본체 — 5 evaluator 점수 산출 동일 (status 추가만)
- 6 다른 evaluator 무수정 (status 옵셔널 자동 fallback)
- ENV 우회 부재 — 모든 변경은 score-preserving (정상 데이터 → 동일 score, 부재/임계 미달 → 동일 score=0 이지만 status 분류만 변경)

## 잘못된 해결 방법 영구 차단

1. **남은 7 evaluator (rsi_zone/macd_bull/pullback/ma60_rising/weekly_rsi_zone/supply_confluence/earnings_quality/trend_acceleration) 일괄 적용** — 회귀 위험. 다음 PR 점진.
2. **default 점수 분포 변경** — score-preserving 의무.
3. **THRESHOLD_NOT_MET detail 텍스트 생략** — 운영자 진단성 확보 위해 측정값 명시.

## 누적 진행도

| Evaluator (16) | status 적용 | ADR |
|---|---|---|
| per | ✓ | ADR-0387 |
| momentum | ✓ | ADR-0389 |
| vcp | ✓ | ADR-0389 |
| volume_surge | ✓ | ADR-0389 |
| ma_alignment | ✓ | ADR-0390 |
| volume_breakout | ✓ | ADR-0390 |
| turtle_high | ✓ | ADR-0390 |
| relative_strength | ✓ | ADR-0390 |
| breakout_momentum | ✓ | ADR-0390 |
| rsi_zone | ✗ | 후속 |
| macd_bull | ✗ | 후속 |
| pullback | ✗ | 후속 |
| ma60_rising | ✗ | 후속 |
| weekly_rsi_zone | ✗ | 후속 |
| supply_confluence | ✗ | 후속 |
| earnings_quality | ✗ | 후속 |
| trend_acceleration | ✗ | 후속 |

총 17/17 → 9/17 (53%) 적용. 잔여 8개 후속 PR.

## 회귀 테스트

`evaluatorsAdr0390.test.ts` 25 케이스:
- ma_alignment 4 / volume_breakout 4 / turtle_high 5 / relative_strength 6 / breakout_momentum 6

ADR-0387 +34 / ADR-0388 +28 / ADR-0389 +42 / ADR-0390 +25 = **누적 +129 회귀**.

## 후속 PR

- 잔여 8 evaluator status 마이그레이션 (Yahoo 시계열 의존 5 + KIS/DART 의존 2 + trend_acceleration)
- 호출자 측 context propagation (`perSymbolEvaluation` `hadRequiredData`/`skippedByPolicy`)
- Yahoo quoteSummary opportunistic enrichment (PER/EPS 데이터 부재 자체 해소)
- ADR-0411: evaluator 단위 PROVIDER_DEGRADED 강등 정책 (Yahoo stale 사건 통합 해결)
