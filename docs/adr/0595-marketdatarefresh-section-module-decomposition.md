# ADR-0595: marketDataRefresh section-module decomposition (orchestrator thin-out)

@responsibility refactor — marketDataRefresh.ts refresh*Section 도메인 그룹을 marketDataRefresh/ 하위 모듈로 이동, 본체는 오케스트레이터+영속만 잔류 (byte-equivalent)

## Status

Accepted

## Context

`server/trading/marketDataRefresh.ts` 는 현재 **1,496~1,497줄**로 절대 규칙 #6 의 1,500줄 ACMA 한계
(`scripts/check_complexity.js`)에 **4줄 차로 재도달**했다. [[ADR-0580]](types/helpers 추출, 1499→1327) ·
[[ADR-0589]](프로그램 매매 helper 이동·cc 축소) · [[ADR-0592]](kospiIntradayRefresh.ts 분리) 의 3차 분해에도
불구하고 최근 30일 9회 수정(레포 최다 핫스팟: VKOSPI KRX 전환·ADR-0583 MHS degrade·ADR-0584 carry-forward
경고 등)으로 다시 차올랐다. 다음 1줄 수정에 빌드/커밋이 차단되는 임박 상태다.

ADR-0580 은 execution-relevant 파일이라 "타입+순수 leaf 헬퍼만" 추출하고 섹션 로직은 무접촉으로 남겼다.
그 결과 본체에는 9개 도메인 섹션(KOSPI / VKOSPI / USD-KRW / SPX·DXY / FSS 수급 / 공매도 / 신용잔고 /
FSS 11분류 / FRED / MHS / 프로그램매매 / 섹터에너지)이 누적되어 있고, 수정 빈도가 가장 높은 곳이
바로 이 섹션들이다. **leaf 추출 여력은 소진**됐으므로 이번에는 섹션 함수 단위의 *순수 이동*(텍스트
move + 내부 호출 리라우트, 로직 0줄 변경)으로 분해한다. 호출 그래프·호출 순서·영속 merge 는 본체
오케스트레이터(`refreshMarketRegimeVars` + `buildUpdatedMacroState`)에 그대로 남아 불변이다.

제약: 9대 불변식 보존 — 특히 #3(모든 판단은 단일 SourceSnapshot 출발: 본 모듈은 MacroState writer 이며
snapshot 산출 경로 무변경), #6(provider 장애 ≠ market signal: `emitMarketDataProviderWarn` 의
`providerIssue=true marketSignal=false` 문구 byte 보존), #9(Gate 내부 provider 직접 조회 금지: 이동은
경로만 바꾸고 Gate 모듈에 어떤 fetch 도 노출하지 않음). 기능 추가 0, behavior change 0.

## Decision

`refresh*Section` / `resolve*Section` 도메인 그룹과 그 전용 헬퍼·상수·모듈 상태를 형제 디렉토리
`marketDataRefresh/` 하위 5개 신규 모듈로 이동한다. 본체는 (1) 섹션 호출 순서, (2) `buildUpdatedMacroState`
merge 영속, (3) 기존 public API `export`/`export *` 재노출만 보유한 얇은 오케스트레이터로 남는다.

