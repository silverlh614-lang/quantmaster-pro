# ADR-0031 — Last Trigger + Enemy Checklist + 분할매수 계획 카드 (PR-D)

- **Status**: Accepted (2026-04-26)
- **Scope**: 사용자 P1 5종 중 3종 (Last Trigger / Enemy Checklist / 분할매수 카드).
- **Related**: ADR-0028 (PR-A 배너·배지·카드), ADR-0029 (PR-B Source Tier), ADR-0030 (PR-C Price Alert).

---

## Context

P0 PR-A/B/C 가 데이터 신뢰도 + 시장 모드 + 손절 알림을 다뤘다면 P1 은 *"매수 직전의 마지막 판단"* 을
지원한다. 사용자 페르소나 자료(`12.27가지추가보완고찰_2.txt` / `14.추가보완.txt`):

> 27단계를 통과했더라도 VCP 박스권 돌파, VKOSPI 안정, 최근 긍정 공시가 동시에 발생하는 순간을
> 라스트 트리거로 정의하고, 그 전에는 대기 리스트에 머물게 하자.

3 컴포넌트:

1. **Last Trigger Card** — "왜 지금?" 4 트리거 표시 (VCP 박스권 돌파 / 거래량 증가 / VKOSPI 안정 / 최근 긍정 공시).
2. **Enemy Checklist Card** — 매수 거부 신호 3종 (공매도 잔고 증가 / 신용잔고 과열 / 주봉 RSI 과열).
3. **Tranche Plan Card** — 1차/2차/3차 분할매수 계획 + 진행 상태.

---

## Decision

### 1. LastTriggerStatus — 순수 함수

`src/utils/lastTriggerStatus.ts` 신규:

```typescript
type TriggerCheckId = 'VCP_BREAKOUT' | 'VOLUME_SURGE' | 'VKOSPI_STABLE' | 'POSITIVE_DISCLOSURE';
type TriggerCheckStatus = 'TRIGGERED' | 'PENDING';

interface LastTriggerCheck {
  id: TriggerCheckId;
  label: string;
  status: TriggerCheckStatus;
  detail?: string;
}

interface LastTriggerSummary {
  checks: LastTriggerCheck[];
  triggeredCount: number;
  totalChecks: number;
  /** 4/4 → 'EXECUTE' / 부분 → 'WATCHLIST' / 전무 → 'INACTIVE' */
  verdict: 'EXECUTE' | 'WATCHLIST' | 'INACTIVE';
}

function evaluateLastTrigger(input: {
  stock: StockRecommendation;
  vkospi?: number;
  recentPositiveDisclosure: boolean;
}): LastTriggerSummary;
```

체크 로직:
- VCP 박스권 돌파: `stock.checklist.vcpPattern >= CONDITION_PASS_THRESHOLD`
- 거래량 증가: `stock.checklist.volumeSurgeVerified >= CONDITION_PASS_THRESHOLD`
- VKOSPI 안정: `vkospi != null && vkospi < 25`
- 최근 긍정 공시: 호출자가 dartAlerts 에서 미리 계산해 boolean 으로 전달 (PR-D 는 종목→공시 매칭을 호출자에서)

### 2. EnemyChecklistFlag — 순수 함수

`src/utils/enemyChecklistFlag.ts` 신규:

```typescript
type EnemyFlagId = 'SHORT_INCREASING' | 'MARGIN_OVERHEAT' | 'WEEKLY_RSI_OVERHEAT';
type EnemyFlagStatus = 'WARNING' | 'CLEAR';

interface EnemyChecklistFlag {
  id: EnemyFlagId;
  label: string;
  status: EnemyFlagStatus;
  detail?: string;
}

interface EnemyChecklistSummary {
  flags: EnemyChecklistFlag[];
  warningCount: number;
  /** ≥2 WARNING → 'BLOCK' / 1 WARNING → 'CAUTION' / 0 → 'CLEAR' */
  verdict: 'CLEAR' | 'CAUTION' | 'BLOCK';
}

function evaluateEnemyChecklist(input: {
  stock: StockRecommendation;
  marginBalance5dChange?: number;  // macroEnv 에서
  weeklyRsi?: number;              // weeklyRsiValues[stock.code]
}): EnemyChecklistSummary;
```

체크 로직:
- 공매도 잔고 증가: `stock.shortSelling?.trend === 'INCREASING'`
- 신용잔고 과열: `marginBalance5dChange != null && marginBalance5dChange > 5` (5% 이상 5일 증가 → 과열)
- 주봉 RSI 과열: `weeklyRsi != null && weeklyRsi >= 70`

