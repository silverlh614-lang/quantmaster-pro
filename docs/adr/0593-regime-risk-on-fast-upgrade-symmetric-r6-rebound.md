# ADR-0593: Risk-On Fast-Upgrade Path — Symmetric Upside Trigger for R6 Strong-Rebound (Shadow-Gated, default OFF)

@responsibility policy — 폭락 다음날 강반등 시 risk-on 조기 승급(provisional R3_EARLY)으로 ADR-0550 주도주 포착을 깨우는 상방 대칭 트리거 (shadow-gated, default OFF, universe 확장 한정)

## Status

Proposed

## Context

### 증상 (2026-06-09 현장, 진단 완료 — 재도출 불필요)

폭락 다음날 강반등(KOSPI +7.45%)에도 레짐 분류기가 R4_NEUTRAL 에 고착돼, risk-on 주도주
포착(ADR-0550)이 깨어나지 못한다. ADR-0592 가 **하방**(어제 폭락 봉이 오늘 'FRESH intraday
trigger' 로 오인되는 R6 false-latch) 을 수리했으나, **상방** 비대칭은 잔존한다.

### 근본 원인 — 상승/하락 비대칭 + 후행 집계

`src/services/quant/regimeEngine.ts` `classifyRegime(v)` (line 186) 본체 분석:

- **R6 블랙스완 (line 189-195):** `v.kospiDayReturn < -5` → R6_DEFENSE. **오늘 수익률
  (`kospiDayReturn`)은 하락 전용으로만 소비된다. 상승 방향(+T%)에 대응하는 대칭 트리거가 없다.**
- **R3_EARLY 정상 경로 (line 209-219):** 5개 신호(`vkospi5dTrend<-3`, `foreignNetBuy5d>0`,
  `kospi20dReturn>0 && !kospiAbove60MA`, `spx20dReturn>1`, `vix<20 && dxy5dChange<0`) 중 2개 +
  `mhsScore>=40`. **전부 5일/20일 후행 집계라 폭락이 창(window)을 오염**시켜, 강반등 당일에도
  2개 충족 못 함.
- **R3 강제 승급 (line 246-255):** `(kospiAboveMA20Pct ?? 0) > 3 && (foreignContinuousBuyDays ?? 0) >= 1`.
  폭락 다음날엔 둘 다 실패 — 가격이 MA20 위 3% 를 못 넘고(폭락 갭 미회복), 외국인은 순매도 지속.
- **fall-through (line 258):** → R4_NEUTRAL.

`server/screener/pipelineHelpers.ts:643` `RISK_ON_REGIMES = ['R1_TURBO','R2_BULL','R3_EARLY']` —
ADR-0550 주도주 포착이 이 집합일 때만 발동. **R4_NEUTRAL 미포함이 병목.** 동일 집합이
`server/orchestrator/emptyScanPostmortem.ts:163` 에도 존재.

### 데이터 흐름 (수정 진입점 확정)

`classifyRegime(buildRegimeVars(macroState))` → `getRawRegime` (regimeBridge.base.ts:834) →
`evaluateR6RecoveryTransition` → `effectiveRegime` → `resolveCanonicalRegimeLevel`
(`server/trading/regime/canonicalRegimeAccess.ts:12`) → RISK_ON_REGIMES 게이트 / ADR-0550
leader capture 소비. **상방 fast-upgrade 를 rawRegime 산출 단계(`classifyRegime`)에 두면
기존 canonical 체인을 그대로 타고 RISK_ON_REGIMES 게이트까지 자연 전파**된다 (신규 소비처 배선 0).

### 대칭 선례 — ADR-0592 의 자산 재사용

ADR-0592 가 이미 **상방 fast-upgrade 의 입력 인프라를 절반 구축**해 두었다:

- `MacroState` 에 `kospiIntradayReturn` / `kospiIntradaySourceTradeDate` / `kospiIntradayFetchedAt`
  필드 존재 (macroStateRepo.ts:179-183) — 오늘 현재가 vs 전일종가 기반 intraday 수익률, KIS 종합지수
  0001(L1) 소스.
- `resolveRecoveryKospiDayReturn(macroState, now)` (regimeBridge.base.ts:282) = **거래일(today-key)
  + fetchedAt TTL freshness 가드 SSOT** — 본 ADR 의 falling-knife 방지(제약 #7)에 그대로 재사용.
- R6 strong-rebound decay 경로(regimeBridge.base.ts:656, `R6_STRONG_REBOUND_DECAY_ENABLED`,
  threshold +3%) 가 **하방 latch 의 상방 해제** 패턴. 본 ADR 은 그 *분류기 진입* 측 대칭.

## Decision

폭락 다음날 강반등을 risk-on 으로 인식하는 **상방 fast-upgrade 경로**를 `classifyRegime` 에
단계적 flag-gated 로 도입한다. R6 의 `kospiDayReturn < -5` 블랙스완 하락 트리거에 대칭하는
상방 트리거이며, 승급 상한은 **R3_EARLY 까지(provisional)** 다. default OFF 시 현 동작 100% 보존.

### D1. 상방 트리거 신호 분리 모듈 (순수 함수 SSOT)

신규 모듈 `server/trading/regime/riskOnFastUpgrade.ts` 를 **상방 fast-upgrade 판정의 순수
평가 SSOT** 로 둔다 (ADR-0592 `kospiTriggerFreshness.ts` 분리 선례). 입력은 RegimeVariables
+ 오늘 freshness-guarded intraday 수익률 + breadth, 출력은 boolean(승급 자격) + 진단 사유.
판정 규칙 (3중 AND — whipsaw 가드, ADR-0592 D3 패턴):

1. **오늘 강반등:** `kospiDayReturn_today >= T` (T = `REGIME_RISK_ON_FAST_UPGRADE_THRESHOLD_PCT`,
   기본 제안 +3.0~4.0%, **운영자 확정 필요**). `kospiDayReturn_today` 는 **오늘 거래일 + TTL
   freshness 가드를 통과한 값만** 사용 (제약 #7, falling-knife 방지) — `resolveRecoveryKospiDayReturn`
   동형 가드 재사용(또는 동일 freshness SSOT 위임).
2. **VKOSPI 진정:** `vkospiDayChange <= 0` (또는 `mhsScore >= MHS_MIN`) — 공포 미확산 확인.
   하락 trigger(`vkospiDayChange > 30`) 의 상방 대칭. **임계 운영자 확정 필요.**
3. **시장 breadth 우위:** 상승종목 우세(advance/(advance+decline) ratio ≥ 기준, default 0.6).
   **해소(engine-dev 구현):** 신규 endpoint 불필요 — ADR-0592 D2 `fetchKospiCompositeIntradayQuote`
   (sectorIndex.ts:434)가 KOSPI 종합지수(0001)를 `inquire-index-price`(FHPUP02100000)로 이미 호출하며,
   응답 row 에 **`ascn_issu_cnt`(상승종목수)·`down_issu_cnt`(하락종목수)** 가 포함된다. 동일 응답에서
   2필드만 추가 추출(`extractKisNumberOptional`, KIS 콜 0 추가·quota 0) → macroState
   `kospiAdvanceCount`/`kospiDeclineCount`/`kospiBreadthFetchedAt` 영속. 파싱 실패/부재 시 undefined
   (보수 미발동).

3중 동시 충족 시에만 승급 자격 true. breadth 소스 부재/STALE 시 **보수적으로 승급 미발동**
(데이터 결손 ≠ 승급, 불변식 #6 정합 — providerIssue 를 bullish signal 로 변환 금지).

### D2. classifyRegime fall-through 직전 상방 승급 분기 삽입 (flag-gated)

`classifyRegime` 의 R3 강제 승급(line 246-255) 과 R4 fall-through(line 258) **사이**에
신규 분기 삽입:

```
// flag ON + riskOnFastUpgrade 자격 → provisional R3_EARLY (R6 -5% 블랙스완의 상방 대칭)
if (isRiskOnFastUpgradeEnabled() && evaluateRiskOnFastUpgrade(v) .eligible) return 'R3_EARLY';
```

- **승급 캡 = R3_EARLY 까지만** (제약 #6). R2_BULL/R1_TURBO 로 직행 금지 — 그 레짐은
  기존 다신호 합산 경로로만 도달.
- flag OFF 시 분기 미진입 → fall-through R4_NEUTRAL byte-equivalent.
- `RegimeVariables` 에 breadth + freshness-guarded intraday 입력 전달이 필요 →
  `buildRegimeVars`(regimeBridge.base.ts:49) 가 macroState 의 breadth/intraday 필드를 주입하도록
  optional 필드 추가(D3).

### D3. 타입 변경 — RegimeVariables / MacroState 확장 (additive optional)

- `RegimeVariables` (src/types/core.ts:90) 에 **optional** 필드 추가 (⑧ 승급 보조 축 확장):
  - `kospiDayReturnToday?: number` — 오늘 거래일 freshness-guarded intraday 수익률
    (기존 `kospiDayReturn` 은 봉 종가 기반 — 의미 분리, ADR-0592 와 동일 stale 우려 격리).
  - `marketBreadthAdvanceRatio?: number` — 시장 상승종목 비율(0~100) 또는 above-MA20 breadth.
- `MacroState` (macroStateRepo.ts) 에 breadth 영속 필드 추가(소스 확정 후) — `kospiIntradayReturn`
  계열은 ADR-0592 가 이미 추가했으므로 재사용.
- 모든 신규 필드 **optional** → 미설정 시 승급 미발동(보수). 기존 RegimeVariables 시그니처
  후방호환 유지(`?? ` fallback, ADR-0136 의미 단절 정책 정합).

### D4. 단계적 활성화 경로 (ADR-0592 선례 — 데이터→shadow→검증→live)

신규 ENV `REGIME_RISK_ON_FAST_UPGRADE_ENABLED` (default OFF). ADR-0592 D3 / ADR-0581 phased
패턴 차용:

1. **Phase 0 (데이터 공급):** breadth 소스 wiring + `buildRegimeVars` 주입. flag OFF —
   진단 라벨 `[REGIME_RISK_ON_FAST_UPGRADE_OBSERVE]` 만 기록, 승급 미발동(byte-equivalent).
2. **Phase 1 (shadow 관측):** N영업일 counterfactual — flag ON 가정 시 승급됐을 케이스를
   shadow 로 기록. false-upgrade(반등 후 재폭락 = whipsaw) 0 확인.
3. **Phase 2 (검증):** breadth + VKOSPI 동시 가드의 whipsaw 차단율, ADR-0550 leader capture
   품질(진입 후 성과) counterfactual 검증.
4. **Phase 3 (live 기여):** 운영자 ENV ON 결정 → provisional R3_EARLY 가 RISK_ON_REGIMES
   게이트를 통해 universe 확장에만 기여.

### D5. 진단 가시화 (silent 금지)

- 승급 발동 시 `[REGIME_RISK_ON_FAST_UPGRADE]` 로그 — 3가드 값(kospiDayReturnToday/
  vkospiDayChange/breadth) + 임계 + executionImpact 명시.
- breadth 결손/freshness 강등으로 미발동 시 사유 로그(silent swallow 금지, SDS 정책 정합).
- `RegimeDiagnostics` 에 `riskOnFastUpgradeApplied`(boolean) 노출(/regime 표시).

## Guardrails (ADR-0550 상속)

- No live trading path change unless explicitly stated.
- No KIS/order import or invocation unless explicitly stated. (breadth fetch 는 kisClient 단일 통로)
- **No Gate/Kelly/STRONG_BUY behavior change** — provisional R3_EARLY 는 universe 후보 유입
  (RISK_ON_REGIMES 게이트)만 확장. R3_EARLY 의 Kelly(0.7)/Gate(gate2Required 6/gate3Required 4)/
  STRONG_BUY 게이팅은 기존 REGIME_CONFIGS 값 그대로 — 신규 사이징·게이트 완화 0.
- No Shadow policy change unless explicitly stated.
- No provider fetch behavior change unless explicitly stated (Phase 0 breadth 공급 외 — flag OFF 시 0).
- No data promotion behavior change unless explicitly stated.

## Consequences

### 긍정

- 폭락 다음날 강반등이 risk-on 으로 인식 → ADR-0550 leader capture 가 깨어나 주도주가
  universe 에 유입(R4_NEUTRAL 병목 해소).
- R6 하방 트리거(`kospiDayReturn < -5`)의 상방 대칭 확립 — 분류기 비대칭 구조적 해소.
- ADR-0592 freshness/TTL SSOT 재사용 → falling-knife(아침 stale 반등값이 오후 내내
  live-eligible) 위험을 동일 가드로 차단.

### 비용·위험

- **whipsaw 위험** (반등 후 재폭락 시 잘못된 risk-on) → default OFF + breadth·VKOSPI 동시
  AND 가드 + shadow N영업일 검증으로 봉인 (ADR-0592 D3 패턴).
- **breadth 데이터 부재 — 해소(engine-dev).** D2 응답(`fetchKospiCompositeIntradayQuote`)의
  `ascn_issu_cnt`/`down_issu_cnt` 를 추가 추출해 advance/(advance+decline) ratio 산출. 신규 KIS 콜·
  endpoint 0(quota 0). breadth/intraday 부재·stale(어제 거래일·TTL 초과) 시 보수적 미발동 유지.
- 승급 캡 R3_EARLY 로 R3 의 Kelly 0.7·maxExposure 60% 만 활성 — R2/R1 직행 금지로
  과도 노출 차단.

## Rollback

1. `REGIME_RISK_ON_FAST_UPGRADE_ENABLED=false` (1줄) → 상방 승급 분기 미진입, fall-through
   R4_NEUTRAL 즉시 복원 (ADR-0146 byte-equivalent).
2. Phase 0 breadth fetch 도 flag 게이트 → OFF 시 KIS/KRX quota 0 침범.

모든 flag OFF = 현 baseline byte-equivalent. LIVE 매매 본체(Gate/Kelly/STRONG_BUY/order) 0줄 변경.

## Alternatives Considered

- **A1. RISK_ON_REGIMES 집합에 R4_NEUTRAL 추가.** 기각 — R4 는 진짜 중립 횡보도 포함하므로
  상시 leader capture 발동 = 의미 오염. 강반등 *조건부* 승급이 정확.
- **A2. classifyRegime R3 강제 승급(line 246-255)의 임계 완화**(kospiAboveMA20Pct>3 → >0).
  기각 — 폭락 갭 미회복 상태에서 MA20 기준 자체가 후행. 오늘 intraday 수익률 직접 트리거가
  강반등을 즉시 포착. 또한 임계 완화는 byte-equivalent 위반(flag 없는 상시 변경).
- **A3. R2_BULL/R1_TURBO 까지 승급 허용.** 기각 — 단일일 반등 1개 신호로 최고 공격 레짐
  직행은 과도 노출(제약 #6 캡 위반). provisional 은 R3_EARLY 소규모 선취매까지만.
- **A4. flag 없이 즉시 live 승급.** 기각 — ADR-0146 byte-equivalent + whipsaw 위험.
  shadow 선검증 필수(ADR-0592 D3 / ADR-0581 phased 선례).
- **A5. breadth 없이 kospiDayReturn 단독 트리거.** 기각 — 단일 지표 반등은 dead-cat-bounce
  취약. breadth + VKOSPI 동시 AND 가 whipsaw 가드(ADR-0592 D3 "breadth + VKOSPI 동시").
- **A6. Yahoo intraday breadth.** 기각 — ADR-0561 KIS Primary Absolute. KIS(L1) 공급 가능
  레이어에서 Yahoo(L3) primary 금지. KIS 등락종목수가 정본.

## References

- ADR-0592 (R6 trigger freshness trade-date + intraday rebound — 본 ADR 의 **하방 대칭 선례**,
  `resolveRecoveryKospiDayReturn` freshness/TTL SSOT · `kospiIntradayReturn` MacroState 필드 재사용)
- ADR-0550 (stage1 risk-on regime leader capture — universe 확장 가드레일 상속, RISK_ON_REGIMES 소비)
- ADR-0146 (byte-equivalent PR 자가 review 5 카테고리 — flag OFF baseline 보존 · ENV 1줄 롤백)
- ADR-0581 (shadow→live phased flag 파이프라인 선례)
- ADR-0561 (KIS Primary Absolute — breadth 소스 KIS 단일 통로) · ADR-0563 (Yahoo burn-down)
- ADR-0531 (canonical regime decision-layer 단일 접근자 — effectiveRegime 전파 경로)
- ADR-0136 (boolean→null 의미 단절 — optional 필드 미설정 시 미발동 보수)
- `docs/ai/00-project-charter.md` §2.1 (9대 불변식 — 특히 #6 providerIssue≠bearish, #7 L4 live 미사용)
- `docs/ai/02-trading-engine-rules.md` (레짐 · engineMode · 사이징)
- `src/services/quant/regimeEngine.ts:186` (classifyRegime 본체) ·
  `server/trading/regimeBridge.base.ts:49` (buildRegimeVars) ·
  `server/screener/pipelineHelpers.ts:643` (RISK_ON_REGIMES 병목)

### 미해결 (운영자 확정 필요)

1. **임계 T** (`REGIME_RISK_ON_FAST_UPGRADE_THRESHOLD_PCT`) — engine-dev default **3.5**(+3.0~4.0
   권장 구간 중앙). counterfactual 튜닝으로 운영자 확정. (구현은 ENV 오버라이드 제공.)
2. ~~**breadth 소스**~~ — **해소.** D2 응답 `ascn_issu_cnt`/`down_issu_cnt` 추출(신규 KIS 콜 0).
   breadth 우위 비율 default **0.6** (`REGIME_RISK_ON_FAST_UPGRADE_BREADTH_MIN_RATIO`, ENV 오버라이드).
3. **VKOSPI 진정 가드 형태** — engine-dev 채택 `vkospiDayChange <= 0`(공포 미확산). MHS 추가 AND 여부 운영자 검토.
4. **shadow 관측 N영업일** 수 (ADR-0592 선례 참조) — 운영자 결정. Phase 0/1 관측 라벨
   `[REGIME_RISK_ON_FAST_UPGRADE_OBSERVE]`(breadth 공급)/`[REGIME_RISK_ON_FAST_UPGRADE]`(승급) 기록.

### Status 갱신 (engine-dev 구현)

- D1(순수 SSOT `riskOnFastUpgrade.ts`)·D2(classifyRegime 분기, resolved boolean 소비)·D3(타입 확장)·
  D4(ENV flag default OFF)·D5(진단 로그) 구현 완료. breadth 는 D2 응답 부산물로 확보(KIS 콜 0).
- **src↔server 경계 준수:** classifyRegime(src)은 server SSOT 를 직접 import 불가 → buildRegimeVars
  (server)가 `shouldFastUpgradeToR3Early` 로 자격을 산출해 RegimeVariables `riskOnFastUpgradeEligible`
  resolved boolean 으로 주입(기존 kospiAboveMA20Pct 주입 패턴 동형). classifyRegime 은 boolean 만 소비.
