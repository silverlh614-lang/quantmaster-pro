# ADR-0441 — KIS Stream Bulk Apply Priority Wiring (재시작/재연결 30 슬롯 포화 재발 차단)

## 발급 일자
2026-05-07

## 사용자 명시 1순위 #1 (운영 안정성 직결)

> *"평상시 개별 구독 요청은 새 우선순위 정책을 타더라도, 재시작/재연결 시점에 예전
> 방식으로 전체 watchlist 를 밀어 넣으면 다시 30 슬롯이 낮은 우선순위 종목으로 차버릴
> 수 있습니다. 즉, 장애 복구나 Railway 재시작 후에 문제가 재발할 수 있습니다."*

## 배경

ADR-0437 (= 사용자 명시 ADR-0439) 가 KIS WebSocket 30-슬롯 구독을 우선순위 큐로
관리하는 SSOT (`kisWebSocketSubscriptionManager.ts`) 를 신설하고, ADR-0436
GateEligibility 결과를 *개별 구독 요청* 시점에 자연 활용하도록 wiring 했다.

그러나 *재시작/재연결 시점* 의 4 callsite — (a) `kis_stream_start` cron
(KST 평일 09:00) / (b) `kis_stream_watchdog` cron (KST 평일 09:05/15/30) /
(c) boot auto-connect (장중 재배포 직후) / (d) `/reconnect_ws` 텔레그램 명령 —
은 모두 *예전 방식* 인 `gateScore desc` 단순 정렬로 watchlist 를 정렬하고
top-30 codes 를 `startKisStream(codes)` 에 전달한다.

이는 다음 결함을 유발한다:

1. **보유 종목이 30 슬롯 밖으로 밀려남** — `gateScore` 가 낮은 보유 종목
   (long-term hold) 이 신규 발굴된 high-gateScore 종목에 의해 절삭. ADR-0437
   §"OPEN_POSITION priority 1000 절대 우선" 정책 무시.
2. **OBSERVE_ONLY 종목이 슬롯 점유** — `gateScore=2` 같은 관측 전용 종목이
   상위 30 안에 들어와 ENTRY_CANDIDATE 후보의 슬롯을 잠식 (Railway 재배포 직후
   특히 발생).
3. **invalid code (master missing / 4자리 / alphabet) 가 KIS API 거부 응답
   유도** — code=1006 강제 종료 위험 (ADR-0438 SSOT 위임 부재).

장애 복구나 Railway 재시작 후 ADR-0437 의 `[KIS-WS] [LIMIT] subscribeStock(...)
거부` 누적 결함이 재발한다.

## 문제

4 callsites 모두 ADR-0437 우선순위 매트릭스 무시:

```ts
// server/scheduler/kisStreamJobs.ts:18-23
function selectSubscribableCodes(entries: WatchlistEntry[]): string[] {
  return [...entries]
    .sort((a, b) => (b.gateScore ?? 0) - (a.gateScore ?? 0))  // ❌ ADR-0437 무시
    .slice(0, MAX_SUBSCRIPTIONS)
    .map((w) => w.code);
}

// server/telegram/commands/infra/reconnectWs.cmd.ts:43-46
const codes = [...watchlist]
  .sort((a, b) => (b.gateScore ?? 0) - (a.gateScore ?? 0))  // ❌ 동일 결함
  .slice(0, MAX_SUBSCRIPTIONS)
  .map(w => w.code);
```

## 결정

### 1. `server/clients/kisStreamCandidateBuilder.ts` 신규 SSOT

`startKisStream(codes[])` 호출자가 ADR-0437 우선순위 매트릭스를 통과하도록
정렬·절삭하는 단일 SSOT.