```
server/trading/
├── marketDataRefresh.ts                      # 오케스트레이터 — refreshMarketRegimeVars(호출 순서 ④→④B→②→⑦→③→③b→③c→⑥→⑥b→⑥c→⑧→⑨→sectorEnergy→merge)
│                                             #   + buildUpdatedMacroState(MERGE 영속 SSOT) + public re-export. 예상 ~375줄
└── marketDataRefresh/
    ├── types.ts                              # (기존, ADR-0580) 타입 8종
    ├── helpers.ts                            # (기존, ADR-0580/0589) 순수 leaf 헬퍼
    ├── kospiIntradayRefresh.ts               # (기존, ADR-0592) KOSPI trigger provenance
    ├── refreshObservability.ts               # 신규 ~165줄 — macroRefreshRuntimeContext + logMacroRefresh{Started,Success,Failed,Skipped}
    │                                         #   + emitMacroDataHealthSummary + emitMarketDataProviderWarn (전 섹션 공유 — 순환 import 차단 위해 형제로)
    ├── indexMacroSections.ts                 # 신규 ~370줄 — Yahoo 차트 클라이언트(YF_HEADERS·heartbeat 상태 3종·getYahooHealthSnapshot·
    │                                         #   fetchDailyBars/fetchCloses/fetchLatestBar) + fetchFred + computeVkospiDayChangeFromBars
    │                                         #   + refreshKospiSection·refreshVkospiSection·refreshUsdKrwSection·refreshSpxSection·refreshDxySection·refreshFredSection·resolveMhsSection
    ├── supplyCreditSections.ts               # 신규 ~380줄 — KRX_SHORT_URL/OTP/RATIO_KEYS + fetchKrxShortSelling + tryKrxShort{Direct,ViaOtp,ViaKisRanking}
    │                                         #   + tallyConsecutiveForeignFlowDays + computeFssVars + refreshShortSellingSection·refreshMarginBalanceSection·refreshFssDetailSection
    ├── programMarketSection.ts               # 신규 ~200줄 — KisMarketProgramTrade 타입 + hasLegRowInvariantViolation
    │                                         #   + computeProgramMarketSnapshot + refreshProgramMarketSection
    └── sectorEnergySection.ts                # 신규 ~170줄 — SectorEnergyResolved 인터페이스 + resolveSectorEnergySection
```

신규 파일 `@responsibility` 초안 (25단어 이내, 상단 20줄 내):

| 파일 | @responsibility 초안 |
|------|----------------------|
| `refreshObservability.ts` | `marketDataRefresh 시작/성공/실패/스킵 로깅과 P1 운영 경고 emit 단일 통로 (providerIssue≠marketSignal 명시)` |
| `indexMacroSections.ts` | `KOSPI·VKOSPI·USD/KRW·SPX·DXY·FRED·MHS 섹션 갱신 + Yahoo 차트 fetch와 health heartbeat` |
| `supplyCreditSections.ts` | `FSS 외국인 수급·KRX 공매도 폴백 체인·ECOS 신용잔고·FSS 11분류 raw 섹션 갱신` |
| `programMarketSection.ts` | `KIS 시장 프로그램 매매 스냅샷 조립(불변식 판정 포함)과 macroState 영속 섹션` |
| `sectorEnergySection.ts` | `섹터 에너지 입력 meta 해석과 4-axis 품질 진단 resolve 섹션 (영속은 본체 merge)` |

설계 근거:

- **응집도**: 최근 30일 수정 9회는 VKOSPI(④B)·MHS(⑨)·sectorEnergy·프로그램매매에 집중 — 도메인별
  파일로 격리하면 다음 수정이 본체 줄 수를 늘리지 않는다.
- **순환 import 0**: 섹션 모듈은 `refreshObservability.ts`(형제)·`helpers.ts`·`types.ts`·기존
  clients 만 import. 본체 → 섹션 단방향. 섹션 → 본체 import 금지 (lint 시 즉시 노출).
- **모듈 상태 동반 이동**: Yahoo heartbeat mutable 상태 3종(`_yahooLastSuccessAt` 등)은 reader/writer
  전부(`fetchDailyBars`/`getYahooHealthSnapshot`)와 함께 `indexMacroSections.ts` 로 이동 — 상태 분단 없음.
- **KIS L1 단일 통로 보존**: `fetchKisMarketSupply`/`fetchKisMarketProgramTrade` 는 계속 `kisClient.ts`
  경유. ADR-0561(KIS Primary Absolute) 위치 무변경 — Yahoo 호출은 기존 fallback 위치 그대로 이동만.

## Consequences

- `marketDataRefresh.ts` 1,497 → **~375줄** (한계 대비 ~1,125줄 여유). 신규 5모듈 전부 1,500줄 한계 내
  (최대 ~380줄). executionImpact=**NONE** — 순수 이동·re-export, 런타임 byte-equivalent.
