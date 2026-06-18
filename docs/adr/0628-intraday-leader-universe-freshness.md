# ADR-0628 — Intraday Leader Universe Freshness (장중 리더 유니버스 신선화)

- **Status**: Proposed (Phase 0 — 경계·타입·ADR·flag/throttle 계약 pin. 양 flag default OFF byte-identical. 구현은 engine-dev 인계.)
- **Date**: 2026-06-18
- **Domain**: screener / orchestrator (2 도메인 — ADR-530 3 도메인 한계 내)
- **계보**: 0551 (LeadershipBridge 배선 kill-switch) · 0617/0618 (leader-source 발굴·일일 신선화) ·
  0561 (KIS Primary Absolute — quota 는 캐시·배치·rate 로 해결) · 0157 (정확비교 default OFF) ·
  0043 (cron/스케줄 가드) · 0445 (영속 물리 분리) · 0146 (PR 자가 review)

---

## Context

강세장(코스피 +1.45%)인데 13:37 장중 스캔이 **후보 0개**를 산출했다. 코드 조사로 검증된 근본원인은
신호 로직 결함이 아니라 **signalScanner 의 평가 풀(49개)이 아침 스냅샷에 고정**된 것이며, 두 겹의 갭이다.

### 원인 ① (구조적) — 발굴 입력 2소스가 모두 아침 고정

`intradayScanner.discoverIntradayCandidates()`(`intradayScanner.ts:214`)의 후보 풀은 2소스 병합이다
(`:232`~`:255`):

- **소스 1** `getExpandedUniverse()`(`dynamicUniverseExpander.ts:626`) — 주간/장전 갱신.
- **소스 2** `getScreenerCache()`(`stockScreener.ts:101`) — `screener.json` 을 그대로 읽는다.
  그런데 `screener.json` 은 `preScreenStocks()`(`stockScreener.ts:118`, KIS 상승률·거래량·신고가·외인
  순위 4 TR)가 **쓰는데**, 그 호출은 `OPENING_AUCTION` 의 **08:45 단 1회**뿐이다
  (`tradingOrchestrator.ts:526`). **장중 KIS 등락률/거래량 순위 TR 재호출 코드가 부재**하다.

→ 09:00 이후 등장한 신규 리더(예: 삼화콘덴서 +28%)는 `screener.json` 에 코드 자체가 없어
**발굴 후보 풀에 진입조차 못 한다.** INTRADAY tick 은 `scanAndUpdateIntradayWatchlist()` 를 매분
호출(`tradingOrchestrator.ts:598`)하지만 이 경로는 `screener.json` 을 **읽기만** 하고 갱신하지 않는다.

### 발굴→평가풀 다리 LeadershipBridge — prod 에서 이미 활성 (원인 아님)

발굴된 리더가 signalScanner 평가 풀(메인 watchlist)로 합류하는 유일한 경로는 LeadershipBridge 다.

- `isLeadershipBridgeEnabled()`(`leadershipBridge.ts:30`)가 `LEADERSHIP_BRIDGE_ENABLED === 'true'`
  를 본다.
- **운영자 정정**: `LEADERSHIP_BRIDGE_ENABLED` 는 **prod 에서 이미 true** 다. 따라서 bridge OFF 는
  현 결함의 원인이 **아니다**. bridge 배선(`intradayScanner.ts:285` `if (bridgeEnabled)` 가드 →
  `leaderCandidates` 수집 → `bridgeLeadersToMomentum`)은 이미 열려 있어, 발굴 풀에 신선 리더가 들어오는
  즉시 메인 watchlist MOMENTUM 레인으로 편입한다.
- `selectCandidates()`(`candidateSelect.ts:20`)는 watchlist + `intradayReady === true` 인 intraday
  엔트리만 평가 풀로 읽는다.

→ **유일한 binding 제약은 원인 ①(발굴 입력의 아침 고정)** 이다. 이미 열린 bridge 는 풀에 신선 후보가
없어서 신규 리더를 전달하지 못했을 뿐이다.

### 단일 수리 — 발굴 입력 신선화

**LeadershipBridge 는 prod 에서 이미 활성(`LEADERSHIP_BRIDGE_ENABLED=true`) — binding 제약은 발굴
입력의 아침 고정이며, 본 패치(screener 장중 신선화)가 그것을 해소하면 이미 열린 bridge 가 신규 리더를
평가 풀로 전달한다.** 즉 구현 무게중심은 **screener 장중 갱신 단독**이다. 원인 ①만 고치면 신규 리더가
발굴 풀(`getScreenerCache`)에 즉시 들어오고, 이미 ON 인 bridge 가 메인 watchlist MOMENTUM 레인으로
편입하여 49개 평가 풀에 도달한다.

### 재사용 seam (핵심 — 두 번째 산식 신설 0)

- 장중 발굴 신선화는 **신규 fetch 설계 불요**: 기존 `preScreenStocks()`(4 TR · kisClient 단일 통로
  `realDataKisGet`)를 INTRADAY 창에서 N분 쓰로틀로 **재호출**하면 `screener.json` 이 갱신되고,
  `intradayScanner` 와 `autoPopulateWatchlist` 가 **둘 다** `getScreenerCache()` 를 읽으므로 한 수정으로
  양쪽에 신선 리더가 유입된다.
- bridge 편입은 기존 `bridgeLeadersToMomentum`(`leadershipBridge.ts:109`) + `LEADERSHIP_BRIDGE_ENABLED`
  게이팅을 **그대로 재사용**(ENV ON 권고). 새 편입 산식 0.

---

## Decision

**운영자 확정 수리 범위 = screener.json 장중 갱신 단독.** LeadershipBridge 는 prod 에서 이미 활성
(`LEADERSHIP_BRIDGE_ENABLED=true`)이므로 본 패치의 무게중심은 발굴 입력 신선화 하나다. 신규 fetch
설계 0, 새 편입/채점 산식 0, requiredScore=70 등 Gate 채점 불변. 본 작업은 **유니버스 신선화**지
채점 변경이 아니다.

### D1 — 장중 screener.json 재호출 (신규 flag · 쓰로틀)

INTRADAY tick(`tradingOrchestrator.ts` `case 'INTRADAY'`)에서, `scanAndUpdateIntradayWatchlist()`
호출 **직전에** flag-gated + 쓰로틀된 `preScreenStocks()` 재호출을 삽입한다.

