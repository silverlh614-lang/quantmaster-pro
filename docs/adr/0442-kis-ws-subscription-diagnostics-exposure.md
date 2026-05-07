# ADR-0442 — KIS WebSocket Subscription Diagnostics Exposure (운영자 슬롯 분배 가시화)

## 발급 일자
2026-05-07

## 사용자 명시 1순위 #2 (운영자 슬롯 분배 가시화)

> *"`formatKisWsSubscriptionSection` /scan_blockers 또는 /health 임베드
> (운영자 슬롯 분배 가시화)."*
>
> ADR-0437 §"잔여 후속 PR" 명시 — 운영자가 30 슬롯이 실제로 어떻게 분배되어
> 있는지 (open / live / shadow / watchlist / observe / rejected / evicted)
> 텔레그램 명령으로 즉시 확인 가능해야 한다.

## 배경

ADR-0437 (= 사용자 명시 ADR-0439) 가 KIS WebSocket 30-슬롯 구독을 우선순위 큐로
관리하는 SSOT (`kisWebSocketSubscriptionManager.ts`) 를 신설하면서 두 진단 함수
도 함께 export:

- `buildSubscriptionDiagnosis(ctx?)` — `_subscribedPriorities` 메모리 read 만,
  `SubscriptionDiagnosis` (10+ 필드 — total/limit/openPositionCount/
  liveEligibleCount/shadowObservableCount/watchlistCount/observeOnlyCount/
  invalidRejectedCount/lowPriorityRejectedCount/evictedCount/lastEvictedCode/
  lastEvictedReason) 반환.
- `formatKisWsSubscriptionSection(diag)` — 텔레그램 텍스트로 포맷
  (헤더 + summary line + 조건부 rejected/evicted 라인).

그러나 두 함수는 **호출자 0건 dead code** 상태였다. ADR-0437 §"잔여 후속 PR"
명시 — *"`formatKisWsSubscriptionSection` /scan_blockers 또는 /health 임베드"*.

운영자가 다음 시나리오에서 30 슬롯 분배를 즉시 확인할 텔레그램 진입점이 부재:

- ADR-0441 의 4 callsite (kis_stream_start cron / kis_stream_watchdog cron /
  boot auto-connect / `/reconnect_ws` 텔레그램 명령) 가 우선순위 큐로 마이그레이션
  됐지만 *현재 슬롯 분배* 가 정책대로인지 검증 불가.
- Railway 재배포 직후 슬롯이 보유 종목 우선으로 채워졌는지 vs OBSERVE_ONLY 가
  점유했는지 확인 불가.
- ADR-0437 의 `[KIS-WS] reject low priority ... limit=30 minPriority=...`
  로그가 누적되어도 *현재* 30 슬롯의 *우선순위 분포* 는 메모리 안에만 존재.

## 결정

### 1. ENV 헬퍼 SSOT — `isKisWsSubscriptionDiagDisabled`

`kisWebSocketSubscriptionManager.ts` 에 ADR-0157 정확 비교 의무 정합 ENV 헬퍼 추가:

```ts
/**
 * ADR-0442 — 진단 섹션 노출 ENV gate (default OFF).
 * 활성 시 `/scan_blockers` 와 `/health` 명령에서 KIS WebSocket Subscription
 * 진단 섹션 미노출. ADR-0437 SSOT 본체는 그대로 작동.
 */
export function isKisWsSubscriptionDiagDisabled(): boolean {
  return process.env.KIS_WS_SUBSCRIPTION_DIAG_DISABLED === 'true';
}
```

기존 `isKisWsSubscriptionPriorityDisabled` 와 동일 패턴 — `'1'` / `'TRUE'` /
`'yes'` 모두 거부 (ADR-0157 정확 비교 의무).

### 2. `/scan_blockers` full section 임베드

`server/telegram/commands/system/scanBlockers.cmd.ts` 의 base + degraded +
supplyProvider + counterfactual + promotion + universe section 다음에
ADR-0442 진단 섹션 추가.

```ts
// ADR-0442 — KIS WebSocket Subscription Queue 진단 섹션.
// read-only — buildSubscriptionDiagnosis 가 _subscribedPriorities 메모리 read 만.
// try/catch 격리 — 진단 throw 가 base 메시지 차단 안 함.
let kisWsSubscriptionSection: string | null = null;
try {
  if (!isKisWsSubscriptionDiagDisabled()) {
    const diag = buildSubscriptionDiagnosis();
    if (diag.total > 0) {
      kisWsSubscriptionSection = formatKisWsSubscriptionSection(diag);
    }
  }
} catch (err) {
  console.warn('[scan_blockers] kis-ws subscription 섹션 빌드 실패 ...', err);
}

const parts: string[] = [baseMessage, ...sections];
if (kisWsSubscriptionSection) parts.push(kisWsSubscriptionSection);
```

