# ADR-0030 — Price Alert Watcher (PR-C)

- **Status**: Accepted (2026-04-26)
- **Scope**: ADR-0028 PR-A 후속. 사용자 P0-2 "손절·목표가 도달 알림" 구현.
- **Related**: ADR-0028 (UI 재설계 P0-A), ADR-0029 (PR-B Source Tier).

---

## Context

사용자 P0-5 항목 중 P0-2 만 별도 PR 로 분리 — Web Notification 권한 흐름은 브라우저 API
의존 + localStorage 영속 + 사용자 opt-in 흐름이 별도라 회귀 격리 필요.

사용자 원안 4단계:
- 🟢 정상: 계획 범위 내
- 🟡 주의: 손절가까지 3 % 이내
- 🔴 위험: 손절가 도달
- 🎯 익절: 1차 목표가 도달

기존 시스템은 텔레그램 알림(server-side)만 있고 *프론트엔드* 손절·익절 알림이 부재.
사용자가 페이지를 열어두지 않아도 텔레그램은 도달하지만, 페이지를 보고 있을 때
즉각 OS-level 알림이 필요한 사용자 시나리오를 지원해야 한다.

---

## Decision

### 1. 알림 레벨 계산 — 순수 함수

`src/utils/priceAlertLevel.ts` 신규:

```typescript
type PriceAlertLevel = 'NORMAL' | 'CAUTION' | 'DANGER' | 'TAKE_PROFIT';

interface PriceAlertInput {
  currentPrice: number;
  stopLoss: number;
  targetPrice: number;
  /** 손절선 근접 임계 (기본 3 %, 사용자 설정 가능). */
  cautionPctToStop?: number;
}

function computePriceAlertLevel(input: PriceAlertInput): PriceAlertLevel {
  // currentPrice ≤ stopLoss → DANGER
  // currentPrice ≥ targetPrice → TAKE_PROFIT
  // (currentPrice - stopLoss) / currentPrice ≤ cautionPctToStop/100 → CAUTION
  // 그 외 → NORMAL
}
```

우선순위: `TAKE_PROFIT > DANGER > CAUTION > NORMAL`. 동시 충족 시 위 순서.

### 2. usePriceAlertWatcher hook

`src/hooks/usePriceAlertWatcher.ts`:

```typescript
function usePriceAlertWatcher(stocks: StockRecommendation[]): void;
```

내부 책임:
- 매번 stocks 배열을 watch 하여 alertLevel 변경 감지
- alertLevel transition 발생 시 (NORMAL→CAUTION/DANGER/TAKE_PROFIT) Web Notification 발송
- dedupe: 같은 종목 같은 alertLevel 알림이 `ALERT_COOLDOWN_MS=300_000` (5분) 내 반복 차단
- 권한 미부여 시 in-app 만 (Notification 미발송)

### 3. 권한 흐름 — 사용자 opt-in

`useSettingsStore` 에 신규 필드:
- `priceAlertsEnabled: boolean` (기본 false — 사용자가 명시 활성화)
- `setPriceAlertsEnabled(enabled: boolean): void`

활성화 시도 시:
1. `Notification.permission === 'default'` → `Notification.requestPermission()` 호출
2. `'granted'` → 활성화 + 토스트 "알림 활성화됨"
3. `'denied'` → 활성화 거부 + 토스트 "브라우저 설정에서 권한 필요"

권한 거부 후 재시도하려면 사용자가 브라우저 설정에서 직접 풀어야 함 (브라우저 정책).

### 4. PriceAlertBadge — 카드 임베드

`src/components/common/PriceAlertBadge.tsx`:

```typescript
interface PriceAlertBadgeProps {
  level: PriceAlertLevel;
  currentPrice: number;
  stopLoss: number;
  targetPrice: number;
}
```

렌더:
- NORMAL: 회색 "🟢 정상"
- CAUTION: 황색 "🟡 손절선 N% 이내"
- DANGER: 적색 "🔴 손절가 도달"
- TAKE_PROFIT: 청록 "🎯 1차 목표가 도달"

### 5. WatchlistCard wiring

기존 그리드 (DataQualityBadge + GateStatusCard) 옆 또는 위에 PriceAlertBadge 추가.
hook 은 페이지 레벨에서 1회만 호출 — 카드별 호출 시 N개 종목 × N개 hook = 성능 폭증.
`DiscoverWatchlistPage` 또는 `PageRouter` 에서 `usePriceAlertWatcher(allStocks)` 1회 호출.

### 6. localStorage dedupe key

키: `qm:price-alert:{stockCode}:{alertLevel}` → value: `lastFiredAt (ISO)`.
hook 진입 시 cooldown 검사 → 만료된 entry 만 발송 + 갱신.

---

## Consequences

### Positive

1. 사용자가 "손절가 도달 알림 못 봐서 추가 손실" 시나리오 차단.
2. 4단계 색상 배지로 워치리스트 카드 한눈에 위험 인지.
3. 텔레그램 알림과 보완 — 페이지 열린 동안 즉시 OS-level 알림.

### Negative

1. Notification API 미지원 브라우저 (구형 Safari 등) 에선 in-app 배지만 동작.
2. 사용자가 권한 거부하면 재요청 불가 (브라우저 정책) — 안내 메시지 필요.
3. Service Worker 미사용 → 페이지 닫혀있으면 알림 발송 안 됨 (텔레그램 server-side 에 의존).

### Neutral

- `priceAlertsEnabled=false` 가 기본값 — opt-in. 기존 사용자에게 강제되지 않음.
- 4단계 분류는 순수 함수 → 테스트 가능 + 다른 화면(텔레그램·이력)에서도 재사용 가능.

---

## Implementation Plan (PR-C)

1. `src/types/ui.ts` — `PriceAlertLevel` 타입 export.
2. `src/utils/priceAlertLevel.ts` 신규 — 순수 함수 + 테스트.
3. `src/stores/useSettingsStore.ts` — `priceAlertsEnabled` + setter 추가.
4. `src/hooks/usePriceAlertWatcher.ts` 신규 — Web Notification + dedupe + 테스트.
5. `src/components/common/PriceAlertBadge.tsx` 신규.
6. `src/components/watchlist/WatchlistCard.tsx` 임베드.
7. `src/pages/PageRouter.tsx` 또는 적절한 layer 에서 `usePriceAlertWatcher(displayList)` 호출.
8. quality-guard + commit + push.

---

## Out of Scope (deferred)

- **Service Worker**: 페이지 닫혀있을 때 알림 — 더 복잡한 권한·등록 흐름. 별도 PR.
- **사운드 알림**: 알림에 beep 추가 — 별도 PR.
- **알림 이력 페이지**: "최근 1주일간 알림 N건" — P2 별도 PR.
- **알림 임계 사용자 설정**: cautionPctToStop 사용자 변경 UI — 본 PR 은 기본값 3% 만.
