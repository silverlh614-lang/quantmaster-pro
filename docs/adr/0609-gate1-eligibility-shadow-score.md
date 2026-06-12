# ADR-0609: Gate1 상수블록 eligibility shadow 판정 — 적격성 재해석 관측 전용 (Phase 0)

@responsibility policy — Gate1 상수/맥락 블록 32점(WATCHLIST_PRIORITY·MARKET_REGIME·INVESTOR_FLOW 등 종목 변별력 0)을 "점수"가 아닌 "적격성(eligibility) 게이트"로 재해석한 shadow 판정 + market-only(76)·percentile 보조 판정을 관측 전용으로 산출·기록 (LIVE passed/actualScore/requiredScore 무관여, 소비처 0)

## Status

Accepted (구현 동반 — Phase 0 관측 전용, executionImpact=NONE, LIVE 점수 0줄)

## Context

`docs/gate1-scoring-review-20260611.md` §5(c) + `_workspace/20260612_gate1-score-system-design/track-b-rubric-structure-improvement.md` 진단:

- Gate1 최소신호 점수 108점 중 상수/맥락 블록 32점(WATCHLIST_PRIORITY 8 상수·INVESTOR_FLOW 8
  가용성·MARKET_REGIME 6 시장전체동일·SUPPLY 8·SECTOR 2)이 평균 점수의 ~51%를 차지하나 **종목
  변별력이 사실상 0** 이다. WATCHLIST_PRIORITY 8 + INVESTOR_FLOW 8 + MARKET_REGIME 6 = 22점이
  순수 상수(종목 무관).
- 이 32점이 점수에 섞여 있어 55~70 데드존이 형성되고, 변별력은 시장 신호 76점에만 의존한다.
- **그러나 이 상수 블록을 점수에서 직접 빼면 LIVE 통과 판정이 바뀐다.**
  `minimumSignalScoreTrace.ts:436-493` 의 `computedScore = Σ weightedScore` 가 상수 블록을 포함하고,
  `:493 passed = actualScore >= requiredScore(70)`. 상수 32점을 빼면 actualScore 가 ~32 하락 →
  현 requiredScore 70 으로는 통과 0. 즉 "분리"는 requiredScore 동시 재보정 없이는 불가능하며,
  절대 보존(70 무변경)과 양립하려면 **shadow 병렬 판정(canonical 은 그대로)** 이 유일 경로다.
- ADR-0597 이 이미 횡단면 percentile + marketBlockScore(상수 제외 76점 합)를 shadow 관측 중이다.
  Track B 의 신규성은 이 산출물 위에서 **"적격성/임계 판정"** 을 shadow 로 도입하는 것뿐이다.

## Decision

### D1. 순수 SSOT 모듈

`server/trading/signalScanner/gate1EligibilityShadowScoreAdr0609.ts` —
`buildGate1EligibilityShadowReportAdr0609(rows)` / `judgeGate1EligibilityAdr0609(row)` 순수 함수
(provider/store/now 호출 0). 입력은 ADR-0597 산출물(marketBlockScore·totalPercentile) +
상수 블록 컴포넌트(WATCHLIST_PRIORITY·MARKET_REGIME·INVESTOR_FLOW weightedScore, fetch 0).

산출(전부 관측 라벨, LIVE 미소비):

- **eligible** — 상수 블록을 적격성으로 재해석. 잠정 규칙: WATCHLIST_PRIORITY weightedScore>0 &&
  MARKET_REGIME 비emergency(>=0) && INVESTOR_FLOW 의 **providerIssue=false 음수만** 부적격. **불변식 #6** —
  상수 컴포넌트 부재/비유한, 그리고 providerIssue=true 인 음수(INVESTOR_FLOW UNKNOWN/STALE penalty
  −8 — `minimumSignalScoreTrace.ts:90,260` providerIssue·"NOT_MARKET_WEAKNESS"; positiveComponents 부재와
  동일 취급)는 bearish 변환 금지 → "판정 보류 = 보수 통과(eligible 유지, eligibilityDegraded 라벨)".
  결손·provider 장애→탈락 절대 금지. providerIssue=false 인 명시적 음수/0(MARKET_REGIME
  emergency=marketSignal·무효 심볼)일 때만 부적격.