`total > 0` 가드 — 구독 0건 시점 (부팅 직후 / stream 미연결) 에 운영자 noise
차단. `formatKisWsSubscriptionSection` 의 첫 줄 헤더
(`🛰️ KIS WebSocket Subscription Queue (ADR-0437)`) 그대로 노출.

### 3. `/health` compact 라인 임베드

`HealthSnapshot` 에 옵셔널 필드 추가:

```ts
// ── ADR-0442: KIS WebSocket Subscription Queue 진단 (운영자 슬롯 분배 가시화) ──
/**
 * 30 슬롯 분배 (open/live/shadow/watchlist/observe/rejected/evicted).
 * undefined = 진단 비활성 (ENV `KIS_WS_SUBSCRIPTION_DIAG_DISABLED=true`) 또는 수집 실패.
 * total=0 도 정상 진단 — 부팅 직후 또는 stream 미연결 시점.
 */
kisWsSubscription?: SubscriptionDiagnosis;
```

`collectHealthSnapshot()` 에 try/catch 격리 wrapper:

```ts
function safeBuildKisWsSubscriptionDiagnosis(): SubscriptionDiagnosis | undefined {
  try {
    if (isKisWsSubscriptionDiagDisabled()) return undefined;
    return buildSubscriptionDiagnosis();
  } catch (e) {
    console.warn('[Diagnostics] kis-ws subscription 진단 수집 실패 — undefined fallback:', e);
    return undefined;
  }
}
```

### 4. `formatKisWsSubscriptionLines` SSOT 신규 (compact 형식)

`formatKisWsSubscriptionSection` 은 헤더 (`🛰️ KIS WebSocket Subscription Queue (ADR-0437)`)
+ summary + 조건부 rejected/evicted 라인 multi-line section. `/scan_blockers`
용으로는 적합하지만 `/health` 메시지에는 *컴팩트 한 줄 (또는 두 줄)* 형식이 적합.

```ts
/**
 * KIS WebSocket Subscription Queue 진단을 /health 메시지용 compact 라인으로 포맷.
 *
 * 분기:
 *   1. diag 부재 → 빈 문자열 (라인 미노출)
 *   2. rejected/evicted 0건 → 한 줄
 *   3. rejected 또는 evicted > 0 → 두 줄 ("실시간 슬롯: ...\n  └ rejected N | evicted M")
 */
export function formatKisWsSubscriptionLines(
  diag: SubscriptionDiagnosis | undefined,
): string {
  if (!diag) return '';
  const baseLine = `실시간 슬롯: ${diag.total}/${diag.limit} (open ${diag.openPositionCount} / live ${diag.liveEligibleCount} / shadow ${diag.shadowObservableCount} / watch ${diag.watchlistCount} / observe ${diag.observeOnlyCount})`;
  const rejected = diag.invalidRejectedCount + diag.lowPriorityRejectedCount;
  if (rejected === 0 && diag.evictedCount === 0) {
    return baseLine;
  }
  return `${baseLine}\n  └ rejected ${rejected} | evicted ${diag.evictedCount}`;
}
```

`formatHealthMessage` 의 "실시간호가:" 라인 직후, 마지막 구분선 이전 위치에
조건부 wiring:

```ts
const kisWsSubLines = formatKisWsSubscriptionLines(s.kisWsSubscription);
return (
  /* ... 기존 라인들 ... */
  `실시간호가: ${...}\n` +
  (kisWsSubLines ? `${kisWsSubLines}\n` : '') +
  `─────────────────────\n` +
  `<i>/refresh_token — KIS 토큰 강제 갱신</i>`
);
```

## 12 invariants (정적 grep / 회귀 가드 의무)

1. **read-only** — `_subscribedPriorities` 메모리 read 만 (영속·메모리 write 0).
2. **KIS 주문 함수 5종 import 0건** (`placeKisMarketOrder` / `placeKisSellOrder`
   / `cancelKisOrder` / `placeKisStopLossOrder` / `placeKisTakeProfitOrder`).
3. **외부 API 호출 추가 0건** (KIS / KRX / Yahoo / Naver outbound 0).
4. **ENV `KIS_WS_SUBSCRIPTION_DIAG_DISABLED` default OFF** (ADR-0157 정확 비교).
5. **ADR-0437 SSOT 본체 0줄 변경** — `buildSubscriptionDiagnosis` /
   `formatKisWsSubscriptionSection` 호출만 추가, 본체 무수정.
