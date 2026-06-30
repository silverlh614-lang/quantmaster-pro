# ADR-0659 — Fundamental Deep-Junk Floor Entry Exclusion (펀더멘털 deep-junk floor 후보 제외)

- Status: Accepted (운영자 silverlh614 "추천"→"구현시작" — Option B 후속, ADR-0658 형식적-지정 제외의 확장)
- Date: 2026-06-30
- 계보: 0658(형식적 KRX 지정 제외 — 본 ADR 이 직접 확장) · 0655/0656(Gate2 재무위험 soft 페널티 — 본 ADR 이 보완) ·
  0529(Gate2 canonical merge — ROE 소스) · 0157(flag 비교 규약) · 0641(flag-lifecycle 거버넌스) ·
  0146(LIVE 안전·byte-equivalent) · 0530(Patch Scope Guard)

## Context — Root Cause

ADR-0658 은 형식적 KRX 지정(투자경고/위험/관리/단기과열·KIS inquire-price designation)을 가진 종목을 진입에서
제외했다. 그러나 **형식적 지정이 없으나 펀더멘털이 깊게 음(-)인 종목**은 여전히 통과한다. 운영자가 보고한 서산
(079650) 사례: `/scan_blockers` 가 Gate2 재무 라인에서 `ROE=-55.60`(`perInterpretation=
NOT_MEANINGFUL_DUE_TO_NEGATIVE_EARNINGS`)을 표시했고, 적자 + shadow -10% 손실을 기록했음에도 형식적 지정이
없어 ADR-0658 designation gate 를 통과했다. 운영자는 이런 junk/risky 종목을 형식적 지정 없이도 ENTRY 에서 제외할
것을 "추천"→"구현시작"으로 요청(Option B).

ROE 는 새 fetch 가 필요 없다 — Gate2 external 캐시(`gate2-external-cache.json`,
`projection.profitability.roe` / `projection.metrics.roe`)에 이미 머지되어 있으며, 이것이 `/scan_blockers` 가
서산 `ROE=-55.60` 을 표시한 바로 그 소스다(ADR-0529/0532 canonical merge·KIS finance roe).

## Decision — conservative "deep-junk floor"

