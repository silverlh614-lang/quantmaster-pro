# ADR-0053 — Nightly Reflection Card

- **Status**: Accepted
- **Date**: 2026-04-26
- **Related PRs**: PR-Z5 (Phase 3-1 of UI 재설계)
- **Related ADRs**: ADR-0007 (Learning Feedback Loop Policy), ADR-0049 (Layout), ADR-0050~0046 (Phase 1+2 cards)

## 1. 배경

`nightlyReflectionEngine` 이 매일 KST 19:00 학습 결과(keyLessons / tomorrowAdjustments / 실험 제안 / 편향 heatmap / 5-Why 등)를 영속하지만, 사용자가 이를 *체크*할 수 있는 채널은 텔레그램 `/learning_status` 명령 단 하나(PR-36 도입). AutoTradePage 에서는 학습 결과가 보이지 않는다 — 사용자가 "그래서 시스템이 어제 무엇을 배웠나?" 라는 질문에 답을 받으려면 별도 채널로 전환해야 함.

페르소나 철학 10 ("지속적 학습과 정보 습득") 의 사용자 통제 가능성이 약화된다. 시스템이 학습한 내용을 사용자가 *볼 수 없으면* 그 학습이 자기 검증되지 않는다.

ADR-0007 의 자기학습 폐쇄루프 정책은 "thresholds trigger Telegram suggest alerts, manual approval for actual changes" — 즉 텔레그램 알림은 활성이지만 *manual approval* 자체는 미구현. 본 PR 은 *읽기 전용* 카드로 시작하여 후속 PR(매뉴얼 승인 인프라)의 시드를 마련.

## 2. 결정

`AutoTradePage` 에 `<NightlyReflectionCard>` 추가 — Pro 모드 한정, 컨텍스트별 priority 분기. 기존 `/api/learning/status` 엔드포인트(PR-36) 재활용. 서버 0줄 수정.

### 2.1 컨텍스트별 priority 정책

| Context | priority | 사유 |
|---------|----------|------|
| `POST_MARKET` | 2 | 일일 결산 직후 — 학습 결과 회고에 가장 적절 |
| `OVERNIGHT` | 3 | 학습 cron(KST 19:00)이 OVERNIGHT 안에 실행됨 — 신선도 최고 |
| `WEEKEND_HOLIDAY` | 2 | 주간 회고 시간 — 누적 학습 결과 정독 |
| `PRE_MARKET` | 5 | 시장 시작 전 정신 정렬용 — 중간 |
| `LIVE_MARKET` | 7 | 장중에는 후순위 — 의사결정 분산 차단 |

다른 섹션(Hero KPI / SignalQueue / EngineHealth) 정책 무수정 — 안정 정렬 동일 priority 시 순서 보존.

### 2.2 Pro 모드 한정

`useSettingsStore.autoTradeViewMode === 'pro'` 일 때만 `<AutoTradeContextSection>` 렌더. Simple 모드에서는 학습 메타 데이터 노출 안 함 (페르소나 철학 1 "필터링" — 신규 사용자에게 인지 부담 차단).

### 2.3 표시 항목 SSOT

| 영역 | 데이터 소스 | 조건 |
|------|----------|------|
| 어젯밤 verdict 이모지 | `lastReflection.dailyVerdict` | 4 분기 GOOD_DAY 🟢 / MIXED 🟡 / BAD_DAY 🔴 / SILENT ⚪ |
| narrative preview | `lastReflection.narrativePreview` (서버에서 200자 절삭) | 200자 초과 시 `…` |
| keyLessons | `lastReflection.keyLessonsCount` 가 카운트만 노출 (텍스트는 텔레그램 `/learning_status`) | Top 3 — 카운트만 |
| 내일 조정 권고 | `lastReflection.tomorrowAdjustmentsCount` | 카운트만 |
| 활성 실험 제안 | `experimentProposalsActive.length` + 한글 라벨 | ≥1 시 표시 |
| 7일 편향 escalating | `biasHeatmap7dAvg` + `escalatingBiases` 우선 | Top 3 |
| 누락 경고 | `consecutiveMissingDays ≥ 3` | ⚠️ |
| Reflection 부재 | `lastReflection === null` | placeholder + 예산 모드 |
| Gemini 예산 | `reflectionBudget.mode` (FULL/REDUCED_EOD/TEMPLATE_ONLY 등) | 본 카드 footer |

