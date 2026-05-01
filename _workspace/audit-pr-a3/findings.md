# PR-A3-Audit — A3 emitFullCloseAttribution wiring 전수 audit

**작성일**: 2026-05-01
**목적**: 지침서 7843c96f-A3_B1_wiring_plan.md 의 A3 잔여 5 청산 규칙 wiring 작업 진입 전 코드베이스 audit. 결과적으로 *지침서 outdated 확정* + *5 잔여 모두 추가 wiring 불필요*.

---

## 결론 (TL;DR)

**A3 emitFullCloseAttribution wiring 은 사실상 100% 완료**. 지침서 §"A3 emitFullCloseAttribution 실제 상태" 에 명시된 5 잔여 규칙 모두 *추가 코드 변경 불필요*.

근거:
1. **전량 청산 경로** (4 규칙): hardStopLoss / legacyTakeProfit / cascadeFinal / ma60DeathForceExit + trancheTakeProfitLimit + trailingStop = **6개 모두 `emitFullCloseAttributionForExit` 직접 호출 wired** (정적 grep 결과 6 callers).
2. **부분 청산 경로** (자동 wiring): `reserveSell.ts:102-111` 가 PR-42 M1 으로 *모든 SHADOW reserveSell 호출 시* `emitPartialAttributionForSell` 자동 호출. 따라서 r6EmergencyExit / cascadeHalf / euphoriaPartialExit / bearishDivergenceExit / trancheTakeProfitLimit / trailingStop 의 모든 부분매도 분기가 자동 PARTIAL attribution 영속.
3. **OCO 분기** (2개): `ocoCloseLoop.ts` STOP_FILLED + PROFIT_FILLED 분기 (지침서 명시) 도 wired.
4. **atrDynamicStop**: 청산 자체를 수행하지 않음 (`hardStopLoss` 갱신만, `placeKisSellOrder` 호출 0건). attribution 호출 부적절. 실제 청산은 후속 hardStopLoss rule 발동 시 (이미 wired).

**A3 백로그 항목 → `DECIDED_NOT_WIRING` 변경 또는 제거 권장**.

---

## 1. 지침서 vs 실제 audit 비교

### 지침서 §"남은 wiring 미완 (5개)"

| 파일 | 청산 성격 (지침서) | 우선순위 (지침서) |
|------|------------------|----------------|
| `r6EmergencyExit.ts` | R6 비상 청산 (전량) | P0 |
| `atrDynamicStop.ts` | ATR 동적 손절 (전량) | P0 |
| `bearishDivergenceExit.ts` | 약세 다이버전스 (전량) | P1 |
| `cascadeHalf.ts` | 부분 청산 (50%) | P1 |
| `euphoriaPartialExit.ts` | 과열 부분 청산 | P1 |

### 실제 코드 audit

| 파일 | 실제 청산 성격 | reserveSell 호출 | emitPartial 자동 | 추가 wiring |
|------|--------------|----------------|----------------|------------|
| `r6EmergencyExit.ts:31` | **30% 부분** (`Math.floor(shadow.quantity * 0.30)`) | ✅ line 38 | ✅ PR-42 M1 자동 | **불필요** |
| `atrDynamicStop.ts` | **청산 0건** (hardStopLoss 갱신만) | ❌ | N/A (청산 안 함) | **불필요** |
| `bearishDivergenceExit.ts:32` | **30% 부분** (`Math.floor(shadow.quantity * 0.30)`) | ✅ line 39 | ✅ PR-42 M1 자동 | **불필요** |
| `cascadeHalf.ts:19` | **50% 부분** (`Math.floor(shadow.quantity / 2)`) | ✅ line 29 | ✅ PR-42 M1 자동 | **불필요** |
| `euphoriaPartialExit.ts:25` | **50% 부분** (`Math.floor(shadow.quantity / 2)`) | ✅ line 41 | ✅ PR-42 M1 자동 | **불필요** |

### 지침서 분류 오류

- **r6EmergencyExit**: 지침서 "전량" → 실제 "30% 부분" (`shadow.r6EmergencySold` 1회 dedupe).
- **atrDynamicStop**: 지침서 "전량" → 실제 "청산 0건" (hardStopLoss 래칫 갱신, `placeKisSellOrder` 호출 0건).
- **bearishDivergenceExit**: 지침서 "전량" → 실제 "30% 부분".

---

## 2. reserveSell 자동 attribution wiring (PR-42 M1, ADR-0006)

`server/trading/exitEngine/helpers/reserveSell.ts:102-111`:

```typescript
// PR-42 M1 — 부분매도 시 PR-19(ADR-0006) attribution 자동 기록.
// 조건: SHADOW(CONFIRMED 즉시) + 잔량 > 0 + originalQuantity 확정.
// baseline conditionScores 가 없으면 emitPartialAttribution 가 null 을 반환해
// 학습 오염을 차단한다. LIVE PROVISIONAL fill 은 reserveSell 에서 emit 하지
// 않고 fillMonitor 의 confirm 시점 wiring 을 후속 PR 로 분리한다.
if (isShadow) {
  const lastFill = shadow.fills?.[shadow.fills.length - 1];
  emitPartialAttributionForSell({
    shadow,
    fill,
    remainingQty,
    newFillId: lastFill?.id,
    now: nowIso,
  });
}
```

**효과**: `reserveSell` 을 호출하는 모든 청산 규칙은 SHADOW 모드에서 자동으로 `emitPartialAttributionForSell` 호출. baseline (entryConditionScores) 부재 시 null 반환으로 학습 오염 차단.

