# ADR-0615 — News-Lag Entry Window Observation (뉴스시차 진입윈도우 관측 전용 stamp)

- Status: Proposed (Phase 0 — 경계·타입·ADR. default OFF byte-equivalent. 구현은 engine-dev 인계.)
- Date: 2026-06-16
- Domain: News-lag learning surfacing → candidate selection observation (관측 전용, 실행 비배선)
- 계보: ADR-0007 (learning feedback loop — newsLagBayesian 유지 정책) / ADR-0614
  (consecutive-netbuy observation ledger — 직전 관측 piggyback 패턴) / ADR-0561 (KIS Primary) /
  ADR-0157 (ENV flag default OFF 정확비교) / ADR-0416·0421 (semantic availability·결손≠신호)

---

## Context

`newsLagBayesian.ts` 는 (newsType × sector) 조합별 lag posterior(Normal-Inverse-Gamma)를
학습·영속한다. `newsSupplyLogger.trackPendingRecords()` 의 T+5 결산이 자동으로
`recordLagObservation()` 을 트리거해 "A유형 뉴스 → B섹터 평균 T+Xd 후 반응" 분포가
자가 정밀화된다. 그러나 그 산출물 `getOptimalEntryWindow(newsType, sector)`
(newsLagBayesian.ts:191 — meanLagDays/stdDays/ci95Low·High/sampleSize, n<3 → null) 은
현재 **dead** — `/news_patterns` 텔레그램 카탈로그 표시 1곳만 소비하고, 종목 선정·진입
타이밍 경로 호출은 **0건**(grep 확인). 즉 학습된 알파가 의사결정에 닿지 않는다.

이 학습 신호를 **후보 선정 시점**에 surface 한다: 각 후보의 sector 에 대해 (a) 현재 활성
뉴스(미완료 record) × (b) 학습된 lag posterior 를 조인해, "이 후보의 섹터가 지금 학습된
반응 윈도우 안에 있는가"를 PRE/IN/PAST 로 분류·stamp 한다. 아직 Gate score·주문에는
배선하지 않는 **관측 전용 하네스**로 시작한다. 근거:

1. 실측(분류 분포 × forward outcome)이 없는 상태에서 진입 레버 임계를 정할 수 없다.
2. 신규 fetch 0 제약: `loadNewsSupplyRecords()`·`getOptimalEntryWindow()` 는 로컬 영속
   read only — KIS/KRX/Yahoo 호출 0(ADR-0561 quota 정합).
3. ADR-0614 가 확립한 "스캔 piggyback 관측 → 실측 후 별도 ADR 승격" 패턴과 동형.

### 핵심 조인 blocker (audit) 와 정직한 우회

`newsSupplyLogger` 는 종목이 아니라 **(newsType × sector)** 단위로 기록한다
(`NewsSupplyRecord{sector, newsType, detectedAt, isComplete, ...}`,
newsSupplyLogger.ts:38). `universeScanner` 후보(`CandidateStock`,
pipelineHelpers.ts:46)는 per-stock `newsType` 을 보유하지 않는다. 따라서 per-stock newsType
귀속은 본 ADR 범위 밖이며, **sector 단위 조인**으로 정직하게 우회한다:
`candidate.sector ↔ newsSupplyRecord.sector`. (`computeEtfSectorBoost` 가 `c.sector` 를
쓰는 선례와 동형 — globalScanAgent / universeScanner.ts:483·567.) per-stock newsType
귀속(같은 sector 안에서도 종목별 노출 차등)은 **후속 ADR**.

## Decision

스캔 후보 선정 직전에, 이미 영속된 두 학습 소스만 조인해 후보별 진입 윈도우 관측을
산출·stamp 하는 관측 전용 모듈을 신설한다. 신규 fetch 0, KIS/KRX quota 0, Gate score·주문
미배선. OFF default byte-equivalent.

### 1. 신규 순수 모듈 (로직 집약 — 복잡도 가드)

- 신규 모듈: `server/learning/newsLagEntryWindowObservationAdr0615.ts`
  (newsLag/newsSupply 와 동일 도메인 거주 — 두 export 만 import. 로직 전부 본 모듈 집약 →
  `universeScanner.ts` 증분은 import 1줄 + flag-gated 호출 블록만, ≤1500 한계 보호.)
- single 통로: `loadNewsSupplyRecords()`·`getOptimalEntryWindow(newsType, sector)` 기존
  export 만 경유 — 내부 store(posteriorStore / NEWS_SUPPLY_FILE) 직접 접근 금지.

### 2. 타입 (관측 stamp)