6. **`/health` 와 `/scan_blockers` 두 명령 wiring 정합** — 양쪽 모두 동일
   ENV gate + try/catch 격리 적용.
7. **try/catch 격리** — 진단 throw 가 base 메시지 / health 스냅샷 차단 안 함.
8. **LIVE 매매 본체 0줄 변경** (`signalScanner.ts` / `entryEngine.ts` /
   `exitEngine/**` / `kisClient/**` / `orchestrator/**` / `autoTradeEngine*` /
   `trancheExecutor.ts` / `buyPipeline.ts` 모두 0줄).
9. **autoTradeEngine / orderExecutor / trancheExecutor import 0건** (정적 grep).
10. **Gate threshold + condition weight + STRONG_BUY 조건 0 변경**.
11. **virtual account holdings/cash 무수정**.
12. **ADR-0157 ENV 정확 비교 의무 정합** — `'1'` / `'TRUE'` / `'yes'` 거부.

## 잘못된 해결 방법 영구 차단

- **ADR-0437 SSOT 본체 변경** — `buildSubscriptionDiagnosis` /
  `formatKisWsSubscriptionSection` 본체 수정 시 다른 호출자 (현재 0개, 향후 추가
  예상) 의 회귀 위험. 호출만 추가 의무.
- **`_subscribedPriorities` write** — 진단은 read-only. write 시 우선순위 큐 정책
  무결성 위반.
- **진단 throw 가 base 메시지 / health 스냅샷 차단** — try/catch 격리 의무.
- **ENV default ON** — 운영자 명시 비활성화 시에만 숨겨야 함 (default OFF).
- **`/health` 와 `/scan_blockers` 동일 형식 강제** — 두 명령 다른 컨텍스트.
  - `/scan_blockers` = full section (헤더 + multi-line)
  - `/health` = compact 라인 (한 줄 또는 두 줄)
- **외부 API 추가 호출** — 진단은 메모리 read 만. KIS / KRX / Yahoo / Naver
  outbound 0건 의무.
- **autoTradeEngine / orderExecutor / trancheExecutor import 도입** — 진단 모듈
  은 매매 엔진과 결합 금지.
- **Gate threshold / virtual account 변경** — 진단 PR scope 외.

## 회귀 테스트 신규 (총 27 케이스)

### `kisWebSocketSubscriptionManagerAdr0442.test.ts` (6 케이스)

ENV gate `isKisWsSubscriptionDiagDisabled` (default OFF, ADR-0157 정확 비교):

- default (env 미설정) → false
- `'true'` 정확 매칭 → true
- `'1'` 거부
- `'TRUE'` 거부 (대소문자 일치 의무)
- `'yes'` 거부
- `'false'` / 빈 문자열 → false

### `diagnosticsKisWsSubscriptionAdr0442.test.ts` (6 케이스)

`collectHealthSnapshot` 의 `kisWsSubscription` wiring:

- default ENV → kisWsSubscription 정의됨 + total=0 (구독 0건 시점)
- mock subscribe 1건 → kisWsSubscription.total=1 + open/live/shadow 카운트 정합
- ENV ON (`KIS_WS_SUBSCRIPTION_DIAG_DISABLED=true`) → kisWsSubscription
  undefined (구독 1건 있어도)
- `buildSubscriptionDiagnosis` throw mock → undefined + console.warn (try/catch
  격리)
- HealthSnapshot 타입에 `kisWsSubscription?: SubscriptionDiagnosis` 옵셔널 필드
  존재 (정적 grep 가드)
- `collectHealthSnapshot` 안에 `safeBuildKisWsSubscriptionDiagnosis` wrapper
  + try/catch 사용 (정적 grep 가드)

### `healthCmdKisWsAdr0442.test.ts` (10 케이스)

`formatKisWsSubscriptionLines` SSOT (compact 형식):

- diag undefined → 빈 문자열
- diag.total=0 정상 → 한 줄
- rejected/evicted 모두 0 → 한 줄만
- rejected (lowPriority) > 0 → 두 줄 (`└ rejected N | evicted M`)
- invalidRejected + lowPriorityRejected 합산 표시
- evicted > 0 (rejected=0) → 두 줄
- rejected + evicted 모두 양수 → 두 줄 합산

`formatHealthMessage` 통합:

- kisWsSubscription 부재 → "실시간 슬롯:" 라인 미노출
- kisWsSubscription 정상 → "실시간 슬롯:" 라인 노출 + 카운트 정합
- rejected > 0 → "└ rejected" 라인 노출

### `scanBlockersKisWsAdr0442.test.ts` (5 케이스)

`/scan_blockers` 의 ADR-0442 진단 섹션 wiring:

