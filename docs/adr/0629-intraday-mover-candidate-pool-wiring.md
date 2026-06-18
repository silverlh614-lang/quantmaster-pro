# ADR-0629 — Intraday Mover Candidate Pool Wiring (신선 screener 당일 상위 → 메인 발굴 candidate pool 배선)

- **Status**: Proposed (Phase 0 — 경계·타입·ADR·flag/상수 계약 pin. flag default OFF byte-identical. 구현은 engine-dev 인계.)
- **Date**: 2026-06-18
- **Domain**: signalScanner (candidate pool 발굴 레이어 단일 도메인 — ADR-530 3 도메인 한계 내)
- **계보**: 0628 (intraday-leader-universe-freshness — screener.json 장중 신선화·약세 회전) ·
  0612 (universe RS gate — laggard 입력 교정·입력측 수리 원칙) · 0617/0618 (leader-source 발굴) ·
  0561 (KIS Primary Absolute — quota 는 캐시·배치·rate 로 해결, 캐시 read 우선) · 0157 (정확비교 default OFF) ·
  0146 (PR 자가 review) · 0530 (Patch Scope Guard)

---

## Context

ADR-0628(머지됨)이 `screener.json` 을 당일 intraday 로 신선화했다(`INTRADAY_SCREENER_REFRESH_ENABLED`
+ 12분 쓰로틀 + 약세 회전). **그러나 메인 스캔의 candidate pool 이 그 신선한 우물을 읽지 않는다.**
코드 조사로 검증된 근본원인: **우물은 찼는데 발굴 풀이 안 읽는다.**

### 검증된 근본원인 — candidate pool 입력 2소스에 screener.json 부재

`buildCandidatePool` 호출부(`persistScanResults.ts:384~397`)의 입력은 다음 둘뿐이다:

- **(a) 직전 스캔 watchlist 파생** — `existingWatchlist: options.candidatePoolSourceCandidates ??
  scanCandidateSnapshots`. `scanCandidateSnapshots` 는 `loadWatchlist()`
  (WATCHLIST/HIGH_LIQUIDITY/FALLBACK, `persistScanResults/helpers.ts`) 기반 평가 풀.
- **(b) 직전 스캔 carry** — `previousDayTopRankedCandidates` 와 `openShadowWatchlist` 가 **둘 다 동일한**
  `priorCandidates = _lastScanSummary?.candidatePool?.candidateSnapshots`
  (`persistScanResults.ts:384`)를 가리킨다. 라벨은 `PREVIOUS_DAY_TOP_RANKED` / `OPEN_SHADOW_WATCHLIST`
  지만, **사실 "전일"이 아니라 직전 스캔의 자기복제**다 → 풀이 자기 자신을 재주입해 **고정**된다.

→ `screener.json`(`getScreenerCache()`, `stockScreener.ts:101`)을 읽는 곳은
`intradayScanner.discoverIntradayCandidates()`(`intradayScanner.ts:248`) **하나뿐**이고, 거기서도
발굴된 후보는 `intradayReady === true` 가 되기까지 **15분 보유 관문**(`candidateSelect.ts:20`
`intradayReady === true` 필터)에 막혀 **같은 스캔에 반영되지 못한다.** 즉 오늘의 리더(예: 삼화콘덴서
+28%)는 screener.json 에는 들어왔어도 candidate pool 평가 풀에는 같은 스캔에 진입할 경로가 없다.

### 데이터는 이미 당일 intraday — 신규 fetch 불요

`kisRankingClient.ts` 의 `fluctuation`(FHPST01700000 등락률 상위, `:122~154`)·거래량
(FHPST01710000)은 **이미 당일 intraday** 데이터다. ADR-0628 의 12분 쓰로틀이 `screener.json` 을
장중 갱신하므로, `getScreenerCache()` 의 `ScreenedStock.changeRate`(`stockScreener.ts:78`, 당일 등락률 %)
는 장중 현재 상위를 반영한다. **신규 KIS 호출 불필요 — 캐시 read 만으로 충분**(ADR-0561 정합).

