# ADR-0558: universeScanner Lazy/Budget Fetch — Legitimate Non-Funnel Boundary (SSOT 프로그램 마무리)

@responsibility governance — universeScanner Stage1/2 의 lazy/budget fetch 를 quota 절약을 위한 *정당한 비-통합 경계* 로 확정, factory eager 모델 강제 통합 금지 + 로드맵 종결 (문서/가드주석 전용)

## Status

Accepted (문서/ARCHITECTURE.md/가드 주석 재분류 전용 — 런타임 .ts 본체 0줄)

> 본 ADR 은 **SSOT Single-Funnel 프로그램(ADR-0555 헌법)의 마무리 ADR** 이다 — 남은 burn-down
> 대상(V1 universeScanner)을 "정당한 비-통합 경계"로 종결 인정해 로드맵을 닫는다.

## Context

ADR-0555(헌법) → 0556(factory boundary) → 0557(consumer threading) 으로 SSOT 단일통로 프로그램이
진행됐고, engine-dev 가 로드맵 묶음3(normalSupplyPreview, NONE)을 byte-equivalent 로 완료했다.
다음 차례인 **묶음5(universeScanner Stage2 quote/supply read-site 의 snapshot 입력화)** 는 0단계
타당성 평가에서 **중단(HALT)** 됐다(`_workspace/2026-06-03_ssot-constitution/engine-dev/
bundle5-stage2-feasibility-halt.md`). 본 ADR 은 그 중단 보고를 정식 거버넌스 결정으로 채택한다.

### 진단 — lazy/budget vs eager 모델 충돌 (강제 통합 = 헌법 역행)

묶음5 를 "factory 정본 입력화(V1 burn-down)" 로 풀려면 universeScanner Stage2 가 provider 직접
호출(`enrichQuoteWithKisMTAS` / `fetchKisInvestorTradeByStockDaily`)을 멈추고 factory 정본을 읽어야
한다. 그러나 factory 의 유일 진입점은 **eager 전수수집** `collectUnifiedSnapshot(candidates[])`
(`server/trading/symbolDataCollector.ts:579`)이고, 내부는 `mapLimit(candidates, concurrency,
collectSymbolData)`(:604)로 **모든 후보에 대해** KIS 4-EP 를 `Promise.allSettled` eager 호출한다
(`:343`). factory 에는 budget 을 존중하는 **lazy per-symbol supply accessor 가 없다** —
bundle4(`resolveMarketProgramFlow` 시장-레벨 1회 호출)가 깔끔했던 thin-call seam 이 부재하다.

반면 universeScanner 의 supply fetch 는 **per-symbol budgeted lazy** 다:
- supply budget — `resolveKisInvestorFlowFetchTargets`(`universeScanner.ts:187`)가
  GREEN max25 / YELLOW max15 / RED 0 으로 fetch 대상을 제한한다.
- **통과 후보만 fetch** — SKIP 탈락·HOLD 제거·정렬 후 통과 후보 중 max25 만 supply fetch
  (`universeScanner.ts:509`). 음수 changePercent SKIP 후보는 fetch 대상에서 제외된다
  (golden master test:418~421 가 이 dedup 경계를 잠근다).

