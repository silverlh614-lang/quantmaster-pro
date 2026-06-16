# ADR-0614 — Consecutive Investor Net-Buy Observation Ledger (관측 전용 시계열 누적)

- Status: Proposed (Phase 0 — 경계·타입·ADR. default OFF byte-equivalent. 구현은 engine-dev 인계.)
- Date: 2026-06-16
- Domain: Gate1 supply / investor-flow observation (관측 전용, 실행 비배선)
- 계보: ADR-0477 (investor-flow provider router, SHADOW_ONLY) / ADR-0502 (KIS official
  investor-flow promotion, WEIGHTED 단계) / ADR-0445 (investor-flow ledger 물리 분리 패턴) /
  ADR-0476 (Gate1 dry-run observation ledger 패턴) / ADR-0561 (KIS Primary) / ADR-0157
  (ENV flag default OFF 정확비교) / ADR-0416·0421 (semantic availability)

---

## Context

외국인/기관 순매수 데이터는 L1(KRX/KIS)으로 수집되고, Gate1 조건 #1
`supply_confluence` (`server/quant/conditions/evaluators.ts:676-737`)가 이를 소비한다.
그러나 현행 평가는 **당일 동반 순매수**(`institutionalNetBuy>0 && foreignNetBuy>0`)만
판정한다. 즉, "연속 N영업일 순매수 / 누적 순매수 / 시총대비 비중" 같은 **시계열 신호는
현재 0건** — 매 스캔마다 단일 일자 스냅샷만 보고 버려진다.

이 시계열 누적을 신규 신호 개념으로 만들되, 아직 Gate 스코어링에 배선하지 않는
**관측 전용 하네스**로 시작한다. 그 근거:

1. investor flow 자체가 ADR-0477로 SHADOW_ONLY 정책 — 실측 누적 전 실행 비배선이 정합.
2. 실측 데이터(연속일 분포·forward outcome)가 없는 상태에서 임계/가중치를 정할 수 없다.
3. 신규 fetch 0 제약: 새 신호를 위해 KRX/KIS를 다시 두드리면 quota를 침범한다.

## Decision

스캔 시점에 이미 fetch 완료된 후보별 투자자 흐름(`c.kisFlow`)에 **piggyback**하여
종목별 일별 순매수를 **시계열 ledger에 append**하고, append된 window에서 연속/누적/
시총대비 신호를 **순수 계산**으로 산출하는 관측 전용 모듈을 신설한다. 신규 KRX/KIS 호출
0, KIS/KRX quota 0. ledger는 이미 가져온 값을 append만 한다.

### 1. 신규 영속 ledger 스키마 + 캡 정책

- 신규 모듈: `server/trading/signalScanner/consecutiveNetBuyLedgerAdr0614.ts`
- 신규 path: `paths.ts`에 `CONSECUTIVE_NETBUY_LEDGER_FILE =
  path.join(DATA_DIR, 'consecutive-netbuy-ledger-adr0614.json')` 1줄 추가.
  (기존 ledger와 **물리 분리** — `investor-flow-cache.json`·
  `krx-investor-flow-parser-diagnostics.json`·`gate1-dry-run-observation-ledger.json`과
  합치지 않음. ADR-0445 물리 분리 원칙.)
- 저장 단위 = 종목별 일별 1 row:

  ```
  ConsecutiveNetBuyLedgerRow {
    dateKey: string;            // 'YYYY-MM-DD' KST 거래일 (tradingDate 우선, 부재 시 todayKst)
    stockCode: string;          // 6자리 정규화
    foreignNetBuy: number;      // 외국인 당일 순매수 (이미 fetch된 값)
    institutionalNetBuy: number;// 기관 당일 순매수 (이미 fetch된 값)
    provider: string;           // 'KIS_API' | 'KRX_INVESTOR_FLOW' | 'CACHE' | ... (출처 보존)
    marketCap?: number | null;  // 가용 시만. 부재 시 omit/null (결손≠0, 불변식 #6)
    fetchedAt: string;          // ISO
    semanticStatus: string;     // 'OK' 만 기록 (semantic available 일 때만 append)
    executionImpact: 'NONE';    // literal 강제
    observationOnly: true;      // literal 강제
  }
  ```

  영속 shape = `Record<stockCode, ConsecutiveNetBuyLedgerRow[]>` (종목별 일자 정렬 배열).