### 재사용 seam (핵심 — 신규 fetch·신규 입력 슬롯 신설 0)

코드 확인 결과 `buildCandidatePool` 에는 **이미 `intradayMovers` 입력 슬롯과 `INTRADAY_MOVER` 소스
태그가 완전히 plumbing 돼 있다**:

- `BuildCandidatePoolInput.intradayMovers?: CandidatePoolInputCandidate[]`
  (`candidatePoolBuilder.ts:269`).
- `buildCandidatePool` 본체가 `addCandidates(state, input.intradayMovers, 'INTRADAY_MOVER', input)`
  로 이미 소비(`candidatePoolBuilder.ts:849`).
- `CandidateSourceTag` union 에 `'INTRADAY_MOVER'` 존재(`candidatePoolBuilder.ts:11`),
  `CANDIDATE_TAGS` set 등록(`:304`).

→ **남은 갭은 단 하나: `persistScanResults.ts:385~397` 의 `buildCandidatePool({...})` 호출에서
`intradayMovers` 가 채워지지 않는다.** 본 ADR 은 이 비어 있는 슬롯에 신선 screener 당일 상위를
주입하는 한 줄짜리 배선이며, 무게중심은 **매핑 로직을 신규 모듈로 격리**하는 것이다.

---

## Decision

**`buildCandidatePool` 입력의 비어 있는 `intradayMovers` 슬롯에, 신선 `screener.json` 당일 intraday
상위를 신규 소스(`INTRADAY_MOVER`)로 주입한다.** 오늘의 리더가 평가 풀에 직접 진입(intradayReady 15분
관문 우회), 기존 약세 회전(ADR-0628 D5)이 낙오주를 밀어낸다. 신규 KIS fetch 0(캐시 read 만), Gate
채점·requiredScore=70·STRONG 승격·condition weight 무접촉. 본 작업은 **유니버스 신선화**지 채점 변경이
아니다(ADR-0612 입력측 수리 원칙 정합).

### D1 — 신규 모듈로 매핑·주입 격리 (복잡도 회피 — 필수)

**`persistScanResults.ts` 는 현재 1487줄 — 1500 한계까지 13줄뿐**(`scripts/check_complexity.js`).
`candidatePoolBuilder.ts` 도 1131줄로 여유가 적다. 따라서:

- **신규 모듈 `server/trading/signalScanner/scanDiagnostics/intradayMoverCandidateSource.ts` 신설**
  (예상 80~140줄)에 매핑·flag·상한 로직을 전부 격리한다.
- `persistScanResults.ts` 는 **import 1줄 + 호출 수 줄(2~4줄)** 만 추가:
  - `import { collectIntradayMoverCandidates } from './intradayMoverCandidateSource.js';`
  - `buildCandidatePool({...})` 호출 객체에 `intradayMovers: collectIntradayMoverCandidates(),`
    프로퍼티 1줄 추가(`:385~397` 블록 내).
- `candidatePoolBuilder.ts` 는 **0줄 변경** — `intradayMovers` 슬롯·`INTRADAY_MOVER` 태그·
  `addCandidates` 소비 경로 모두 이미 구현돼 있다.

→ persistScanResults 순증 ≈ 4줄 이내(1491줄, 한계 9줄 여유 유지). candidatePoolBuilder 0줄.

### D2 — 신규 flag (default OFF · byte-identical)

- **신규 flag**: `INTRADAY_MOVER_CANDIDATE_SOURCE_ENABLED` — default OFF. SSOT 함수
  `isIntradayMoverCandidateSourceEnabled()` 를 신규 모듈에 co-locate. 정확비교 `=== 'true'`(ADR-0157).
- **주입 상한 상수**: `INTRADAY_MOVER_MAX_INJECT`(기본 **N=20**, 풀 폭주·과열 방지). ENV override 가능,
  하한/상한 가드(0 이하·NaN → 기본 20; 상한 clamp 예: 50). 신선 screener 당일 상위 N개만 매핑.
