# ADR-0550: stage1 risk-on regime leader capture

@responsibility screener — stage1 risk-on regime leader capture

## Status

Accepted

## Context

지수 멜트업장(관측: KOSPI 20일 ≈ +30%) 에서 Gate2 가 NO_LEADERSHIP /
BREAKOUT_MOMENTUM_NOT_CONFIRMED 로 0-pass 했다. 근본 원인은 Gate2 잣대가 아니라
**Stage1 universe 선정이 강세장 주도주를 입구에서 배제**하는 데 있었다 (SectorEnergy 는 VERIFIED).

- `evaluateStage1Filter` 하드필터: 당일 `+8% 이상(OVERHEAT)` · `5일 +15% 이상(OVEREXTENDED)`
  종목을 탈락 → 멜트업 리더(당일 급등·주간 강세)가 universe 에 못 들어온다.
- `calcStage1Score`: 모멘텀 deweight(상승률 max 1점, RSI 40~65 만 가점, return5d<8 우대) +
  **눌림목 +2(최대 가중)** → 통과한 리더도 top-N 랭크에서 눌림목/소외주에 밀린다.

이 설계는 중립·박스장엔 적합하나 강한 상승 regime(R1/R2/R3_EARLY)에선 테이프와 싸워
universe 가 소외주(관측 medianReturn20d ≈ -8.7%)로 채워지고, Gate2 leadership 0 은 그 하류
증상이다. min-signal PRICE_MOMENTUM 은 절대수익 기반이라 멜트업 artifact 가 아니며(검증됨),
병목은 universe 선정에 있다.

## Decision

risk-on regime 에서만 Stage1 universe 선정을 모멘텀 친화로 전환하는 **flag-gated 경로**를
도입한다. ENV `STAGE1_RISK_ON_LEADER_CAPTURE_ENABLED=true` 활성 **그리고** canonical regime
∈ {R1_TURBO, R2_BULL, R3_EARLY} 일 때만 발동한다. default OFF / non-risk-on 이면 기존
임계·점수 합산과 **byte-identical** (ENV 1줄 즉시 롤백).

- 필터 `evaluateStage1Filter(quote, regime?)` — OVERHEAT 8→15, OVEREXTENDED(5일) 15→30 완화로
  리더 유입 허용 (commit 3ecb0f96).
- 점수 `calcStage1Score(quote, regime?)` — risk-on 분기에서 당일 상승률·5일 모멘텀·강세 RSI(55~80)·
  신고가 근접을 보상(평시 눌림목 프리미엄과 분리). 평시(else) 분기는 기존 9개 항 합산 그대로 (commit 72666f21).
- regime 은 `stage1QuantFilter` 가 `resolveCanonicalRegimeLevel(loadMacroState())` 로 1회 조회해
  필터·점수 두 경로에 주입한다. 후속 게이트(Stage2/3 · Gate1~3) · 주문 경로 무변경 — universe
  후보 유입만 확장한다.

완화 임계값(15/30) · risk-on 점수 가중은 초기값이며, **활성화 전 counterfactual 로 튜닝**한다.

## Consequences

- default OFF 면 LIVE 매수 universe · 점수 무변경(byte-equivalent, ADR-0146 원칙). 활성화는
  운영자 ENV 결정이며 활성화 전 shadow/counterfactual 로 진입 품질을 검증한다.
- 활성화 시 강세장에서 주도주가 universe · top-N 에 유입되어 Gate2 leadership 확인 가능성이
  회복된다. 절대 약세 소외주는 여전히 필터(음봉/EXCESSIVE_DRAWDOWN/BELOW_MA20) · 점수로 걸러진다.
- marketSignal=false, executionImpact=NONE — provider 장애/시장신호 변환 0.
- 후속(미해결): `leadershipBridge`(현재 런타임 미배선)를 장중 리더 동적 주입 경로로 배선 — feeder
  필요, 별도 작업. risk-on 점수 가중·완화 임계의 counterfactual 튜닝.

## Guardrails

- No live trading path change unless explicitly stated.
- No KIS/order import or invocation unless explicitly stated.
- No Gate/Kelly/STRONG_BUY behavior change unless explicitly stated.
- No Shadow policy change unless explicitly stated.
- No provider fetch behavior change unless explicitly stated.
- No data promotion behavior change unless explicitly stated.
