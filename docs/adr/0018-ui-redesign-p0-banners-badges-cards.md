# ADR-0018 — UI 재설계 P0: 시장 모드 배너 + 데이터 품질 배지 + Gate 통과 카드 (PR-A)

- **Status**: Accepted (2026-04-26)
- **Scope**: 사용자 P0 5종 중 본 PR-A 에서 처리하는 3종 (1·3·4). 나머지 2종(데이터 알림·이력 추적)은 PR-B/PR-C 로 분리.
- **Related**:
  - ADR-0007 (학습 폐쇄루프) — 종목 카드 데이터 출처 분류는 학습 결과 표면화 방향성과 정렬.
  - ADR-0011 (AI 추천 KIS/KRX 분리) — `dataSourceType` 메타 (REALTIME/YAHOO/AI/STALE) 위에 데이터 품질 배지를 쌓음.
  - ADR-0016 (5-Tier fallback) — `useMarketMode` 5분류 SSOT 와 정렬.

---

## Context

QuantMaster Pro 의 판단 엔진(Gate 0~3 + 27 조건 + 6 레짐)은 강해지고 있으나 UI 가
복잡한 판단을 사용자가 *한눈에 믿고 실행* 할 수 있게 정리해주는 단계가 비어있다.
사용자 보고 요약:

1. 첫 화면이 종목 추천 리스트로 시작해 시장 모드(매수 허용/금지) 가 안 보임.
2. 종목 카드에 "STRONG_BUY 86%" 만 보이고 그 86 % 가 **실계산 18 / API 6 / AI추정 3** 같은
   데이터 출처 혼합비로 만들어졌다는 사실이 묻힌다.
3. Gate 0~3 통과 표는 `StockDetailModal` 안 `GateStatusWidget` 으로만 노출되어 있어
   카드 단계에선 "왜 STRONG_BUY 인지" 근거를 못 본다.

사용자 P0 5종 우선순위:
1. 🟢실계산/🔴AI추정 데이터 배지 — **PR-A**
2. 손절·목표가 도달 알림 — **PR-C** (Web Notification 권한 흐름 격리 필요)
3. 시장 모드 상단 배너 — **PR-A**
4. Gate 0~3 통과 카드 — **PR-A**
5. 추천 이력 성과 추적 — **PR-B** (서버 라우트 + 새 페이지 동반)

본 ADR 은 PR-A 의 3 컴포넌트(MarketModeBanner / DataQualityBadge / GateStatusCard)에
대한 경계·데이터 의존성·fallback 정책을 SSOT 로 고정한다.

---

## Decision

### 1. MarketModeBanner — 시장 모드 정책 박스

- 위치: 모든 페이지 상단 (`MarketOverviewHeader` 내부, `MarketRegimeBanner` 위에 stack).
- 데이터 의존:
  - `gate0Result` (useWatchlistData 에서 `evaluateGate0(macroEnv)` 로 이미 계산 중) → MHS / TradeRegime
  - `useGlobalIntelStore.macroEnv` → VKOSPI / USD/KRW
  - `useGlobalIntelStore.bearRegimeResult` → 6단계 RegimeLevel 매핑 (없으면 TradeRegime fallback)
- **항상 렌더** (BULL 정상 모드 포함). 부재(로딩) 시 verdict='🟡' + headline='데이터 적재 중'.
- 정책 SSOT: `src/types/ui.ts` 의 `REGIME_TRADING_POLICY: Record<RegimeLevel, ...>`.
  - R1~R6 각각 `allowed` / `forbidden` / `verdict` / `headline` 4 필드.
  - 사용자 원안 표현 차용: "주도주 추세추종 / 분할매수 가능 / 소외주 저가매수 / 과열 추격매수".

### 2. MarketModeBanner vs MarketRegimeBanner — 책임 분리

| 컴포넌트 | 책임 | 렌더 조건 |
|---|---|---|
| **MarketModeBanner** (신규) | 항상 표시 + 정책 박스 (allowed/forbidden) | 항상 렌더 |
| **MarketRegimeBanner** (기존, 보존) | Risk-Off 경보 + Bear Regime / VKOSPI / Inverse Gate 디테일 | non-BULL 또는 alert 시에만 |

두 컴포넌트는 stack 으로 page layout 에 공존한다. MarketModeBanner 가 **상위 layer** 로
정책·요약을 노출하고, MarketRegimeBanner 는 **alert layer** 로 위험 상황에서만 추가 정보를
펼친다. 흡수·삭제 금지 — 책임이 다르다.

> 사유: MarketRegimeBanner 는 BULL 일 때 미렌더 정책이라 사용자 P0-3 ("매수 전에 시장 모드 먼저") 를
> 충족 못 함. 새 banner 가 항상 렌더되어 정책을 노출하고, 기존 banner 는 리스크 발생 시에만 보강 표시.

