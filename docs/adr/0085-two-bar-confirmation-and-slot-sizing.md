# ADR-0085 — Two-Bar Confirmation Gate + 슬롯 sizing 자본 가중 (PR-S2 인프라)

**상태**: Accepted (2026-04-28)
**배경**: ADR-0079 / ADR-0080 §"후속 PR" 명문화된 BEP #2 + PR-S2 두 트랙 진행. LIVE 매매
영향 격리를 위해 **본 PR 은 정책 함수 + 영속 schema 확장 + 회귀 테스트만**. 실제 청산
규칙 wiring + sizing 분모 전환은 후속 PR 에서 운영 데이터 누적 후 활성화.

## 트랙 1 — Two-Bar Confirmation Gate (BEP 글라이드 단봉 노이즈 차단)

### 문제

ADR-0079 (PR-Z6) 가 BEP +5% 진입 시 stopLoss 를 `entryPrice - 0.5×ATR` 글라이드로
설정해 *변동성 가중 마진* 을 흡수. 그러나 단봉 노이즈 (예: 장중 일시 급락)에서도
즉시 청산 트리거 — 다음 봉에 회복하면 *진짜 추세 반전이 아닌데 청산* 한 손실 발생.

ADR-0080 §"후속 PR" 에 BEP #2 Two-Bar Confirmation 명시.

### 결정

BEP 글라이드 영역 손절선 도달 시 **2개 봉(2 영업일) 연속 미달 확인 후 청산**.

- 1차 터치: `shadow.bepGlideTouchAt = ISO_KST_DATE` 영속 + 청산 *보류*
- 2차 터치 (다음 영업일): 회복 안 됨 → 청산 / 회복 (currentPrice > stopLoss): 영속 reset
- 단봉 노이즈 → 장중 회복 시 영속 reset (다음 일봉 보존)

### 정책 SSOT

- `BEP_TWO_BAR_GRACE_DAYS = 1` (1 영업일 grace = 2개 봉)
- ENV 롤백 `BEP_TWO_BAR_CONFIRMATION_DISABLED=true`
- ADR-0079 분류와 정합 — `classifyStopSource(stopLoss, entry, atr14) === 'BEP_PROTECTION'`
  인 경우만 본 정책 적용. 일반 LOSS_STOP / INITIAL / REGIME / PROFIT_LOCK_IN 은 즉시 청산
  유지 (BEP 영역만 단봉 노이즈 차단).

### 결정 함수 SSOT — `server/trading/twoBarConfirmation.ts`

```ts
export type TwoBarDecision =
  | { action: 'CONFIRM_EXIT'; reason: string }
  | { action: 'WAIT'; reason: string; touchAt: string }
  | { action: 'RESET'; reason: string }
  | { action: 'PASS'; reason: string };

export function evaluateTwoBarConfirmation(input: {
  currentPrice: number;
  stopLoss: number;
  entryPrice: number;
  entryATR14?: number;
  bepGlideTouchAt?: string;          // shadow 영속 — 1차 터치 KST 일자
  currentDateKst: string;            // 현재 KST 영업일
  isBepProtection: boolean;          // ADR-0079 classifyStopSource 결과
}): TwoBarDecision;
```

### 영속 schema 확장

`ServerShadowTrade.bepGlideTouchAt?: string` 옵셔널 추가 (1차 터치 KST 일자).
기존 영속 호환 유지 (옵셔널). PR-Y2 patch 와 동일 패턴.

### 본 PR scope (인프라만)

1. ADR-0085 신규
2. `server/trading/twoBarConfirmation.ts` 정책 함수 SSOT
3. `server/trading/twoBarConfirmation.test.ts` 회귀 ≥10 케이스
4. `ServerShadowTrade.bepGlideTouchAt?` 필드 schema 확장 (호출자 0건 — 실제 wiring 후속)

### 본 PR 비-범위 (후속)

- `exitEngine/rules/hardStopLoss.ts` wiring (BEP_PROTECTION 분기에서 `evaluateTwoBarConfirmation` 호출)
- shadowTrade 영속 갱신 (1차 터치 시점 저장)

## 트랙 2 — PR-S2 슬롯 sizing 자본 가중 (인프라)

### 문제

ADR-0080 §"후속 PR" — `perSymbolEvaluation.ts:902 remainingSlots` (sizing 분할 비율의
분모) 가 자본 가중 미적용. 30% 잔존 5개 = 1.5 슬롯 (자본 가중) 이지만 분모는 여전히
단순 카운트 5. *신규 진입 포지션 크기* 가 영향받음.

ADR-0080 명시:
> *신규 진입 포지션 크기* 가 달라지므로 LIVE 영향 평가 신중 필요.
> shadow mode 1주 검증 후 별도 PR.

