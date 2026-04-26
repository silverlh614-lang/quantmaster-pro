# ADR-0049 — Context-Adaptive AutoTrade Layout

- **Status**: Accepted
- **Date**: 2026-04-26
- **Related PRs**: PR-Z1 (Phase 1-1 of UI 재설계 Phase 1)
- **Related ADRs**: ADR-0009 (외부 호출 예산), ADR-0016 (5-Tier fallback / MarketDataMode), ADR-0028 (UI 재설계 P0), ADR-0030 (PriceAlertWatcher)

## 1. 배경

`AutoTradePage` 는 24시간 동일한 컴포넌트 정렬을 보여준다. KST 09:00 장 시작 5분 전과 토요일 14:00 휴장 중에 사용자가 봐야 할 1순위 컴포넌트는 명백히 다르지만, 현재 레이아웃은 시간·시장 상황과 무관하게:

```
PageHeader → ProDiagnosticsStrip(pro만) → AutoTradeHeroKpis → ApiConnectionLamps
→ TelegramConnectionTest → EngineHealthBanner → CompositeVerdictCard(pro)
→ AutoTradingControlCenter → AutoTradeTabbedView
```

순서로 고정되어 있다. 사용자 페르소나(SYSTEMATIC ALPHA HUNTER)의 "필터링" 철학과 충돌 — 정작 *지금* 답해야 할 결정 카테고리가 화면 어디에 있는지 사용자가 매번 직접 찾아야 한다.

코드베이스에는 이미 `MarketDataMode` 분류기가 두 곳에 존재한다:

- 서버: `server/utils/marketClock.ts::classifyMarketDataMode(now)` — 5값 (`LIVE_TRADING_DAY` / `AFTER_MARKET` / `WEEKEND_CACHE` / `HOLIDAY_CACHE` / `DEGRADED`)
- 클라이언트: `src/hooks/useMarketMode.ts::classifyClientMarketMode(now)` — 4값 (HOLIDAY_CACHE 미구현, DEGRADED 는 응답 diagnostics 가 결정)

이 분류기 자체는 데이터 페치 정책(외부 호출 예산)을 위해 만들어졌지만, *UI 레이아웃 정렬 우선순위* 결정 입력으로도 자연스럽게 활용 가능하다.

## 2. 결정

`AutoTradePage` 가 5개 시장 컨텍스트(`PRE_MARKET / LIVE_MARKET / POST_MARKET / OVERNIGHT / WEEKEND_HOLIDAY`)에 따라 컴포넌트 정렬 우선순위를 조정하도록 컨테이너 레이어를 추가한다. **기존 컴포넌트 본체는 단 한 줄도 수정하지 않는다.**

### 2.1 컨텍스트 5분류 SSOT

| 컨텍스트 | KST 시각 | 1순위 | 2순위 | 3순위 |
|---------|---------|-------|-------|-------|
| `PRE_MARKET` | 평일 08:30~09:00 | 어제 학습 결과 + 오늘 워치리스트 + AI 추천 신규 | 엔진 무장 준비 | 시그널 큐 |
| `LIVE_MARKET` | 평일 09:00~15:30 | 신호 큐 + 포지션 모니터링 | 엔진 헬스 | KPI |
| `POST_MARKET` | 평일 15:30~16:00 | 일일 결산 + 승률 + Attribution | 신호 회고 | KPI |
| `OVERNIGHT` | 평일 16:00 ~ 익일 08:30 | 미국 시장 영향 + 내일 시나리오 | 학습 결과 | KPI |
| `WEEKEND_HOLIDAY` | 토·일·공휴일 | 주간 회고 + 시스템 학습 결과 | 백테스트 | KPI |

### 2.2 `MarketDataMode` → `AutoTradeContext` 매핑