factory eager 모델로 강제 통합하면 그 순간:
1. **quota 순증** — budget(max25) *이전에* Stage1 후보 ~60개 전부로 supply fetch 가 일어난다.
2. **SKIP-제외 dedup 경계 파괴(불변식 #9 위반)** — gate 평가 전 전 후보를 당기므로 SKIP 후보도
   fetch 대상이 되어 "음수 changePercent SKIP 후보는 supply fetch 제외" 단언이 무너진다.
3. **fetch 순서·집합 변동** — budget·세션 게이트가 통제하던 타이밍이 factory 입력 시점으로 옮겨가
   golden master 시나리오(d) 회귀.

즉 강제 통합은 오케스트레이터가 명시 금지한 eager 모델과 정확히 일치하며, 헌법의 합격 절대조건
(golden 0변경 · quota 순증 0 · 불변식 #9)을 동시 위반한다. **비-통합이 오히려 헌법 정합** 이다.

### 정당한 불일치 원칙 — "왜 universeScanner 는 factory 미사용?"

ADR-0557 D3(Consumer Contract)은 "factory 가 *생산만 하고 소비 없는* 필드(dead carry)를 금지"
한다. 그 대칭으로, **factory 가 universeScanner 의 budget 통제를 깨면서까지 eager 생산하는 것
또한 금지** 다 — universeScanner 의 lazy/budget 은 quota 보호 설계 분기이지 드리프트가 아니다.
정본 단일성은 "모든 fetch 가 *물리적으로 한 함수를 거친다*" 가 아니라 "각 정보가 *단일 소유 함수*
를 가진다" 로 충족된다(ADR-0555 Information Ownership Registry). supply 는 이미 그 조건을 만족한다(D2).

## Decision

### D1. universeScanner lazy/budget fetch = 정당한 비-통합 경계 (factory eager 모델로 통합하지 않는다)

universeScanner Stage1/2 의 lazy/budget fetch — KIS_LOAD_STATE budget(max25), 통과 후보만 fetch,
음수 changePercent SKIP 제외 — 는 **KIS/KRX quota 절약을 위한 정당한 설계 분기** 다. 이를 factory 의
eager 전수수집 모델(`collectUnifiedSnapshot`)로 **통합하지 않는다.** 강제 통합 시 quota 순증 +
SKIP-제외 dedup 경계 파괴(불변식 #9 위반)가 확정적이므로, **비-통합이 오히려 헌법 정합** 이다.

### D2. 단일 소유 — supply 는 이미 충족(공유 단일함수), quote 는 경로 이원(정당, eager 회피)

- **supply (충족):** `fetchKisInvestorTradeByStockDaily`(`server/clients/kisClient/query.ts:901`,
  FHPTJ04160001, "종목별 투자자 수급 단일 통로")는 **Stage2 와 factory 가 이미 동일 단일함수를 공유**
  한다 — Stage2 는 `kisClient` 에서 import(`universeScanner.ts`), factory 는 `symbolDataCollector.ts:345`
  에서 동일 함수 호출. 즉 supply 정보 타입은 *단일 소유* 가 이미 성립. 이를 Registry 에 명문화한다
  (호출 *타이밍/집합* 은 lazy(Stage2) vs eager(factory)로 다르나, *소유 함수* 는 하나).
- **quote (경로 이원, 정당):** Stage2 는 `enrichQuoteWithKisMTAS`(stockScreener re-export), factory 는
  `fetchKisStockFullQuote` 로 *서로 다른 단일함수* 를 쓴다 — 각자는 단일통로지만 경로가 둘이다.
  통합하려면 Stage2 가 factory 경로를 읽어야 하는데, 그 source 는 eager `collectUnifiedSnapshot` 뿐
  → eager 강제. 따라서 quote 경로 통합은 **보류(정당)** — eager 회피가 헌법 정합이다.

### D3. SSOT 가드 재분류 — V1 계열 allowlist 를 LEGITIMATE_BUDGET_LAZY(영구 허용)로

`scripts/check_ssot_single_funnel.js` 의 V1/V1-extended allowlist 항목(universeScanner.ts 및
screener 발굴 자산)의 사유를 **`P3~P5 burn-down 예정` → `LEGITIMATE_BUDGET_LAZY (영구 허용,
ADR-0558)`** 로 재작성한다. 이는 V5 의 `LEGITIMATE_DIAGNOSTIC`(ADR-0556 묶음2) 선례와 동일 패턴 —
burn-down 대상에서 **영구 제외**. 신규 *유사* lazy/budget fetch 복제는 allowlist 미등재 시 여전히
차단(가드 효력 유지). V3(`marketProgramFlowProvider.ts`)는 본 ADR 범위 밖 — 별도 burn-down 잔존.

### D4. 로드맵 종결 — 묶음5(부분)·묶음6 을 "정당한 경계 — 비추진" 으로 종결

ADR-0555 §Roadmap / ADR-0556 §Roadmap 의:
- **묶음5(universeScanner Stage2 quote/supply 입력화)** = supply 는 이미 단일 소유 충족(추가 작업 0),
  quote 는 eager 강제라 보류 → **'정당한 경계 — 비추진'** 으로 종결 표기.
- **묶음6(universeScanner Stage1 ranking snapshot화)** = executionImpact *직접*(발굴 풀 변경) +
  eager 강제 → **'정당한 경계 — 비추진'.** 별도 ADR 및 shadow A/B 비교 단계도 **불요화(추진 안 함)**.
- `USE_UNIFIED_SOURCE_SNAPSHOT` flag 활성화는 **marketProgram(묶음3·4 범위)에서만 유효** 하며,
  별도 shadow A/B 승격 단계로 잔존(본 ADR 이 flag 전역 활성화를 허가하지 않는다).

### D5. dead carry 방지 원칙 재확인 (ADR-0557 D3 대칭 적용)

factory 는 *생산만 하고 소비 없는* 필드를 늘리지 않는다(Consumer Contract). 따라서 universeScanner
용 quote/supply 를 factory 가 **eager 생산하지 않는 것** 이 정합이다 — universeScanner 가 budget 으로
lazy 소비하는 정보를 factory 가 미리 전수 생산하면 (a) dead/over-fetch + (b) budget 우회 = 이중 위반.

## Consequences

- **무엇이 통합되었나 (SSOT 충족):** supply 정보 타입 — Stage2·factory 가 `fetchKisInvestor
  TradeByStockDaily` 단일함수를 이미 공유(단일 소유). Registry 에 명문화로 정합 확인 종결.
- **무엇이 정당히 분리되나 (비-통합 경계):** universeScanner 의 lazy/budget fetch 타이밍·집합 —
  quota 보호 설계 분기. factory eager 모델로 흡수하지 않는다. quote 경로 이원도 eager 회피로 보류.
- **미래 dev 오수정 방지 (핵심):** "universeScanner 는 왜 factory(`collectUnifiedSnapshot`)를
  안 쓰고 provider 를 직접 호출하지?" 를 **버그로 오인해 factory 입력화로 '고치지' 말 것** — 그
  '수정' 은 budget(max25→60 전수) 우회 + quota 순증 + SKIP-제외 dedup 파괴(불변식 #9) 회귀다.
  본 ADR 이 그 직접 호출을 *정당한 비-통합 경계* 로 확정한다(가드 allowlist LEGITIMATE_BUDGET_LAZY).
- **로드맵 종결:** 묶음5(부분)·묶음6 비추진 → SSOT Single-Funnel 프로그램의 코드 이행 트랙 종결.
  남은 burn-down 은 V3(marketProgramFlowProvider, 별건)뿐.
- **executionImpact: NONE.** 본 ADR 은 ADR/ARCHITECTURE.md/가드 주석(allowlist 사유 문자열) 전용 —
  런타임 소스(.ts 비-테스트) 0줄 변경, behavior change 0, KIS/KRX quota 0 침범, ENV 0건 신설,
  9대 불변식·7대 단일통로 무위반(오히려 #9 보호를 명문 강화). 가드 EXIT 코드 불변(allowlist 키 동일,
  사유 문자열만 변경 — burn-down 카운트 표기만 영구 허용으로 이동).
- **Rollback:** 문서/주석 변경이므로 N/A(git revert). LIVE 영향 0.
- **Self-review (ADR-0146):** (1) LIVE 안전성 — 코드 0줄, NONE, quota 0. (2) wiring vs 인프라 —
  본 ADR 은 *비-wiring 종결 결정*(추진 안 함의 명문화) + 가드 주석 재분류. (3) ADR 무결성 — INDEX
  0558→0559 갱신 + 전체 인덱스 행. (4) 회귀 테스트 — 문서/주석이라 불요(가드 EXIT=0 재확인이 담당).
  (5) baseline 무회귀 — 신규 위반 0, V1 baseline 을 즉시 fail 로 격상하지 않고 *영구 허용* 으로
  재분류(grandfather → legitimate). V3 burn-down 은 별건 잔존.

## Alternatives Considered

- **A. 묶음5·6 강제 추진 (factory eager 입력화).** 기각: budget(max25) 이전 60개 eager fetch 로
  quota 순증 + SKIP-제외 dedup 경계 파괴(불변식 #9) + golden master 시나리오(d) 회귀. 헌법 합격
  절대조건(golden 0변경·quota 순증 0) 동시 위반(`bundle5-stage2-feasibility-halt.md` §해석 A).
- **B. factory 에 budget-aware lazy per-symbol supply accessor 신설 후 입력화.** 기각: factory 의
  "전 필드 동시 수집" 계약(ADR-0556 D5)과 "select/lazy 수집" 이 충돌. 새 seam 은 factory 책임을
  확대하고, 그 이득(통합)은 supply 가 *이미 단일 소유* 라 0 에 가깝다 — 비용 대비 무가치 over-engineering.
- **C. V1 allowlist 를 즉시 fail 로 격상(burn-down 강제 완료 처리).** 기각: 빌드 붕괴 + 위 A 회귀를
  강제. 정당한 budget 분기를 위반으로 단정하는 잘못된 신호. LEGITIMATE_BUDGET_LAZY 영구 허용이 정확.
- **D. 묶음6 별도 ADR + shadow A/B 로 잔존(보류).** 기각: 묶음6 도 eager 강제 + executionImpact
  직접이라 *비추진* 이 옳다. "언젠가 할 일" 로 두면 미래 dev 가 정당한 경계를 부채로 오인. 종결이 정확.

## References

- 헌법: `docs/adr/0555-ssot-single-funnel-enforcement-constitution.md` (§Roadmap P3 universeScanner)
- factory boundary: `docs/adr/0556-sourcesnapshot-factory-boundary-and-contract.md` (D5 신규 fetch 0·quota 순증 0)
- consumer threading: `docs/adr/0557-unified-sourcesnapshot-consumer-threading.md` (D3 Consumer Contract / dead carry 방지)
- 중단 보고(핵심 근거): `_workspace/2026-06-03_ssot-constitution/engine-dev/bundle5-stage2-feasibility-halt.md`
- 정합성 감사: `docs/audits/2026-06-03-ssot-coherence-audit.md`
- Information Ownership Registry(candidate-universe 행): `docs/ai/03-source-snapshot-ssot.md`
- supply budget: `server/screener/universeScanner.ts:187`(`resolveKisInvestorFlowFetchTargets`, max25) · `:509`(통과 후보만 fetch)
- factory eager seam: `server/trading/symbolDataCollector.ts:579/604/343`(`collectUnifiedSnapshot`/`mapLimit`/`Promise.allSettled`)
- 공유 단일함수(supply): `server/clients/kisClient/query.ts:901`(`fetchKisInvestorTradeByStockDaily`, FHPTJ04160001)
- 가드 재분류: `scripts/check_ssot_single_funnel.js` (V1 allowlist → LEGITIMATE_BUDGET_LAZY)
- 선례(LEGITIMATE 패턴): ADR-0556 묶음2 telegram V5 `LEGITIMATE_DIAGNOSTIC` 재분류
- 불변식: CLAUDE.md §2.1 (#9 Gate 우회 금지 / candidate-universe budget 보호)
