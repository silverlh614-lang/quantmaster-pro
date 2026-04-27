# ADR-0073 — 레짐별 Kelly Half-Life 단축 (자본 회전율 격상)

## Status
Accepted (2026-04-27)

## Context

사용자 운영 보고 (2026-04-27): "레짐 포지션의 생명주기를 조정하자. Early 단계가 12일인데 10일이면 충분하고 (거래일기준) 나머지도 지금 기준보다 더 짧아도 된다."

ADR-0008 `kellyHalfLife.ts` 가 매수 후 시간이 지날수록 Kelly 가중치를 감쇠시키는 모델 — `decayedKelly(t) = staticKelly × 2^(-t/halfLife)`. half-life 영업일 도달 시 가중치 50%, 2배 도달 시 25%. 후속 추가매수 차단 + 트림 권고 알림이 이 가중치 임계 (< 0.5 = trimCandidate) 에 의존.

기존 `REGIME_HALF_LIFE_DAYS` (PR-22 ADR-0008 도입):

| Regime | half-life (영업일) | 50% 도달 | 25% 도달 |
|--------|------------------:|--------:|--------:|
| R1_TURBO | 7 | 7d | 14d |
| R2_BULL | 10 | 10d | 20d |
| R3_EARLY | 12 | 12d | 24d |
| R4_NEUTRAL | 10 | 10d | 20d |
| R5_CAUTION | 8 | 8d | 16d |
| R6_DEFENSE | 5 | 5d | 10d |

## Decision

**6 레짐 모두 단축** — 자본 회전율 +25% 목표:

| Regime | 기존 | **변경** | 사유 |
|--------|----:|--------:|------|
| R1_TURBO | 7 | **5** | 강세 가속, 빠른 회전 |
| R2_BULL | 10 | **8** | 정상 강세, 더 빠른 자본 순환 |
| **R3_EARLY** | **12** | **10** | 사용자 직접 요청 |
| R4_NEUTRAL | 10 | **8** | |
| R5_CAUTION | 8 | **6** | 보수 가속 |
| R6_DEFENSE | 5 | **4** | 방어 최단 |
| DEFAULT | 10 | **8** | 레짐 미상 fallback |

**평균 half-life 변화**: (7+10+12+10+8+5)/6 = 8.67 → (5+8+10+8+6+4)/6 = 6.83 (-21%)

## Effects

### 즉시 적용 경로 (코드 변경 0줄)

- `accountRiskBudget.computeRiskAdjustedSize` (ADR-0008 wiring 완료) — 보유 N일 후 Kelly 가중치 자동 감소
- `halfLifeSnapshot.trimCandidate` (weight < 0.5) — 트림 권고 알림 더 빠른 작동
- `kellyDriftFailurePromotion` — 승급 키 자동 갱신
- `/kelly` 텔레그램 헬스 카드 — 갱신된 임계 자동 반영

### 운영 효과

- **자본 회전율**: 평균 보유일 -20% → 동일 자본으로 더 많은 진입 기회
- **편향 차단**: 보유 효과/후회 회피 (페르소나 철학 8) 의 시간 압력 강화
- **R3_EARLY 12 → 10**: 사용자 직접 요청 — 거래일 기준 10일이면 회복 추세 검증 충분
- **R6_DEFENSE 5 → 4**: 방어 모드는 더 빠른 청산 압력 — 시장 회복 시 재진입 유리

## Consequences

### Positive
- 자본 회전율 +25% — 운영 여유분 확보
- 후속 트림 권고 알림 더 빠른 작동 → 보유 효과 차단
- 환경 변수 추가 0개, 호출자 코드 변경 0줄 — REGIME_HALF_LIFE_DAYS 단일 SSOT 만 변경

### Negative
- **이미 진입한 레거시 포지션**: half-life 단축으로 가중치 즉시 감소 — 트림 권고가 *지금* 발송될 가능성. 운영자가 일시적 알림 폭주 인지 필요 (이후 정상화).
- **테스트 정합 필요**: 기존 hardcoded `t=20` 같은 테스트가 `2 * DEFAULT_HALF_LIFE_DAYS` 패턴으로 정합 갱신.

### Neutral
- LIVE 매매 본체 0줄 변경 — 단일 SSOT (REGIME_HALF_LIFE_DAYS / DEFAULT_HALF_LIFE_DAYS) 6 + 1 숫자만 갱신
- 향후 레짐별 운영 데이터 누적 후 추가 튜닝 가능 (예: R5_CAUTION 5, R6_DEFENSE 3)

## Implementation

- `server/trading/kellyHalfLife.ts:24~31` REGIME_HALF_LIFE_DAYS 6 항목 + line 34 DEFAULT_HALF_LIFE_DAYS 1 항목 변경
- 회귀 테스트 정합 — `t=20` hardcoded → `2 * DEFAULT_HALF_LIFE_DAYS` / R1_TURBO `2^(-5/7)` → `2^(-5 / REGIME_HALF_LIFE_DAYS.R1_TURBO)` 패턴 일관화
- 신규 회귀 테스트 — ADR-0073 단축 검증 (R3_EARLY=10 / R6_DEFENSE=4 / 평균 6.83 등)

## References

- ADR-0008: kellyHalfLife 시간 감쇠 모델 wiring (PR-22)
- 사용자 운영 보고 (2026-04-27): R3_EARLY 12 → 10 직접 요청 + 나머지 단축
- 페르소나 철학 8: 보유 효과 / 후회 회피 경계