### 3. DataQualityBadge — 데이터 품질 카운트

- 위치: `WatchlistCard` 내부 (기존 `ConfidenceBadge` 옆).
- 데이터 의존:
  - **PR-A (본 PR)**: `StockRecommendation` 의 `dataSourceType` + 기존 27 조건 평가 결과 + 항목별 휴리스틱 분류.
  - **PR-B (후속)**: 서버 enrichment 응답에 `sourceTier?: 'COMPUTED' | 'API' | 'AI_INFERRED'` 메타 추가 → 정확도 격상.
- `sourceMetaAvailable: boolean` 필드로 fallback 여부를 UI 가 명시 (작은 회색 ? 아이콘).
- **ConfidenceBadge 와 충돌 없음**:
  - `ConfidenceBadge` = **가격 출처** 1개 (REALTIME/YAHOO/AI/STALE) — KIS 실시간 vs Yahoo proxy 식별.
  - `DataQualityBadge` = **종목 카드 전체 데이터 품질 카운트** (실계산/API/AI추정 N/N/N) — 27 조건 합산.
  - 둘 다 표시. 한 줄에 가격 출처 + 데이터 품질 합산.

#### Fallback 휴리스틱 (PR-A)

서버 sourceTier 메타 부재 시 다음 분류 사용:

| 항목 그룹 | 기본 분류 | 근거 |
|---|---|---|
| RSI / MACD / 볼린저 / 일목 / VCP / 거래량 / 골든크로스 | computed | 클라이언트 OHLCV 직접 계산 (`indicators.ts`) |
| ROE / PER / PBR / 시총 / 외인비율 / 부채비율 / OCF 품질 | api | DART/Naver/KIS 객관 수치 |
| theme / sectorAnalysis / strategicInsight / 촉매·정책 해석 | aiInferred | Gemini 요약·생성 |
| 가격 (`dataSourceType`) | REALTIME → computed +1, YAHOO → api +1, AI/STALE → aiInferred +1 | dataSourceType 매핑 |

총 27 조건 + 가격 1 = 최대 28. 실측 항목만 카운팅 (undefined/null 제외).
tier 산출: `computed/total ≥ 0.6` → HIGH, `≥ 0.3` → MEDIUM, 그 외 LOW.

### 4. GateStatusCard — 압축 Gate 통과 표

- 위치: `WatchlistCard` 내부 (CONFIRMED_STRONG_BUY 같은 SignalBadge 아래).
- 데이터 의존: `StockRecommendation.checklist` + `gateConfig.ts` 의 `GATE1_IDS / GATE2_IDS / GATE3_IDS / *_REQUIRED`.
- `gate0Passed`: `StockRecommendation.gateEvaluation.gate1Passed` 가 boolean — 가용 시 그 값, 없으면 `gateEvaluation.isPassed` fallback.
  - **본 PR 단순화**: gate0 = gate1Passed 의 alias. gate0 자체는 시장 환경 게이트로 MarketModeBanner 가 별도 노출하므로 카드 안에선 "G1 통과" 가 곧 "G0 통과" 이후의 결과로 충분.
- GateStatusWidget 와 별도 컴포넌트로 운영 — **expand 토글이 없는 read-only 압축**.
  - 사유: WatchlistCard 안에선 인터랙션 코드를 끌어오면 카드 LoC 폭발. widget 의 prop mode 토글로 통합하지 않음.
- `overallVerdict`:
  - 4 PASS (G0+G1+G2+G3) → STRONG_BUY
  - 3 PASS → BUY
  - 2 PASS → HOLD
  - 1 PASS → CAUTION
  - 0 PASS → AVOID

### 5. 신규 타입 SSOT

`src/types/ui.ts` 신규 파일에 다음을 정의:

- `MarketModePolicy` — 배너 입력 (regime, mhs, vkospi, usdKrw, allowed, forbidden, verdict)
- `DataQualityCount` — 배지 입력 (computed, api, aiInferred, total, tier, sourceMetaAvailable)
- `DataQualityTier` — 'HIGH' | 'MEDIUM' | 'LOW'
- `GateCardSummary` — 카드 입력 (gate0Passed, gate1, gate2, gate3, overallVerdict)
- `GateLineSummary` / `GateVerdict` / `OverallVerdict`
- `REGIME_TRADING_POLICY` — `Record<RegimeLevel, RegimePolicyEntry>` SSOT
- `REGIME_TRADING_POLICY_FALLBACK`

`src/types/index.ts` 배럴에 `export * from './ui'` 추가.

---

## Consequences

### Positive