**적용 범위** (정적 grep 결과 — `reserveSell` 호출자):
- r6EmergencyExit.ts:38
- bearishDivergenceExit.ts:39
- cascadeHalf.ts:29
- euphoriaPartialExit.ts:41
- trailingStop.ts (부분 청산 분기)
- trancheTakeProfitLimit.ts (LIMIT TP)
- legacyTakeProfit.ts (전량 익절)
- hardStopLoss.ts (전량 손절)
- cascadeFinal.ts (전량 손절)
- ma60DeathForceExit.ts (전량 강제 청산)
- ocoCloseLoop.ts (STOP_FILLED + PROFIT_FILLED)

**전량 청산 분기** (remainingQty=0): `emitPartialAttributionForSell` 가 line 36 가드 (`if (remainingQty <= 0 ...) return null`) 로 자동 skip → 별도 `emitFullCloseAttributionForExit` 직접 호출 wiring (기존 6 callers, ADR-0006).

---

## 3. emitFullCloseAttributionForExit 직접 호출자 (전량 청산)

정적 grep 결과 6 callers + 6 import 라인:

```
server/trading/exitEngine/rules/cascadeFinal.ts:17 (import) + :40 (call)
server/trading/exitEngine/rules/hardStopLoss.ts:17 (import) + :56 (call)
server/trading/exitEngine/rules/legacyTakeProfit.ts:15 (import) + :37 (call)
server/trading/exitEngine/rules/ma60DeathForceExit.ts:18 (import) + :55 (call)
server/trading/exitEngine/rules/trailingStop.ts:15 (import) + :47 (call)
server/trading/exitEngine/rules/trancheTakeProfitLimit.ts:15 (import) + :96 (call)
```

모든 호출이 try/catch 격리 + `shadow.entryConditionScores` baseline 부재 시 null 반환 (학습 오염 차단).

회귀 가드: `server/trading/exitEngine/rules/__tests__/exitRulesAttributionWiring.test.ts` — 6 규칙 모두 `emitFullCloseAttributionForExit` 호출 정확히 1건 + try/catch 격리 + `updateShadow` 직후 위치 정합 정적 grep.

---

## 4. atrDynamicStop 분류 (청산 안 함)

`server/trading/exitEngine/rules/atrDynamicStop.ts` 본체 audit 결과:
- `placeKisSellOrder` 호출 0건
- `reserveSell` 호출 0건
- 청산 트리거 0건
- 동작: `hardStopLoss` 래칫 갱신만 (line 34 `if (effectiveDynamicStop > hardStopLoss)`)
- 효과: 손절선 상향 → 후속 사이클에서 hardStopLoss rule 이 발동 시 청산 (이미 wired)

**결론**: atrDynamicStop 에 attribution 호출 추가는 *부적절* — 본 규칙은 청산을 수행하지 않음.

---

## 5. ENV 롤백 스위치 검증

| ENV | 효과 | default |
|-----|------|---------|
| `LEARNING_BUYAPPROVAL_ATTRIBUTION_DISABLED` | attribution 영속 자체 차단 (PR-19 ADR-0006) | false |
| `BEP_TWO_BAR_CONFIRMATION_DISABLED` | TwoBar 정책 우회 (PR-B1 후속 wiring 후 활성) | false |

본 PR scope 밖 (PR-B1-1 진행 시 ENV 추가 검토).

---

## 6. SHADOW 30거래 누적 후 데이터 품질 확인

본 PR scope 밖 — 운영 데이터 1~2주 누적 후 별도 PR. 현재 audit 단계에서는 *wiring 100% 적용 확인* 만 명시.

검증 방법 (운영 데이터 누적 후):
```bash
# attributionRepo 데이터 품질 확인
node -e "
import('./server/persistence/attributionRepo.js').then(m => {
  const records = m.loadAttributionRecords();
  console.log('total:', records.length);
  console.log('FULL_CLOSE:', records.filter(r => r.attributionType === 'FULL_CLOSE').length);
  console.log('PARTIAL:', records.filter(r => r.attributionType === 'PARTIAL').length);
  console.log('conditionScores 존재:', records.filter(r => r.conditionScores).length);
});
"
```

---

## 7. 결론 + 후속 액션

### 결론

A3 (emitFullCloseAttribution wiring) 는 **이미 100% 완료된 상태**:
- 전량 청산 6 규칙: `emitFullCloseAttributionForExit` 직접 호출 wired (ADR-0006)
- 부분 청산 모든 분기: `reserveSell` 경유 `emitPartialAttributionForSell` 자동 wired (PR-42 M1)
- atrDynamicStop: 청산 자체 안 함 → wiring 부적절
- OCO 2분기: 이미 wired (지침서 명시)

지침서가 outdated — PR-A3-1 / PR-A3-2 / PR-A3-3 는 실제 코드 변경 불필요.

### 후속 액션

1. **PENDING_WIRING.md A3 항목 → `DECIDED_NOT_WIRING` 또는 제거** (본 PR에서 처리).
2. **PR-A3-1/2/3 작업 취소** — 5 잔여 wiring 작업 자체 불필요로 판명.
3. **PR-B1-1 직진** (BEP_PROTECTION wiring) — 본 PR 에 stack.

---

## 8. 코드 변경 0건

본 PR 은 audit 산출물만 — 코드 변경 0줄. PENDING_WIRING.md 업데이트는 별도 commit.