- **캡 정책 (무한증식 방지) — per-stock rolling window**:
  - 종목당 최근 `CONSECUTIVE_NETBUY_WINDOW_DAYS` (기본 10영업일) row만 유지. FIFO trim
    (가장 오래된 dateKey부터 제거). `investorFlowCacheRepo.upsertInvestorFlowCache`의
    `slice(merged.length - MAX_DAYS)` 패턴 그대로 차용.
  - 종목 수 자체는 스캔 후보 풀로 자연 제한되나, 누적 종목 폭증 방어를 위해
    글로벌 종목 캡 `CONSECUTIVE_NETBUY_MAX_CODES` (기본 600) — 초과 시 가장 오래
    갱신 안 된 종목 entry부터 제거. (정확한 상수값은 engine-dev가 데이터량 관측 후 조정,
    본 ADR은 정책 형태만 확정.)

### 2. 연속 신호 산출 타입 (순수 계산, provider/now/fetch 0)

window(시간 정렬된 row 배열)를 입력받아 다음을 산출하는 순수 함수:

```
ConsecutiveNetBuySignal {
  stockCode: string;
  windowDays: number;                  // 평가에 쓰인 row 수
  consecutiveForeignDays: number;      // 최신일부터 foreignNetBuy>0 연속 일수
  consecutiveInstitutionDays: number;  // 최신일부터 institutionalNetBuy>0 연속 일수
  consecutiveBothDays: number;         // 둘 다 >0 동반 연속 일수
  cumulativeForeignNetBuy: number;     // window 합
  cumulativeInstitutionalNetBuy: number;
  cumulativeNetBuy: number;            // foreign+institution 합
  netBuyVsMarketCapPct: number | null; // 가용 시 (cumulativeNetBuy 추정금액 / marketCap)
                                       //   *100, marketCap 부재 시 null
  bothConsecutive: boolean;            // consecutiveBothDays >= 2
  asOfDateKey: string;
  executionImpact: 'NONE';
  observationOnly: true;
}
```

산출식 (확정):
- `consecutiveXDays` = 최신 dateKey부터 역순으로 해당 투자자 `netBuy > 0`이 깨지는 첫
  지점까지의 연속 카운트. `=== 0` 또는 `< 0`에서 중단. **결손일(row 부재 = 비거래일/
  미관측)은 연속을 깨지 않고 건너뛰지 않음** — window는 실제 append된 거래일 row만 담으므로
  연속은 "append된 인접 거래일 기준"으로 정의. (이 정의를 engine-dev 테스트로 고정.)
- `cumulative*` = window 내 단순 합.
- `netBuyVsMarketCapPct`: `cumulativeNetBuy`(주식 수량 기반)을 금액 추정하려면 가격이
  필요하므로, **marketCap과 단위가 정합되는 경우에만** 산출. 단위 불일치/marketCap
  부재 시 `null` (결손≠0). engine-dev가 단위 정합(주 수량 vs 금액)을 명시적으로 검증한
  뒤에만 비 산출. 정합 불가 시 본 필드는 영구 `null`로 두고 후속 ADR로 승격.

### 3. Append 지점 (파일:라인 확정)

`server/screener/universeScanner.ts` Stage 3 컨플루언스 재평가 루프
**`:689-699`** — `for (const c of candidates)`에서 각 후보 `c`가 이미
`c.kisFlow`(이번 스캔 fetch 완료)·`c.code`·`c.quote`·`c.dartFin`를 보유. 동일 루프 내
`runConfluenceEngine` 호출 **직후/인접**에서 append:

```
// ENV ON + semantic available 일 때만
if (isConsecutiveNetBuyObservationEnabled() && c.kisFlow) {
  appendConsecutiveNetBuyObservation({
    stockCode: c.code,
    kisFlow: c.kisFlow,           // 이미 fetch된 값 — 신규 호출 0
    tradingDate: c.kisFlow.tradingDate ?? todayKst(),
    marketCap: <가용 시>,          // 부재 시 null
    now,
  });  // try/catch 격리 — append throw 가 scan 본체 차단 0 (불변식 #1)
}
```

