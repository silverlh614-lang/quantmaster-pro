# ADR-0612: 유니버스 선정 시장상대강도(RS) 게이트 — 강세장 laggard 유입 차단 (default OFF)

@responsibility policy — 강세장에서 후보 풀이 주도주가 아니라 낙폭과대 반등주(KOSPI 대비 −9% 언더퍼폼)로 채워지던 결함을, 유니버스 발굴(generator)·Stage1 점수에 시장상대강도(RS) 게이트를 추가해 교정한다 (requiredScore=70·Gate 로직 무변경, flag default OFF)

## Status

Accepted (구현 — ENV flag default OFF byte-equivalent, 운영자 활성화 대기)

## Context — 2026-06-15 운영자 진단("강세장인데 스캔 결과가 나쁨")

- 거래일 실측: KOSPI 20일 +7.5% 강세장인데 스캔 후보 42종목의 avgReturn5d=+13%(급반등)·
  avgReturn20d=−1.4%·**avgRelativeReturn20d=−9%**(median −12%). 즉 후보가 떨어졌다 튀는
  laggard로 채워지고 진짜 주도주(신고가·양의 RS)는 후보 풀에 없음. candidatePoolBuilder
  `fallbackUsed=true reason=RS_AND_BREAKOUT_UNUSABLE`.
- 근본 원인 (코드 확정): 유니버스 발굴·Stage1 점수가 **절대수익만** 보고 시장상대강도(RS)를
  안 봄. RS는 Gate1 *채점* 컴포넌트(RELATIVE_STRENGTH)로만 존재하고 **선정 단계엔 없음** →
  주도주가 후보 풀에 들어오기도 전에 절대모멘텀·거래량·눌림목 기준이 laggard를 먼저 채움.
  - `quantitativeCandidateGenerator.ts` MOMENTUM: `momentum20d`(절대, 음수허용)+`avgTurnoverKrw`
    합산 정렬. metrics에 시장상대 지표 없음.
  - `pipelineHelpers.ts:calcStage1Score`: 전 항목 절대값(changePercent/return5d/high20d×0.98/rsi).
    평시 분기는 눌림목 적극 보상(return5d<8 +0.5·isPullbackSetup +2).

## 핵심 수학 함정 (구현 불변)

RS = 종목20d − 시장20d 인데 **시장수익률은 한 스캔 내 상수**. 따라서 "RS로 단순 재정렬"은
전 종목에 같은 상수를 빼는 것이라 **순위 변별 0(no-op)**. RS는 반드시 **(a) 필터(게이트)**
또는 **(b) 0-floor 클램프 보너스(비선형)**로 들어가야 효과가 있다.

## Decision — `UNIVERSE_RS_GATE_ENABLED === 'true'` (default OFF)

flag SSOT = `isUniverseRelativeStrengthGateEnabled()`(generator 단일 소유, pipelineHelpers는 import만).

### A. 발굴 — generator MOMENTUM RS 필터 (필터, no-op 함정 회피)

`generateQuantitativeCandidates` 가 `benchmarkReturn20d`(macroState.kospi20dReturn, 퍼센트) 수용
→ MOMENTUM 분기에서 flag ON + 벤치마크 유한 시 **momentum20d ≥ 시장수익률(소수 정규화)** 종목만
필터(시장 이상으로 오른 주도주). **graceful fallback**: 필터 후 생존 < max(5, maxCandidates)
면 미적용(전체 풀) — 약세장/결손에서 후보 0 방지(불변식 #6). 랭킹 산식 무변경(필터만).
`relativeStrength20d`(momentum20d − benchmark) 진단 metric 추가(랭킹 영향 0).

### B. Stage1 — calcStage1Score 0-floor RS 보너스 (비선형, no-op 함정 회피)

`calcStage1Score(q, regime, benchmarkReturn20d?)` 3번째 옵셔널 인자. risk-on 분기 + flag ON +
벤치마크·return20d 유한 시 `score += clamp(q.return20d − benchmark, 0, 3)`. **0-floor가 핵심**:
시장 이김=가점, 못 이김=0(대칭 차감 아님) → 순위 변별 발생. 결손 시 보너스 0(결손≠페널티).

### 단위 정합 (경로별 상이 — 분리 처리)

- A: `momentum20d`=`last/first−1` **소수**, `kospi20dReturn`=**퍼센트** → benchmark/100 정규화 후 비교.
- B: `YahooQuoteExtended.return20d`=**퍼센트**, `kospi20dReturn`=**퍼센트** → 동일 단위 직접 차감.

## Guardrails

- flag OFF default = 양쪽 byte-equivalent(기존 테스트 무회귀). requiredScore=70·Gate hard-block·
  autoTradeEngine·kisClient 0줄. **신규 KIS/KRX fetch 0**(벤치마크는 기존 macroState 로컬 read).
- 벤치마크/return20d 결손 시 graceful(A=필터 미적용 후보 0 방지, B=보너스 0). 결손 ≠ 약세 신호.
- 본 패치는 "무엇이 스캔되는가"(유니버스 입력)를 교정 — Gate 임계/채점 산식은 무변경.

## Rollback

`UNIVERSE_RS_GATE_ENABLED` 미설정/false (기본) → 1줄 롤백, 발굴·Stage1 byte-equivalent.

## References

- 2026-06-15 운영자 진단(강세장 laggard 유입) · ADR-0611(Gate1 RELATIVE_STRENGTH 채점 컴포넌트 —
  본 패치는 그 *선정* 단계 대응) · ADR-0550(Stage1 risk-on leader capture — 절대값 보상 선례) ·
  ADR-0578(phased flag·executionImpact 선례) · `quantitativeCandidateGenerator.ts` ·
  `pipelineHelpers.ts:calcStage1Score` · `aiUniverseService.ts` · `universeScanner.ts`