기존 `stock.enemyChecklist` (서버 AI 판단 버전) 는 자유서술형이라 별도 보존. 본 카드는 *수치 기반 체크*.

### 3. LastTriggerCard / EnemyChecklistCard / TranchePlanCard

각 카드 컴포넌트:

- 위치: 종목 카드 안 (WatchlistCard) 또는 StockDetailModal 안.
- 본 PR-D 는 **WatchlistCard 에 LastTriggerCard + EnemyChecklistCard 임베드**, **StockDetailModal 에 TranchePlanCard 임베드** (모달이 상세 페이지 — 분할매수 계획은 상세에서 보는 게 자연스러움).
- 디자인:
  - LastTriggerCard: 4개 체크 ✅/⏳ + verdict 라벨 (🟢 EXECUTE / 🟡 WATCHLIST / ⚫ INACTIVE)
  - EnemyChecklistCard: 3개 플래그 ⚠️/✓ + verdict 라벨 (🟢 CLEAR / 🟡 CAUTION / 🔴 BLOCK)
  - TranchePlanCard: 1차/2차/3차 size% + trigger 한 줄 + status (대기/실행됨)

### 4. WatchlistCard 임베드 위치

기존 PR-A 그리드 (DataQualityBadge + GateStatusCard) 아래에 새 행 추가:

```
[Signal/Action Row]
[DataQuality + Price Alert | Gate Status Card]   ← PR-A + PR-C
[Last Trigger Card        | Enemy Checklist Card] ← PR-D 신규
[External Links + Heat]
```

WatchlistCard LoC 증가 모니터 — 임계 1500 줄.

---

## Consequences

### Positive

1. 사용자가 STRONG_BUY 카드를 보고 "지금 사도 되나" 를 1초 안에 판단:
   - LastTrigger 4/4 EXECUTE + EnemyChecklist 0 WARNING → 진입 OK
   - LastTrigger 2/4 WATCHLIST → 트리거 대기
   - EnemyChecklist BLOCK → 진입 거부
2. 27단계 통과 후에도 마지막 가격·심리 트리거가 미발동인 경우를 카드 단계에서 차단.
3. 분할매수 계획이 모달에 보여서 "1차 매수 후 다음 트리거까지 대기" 정책이 시각화.

### Negative

1. WatchlistCard LoC 증가 (~80 LoC 추가 예상) — 1500 줄 임계 모니터 필요.
2. dartAlerts 에서 종목 매칭은 호출자(WatchlistCard)에서 계산 — 일관성 위해 `dartAlerts.some(d => d.stock_code === stock.code && d.sentiment === 'POSITIVE')` 패턴 권장.
3. weeklyRsiValues 가 모든 종목에 채워지지 않을 수 있음 — undefined 처리.

### Neutral

- 기존 `stock.enemyChecklist` (자유서술 AI 판단) 보존 — StockDetailModal 의 별도 섹션에서 사용 가능.
- TranchePlan 데이터는 이미 stock.tranchePlan 에 존재 — 신규 데이터 페칭 없음.

---

## Implementation Plan (PR-D)

1. `src/types/ui.ts` — `LastTriggerCheck / LastTriggerSummary / EnemyChecklistFlag / EnemyChecklistSummary` 타입.
2. `src/utils/lastTriggerStatus.ts` 신규 + 테스트.
3. `src/utils/enemyChecklistFlag.ts` 신규 + 테스트.
4. `src/components/watchlist/LastTriggerCard.tsx` 신규.
5. `src/components/watchlist/EnemyChecklistCard.tsx` 신규.
6. `src/components/analysis/TranchePlanCard.tsx` 신규.
7. `src/components/watchlist/WatchlistCard.tsx` 임베드 (Last + Enemy 한 줄).
8. `src/components/analysis/StockDetailModal.tsx` 또는 sub-section 에 TranchePlanCard 임베드 (위치는 가벼운 추가).
9. quality-guard + commit + push.

---

## Out of Scope (deferred)

- **PR-E**: 섹터 로테이션 히트맵 (P1-2).
- **PR-F**: 후보군 파이프라인 시각화 (P1-1) — 서버 통계 라우트 신설 필요.
- 사용자 임계 설정 UI (Enemy 신용잔고 5% / RSI 70 임계 변경).
- TranchePlan 사용자 편집 (1차/2차 비율 조정) — 별도 PR.
