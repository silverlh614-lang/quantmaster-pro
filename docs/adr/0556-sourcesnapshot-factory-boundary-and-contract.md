# ADR-0556: SourceSnapshot Factory Boundary & Contract (P2 선행 계약)

@responsibility governance — SourceSnapshot factory 배치 경계 + 입출력 계약 + freshness/ADR-0011/quota 불변 계약 확정 (P2 구현 선행, 문서 전용)

## Status

Accepted (문서/계약 전용 — factory 런타임 구현은 후속 engine-dev P2 묶음0~6)

## Context

ADR-0555(헌법) 의 로드맵 P2 = "`UnifiedSourceSnapshot` factory 구현 + 프로덕션 배선" 은 **별도 ADR**
선행을 요구한다(ADR-0555 §Roadmap P2 행). 본 ADR 이 그 선행 계약이다. 코드는 구현하지 않으며,
engine-dev 가 묶음0(factory skeleton) 부터 착수할 수 있도록 **배치 경계 + 입출력 계약 + 불변식
보존 규칙** 만 확정한다.

### 블루프린트 결론 요약 (engine-dev wiring-blueprint, 2026-06-03)

- **입력측:** factory 가 새로 fetch 할 것은 **0개**. 11개 snapshot 필드 전부 기존 단일 통로 함수가
  이미 존재한다(quote/technicals/supply/fundamentals/macro/sectorEnergy/providerHealth …).
  factory 의 신규 책임은 (1) 오케스트레이션 (2) raw→normalized 정규화 (3) **필드별
  freshness/providerHealth 통합 산출** 3가지뿐 → 네트워크 0줄 신규, 불변식 9 무위반.
- **출력측:** SourceSnapshot 을 우회해 provider/store 를 직접 보는 소비 callsite 총 11건
  (V1a/b/c·V3·V3b·V2·V5a/b·V6·V7). engine-dev 직접 편집 9건, UI(V6)·Gate2 본체(V7) 2건은 협의.
- **이행:** 묶음0(skeleton) + 묶음1~6(byte-equivalent 우선·회귀 위험 오름차순) + 보류 1(V6 UI·V7).

### 드리프트 진단 — "두 개(사실상 세 개)의 factory 아티팩트"

본 ADR 이 가장 먼저 해소해야 할 드리프트는 **`UnifiedSourceSnapshot` 라는 이름의 타입이 두 곳에
서로 다른 형태로 존재**한다는 것이다. 블루프린트가 "factory 미구현" 으로 본 것은 사실은 **잘못된
파일을 factory 후보로 지목**한 결과다.

| 아티팩트 | 위치 | 타입 형태 | factory/flag 실재성 |
|---|---|---|---|
| **A (ADR-0519 정본)** | `server/trading/sourceSnapshot/unifiedSourceSnapshot.ts` + `symbolSnapshotData.ts` + `server/trading/symbolDataCollector.ts` | `perSymbol: Record<string, SymbolSnapshotData>` (KIS 4-EP 원시 + 파생) | **실재** — `SymbolDataCollector` factory + `USE_UNIFIED_SOURCE_SNAPSHOT` flag + `generateSnapshotId()` + DART 슬롯(ADR-0529) 일부 배선 |
| **B (gate/policy projection)** | `src/services/autoTrading/ssotPipeline.ts` | `featuresBySymbol: Record<string, FeatureSnapshot>` (gate1/2/3 status + policy) | **타입만** — factory 없음. `evaluateCommonGate`/`resolvePolicy` 순수 투영 함수만 존재 |

