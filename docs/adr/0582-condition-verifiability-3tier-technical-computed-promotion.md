# ADR-0582: 조건 검증가능성 3-tier 분리 + 기술지표 계산 검증 승격

@responsibility 종목 27조건을 검증가능/본질-AI 로 분리하고 기술 6조건을 OHLCV 객관 계산으로 검증 승격 (최종 점수 정의)

## Status

Accepted

## Context

종목 개별 검색 카드에서 "모델 점수"(Gemini 정성 확신도, 예 95)와 "최종 점수"(검증 가중,
예 41)의 갭이 크다는 사용자 보고가 있었다 (선행 패치 `Patch-StockSearch-ScoreConcordance-SecondaryLevels`
에서 합치도 배지를 `weightedScore` 기준으로 통일). 후속 분석에서 갭의 **구조적 원인** 2가지가
드러났다:

1. **계산 가능한데 크레딧을 못 받음.** `enrichment` 의 main path 는 일목·골든크로스·거래량·터틀·
   피보나치·다이버전스 등 기술 지표를 OHLCV 로 실제 계산하지만(`technicalSignals`), checklist 의
   통과/실패 판정은 **Gemini 추정값을 그대로 보존**(`...stock.checklist`)했다. 그 결과
   `buildConditionSourceTiers` 가 이들을 `AI_INFERRED`(미검증, 0.5 가중)로 남겼다 — 실제로는
   객관 계산 가능한데도.

2. **"본질적 AI"와 "검증 가능하나 미수집"을 혼동.** 촉매(`catalystAnalysis`)·심리
   (`psychologicalObjectivity`)·엘리엇(`elliottWaveVerified`) 처럼 시장/재무 데이터로 **객관 검증이
   불가능**한 정성 항목과, DART/KRX/OHLCV 로 검증 가능하나 이번 run 에서 데이터를 못 가져온 항목이
   똑같이 `AI_INFERRED`(0.5) 로 뭉뚱그려져, 정성 항목이 분모에 포함되어 점수를 영구 가두었다.

기존 `weightedScore` 산식: `Σ(검증=1·AI=0.5·미달=0) / 전체 27 × 100`. 검증 가능 항목이 최대 13개뿐
이라(나머지 14 항상 AI), 모든 데이터 검증 + 전 조건 통과 시에도 상한이 약 74점으로 고착됐다.

본 모듈 경로(`src/services/stock/*`)는 **표시·진단 전용** 클라이언트 경로다. 서버 자동매매
(`autoTradeEngine`)는 독립 SourceSnapshot 파이프라인을 쓰므로 본 변경은 실주문 경로와 무관하다
(불변식 #1/#7/#8 보존, executionImpact=NONE).

## Decision

### D1. 검증가능성(verifiability) 3-tier 분리

조건을 정적으로 2분류한다 (`src/utils/dataQualityClassifier.ts`):

- **VERIFIABLE** — 시장/재무/계산 데이터로 객관 검증 가능 (24개)
- **AI_INTRINSIC** — 본질적 정성·해석 영역으로 검증 불가, **점수 분모에서 제외** (3개):
  `catalystAnalysis`, `psychologicalObjectivity`, `elliottWaveVerified`

표시 status(`VERIFIED_PASS`/`AI_PASS`/`FAIL`)는 보존하고, `ConditionView` 에 `verifiability` 필드를
추가한다. `weightedScore` 의 분모를 **검증 가능 조건 수(evaluableCount)** 로 바꿔, 점수가
"검증 가능 항목 중 검증된 비율"을 정직하게 나타내게 한다. AI_INTRINSIC 항목은
`intrinsicAiCount`/`intrinsicAiMetCount` 로 별도 표시한다.

### D2. 기술 6조건 OHLCV 객관 계산 검증 승격

`src/utils/indicators.ts` 에 결정적(deterministic) 계산 헬퍼를 추가하고
(`detectGoldenCross`·`detectVolumeSurge`·`detectTurtleBreakout`·`detectFibonacciSupport`·
`detectBullishDivergence`, 일목은 기존 `calculateIchimoku().status`), `enrichment` main path 에서
checklist 값을 **계산 결과로 덮어쓴다**. `buildConditionSourceTiers` 는 `hasTechnicalComputed`(main
path=OHLCV 보유) 시 6조건을 `COMPUTED` 로 승격한다. 계산은 단순화됐으나 입력이 같으면 결과가 같은
객관 신호이므로 검증 자격이 있다 (Gemini 추정값을 결정적 규칙으로 대체 — 일부 종목은 점수가
**하락**할 수도 있으며 이는 정직한 방향).

aiFallback 경로(OHLCV 부재)는 기술 조건을 계산할 수 없어 AI 값을 보존하고 미검증으로 둔다.

### D3. marginAcceleration DART 검증 승격

`dartDataFetcher` 에 매출액·전기 영업이익을 추가 추출해 영업이익률 당기·전기(`operatingMargin`/
`operatingMarginPrior`)를 계산한다. `enrichment` 양 경로에서 당기 > 전기(마진 개선) 시 `#22
marginAcceleration` 을 1 로 덮어쓰고, `hasMarginTrend` 시 `API` 로 승격한다.

### 결과 상한

검증 가능 24 중 승격 가능 = 기존 13 + 신규 7(기술 6 + 마진 1) = 20. 잔존 4(상대강도·모멘텀순위·
직전주도주·기계적손절)는 추가 데이터 부재로 AI fallback. 모든 데이터 검증 + 전 통과 시 상한
≈ (20 + 4×0.5)/24 × 100 ≈ 92 (기존 ~74 대비 상향).

## Consequences

- **표시/진단 전용.** Trading Engine·SourceSnapshot·Gate(서버)·Provider·Telegram·Shadow 무접촉.
  executionImpact=NONE. 9대 불변식 VERBATIM 0줄.
- **점수 산식 변경.** `weightedScore`/`finalScore`(후보 카드·deep-analysis 공유)가 새 분모로
  재산출된다. 회귀 테스트(`candidateDecisionModel.test.ts` finalScore 59→60) 갱신.
- **데이터 위계 정합(ADR-0561).** 신규 검증은 OHLCV 계산·DART(L1/L2)·기존 fetch 재사용으로,
  Yahoo-first 도입·신규 KIS/KRX 쿼터 침범 0.
- **UI 3-구분 노출.** `RiskChecklistSection`·`ScoreAlignmentGrid` 가 검증 / AI(검증가능 미수집) /
  정성-AI(분모 제외)를 구분 표시.
- **롤백.** 표시 전용 — 커밋 revert 로 byte-equivalent 복원(ENV 불요).
- **후속(별건).** 상대강도·모멘텀순위는 KOSPI 벤치마크·유니버스 순위 fetch 필요 — 추가 외부
  데이터 도입은 별도 ADR.