- **신규 flag**: `INTRADAY_SCREENER_REFRESH_ENABLED` — default OFF. SSOT 함수
  `isIntradayScreenerRefreshEnabled()` 를 `stockScreener.ts` 에 co-locate(`preScreenStocks` 동거).
  정확비교 `=== 'true'`(ADR-0157).
- **쓰로틀 상수** `INTRADAY_SCREENER_REFRESH_MIN_INTERVAL_MIN`(기본 **12분**, 권장 범위 10~15분).
  ENV override 가능하되 하한 가드(예: 5분 미만 입력은 5분으로 clamp) — KIS quota 보호(ADR-0561:
  quota 는 캐시·배치·rate 관리로 해결, Yahoo-first 회피 사유 아님).
- **모듈 내 마지막 갱신 시각 상태**(예: `stockScreener.ts` 모듈 스코프 `lastIntradayRefreshAt`)로
  쓰로틀. INTRADAY 창에서만 동작(OPENING_AUCTION 08:45 1회 경로는 무변경).
- **OFF 경로 byte-identical**: flag OFF 면 INTRADAY tick 에서 `preScreenStocks()` 추가 호출 0 →
  `screener.json` 은 08:45 1회 그대로(현행 동작 100% 보존, ADR-0157 default OFF byte-equivalent).

### D2 — LeadershipBridge (prod 이미 활성 · 코드/ENV 변경 0)

`LEADERSHIP_BRIDGE_ENABLED` 는 **prod 에서 이미 true** 다(운영자 확인). 따라서 본 패치에서 bridge
관련 코드/ENV 변경은 **없다**. 배선(`intradayScanner.ts:268` `bridgeEnabled` 가드 → `leaderCandidates`
수집 → `bridgeLeadersToMomentum`)은 ADR-0551 에서 이미 구현·활성돼 있으므로, 발굴 입력이 신선해지는
즉시 이미 열린 bridge 가 신규 리더를 평가 풀로 전달한다.

### D3 — flag 동작 (binding 제약은 INTRADAY_SCREENER_REFRESH_ENABLED 단독)

bridge 는 prod 에서 이미 ON 이므로, 유일한 제어 변수는 `INTRADAY_SCREENER_REFRESH_ENABLED` 다.

| `LEADERSHIP_BRIDGE_ENABLED` (prod=ON 고정) | `INTRADAY_SCREENER_REFRESH_ENABLED` | 결과 |
|---|---|---|
| ON | OFF | 현행 byte-identical (발굴 입력 08:45 풀 고정 — 이미 열린 bridge 도 편입할 신선 후보 부재) |
| **ON** | **ON** | **screener.json 장중 신선화 → 발굴 풀 갱신 → 이미 열린 bridge 가 신규 리더를 메인 watchlist MOMENTUM→49개 평가 풀로 전달** |

→ bridge 가 이미 ON 인 prod 에서는 **`INTRADAY_SCREENER_REFRESH_ENABLED=true` 단독**으로 근본 수리가
완성된다. (참조용 OFF/OFF·OFF/ON 조합은 prod 가정에 해당 없음 — bridge 는 항상 ON.)

### D4 — 채점·경계 불변 (절대 제약)

- requiredScore=70 / Gate0~3 채점식 / STRONG 승격식 / condition weight **0줄 무접촉** — 본 작업은 평가
  **입력 풀(유니버스)** 신선화이지 **채점** 변경이 아니다.
- `preScreenStocks` 4 TR 파라미터·필터(`stockScreener.ts:134`~`:203`) 무변경 — 동일 TR 을 시각만
  달리 재호출.
- LeadershipBridge `qualifiesAsLeader`(gate≥4.5·mtas≥6·RS≥KOSPI) 임계 무변경(`leadershipBridge.ts:56`).

---

## 신규 flag / 상수 계약 (engine-dev 구현 pin)

```
# ── D1 장중 screener 재호출 ───────────────────────────────
INTRADAY_SCREENER_REFRESH_ENABLED=false           # default OFF (ADR-0157, === 'true')
INTRADAY_SCREENER_REFRESH_MIN_INTERVAL_MIN=12      # 기본 12분 (권장 10~15, 하한 clamp 5분)

# ── D2 LeadershipBridge — prod 이미 활성, 본 패치 무접촉 ───
# LEADERSHIP_BRIDGE_ENABLED=true (prod 운영값) — 본 ADR 에서 변경/문서화 0줄.
#   binding 제약은 위 INTRADAY_SCREENER_REFRESH_ENABLED 단독.
```

**SSOT 함수 (stockScreener.ts co-locate):**

```ts
// @co-located preScreenStocks 와 동거 — 장중 재호출 게이트 SSOT (ADR-0628)
export function isIntradayScreenerRefreshEnabled(): boolean {
  return process.env.INTRADAY_SCREENER_REFRESH_ENABLED === 'true';
}

export function getIntradayScreenerRefreshIntervalMs(): number {
  const raw = Number(process.env.INTRADAY_SCREENER_REFRESH_MIN_INTERVAL_MIN);
  const min = Number.isFinite(raw) && raw > 0 ? raw : 12;        // 기본 12분
  return Math.max(5, min) * 60_000;                              // 하한 5분 clamp (quota 보호)
}
```

**타입 영향**: `src/types/**` **무수정**(server-local flag/throttle 만). 신규 SSOT 함수·모듈 스코프
쓰로틀 상태(`lastIntradayRefreshAt`)는 `stockScreener.ts` 로컬. additive only — 기존 `ScreenedStock` /
`IntradayWatchlistEntry` / `WatchlistEntry` 스키마 무변경.

**삽입 지점 (engine-dev 구체 pin):**

1. `tradingOrchestrator.ts` `case 'INTRADAY'` — `await scanAndUpdateIntradayWatchlist()`
   (`:598`) **직전**에:
   ```ts
   if (isIntradayScreenerRefreshEnabled()) {
     await maybeRefreshScreenerIntraday().catch(console.error);  // 쓰로틀 내장 · OFF 시 호출 자체 없음
   }
   ```
   쓰로틀 판정(`Date.now() - lastIntradayRefreshAt < getIntradayScreenerRefreshIntervalMs()`)은
   `stockScreener.ts` 의 신규 wrapper(예: `maybeRefreshScreenerIntraday()`) 내부에 캡슐화 — 미충족 시
   조용히 return(KIS 호출 0), 충족 시 `preScreenStocks()` 호출 후 `lastIntradayRefreshAt = now`.
   wrapper 가 직접 `preScreenStocks()` 결과를 `screener.json` 에 영속(기존 preScreen 영속 경로 재사용).