블루프린트(§D-1)는 B(`ssotPipeline.ts`)를 factory 후보로 보고 "server 로 이전(`server/snapshot/
sourceSnapshotFactory.ts` 신설)" 을 권고했다. 그러나 **A 가 이미 ADR-0519 의 server-side factory 정본**
이다. B 의 `UnifiedSourceSnapshot` 은 동명이인일 뿐 — A 의 *수집 컨테이너* 와 달리 B 는 *gate/policy
투영 결과* 다(책임이 다름). 따라서:

- **새 factory(`server/snapshot/sourceSnapshotFactory.ts`)를 신설하면 A·B 에 이은 세 번째 아티팩트**
  가 되어 ADR-0555 §0("두 번째 SSOT 신설 금지") 를 정면 위반한다.
- 옳은 처방은 **A(ADR-0519 collector)를 factory 로 *확장*(complete)** 하고, B(`ssotPipeline.ts`)는
  A 의 perSymbol 을 입력으로 받는 **gate/policy projection 레이어로 책임 재확인**(병합·이동 없음)
  하는 것이다.

## Decision

### D1. Factory 배치 경계 — 기존 ADR-0519 collector 확장 (신규 파일 신설 기각)

**결정: `server/trading/symbolDataCollector.ts` 를 SourceSnapshot factory 로 확장한다.
신규 `server/snapshot/sourceSnapshotFactory.ts` 는 신설하지 않는다.**

근거:
1. **헌법 정합(ADR-0555 §0).** A 가 이미 server-side factory 정본(flag + collector + snapshotId +
   DART 슬롯 일부 배선)이다. 신규 파일은 세 번째 아티팩트 = 두 번째/세 번째 SSOT → 단일성 파괴.
2. **경계 정합(블루프린트 §D-1 의 핵심 관찰은 유효).** "src 는 server fetch 를 import 불가" 는 맞다 —
   그래서 factory 는 server 에 있어야 한다. A 는 *이미 server* 에 있으므로 이전 불필요. 블루프린트의
   "server 로 이전" 권고는 *방향은 맞으나 대상이 틀렸다*(B 이전이 아니라 A 확장).
3. **byte-equivalent.** A 는 `USE_UNIFIED_SOURCE_SNAPSHOT` flag 뒤에 격리되어 있어 확장 시 OFF 경로
   100% 유지(불변식 1·2). 신규 파일은 격리 인프라를 다시 만들어야 해 회귀 위험 순증.

**B(`ssotPipeline.ts`)의 책임 재확인:** B 는 *factory 가 아니다*. B 는 A 의 `perSymbol` 을 입력으로
받아 gate(common)·policy 결과를 산출하는 **순수 투영(projection) 레이어** 다(`evaluateCommonGate`/
`resolvePolicy`). B 의 `UnifiedSourceSnapshot`/`FeatureSnapshot` 은 **A 의 정본 컨테이너와 혼동되지
않도록 향후 리네이밍 권고**(예: `GatePolicyProjectionInput`/`FeatureProjection`) — 단 본 ADR 단계에서는
**behavior change 0** 원칙상 *타입 리네이밍을 강제하지 않고* ARCHITECTURE.md 경계 문구로만 책임을
분리 명시한다(리네이밍은 P2 묶음 내 별도 byte-equivalent 패치 또는 후속 ADR).

> 모듈 지도 (확정):
> ```
> server/trading/
>   symbolDataCollector.ts          ← [확장] SourceSnapshot factory 본체 (오케스트레이션·정규화·freshness 통합)
>   sourceSnapshot/
>     unifiedSourceSnapshot.ts      ← [SSOT, ADR-0519] 컨테이너 타입 + snapshotId (factory 출력 타입)
>     symbolSnapshotData.ts         ← [SSOT, ADR-0519/0529] perSymbol 단위 타입 (KIS 4-EP + DART 슬롯)
>     sourceSnapshotDataHealth.ts   ← [freshness SSOT 보조] quote/ohlcv/technical status 분류
> src/services/autoTrading/
>   ssotPipeline.ts                 ← [projection, 재확인] perSymbol → gate/policy 순수 투영 (factory 아님)
> ```

### D2. Freshness enum 통일 — 기존 enum 재사용, 신규 enum 신설 금지

**결정: factory 의 필드별 freshness 는 기존 enum 만 사용한다. 신규 통합 enum 을 신설하지 않는다.**

ADR-0555 §0 "두 번째 SSOT 신설 금지" 의 직접 적용. freshness 의미는 도메인별로 이미 존재한다:

| 도메인 | freshness/health SSOT enum | 위치 |
|---|---|---|
| supply(투자자/프로그램 수급) | `SymbolSupplySignal.providerHealth: 'VERIFIED'|'DEGRADED'|'STALE'|'MISSING'` | `symbolSnapshotData.ts:105` |
| 종목 수집 완성도 | `SymbolDataQuality: 'FULL'|'PARTIAL'|'MINIMAL'|'MISSING'` | `symbolSnapshotData.ts:36` |
| quote/ohlcv/technical | `SourceSnapshotDataHealth.*.status` (`VERIFIED/NOT_FETCHED/MISSING/STALE/…`) | `sourceSnapshotDataHealth.ts:23` |
| DART 재무(L2 분기) | `SymbolDartCadence: 'QUARTERLY_CACHED'|'MISSING'` + `Gate2FinancialConfidence` | `symbolSnapshotData.ts:117` |
| 통합 표시/shadow case | `DataHealth: 'VERIFIED'|'DEGRADED'|'STALE'|'MISSING'|'AI_ESTIMATED'|'UNKNOWN'` | `src/types/shadowCase.ts:29` |

**규칙:**
- factory 가 **per-field freshness 의 외부 표시/요약 등급** 이 필요할 때는 `DataHealth`
  (`shadowCase.ts:29`)를 **공통 어휘 SSOT** 로 채택한다 — 이미 `VERIFIED/DEGRADED/STALE/MISSING/
  AI_ESTIMATED/UNKNOWN` 6등급으로 모든 도메인을 표현 가능하고, `AI_ESTIMATED` 등급이 L4 격리
  (불변식 7)를 내장한다.
- 각 *도메인 내부* 신선도는 해당 도메인 enum(`providerHealth`/`SymbolDataQuality`/`SymbolDartCadence`)
  을 그대로 유지하고, 통합 표시 시 `DataHealth` 로 *매핑* 한다(신규 enum 0).
- L2(DART 분기 cadence)가 L1(KIS intraday) 신선도로 오인되지 않도록 `cadence` 메타는 보존한다
  (ADR-0529 계약 승계).

### D3. ADR-0011 데이터 경로 분리 보존 — factory 는 자동매매/서버스캔 경로 전용

**결정: SourceSnapshot factory 는 자동매매·서버 스크리너 경로(KIS/KRX, L1/L2) 데이터만 채운다.
AI 추천 universe(MOMENTUM/QUANT_SCREEN/BEAR_SCREEN/EARLY_DETECT, Google CSE/Yahoo, L3/L4)는
factory 에 *섞지 않는다*.**

규칙(ADR-0011 + CLAUDE.md §2.2-3 승계):
- factory(`symbolDataCollector.ts`)는 `aiUniverseService` 를 **import 하지 않는다**(역방향 금지 유지).
- `screenedCandidates` 입력은 자동매매/서버 스캔 경로(`stockService`/server 스크리너)에서만 유입된다.
- AI 추천 universe 가 factory 출력을 소비할 수는 있으나(read-only), AI 추천 데이터(L3/L4)가
  `SymbolSnapshotData`(L1/L2 전용 컨테이너) 에 역류하지 않는다 — `symbolSnapshotData.ts:14`
  "L4(AI_ESTIMATED) 데이터는 이 컨테이너에 포함하지 않는다" 계약 승계(불변식 7).
- 결과: factory 는 **단일 신뢰등급 경계(L1/L2)** 컨테이너만 생산. AI 추천 발굴은 별도 통로 유지.

### D4. Provider 장애 시 불변식 보존 계약 — throw 금지·필드 격리

**결정: factory 는 어떤 필드를 못 채워도 throw 하지 않고, 해당 필드만 `freshness=STALE|MISSING +
providerIssue` 로 격리한 채 항상 snapshot 객체를 반환한다(불변식 1·2·4·5·6).**

- **필드 격리 패턴(블루프린트 §C):** factory 는 `Promise.allSettled` 기반(이미
  `symbolDataCollector.ts:54 mapLimit` 존재)으로 한 필드/한 종목 실패가 전체를 죽이지 않게 한다.
  실패 필드는 `value=null` + 해당 도메인 freshness enum 의 `STALE`/`MISSING` 으로 표기.
- **providerIssue ≠ marketSignal(불변식 6):** provider 장애를 약세 신호로 변환 금지.
  `executionPermissionResolver.ts:208 providerIssueIsolated` 패턴을 factory 출력에 보존 —
  providerHealth 메타는 데이터이지 시장 신호가 아니다.
- **필드별 필수/optional + fallback 등급(L1→L3→L4 참조전용):** 아래 §Factory 입출력 계약 표 참조.
  핵심: `quote` 만 *필수*(없으면 `SymbolDataQuality='MISSING'`, Gate 소비 불가), 나머지는 모두
  optional(없어도 snapshot 반환·해당 필드만 격리). L4(AI_ESTIMATED) fallback 은 **참조 전용** —
  live 매매 결정에 사용 금지(불변식 7).

### D5. KIS quota 계약 — per-scan quota 순증 0 (불변)

**결정: factory 는 기존 단일통로 fetch 만 오케스트레이션한다. 신규 fetch 0, per-scan KIS/KRX quota
순증 0 을 본 ADR 불변으로 고정한다.**

- 블루프린트 §A 결론(신규 fetch 0개) 을 계약화. factory 1회 스캔 호출수 = 기존 universeScanner
  Stage2 호출수와 동일(byte-equivalent) — 필드를 *새로 fetch* 하는 것이 아니라 *기존 fetch 를 한
  곳으로 모으는* 것이다.
- 묶음 4·6(fallback/ranking 경로 흡수) 에서 **중복 호출 dedup 보장** 필수 —
  `getKisChartCooldownRemainingMs`(http.ts:439) 쿨다운 가드를 존중한다.
- 각 묶음 PR 은 ADR-0146 자가 review 5 카테고리 중 (1) KIS/KRX quota 0 침범을 명시 검증한다.

### Factory 입출력 계약 표

> 입력 fetch 함수는 모두 **기존** 단일 통로(신규 0). freshness 산출 = factory 신규 책임.

| snapshot 필드 | 입력 fetch 함수 (단일 통로) | 필수 여부 | 결측 fallback(등급) | freshness 산출 enum |
|---|---|---|---|---|
| `quote` (현재가·전일종가·거래량·등락률) | `kisClient/query.ts:1331 fetchKisStockFullQuote` (FHKST01010100) | **필수** | 없음 → `SymbolDataQuality='MISSING'`(Gate 소비 불가) | `SourceSnapshotDataHealth.quote.status` (VERIFIED/DEGRADED/MISSING) |
| `quote.valuation` (per/eps/listedShares) | `fetchKisStockFullQuote` 동일 응답 | optional | null(Gate2 PER dedup 유지) | quote 와 동일(동봉) |
| `technicalIndicators` (MA/RS/모멘텀) | `query.ts:1380 fetchKisStockDailyBars` (FHKST03010100) → 순수 계산 | optional | null → 지표 status `MISSING`, Gate2 `DATA_INCOMPLETE` | `SourceSnapshotDataHealth.technicalIndicators.status` |
| `dailyBars` (OHLCV 60일) | `fetchKisStockDailyBars` | optional | `[]` → `ohlcvDaily.status='NOT_FETCHED'` | `SourceSnapshotDataHealth.ohlcvDaily.status` |
| `supplySignal` (투자자별 순매수) | `query.ts:901 fetchKisInvestorTradeByStockDaily` (FHPTJ04160001) | optional | label `UNKNOWN` + `providerHealth='MISSING'` | `SymbolSupplySignal.providerHealth` |
| `supply.marketProgram` (프로그램 순매수) | `query.ts:474 fetchKisMarketProgramTrade` / `:369 stock` (V3 흡수) | optional | null + `providerHealth='STALE'`(캐시) | `SymbolSupplySignal.providerHealth` |
| `dartFinancials` (DART 재무, L2) | `gate2DartCanonicalSlot.ts buildSymbolDartFinancialsSlot` (cache-first, ADR-0529) | optional | slot null/`cadence='MISSING'` → Gate fallback | `SymbolDartCadence` + `Gate2FinancialConfidence` |
| `macroContext.regime` (FRED/ECOS regime) | `macroIndexEngine` → `loadMacroState()` (시점 복사) | optional | `macroStateUpdatedAt=null`(stale carry) | `DataHealth` 매핑(STALE 시) |
| `sectorEnergy` | `sectorEnergyVerifiedSnapshotRepo` 우선 / `query.ts:608 fetchKisSectorIndexDaily` 보조 | optional | last-known verified(ADR-0545) | `DataHealth` 매핑 |
| `providerHealth` (메타) | 각 fetch 의 성공/실패/empty/stale 집계 + `getGate2DartProviderHealth` | optional | `providerIssue=true`, marketSignal 비변환(불변식 6) | `DataHealth`(per-domain) |
| `dataQuality` (종목 수집 완성도) | 위 필드 집계 (factory 산출) | 산출 | `MISSING`(quote 부재 시) | `SymbolDataQuality` |

> **AI_ESTIMATED(L4) fallback 은 모든 필드에서 *참조 전용*** — `SymbolSnapshotData` 컨테이너 미포함,
> live 매매 결정 금지(불변식 7, `symbolSnapshotData.ts:14` 계약).

### Roadmap 연결 (P2 구현 = engine-dev)

본 ADR 확정 후 engine-dev 가 블루프린트 §C 묶음 순서로 구현한다:

| 묶음 | 대상 | executionImpact | 비고 |
|---|---|---|---|
| **0 (skeleton)** | `symbolDataCollector.ts` factory 필드별 `{value, freshness, providerIssue}` 래퍼 + 격리 패턴 | NONE(flag OFF 신설) | **선행 필수.** 한 fetch 실패 시 해당 필드만 STALE 회귀 잠금(불변식 1·6) |
| 1 | V2 `dartProviderSignalSplit.ts:29` mixed 제거 | NONE | byte-equivalent, 가장 안전 |
| 2 | V5a/b Telegram projection 강등 | NONE | 표시 전용(ADR-0526 재계산 금지) |
| 3 | V3b read-site 교체 | NONE | 묶음4 선행 |
| 4 | V3 marketProgramFlowProvider factory 흡수 | 간접(supply→Gate) | byte-equivalent 검증 필수 |
| 5 | V1b/c universeScanner Stage2 quote/supply snapshot 입력화 | 간접(Gate1/2 입력) | 후보집합 동일성 회귀 잠금 |
| **6** | V1a universeScanner Stage1 ranking snapshot화 | **직접(발굴 풀 변경 가능)** | **별도 ADR + shadow A/B 분리** — byte-equivalent 불가 시 승격 금지 |
| 보류 | V6(`useGlobalIntelStore.macroEnv` UI), V7(Gate2 본체 read 일원화) | — | V6=dashboard-dev, V7=별건 ADR |

> **묶음 6 분리 원칙:** Stage1 ranking 의 snapshot화는 universe 발굴 근원을 바꿔 executionImpact 가
> *직접* 이다. 본 ADR 의 byte-equivalent 보장 범위 밖 — **별도 ADR 발급 + shadow 모드 A/B 비교**
> (발굴 풀 동일성 검증) 후에만 live 승격. 묶음0~5 와 동일 PR 에 묶지 않는다.

## Consequences

- **계약 공개.** engine-dev 가 묶음0(skeleton) 부터 착수 가능 — factory 배치(=기존 collector 확장),
  입출력 11필드 계약, freshness enum(기존 재사용), 불변식 격리 패턴, quota 0 계약이 모두 pin 됨.
- **드리프트 정리.** "factory 미구현" 오진을 정정 — A(ADR-0519 collector)가 정본이고, B(ssotPipeline)
  는 projection 레이어임을 ARCHITECTURE.md 에 명문화. 세 번째 factory 아티팩트 신설 영구 차단.
- **executionImpact: 문서 단계 = NONE.** 본 ADR 은 ADR/타입/ARCHITECTURE.md 전용 — 런타임 소스
  0줄 변경, behavior change 0, KIS/KRX quota 0 침범, ENV 0건. 구현 단계 executionImpact 는 묶음별
  평가(묶음0~5 = NONE/간접, 묶음6 = 직접·별도 ADR).
- **타입 pin 범위.** 본 ADR 은 *신규 타입 0* — 기존 A/B 타입의 책임을 재확인만 한다. (필요 시 P2
  묶음 내 byte-equivalent 타입 pin 은 허용하되 behavior change 0.)
- **Rollback:** 문서 변경이므로 N/A(git revert). 구현 단계는 `USE_UNIFIED_SOURCE_SNAPSHOT` flag
  OFF 로 byte-equivalent 롤백.
- **Self-review (ADR-0146):** (1) LIVE 안전성 — 코드 0줄, NONE. (2) wiring vs 인프라 — 본 ADR 은
  계약(문서)이며 wiring 은 P2 묶음0~6 후속. (3) ADR 무결성 — INDEX 0556→0557 갱신. (4) 회귀 테스트 —
  문서라 불요(묶음0~6 각 테스트가 담당, 블루프린트 §C 명시). (5) baseline 무회귀 — 신규 위반 0,
  기존 baseline(V1~V7)은 ADR-0555 grandfather allowlist 승계.

## Alternatives Considered

- **A. 블루프린트 원안 — `server/snapshot/sourceSnapshotFactory.ts` 신규 신설.** 기각: A(ADR-0519
  collector)·B(ssotPipeline) 에 이은 세 번째 SourceSnapshot 아티팩트 → ADR-0555 §0 "두 번째 SSOT
  신설 금지" 위반. 블루프린트의 경계 관찰(src→server import 불가)은 유효하나 대상이 틀림(B 이전이
  아니라 A 확장이 정답).
- **B. ssotPipeline.ts 를 server 로 이전·병합.** 기각: B 는 *projection* 레이어로 A 의 *수집*
  컨테이너와 책임이 다르다. 병합 시 단일 책임 위반 + src 측 gate/policy 순수 투영 소비처 회귀 위험.
  책임 분리 유지(A=factory, B=projection)가 정합.
- **C. 신규 통합 freshness enum 신설.** 기각: 도메인별 freshness enum 이 이미 존재
  (providerHealth/SymbolDataQuality/SymbolDartCadence/DataHealth). 신규 enum = 두 번째 SSOT.
  기존 `DataHealth` 를 공통 어휘로 채택하고 도메인 enum→DataHealth 매핑.

## References

- 헌법: `docs/adr/0555-ssot-single-funnel-enforcement-constitution.md` (§Roadmap P2 가 본 ADR 요구)
- 블루프린트: `_workspace/2026-06-03_ssot-constitution/engine-dev/wiring-blueprint.md` (§A 입력·§B 출력·§C 묶음·§D 미해결)
- factory 정본(A): `server/trading/symbolDataCollector.ts` + `server/trading/sourceSnapshot/unifiedSourceSnapshot.ts` + `symbolSnapshotData.ts` (ADR-0519)
- projection(B): `src/services/autoTrading/ssotPipeline.ts`
- freshness SSOT: `src/types/shadowCase.ts:29 DataHealth` · `symbolSnapshotData.ts:36/105/117` · `sourceSnapshotDataHealth.ts:23`
- DART 슬롯 계약: ADR-0529 (`SymbolDartFinancialsSlot`, cache-first, L2 cadence 분리)
- 데이터 경로 분리: ADR-0011 (`aiUniverseService` 단일통로, KIS/KRX 직접 호출 금지) · CLAUDE.md §2.2-3
- provider≠signal: 불변식 6 · `executionPermissionResolver.ts:208 providerIssueIsolated` · ADR-0499
- 불변식: CLAUDE.md §2.1 (#1 Engine always-on · #2 Shadow always-on · #4~6 provider 격리 · #7 L4 격리 · #9 SourceSnapshot 우회 금지)