- semantic available 판정은 **반드시** `evaluateInvestorFlowSemanticAvailability`/
  `investorFlowSemanticAvailability` 경유 (single 통로, raw KRX 금지). `available=true`
  (status OK)일 때만 기록. 부재/DEGRADED/FIELD_MISSING → **미기록** (결손≠신호, 불변식 #6).
- **복잡도 가드**: 로직은 전부 신규 모듈 `consecutiveNetBuyLedgerAdr0614.ts`에 집약.
  call-site(`universeScanner.ts`) 증분은 import 1줄 + flag-gated 호출 블록(~6줄)만.
  `universeScanner.ts` 현재 줄 수가 1,500 한계에 근접하면 engine-dev는 append 호출을
  기존 Stage3 helper로 위임(call-site 1줄)하는 대안을 우선한다.
  (`persistScanResults.ts`는 본 경로에서 `kisFlow` 미소비 — grep 0 — 이므로 append
  지점이 아님. universeScanner Stage3가 정확한 piggyback 지점.)
- ScanSummary stamp(관측 가시화)는 additive optional 1필드
  (`consecutiveNetBuyObservationAdr0614?: { stocksAppended; bothConsecutiveCount;
  executionImpact: 'NONE' }`)로 충분. Gate score 경로 미소비.

### 4. dedup / idempotency

- 동일 `dateKey × stockCode` 재기록 = **upsert (last-write-wins)**.
  근거: 같은 거래일 재스캔 시 더 최신 fetch 값이 더 정확(장중 누적 증가). 재시작/재스캔
  안전. `investorFlowCacheRepo.upsertInvestorFlowCache`의 `byDate Map` 패턴 그대로.
- atomic write (tmp → rename), 손상 JSON 빈 객체 fallback (기존 repo 패턴 차용).

### 5. ENV flag

- `CONSECUTIVE_NETBUY_OBSERVATION_ENABLED === 'true'` (정확 비교, default OFF, ADR-0157).
  OFF 시 append/산출 모두 no-op → byte-equivalent, 기존 scan 동작 0 변경.
- SSOT helper `isConsecutiveNetBuyObservationEnabled()`는 신규 모듈에 거주.
- 관측 전용이므로 OFF default — 운영자가 누적 시작을 명시적으로 켠다(quota 0이지만
  영속 I/O 증가가 있으므로 opt-in).

## Consequences

- **executionImpact: NONE** (OFF byte-equivalent / ON에서도 ledger append + ScanSummary
  stamp + 순수 산출만 — Gate score/주문/autoTradeEngine/kisClient 0줄).
- **providerImpact: 신규 fetch 0** — `c.kisFlow` piggyback, KIS/KRX quota 0.
- 데이터 신뢰등급: L1(KRX/KIS) source이나 본 단계는 관측 — **매매 결정 직접 사용 아님**
  (불변식 #7 정합, AI_ESTIMATED 무관). ledger row에 `observationOnly: true` 강제.
- 후속 승격(별도 ADR): 실측 window 분포 + forward outcome 성숙 후 연속/누적 신호를
  Gate1 score 또는 SHADOW 진입 레버로 승격. 본 ADR은 그 입력 데이터를 모으는 단계만.
- `netBuyVsMarketCapPct`는 단위 정합이 검증되기 전까지 `null` — 비 산출을 강제로 채우지
  않는다(가짜 비율 금지).

## Alternatives Considered

1. **supply_confluence 본문에 연속 판정 직접 추가** — 기각. (a) 평가자는 단일 SourceSnapshot
   일자 스냅샷만 보는 순수 함수여야 하고, (b) 시계열 영속 부작용을 evaluator에 넣으면
   책임 혼재 + 즉시 Gate score 영향(관측 전용 위반). 별도 ledger 모듈로 분리.
2. **별도 fetch로 N일치 일괄 조회** — 기각. KRX/KIS quota 침범, ADR-0561/quota 정책 위반.
   piggyback이 quota 0 유일 경로.
3. **기존 `investor-flow-cache.json`에 누적** — 기각. cache는 단일 last-good sample 용도
   (7일 cap)이고 router fallback 입력이라, 관측 시계열을 섞으면 cache 의미 오염 +
   ADR-0445 물리 분리 원칙 위반.
4. **ADR 없이 patch type 처리** — 기각. 신규 영속 ledger + 신규 신호 개념(연속/누적) +
   신규 경계(시계열 관측 모듈)는 ADR type 의무(CLAUDE.md §5 "신규 경계·정책은 ADR 발급").
5. **default ON** — 기각. 관측 전용이라도 영속 I/O 증가 + 미검증 신호이므로 opt-in default
   OFF가 안전(ADR-0157 정합).

## References

- `server/quant/conditions/evaluators.ts:676-737` (supply_confluence 현행)
- `server/screener/universeScanner.ts:689-699` (append piggyback 지점)
- `server/supply/investorFlowRouter.ts` / `investorFlowSemanticAvailability.ts` (single 통로)
- `server/persistence/investorFlowCacheRepo.ts` (upsert/rolling window 패턴)
- `server/trading/signalScanner/gate1DryRunObservationLedgerAdr0476.ts` (관측 ledger 패턴)
- ADR-0477 / ADR-0502 / ADR-0445 / ADR-0561 / ADR-0157 / ADR-0416 / ADR-0421
