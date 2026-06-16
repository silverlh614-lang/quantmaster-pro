# ADR-0616 — Universe Composition Bias Observation (per-scan aggregate)

- Status: Proposed (Phase 0 — 경계·타입·ADR. default OFF byte-equivalent. 구현은 engine-dev 인계.)
- Date: 2026-06-16
- Domain: policy / screener
- 계보: ADR-0612 (universe-relative-strength-gate) / ADR-0614 (consecutive-netbuy-observation-ledger) / ADR-0615 (news-lag-entry-window-observation) / ADR-0561 / ADR-0157 / ADR-0445 / ADR-0476

## Context

운영자 audit(2026-06-16): 유니버스 발굴이 코스닥 소형주/낙폭 반등주에 구조적으로 편향된다.
디버전스 장(코스피 +1.55% vs 코스닥 −1.60%)에서 코스피 대형 주도주를 후보에 못 넣고,
후보 RS = −8.97%(코스피 대비 9%p 언더퍼폼)로 채워졌다. ADR-0612 가 이미 RS 게이트(발굴
MOMENTUM 필터 + Stage1 0-floor 보너스)를 도입했으나 default OFF 이고, 운영자는 **편향을 바꾸기
전에 먼저 정량화**하기로 결정했다 — fetch-0·OFF-safe 관측 하네스로 스캔별 KOSPI/KOSDAQ 비중과
leader/laggard 분포를 누적해 디버전스 장 편향 추세를 직접 관측한 뒤, 별도 ADR 로 발굴 편향을 교정한다.

핵심 제약:
- 관측 전용 — 신규 ENV flag default OFF, universe 발굴/Stage1 필터/정렬/Gate score 에 **미배선**(행동 0 변경).
- fetch-0 — `getStockByCode`(로컬 KRX 마스터) + 이미 fetch 된 candidate trace 필드만. 신규 KIS/KRX/Yahoo 호출 0.
- single 통로 — RS 는 기존 trace 필드 재사용(두 번째 RS 공식 신설 금지). market 은 `getStockByCode` 만.
- flag OFF → universeScanner byte-identical.

## Decision

per-candidate stamp 아닌 **per-scan aggregate** 관측. 후보 집합 전체에 대해 스캔당 1 summary 산출·기록.

### 산출 (4축)

1. **시장 구성** — 각 후보 `getStockByCode(c.code).market` → `kospiCount`/`kosdaqCount`/`otherCount`
   (KONEX·OTHER·마스터 미매칭[null]은 otherCount). 로컬 마스터 read, fetch 0.