| `MarketDataMode` | KST 시각 추가 조건 | `AutoTradeContext` |
|------------------|------------------|--------------------|
| `LIVE_TRADING_DAY` | 08:30 ≤ t < 09:00 | `PRE_MARKET` |
| `LIVE_TRADING_DAY` | 09:00 ≤ t < 15:30 | `LIVE_MARKET` |
| `LIVE_TRADING_DAY` | 15:30 ≤ t < 16:00 | `POST_MARKET` |
| `AFTER_MARKET` | 16:00 ≤ t 또는 t < 08:30 | `OVERNIGHT` |
| `WEEKEND_CACHE` | — | `WEEKEND_HOLIDAY` |
| `HOLIDAY_CACHE` | — | `WEEKEND_HOLIDAY` |
| `DEGRADED` | — | `LIVE_MARKET` (안전 fallback — 사용자 모니터링 우선) |

**경계값 정책** (벗어나면 fallback):
- `LIVE_TRADING_DAY` 인데 KST 가 08:30 미만이면 `OVERNIGHT` (실제로는 `AFTER_MARKET` 가 반환되는 게 정상이지만, 안전망)
- `LIVE_TRADING_DAY` 인데 KST 가 16:00 이상이면 `OVERNIGHT` (동일)
- 알 수 없는 mode → `LIVE_MARKET` (가장 정보 밀도 높은 모드)

**경계값 1분 단위 SSOT**:
- 08:30 = `8 × 60 + 30 = 510` 분
- 09:00 = `9 × 60 = 540` 분
- 15:30 = `15 × 60 + 30 = 930` 분
- 16:00 = `16 × 60 = 960` 분

`isMarketOpen` 자체가 09:00 ≤ t < 15:30 정의이므로 `LIVE_TRADING_DAY` 가 반환되면 `[540, 930)` 안. PRE_MARKET 은 별도 시각 검사가 필요 (08:30~08:59).

### 2.3 패턴 — Slot Priority

`AutoTradeContextSection` 이라는 단일 컴포넌트를 신설한다:

```tsx
<AutoTradeContextSection
  id="signals"
  priorityByContext={{
    PRE_MARKET: 1,        // 최우선
    LIVE_MARKET: 1,
    POST_MARKET: 5,
    OVERNIGHT: 5,
    WEEKEND_HOLIDAY: 9,   // 실질적 비활성
  }}
  collapsedByContext={{ WEEKEND_HOLIDAY: true }}
>
  <AutoTradeTabbedView ... />
</AutoTradeContextSection>
```

- `priorityByContext` — 1=최우선 ~ 9=숨김. 미지정 컨텍스트는 5(중간) 기본값.
- `collapsedByContext` — true 면 `<details>` 접힘 상태로 렌더 (사용자가 1클릭으로 펼칠 수 있으나 시각 노이즈 제거). 미지정 컨텍스트는 false.

`AutoTradeContextualLayout` 컴포넌트가 자식 `AutoTradeContextSection` 들을 priority 오름차순으로 정렬하여 렌더한다. 동률은 children 순서 보존 (안정 정렬).

**대안 비교**:

| 패턴 | 장점 | 단점 |
|------|------|------|
| ✅ Slot Priority (채택) | 각 섹션이 자신의 컨텍스트 정책을 declare → 분산 책임 | 정렬 로직 1곳, 동률 처리 안정 |
| Render Props | 컨텍스트별 분기를 호출자가 자유롭게 결정 | AutoTradePage 본체가 5 컨텍스트 × 8 섹션 = 40 분기 → 폭발 |
| 컨텍스트별 별도 페이지 | 분기 명확 | 8개 컴포넌트 ×5 = 40 useState/useRef 중복, drift 위험 |

### 2.4 신규 모듈

| 파일 | LoC 상한 | 책임 |
|------|---------|------|
| `src/hooks/useAutoTradeContext.ts` | ≤80 | 시각 + MarketDataMode → AutoTradeContext 5분기 |
| `src/components/autoTrading/AutoTradeContextSection.tsx` | ≤80 | priority 슬롯 정의 (children + 메타데이터) |
| `src/components/autoTrading/AutoTradeContextualLayout.tsx` | ≤120 | section 정렬·접힘·렌더 |

총 신규 LoC ≤ 280, 회귀 테스트 ≤ 200.