2. `intradayScanner.ts` 입력 병합(`:248` `getScreenerCache()`) — **코드 변경 0**. screener.json 이
   D1 으로 이미 신선해졌으므로 기존 read 가 자동으로 신선 리더를 본다(원인 ① seam 의 핵심 — 한 수정으로
   intradayScanner·autoPopulateWatchlist 양쪽 신선화).

---

## 불변식 보존 논증 (9대 불변식)

- **#1 (Trading Engine 항상 살아있음)**: 재호출은 `.catch(console.error)` 격리 — preScreen 실패가
  INTRADAY tick·`scanAndUpdateIntradayWatchlist`·엔진 루프를 멈추지 않는다. 쓰로틀 미충족 시 조용히 skip.
- **#2 (Shadow Learning 무중단)**: 평가 입력 풀 확대만 — shadow 판단 차단·중단 0.
- **#3 / #9 (SourceSnapshot SSOT · Gate 내부 provider 직접조회 금지)**: preScreen 재호출은 발굴 레이어
  (screener.json) 만 갱신 — SourceSnapshot 무접촉. Gate0~3 채점은 기존 SourceSnapshot 경유 그대로.
  Gate 내부 provider 직접조회 신설 0.
- **#6 (Provider 장애 ≠ market signal)**: preScreen 실패/부분실패는 기존 `Promise.allSettled` +
  `emitProviderWarn` 경로로 흡수(`stockScreener.ts:130`) — bearish 변환 0. 신선화 실패 시 직전
  screener.json 유지(stale ≠ 약세 신호).
- **#7 (AI_ESTIMATED L4 live 금지)**: KIS 순위 TR = L1. L4 신규 사용 0.
- **#8 (실거래 차단 ↔ Shadow 차단 분리)**: 현 SHADOW_ONLY 상태에서 live 매수 영향 NONE. flag OFF
  byte-identical.

**단일 통로 규칙**: preScreen 재호출은 기존 `stockScreener.preScreenStocks` 경로 재사용 —
`realDataKisGet`(kisClient 단일 통로) 경유, raw KIS REST 직접 호출 0. `aiUniverseService` 자동매매
import 0(본 작업 미접촉). `autoTradeEngine`·`kisClient` 본체 0줄.

---

## Patch Scope Guard (ADR-530)

- **targetDomain**: screener · orchestrator (2 도메인 — 3 한계 내).
- **allowedFiles**:
  - `server/screener/stockScreener.ts` — `isIntradayScreenerRefreshEnabled` /
    `getIntradayScreenerRefreshIntervalMs` / `maybeRefreshScreenerIntraday` 신설 + 모듈 스코프 쓰로틀
    상태. `preScreenStocks` 본체·4 TR 무변경.
  - `server/orchestrator/tradingOrchestrator.ts` — INTRADAY tick `scanAndUpdateIntradayWatchlist`
    직전 flag-gated 1 호출 추가.
  - `.env.example` — `INTRADAY_SCREENER_REFRESH_ENABLED`·`INTRADAY_SCREENER_REFRESH_MIN_INTERVAL_MIN`·
    `LEADERSHIP_BRIDGE_ENABLED` 문서화.
  - 대응 `*.test.ts`(stockScreener throttle / tradingOrchestrator INTRADAY refresh).
- **forbiddenFiles**: SourceSnapshot 모듈 · `autoTradeEngine` · Gate0~3 채점(`quantFilter`/
  `gate*ConfluenceScore`/`decompositionBuilder`/requiredScore SSOT) · `kisClient.ts` 본체 ·
  `realDataKisGet` 시그니처 · `bridgeLeadersToMomentum`/`qualifiesAsLeader` 임계 · `candidateSelect.ts`
  채점/필터 · `src/**` · `aiUniverseService`.
- **expectedBehaviorChange**: 양 flag ON 시 INTRADAY 창에서 12분 쓰로틀로 screener.json 신선화 →
  신규 리더가 발굴 후보 풀·bridge 편입 경로로 유입 → 49개 평가 풀 도달. flag OFF 시 변화 0.
- **sourceSnapshotImpact**: NONE (발굴 레이어 screener.json 만 갱신).
- **executionImpact**: 현 SHADOW_ONLY 라 live 매수 영향 **NONE**. flag OFF byte-identical / ON 시
  execution-adjacent(평가 풀 확대, 채점·주문 산식 0줄).
