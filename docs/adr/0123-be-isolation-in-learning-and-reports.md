# ADR-0123: 학습/리포트 BE 격리 — 본절은 손절로 학습 안 함

**상태:** 채택 (PR-E, 2026-04-30)
**시리즈:** 옵션 B PR-A~D 후속 + 사용자 4/30 PM 추가 보고

## 컨텍스트

사용자 4/30 추가 보고:

> 학습 및 보고 리포트에 본절은 손절로 기록하고 학습하지 말 것, 데이터 오염 발생함.

ADR-0112 (PR-α) 가 BE 분류 (classifyFillOutcome) + 서킷 카운트 분리 도입했지만 *학습 + 보고 리포트 영역* wiring 미완. audit 결과 2 위치에서 BE 가 LOSS 로 잘못 카운트:

1. `nightlyReflectionEngine.summarizeTodaysRealizationsForLearning` (라인 240-241, 257-258)
   - `f.pnl > 0 → winFills++ / f.pnl < 0 → lossFills++` 절대값 분기
   - +0.3% 같은 BE 도 lossFills 또는 winFills 로 잘못 카운트
2. `biasHeatmap.scoreLossAversion` (라인 125-126, 132-133)
   - 동일 절대값 분기
   - lossAversion 편향 점수가 BE 를 LOSS 로 카운트해 오탐 발생

사용자 명시 — *데이터 오염*. 학습 가중치가 잘못된 BE 분류로 보수화되거나, 편향 heatmap 이 LOSS_AVERSION 오탐 발생.

## 결정

### 1. classifyFill 헬퍼 SSOT (ADR-0112 정합)

두 모듈 모두 inline classifyFill 헬퍼 도입 — 비율 기반 우선 + 절대값 fallback:

```typescript
const classifyFill = (f: { pnl?: number; pnlPct?: number }): 'WIN' | 'LOSS' | 'BE' => {
  const pct = f.pnlPct;
  if (typeof pct === 'number' && Number.isFinite(pct)) {
    if (pct >= 1.0) return 'WIN';                    // ADR-0112 WIN_PCT_MIN
    if (pct >= -0.5 && pct <= 0.5) return 'BE';      // ADR-0112 BE band
    if (pct <= -0.5) return 'LOSS';                  // ADR-0112 LOSS_PCT_MAX
    return 'BE';                                     // +0.5 < pct < +1.0 보수적 fallback
  }
  // pnlPct 부재 시 절대값 fallback (회귀 호환)
  if ((f.pnl ?? 0) > 0) return 'WIN';
  if ((f.pnl ?? 0) < 0) return 'LOSS';
  return 'BE';
};
```

### 2. `TodaysRealizationSummary.beFills?` 옵셔널 영속

```typescript
export interface TodaysRealizationSummary {
  fullClosedCount: number;
  partialOnlyCount: number;
  winFills: number;
  lossFills: number;
  beFills?: number;        // ADR-0123 신규
  totalRealizedKrw: number;
  weightedReturnPct: number;
  labels: string[];
}
```

- 후방호환 옵셔널 (기존 호출자 무영향)
- `summarizeTodaysRealizationsForLearning` 가 자동 영속
- 텔레그램 리포트 (shadowProgressBriefing / weeklyIntegrityReport / weeklySelfCritiqueReport) 가 후속 PR 에서 BE 별도 표시 가능

### 3. nightlyReflectionEngine 본문 격상

`summarizeTodaysRealizationsForLearning` 의 두 fill 루프 (전량 청산 + 부분매도) 모두 `classifyFill` 통과 후 winFills/lossFills/beFills 분리 카운트. lossRatio (라인 516) 자동 정합 — `lossFills / (winFills + lossFills)` 분모에서 BE 자연 제외.

### 4. biasHeatmap.scoreLossAversion 격상

두 fill 루프 (전량 + 부분매도) 모두 classifyFill 통과. **BE 는 lossAversion 편향 점수 미카운트** — 본절을 손절로 인지해 LOSS_AVERSION 오탐 발생하던 결함 차단.

`netLosses = max(0, lossFills - winFills)` 계산은 BE 가 분리되어 자동 정합. 부분 익절이 손실 상쇄하는 정책 보존.

### 5. 절대값 fallback 보존

`fill.pnlPct` 부재 시 (구버전 영속 데이터) 기존 동작 (`pnl > 0 → WIN, pnl < 0 → LOSS`) 유지. BE 분류는 비율 데이터 있을 때만 활성 — 회귀 위험 격리.

## 결과

### 변경 파일

- `server/learning/nightlyReflectionEngine.ts` (TodaysRealizationSummary +beFills?, summarizeTodaysRealizationsForLearning classifyFill 헬퍼 + 두 루프 격상)
- `server/learning/reflectionModules/biasHeatmap.ts` (scoreLossAversion classifyFill 헬퍼 + 두 루프 격상)
- `server/learning/beIsolationAdr0123.test.ts` (신규 14 케이스 — 정적 grep 회귀 가드)

### 검증

- vitest 14/14 신규 + 인접 무회귀 (server/learning + server/alerts + server/trading 누적 972/972 pass)
- lint(client + server tsc) 0 에러
- KIS/KRX 자동매매 quota 0 침범
- LIVE 매매 본체 0줄 변경 (학습 + 편향 분류 모듈만)

### 운영 효과

1. **본절 거래가 LOSS 로 학습 안 됨** — pnlPct -0.3% / +0.4% 같은 BE 거래가 lossFills 카운터에서 제외 → 학습 가중치 보수화 부당 차단
2. **biasHeatmap LOSS_AVERSION 오탐 차단** — BE 만 발생한 날 lossFills=0 으로 lossAversion 점수 자연 0 → 진짜 손실 회피 패턴만 감지
3. **nightlyReflection beFills 영속** — 후속 PR 에서 텔레그램 리포트가 "본절 N건" 별도 라인 표시 가능

### 후속 PR

- 텔레그램 리포트 (shadowProgressBriefing / weeklyIntegrityReport / weeklySelfCritiqueReport / shadowLearningSummary) 의 winFills/lossFills 표시에 beFills 별도 라인 추가
- aggregateFillStats 의 beFills 호출자 wiring (현재 ADR-0112 도입했지만 호출자 활용 부재)