LearningStatusSnapshot 의 `narrativePreview` 는 서버에서 이미 200자 절삭. 클라이언트는 추가 절삭 없음.

**중요**: `keyLessons` / `tomorrowAdjustments` 의 *텍스트 본문* 은 본 카드에 노출하지 않음. 카운트만 노출 → 사용자가 텔레그램 `/learning_status` 로 정독하도록 유도 (ADR-0007 의 manual approval 채널이 텔레그램 SSOT 라는 정합 유지).

### 2.4 신규 모듈

| 파일 | LoC 상한 | 책임 |
|------|---------|------|
| `src/api/learningClient.ts` | ≤ 90 | LearningStatusSnapshot 동기 사본 + fetchLearningStatus |
| `src/components/autoTrading/NightlyReflectionCard.tsx` | ≤ 220 | TanStack Query + verdict 이모지 + 카운트/편향/누락 경고 |

수정: `src/pages/AutoTradePage.tsx` (+1 import + Pro 가드 + 1 섹션 wrap).

### 2.5 데이터 흐름

```
NightlyReflectionCard
  └─ useQuery(['learning-status'], fetchLearningStatus)
       ↓ GET /api/learning/status (PR-36 기존)
       ↓ LearningStatusSnapshot
     렌더링 — 외부 호출 0건 (서버 read-only state.ts + reflectionRepo)
```

### 2.6 후속 작업 (별도 PR)

- 매뉴얼 승인 인프라: `experimentProposalsActive[i]` 의 AWAIT_APPROVAL 상태에서 사용자가 카드 내 "승인 / 거부" 버튼 클릭 → 텔레그램 manual approval 와 동일 SSOT 호출. 본 PR 은 *카운트와 라벨만* 노출.
- 7일 trend chart: 편향 점수 시계열 sparkline. 본 PR 은 Top 3 라벨만.
- /learning_history days=N 슬라이더: AutoTradePage 가 아닌 별도 페이지 (RecommendationHistoryPage 와 비슷).

## 3. 검증

### 3.1 자동 검증 (≥ 12 케이스)

- `learningClient` (≥ 2): fetch 정상 / fetch 실패
- `NightlyReflectionCard` (≥ 10): 4 verdict 이모지 / narrative preview 표시 / keyLessons Top 3 카운트 / 활성 실험 ≥1 / 편향 heatmap Top 3 / reflection 부재 placeholder / 누락 N일 경고 / loading / error / data-verdict 속성

### 3.2 시각 검증 (DoD)

- Pro 모드 + POST_MARKET 시 화면 priority 2 위치 (Hero KPI 직후)
- LIVE_MARKET 에서는 priority 7 후순위
- Simple 모드 사용자는 카드 자체 미렌더

## 4. 영향

### 4.1 영향받는 파일

- 신규: `src/api/learningClient.ts` + `src/components/autoTrading/NightlyReflectionCard.tsx` + 두 테스트 파일 + ADR
- 수정: `src/pages/AutoTradePage.tsx` (+1 import + 1 섹션)
- 무수정: 서버 전체 / `learningRouter.ts` / `nightlyReflectionEngine.ts` / `reflectionRepo.ts` / `learningHistorySummary.ts`

### 4.2 외부 호출 예산

- 신규 outbound 0건. `/api/learning/status` 는 메모리 read 만.
- 클라이언트 폴링: 5분 staleTime + 5분 refetchInterval (학습 cron 이 매일 19:00 1회만 갱신).
- KIS/KRX 자동매매 quota 0 침범.

## 5. 결정의 결과

- 사용자가 AutoTradePage 진입 시 어젯밤 학습 결과 즉시 확인 (POST_MARKET/OVERNIGHT/WEEKEND 우선)
- 페르소나 철학 10 ("지속적 학습") 의 사용자 통제 가능성 1차 확보
- 후속 manual approval PR 의 시드 — 카드 위에 승인/거부 버튼 추가 시 텔레그램 SSOT 와 자연 통합
- ADR-0050 (계좌) + ADR-0051 (포지션) + ADR-0052 (결정) + ADR-0053 (학습) **4 layer SSOT 결합**으로 시스템 위험·결정·학습 모두 표면화