1. 사용자가 페이지 상단에서 시장 모드를 1초 안에 인지 (P0-3 충족).
2. 종목 카드의 "STRONG_BUY 86%" 가 어떤 데이터 혼합으로 만들어졌는지 카운트로 노출 (P0-1 충족).
3. Gate 0~3 통과가 카드 단에서 보여 StockDetailModal 까지 안 들어가도 매수 근거 1차 판단 가능 (P0-4 충족).
4. `REGIME_TRADING_POLICY` SSOT 가 RegimeLevel 6 단계 정책을 한 곳에 고정 — 후속 PR 에서 재사용.
5. `DataQualityCount.sourceMetaAvailable` flag 로 PR-B 의 서버 메타 도입 시 무중단 격상.

### Negative

1. WatchlistCard 의 LoC 가 늘어남 — 이미 PR-32 에서 줄여놓은 컴포넌트라 추가 확장 시 임계 모니터링 필요.
2. GateStatusWidget 와 GateStatusCard 가 공존 — 향후 인터랙션 통합 PR 에서 책임 재정리 가능.
3. 휴리스틱 분류는 PR-B 까지 *근사값* — 사용자에게 작은 ? 아이콘으로 명시.

### Neutral

- ConfidenceBadge 보존. 가격 출처 단일 표시는 유지.
- MarketRegimeBanner 보존. Risk-Off 경보 책임 유지.

---

## Alternatives Considered

1. **MarketRegimeBanner 흡수 후 단일 배너 (Always-render mode)**: 거부.
   - MarketRegimeBanner 의 expand panel(Bear conditions / VKOSPI detail / Inverse Gate detail) 가 정상 모드에선 노이즈.
   - 책임 분리가 유지비 측면에서 더 안전 (하나는 정상 모드 SSOT, 하나는 alert 전용).

2. **GateStatusWidget 에 prop mode 추가 (compact|full 토글)**: 거부.
   - widget 의 expandable 인터랙션 코드(useState/AnimatePresence) 를 카드까지 끌어오면 카드 LoC 폭발.
   - 별도 컴포넌트가 SRP 측면에서 깔끔 — 풀 디테일은 widget, 카드 임베드는 card.

3. **DataQualityBadge 를 ConfidenceBadge 에 흡수**: 거부.
   - ConfidenceBadge 는 가격 1개 출처, DataQualityBadge 는 27+1 조건 합산 — 책임이 다르다.
   - 한 컴포넌트에 두 책임을 넣으면 fallback 휴리스틱 분기가 복잡.

4. **DataQualityBadge 의 휴리스틱 fallback 없이 서버 메타 도착 후 PR-A 노출**: 거부.
   - 사용자 P0-1 가 즉시 가시화 필요. fallback + ? 마커로 PR-A 즉시 노출 후 PR-B 에서 정확도만 격상.

---

## Implementation Plan (PR-A)

1. **architect (본 ADR)**: 타입 + ADR + ARCHITECTURE.md boundary + handoff.md.
2. **dashboard-dev**:
   - `src/components/market/MarketModeBanner.tsx` 신규
   - `src/components/common/DataQualityBadge.tsx` 신규
   - `src/components/watchlist/GateStatusCard.tsx` 신규
   - `src/utils/dataQualityClassifier.ts` 신규 — 휴리스틱 fallback 로직 + tier 산출
   - `src/utils/regimeMapping.ts` 신규 — Gate0Result.tradeRegime + bearRegimeResult → RegimeLevel 매핑
   - `src/layout/MarketOverviewHeader.tsx` 에 MarketModeBanner stack 추가
   - `src/components/watchlist/WatchlistCard.tsx` 에 두 신규 컴포넌트 임베드
3. **회귀 테스트**:
   - `dataQualityClassifier.test.ts` (휴리스틱 분류 + tier 산출)
   - `regimeMapping.test.ts` (TradeRegime → RegimeLevel + REGIME_TRADING_POLICY 분기)
   - `MarketModeBanner.test.tsx` (loading / R1~R6 / fallback)
   - `GateStatusCard.test.tsx` (overallVerdict 5 분기)
4. **quality-guard**: lint + validate:all + precommit.
5. **CLAUDE.md 변경 이력 + commit**.

---

## Out of Scope (deferred PRs)

- **PR-B**: 서버 enrichment 에 `sourceTier` 메타 추가 + RecommendationHistory 페이지 + `/api/recommendations/history` 라우트.
- **PR-C**: `usePriceAlertWatcher` hook + Web Notification 권한 흐름 + 4단계 알림.
- **P1+ (별도 PR)**: 후보군 파이프라인 / 섹터 히트맵 / 분할매수 카드 / Last Trigger / Enemy Checklist.
- **P2+ (별도 PR)**: Macro Intelligence 탭 / 포트폴리오 상관관계 / 수익률 귀인 / 추천 적중률.