### 결정 (인프라만)

본 PR 은 **default 비활성** 정책 함수만 신설. 운영자가 `SLOT_CAPITAL_WEIGHTED_SIZING_ENABLED=true`
명시 활성화 후 1주 검증.

### 정책 함수 SSOT — `server/trading/slotSizing.ts`

```ts
export interface SlotSizingDecision {
  effectiveDenominator: number;  // sizing 분할 분모
  rawCount: number;              // 단순 활성 카운트
  consumed: number;              // 자본 가중 합계 (PR-S1 SSOT 재사용)
  source: 'SIMPLE' | 'CAPITAL_WEIGHTED';
}

export function evaluateSlotSizing(input: {
  effectiveMaxPositions: number;
  reservedSlots: number;
  shadows: ServerShadowTrade[];
}): SlotSizingDecision;
```

- ENV `SLOT_CAPITAL_WEIGHTED_SIZING_ENABLED=true` 시 PR-S1 의 `computeSlotConsumption()`
  결과 사용 → `effectiveDenominator = max(1, effectiveMaxPositions - consumed - reservedSlots)`
- Default (env 미설정) → `effectiveDenominator = max(1, effectiveMaxPositions - rawCount - reservedSlots)`
  (현재 동작 byte-equivalent)

### 본 PR scope (인프라만)

1. `server/trading/slotSizing.ts` 정책 함수 SSOT
2. `server/trading/slotSizing.test.ts` 회귀 ≥10 케이스 (default + ENABLED 분기)

### 본 PR 비-범위 (후속)

- `perSymbolEvaluation.ts:902` 호출자 wiring (default 미사용 → ENABLED 시 활성)
- `intraday` sizing 동일 분기 적용

## 회귀 테스트 ≥20 케이스

- `twoBarConfirmation.test.ts` ≥10 (CONFIRM_EXIT / WAIT / RESET / PASS 분기 + ENV 롤백 +
  isBepProtection=false 시 즉시 PASS + bepGlideTouchAt 형식)
- `slotSizing.test.ts` ≥10 (default 단순 / ENABLED 자본 가중 / 분모 floor 1 / shadows 빈 /
  ENV 토글 / reservedSlots / 양 분기 동치 검증)

## LIVE 영향

- 트랙 1 정책 함수 호출자 0건 → LIVE 매매 영향 0
- 트랙 2 정책 함수 default 미활성 → LIVE 매매 영향 0
- 영속 schema 확장 1 옵셔널 필드 → 기존 영속 호환 유지

## 참조

- ADR-0079 ATR-Buffered BEP Glide (PR-Z6)
- ADR-0080 Capital-Weighted Slot Accounting (PR-S1)
- ADR-0080 §"후속 PR" — BEP #2 + PR-S2 명문화

## PR-P0-Activation (2026-05-06) — default OFF → ON

### 배경

ADR-0085 PR-B1-1 (PR #486, 2026-05-01) 에서 hardStopLoss BEP_PROTECTION 분기에 `applyTwoBarBepGate` wiring 완료. SHADOW only 활성 default — `BEP_TWO_BAR_LIVE_ENABLED=true` 명시 시에만 LIVE 모드 활성. 운영자 명시 결정 대기 패턴.

PR-A (#665) 머지 후 사용자 명시 *"P0 패치 후 머지 실시"* — 본 PR 으로 **default ON 전환**.

### 변경

`isBepTwoBarLiveEnabled()` SSOT 정확 비교 패턴 격상:

- **이전**: `process.env.BEP_TWO_BAR_LIVE_ENABLED === 'true'` (default OFF)
- **신규**: `process.env.BEP_TWO_BAR_LIVE_ENABLED !== 'false'` (default ON, ADR-0157 정확 비교 의무)

회귀 발견 시 ENV `BEP_TWO_BAR_LIVE_ENABLED=false` 1줄 즉시 롤백 → ADR-0085 PR-B1-1 default OFF 동작 byte-equivalent 복원.

### 회귀 테스트 정합 정정

- `isBepTwoBarLiveEnabled() default false` → `default true` (PR-P0-Activation 정합)
- `BEP_TWO_BAR_LIVE_ENABLED=false 명시 → false` 신규 케이스 추가
- LIVE 회귀 격리 분기 — `=false` 명시 시 SKIP (legacy 회귀 격리 보존)

### 운영 효과

LIVE 모드 진입 시 BEP_PROTECTION 분기 자동 활성 — 단봉 노이즈 손절 회피 즉시 작동. SHADOW 1주 검증 (PR-B1-1 머지일 2026-05-01 ~ 2026-05-06) 충분 + 사용자 명시 SHADOW only 운영 (LIVE 미진입) 이라 회귀 위험 0.