2. **leader/laggard** — `RS = candidate.quote.return20d − benchmarkReturn20d`
   (benchmark = `macroState.kospi20dReturn`). **둘 다 % 동일 단위 직접 차감** — `calcStage1Score`
   UNIVERSE_RS_GATE 와 동일 RS 정의(두 번째 공식 0). `RS ≥ 0` leader / `RS < 0` laggard,
   `rsAvg`/`rsMedian`(rsComputed 한정·0건 → null). 벤치마크 null → RS 전건 skip(rsComputedCount=0,
   avg/median null) — 결손 ≠ 0 (불변식 #6).
3. **시총 tier** — `listedShares × price`(가능 시) → `LARGE ≥ 3조` / `MID ≥ 1조` / `SMALL`.
   `listedShares` 결손/비유한 또는 price ≤ 0 종목은 `skippedCount` 만 증가(**가짜 시총 0**, 불변식 #6).
   `computedCount = 0`(전원 불가) → `marketCapTierDist = null`(SKIP).
4. **topLaggardCodes** — RS 산출 가능 후보를 RS 오름차순 → 하위 N(=5) 종목코드(진단 표시용).

### 타입 (HANDOFF (a))

`UniverseCompositionBiasObservation` (per-scan summary, additive optional 후보 stamp 아님):
`{ scanDateKey, totalCandidates, kospiCount, kosdaqCount, otherCount, rsComputedCount,
leaderCount, laggardCount, rsAvg|null, rsMedian|null, benchmarkReturn20d|null,
marketCapTierDist{large/mid/small/computed/skippedCount}|null, topLaggardCodes[]{code,rs},
executionImpact:'NONE', observationOnly:true }`.
ledger row = observation + `appendedAt`(ISO).

### 영속 (ledger 채택)

ADR-0614 패턴(atomic write tmp→rename + rolling FIFO `UNIVERSE_COMPOSITION_BIAS_WINDOW_SCANS`=60 +
손상 JSON → 빈 배열 fallback + scanDateKey upsert last-write-wins). 단, **단일 배열 ledger**
(per-stock Record 가 아닌 per-scan row 배열). `paths.ts UNIVERSE_COMPOSITION_BIAS_LEDGER_FILE` 1줄
(consecutive-netbuy[0614]·gate2-sox[0605]·투자자흐름 cache 와 물리 분리, ADR-0445).
ADR-0615 의 "ledger 불필요" 와 분기: 본 산출물(per-scan 구성 비율)은 영속 소스에 derived 미존재이고
디버전스 장 편향 추세 관측에 시계열 누적이 필수다.

### Stamp 지점

`universeScanner.ts` `stage3AIScreenAndRegister` Stage3 컨플루언스 루프 **이후 1회**
(per-candidate 아님 — aggregate). ADR-0614 per-stock append 루프 종료 직후. benchmark 는
동 스코프 `macroState.kospi20dReturn` 재사용. flag OFF → 진입 자체 skip(byte-identical).
try/catch 격리(불변식 #1 — 관측 실패 시 scan 본체 보호).

### ENV

`UNIVERSE_COMPOSITION_BIAS_OBSERVATION_ENABLED === 'true'` default OFF(ADR-0157, opt-in 영속 I/O).
SSOT `isUniverseCompositionBiasObservationEnabled()`.

## Consequences

- executionImpact: OFF = NONE byte-equivalent(KIS/KRX/Yahoo quota 0) / ON = per-scan aggregate
  산출 + ledger append + 순수 산출(발굴·Gate 무배선).
- providerImpact: 신규 fetch 0(`getStockByCode` 로컬 마스터 + 이미 fetch 된 후보 quote read only).
- L1(market·listedShares) source 이나 본 단계 매매 결정 직접 사용 아님(불변식 #7).
- 9대 불변식 #1(try/catch 격리·Trading Engine 무중단) / #6(결손 ≠ 0·가짜 시총 금지·벤치마크 null skip) /
  #7(L1 관측 누적이나 직접 매매 결정 0) 보존.
- 후속 승격(별도 ADR): 누적 추세로 발굴 편향 정량 확인 후 발굴 필터/정렬/Stage1 점수 교정.

## Alternatives Considered

- (a) 발굴 필터/정렬 직접 교정 — **기각**. 미검증 즉시 발굴 영향 + 운영자 "관측 먼저" 결정 위반.
- (b) per-candidate stamp — **기각**. 구성 편향은 집합 속성이므로 per-scan aggregate 가 정직.
- (c) 두 번째 RS 공식 신설 — **기각**. `calcStage1Score` RS 정의 재사용(single 통로).
- (d) listedShares 결손 시 가짜 시총/0 대체 — **기각**. 불변식 #6(결손 ≠ 0).
- (e) ledger 없이 ScanSummary stamp 만 — **기각**. 디버전스 추세 관측 = 시계열 누적 필요.
- (f) patch type — **기각**. 신규 관측 ledger + 개념 = ADR 의무.
- (g) default ON — **기각**. opt-in(영속 I/O).

## References

- ARCHITECTURE.md — `server/screener/universeCompositionBiasObservationAdr0616.ts` 경계 1행.
- `server/screener/universeCompositionBiasObservationAdr0616.ts` (Phase 0 scaffold — 타입·시그니처·산출식).
- `server/persistence/paths.ts` — `UNIVERSE_COMPOSITION_BIAS_LEDGER_FILE`.
- `server/persistence/krxStockMasterRepo.ts` — `getStockByCode` / `StockMasterEntry.market` / `.listedShares`.
- `server/screener/pipelineHelpers.ts` — `CandidateStock` / `calcStage1Score` RS 정의.
- ADR-0614 `consecutiveNetBuyLedgerAdr0614.ts` — ledger atomic/FIFO/손상 fallback 패턴 선례.