### 2.5 통합 정책

`AutoTradePage` 본체의 변경:
1. `useAutoTradeContext()` 훅 호출 1회
2. 8개 기존 컴포넌트를 `<AutoTradeContextSection>` 로 wrap (본체 무수정)
3. `<AutoTradeContextualLayout>` 컨테이너로 wrap

각 섹션의 priority/collapsed 정책은 ADR 의 §2.1 표를 그대로 반영.

## 3. 검증

### 3.1 자동 검증

- `useAutoTradeContext` 5 컨텍스트 분기 단위 테스트 (12 케이스 신규):
  - PRE_MARKET (평일 08:30, 08:45, 08:59 — 경계값)
  - LIVE_MARKET (평일 09:00, 12:00, 15:29)
  - POST_MARKET (평일 15:30, 15:45, 15:59)
  - OVERNIGHT (평일 16:00, 평일 03:00, 평일 08:29)
  - WEEKEND_HOLIDAY (토요일, 일요일)
  - DEGRADED → LIVE_MARKET fallback
- `AutoTradeContextualLayout` 정렬 단위 테스트 (4 케이스): priority 정렬 / 동률 안정 / collapsed 분기 / 미지정 컨텍스트 기본값.

### 3.2 시각 검증 (DoD)

- KST 08:45 → AutoTradePage 첫 화면에 워치리스트/AI 추천 우선
- KST 10:00 → 신호 큐 + 포지션 우선
- KST 15:45 → 일일 결산 우선
- KST 22:00 → 미국 시장 영향 우선
- 토요일 14:00 → 주간 회고 우선

(본 PR 의 §2.1 표가 정의하는 우선순위가 화면에 정확히 반영되어야 함.)

## 4. 영향

### 4.1 영향받는 파일

- 신규: `useAutoTradeContext.ts` + `AutoTradeContextSection.tsx` + `AutoTradeContextualLayout.tsx` + 해당 .test 파일
- 수정: `AutoTradePage.tsx` (wrap 만, 본체 무수정 — 단 import 추가)
- 무수정: 8개 기존 자식 컴포넌트 (Hero KPI / ApiConnectionLamps / EngineHealthBanner / 등)

### 4.2 외부 호출 예산

- 신규 외부 호출 0건. `useMarketMode` 의 1분 polling 만 재사용.
- KIS/KRX 자동매매 quota 0 침범 (절대 규칙 #2/#3/#4 준수).

### 4.3 후속 PR 호환성

본 ADR 의 5 컨텍스트 SSOT 는 후속 Phase 1-2 (계좌생존 게이지) / Phase 1-3 (무효화 조건 미터) 가 그대로 활용한다. 예: Phase 1-2 의 `AccountSurvivalGauge` 는 모든 5 컨텍스트에서 priority=1 (항상 최상단).

## 5. 결정의 결과

- 사용자가 KST 시각에 따라 자동매매 페이지 1순위가 바뀌는 것을 즉시 체감.
- 페르소나 철학 1 "필터링" 의 UI 레벨 강제 — 사용자가 우선순위 의사결정을 매번 머릿속으로 하지 않아도 됨.
- 향후 컨텍스트 추가/조정이 단일 SSOT (`useAutoTradeContext`) 변경 + 각 섹션 priorityByContext 조정만으로 가능.
- 기존 컴포넌트 무수정 → 회귀 위험 격리.

## 6. 후속 작업 (Phase 1-2/1-3, Phase 2~4)

본 PR 종료 후 분리 진행:

- Phase 1-2: 계좌생존 게이지 (`AccountSurvivalGauge`) — 모든 컨텍스트 priority=1
- Phase 1-3: 무효화 조건 미터 (`InvalidationMeter`) — `PositionLifecyclePanel` 내부 확장
- Phase 2: Today's One Decision Card + VOID 모드 (단일 SSOT `oneDecisionResolver`)
- Phase 3: Nightly Reflection 카드 + 정성적 합치도 매트릭스 + AI 사전 게이트 평가
- Phase 4: Sankey + Kelly Surface 3D
