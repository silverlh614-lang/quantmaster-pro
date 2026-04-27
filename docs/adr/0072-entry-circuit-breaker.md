# ADR-0072 — Entry Circuit Breaker (매수 직후 급락 즉시 차단)

## Status
Accepted (2026-04-27)

## Context

사용자 운영 보고 (2026-04-27): "사자마자 급락에 대한 대비가 약하다. 최근 현대제철·리노공업은 매수 후 급락했다 (종합지수가 좋았음에도). 급락에 대한 서킷브레이커가 필요하다."

기존 청산 규칙 분석:

| 규칙 | 트리거 | 갭 |
|------|--------|----|
| `hardStopLoss` | currentPrice ≤ stopLoss (개별 종목 -7% 수준) | 매수 직후 -5% 급락에 미작동 (손절선 미도달) |
| `cascadeWarn` | returnPct ≤ -7% | 같은 종목에 1회만 — 매수 직후 동일 시점 도달 가능하지만 *경보만*, 청산 없음 |
| `cascadeHalf` | returnPct ≤ -15% | -15% 까지 50% 잔고 노출 |
| `cascadeFinal` | returnPct ≤ -25% | -25% 까지 자본 보호 부재 |
| `r6EmergencyExit` | regime === 'R6_DEFENSE' | 시장 전체 붕괴만 — 종합지수 양호 + 단일 종목 충격 시나리오 미커버 |

→ **명백한 갭**: 매수 직후 1시간 이내 -5% 급락 시 일반 -7% 손절 도달 *전*에 50% 청산할 보호 메커니즘 부재.

## Decision

**신규 청산 규칙 `entryCircuitBreaker` 추가** — `cascadeWarn` 다음 순위(priority ~9.5).

### 트리거 조건 (모두 AND)

1. `holdingMinutes ≤ 60` — 진입 후 1시간 이내
2. `returnPct ≤ -5%` — 5% 이상 하락
3. `shadow.entryCircuitTriggered !== true` — 1회성 (재발동 차단)

### 액션

1. **50% 즉시 청산** (`reserveSell` SSOT 경유 → SHADOW/LIVE 양쪽 안전)
2. **`entryCircuitTriggered=true`** 플래그 설정 (재발동 차단)
3. **`addBuyBlocked=true`** — 추가 매수 차단 (이미 손상 신호)
4. **`exitRuleTag='ENTRY_CIRCUIT_BREAKER'`** 학습 격리
5. **CRITICAL 텔레그램** — `entry_circuit_breaker:${stockCode}` dedupeKey

### 학습 격리

`ENTRY_CIRCUIT_BREAKER` 는 별도 ExitRuleTag 로 분류 — 일반 손절(`HARD_STOP`/`CASCADE_*`)과 다른 *진입 시점 의사결정 결함* 신호. 향후 attributionRepo / failurePatternDB 가 이 태그로 진입 신호 자체를 재평가.

### 우선순위 위치

```
EXIT_RULES_IN_ORDER:
  1. atrDynamicStop         (손절 갱신만)
  2. r6EmergencyExit        (시장 전체 붕괴)
  3. ma60DeathForceExit     (60일선 만료)
  4. hardStopLoss           (손절선 도달)
  5. cascadeFinal           (-25% 전량)
  6. trailingPeakUpdate     (HWM 갱신)
  7. trancheTakeProfitLimit (분할 익절)
  8. trailingStop           (-10% HWM)
  9. legacyTakeProfit       (목표가)
  10. cascadeHalf           (-15% 50%)
  11. cascadeWarn           (-7% 경보)
  12. entryCircuitBreaker   (NEW: 1h 이내 -5% 50%) ← 추가
  13. rrrCollapseExit       (RRR 붕괴)
  14. bearishDivergenceExit
  15. ma60DeathWatch
  16. stopApproachAlert
  17. euphoriaPartialExit
```

`cascadeWarn` 다음 — 일반 손절선/Cascade -15% 보다는 완화된 트리거 (-5%) 라 후순위. `cascadeWarn` (-7% 경보 1회) 와 결합되면 진입 직후 매우 빠른 하락에 다층 방어.

## Environment Variable Rollback

`ENTRY_CIRCUIT_BREAKER_DISABLED=true` 시 규칙 진입 즉시 NO_OP 반환. 기존 청산 규칙들과 동일 패턴.

## Constants SSOT

```typescript
export const ENTRY_CIRCUIT_HOLDING_MINUTES_MAX = 60; // 진입 후 1시간 이내
export const ENTRY_CIRCUIT_RETURN_PCT_THRESHOLD = -5; // 5% 이상 하락
export const ENTRY_CIRCUIT_SELL_RATIO = 0.5;          // 50% 청산
```

## Consequences

### Positive
- **자본 보호**: 현대제철 시나리오 — 매수 후 30분 -6% → 즉시 50% 청산 → 손실 절반 차단.
- **편향 차단**: 보유 효과/후회 회피 (사용자 페르소나 철학 8) 의 직접 방벽.
- **학습 신호**: 진입 시점 의사결정 결함을 별도 ExitRuleTag 로 격리 → attribution 분석 입력.

### Negative
- **단기 변동성 오발동 위험**: 일중 -5% 후 즉시 회복하는 종목에서 50% 청산 후 재매수 불가능 (addBuyBlocked=true). 1시간 시간 윈도우로 제한해 회수 시간이 충분한 진입 시점만 보호.
- **신호 노이즈**: 강한 변동성 종목(소형주)에서 빈번 발동 → 향후 운영 데이터로 holdingMinutes / returnPctThreshold 튜닝 가능.

### Neutral
- LIVE 매매 본체 0줄 변경 — `reserveSell` SSOT 경유로 SHADOW/LIVE 동작 자동 분기 (PR-34 ADR-0014 idempotency 정책 준수).
- ADR-0028 청산 규칙 디렉토리 패턴 그대로 — 새 파일 1개 + EXIT_RULES_IN_ORDER 1줄 추가.

## Implementation

- 신규 파일: `server/trading/exitEngine/rules/entryCircuitBreaker.ts` (~75줄)
- 신규 필드: `ServerShadowTrade.entryCircuitTriggered?: boolean` (옵셔널 — 후방호환)
- 신규 ExitRuleTag: `'ENTRY_CIRCUIT_BREAKER'` (priority 9.5)
- 회귀 테스트: `entryCircuitBreaker.test.ts` (트리거 boundary + 1회성 + ENV disable)

## References

- ADR-0028: exitEngine 디렉토리 분해 + EXIT_RULES_IN_ORDER SSOT
- ADR-0014: KIS 재시도 안전성 (reserveSell idempotency)
- 사용자 운영 보고 (2026-04-27): 현대제철·리노공업 매수 직후 급락 사례
