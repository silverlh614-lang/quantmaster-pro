# ADR-0597: Gate1 횡단면 percentile shadow 보조점수 — 스캔 내 상대 순위 관측 전용

@responsibility policy — Gate1 절대점수(약세장 전 종목 동조 하락)와 별개로 "현재 시장 내 상대 상위 N%" 횡단면 percentile 을 shadow 관측 전용으로 산출·기록해 절대 임계의 레짐 의존을 데이터로 검증 (Gate 판정·requiredScore 무관여)

## Status

Accepted (구현 동반 — 관측 전용, executionImpact=NONE)

## Context

`docs/gate1-scoring-review-20260611.md` §1.3/§5-③ 진단:

- Gate1 최소신호 점수는 **절대 레벨 기반**이다 — 모멘텀 정규화 창(return5d/20d)·BREAKOUT(turtle-high)·
  VOLUME 전부 시장 수익률에 종속 → 약세장에서 전 종목이 동조 하락, 분포가 통째로 내려간다.
- 횡단면(시장 대비) 요소는 RELATIVE_STRENGTH 10/108 (9%) 뿐. 점수의 ~28점은 종목 신호와 무관한
  상수/맥락 블록(WATCHLIST_PRIORITY 8 상수·INVESTOR_FLOW 8 가용성·REGIME 6·SUPPLY·SECTOR)이라
  변별력이 시장 블록(구성 76, 약세장 평균 ~27)에만 의존한다.
- 결과: requiredScore=70 절대 임계의 *실효 엄격도*가 레짐에 따라 크게 출렁인다 (약세장 통과율
  비선형 붕괴). 그러나 "절대 점수가 낮은 약세장 상위 종목"의 forward 성과가 실제로 나쁜지
  좋은지는 **데이터가 없다** — 절대 임계 vs 횡단면 상대 임계 논쟁을 판정할 증거 자체가 부재.

선행 수리(Patch-Gate1-Observation-Score-Scale-Unification, 2026-06-11)로 관측 ledger 가
canonical 최소신호 점수를 기록하기 시작 → 이제 percentile 을 같은 행에 동반 기록하면
"절대 점수 밴드 × 횡단면 percentile 밴드" 교차 forward 분석이 가능해진다.

## Decision

### D1. 순수 SSOT 모듈

`server/trading/signalScanner/gate1CrossSectionalShadowScoreAdr0597.ts` —
`buildGate1CrossSectionalShadowReportAdr0597(rows)` 순수 함수 (provider/store/now 호출 0).

- 입력: 스캔 per-symbol canonical 점수 (ADR-0541 `counters.positiveScoreStarvationTraces` 유래
  symbol/actualScore/positiveComponents — 신규 fetch 0, quota 0).
- **marketBlockScore** = positiveComponents 중 시장 신호 6종
  (PRICE_MOMENTUM/TECHNICAL_TREND/VOLUME_LIQUIDITY/RELATIVE_STRENGTH/WATCHLIST_UPSTREAM_SCORE/
  BREAKOUT_STRUCTURE) weightedScore(≥0 clamp) 합 — 상수/맥락 블록(WATCHLIST_PRIORITY·REGIME·
  SUPPLY·INVESTOR_FLOW·SECTOR) 제외. 컴포넌트 부재 시 null (결손≠0점 — 불변식 #6 정합).
- **percentile** = 스캔 내 midrank 백분위 (동률 0.5 가중, n=1 → 50, 0~100). totalScore 와
  marketBlockScore 각각 산출.

### D2. 기록 (관측 전용 2경로)

1. `ScanSummary.gate1CrossSectionalShadowAdr0597` (additive optional) — 스캔별 분포 요약
   (median/max·top symbols) + per-symbol scores.
2. ADR-0476 관측 ledger 행에 additive optional 필드 `crossSectionalPercentile` /
   `marketBlockScore` / `marketBlockPercentile` stamp — `minSignalScoreBySymbol` map 엔트리
   확장 경유 (점수 스케일 정합 patch 의 주입 경로 재사용, 신규 배선 0).
   → forward outcome(D1/D3/D5) 성숙 시 "percentile 상위 N% 의 약세장 forward 성과" 검증 가능.

### D3. 무관여 가드 (Guardrails)

- **No Gate1 pass/fail change** — percentile 은 어떤 판정·임계·정렬에도 미소비 (관측·기록만).
- No requiredScore/condition weight/STRONG_BUY change. No live trading path change.
- No KIS/order import. No provider fetch (기존 trace 재사용, quota 0).
- ENV 불필요 — 항상-on 진단 (기존 ADR-0476 관측 lane 과 동일 등급). 실패는 try/catch 격리
  + warn (불변식 #1/#2 — 진단 실패가 엔진을 멈추지 않음, silent 금지).

### D4. 후속 (별도 ADR 필요, 본 ADR 범위 밖)

- percentile 기반 보조 임계(예: "절대 60+ AND 횡단면 상위 10%") live 반영 — forward 표본
  성숙 + 운영자 승인 + 별도 ADR.
- 상수/맥락 블록 32점의 적격성 게이트 분리 (리뷰 §5-③ 후반) — 본 shadow 데이터로 정당성
  확인 후 별도 ADR.

## Consequences

- (+) 절대 임계 vs 상대 임계 논쟁이 처음으로 데이터 판정 가능해짐 (ADR-0546 증거 체계 보완).
- (+) 약세장 "상대 리더" 식별이 기록으로 남아 counterfactual 학습 자산 축적.
- (−) ledger 행당 수~십 byte 증가 (2,000행 롤링 내 무시 가능).
- (위험) percentile 을 누군가 판정에 오용 → D3 가드 + 정적 테스트(판정 경로 미소비)로 봉인.

## Rollback

관측 전용 — revert 1커밋. ScanSummary/ledger 필드는 additive optional 이라 구버전 행과 공존.

## References

- `docs/gate1-scoring-review-20260611.md` §1.1~1.3, §5-③
- Patch-Gate1-Observation-Score-Scale-Unification (2026-06-11, 점수 스케일 정합 — 주입 경로 선행)
- ADR-0541 (starvation trace canonical 점수 공급) · ADR-0546 (증거 성숙 게이트) ·
  ADR-0476 (관측 ledger) · ADR-0467 (양수 컴포넌트 회계)