```
type NewsLagWindowStatus = 'PRE' | 'IN' | 'PAST';

NewsLagMatchedRecord {
  newsType: string;        // record.newsType (sector 동일 조인)
  detectedAt: string;      // ISO — 경과 기준점
  elapsedDays: number;     // businessDaysElapsed(detectedAt, now)
  meanLagDays: number;     // posterior μ
  ci95LowDays: number;     // posterior ci95 하한 (분류 경계)
  ci95HighDays: number;    // posterior ci95 상한 (분류 경계)
  sampleSize: number;      // posterior effectiveN (n≥3 보장)
  windowStatus: NewsLagWindowStatus;
}

NewsLagEntryWindowObservation {
  sector: string;
  matchedRecords: NewsLagMatchedRecord[]; // sector 일치 + 미완료 + n≥3
  bestStatus: NewsLagWindowStatus | null; // IN > PRE > PAST > null
  executionImpact: 'NONE';   // literal 강제
  observationOnly: true;     // literal 강제
}
```

후보 stamp = `CandidateStock.newsLagEntryWindow?: NewsLagEntryWindowObservation`
(pipelineHelpers.ts:46 에 additive optional 1필드 추가, 후방호환).

### 3. 분류 임계 (확정 — μ±σ vs ci95 → **ci95 채택**)

`getOptimalEntryWindow` 가 **이미** `ci95LowDays`/`ci95HighDays`
(= μ ± 1.96·std, newsLagBayesian.ts:209-210) 를 노출한다. 분류는 이 ci95 를 그대로 사용:

```
elapsed < ci95Low            → 'PRE'   (반응 시작 전 — 선제 관심)
ci95Low ≤ elapsed ≤ ci95High → 'IN'    (반응 윈도우 내부 — 핵심 관측)
elapsed > ci95High           → 'PAST'  (반응 윈도우 경과)
```

ci95 채택 근거: (a) posterior 의 정직한 불확실성 구간이고, (b) **추가 산식·재노출 0**
(μ±σ 는 std 재가공·새 경계 정의가 필요 — 두 번째 공식 위험). ci95 는 SSOT 단일.
elapsed 계산 `businessDaysElapsed(detectedAt, now)` 는 `now` 주입(default new Date()) —
**테스트 결정성**. (newsSupplyLogger.ts:69-81 의 private businessDaysElapsed 와 byte-동일
정의를 본 모듈에 복제 — 그 함수는 export 0. 회귀 테스트로 정의 drift 고정.)

graceful skip(불변식 #6 결손≠신호):
- posterior null(n<3) → 매칭 제외.
- `detectedAt` 파싱 실패(NaN) → 매칭 제외.
- sector 매칭 record 0 → `matchedRecords:[]`, `bestStatus:null` (stamp 자체는 호출자 판단).

### 4. Stamp 지점 (파일:라인 확정)

`server/screener/universeScanner.ts` Stage 3 컨플루언스 재평가 루프
**`:696-719`** — `for (const c of candidates)`, ADR-0614 append 인접. 동일 후보 sector
중복 산출 회피 위해 **루프 진입 전 1회** `computeNewsLagEntryWindowBySector(sectors, records, now)`
(records = `loadNewsSupplyRecords()` 1회) → 루프 내 `Map.get(c.sector)` lookup + stamp:

```
const newsLagWindowEnabled = isNewsLagEntryWindowObservationEnabled();
const newsLagWindowBySector = newsLagWindowEnabled
  ? computeNewsLagEntryWindowBySector(
      candidates.map((c) => c.sector),
      loadActiveNewsSupplyRecordsForObservation(),  // 영속 read 1회, fetch 0
    )
  : null;
// ... 기존 for (const c of candidates) 루프 내 ...
if (newsLagWindowBySector) {
  try {
    const obs = newsLagWindowBySector.get(c.sector);
    if (obs) c.newsLagEntryWindow = obs;       // additive stamp
  } catch { /* SDS-ignore: 관측 stamp 실패 격리, scan 본체 보호 (불변식 #1) */ }
}
```

- flag OFF → `newsLagWindowBySector = null` → 산출·stamp 전부 no-op → byte-identical.
- try/catch 격리(불변식 #1) — stamp throw 가 scan 본체 차단 0.
- ScanSummary stamp(관측 가시화)는 additive optional 1필드로 충분:
  `newsLagEntryWindowObservationAdr0615?: { sectorsMatched: number;
  inWindowCount: number; preWindowCount: number; pastWindowCount: number;
  executionImpact: 'NONE' }`. Gate score 경로 미소비.

### 5. ledger 결정 — **신규 영속 ledger 불필요 (Phase 0)**

ADR-0614 와 달리 본 관측은 **신규 시계열을 누적하지 않는다**. 입력 데이터가 이미 두
영속 소스(`news-supply-records.json` 활성 record + `news-lag-posterior.json` posterior)에
존재하고, 산출물은 scan 시점 derived/transient 다. 따라서 신규 `paths.ts` 항목·신규
ledger 파일 **0**. 관측 surface 는 (a) 후보 stamp + (b) ScanSummary 집계 stamp 로 충분.

운영자 추세 관측(분류 분포의 시계열 추이)이 향후 필요하면 ADR-0614 패턴(paths.ts 1줄 +
별도 append 모듈)으로 **후속 ADR** 승격 — 본 ADR 은 byte-equivalent 표면을 최소화한다.

### 6. ENV flag

- `NEWS_LAG_ENTRY_WINDOW_OBSERVATION_ENABLED === 'true'` (정확 비교, default OFF, ADR-0157).
  OFF 시 산출·stamp 모두 no-op → byte-equivalent, 기존 scan 동작 0 변경.
- SSOT helper `isNewsLagEntryWindowObservationEnabled()` 신규 모듈 거주.
- 관측 전용 + 영속 read 증가(스캔당 newsSupply 1회)라 opt-in default OFF.

## Consequences

- **executionImpact: NONE** (OFF byte-equivalent / ON 에서도 후보 stamp + ScanSummary 집계 +
  순수 산출만 — Gate score / 주문 / autoTradeEngine / kisClient / SourceSnapshot /
  entryTimingSignal / computeEtfSectorBoost 본문 0줄).
- **providerImpact: 신규 fetch 0** — 로컬 영속 read only(loadNewsSupplyRecords ·
  getOptimalEntryWindow), KIS/KRX/Yahoo quota 0.
- **9대 불변식**: #1(stamp try/catch 격리·scan liveness 보호) · #6(posterior null·손상
  detectedAt·sector 미매칭 → graceful skip, providerIssue≠신호) · #7(학습 posterior 는
  매매 결정 직접 사용 아님 — 관측 stamp 한정) 보존.