```ts
export const KIS_STREAM_GATE_THRESHOLDS = Object.freeze({
  ENTRY_CANDIDATE: 7.0,    // gateScore ≥ 7 → ENTRY_CANDIDATE (priority 800)
  WATCHLIST: 4.0,           // gateScore ≥ 4 → WATCHLIST (priority 500)
  // gateScore < 4 → OBSERVE_ONLY (priority 300)
});

export function selectKisStreamSubscribableCodes(
  watchlist: WatchlistEntry[],
  openPositionCodes: ReadonlySet<string>,
  maxSubscriptions: number,
): string[];

export async function deriveOpenPositionCodes(): Promise<Set<string>>;

export function buildKisStreamSubscriptionCandidates(
  input: BuildKisStreamCandidatesInput,
): SubscriptionCandidate[];

export function isKisStreamPriorityBuilderDisabled(): boolean;
```

분류 규칙 (사용자 명시 임계 SSOT 절대 변경 금지):
- 보유 종목 (active shadow) → **OPEN_POSITION priority 1000 절대 우선**
- watchlist + gateScore ≥ 7.0 → **ENTRY_CANDIDATE priority 800**
- watchlist + gateScore ≥ 4.0 → **WATCHLIST priority 500**
- watchlist + gateScore < 4.0 → **OBSERVE_ONLY priority 300**

invalid KRX code (`normalizeKrxCodeForWs(...) === null`) 는 자동 제외
(ADR-0438 SSOT 정합).

### 2. 4 callsites 모두 SSOT 위임

- `kisStreamJobs.ts kis_stream_start` (line 42-53)
- `kisStreamJobs.ts kis_stream_watchdog` (line 57-66)
- `kisStreamJobs.ts boot auto-connect` (line 78-94)
- `reconnectWs.cmd.ts execute()` (line 41-47)

모두 `selectKisStreamSubscribableCodes(entries, deriveOpenPositionCodes(), MAX_SUBSCRIPTIONS)`
호출로 격상. 호출자 측 inline `gateScore desc` 정렬 영구 제거 (정적 grep 가드).

### 3. `deriveOpenPositionCodes()` — active shadow trades read SSOT

`loadShadowTrades()` + status 분류 (PENDING / ORDER_SUBMITTED / PARTIALLY_FILLED /
ACTIVE / EUPHORIA_PARTIAL) + `getRemainingQty > 0` filter + `normalizeKrxCodeForWs`
정규화 → 보유 6자리 code Set.

순환 import 회피를 위해 *dynamic import* 사용 (kisStreamCandidateBuilder ↔
shadowTradeRepo 직접 import 시 module load 순서 의존성 위험).

영속 read 실패 시 빈 Set fallback (try/catch 격리, 매수 흐름 차단 안 함).

### 4. ENV 우회

`KIS_STREAM_PRIORITY_BUILDER_DISABLED=true` (default OFF, ADR-0157 정확 비교
의무 — `'1'` / `'TRUE'` / `'yes'` 거부) — 활성 시 legacy `gateScore desc`
fallback 100% 복원.

호출자 측 inline ENV 검사 0건 (`isKisStreamPriorityBuilderDisabled()` SSOT 헬퍼
위임).

## 우선순위 매트릭스 (ADR-0437 SSOT 재사용, 절대 변경 금지)

| Reason            | Priority | 매핑 조건                              |
|-------------------|----------|---------------------------------------|
| OPEN_POSITION     | 1000     | active shadow trade (`status` ∈ open) |
| LIVE_ELIGIBLE     | 900      | (본 PR scope 외 — entryEngine 호출자) |
| ENTRY_CANDIDATE   | 800      | watchlist + gateScore ≥ 7.0           |
| SHADOW_OBSERVABLE | 700      | (본 PR scope 외)                       |
| DART_CATALYST     | 600      | (본 PR scope 외)                       |
| WATCHLIST         | 500      | watchlist + gateScore ≥ 4.0           |
| OBSERVE_ONLY      | 300      | watchlist + gateScore < 4.0           |
| INVALID_CODE      | 0        | `normalizeKrxCodeForWs === null`       |

