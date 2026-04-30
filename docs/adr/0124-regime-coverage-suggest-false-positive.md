# ADR-0124: regimeCoverage Suggest false positive 차단 — shadow trade SSOT 합산

**상태:** 채택 (PR-F, 2026-04-30)
**시리즈:** PR-A~E 후속 hotfix (사용자 4/30 PM 보고)

## 컨텍스트

사용자 4/30 텔레그램 보고:

```
📊 💡 학습 모듈 Suggest — regimeCoverage
레짐 R2_BULL 샘플 부족 & 30일 dry
근거: 현재 0/30 (0%) · 최근 30일 진입 0건
현재: R2_BULL 커버리지 0%
권고: Walk-Forward replay 보충 또는 PROBING 슬롯 확장
임계: current/target<50% & 30일 dry
반영: 수동 (/accept-suggest 는 Phase 2)
```

> 실제 진입이 발생했는데도 메시지 출력이 맞는건지 의문이다, 점검 필요함

audit 결과 명확한 결함 — `evaluateRegimeCoverageSuggestion` (regimeBalancedSampler.ts:138-141) 가 *recommendationTracker* (`data/recommendations.json`) 만 read 하고 *shadowTradeRepo* (`data/shadow-trades.json`) 미참조.

영속 데이터 분리:
- `data/recommendations.json` — AI 추천 PENDING 신호 (signalScanner addRecommendation)
- `data/shadow-trades.json` — 실제 진입한 ACTIVE/HIT_TARGET/HIT_STOP 거래 (buyPipeline buildBuyTrade)
- `data/attribution-records.json` — CLOSED 거래 (exitEngine appendAttributionRecord)

세 SSOT 모두에 `entryRegime?: string` 영속 ✓ — PR-G ADR-0024 (regimeMemoryBank) 정합. 단 *카운트 산출 SSOT* 가 한 소스만 read → SHADOW/LIVE 진입이 발생해도 30일 dry 판정 통과 → false positive suggest 발송.

## 결정

### 1. carbon 카운트 입력 SSOT 합산

`evaluateRegimeCoverageSuggestion` 의 30일 dry 판정에 `loadShadowTrades()` 추가:

```typescript
const recentRecommendations = history.filter(r =>
  r.entryRegime === e.regime && new Date(r.signalTime).getTime() >= cutoffMs,
);
const recentShadowEntries = shadowTrades.filter(s =>
  s.entryRegime === e.regime && new Date(s.signalTime).getTime() >= cutoffMs,
);
return {
  entry: e,
  recentCount: recentRecommendations.length + recentShadowEntries.length,
  recommendationCount: recentRecommendations.length,
  shadowCount: recentShadowEntries.length,
};
```

`recentCount === 0` (즉 추천 + 실거래 둘 다 0) 일 때만 dry 판정. SHADOW/LIVE 진입이 발생한 레짐은 자동 발송 차단.

### 2. rationale 메시지 분리 표기

```
근거: 현재 0/30 (0%) · 최근 30일 진입 0건 (추천 0건 + 실거래 0건)
```

운영자가 *왜 dry 판정됐는지* 즉시 인지. 추천 0건이지만 실거래 N건 시 발송 차단된다는 의도 노출.

### 3. ENV `LEARNING_REGIME_COVERAGE_SUGGEST_DISABLED=true` 비상 우회

진단 시 또는 false positive 재발 시 즉시 무력화. evaluateRegimeCoverageSuggestion 진입부 early return.

### 4. graceful fallback

`loadShadowTrades()` throw 시 빈 배열로 처리 + console.warn — 영속 손상이 학습 알림 발송 자체를 차단하지 않음 (recommendation 만으로 정상 dry 판정).

## 결과

### 변경 파일

- `server/learning/regimeBalancedSampler.ts` (loadShadowTrades import + isRegimeCoverageSuggestDisabled ENV 헬퍼 + 30일 dry 카운트 합산 + rationale 메시지 격상)
- `server/learning/regimeCoverageSuggest.test.ts` (+5 ADR-0124 케이스 — false positive 차단 / rationale 분리 표기 / ENV 우회 / loadShadowTrades throw graceful / 사용자 시나리오 재현)

### 검증

- vitest server/learning **357/357 pass** (신규 5 + 기존 회귀 무영향)
- lint(client + server tsc) 0 에러
- KIS/KRX 자동매매 quota 0 침범
- LIVE 매매 본체 0줄 변경 (학습 모듈 진단 SSOT 만)

### 운영 효과

- **사용자 보고 시나리오 영구 차단** — R2_BULL recommendation 0건 + shadow 진입 5건 시 dry 미달 → 발송 안 함
- **rationale 분리 표기** — "추천 X건 + 실거래 Y건" 형식으로 false positive 판단 가능
- **비상 우회 ENV** — `LEARNING_REGIME_COVERAGE_SUGGEST_DISABLED=true` 1줄로 즉시 무력화
- **graceful** — shadow 영속 손상이 학습 알림 차단 안 함

### 후속 PR (옵션)

- counterfactual / ledger / kellySurface suggest 에도 동일 패턴 audit (recommendationTracker 단일 소스 의존 결함 검사)
- attributionRepo entryRegime 합산 (CLOSED 거래)