- **외부 importer 경로 변경 0건** (14개 소비처: reportJobs·exitEngine/closeSeriesProvider·pipelineDiagnosis·
  macroSectorSync·refreshMacro.cmd·supplyHealth.cmd·health/diagnostics·sectorEnergyFallbackProvider·
  reportGenerator·dxyMonitor·globalScanAgent·preMarketSignal·newsSupplyLogger·macroRouter).
  본체가 다음을 re-export 로 보존:
  - `export * from './marketDataRefresh/types.js'` (기존 유지)
  - `export { getYahooHealthSnapshot, fetchDailyBars, fetchCloses, fetchLatestBar, computeVkospiDayChangeFromBars } from './marketDataRefresh/indexMacroSections.js'`
  - `export { fetchKrxShortSelling, tallyConsecutiveForeignFlowDays, computeFssVars } from './marketDataRefresh/supplyCreditSections.js'`
  - `refreshMarketRegimeVars` 는 본체 정의 그대로.
- **정적 grep 가드 테스트 갱신 9파일** — 전부 원본 텍스트를 `readFileSync` 로 검사하므로 이동 직후
  깨진다. `marketDataRefreshProgramMarket.test.ts` 가 이미 쓰는 `SOURCE_PATH + HELPERS_PATH` 다중 파일
  읽기 패턴(ADR-0444 static-grep-guard: "본문 + 서브모듈을 함께 grep — 향후 이동에도 견고")으로 확장한다:

  | 가드 테스트 | 깨지는 단언 | 갱신 (추가 read 경로) |
  |---|---|---|
  | `marketDataRefresh.test.ts` | VKOSPI KRX wiring 3건 (`fetchDerivativesIndexDaily()` 등) | + `marketDataRefresh/indexMacroSections.ts` concat |
  | `marketDataRefreshShortSelling.test.ts` | `tryKrxShortViaKisProxy`·`L4_SOURCES`·`Math.min(shortResult.ratio, 8)` 등 | + `marketDataRefresh/supplyCreditSections.ts` concat |
  | `marketDataRefreshFssMapping.test.ts` | `isFssMappingEnabled()`·`upsertFssRecord` 패턴 | + `supplyCreditSections.ts` concat |
  | `marketDataRefreshFssDetail.test.ts` | `appendFssDetailRecord`·`fssDetailSource = 'KRX_BLD'` 등 | + `supplyCreditSections.ts` concat |
  | `marketDataRefreshMarginBalance.test.ts` | `fetchLatestMarginBalance5dChange`·`marginBalanceSource` 등 | + `supplyCreditSections.ts` concat |
  | `marketDataRefreshProgramMarket.test.ts` | `computeProgramMarketSnapshot` 본문 단언 (HELPERS_PATH 단언은 무영향) | + `PROGRAM_PATH = marketDataRefresh/programMarketSection.ts` (기존 HELPERS_PATH 패턴 동일 확장). 섹션 순서 단언("③-c 위치")은 오케스트레이터 잔존 호출 주석 검사 → 무영향 |
  | `marketDataRefreshSectorEnergyInputsAdr0454.test.ts` | `let sectorEnergyInputsResolved`·`= meta.inputs` (이동) / merge spread 단언은 본체 잔존 | + `sectorEnergySection.ts` concat |
  | `sectorEnergyQualityDiagnosticAdr0423.test.ts` (it 1건, L529) | `sectorEnergyQualityDiagnostic` resolve 부 | + `sectorEnergySection.ts` concat (동일 파일 L520-523 에 동일 패턴 선례) |
  | `sectorEnergySourceRestorationAdr0399.test.ts` (it 1건, L345) | `sectorEnergyDiagnostics`·`sectorEnergySourceTier`·`ADR-0399` | + `sectorEnergySection.ts` concat |

- 9대 불변식: #1·#2 무접촉(엔진/Shadow 코드 0줄), #3 SourceSnapshot 산출 경로 무변경, #6 경고 문구
  byte 보존, #7 L4 가드(`L4_SOURCES` 캡) 텍스트 그대로 이동, #9 Gate 모듈에 provider 노출 0.