- **shadowLearningImpact**: 신선 리더 유입으로 shadow 표본 강화(#2 보강) — 차단·중단 0.
- **providerImpact**: KIS quota — INTRADAY 창에서 12분 쓰로틀당 preScreen 1회(4 TR). 09:00~15:30
  ≈ 6.5h / 12분 ≈ 32회 × 4 TR ≈ 128 추가 호출/일(상한). 하한 5분 clamp 으로 폭주 차단. KRX/Yahoo
  추가 0(KIS 순위 TR 만). ADR-0561 정합(쓰로틀=rate 관리).
- **telegramImpact**: bridge 편입/intraday 발굴 알림은 기존 dedup(`intraday_new:` cooldownMs 4h ·
  `intradayScanner.ts:333`) 경로 재사용 — 신규 알림 산식 0. 신선화로 알림 빈도 소폭 증가 가능(기존
  dedup 가 흡수).
- **testsRequired**: (a) flag OFF → INTRADAY tick 에서 preScreen 호출 0(byte-identical) (b) flag ON
  + 쓰로틀 미충족 → 호출 0 (c) flag ON + 충족 → preScreen 1회 + lastIntradayRefreshAt 갱신 (d) 하한
  clamp(MIN_INTERVAL 3분 입력→5분 적용) (e) preScreen throw → INTRADAY tick 무중단(#1).
- **rollbackPlan**: `INTRADAY_SCREENER_REFRESH_ENABLED=false` 1줄(즉시 byte-identical · 발굴 입력
  08:45 풀로 복귀). bridge 는 본 패치 무접촉(prod 이미 ON) — 롤백 대상 아님.

---

## Alternatives Considered

- **(a) bridge 도 함께 토글(둘 다 ON 요구)** — 기각/무효. `LEADERSHIP_BRIDGE_ENABLED` 는 prod 에서
  이미 true 이므로 본 패치에서 bridge 를 토글할 필요가 없다. binding 제약은 발굴 입력 신선화 단독.
- **(b) bridge ON 만(screener 갱신 없음)** — 기각. bridge 가 이미 ON 이어도 편입할 신선 후보가
  08:45 풀에 없으면 신규 리더가 평가 풀에 도달하지 못한다. 따라서 screener 장중 갱신이 핵심 수리다.
- **(c) 신규 장중 랭킹 fetch 모듈 신설** — 기각. `preScreenStocks` 4 TR 가 이미 동일 데이터 제공.
  두 번째 발굴 산식 신설은 ADR-0561/0617 재사용 원칙 위반.
- **(d) intradayScanner 가 screener.json 우회하고 KIS 순위 직접 호출** — 기각. 불변식 #9(Gate/발굴
  내부 provider 직접조회 금지) 위반 위험 + kisClient 단일 통로 우회.
- **(e) default ON** — 기각. opt-in(ADR-0157) 원칙 + LIVE byte-equivalent 보존(quota 폭주 회피
  전 검증 단계 필요).
- **(f) 쓰로틀 없는 매 tick 재호출** — 기각. KIS quota 폭주(분당 1회 × 4 TR). 12분 쓰로틀 필수.
- **(g) requiredScore 완화/STRONG 승격식 손대기** — 기각. 본 작업은 유니버스 신선화이지 채점 변경
  아님(D4). 채점 갭은 별도 ADR(0627 계열).

---

## References

- `intradayScanner.ts:214`(discoverIntradayCandidates)·`:232~255`(2소스 병합)·`:248`(getScreenerCache)·
  `:268`(bridgeEnabled)·`:311`(intradayReady:false)
- `stockScreener.ts:101`(getScreenerCache)·`:118`(preScreenStocks)·`:130`(VTS provider warn)
- `tradingOrchestrator.ts:526`(08:45 preScreenStocks 1회)·`:598`(INTRADAY scanAndUpdateIntradayWatchlist)
- `leadershipBridge.ts:30`(isLeadershipBridgeEnabled)·`:56`(qualifiesAsLeader)·`:109`(bridgeLeadersToMomentum)
- `candidateSelect.ts:20`(intradayReady===true)·`:56`(MOMENTUM 평가 합류)
- ADR-0551 · 0617 · 0618 · 0561 · 0157

---
---

# ADR-0628 2차 확장 — D5: 약세 종목 회전 (Intraday Weak Rotation)

> **본 섹션은 1차(D1~D4) 내용을 보존하고 추가만 한다.** INDEX 는 이미 0628 등재 —
> 번호 추가 발급 0(같은 ADR 확장). Status: Proposed (Phase 0 — 경계·신호소스·flag/상수·
> 술어·시그니처 pin. flag default OFF byte-identical. 구현은 engine-dev 인계).

## D5 Context — 발굴 신선화만으로는 부족한 2차 차단

D1(`INTRADAY_SCREENER_REFRESH_ENABLED`)이 발굴 입력을 신선화해도, 신선 리더가
**메인 watchlist MOMENTUM 레인에 admit 되지 못하는 2차 차단**이 남는다.

- `bridgeLeadersToMomentum`(`leadershipBridge.ts:109`)이 신선 리더를 admit 하려 할 때
  `addToWatchlist`(`watchlistManager.ts:223`)를 호출한다.
- MOMENTUM 섹션이 cap(soft 40 / hard 50, `watchlistRepo.ts:46~70` + `enforceSectionCaps`
  `:208`)에 도달해 **아침 낙오주(09:00 이후 약세 전환했지만 아침 gateScore 로 진입한 종목)**
  로 만석이면, `addToWatchlist` 의 `tryEvictWeakest`(`watchlistManager.ts:259`)는
  **morning-fixed gateScore** 로만 약자를 판정한다 — 신선 리더의 gateScore 가 그날 아침
  낙오주보다 높지 않으면 eviction 실패 → `addToWatchlist` 가 `added:false, reason:'full'`
  → `leadershipBridge.ts:148~150` `bump('momentum_full')` 로 **튕긴다(2차 차단)**.

→ **binding 제약 2 = MOMENTUM cap 만석 시 morning-fixed score 기반 eviction 이
"현재 약세"를 반영하지 못함.** 신선 리더가 발굴돼도 자리를 못 얻는다. D5 는 **신선한 강도
신호로 약세 멤버를 evict 해 자리를 내주는 회전 정책**을 추가한다.

## D5 Decision — admission-triggered weak rotation

### D5.1 구현 위치 (pin) — 신규 모듈 `intradayWeakRotation` + bridge admission 경로 주입

**결정: (b) 신규 모듈 `server/screener/intradayWeakRotation.ts` 를 신설하고,
`addToWatchlist` 의 주입식 `evictionStrategy`(`watchlistManager.ts:194`,
`AddToWatchlistOptions.evictionStrategy`)로 bridge admission 경로에서만 활성화한다.**
**(a) `watchlistRepo.enforceSectionCaps` 확장은 기각.**

근거:
- **SRP** — `enforceSectionCaps`/`computeTrimScore`(`watchlistRepo.ts:150~289`)는
  **save-time cap 강제**(soft/hard composite trim) 책임이다. "신선 리더 admit 을 위한
  약세 evict"는 다른 책임(admission-triggered rotation)이므로 별도 모듈로 분리한다.
  `watchlistRepo.ts` 는 현재 **828줄** — cap 정책에 회전 로직을 얹으면 복잡도·책임이
  더 비대해진다(1,500줄 한계 여유는 있으나 SRP 위반).
- **단일 통로** — `addToWatchlist` 는 이미 `evictionStrategy` 주입 seam 을 제공
  (`watchlistManager.ts:193~198`, `tryEvictWeakest`/`tryEvictMostDataStarved` 와 동일 패턴).
  신규 회전 술어를 이 seam 으로 주입하면 watchlist 단일 진입점을 우회하지 않는다.
- **admission-triggered vs periodic** — **admission-triggered 채택**(권장안). 신선 리더가
  실제로 admit 을 시도해 cap 에 막힐 때만(=자리가 필요할 때만) evict 한다. periodic
  스윕은 자리 수요 없이 멤버를 흔들어 churn·shadow 노이즈를 키운다. admission-triggered
  는 "교체 1:1"이 보장돼 깔끔하고, 회전 상한(D5.4) 적용도 사이클 단위로 자연스럽다.
- **bridge 가 유일 호출자** — D5 회전은 `bridgeLeadersToMomentum` 가 신선 리더를 admit 할
  때만 의미가 있다(신선 강도 비교 대상이 곧 신선 리더). 따라서 `leadershipBridge.ts` 가
  `addToWatchlist` 호출 시 `evictionStrategy: buildWeakRotationEvictionStrategy(ctx)` 를
  넘기는 한 곳에서만 배선한다. autoPopulate/DART 등 다른 admit 경로는 무접촉.

### D5.2 약세 신호 소스 (pin) — 신선 screener `changeRate` 의 벤치마크 상대값

**코드 확인 결과(중요):** `WatchlistEntry`(`watchlistRepo.ts:291~433`)에는
`relativeReturn20d` 필드가 **존재하지 않는다.** 가용 후보는:
- `entry.symbolFeatures.return20d` / `.kospi20dReturn` / `.kosdaq20dReturn`
  (`watchlistRepo.ts:309~319`) — **발굴(아침) 시점에 기록된 morning-fixed snapshot.**
  여기서 relativeReturn20d 를 합성해도 **아침 고정값**이라 "현재 약세"를 반영하지 못함 →
  회전이 무의미(운영자 명시 우려 정확).
- `entry.gateScore` / `entry.watchlistPriorityScore` — 역시 **아침 고정**(진입 시점 채점).
- `ScreenedStock.changeRate`(`stockScreener.ts:78`, 당일 등락률 %) — **D1 으로 INTRADAY
  창에서 12분 쓰로틀 갱신되는 screener.json 에서 읽음 → 유일하게 신선한 per-symbol 강도.**

**결정: 약세 신호 = `relativeChangeRate = screener.changeRate − kospiDayReturn`
(신선 screener `changeRate` 의 벤치마크 상대값). 값이 낮을수록 "현재 약세".**

근거·정합:
- **신선성** — D1 이 이미 12분 쓰로틀로 `screener.json` 을 갱신하므로 `getScreenerCache()`
  (`stockScreener.ts:101`)의 `changeRate` 는 장중 현재 강도를 반영한다. **두 번째 fetch
  산식 신설 0**(ADR-0561/0617 재사용 원칙). KIS quota 추가 0(D1 갱신분 재사용).
- **벤치마크 상대화** — `bridgeLeadersToMomentum` 는 이미 `ctx.kospiDayReturn`
  (`leadershipBridge.ts:48~51, 62`)를 받는다. 동일 `kospiDayReturn` 으로 멤버의
  `changeRate` 를 상대화 → "벤치마크 대비 약세"를 일관 기준으로 측정. (운영자 1순위
  기준 "벤치마크 대비 20일 상대수익률"의 **신선 proxy** — 20d 상대수익률은 watchlist 에
  신선하게 저장되지 않아 사용 불가, 당일 벤치마크 상대강도가 "현재 약세"의 최선 신선 신호).
- **신선 리더 강도** — 동일 척도. 신선 리더 후보(`LeaderCandidate`)의
  `sectorRelativeStrength`(`leadershipBridge.ts:41`, "섹터 RS 또는 당일 변화율 %")가
  이미 벤치마크 상대강도 의미를 가지므로 evict 후보 `relativeChangeRate` 와 동일 차원에서
  비교 가능(D5.3).
- **screener 미수록 멤버 처리** — evict 후보가 `screener.json` 에 없으면(changeRate 부재)
  신선 신호 부재 → **fallback: 회전 대상에서 제외(보수)**. 신선 신호 없는 종목을 약세로
  단정해 evict 하지 않는다(아침 고정값으로 evict 하면 회전 무의미·오판 위험). screener 에
  있으나 stale(screenedAt 노후) 한 경우도 동일 보수 처리.

**타입 영향 (pin): `src/types/**` 무수정.** `relativeChangeRate` 는 evict 후보별 **런타임
파생값**(screener.json `changeRate` − `ctx.kospiDayReturn`)이며 entry 에 영속하지 않는다.
신규 모듈은 `WatchlistEntry`(server-local) 와 `ScreenedStock`(server-local) 만 import —
server-local 로 끝난다. 기존 스키마(`WatchlistEntry`/`ScreenedStock`/`LeaderCandidate`)
필드 추가 0.

### D5.3 회전 조건 (pin) — 신선 리더 강도 > evict 대상 강도 + margin

무조건 교체 아님. 다음을 **모두** 만족할 때만 evict:

1. 신선 리더 강도 `leaderStrength`(= `LeaderCandidate.sectorRelativeStrength`) >
   evict 후보 강도 `relativeChangeRate` **+ `WEAK_ROTATION_STRENGTH_MARGIN`**(기본 **2.0%p**).
   margin 을 둬 미세 우위(noise)로 멤버를 흔드는 churn 차단(운영자 "margin 둘지 결정" → **둔다**).
2. evict 후보가 D5.5 보호 목록에 해당하지 않음.
3. 사이클 누적 evict < `INTRADAY_WEAK_ROTATION_MAX_PER_CYCLE`(D5.4).
4. evict 후보가 신선 신호 보유(screener.json 수록 + changeRate 유한) — D5.2 fallback.

"가장 약한" 1건 선택: 보호 제외·신선신호 보유 멤버 중 `relativeChangeRate` **최저** 1건을
대상으로, 위 margin 비교 통과 시에만 evict. 통과 못 하면 evict 0(=신선 리더가 admit 실패,
기존 `momentum_full` 동작으로 fallback — byte 동일).

### D5.4 사이클당 상한 (pin)

- `INTRADAY_WEAK_ROTATION_MAX_PER_CYCLE`(기본 **3**) — 한 `bridgeLeadersToMomentum` 호출
  (=1 admission 사이클)당 evict 총량 상한. churn 방지(운영자 확정). ENV override 가능,
  하한 가드(0 이하·NaN → 기본 3). 상한 도달 후 추가 신선 리더는 기존 `momentum_full` 로 fallback.

### D5.5 보호 목록 — evict 적격성 술어 (pin)

`isWeakRotationEvictable(entry, ctx)` 가 **false** 면 절대 evict 금지:

- **섹션 보호** — `entry.section === 'SWING' || entry.section === 'CATALYST'`. MOMENTUM 만 대상.
- **보유 포지션 보호 (불변식 #2·#8 직결)** — shadow/live 보유 종목 evict 절대 금지.
  `getOpenPositions()`(`shadowPositionLedger.ts:61`)의 `trade.stockCode`
  (`shadowTradeRepo.ts:432`) 집합에 `entry.code` 포함 시 보호. (live 보유도 동일 ledger
  경유 — 보유 종목은 active scan 풀에서 빠지더라도 evict 대상에서 원천 제외.)
- **pinned/MANUAL 보호** — `entry.addedBy === 'MANUAL'`(기존 `tryEvictWeakest:265` 와 동일
  보호) + `entry.isFocus === true`(SWING focus). (`WatchlistEntry` 에 별도 `pinned` 필드는
  부재 — MANUAL + isFocus 가 pin 의미를 충족. 운영자 "pinned" 의도를 이 두 마커로 매핑.)
- **bridge 신규 편입 grace** — `entry.leadershipBridge === true` 이고 `addedAt` 이 최근
  `WEAK_ROTATION_GRACE_MS`(기본 **10분**) 이내면 보호. 방금 admit 된 신선 리더를 같은/다음
  사이클이 곧장 다시 evict 하는 thrash 차단.
- **intradayReady 진행 중 보호** — intraday 평가 진행 중 종목 evict 금지. `WatchlistEntry`
  자체엔 `intradayReady` 필드 부재(intraday 엔트리 측 플래그) → engine-dev 는 구현 시
  intraday 진행 종목 코드 집합을 `ctx` 로 주입받아 제외(소스: intradayScanner 의
  `intradayReady===true` 엔트리 코드). 집합 미주입 시 보수적으로 **전 종목 보호 안 함이 아니라**
  해당 보호만 skip(다른 보호는 유지) — engine-dev wiring 시 집합 공급 의무.

### D5.6 불변식 #2 보존 — evict ≠ 학습 정지 (절대 논증)

**evict 는 active scan 풀(watchlist MOMENTUM 멤버십)에서만 제거한다.** evict 된 종목의
**counterfactual / shadow ledger row 는 보존**된다:
- shadow 보유 종목은 D5.5 보유 보호로 **애초에 evict 불가** → 보유 학습 추적 무손상.
- 미보유 약세 멤버를 watchlist 에서 evict 해도, 그 종목의 shadow-trades.json / shadow-log.json
  / counterfactual ledger row 는 **삭제·중단 0**(watchlist 멤버십과 ledger 는 별도 영속).
  evict 는 `saveWatchlist`(`watchlistRepo.ts:639`)가 영속하는 watchlist 배열에서 entry 1건
  제거일 뿐, ledger write/nightlyReflection/ghost portfolio 경로 무접촉.
- 기존 `cleanupWatchlist`(`watchlistManager.ts:331`)도 `syncDetachedFromWatchlist()`
  (`:428`)로 동일 패턴(watchlist 제거 ≠ shadow 포지션 종료) 검증됨 — D5 evict 도 동일 의미론.
  evict 종목이 OPEN shadow 포지션이면 D5.5 가 이미 차단하므로 detach 동기화 대상도 아님.

→ **evict 가 Shadow 학습을 멈추지 않는다**(불변식 #2). evict 는 "신규 진입 후보 풀에서
제외"이지 "학습 중단"이 아니다.

## D5 flag / 상수 / 시그니처 계약 (engine-dev 구현 pin)

```
# ── D5 약세 종목 회전 (Intraday Weak Rotation) ─────────────
INTRADAY_WEAK_ROTATION_ENABLED=false              # default OFF (ADR-0157, === 'true')
INTRADAY_WEAK_ROTATION_MAX_PER_CYCLE=3            # 사이클당 evict 상한 (churn 방지, 0 이하/NaN→3)
# (margin/grace 는 상수 — ENV 노출 불요. 필요 시 후속 ADR 에서 ENV 승격.)
```

**SSOT 함수·상수 (intradayWeakRotation.ts co-locate):**

```ts
// @responsibility intradayWeakRotation — 신선 리더 admit 위한 MOMENTUM 약세 멤버 회전(evict) 정책 SSOT.

/** ADR-0628 D5 — 회전 kill-switch. default OFF → 현행 cap/cleanup byte-identical. */
export function isIntradayWeakRotationEnabled(): boolean {
  return process.env.INTRADAY_WEAK_ROTATION_ENABLED === 'true';
}

/** 사이클당 evict 상한 (기본 3, 하한 가드). */
export function getWeakRotationMaxPerCycle(): number {
  const raw = Number(process.env.INTRADAY_WEAK_ROTATION_MAX_PER_CYCLE);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 3;
}

/** 신선 리더가 evict 후보보다 이만큼(%p) 더 강해야 회전 (churn 방지 margin). */
export const WEAK_ROTATION_STRENGTH_MARGIN = 2.0;
/** bridge 신규 편입 grace (방금 admit 된 리더 thrash 차단). */
export const WEAK_ROTATION_GRACE_MS = 10 * 60 * 1000;

/** 회전 컨텍스트 — bridge 가 주입(신규 fetch 0; kospiDayReturn·신선 screener·보호 집합). */
export interface WeakRotationContext {
  /** 벤치마크 — leadershipBridge ctx.kospiDayReturn 재사용(상대강도 산출). */
  kospiDayReturn: number;
  /** 신선 리더 강도(LeaderCandidate.sectorRelativeStrength). */
  leaderStrength: number;
  /** 보유(shadow/live) 종목 코드 — getOpenPositions().trade.stockCode 집합. */
  heldCodes: ReadonlySet<string>;
  /** intradayReady 진행 중 종목 코드(미주입 시 해당 보호만 skip). */
  intradayActiveCodes?: ReadonlySet<string>;
  /** 신선 screener 강도 조회: code → changeRate(%) | null(미수록/ stale). */
  freshChangeRateOf: (code: string) => number | null;
  /** 이번 admission 사이클 누적 evict 수(상한 비교용, bridge 가 카운트). */
  evictedThisCycle: number;
}

/** evict 적격성(보호 목록 통과 시 true). D5.5 SSOT. */
export function isWeakRotationEvictable(
  entry: WatchlistEntry,
  ctx: WeakRotationContext,
): boolean;

/** evict 후보별 신선 약세 강도(낮을수록 약세). screener 미수록/ stale → null(회전 제외). */
export function weakRotationStrengthOf(
  entry: WatchlistEntry,
  ctx: WeakRotationContext,
): number | null;

/**
 * addToWatchlist(evictionStrategy) 주입용 팩토리. cap 만석 시 호출돼
 * 보호 제외·신선신호 보유 멤버 중 relativeChangeRate 최저 1건을 선택,
 * leaderStrength > weakest + MARGIN 이고 사이클 상한 미도달일 때만 evict(반환).
 * flag OFF / 상한 도달 / margin 미달 / 적격 후보 없음 → null(=기존 momentum_full fallback).
 */
export function buildWeakRotationEvictionStrategy(
  ctx: WeakRotationContext,
): (watchlist: WatchlistEntry[], entry: WatchlistEntry) => WatchlistEntry | null;
```

**배선 지점 (engine-dev 구체 pin):**

1. `leadershipBridge.ts:147` `addToWatchlist(list, entry)` 호출에 **3번째 인자**로
   `isIntradayWeakRotationEnabled()` 일 때만 `{ evictionStrategy: buildWeakRotationEvictionStrategy(rotationCtx) }`
   주입. flag OFF 면 옵션 미주입 → `addToWatchlist` 가 기존 default(`tryEvictWeakest`)
   사용(현행 byte-identical). `rotationCtx` 는 bridge 가 `ctx.kospiDayReturn`·후보
   `sectorRelativeStrength`·`getOpenPositions()`·`getScreenerCache()` 로 1회 조립.
2. 사이클 카운트: `bridgeLeadersToMomentum` 루프(`:126`)에서 evict 성공 시
   `rotationCtx.evictedThisCycle++` 갱신(상한 D5.4 적용). 기존 `result.added`/`addedCodes`
   집계·`saveWatchlist`(`:158`) 경로 재사용 — 신규 영속 경로 0.
3. `watchlistManager.addToWatchlist`/`tryEvictWeakest` **본체 무변경** — 기존 주입 seam 만 사용.

## D5 Patch Scope Guard (ADR-530) — 2차 확장 갱신

- **targetDomain**: screener · orchestrator (D5 는 screener 단일 — 1차 합산 2 도메인, 3 한계 내).
- **allowedFiles**:
  - `server/screener/intradayWeakRotation.ts` — **신규 모듈**: `isIntradayWeakRotationEnabled`
    / `getWeakRotationMaxPerCycle` / `WEAK_ROTATION_STRENGTH_MARGIN` / `WEAK_ROTATION_GRACE_MS`
    / `WeakRotationContext` / `isWeakRotationEvictable` / `weakRotationStrengthOf` /
    `buildWeakRotationEvictionStrategy`. (@responsibility 태그 의무.)
  - `server/screener/leadershipBridge.ts` — `addToWatchlist` 호출에 flag-gated `evictionStrategy`
    주입 + `rotationCtx` 조립 + 사이클 evict 카운트. `qualifiesAsLeader`/`buildEntryFromLeader`
    임계·본체 무변경.
  - `.env.example` — `INTRADAY_WEAK_ROTATION_ENABLED`·`INTRADAY_WEAK_ROTATION_MAX_PER_CYCLE` 문서화.
  - 대응 `*.test.ts`(intradayWeakRotation 단위 + leadershipBridge 회전 통합).
- **forbiddenFiles**: SourceSnapshot 모듈 · `autoTradeEngine` · Gate0~3 채점(`quantFilter`/
  `gate*ConfluenceScore`/`decompositionBuilder`/requiredScore=70 SSOT) · `kisClient.ts` 본체 ·
  `realDataKisGet` · `watchlistRepo.enforceSectionCaps`/`computeTrimScore`(save-time cap 무접촉) ·
  `watchlistManager.tryEvictWeakest`/`addToWatchlist` **본체**(주입 seam 만 사용, 본체 0줄) ·
  `shadowTradeRepo`/`shadowPositionLedger` write 경로(read-only `getOpenPositions`만) ·
  counterfactual/nightlyReflection/ghost portfolio · `src/**` · `aiUniverseService`.
- **expectedBehaviorChange**: flag ON 시, MOMENTUM cap 만석 + 신선 리더 admit 시도 시 보호
  제외·신선신호 보유 멤버 중 `relativeChangeRate` 최저 1건을 `leaderStrength > weakest+2.0%p`
  + 사이클 상한(3) 내에서 evict → 신선 리더 admit. flag OFF 시 변화 0(기존 `tryEvictWeakest`
  + `momentum_full` fallback byte-identical).
- **sourceSnapshotImpact**: NONE (watchlist 멤버십 메모리 조작만 — SourceSnapshot 무접촉).
- **executionImpact**: 현 SHADOW_ONLY 라 live 매수 영향 **NONE**. 보유 포지션 evict 원천 차단
  (D5.5). flag OFF byte-identical / ON 시 execution-adjacent(평가 풀 회전, 채점·주문 산식 0줄).
- **shadowLearningImpact**: **evict ≠ 학습 정지** — evict 는 active scan 풀(watchlist) 멤버십
  제거이며 evict 종목의 counterfactual/shadow ledger row 는 **보존**(D5.6). shadow 보유 종목은
  D5.5 보유 보호로 evict 불가 → 학습 추적 무손상. 불변식 #2 무위반.
- **providerImpact**: KIS quota 추가 **0** — 회전은 D1 이 이미 갱신한 `screener.json`
  (`getScreenerCache`) + `getOpenPositions`(영속 read) 재사용. 신규 fetch 0. KRX/Yahoo 0.
- **telegramImpact**: evict 는 기존 `[LeadershipBridge]` 로그(`leadershipBridge.ts:159`) +
  watchlist save 알림(`watchlistRepo.ts:710`) 경로 재사용 — 신규 알림 산식 0. (회전 가시화
  로그 1줄 추가 가능하나 dedup·산식 무변경.)
- **testsRequired**:
  (a) flag OFF → `addToWatchlist` 가 기존 `tryEvictWeakest` 사용, 회전 0(byte-identical).
  (b) 회전 발생 → cap 만석 + 신선 리더 강도 > 약세 멤버 + margin → 약세 1건 evict + 리더 admit.
  (c) 회전 미발생(margin 미달) → 신선 리더가 약세 멤버보다 ≤ +2.0%p → evict 0 → `momentum_full`.
  (d) 보호목록 제외 — SWING/CATALYST · shadow/live 보유(`heldCodes`) · MANUAL · isFocus ·
      grace 내 leadershipBridge · intradayActive 종목은 evict 후보에서 제외(가장 약해도 보존).
  (e) 사이클 상한 — 4개 신선 리더 admit 시도 시 evict 최대 3건(MAX_PER_CYCLE).
  (f) 신선신호 부재 fallback — screener 미수록 멤버(`freshChangeRateOf→null`)는 evict 제외.
  (g) ledger 보존 — evict 후 해당 종목 shadow-trades.json / counterfactual row 변경 0(read-only).
  (h) 보유 포지션 evict 절대 금지 — `heldCodes` 포함 종목은 relativeChangeRate 최저여도 보존.
- **rollbackPlan**: `INTRADAY_WEAK_ROTATION_ENABLED=false` 1줄(즉시 byte-identical — 기존
  cap/cleanup 16:00 EOD + 30분 그대로, `tryEvictWeakest` default 복귀). 신규 모듈은 flag OFF 시
  호출 0(dead path) — 영속/런타임 영향 0.

## D5 불변식 점검 (9대 불변식)

- **#1 (Trading Engine 항상 살아있음)**: 회전은 `bridgeLeadersToMomentum`(이미 실행 경로)
  내 메모리 watchlist 조작뿐 — 엔진 루프·tick 차단 0. 신선신호 조회 실패는 null fallback
  (회전 제외)으로 흡수, throw 전파 0. flag OFF 면 dead path.
- **#2 (Shadow Learning 무중단)**: D5.6 — evict 는 watchlist 멤버십 제거이며 ledger/
  counterfactual/nightlyReflection 무접촉. shadow 보유 종목은 D5.5 로 evict 불가. **학습 정지 0.**
- **#3 / #9 (SourceSnapshot SSOT · Gate 내부 provider 직접조회 금지)**: 회전은 발굴/watchlist
  레이어 메모리 조작 — SourceSnapshot·Gate 채점 무접촉. provider 직접조회 신설 0(신선 screener
  는 D1 이 kisClient 단일통로로 이미 갱신한 캐시 read).
- **#6 (Provider 장애 ≠ market signal)**: 신선신호 부재(screener 미수록/ stale)는 **회전 제외**
  (보수) — 약세 단정·bearish 변환 0. provider 결손을 evict 사유로 쓰지 않음.
- **#7 (AI_ESTIMATED L4 live 금지)**: changeRate = KIS L1. L4 신규 사용 0.
- **#8 (실거래 차단 ↔ Shadow 차단 분리)**: 보유 포지션(shadow/live) evict 원천 차단(D5.5) →
  실거래·shadow 보유 무영향. 회전은 미보유 약세 멤버의 "신규 진입 후보 풀 멤버십"만 조정 —
  실거래 차단 로직과 무관, shadow 판단 차단과도 무관(둘 다 evict 가 건드리지 않음).

## D5 Alternatives Considered

- **(a) `enforceSectionCaps` 확장(save-time 회전)** — 기각. save-time cap 강제와 admission
  rotation 은 별 책임(SRP). 또 save-time 은 신선 리더 컨텍스트(leaderStrength) 부재 →
  "리더 강도 > 약세" 조건 불가. admission-triggered seam 이 정확.
- **(b) periodic 스윕 모듈** — 기각. 자리 수요 없이 멤버를 흔들어 churn·shadow 노이즈 증가.
  admission-triggered 가 1:1 교체 보장으로 깔끔(운영자 권장안 일치).
- **(c) 약세 신호로 morning-fixed gateScore/return20d 사용** — 기각. 아침 고정값이라 "현재
  약세" 미반영 → 회전 무의미(운영자 명시 우려). 신선 screener changeRate 만이 장중 강도 반영.
- **(d) `WatchlistEntry` 에 `relativeReturn20d` 신선 필드 추가(src/types 확장)** — 기각.
  신선 20d 상대수익률을 watchlist 에 영속하려면 장중 재계산·write 파이프라인 신설 필요
  (신규 fetch/산식, ADR-0561 위반). 당일 벤치마크 상대강도(changeRate−kospi)가 신선 proxy 로
  충분하며 server-local·영속 0. src/types 무수정 원칙 유지.
- **(e) margin 0 (무조건 최약자 evict)** — 기각. noise 우위로 멤버 thrash. 2.0%p margin 으로
  의미 있는 강도차일 때만 회전.
- **(f) 보유 포지션도 evict 허용(active 풀 정리 우선)** — 기각/금지. 불변식 #2·#8 위반 +
  운영자 절대 제약. 보유는 D5.5 원천 차단.
- **(g) default ON** — 기각. opt-in(ADR-0157) + LIVE byte-equivalent 보존(검증 전 단계).

## D5 References (추가)

- `watchlistManager.ts:193`(AddToWatchlistOptions.evictionStrategy)·`:223`(addToWatchlist)·
  `:259`(tryEvictWeakest morning-fixed gateScore)·`:331`(cleanupWatchlist)·`:428`(syncDetachedFromWatchlist)
- `watchlistRepo.ts:46~70`(cap 상수)·`:150`(computeTrimScore)·`:208`(enforceSectionCaps)·
  `:291~433`(WatchlistEntry — relativeReturn20d 부재 확인)·`:639`(saveWatchlist)
- `leadershipBridge.ts:48~51,62`(ctx.kospiDayReturn)·`:109`(bridgeLeadersToMomentum)·
  `:126~155`(admit 루프)·`:147`(addToWatchlist)·`:148~150`(momentum_full)
- `stockScreener.ts:74~84`(ScreenedStock.changeRate)·`:101`(getScreenerCache)
- `shadowPositionLedger.ts:61`(getOpenPositions)·`shadowTradeRepo.ts:432`(trade.stockCode)
- 1차 D1~D4 · ADR-0551 · 0561 · 0157