ROE 가 present 이고 finite 이며 floor(기본 **-20%**) 이하이면 ENTRY 후보에서 제외한다. 보수성 근거:
floor 를 깊게(-20%) 두어 (1) 경미·턴어라운드 적자(-5% 등), (2) 흑자전환 직전 성장주(pre-profit growth leader)는
살리고 (3) 깊은 적자(서산 -55%)만 잡는다. ROE 결손/NaN/캐시 부재 → **미제외(graceful; 데이터 결손 ≠ junk,
불변식 #6)**.

### 1. 순수 SSOT 분류기 (ADR-0658 모듈 family 확장 — gate2ConfluenceScore 와 무관)

`server/trading/riskDesignationClassifier.ts` 에 `isFundamentalJunkBelowFloor({ roePct }, floorPct) →
{ excluded, reason? }` 추가. `roePct != null && Number.isFinite(roePct) && roePct <= floorPct` 일 때 제외.
reason 예: `FUNDAMENTAL_JUNK_FLOOR:ROE=-55.6<=-20`. 결손/NaN/±Infinity → 미제외. 순수(부수효과·네트워크 0).
경계: `roePct === floorPct` → 제외(≤).

### 2. 단일 per-symbol chokepoint 가드 (designation gate 직후, OR 결합)

`server/trading/signalScanner/perSymbol/steps/fundamentalFloorGate.ts` `evaluateFundamentalFloorGate`.
`buyListLoop.ts` 에서 ADR-0658 `evaluateRiskDesignationGate` **직후**, 동일 Gate1 entry candidacy 직전 seam 에
배치(designation OR fundamental-floor → EXCLUDE). ROE 는 `getGate2ExternalCacheRecord(stock.code)` 에서
reuse-only 동기 read(`projection.profitability.roe` 우선, 없으면 `metrics.roe`) — **신규 KIS/DART fetch 0**
(`/scan_blockers` 가 표시한 동일 캐시). 제외 시 silently drop 하지 않고 `RISK_FUNDAMENTAL_FLOOR_EXCLUDED`(reason
포함) 진단(perStageDropoff LIVE_ORDER_BLOCKED=BLOCKED)을 남겨 `/scan_blockers` 에 노출한다. 위쪽 counterfactual/
provisional 학습 lane 은 이미 실행돼 관측 연속성을 유지하되(불변식 #2), paper/shadow ENTRY 는 되지 않는다.

**ROE 소스가 reliable 한 이유**: gate2ExternalCache 는 Gate2 refresh 가 영속한 디스크 캐시이며 동기 read 다.
ROE=-55.60 을 운영자 dump 에서 실제로 표시한 소스와 byte-identical 경로이고, 캐시 부재/결손 시 graceful 하게
PROCEED 하므로 false-positive 차단 위험이 없다. price-level `reCheckQuote.kisOfficialQuote` 에는 ROE 가 attach
되지 않으므로(quote 는 가격 레벨) Gate2 projection 캐시가 유일한 reliable pre-ENTRY 소스다.

### 3. Flag + ROE floor SSOT

`gateConfig.ts` `isRiskFundamentalFloorExclusionEnabled()` → `RISK_FUNDAMENTAL_FLOOR_EXCLUSION_ENABLED !==
'false'`(default ON kill-switch). `getRiskFundamentalRoeFloorPct()` → `RISK_FUNDAMENTAL_ROE_FLOOR_PCT` 파싱,
기본 -20, `[-100, 0]` clamp(흑자 floor·과도 음수 방지), NaN/미설정 → -20. 호출자 inline ENV 검사/파싱 금지 — SSOT only.

## Scope / Safety (Patch Scope Guard, ADR-0530 — 11 fields)

- targetDomain: (1) 순수 분류기 확장(펀더멘털 floor) (2) per-symbol entry chokepoint 가드 (3) flag/floor SSOT — 3 도메인.
- allowedFiles: `riskDesignationClassifier.ts`(분류기 추가) · `fundamentalFloorGate.ts`(신규) · `buyListLoop.ts`(가드 wiring) ·
  `gateConfig.ts`(flag+floor getter) · 테스트 · 거버넌스(ADR/INDEX/patch-history/.env/flag-lifecycle).
- forbiddenFiles: autoTradeEngine order 본문 · buyPipeline order placement · SourceSnapshot 생성기 · Gate1 score
  curves(ADR-0471) · requiredScore=70 SSOT · 병렬 세션 `gate2ConfluenceScore.ts` buildFundamentalAxis 본문(ADR-0655) · src/**.
- expectedBehaviorChange: ROE ≤ floor(-20%) deep-junk 종목이 ENTRY(paper/shadow 포함) 후보에서 제외 — candidate-eligibility EXCLUSION only.
- sourceSnapshotImpact: 없음(ROE 는 Gate2 캐시 reuse-read, SourceSnapshot 생성기 무접촉; 불변식 #3/#9).
- executionImpact: **candidate EXCLUSION only — 엄격히 더 보수적**. engineMode SHADOW_ONLY 라 live 주문 0.
- shadowLearningImpact: 제외 종목도 위쪽 counterfactual/provisional 학습 lane 관측은 유지(차단 ≠ 삭제, 불변식 #2).
- telegramImpact: `/scan_blockers` perStageDropoff 에 RISK_FUNDAMENTAL_FLOOR_EXCLUDED 노출(진단 가시화).
- providerImpact: 신규 KIS/KRX/DART/Yahoo fetch 0 — gate2ExternalCache 동기 read 만(ADR-0561 정합).
- testsRequired: 분류기(ROE -55→excluded · -20 boundary→excluded(≤) · -19.9→미제외 · null/NaN→미제외 · floor override) ·
  flag/floor getter(default·clamp·NaN) · 가드(ROE-junk → EXCLUDE+진단 · flag=false → byte-identical PROCEED · floor override).
- rollbackPlan: `RISK_FUNDAMENTAL_FLOOR_EXCLUSION_ENABLED=false` 1줄 → 제외 미적용 byte-identical.

## 9대 불변식

- #1 Trading Engine 보존 — 가드는 순수 판정 + continue, try/catch 흐름 무영향(캐시 read 실패도 graceful PROCEED).
- #2 Shadow Learning 보존 — 제외 종목도 counterfactual/provisional 관측 lane 유지(차단 ≠ 학습 정지).
- #6 데이터 결손 ≠ bearish — ROE 결손/NaN/캐시 부재 → 미제외 graceful, market signal 생성 0.
- #7 품질 필터 우회 0 — 본 가드는 후보 자격 *축소*(더 보수적)이며 Gate0~3+requiredScore70 우회 아님.
- #8 실거래 차단과 Shadow 판단 분리 — flag 는 ENTRY 후보 제외만, shadow 관측은 별도 유지.

## Note — 보완 관계 + 보수성

- 본 floor 는 ADR-0655/0656 Gate2 재무위험 soft 페널티(점수 cap·STRONG_BUY 승격 차단)를 **대체하지 않고 보완**한다.
  ADR-0655 는 점수 cap(soft)이고 본 ADR 은 deep-junk 의 hard candidate EXCLUSION(별도 seam·별도 모듈 family)이다.
- floor 는 ROE ≤ -20% default, ENV(`RISK_FUNDAMENTAL_ROE_FLOOR_PCT`) tunable, `[-100, 0]` clamp. 운영자가
  과제외/under-filter 관측 시 floor 만 재조정(분류기/가드 무변경)할 수 있다.
- ROE 결손에 graceful — 데이터 갭을 junk 로 격상하지 않는다(불변식 #6). 형식적 지정(ADR-0658)과 OR 결합이라 둘 중
  하나만 trigger 해도 제외된다.