- **marketOnlyPassed** — marketBlockScore(null 아님) >= 42. marketBlockScore=null(시장 컴포넌트
  결손) → `false` 아닌 `null`(미평가). 결손≠탈락 (불변식 #6).
- **percentilePassed** — totalPercentile >= 70 (스캔 내 상위 ~30%).

잠정 임계는 모듈 상단 `GATE1_ELIGIBILITY_SHADOW_THRESHOLDS` 단일 상수 SSOT —
**Phase 1 dry-run 보정 대상** (구체값 검증 전 잠정치).

### D2. 기록 (관측 전용 2경로, 신규 ledger 0)

1. `ScanSummary.gate1EligibilityShadowAdr0609` (additive optional) — 스캔별 집계
   (eligibleCount / eligibilityDegradedCount / marketOnlyPassCount / marketOnlyUnevaluatedCount /
   percentilePassCount + executionImpact:'NONE').
2. ADR-0476 관측 ledger 행에 additive optional 필드 `eligibilityShadowEligible` /
   `eligibilityShadowMarketOnlyPassed` / `eligibilityShadowPercentilePassed` stamp —
   ADR-0597 와 동일한 `minSignalScoreBySymbol` map 엔트리 확장 경유 (신규 배선 0, E3 동형).
   → "canonical 밴드 × eligibility × market-only × percentile" 교차 forward 분석 가능.

상수 블록 컴포넌트(WATCHLIST_PRIORITY/MARKET_REGIME/INVESTOR_FLOW)는 ADR-0597 InputRow
.positiveComponents(AUDITED_POSITIVE_FEATURES 한정)에 포함되지 않으므로, persistScanResults 의
ADR-0541 루프에서 canonical `minSignal.components` 로부터 직접 보충해 공급한다(fetch 0).

### D3. 무관여 가드 (Guardrails) — LIVE 미소비 구조 보장 (3중 분리)

- **파일 분리**: shadow 판정은 신규 SSOT 파일에만. `minimumSignalScoreTrace.ts`(D1-D4 LIVE 점수
  본체)를 import 하지 않음 — 단방향(shadow 가 ADR-0597 산출물을 읽되 trace 는 shadow 를 모름).
- **소비처 분리**: 산출물(eligible/marketOnlyPassed/percentilePassed)은 `ScanSummary.*Shadow*`
  + 관측 ledger stamp 에만. buyList 정렬(perSymbolEvaluation)·Gate hard-block(quantFilter)·
  entry(entryEngine)·Kelly 사이징 **어디서도 소비 안 함** (Phase 0 DoD = grep 소비처 0 확인).
- **임계 분리**: shadow 임계(market-only 42, percentile 70)는 canonical
  `LEGACY_GATE1_REQUIRED_SCORE=70`(gateConfig)과 다른 상수. requiredScore 70 은 읽지도 않음.
- No KIS/order import. No provider fetch(ADR-0597 산출물·trace 재사용, quota 0). ENV 불필요 —
  항상-on 진단(ADR-0476/0597 lane 동등). 실패는 try/catch 격리 + warn(불변식 #1 — 진단 실패가
  스캔/엔진을 멈추지 않음, silent 금지).

### D4. 후속 (별도 ADR/governance, 본 ADR 범위 밖)

- **Phase 1**: counterfactual 대조 — N영업일 후 "eligibility/market-only/percentile shadow pass"
  vs "절대 70 pass" 의 forward 승률 비교. dry-run ledger 활용. 잠정 임계(42/70/적격성 규칙) 보정.
- **Phase 2** (별도 ADR · governance 승인): LIVE 반영 검토 — requiredScore 동시 재보정 동반
  설계. 절대 보존 해제는 운영자 명시 승인 필수.

## Patch Scope Guard

- **Target Domain**: Gate1 scoring shadow 관측 (signalScanner) — 단일 도메인 (LIVE 점수 미접촉).
- **Allowed Files**: gate1EligibilityShadowScoreAdr0609.ts(신규) · persistScanResults.ts(호출 1블록
  + 상수 컴포넌트 capture, try/catch 격리) · persistScanResultsMidBlocks.ts(ledger stamp 동반) ·
  scanSummaryTypes.ts(additive optional) · gate1DryRunObservationLedgerAdr0476.ts + types.ts
  (additive optional stamp) · 신규 *.test.ts.
- **Forbidden Files**: minimumSignalScoreTrace.ts(D1-D4 — 0줄) · componentScorers.ts(0줄) ·
  gateConfig.ts(LEGACY_GATE1_REQUIRED_SCORE=70 — 0줄) · entryEngine/autoTradeEngine/quantFilter
  /perSymbolEvaluation buyList 정렬부(0줄) · kisClient.ts(fetch 0).
- **Expected Behavior Change**: ScanSummary additive 집계 + 관측 ledger stamp. LIVE 매매·정렬·점수
  ·통과 판정 무변경(관측만).
- **SourceSnapshot Impact**: READ_ONLY (ADR-0597 산출물·trace components 읽기만, fetch 0, 불변식 #9).
- **Execution Impact**: NONE (소비처 0 — Phase 0 DoD).
- **Shadow Learning Impact**: RECORD_ONLY (ledger stamp + ScanSummary 필드).
- **Telegram Impact**: NONE (Phase 0 — 진단 표시는 후속).
- **Provider Impact**: NONE (quota 0).
- **Tests Required**: eligibility 진리표(결손→보류 불변식 #6) · marketOnlyPassed 42 경계 + null ·
  percentilePassed 70 경계 · LIVE byte-equivalent(minimumSignalScoreTrace 회귀) · 관측 stamp 정합.
- **Rollback Plan**: 관측-only always-on — shadow 호출 블록 + 신규 파일 revert(LIVE 무관, 데이터 영향 0).

## Alternatives Considered

- **(a) requiredScore 동시 하향 + 상수 블록 직접 제거 (LIVE 즉시 반영)** — **기각**. 절대 보존
  (requiredScore 70 byte-equivalent) 위반이며, forward 검증 없이 통과 판정을 완화 → 매매 안전성
  미검증 변경. Phase 2 governance 후에만 검토.
- **(b) 상수 블록 가중치만 축소 (8→4 등)** — **기각**. computedScore 가 여전히 변해 LIVE passed
  (:493)가 바뀐다 → (a)와 동일한 절대 보존 위반.
- **(c) shadow 병렬 판정 (채택)** — canonical(LIVE) 점수·통과·정렬·requiredScore 0줄 유지 + 적격성
  /market-only/percentile 을 관측 라벨로만 기록 → 절대 보존 + forward 검증 후 승격. ADR-0581/0597
  phased 선례 정합.

## Consequences

- (+) 상수 블록 변별력 0 가설을 forward outcome 으로 처음 데이터 판정 가능(ADR-0597 횡단면 보완).
- (+) "절대 70 미달이나 적격·상대강자"인 약세장 종목의 성과가 기록으로 축적 → counterfactual 자산.
- (−) ledger 행당 수 byte 증가(2,000행 롤링 내 무시 가능).
- (위험) 산출물을 누군가 판정에 오용 → D3 가드 + 소비처 0 grep(Phase 0 DoD) + 순수 함수 테스트로 봉인.

## References

- `_workspace/20260612_gate1-score-system-design/track-b-rubric-structure-improvement.md` (설계 SSOT)
- `docs/gate1-scoring-review-20260611.md` §1.2/§5(c)
- ADR-0597 (횡단면 percentile shadow — 산출 기반·후속 로드맵) · ADR-0581 (신규 지표 phased 선례) ·
  ADR-0541 (starvation trace canonical 컴포넌트 공급) · ADR-0476 (관측 ledger) · ADR-0546 (증거 성숙 게이트)