- 회귀 기준: `lint`(tsc client+server) EXIT=0 · `validate:complexity` OK · `validate:responsibility` OK ·
  위 9개 가드 스위트 + `kospiIntradayRefreshAdr0592` 관련 스위트 전체 green · `precommit` 통과.

## Alternatives Considered

1. **ADR-0580 패턴 반복 (leaf 헬퍼 추가 추출)** — 기각. 남은 순수 leaf 가 거의 없고(이미 0580/0589 가
   소진), 4줄 여유는 다음 섹션 수정 1회로 재초과한다. 핫스팟(섹션 본문)을 옮기지 않으면 재발 구조.
2. **`refreshMarketRegimeVars` 자체를 분할 (단계별 파이프라인 클래스화)** — 기각. 호출 순서·merge 정책이
   execution-relevant 라 behavior risk. ADR-0580 도 동일 사유로 무접촉 처리한 함수다. 본 ADR 은 호출
   그래프 불변(이동만)이 원칙.
3. **섹션을 2개 파일로만 묶기 (fetch 계열 / persist 계열)** — 기각. 한 파일이 ~700줄로 시작해 동일
   핫스팟 패턴 재발. 도메인(지수거시/수급신용/프로그램/섹터에너지) 단위가 수정 이력과 1:1 정합.
4. **가드 테스트를 런타임 import 검증으로 재작성** — 기각. 정적 grep 가드는 "사용자 명시 금지 사항
   영구 차단" 목적(주문 함수 import 0건 등)이라 텍스트 검사가 본질. 다중 경로 concat 확장이 최소 변경.

## Migration Plan

> 전 단계 공통: 기능 추가 0 · behavior change 0 · 호출 그래프 불변 · 각 단계 종료 시점에 컴파일 green.
> PR 1건 (이동은 원자적이어야 함 — 부분 이동 상태로 머지 금지). 롤백 = PR revert 1회.

1. **(a) 파일 분리** — 신규 5모듈 생성, `@responsibility` 태그 부여(상단 20줄 내), 섹션 함수·전용
   상수·모듈 상태를 **텍스트 그대로** move (순서: refreshObservability → indexMacroSections →
   supplyCreditSections → programMarketSection → sectorEnergySection).
2. **(b) 내부 호출 리라우트** — 각 신규 모듈에 필요한 import 추가 (clients/persistence/helpers/types/
   refreshObservability). 본체 `marketDataRefresh.ts` 는 섹션 함수를 named import. 섹션 → 본체 역참조
   0건 확인 (`grep "from '../marketDataRefresh.js'" server/trading/marketDataRefresh/` = 0).
3. **(c) 원본 re-export 유지** — 본체에 위 Consequences 의 re-export 3줄 추가. 외부 14개 importer
   무수정. `npm run lint` EXIT=0 확인.
4. **(d) 가드 테스트 갱신** — 위 표 9파일에 `HELPERS_PATH` 패턴으로 신규 모듈 경로 concat 추가.
   단언 정규식/문자열은 **무수정** (검사 대상 텍스트만 확장).
5. **검증** — `npm run validate:responsibility` · `npm run validate:complexity` ·
   `npx vitest run server/trading/marketDataRefresh* server/clients/sectorEnergy*` ·
   `node scripts/check_adr_index_baseline.js` 전부 EXIT=0 → `precommit` →
   `docs/ai/10-patch-history-index.md` 한 줄 추가.

## Guardrails

- No live trading path change unless explicitly stated.
- No KIS/order import or invocation unless explicitly stated.
- No Gate/Kelly/STRONG_BUY behavior change unless explicitly stated.
- No Shadow policy change unless explicitly stated.
- No provider fetch behavior change unless explicitly stated.
- No data promotion behavior change unless explicitly stated.

## References

- ADR-0580 (types/helpers 추출), ADR-0589 (program helper·cc 축소), ADR-0592 (kospiIntradayRefresh 분리)
- ADR-0444 (static-grep-guard 다중 파일 concat 패턴), ADR-0561 (KIS Primary Absolute)
- `docs/ai/09-refactor-rules.md` (Patch Scope Guard), `scripts/check_complexity.js`