- **OFF 경로 byte-identical**: flag OFF 면 `collectIntradayMoverCandidates()` 가 **빈 배열 `[]` 반환**
  → `addCandidates(state, [], 'INTRADAY_MOVER', input)` 가 importedCount 0 추가 → candidate pool
  **byte-identical**(현행 동작 100% 보존, ADR-0157 default OFF byte-equivalent).

### D3 — 주입 매핑 (engine-dev 구현 pin)

신규 모듈 `collectIntradayMoverCandidates()` 가:

1. flag OFF 면 즉시 `[]` 반환(KIS 호출 0, 매핑 0).
2. `getScreenerCache()`(`stockScreener.ts:101`) — 당일 신선 `ScreenedStock[]` read(신규 fetch 0).
3. `changeRate` **내림차순 정렬** → 상위 `INTRADAY_MOVER_MAX_INJECT` 개 slice(당일 상승률 상위 = 리더).
4. 각 `ScreenedStock` 을 `CandidatePoolInputCandidate` 로 매핑(아래 §매핑 계약).
5. 매핑된 배열 반환 → `persistScanResults.ts` 가 `intradayMovers` 로 전달.

`buildCandidatePool` 내부 `addCandidates(..., 'INTRADAY_MOVER', ...)` 가 자동으로 `source: 'INTRADAY_MOVER'`
태깅·중복 병합(`state.snapshots` Map, code 기준)·minimal validity 필터·랭킹을 수행한다. 신규 산식 0.

### D4 — `PREVIOUS_DAY_TOP_RANKED` 오명명 (본 ADR 범위 외 · 코드 변경 0)

`persistScanResults.ts:395~396` 의 `previousDayTopRankedCandidates`/`openShadowWatchlist` 가
직전 스캔 carry(자기복제)인데 라벨이 "전일 상위"로 오명명된 점은 **본 ADR 에서 재명명하지 않는다**
(코드 변경 최소·byte-equivalent 보존). 재명명은 별도 patch type(진단 가시화)로 후속. 본 주입은
**별개의 `INTRADAY_MOVER` 태그**를 쓰므로 기존 오명명 라벨과 충돌하지 않는다.

### D5 — 채점·안전 불변 (절대 제약)

- requiredScore=70 / Gate0~3 채점식 / STRONG 승격식 / condition weight **0줄 무접촉** — 본 작업은
  candidate pool **입력(유니버스)** 신선화이지 **채점** 변경이 아니다(ADR-0612 입력측 수리 정합).
- `SourceSnapshot` · `autoTradeEngine` · `kisClient.ts` 본체 · `src/**` **무접촉**.
- 현 **SHADOW_ONLY** 라 live 매수 영향 **NONE**. flag OFF byte-identical.

---

## intradayReady 15분 관문 우회 — 매매 안전성 논증

본 주입은 candidate pool 에 **직접** 주입하므로 `candidateSelect.ts:20` 의 `intradayReady === true`
15분 보유 관문을 **우회**한다. 이것이 허용되는 근거:

- **레이어 분리** — 15분 관문은 `selectCandidates`(intraday watchlist → buyList/intradayBuyList 분류)
  경로의 안정화 장치다. 본 주입은 **candidate pool 발굴/평가 레이어**(buildCandidatePool)이며, 주입된
  종목은 여전히 **Gate0~3 전 채점을 통과해야** 신호가 된다. 관문 우회는 "평가 후보 진입"일 뿐,
  "채점·승인 우회"가 아니다.