본 PR 은 *initial* `startKisStream(codes)` 호출용 priority-sorted top-30 codes 만
산출. post-connect bulk subscribe (`bulkApplySubscriptionsByPriority`) 는 후속 PR
scope 외.

## 12 invariants (정적 grep 회귀 가드 의무)

1. `gateScore desc` 단순 정렬 0건 (4 callsites 모두 SSOT 위임)
2. ADR-0437 우선순위 매트릭스 (1000/900/800/700/600/500/300/100/0) 정확 사용
3. 보유 종목 (active shadow) → OPEN_POSITION priority 1000 — 절대 우선
4. 워치리스트 entry → gateScore 임계 기반 ENTRY_CANDIDATE / WATCHLIST / OBSERVE_ONLY 분류
5. invalid code (`normalizeKrxCodeForWs(...) === null`) → builder 에서 제외
   (ADR-0438 SSOT 통합)
6. 30개 상한 — `slice(top-N)` 보장
7. LIVE 매매 본체 0줄 변경
8. KIS 주문 함수 5종 import 0건 (placeKisMarketBuyOrder / placeKisSellOrder /
   placeKisStopLossOrder / placeKisTakeProfitOrder / cancelKisOrder)
9. 외부 fetch / axios / node-fetch 추가 0
10. ENV `KIS_STREAM_PRIORITY_BUILDER_DISABLED=true` (default OFF, ADR-0157
    정확 비교) — 1줄 즉시 legacy `gateScore desc` 동작 복원
11. 호출자 측 inline ENV 검사 0건 (builder SSOT 위임)
12. `kisStreamClient.ts` `MAX_SUBSCRIPTIONS` 등 본체 무수정

## 잘못된 해결 방법 영구 차단

1. **호출자 측 `gateScore desc` 단순 정렬 재도입** — 정적 grep 회귀 가드로
   영구 차단 (`(b.gateScore ?? 0) - (a.gateScore ?? 0)` 패턴 부재 의무).
2. **보유 종목 OPEN_POSITION 무시** — `deriveOpenPositionCodes()` 호출 부재
   시 builder 에 빈 Set 전달되면 보유 종목이 watchlist gateScore 임계 기반
   분류로 격하 — 회귀 테스트가 *호출자 위치* 검증.
3. **invalid code fallback subscribe** — ADR-0437/0438 SSOT 정합. builder
   내부 `normalizeKrxCodeForWs === null` 자동 제외.
4. **`kisStreamClient.MAX_SUBSCRIPTIONS` 변경** — 본체 무수정 (정적 grep 가드).
   30 슬롯 상한은 KIS 단일 세션의 hard limit.
5. **외부 API 호출 도입** — builder 는 cache/persistence read-only. fetch /
   axios / node-fetch import 0건 정적 가드.
6. **ENV gate default ON** — default OFF 의무. ENV 정확 비교 (`=== 'true'`)
   ADR-0157 정합.

## LIVE 매매 본체 영향

**0줄 변경** — 본 PR 은 *4 callsites 의 호출 정렬 layer* 만 변경.

검증 매트릭스:
- `signalScanner.ts` / `signalScanner/**` / `entryEngine.ts` / `exitEngine/**`
  / `kisClient/**` / `orchestrator/**` / `autoTradeEngine*` / `trancheExecutor.ts`
  / `buyPipeline.ts` 모두 0줄 변경.
- `kisStreamClient.ts` (`MAX_SUBSCRIPTIONS` 등 상수) 본체 무수정.
- `kisWebSocketSubscriptionManager.ts` 본체 무수정 (SSOT 재사용만).

## KIS / KRX / Yahoo / Naver outbound

**0건 추가** — builder 는 정적 SSOT (`SUBSCRIPTION_PRIORITY_TABLE` /
`sortCandidatesByPriority` / `normalizeKrxCodeForWs`) + `loadShadowTrades`
영속 read-only.

