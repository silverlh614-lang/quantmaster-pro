# ADR-0549: Market Rally Search Lens (Recommendation-Only Read-Model)

@responsibility recommendation/read-model — 자동매매와 분리된 시장 급등 관측/검색 레이어. 주문 생성 0건, executionImpact=NONE, ENV 1줄 byte-equivalent 롤백.

## Status

Accepted / PR-1 (Foundation: 타입 SSOT + 감지기 + 격리 가드 + carry). ENV `MARKET_RALLY_LENS_ENABLED` default OFF.
PR-2(score/universe) · PR-3(surfacing/telegram) · PR-4(UI) 는 본 ADR 범위 내 후속 patch type.

Tags: recommendation / read-model / source-snapshot-carry / isolation-guard / shadow-only

Patch-MARKET-RALLY-SEARCH-LENS-001.

## 1. Context

코스피 급등·기관 주도 장세에서 자동매매 진입 후보(Gate1/2/3 + RRR + LastTrigger 통과)가 **0개**가
되는 구간이 관측된다. 이는 정상이다 — 27조건 + 4-Gate 는 보수적으로 설계되었고, 9대 불변식상
Gate threshold(Gate1=70), RRR, LastTrigger, Shadow lifecycle, Live order permission 은 손댈 수 없다.

그러나 운영자 관점에서는 "시장은 급등하는데 시스템은 아무것도 안 보여준다"는 정보 공백이 생긴다.
필요한 것은 **자동매매와 완전히 분리된 read-only 관측/검색/추천 레이어**로,
"진입 0개 vs 관측 후보 n개"를 분리 노출하되 **주문은 절대 만들지 않는** 것이다.

### 1.1 기존 경계와의 충돌 위험 (코드 근거)