- 데이터 신뢰등급: lag posterior 는 L1(KIS/KRX) T+5 결산에서 학습되나, 본 단계는 관측 —
  **매매 결정 직접 사용 아님**. stamp 에 `observationOnly: true`·`executionImpact: 'NONE'`
  literal 강제.
- **후속 승격(별도 ADR)**: (a) per-stock newsType 귀속(sector 조인 → 종목별 노출 차등)
  (b) IN_WINDOW 분류의 forward outcome 성숙 후 Gate1 score / SHADOW 진입 레버 승격.
  본 ADR 은 학습 신호를 선정 시점에 정직하게 노출하는 단계만.

## Alternatives Considered

1. **getOptimalEntryWindow 를 entryTimingSignal/Gate score 에 직접 배선** — 기각.
   실측 분류 분포·forward outcome 없이 진입 레버 임계 결정 불가(미검증 신호 즉시 실행
   영향 = 관측 전용 위반). 관측 stamp 선행이 정합.
2. **per-stock newsType 귀속을 본 ADR 에서 해결** — 기각. record 는 (newsType×sector)
   단위라 후보에 per-stock newsType 이 없음. 무리한 종목 귀속은 가짜 매칭 위험 →
   sector 조인으로 정직하게 우회하고 per-stock 은 후속 ADR.
3. **μ±σ 를 분류 경계로 사용** — 기각. `getOptimalEntryWindow` 가 ci95 를 이미 노출 →
   ci95 채택이 두 번째 공식·재노출 0. (μ±σ 는 std 재가공·새 경계 정의 필요.)
4. **신규 영속 ledger 누적** — 기각(Phase 0). 입력이 이미 두 영속 소스에 존재하고
   산출물은 derived/transient — 신규 ledger 는 무한증식 표면만 추가. 추세 관측 필요 시
   후속 ADR(ADR-0614 패턴)로 분리.
5. **ADR 없이 patch type 처리** — 기각. 신규 관측 신호 개념(진입 윈도우 분류)+신규 경계
   (newsLag×newsSupply 조인 관측 모듈)+신규 candidate stamp 필드는 ADR type 의무
   (CLAUDE.md §5 "신규 경계·정책은 ADR 발급").
6. **default ON** — 기각. 관측 전용이라도 영속 read 증가 + 미검증 분류이므로 opt-in
   default OFF 가 안전(ADR-0157 정합).

## References

- `server/learning/newsLagBayesian.ts:191` (getOptimalEntryWindow — meanLagDays/ci95/sampleSize, n<3→null) · `:216` (listAllOptimalWindows) · `:209-210` (ci95 산출)
- `server/learning/newsSupplyLogger.ts:38` (NewsSupplyRecord{sector,newsType,detectedAt,isComplete}) · `:69-81` (businessDaysElapsed private) · `:127` (loadNewsSupplyRecords)
- `server/screener/universeScanner.ts:696-719` (Stage3 컨플루언스 루프 — stamp 지점, ADR-0614 append 인접) · `:483·567` (computeEtfSectorBoost c.sector 선례)
- `server/screener/pipelineHelpers.ts:46` (CandidateStock — newsLagEntryWindow? stamp 위치)
- `server/learning/newsLagEntryWindowObservationAdr0615.ts` (신규 순수 모듈)
- ADR-0007 / ADR-0614 / ADR-0561 / ADR-0157 / ADR-0416 / ADR-0421