`deriveOpenPositionCodes` 의 dynamic import 도 외부 API 호출 0건.

## 회귀 테스트

신규 `server/clients/kisStreamCandidateBuilderAdr0441.test.ts` — 38 케이스:

- ENV gate 4 (default OFF / 'true' / '1' 거부 / 'TRUE' 거부)
- KIS_STREAM_GATE_THRESHOLDS SSOT 정합 2 (ENTRY_CANDIDATE=7.0 / WATCHLIST=4.0
  + Object.freeze drift 가드)
- buildKisStreamSubscriptionCandidates 10 (보유 종목 OPEN_POSITION priority
  1000 / gateScore 9 → ENTRY_CANDIDATE 800 / gateScore 5 → WATCHLIST 500 /
  gateScore 2 → OBSERVE_ONLY 300 / gateScore undefined → OBSERVE_ONLY /
  보유+watchlist 중복 dedup / invalid code 제외 / 정렬 deterministic /
  lastUpdatedAt 정합 / .KS suffix normalize)
- selectKisStreamSubscribableCodes 5 (legacy fallback ENV / 30개 상한 절삭 /
  보유 우선 정렬 / 동률 정렬 / 빈 watchlist)
- deriveOpenPositionCodes 5 (5 active status 추출 / closed 제외 / remainingQty=0
  제외 / 영속 read 실패 빈 Set fallback / invalid stockCode 자동 제외)
- 4 callsites 정적 grep 가드 8 (kisStreamJobs SSOT 위임 / `selectSubscribableCodes`
  legacy 함수 부재 / `gateScore desc` 단순 정렬 부재 / reconnectWs.cmd SSOT 위임 /
  reconnectWs.cmd `gateScore desc` 부재 / KIS 주문 함수 5종 import 0 /
  autoTradeEngine + fetch + axios import 0 / ADR-0437 매트릭스 import 정합 /
  ENV gate 정확 비교)
- 통합 시나리오 4 (보유 5 + 워치리스트 50개 → 30 상한 + 보유 우선 +
  ENTRY_CANDIDATE 우선 + OBSERVE_ONLY 절삭 / 보유 30+ → 보유만으로 30 슬롯 +
  워치리스트 모두 절삭 / 빈 보유 + 빈 워치리스트 → 빈 codes)

## 잔여 후속 PR (사용자 명시)

- **1순위 #2 ADR-0442** (예정) — 다른 wiring 부채 (사용자 결정 시점)
- **1순위 #3 ADR-0443** (예정)
- **2순위 #2 ADR-0444** (예정)
- post-connect bulk subscribe (`bulkApplySubscriptionsByPriority` 본 SSOT 와의
  통합) — 운영 데이터 누적 후 별도 ADR

## ADR-0146 PR 자가 review 5 카테고리

- ✅ **A. LIVE 매매 안전성** — KIS/KRX/Yahoo/Naver quota 0 침범 / kisStreamClient
  / kisWebSocketSubscriptionManager 본체 무수정 / ENV 1줄 즉시 롤백 /
  AUTO_TRADE_ENABLED + emergencyStop 가드 무관 (read-only 정렬 layer).
- ✅ **B. wiring 완료 vs 인프라만** — 4 callsites 모두 wiring 완료 (PARTIAL 0건).
  PENDING_WIRING 신규 등재 불필요.
- ✅ **C. ADR 발급 무결성** — INDEX.md `다음 발급 0441` SSOT 사용 / 충돌 0 /
  파일명 prefix `0441-` 정확.
- ✅ **D. 회귀 테스트 적정성** — 38 케이스 / ~210 LoC SSOT → ≥18 케이스 heuristic
  목표 대비 2배. 정적 grep 가드 8종.
- ✅ **E. 정책 위반** — validate:all 16종 baseline 무회귀 (사전 baseline
  INDEX.md 22 + SilentDegradation 1 본 PR 무관).