| 기존 경계 | 위치 | Rally Lens 와의 관계 |
|-----------|------|---------------------|
| AI 추천 universe 발굴 단일 통로 | `server/services/aiUniverseService.ts` (절대규칙 #3, ADR-0011) — KIS/KRX 직접 호출 금지 | **혼합 금지.** Rally Lens 는 자체적으로 universe 를 *발굴*하지 않는다. 이미 materialized 된 `UnifiedSourceSnapshot.perSymbol` / `ScanSummary` 필드만 read 한다. → aiUniverseService 경계 무침범 |
| 자동매매 스크리너 | `server/screener/stockScreener.ts`, `server/trading/signalScanner.ts` | Rally Lens 는 scan 의 **소비자**(read-model)일 뿐, scan 파이프라인을 변경하지 않는다 |
| Gate score SSOT | `server/trading/gates/*`, `aiExecutionIsolation.ScoreBreakdown` | **RecommendationScore 는 GateScore 와 물리적으로 분리된 별도 SSOT** (§4) |
| SourceSnapshot SSOT | `server/trading/sourceSnapshot/unifiedSourceSnapshot.ts` (불변식 #3) | scan 과 recommendation 이 **동일 `snapshotId`** 를 공유. Rally Lens 는 snapshot 을 변경하지 않는 순수 파생(read-only derivation) |

## 2. Decision

### 2.1 신규 경계 — `server/trading/recommendation/`

자동매매 트리(`server/trading/signalScanner/`, `server/trading/gates/`, `server/trading/buyPipeline.ts`)와
**물리적으로 분리된** 신규 폴더를 둔다. 이 폴더의 모든 모듈은 read-model only.

```
server/trading/recommendation/
├── marketRallyLens.ts          # PR-1: buildMarketRallyLens(input) → MarketRallyLens (read-model only)
├── recommendationTypes.ts      # PR-1: MarketRallyLens / RecommendationLabel / RecommendationScore SSOT
├── recommendationScore.ts      # PR-2: scoreRecommendationCandidate(...) (GateScore 와 분리)
└── gate1LaneResult.ts          # PR-2: buildGate1LaneResult(...) (원안 recommendationUniverse.ts 를 lane-split 으로 재명명, AutoTrade universe 와 분리)
```

> **PR-2 lane-split 정합 보강 (patch type, 신규 ADR 번호 발급 0건 · INDEX.md 갱신 0건):**
> 원안 `recommendationUniverse.ts`(단순 universe 빌더)는 PR-2 에서 `gate1LaneResult.ts`(3-lane read-model)로
> 재명명·재정의된다 — `LIVE_HARD_PASS`(기존 Gate1 hardPass 미러) / `SEARCH_RECOMMENDATION_PASS`(finalScore
> degrade-safe OR) / `INDEX_RALLY_WATCH_PASS`(rallyLens.enabled 게이트). 신규 불변식 `LIVE_HARD_PASS_BYTE_IDENTICAL`
> 등재(§3): `liveHardPass === (gate1Passed === true && minSignalScorePassed === true)` —
> `gate1DryRunObservationLedgerAdr0476.ts:500` 의 `hardPass` 와 동일 boolean 식, 임계(70)·점수식·required
> 재정의 0줄. `RecommendationScore` 5-tier(STRONG_WATCH/WATCH/SOFT_WATCH/OBSERVE/LOW_PRIORITY)는 PR-1
> `RecommendationTier` 와 동일. Gate1 평가 파이프라인(signalScanner/gates/gateConfig) 0줄 변경.

> **정적 가드로 강제할 import 금지 규칙** (§5):
> `server/trading/recommendation/**` 는 다음을 import 할 수 없다 —
> `buyPipeline`, `entryEngine`, `tranche*`, `autoTradeEngine`, `kisClient`(주문 경로),
> `exitEngine`, `paperEntry*`, `provisionalShadowLane`, `counterfactual*` (shadow-buy 생성 경로).

### 2.2 Rally Lens ON 조건 (사용자 명시 7조건)

Rally Lens 의 `enabled`/`reason` 은 **`UnifiedSourceSnapshot.macroContext` 와 `MacroState` 파생값**에서만 읽는다.
새 provider 호출 0건. 7조건 (OR 결합, 최초 매칭 reason 채택):

| # | 조건 | 입력 필드 | PR-1 상태 |
|---|------|-----------|----------|
| 1 | KOSPI 당일 +1.5% 이상 | `macroContext.kospiDayReturn` (carry, §6.1) | **활성** |
| 2 | KOSPI +2.0% + 기관 순매수 | `kospiDayReturn` + 시장 기관 순매수 | degrade — `RALLY_INPUT_NOT_AVAILABLE` (시장-레벨 기관 순매수 미정밀) |
| 3 | KOSPI +2.5% (강세 확정) | `kospiDayReturn` | degrade (PR-1 활성 조건 3개 한정) |
| 4 | 외국인 5일 순매수 누적 강세 | `MacroState.foreignNetBuy5d` (억원) | **활성** |
| 5 | KOSPI 강세 + KOSDAQ 약세 (대형주 주도) | `kospiDayReturn` + `kosdaqDayReturn` | degrade — `kosdaqDayReturn` 미수집 |
| 6 | KOSPI 20일 추세 상승 + 당일 반등 | `kospi20dReturn` + `kospiDayReturn` | **활성** |
| 7 | 시장 breadth (상승종목 우위) | `marketBreadth` / advance-decline | degrade — 데이터 부재 |

> **불변식 #6 준수:** `providerIssue=true` 또는 입력이 `null`/`UNKNOWN` 이면 Rally Lens `enabled=false`,
> `reason='RALLY_UNKNOWN_PROVIDER_ISSUE'`. UNKNOWN 을 bullish 로 변환하지 않는다. (bearish 로도 변환 안 함)

> **입력 필드 부재에 대한 PR-1 결정:** 조건 1/4/6 은 기존 필드만으로 즉시 충족 가능(kospiDayReturn 은
> snapshot 에는 없으나 MacroState 에는 있음 → §6.1 read-only carry). 조건 2/3/5/7 은 신규 파생 필드를
> 요구하므로 **PR-1 에서는 조건 1·4·6 만 활성화**, 나머지는 `RALLY_INPUT_NOT_AVAILABLE` 로 명시 degrade.

### 2.3 ENV 토글 (byte-equivalent 롤백)

```
MARKET_RALLY_LENS_ENABLED=false   # default OFF. 미설정/false → buildMarketRallyLens 가 disabled 상수 반환
```

- OFF 시: `buildMarketRallyLens` 는 항상 `{ enabled: false, reason: 'FEATURE_DISABLED', recommendationOnly: true, executionImpact: 'NONE', ... }` 반환.
- ScanSummary 에 가산될 read-only 필드(PR-3)는 OFF 시 `undefined` → formatter/UI 무변화.
- 1줄 ENV 롤백 = 완전 비활성. live 매매 본체 0줄 변경 → byte-equivalent.

## 3. Invariants (정적 가드 강제 대상)

| Invariant ID | 의미 | 강제 방법 |
|--------------|------|-----------|
| `MARKET_RALLY_LENS_RECOMMENDATION_ONLY` | Rally Lens 출력은 추천/관측 전용. `recommendationOnly: true` 타입 리터럴 고정 | 타입(`recommendationOnly: true`) + `scripts/check_rally_lens_isolation.js` |
| `MARKET_RALLY_DOES_NOT_CREATE_ORDER` | `recommendation/**` 는 주문·shadow-buy·paper-executable 생성 경로를 import 금지 | `scripts/check_rally_lens_isolation.js` — forbidden import 목록(§2.1) |
| `RECOMMENDATION_SCORE_SEPARATED_FROM_GATE_SCORE` | RecommendationScore 는 GateScore/ScoreBreakdown 과 별도 타입·별도 SSOT | 타입 분리(별도 타입명) + 가드 |
| `INDEX_RALLY_DOES_NOT_OVERRIDE_BREAKOUT_GATE` | 지수 급등(Rally ON)이 종목 Gate1/2/3 통과 여부를 바꾸지 않음 | Rally Lens 가 `gateConfig`/`gate*Result` 를 write 하지 않음 (read-only) |
| `RALLY_EXECUTION_IMPACT_NONE` | 모든 Rally Lens 산출물 `executionImpact: 'NONE'` 고정 | 타입 리터럴 |
| `RECOMMENDATION_UNIVERSE_NOT_MIXED_WITH_AUTOTRADE` | recommendation universe 와 autoTrade universe 분리 | `recommendation/**` 가 `signalScanner` buyList/candidate 를 mutate 금지 (read-only) |
| `LIVE_HARD_PASS_BYTE_IDENTICAL` (PR-2) | `gate1LaneResult.liveHardPass === (gate1Passed && minSignalScorePassed)` — Gate1 hardPass 미러식, 재계산·임계 재정의 0 | 미러식 1줄(`gate1LaneResult.ts`) + 정적 동일성 테스트 T1(`gate1LaneResult.test.ts`)이 `gate1DryRunObservationLedgerAdr0476.ts:500` 정의와 표본별 일치 검증 |

> 신규 정적 가드 `scripts/check_rally_lens_isolation.js` — `recommendation/**` 의 import 문을 파싱하여
> forbidden 목록과 충돌 시 fail. `validate:all` · `precommit` 등재. **PR-1 에 포함.**

## 4. RecommendationScore SSOT — GateScore 와의 분리 보장

- **위치:** `server/trading/recommendation/recommendationTypes.ts` (타입) + `recommendationScore.ts` (계산, PR-2).
- **GateScore 와의 분리:**
  - GateScore = `server/trading/gates/*` + `ScoreBreakdown`(aiExecutionIsolation.ts) — 매수/매도 결정 SSOT.
  - RecommendationScore = 별도 0~100 척도, **별도 타입명**(`RecommendationScore`), **별도 분류**
    (STRONG_WATCH/WATCH/SOFT_WATCH/OBSERVE/LOW_PRIORITY).
  - RecommendationScore 는 GateScore 를 **입력으로 read 할 수 있으나** GateScore 를 **수정하지 못한다**.
    RecommendationScore 가 Gate 통과/실행 허가에 절대 역류하지 않는다.
- **분리 검증:** `recommendation/**` 가 `gateConfig`·`unifiedExecutionContract`·`buyPipeline` 의 export 를
  *호출하여 값을 바꾸지 않음*을 정적 가드로 강제 (read import 은 허용, write/mutate 패턴 금지).

## 5. aiUniverseService 경계 무침범 보장

- Rally Lens recommendation universe(PR-2)는 **새 종목을 발굴하지 않는다.** 입력은 오직:
  - `UnifiedSourceSnapshot.perSymbol`(이미 SymbolDataCollector 가 수집·materialize 한 결과),
  - `UnifiedSourceSnapshot.screenedCandidates`,
  - `ScanSummary` read-only 필드.
- 따라서 KIS/KRX/Google/Naver **직접 호출 0건** → 절대규칙 #3(aiUniverseService 단일 통로) 무침범.
- aiUniverseService 의 MOMENTUM/QUANT_SCREEN/BEAR_SCREEN/EARLY_DETECT universe 와는 **물리적으로 다른 모듈**.

## 6. Consequences

### 6.1 SourceSnapshot 입력 필드 (불변식 #3 영향 분석)

- Rally Lens 조건 1(당일 지수 수익률)은 현재 `UnifiedMacroContext` 에 **없다**(`kospi20dReturn` 만 존재).
- **결정:** 이 값은 이미 `MacroState`(repo) 에 존재(`kospiDayReturn`). `UnifiedMacroContext` 에
  **read-only 파생 필드를 가산**하는 것은 "스냅샷 시점 macroState 핵심 필드 복사"의 기존 패턴
  (unifiedSourceSnapshot.ts:17-35)을 따르는 것으로, **새로운 판단 출처를 만드는 것이 아니라 기존
  macroState 값의 시점 고정 복사**다.
  → 불변식 #3 "모든 판단은 단일 SourceSnapshot 에서 출발" 을 **강화**한다(Rally Lens 도 동일 snapshot 소비).
  → 불변식 #4/#5 무영향(Policy/Confidence/ExecutionPermission/LearningLabel 미변경).
- **PR-1 wiring:** `UnifiedMacroContext.kospiDayReturn?` optional carry 필드 + SymbolDataCollector 의
  `buildMacroContext` 에서 macroState 복사 1줄. optional 이므로 기존 직렬화/`buildLegacyPlaceholderSnapshot`
  후방호환. `sourceSnapshotSsot.test.ts` 무회귀 확인.

### 6.2 긍정적 결과

- 운영자에게 "진입 0개 vs 관측 후보 n개" 가시성 확보(PR-3/4).
- 자동매매 안전성 0 변경(executionImpact=NONE, ENV 1줄 롤백).
- 동일 snapshotId 공유로 scan/recommendation 정합 추적 가능.

### 6.3 위험

- `UnifiedMacroContext` 필드 추가 시 snapshot 직렬화 회귀 가능 → PR-1 테스트로 검증(optional 후방호환).
- "관측 후보"가 운영자에게 *매수 신호*로 오인될 위험 → 라벨 `WATCH_NOT_BUY`/`SEARCH_ONLY` + UI 분리(PR-4)로 차단.

## 7. Rollback

- `MARKET_RALLY_LENS_ENABLED=false` (default) → 전 기능 비활성, ScanSummary read-only 필드 `undefined`, UI/텔레그램 무변화.
- 코드 롤백: `server/trading/recommendation/` 폴더 + UnifiedMacroContext carry 1줄 revert.
- live 매매 본체(buyPipeline/entryEngine/gates/exitEngine/autoTradeEngine) **0줄** → byte-equivalent.

## 8. Alternatives Considered

1. **aiUniverseService 에 rally 모드 추가** — 거부. 추천 universe 발굴 통로에 read-model 책임 혼입 →
   절대규칙 #3 SRP 위반, 자동매매 universe 혼합 위험.
2. **signalScanner 내부에 rally 후보 카운트 추가** — 거부. 자동매매 트리에 추천 책임 혼입,
   Gate score 와 RecommendationScore 분리 불가, 불변식 위반 위험.
3. **Gate threshold 를 rally 구간에 동적 완화** — **명시적 거부**(사용자 invariant). Gate1=70/RRR/LastTrigger 불변.

## 9. References

- `CLAUDE.md` §2.1(9대 불변식) · §2.2(7대 단일 통로) · §5.1(Patch Scope Guard)
- `ARCHITECTURE.md` — aiUniverseService, signalScanner, screener
- `server/trading/sourceSnapshot/unifiedSourceSnapshot.ts` (UnifiedMacroContext)
- `server/persistence/macroStateRepo.ts` (MacroState — kospiDayReturn / foreignNetBuy5d / programNetBuyAmount)
- `src/types/core.ts` (RegimeVariables)
- `docs/ai/03-source-snapshot-ssot.md` (carry wiring SSOT 패턴)