- default ENV + 구독 1건 (total>0) → kisWsSubscription 섹션 노출
- default ENV + 구독 0건 (total=0) → 섹션 미노출 (운영자 noise 차단)
- ENV `KIS_WS_SUBSCRIPTION_DIAG_DISABLED=true` → 섹션 미노출
- `buildSubscriptionDiagnosis` throw → baseMessage 만 + console.warn (try/catch
  격리)
- 정적 grep — ADR-0442 import 3종 + `parts.push(kisWsSubscriptionSection)` 호출
  + try/catch 패턴 + ADR-0442 추적 주석 + `total > 0` 가드

## 운영자 사용 시나리오

### 시나리오 1 — 슬롯 분배 정책 검증 (Railway 재배포 직후)

운영자가 `/scan_blockers` 입력:

```
🛡️ [매수 차단 사유 분포]
... (base + 다른 섹션) ...

🛰️ KIS WebSocket Subscription Queue (ADR-0437)
total: 28/30 | open: 5 | live: 8 | shadow: 6 | watchlist: 7 | observe: 2
rejected: 12 (invalid: 0, low-priority: 12) | evicted: 3
lastEvicted: 247540 reason=OBSERVE_ONLY
```

판단:
- 보유 종목 5개 모두 슬롯 점유 ✓ (OPEN_POSITION priority 1000 정상)
- ENTRY_CANDIDATE 8 + SHADOW_OBSERVABLE 6 진입 직전 후보 정상
- WATCHLIST 7 + OBSERVE_ONLY 2 잔여 14 슬롯 적정 배분
- rejected 12 (low-priority) — 31~42번째 후보 정상 거부 (KIS quota 보호)
- evicted 3 — OBSERVE_ONLY 자연 evict (정책 정합)

### 시나리오 2 — `/health` 한눈 진단

운영자가 `/health` 입력:

```
🩺 [파이프라인 헬스체크] (uptime 2.5h / mem 256MB / build abc1234)
판정: 🟢 OK
─────────────────────
... (기존 라인들) ...
실시간호가: ✅ 28종목
실시간 슬롯: 28/30 (open 5 / live 8 / shadow 6 / watch 7 / observe 2)
  └ rejected 12 | evicted 3
─────────────────────
/refresh_token — KIS 토큰 강제 갱신
```

운영자 1초 인지 — 슬롯이 *어떤 우선순위* 로 채워져 있는지.

### 시나리오 3 — 운영자 비활성화 (ENV)

`KIS_WS_SUBSCRIPTION_DIAG_DISABLED=true` 설정 시 두 명령 모두 진단 섹션 미노출.
ADR-0437 SSOT 본체는 그대로 작동 — 우선순위 큐 / eviction / 진단 데이터 수집 동일.

## 검증

- vitest 신규 27/27 PASS (6 + 6 + 10 + 5)
- 인접 server/clients/kisWebSocketSubscriptionManager (94/94) +
  server/health (166/166) + server/telegram/commands/system/scanBlockers +
  health.cmd (15/15) 무회귀
- `npx tsc --noEmit -p tsconfig.server.json` EXIT=0 (변경 파일 0 errors)
- `npx tsc --noEmit -p tsconfig.json` EXIT=0
- KIS / KRX / Yahoo / Naver outbound 0건 (영속·메모리 read-only)
- LIVE 매매 본체 0줄 변경 (signalScanner / entryEngine / exitEngine/** /
  kisClient/** / orchestrator/** / autoTradeEngine* / trancheExecutor /
  buyPipeline 모두 0줄)
- ADR-0146 PR 자가 review 5 카테고리 모두 PASS

## 잔여 후속 PR (사용자 명시)

- 1순위 #3 (예정)
- 2순위 #2 (예정)
- post-connect bulk subscribe — `bulkApplySubscriptionsByPriority` 와 통합
  (운영 데이터 누적 후 별도 ADR)
- `/health` 컴팩트 라인 형식 재조정 — 운영 1~2주 누적 후 사용자 피드백 기반

## 참고

- ADR-0437 — KIS WebSocket Subscription Priority Queue (= 사용자 명시 ADR-0439).
  본 PR 의 진단 SSOT 신설 위치.
- ADR-0438 — Symbol Resolver SSOT (= 사용자 명시 ADR-0442). 본 PR 무관 (별도 분기,
  같은 사용자 의도 ADR 번호).
- ADR-0441 — KIS Stream Bulk Apply Priority Wiring. 본 PR 직속 선행 (재시작/
  재연결 시점 wiring) — 슬롯 분배 결과를 본 PR 가 노출.
- ADR-0157 — ENV `=== 'true'` 정확 비교 의무 정책.
- ADR-0146 — PR 자가 review 5 카테고리 의무.
