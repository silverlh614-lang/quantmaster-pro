# ADR-0124: 텔레그램 리포트 BE 가시화 — 본절 별도 라인

**상태:** 채택 (2026-04-30)
**시리즈:** ADR-0112 (BREAKEVEN 분류 SSOT) + ADR-0123 (학습/Bias BE 격리) 후속 PR

## 컨텍스트

ADR-0123 (PR-E, 2026-04-30) 가 명문화한 후속 PR:

> ### 후속 PR
> - 텔레그램 리포트 (shadowProgressBriefing / weeklyIntegrityReport /
>   weeklySelfCritiqueReport / shadowLearningSummary) 의 winFills/lossFills
>   표시에 beFills 별도 라인 추가
> - aggregateFillStats 의 beFills 호출자 wiring (현재 ADR-0112 도입했지만
>   호출자 활용 부재)

audit 결과 (2026-04-30):

- ADR-0112 가 `aggregateFillStats` SSOT 에 `beFills?: number` 옵셔널 필드 +
  WIN/LOSS/BE 3-way 분류 (WIN_PCT_MIN=1.0 / BE band -0.5~+0.5 / LOSS<-0.5) +
  `BE_CLASSIFICATION_DISABLED=true` ENV 우회를 이미 도입.
- ADR-0123 가 학습 SSOT (`nightlyReflectionEngine.summarizeTodaysRealizationsForLearning`
  + `biasHeatmap.scoreLossAversion`) 의 BE 격리 완료 — 학습 가중치 보수화·
  LOSS_AVERSION 오탐 차단.
- **잔여 갭** — 3 텔레그램 리포트의 *포맷 함수* 가 `aggregateFillStats()` 의
  `beFills` 옵셔널 필드를 *수신* 만 하고 *별도 표시* 미구현. 운영자 시각에서는
  여전히 "WIN/LOSS 이분법" 으로 보이는 가시성 손실.

영향:
1. `shadowProgressBriefing.formatShadowProgress` L132-136 — `🎯 실현 fill: N익 / M손`
2. `weeklyIntegrityReport.formatWeeklyIntegrityReport` L172 — `익 fill: N건 / 손 fill: M건`
3. `weeklySelfCritiqueReport.formatWeeklySelfCritique` L167 — `(승 N / 패 M)`

운영자가 *본절이 발생했는데 보고는 누락된* 상태로 인지하면, 본절 거래의 *알파
중립 + 리스크 성공* 의 가치가 학습 SSOT 에서는 정확히 분류됨에도 불구하고
텔레그램 리포트에서는 "수익도 손실도 아닌 보이지 않는 거래" 로 흡수됨.

## 결정

3 텔레그램 포맷 함수의 fill 통계 라인에 BE 카운트 조건부 표시.

### 1. 통계 인터페이스 옵셔널 확장

각 모듈의 통계 객체에 `beFills?: number` 옵셔널 필드 추가:

```typescript
// shadowProgressBriefing.ts
export interface ShadowProgress {
  // ... 기존 필드 ...
  fillWins:    number;
  fillLosses:  number;
  fillBeFills?: number;   // ADR-0124 신규
  // ...
}

// weeklyIntegrityReport.ts
export interface WeeklyIntegrityStats {
  // ... 기존 필드 ...
  fillWins: number;
  fillLosses: number;
  beFills?: number;       // ADR-0124 신규
  // ...
}

// weeklySelfCritiqueReport.ts WeeklySelfCritiqueInputs.fillStats
fillStats: {
  fillCount: number;
  winFills: number;
  lossFills: number;
  beFills?: number;       // ADR-0124 신규
  // ...
}
```

후방호환 옵셔널 — 기존 호출자 무영향. `aggregateFillStats(...)` 가 이미 반환하는
`beFills` 옵셔널 필드를 그대로 propagate.

### 2. 포맷 함수 조건부 라인 추가

각 포맷 함수에서 `beFills > 0` 일 때만 추가 표시 — 운영자 인지 부담 ↓:

```typescript
// shadowProgressBriefing.formatShadowProgress
const realizedLine = (p.fillWins + p.fillLosses + (p.fillBeFills ?? 0)) > 0
  ? `🎯 실현 fill: ${p.fillWins}익 / ${p.fillLosses}손` +
    ((p.fillBeFills ?? 0) > 0 ? ` / ${p.fillBeFills}본절` : '') +
    (p.partialOnlyCount > 0 ? ` · 부분매도만 ${p.partialOnlyCount}건` : '') +
    ` · 가중 P&L ${...}`
  : '';
```

`beFills` 를 winFills/lossFills 와 동일 라인에 슬래시 분리 (`N익 / M손 / K본절`)
형식으로 — 한 줄 요약 가독성 보존.

### 3. ENV 우회 자연 호환

ADR-0112 의 `BE_CLASSIFICATION_DISABLED=true` 활성 시 `aggregateFillStats.beFills`
가 자동 0 반환 → 본 PR 의 포맷 함수가 `beFills > 0` 분기로 자동 silent →
ADR-0112 ENV 우회 시 *기존 2-way 표시 100% 보존*.

### 4. 학습 SSOT 무영향

본 PR 은 *텔레그램 포맷 함수만* 수정. ADR-0123 의 학습 BE 격리 정합성 100% 보존:

- `nightlyReflectionEngine.summarizeTodaysRealizationsForLearning` 무수정
- `biasHeatmap.scoreLossAversion` 무수정
- `aggregateFillStats` SSOT 무수정
- 학습 영속 데이터 (`TodaysRealizationSummary.beFills`) 무영향

## 결과

### 변경 파일

- `server/alerts/shadowProgressBriefing.ts` (ShadowProgress.fillBeFills? +
  formatShadowProgress BE 라인 + computeShadowProgress/_computeProgressFromShadows wiring)
- `server/alerts/weeklyIntegrityReport.ts` (WeeklyIntegrityStats.beFills? +
  formatWeeklyIntegrityReport BE 라인 + computeWeeklyIntegrityStats/_computeFromShadows wiring)
- `server/alerts/weeklySelfCritiqueReport.ts` (WeeklySelfCritiqueInputs.fillStats.beFills? +
  formatWeeklySelfCritique BE 라인 + runWeeklySelfCritique propagate)
- `server/alerts/telegramReportsBeAdr0124.test.ts` (신규 회귀 테스트)

### 검증

- vitest 신규 회귀 + 인접 무회귀 (server/alerts + server/persistence)
- lint(client + server tsc) 0 에러
- KIS/KRX 자동매매 quota 0 침범 (절대 규칙 #2/#3/#4 — 알림 포맷만 변경)
- LIVE 매매 본체 0줄 변경

### 운영 효과

1. **본절 거래 가시성 회복** — 운영자가 텔레그램 한 번에 "익/손/본절" 3-way
   분포 즉시 인지. 본절 거래의 *리스크 성공* 가치가 보이지 않던 결함 영구 차단.
2. **학습 SSOT 정합 보존** — 텔레그램 가시화는 학습 SSOT 의 자연 확장 — ADR-0123
   가 명시한 후속 PR 완수.
3. **ENV 우회 호환** — `BE_CLASSIFICATION_DISABLED=true` 활성 시 자동 silent →
   회귀 위험 격리.

### 후속 PR (scope 외)

- `recommendationTracker.monthlyStats.winRate` fill 단위 격상 (현재 trade 단위
  WIN/LOSS 만, fill 수준 BE 분류 미반영) — 학습 SSOT 변경이라 회귀 위험 격리,
  운영 데이터 누적 후 별도 PR
- `shadowLearningSummary` (PR-H) wiring — 일일 리포트 Shadow 학습 라인의 BE
  표기 추가
- UI 측 (DataQualityBadge / VerdictCard 등) BE 가시화는 ADR-0099+ 시리즈 별도
