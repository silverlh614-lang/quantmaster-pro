# ADR-0508 — SIGTERM Graceful Inflight Approval Drain

**Date:** 2026-05-13
**Status:** Accepted
**Related:** ADR-0017 (commandRegistry SSOT), ADR-0077 (TradeSignalStatus), ADR-0146 (PR 자가 review), ADR-0157 (ENV 정확 비교), ADR-0191 (Position Truth SSOT), ADR-0193 (block-new-buy symmetric coupling), ADR-0194 (Telegram block guard cmds), ADR-0504 (Position Card Source Validation), Patch-SHADOW-APPROVAL-DEDUP-001 (PR #923 dedupeKey SSOT)

---

## Context

PR #923 `Patch-SHADOW-APPROVAL-DEDUP-001` 머지 후 운영 보고 — *"승인 후 매수 체결은 없고 메세지만 반복"* (오픈엣지테크놀로지·세나테크놀로지 등 동일 종목 Shadow approval 카드 다수회 반복 발송 + 사용자가 클릭한 승인 메시지가 영속되지 않음). 사용자가 Telegram 인라인 버튼으로 ✅ 승인을 클릭했음에도 `data/shadow-trades.json` 에 trade 가 영속되지 않고, 다음 cron 스캔 사이클에 동일 종목 카드가 *처음 카드로* 다시 발송되는 패턴.

원인 audit 결과 — 두 in-memory 상태가 process restart 시점에 휘발:

1. **`pendingApprovals` Map (buyApproval.ts:159)** — `Map<tradeId, PendingApproval>` 로 `requestBuyApproval` 호출 시 만들어진 `Promise<ApprovalAction>` 의 `resolve` 함수를 보관. 사용자가 ✅/❌/⏸ 클릭하면 `handleBuyApprovalCallback` 이 Map 에서 entry 를 꺼내 `pending.resolve(action)` 호출 → `buyPipeline.createBuyTask` 의 `await approvalPromise` 가 깨어나 Shadow trade 영속 + Telegram 완료 메시지 발송.

2. **`shadowApprovalDedupeStore._store` Map** — PR #923 의 6-state machine 영속. dedupeKey 별 state (PENDING/APPROVED/REJECTED/SKIPPED/EXPIRED/DEDUPED) 추적.

**결함 시나리오 (운영 보고 재현)**:
1. KST 11:28 — cron 스캔 → Shadow approval 카드 발송 → `pendingApprovals.set(tradeId, {...resolve})` + `recordPendingShadowApproval(...)` → 사용자 Telegram 알림 수신.
2. KST 11:30 — Railway 재배포 (PR #923 머지 직후 deploy timing) → SIGTERM → 기존 `shutdown()` 함수가 AI 캐시 flush + HTTP server close 만 수행 → process 종료.
3. KST 11:31 — 사용자가 ✅ 클릭 → callbackQuery 가 새 process 의 `pendingApprovals` Map 으로 도착하지만 *해당 tradeId 없음* (Map 휘발) → `"이미 처리된 요청입니다."` 응답 + Promise unresolved 영구. `data/shadow-trades.json` 영속 0건.
4. KST 11:33 — 다음 cron 사이클 → 동일 종목 평가 → 새 dedupe store 도 empty → 새 dedupeKey 생성 → *같은 종목 카드 재발송*.

PR #923 의 dedupeKey SSOT 가 *runtime within single process* 의 중복 차단은 완벽히 보장하지만, *process restart 사각지대* (배포 / OOM 재시작 / `/exit` 명령 등) 에서는 effective 0. 운영자에게 *클릭했는데 왜 안 돼?* 의 정확한 원인 (process 가 restart 됐다) 가 보이지 않는 silent degradation.

본 ADR 은 SIGTERM/SIGINT 수신 시 모든 inflight approval Promise 를 graceful 하게 `'SKIP'` 으로 resolve 하여 호출자 측 `await requestBuyApproval` 이 무한 대기에 빠지지 않게 보장한다. 사용자 측 Telegram 메시지는 그대로 남고 (process 종료라 편집 불가), 영속 dedupe store 도 휘발이지만 — 사용자가 다음 부팅 후 다시 클릭하면 "이미 처리된 요청입니다." 응답을 받아 *왜 안 되는지* 시각적으로 명확하다.

---

## Decision

`server/telegram/buyApproval.ts` 에 `drainPendingApprovals()` SSOT 추가하고 `server/index.ts` 의 `shutdown()` 핸들러 (SIGTERM/SIGINT 양쪽) 진입 직후 호출한다.

### 동작 명세

```typescript
export function drainPendingApprovals(opts?: {
  signal?: string;
  reason?: 'GRACEFUL_SHUTDOWN' | 'OPERATOR_INITIATED' | 'TEST';
}): InflightApprovalDrainSummary;
```

각 inflight `pendingApprovals` entry 에 대해:

1. `clearTimeout(pending.timer)` — auto-approval timer 차단 (process 종료 후에도 잔존 타이머 발화 가능성 0)
2. `pending.shadowDedupeKey && pending.mode === 'SHADOW'` 면 `markShadowApprovalSkipped(dedupeKey)` 호출 — dedupe store state 전이 (PENDING → SKIPPED) + dedupe 내부 timer clearTimeout
3. `pendingApprovals.delete(tradeId)` — Map mutate
4. `pending.resolve('SKIP')` — Promise 해제 → 호출자 측 `await requestBuyApproval` 이 깨어나 'SKIP' 분기 진입 (Shadow trade 영속 0, KIS 주문 호출 0)

### 결정 트리 우선순위 SSOT (절대 변경 금지)

| 우선순위 | 분기 | 동작 |
|----------|------|------|
| 1 | `INFLIGHT_APPROVAL_DRAIN_DISABLED === 'true'` | summary `{drained:0, disabled:true}` 즉시 반환 |
| 2 | Map 빈 상태 | summary `{drained:0}` 반환 (idempotent) |
| 3 | 각 entry per iteration | clearTimeout → dedupe transition → Map.delete → resolve('SKIP') |
| 4 | entry 측 resolve throw | `errors++` + 다음 entry 계속 (drain 전체 차단 금지) |
| 5 | dedupe store throw | `errors++` + Map.delete + resolve 계속 |

### Schema — `InflightApprovalDrainSummary`

```typescript
export interface InflightApprovalDrainSummary {
  drained: number;                         // 총 drain 된 entry 수
  liveDrained: number;                     // LIVE mode entry 수
  shadowDrained: number;                   // SHADOW mode entry 수
  shadowDedupeKeysMarkedSkipped: number;   // dedupe store SKIPPED 전이 수
  errors: number;                          // resolve/dedupe throw 카운트
  drainedAtIso: string;                    // drain 시각 ISO-8601 UTC
  signal?: string;                         // SIGTERM / SIGINT / undefined
  reason: 'GRACEFUL_SHUTDOWN' | 'OPERATOR_INITIATED' | 'TEST';
  executionImpact: 'NONE';                 // literal type 강제
  liveOrderPlaced: false;                  // literal type 강제
  disabled?: boolean;                      // ENV gate 활성 시 true
}
```

### SIGTERM/SIGINT wiring (server/index.ts:429+)

```typescript
const shutdown = (signal: string) => {
  console.log(`[Server] ${signal} 수신 — graceful shutdown 시작`);
  try { markCleanShutdown(bootInfo.current.bootId, signal); } catch {}
  // ADR-0508 — SIGTERM graceful inflight approval drain
  try {
    const summary = drainPendingApprovals({ signal, reason: 'GRACEFUL_SHUTDOWN' });
    if (summary.drained > 0 || summary.errors > 0) {
      console.log(`[InflightApprovalDrain] ... (ADR-0508)`);
    }
  } catch (e) {
    console.warn('[InflightApprovalDrain] error during shutdown (ADR-0508):', e);
  }
  // AI cache flush + server.close() unchanged
  // ...
};
```

**호출 순서 (graceful order)** — `markCleanShutdown` → `drainPendingApprovals` → AI 캐시 flush → `server.close()` → `setTimeout` 10초 force exit. drain 은 동기 함수라 race 0건.

### ENV 우회

`INFLIGHT_APPROVAL_DRAIN_DISABLED=true` (default OFF, ADR-0157 정확 비교 의무 — `=== 'true'`). 1줄 즉시 legacy 동작 (drain skip + 기존 shutdown 흐름) 복원. `'1'` / `'TRUE'` / `'yes'` / 빈값 모두 default 동작 유지.

---

## Safety Invariants (절대 변경 금지)

1. **LIVE 매매 본체 0줄 변경** — `signalScanner.ts` / `entryEngine.ts` / `exitEngine/**` / `kisClient/**` / `orchestrator/**` / `autoTradeEngine*` / `trancheExecutor.ts` / `buyPipeline.ts` 모두 무수정 (`git diff --stat origin/main`).
2. **KIS 주문 함수 5종 import 0건** — `placeKisMarketOrder` / `placeKisSellOrder` / `placeKisStopLossOrder` / `placeKisTakeProfitOrder` / `cancelKisOrder` (정적 grep 가드 회귀 테스트).
3. **autoTradeEngine / orderExecutor / trancheExecutor import 0건** — 정적 grep 가드.
4. **외부 API (fetch / axios / node-fetch) 호출 0건** — drain SSOT 는 순수 함수.
5. **Gate threshold + condition weight + STRONG_BUY 조건 + requiredScore + UNKNOWN penalty 변경 0**.
6. **virtual account holdings/cash 무수정**.
7. **자동 paper/live/normal-shadow 체결 승격 0** — drain 은 'SKIP' resolve 만.
8. **`executionImpact: 'NONE'` literal type 강제** — TypeScript 컴파일 타임에 호출자 측 invariant 위반 즉시 fail.
9. **`liveOrderPlaced: false` literal type 강제** — 동일.
10. **ENV `=== 'true'` 정확 비교 의무** (ADR-0157 정합 — `'1'`/`'TRUE'`/`'yes'` 모두 default 동작 유지).
11. **호출자 측 inline ENV 검사 0건** — `isInflightApprovalDrainDisabled()` SSOT 위임.
12. **drain 호출 try/catch 격리** — drain throw 가 shutdown 흐름 (AI 캐시 flush / server.close) 차단 금지.
13. **단일 호출 idempotent** — 이미 빈 Map 재호출 시 `drained: 0, errors: 0` 안전.
14. **drain 호출 위치 = `markCleanShutdown` 직후 + `server.close()` 직전** — graceful 순서 강제 (race 차단).
15. **SIGTERM + SIGINT 양쪽 등록** — Railway 재배포 (SIGTERM) + 로컬 Ctrl+C (SIGINT) 모두 보호.

---

## 잘못된 해결 방법 (영구 차단)

1. **`pendingApprovals` 영속화 (`data/pending-approvals.json` 신설)** — 사용자 4/30 정책 "강제 마이그레이션 금지" 위반 + `Promise` 의 `resolve` 함수는 직렬화 불가 (function reference) → 부팅 후 복원 시 호출자 측 `await` 가 *다른 process 의 Promise* 를 기다리는 상황 불가. 본 PR scope 외 / 별도 ADR 의무.
2. **`shadowApprovalDedupeStore._store` 영속화** — PR #923 본문에서 명시적으로 "in-memory 만, 재배포 시 휘발" 정책. 본 PR 변경 0.
3. **드레인 시 `pending.resolve('APPROVE')` 호출** — 사용자가 실제로 클릭하지 않은 승인을 임의로 '승인'으로 처리하는 결함 — 사용자 절대 금지 정책 (Shadow 학습 데이터 오염).
4. **드레인 시 KIS 주문 호출** — drain 은 'SKIP' resolve 만, 어떠한 외부 API 호출도 금지.
5. **drainPendingApprovals 가 호출자 측 `await` 를 무시하고 직접 trade 영속** — buyPipeline 의 흐름 의무 (절대 우회 금지).
6. **ENV default ON** — 본 PR 은 운영 환경 즉시 활성화가 의도이지만, ADR-0157 정합 + 회귀 위험 격리를 위해 default OFF (운영자 결정 위임) ENV `=== 'true'` 명시 가능 + 회귀 시 1줄 즉시 비활성.
7. **호출자 측 inline `process.env.INFLIGHT_APPROVAL_DRAIN_DISABLED` 검사** — SSOT 헬퍼 위임 의무 (drift 위험).
8. **drain 후 추가 텔레그램 메시지 발송** — process 가 종료되는 시점이라 outbound HTTP 호출은 race + 비용 + Telegram quota 부담. drain 은 *Promise 해제* 만, 사용자에게 *왜 안 되는지* 는 *클릭 시 "이미 처리된 요청입니다."* 응답으로 자연 노출.

---

## Regression Tests (32 신규 케이스, server/telegram/inflightApprovalDrainAdr0508.test.ts)

### Group A — ENV Gate (ADR-0157 정확 비교)
- A1. default ENV 미설정 → false (drain 활성)
- A2. ENV='true' → true (drain 비활성)
- A3. ADR-0157 정확 비교 — `'1'`/`'TRUE'`/`'yes'`/`'Yes'`/`'on'`/빈값 모두 false
- A4. ENV='false' 명시 → false

### Group B — drainPendingApprovals 기본 동작
- B1. 빈 Map → 모든 카운트 0
- B2. idempotent — 양쪽 모두 drained=0
- B3. drainedAtIso ISO-8601 UTC 형식
- B4. signal/reason propagate (SIGTERM + GRACEFUL_SHUTDOWN)
- B5. reason 미전달 → GRACEFUL_SHUTDOWN default
- B6. signal 미전달 → undefined

### Group I — literal type invariant
- I1. executionImpact === 'NONE' 항상
- I2. liveOrderPlaced === false 항상
- I3. ENV disabled 시에도 invariant 보존
- I4. ENV disabled 시 reason 보존

### Group F — 외부 관측 함수와의 idempotent 협력
- F1. drain 후 resolvePendingApproval('nonexistent') → false
- F2. getPendingApprovalCount() ≥ 0
- F3. hasPendingApproval('999999') → false
- F4. listPendingApprovals() → 빈 배열

### Group C — shadowApprovalDedupeStore 상호작용
- C1. dedupe store API 정상 동작 확인 (markShadowApprovalSkipped → state=SKIPPED)
- C2. dedupe store 빈 상태에서도 drain summary 정상

### Group J/K — 정적 grep 가드
- J1. buyApproval.ts KIS 주문 함수 5종 import 0건 (주석 strip 후)
- J2. buyApproval.ts autoTradeEngine / orderExecutor / trancheExecutor import 0건
- J3. buyApproval.ts 외부 fetch / axios / node-fetch import 0건
- J4. buyApproval.ts drainPendingApprovals SSOT export 의무
- J5. buyApproval.ts ADR-0508 추적 주석 + ADR-0157 정확 비교 명시
- K1. server/index.ts drainPendingApprovals import + 호출
- K2. server/index.ts drain 호출 try/catch 격리 (multi-line)
- K3. server/index.ts SIGTERM + SIGINT 양쪽 등록 보존
- K4. server/index.ts drain 호출이 server.close() 보다 먼저
- K5. server/index.ts drain 호출이 markCleanShutdown 직후

### Group T — type contract
- T1. summary keys 정확 set
- T2. reason 3-value enum (GRACEFUL_SHUTDOWN / OPERATOR_INITIATED / TEST)

**결과 — 32/32 PASS + 인접 server/telegram/buyApproval.dataQuality + buyApproval.statusWiring + shadowApprovalDedupePatch001 26 무회귀 = 총 58/58 PASS.**

---

## Out of Scope (잔여 후속 PR)

1. **`pendingApprovals` 영속화** — Promise resolve 함수 직렬화 불가, 별도 ADR 의무 (`tradeId → tradeSignalStatus.markBlocked('GRACEFUL_SHUTDOWN_DRAIN')` 영속 lane 도입 검토).
2. **`shadowApprovalDedupeStore._store` 영속화** — PR #923 정책 보존, 별도 ADR.
3. **운영자 `/drain_approvals` 텔레그램 명령** — 수동 트리거 (`reason='OPERATOR_INITIATED'`) 별도 PR.
4. **drain summary 텔레그램 알림** — 현재 console.log 만 (process 종료 직전이라 outbound HTTP 부담). 별도 ADR 의무.
5. **부팅 직후 `data/pending-approvals.json` 가 있으면 `tradeSignalStatus.markBlocked('CRASHED_OR_REDEPLOYED')` 영속** — 별도 ADR (사용자 결정 위임).
6. **Telegram 인라인 키보드 메시지 본문 정정** — 사용자가 drain 후 클릭 시 "이미 처리된 요청입니다." 가 노출되는데, "재배포로 인해 자동 SKIP 처리됨" 같은 명시 라벨 노출 별도 PR 검토.

---

## Rollback

1. **ENV `INFLIGHT_APPROVAL_DRAIN_DISABLED=true`** — 1줄 즉시 PR #923 이전 동작 100% 복원 (drain skip → shutdown 진행 시 inflight Promise 그대로 유실 — 본 PR 이전 baseline).
2. **PR revert** — `git revert <merge-sha>` — server/index.ts shutdown() 무수정 + drainPendingApprovals 함수 + 회귀 테스트 모두 제거.
3. **부분 우회** — `git stash` server/index.ts shutdown 변경만 → drain 함수는 export 유지하되 자동 호출 없음 (테스트 / `/drain_approvals` 후속 PR scope).

---

## Verification

```
✅ vitest server/telegram/inflightApprovalDrainAdr0508.test.ts        32/32 PASS
✅ vitest 인접 server/telegram/buyApproval.* + shadowApprovalDedupePatch001  26/26 무회귀
✅ npm run lint (client + server tsc, PR 변경 파일)                    0 errors
✅ git diff --stat origin/main (LIVE 매매 본체)                        0 lines changed
✅ git merge-tree origin/main HEAD                                     충돌 marker 0건
✅ KIS / KRX / Yahoo / Naver outbound                                  0 추가 호출
✅ ADR-0146 PR 자가 review 5 카테고리                                  ALL PASS
```

---

## ADR-0146 PR 자가 review

- **A. LIVE 매매 안전성** — KIS 주문 함수 5종 import 0건 (정적 grep 가드) / autoTradeEngine / orderExecutor / trancheExecutor 0건 / Gate threshold 변경 0 / virtual account 무수정 / drain 은 'SKIP' resolve 만, 매매 본체 무관 ✅
- **B. wiring 완료 vs 인프라만** — SSOT + 호출자 1 site (server/index.ts shutdown) + 회귀 테스트 동시 머지, PENDING_WIRING 등재 불필요 ✅
- **C. ADR 발급 무결성** — INDEX.md 다음 발급 0508 사용 + 발급 후 다음 발급 0509 갱신 + 전체 인덱스 한 줄 추가 ✅
- **D. 회귀 테스트 적정성** — 32 신규 케이스 + 인접 26 무회귀, heuristic ~16/100 LoC (목표 5+ 달성) ✅
- **E. 정책 위반** — ADR-0157 정확 비교 / ADR-0148 4 정적 검증 baseline 무회귀 / ADR-0159 별칭 정책 무관 (충돌 0) ✅