- **SHADOW_ONLY 무해** — 현 엔진은 SHADOW_ONLY 라 주입된 당일 급등주가 LIVE 매수로 이어지지 않는다.
  uvula 우회는 shadow 평가 표본을 신선화할 뿐(불변식 #2 보강).
- **flag default OFF** — opt-in. 우회 동작은 운영자가 명시적으로 ON 했을 때만 발생.
- **상한 통제** — `INTRADAY_MOVER_MAX_INJECT`(기본 20)로 풀 폭주·과열 진입 폭을 제한.

### ⚠️ 향후 LIVE risk (ADR 명시 · flag/상한으로 통제)

주입된 당일 급등주가 **LIVE-eligible 평가 풀에 들어간다.** 현재 SHADOW_ONLY 라 무해하나, **향후
LIVE 전환 시 과열주(intraday +28% 등)가 LIVE 매수 후보로 진입할 가능성**이 있다. 통제 장치:

- flag default OFF — LIVE 전환 전 별도 검증 단계 필수.
- `INTRADAY_MOVER_MAX_INJECT` 상한 — 주입 폭 제한.
- Gate0~3 + requiredScore=70 + STRONG 승격 채점이 **여전히 과열주를 걸러낸다**(채점 무접촉 → 기존
  과열 페널티·overheatPenalty 그대로 적용). 본 주입은 평가 후보 진입일 뿐 채점 면제 아님.
- LIVE 전환 시 별도 ADR 에서 과열 컷·진입 시각 제약을 재검토(본 ADR 은 SHADOW 신선화 범위).

---

## 신규 flag / 상수 / 시그니처 계약 (engine-dev 구현 pin)

```
# ── ADR-0629 신선 screener 당일 상위 → candidate pool 주입 ───
INTRADAY_MOVER_CANDIDATE_SOURCE_ENABLED=false     # default OFF (ADR-0157, === 'true')
INTRADAY_MOVER_MAX_INJECT=20                       # 당일 상위 주입 상한 (풀 폭주·과열 방지, 0 이하/NaN→20, 상한 clamp 50)
```

**SSOT 함수·시그니처 (`intradayMoverCandidateSource.ts` 신규 모듈):**

```ts
// @responsibility 신선 screener.json 당일 상위를 INTRADAY_MOVER candidate pool 입력으로 매핑(캐시 read·flag-gated).

/** ADR-0629 — 주입 kill-switch. default OFF → candidate pool byte-identical. */
export function isIntradayMoverCandidateSourceEnabled(): boolean {
  return process.env.INTRADAY_MOVER_CANDIDATE_SOURCE_ENABLED === 'true';
}

/** 당일 상위 주입 상한 (기본 20, 하한/상한 가드). */
export function getIntradayMoverMaxInject(): number {
  const raw = Number(process.env.INTRADAY_MOVER_MAX_INJECT);
  const n = Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 20;
  return Math.min(50, n);                          // 상한 clamp (과열 폭주 방지)
}

/**
 * 신선 screener.json 당일 상위 → INTRADAY_MOVER candidate pool 입력 매핑.
 * flag OFF → []  (candidate pool byte-identical).
 * flag ON  → getScreenerCache() changeRate 내림차순 상위 N(getIntradayMoverMaxInject) 매핑.
 * 신규 KIS fetch 0 — 캐시 read 만(ADR-0561). 실패/빈 캐시 → [] (조용히, 불변식 #1).
 */
export function collectIntradayMoverCandidates(): CandidatePoolInputCandidate[];
```

**매핑 계약 (`ScreenedStock` → `CandidatePoolInputCandidate`):**

| ScreenedStock 필드 | CandidatePoolInputCandidate 필드 | 비고 |
|---|---|---|
| `code` | `code` (+ `symbol`) | normalizeSymbol 이 code/symbol/stockCode 순 인식 |
| `name` | `name` | |
| `currentPrice` | `currentPrice` (+ `price`) | pickNumber 가 흡수 |
| `changeRate` | `dayChangeRate`(런타임) — 정렬·진단용 | 채점 입력 아님(유니버스 신선화) |
| `volume` | `volume` | |
| — | `source: 'INTRADAY_MOVER'` | addCandidates 가 자동 태깅(매퍼는 미지정 가능) |

- `featureScores`/`penalties`/RS·breakout 등은 **매핑하지 않는다** — buildCandidatePool 의 minimal
  validity 필터·feature missing 채점이 기존대로 처리(`MISSING_FEATURE_SCORED` 경로). 매퍼는 식별·가격·
  거래량 최소 hydration 만 제공. 신규 채점 산식 0.
- 매핑 실패/필드 부재 종목은 **skip**(throw 0) — 빈 캐시·부분 결손도 graceful `[]`/부분 배열.

**삽입 지점 (engine-dev 구체 pin):**

`persistScanResults.ts` `buildCandidatePool({...})` 호출(`:385~397`) 객체에 **1 프로퍼티 추가**:

```ts
summaryDraft.candidatePool = options.candidatePool ?? buildCandidatePool({
  sourceSnapshotId,
  // ... 기존 필드 무변경 ...
  existingWatchlist: options.candidatePoolSourceCandidates ?? (scanCandidateSnapshots as ...),
  intradayMovers: collectIntradayMoverCandidates(),   // ← ADR-0629 1줄 추가 (flag OFF 시 [])
  previousDayTopRankedCandidates: priorCandidates,
  // ... 이하 무변경 ...
});
```

→ 기존 try/catch(`:382~421`, `emitScanDiagnosticBuildFailedWarn` 흡수)가 이미 본 블록을 감싸므로
매핑/캐시 read 예외도 candidate pool 빌드 실패로 격리(불변식 #1). 모듈 내부에서도 자체 try/catch 로
`[]` fallback 권장(이중 안전).

**타입 영향**: `src/types/**` **무수정**. 신규 모듈은 `CandidatePoolInputCandidate`
(`candidatePoolBuilder.ts` server-local export) + `ScreenedStock`(`stockScreener.ts` server-local) 만
import — server-local 로 끝난다. 기존 `BuildCandidatePoolInput.intradayMovers` 슬롯 재사용(추가 0).

---

## 불변식 보존 논증 (9대 불변식)

- **#1 (Trading Engine 항상 살아있음)**: `collectIntradayMoverCandidates` 는 캐시 read + 순수 매핑 —
  실패 시 `[]` 반환(throw 0). persistScanResults 의 기존 try/catch(`:419`)가 추가 격리. 엔진 루프·
  스캔 차단 0. flag OFF 면 dead path(`[]` 즉시 반환).
- **#2 (Shadow Learning 무중단)**: candidate pool 입력 풀 확대만 — shadow 판단 차단·중단 0. 신선
  리더 유입으로 shadow 표본 강화.
- **#3 / #9 (SourceSnapshot SSOT · Gate 내부 provider 직접조회 금지)**: 본 주입은 **발굴/candidate
  pool 레이어**에서 ADR-0628 이 이미 갱신한 `screener.json` 캐시를 read 할 뿐 — SourceSnapshot 무접촉.
  Gate0~3 채점은 기존 SourceSnapshot 경유 그대로. **Gate 내부 provider 직접조회 신설 0**(캐시 read 는
  발굴 레이어이고, screener.json 은 D1(ADR-0628) 이 kisClient 단일 통로 `realDataKisGet` 로 이미
  채운 파일이므로 #9 위반 아님 — provider 를 Gate 내부에서 직접 호출하지 않는다).
- **#6 (Provider 장애 ≠ market signal)**: 빈 캐시·부분 결손은 `[]`/부분 배열로 흡수 — bearish 변환 0.
  screener 미수록 종목을 약세로 단정하지 않는다(주입 안 할 뿐).
- **#7 (AI_ESTIMATED L4 live 금지)**: changeRate 등 = KIS 순위 TR L1. L4 신규 사용 0.
- **#8 (실거래 차단 ↔ Shadow 차단 분리)**: 현 SHADOW_ONLY 상태에서 live 매수 영향 NONE. flag OFF
  byte-identical. 주입은 평가 후보 진입일 뿐 실거래 승인 경로 무접촉.

**단일 통로 규칙**: 신선 screener 는 ADR-0628 이 `preScreenStocks`→`realDataKisGet`(kisClient 단일
통로)로 채운 캐시 — 본 모듈은 그 캐시를 read 만(raw KIS REST 직접 호출 0). `aiUniverseService` import 0.
`autoTradeEngine`·`kisClient` 본체 0줄.

---

## Patch Scope Guard (ADR-530)

- **targetDomain**: signalScanner (candidate pool 발굴 레이어 단일 도메인 — 3 한계 내).
- **allowedFiles**:
  - `server/trading/signalScanner/scanDiagnostics/intradayMoverCandidateSource.ts` — **신규 모듈**:
    `isIntradayMoverCandidateSourceEnabled` / `getIntradayMoverMaxInject` /
    `collectIntradayMoverCandidates`. (@responsibility 태그 의무.)
  - `server/trading/signalScanner/scanDiagnostics/persistScanResults.ts` — import 1줄 +
    `buildCandidatePool({...})` 호출에 `intradayMovers:` 프로퍼티 1줄(순증 ≤ 4줄, 1500 한계 여유 유지).
  - `.env.example` — `INTRADAY_MOVER_CANDIDATE_SOURCE_ENABLED`·`INTRADAY_MOVER_MAX_INJECT` 문서화.
  - 대응 `*.test.ts`(intradayMoverCandidateSource 단위 + persistScanResults 주입 통합).
- **forbiddenFiles**: SourceSnapshot 모듈 · `autoTradeEngine` · Gate0~3 채점(`quantFilter`/
  `gate*ConfluenceScore`/`decompositionBuilder`/requiredScore=70 SSOT) · `kisClient.ts` 본체 ·
  `realDataKisGet` 시그니처 · `candidatePoolBuilder.ts` 본체(0줄 — `intradayMovers` 슬롯 재사용만) ·
  `candidateSelect.ts` 채점/필터 · `stockScreener.preScreenStocks` 4 TR · `src/**` · `aiUniverseService`.
- **expectedBehaviorChange**: flag ON 시 메인 스캔 candidate pool 에 신선 screener 당일 상위 N개가
  `INTRADAY_MOVER` 소스로 주입 → 오늘의 리더가 intradayReady 15분 관문 우회하고 평가 풀 직접 진입 →
  Gate0~3 채점 대상. flag OFF 시 변화 0(candidate pool byte-identical).
- **sourceSnapshotImpact**: NONE (발굴 레이어 screener.json 캐시 read 만 — SourceSnapshot 무접촉).
- **executionImpact**: 현 SHADOW_ONLY 라 live 매수 영향 **NONE**. flag OFF byte-identical / ON 시
  execution-adjacent(평가 풀 확대, 채점·주문 산식 0줄). 향후 LIVE risk 는 위 §LIVE risk 로 통제.
- **shadowLearningImpact**: 신선 리더 유입으로 shadow 평가 표본 강화(#2 보강) — 차단·중단 0.
- **providerImpact**: KIS quota 추가 **0** — 주입은 ADR-0628 이 이미 갱신한 `screener.json`
  (`getScreenerCache`) 캐시 read 재사용. 신규 fetch 0. KRX/Yahoo 0(ADR-0561 정합).
- **telegramImpact**: candidate pool 진단 카운트(소스 분포 `topCandidateSources`)에 `INTRADAY_MOVER`
  카운트가 노출될 수 있으나 기존 진단 렌더 경로 재사용 — 신규 알림 산식 0.
- **testsRequired**:
  (a) flag OFF → `collectIntradayMoverCandidates()` → `[]` (candidate pool byte-identical).
  (b) flag ON + 비빈 캐시 → changeRate 내림차순 상위 N 매핑, `INTRADAY_MOVER` 소스로 pool 진입.
  (c) flag ON + MAX_INJECT 상한 → 캐시 100개여도 상위 N(기본 20)만 주입.
  (d) MAX_INJECT clamp — 0/NaN 입력 → 20, 100 입력 → 50 상한.
  (e) 빈 캐시/일부 필드 결손 → graceful `[]`/부분 배열(throw 0, 불변식 #1).
  (f) 매핑 정합 — code/name/price/volume 캐리 + source INTRADAY_MOVER 태깅 확인.
  (g) persistScanResults 통합 — flag ON 시 buildCandidatePool 호출에 intradayMovers 전달, OFF 시
      미전달(또는 `[]`)로 candidate pool 결과 동일.
- **rollbackPlan**: `INTRADAY_MOVER_CANDIDATE_SOURCE_ENABLED=false` 1줄(즉시 byte-identical — candidate
  pool 입력 2소스 carry 풀로 복귀). 신규 모듈은 flag OFF 시 `[]` 반환(dead path) — 영속/런타임 영향 0.

---

## Alternatives Considered

- **(a) intradayReady 15분 관문을 candidateSelect 에서 완화/제거** — 기각. 관문은 intraday watchlist
  안정화 책임(별 도메인). 본 주입은 candidate pool 레이어 직접 진입으로 관문을 건드리지 않고 우회 —
  관문 본체 무변경(byte-equivalent). candidateSelect 채점/필터 수정은 forbiddenFiles.
- **(b) persistScanResults.ts 내부에 매핑 인라인** — 기각. 1487줄 → 1500 한계 13줄뿐. 인라인 매핑
  (40~100줄)은 한계 초과(ADR 선행 분할 규칙 위반). 신규 모듈로 격리 필수.
- **(c) candidatePoolBuilder.ts 에 screener read 신설** — 기각. 1131줄 여유 적음 + buildCandidatePool
  은 입력을 받는 순수 빌더여야(주입은 호출부 책임). screener 의존을 빌더에 넣으면 SRP·테스트성 악화.
  `intradayMovers` 슬롯이 이미 있으므로 builder 0줄.
- **(d) 신규 입력 슬롯/소스 태그 신설** — 불요/기각. `intradayMovers` 슬롯 + `INTRADAY_MOVER` 태그가
  이미 완전 plumbing(`candidatePoolBuilder.ts:269,849,11,304`). 신설은 중복.
- **(e) `PREVIOUS_DAY_TOP_RANKED` 오명명을 본 ADR 에서 재명명** — 기각/분리. carry 라벨 재명명은
  candidate pool 결과 byte 영향 + 별 책임(진단 가시화). 본 ADR 은 신규 `INTRADAY_MOVER` 태그만 추가 —
  오명명 정정은 후속 patch type(D4).
- **(f) intradayScanner 가 candidate pool 에 직접 push** — 기각. intradayScanner 는 발굴/bridge 경로
  (ADR-0628 D2)이고 candidate pool 빌드는 persistScanResults 책임. 두 경로 혼선·이중 주입 위험.
  persistScanResults 단일 주입점이 깔끔.
- **(g) 신규 KIS 랭킹 fetch** — 기각. screener.json 캐시(ADR-0628 신선화)가 동일 데이터 제공.
  ADR-0561 KIS Primary Absolute — quota 는 캐시 재사용으로 해결.
- **(h) default ON** — 기각. opt-in(ADR-0157) + LIVE byte-equivalent 보존(과열주 LIVE 진입 risk 검증
  전 단계 필요).
- **(i) 상한 없는 전량 주입** — 기각. screener 80개 전량 주입은 풀 폭주·shadow 노이즈. MAX_INJECT
  상한(기본 20·상한 50 clamp)으로 통제.

---

## References

- `persistScanResults.ts:384`(priorCandidates carry)·`:385~397`(buildCandidatePool 호출 — intradayMovers
  미주입 갭)·`:394`(existingWatchlist)·`:395~396`(previousDayTopRanked/openShadow 오명명 carry)·
  `:419`(try/catch 격리)
- `candidatePoolBuilder.ts:11`(INTRADAY_MOVER 태그)·`:269`(intradayMovers 입력 슬롯)·`:304`(CANDIDATE_TAGS)·
  `:80~120`(CandidatePoolInputCandidate)·`:849`(addCandidates INTRADAY_MOVER 소비)
- `stockScreener.ts:74~84`(ScreenedStock — code/name/currentPrice/changeRate/volume)·`:101`(getScreenerCache)
- `intradayScanner.ts:248`(getScreenerCache 유일 read)·`candidateSelect.ts:20`(intradayReady===true 15분 관문)
- `kisRankingClient.ts:122~154`(fluctuation FHPST01700000 당일 등락률)
- ADR-0628(screener 장중 신선화·약세 회전) · 0612(입력측 RS 수리) · 0561 · 0157
```
