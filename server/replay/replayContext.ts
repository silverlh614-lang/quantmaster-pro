// @responsibility Replay-mode SSOT 진입점 — provider call guard, 외부 API 차단

/**
 * Patch-MARKET-CLOSE-SNAPSHOT-001 / Patch-AFTER-HOURS-RUNTIME-DEBUG-SNAPSHOT-001/002 — Replay Context SSOT.
 *
 * 사용자 명시 framing (§6 / Patch-002 §F):
 *   "replay mode에서는 외부 호출을 금지한다.
 *    필수 invariant: providerCalls=0, kisCalls=0, krxCalls=0, yahooCalls=0, naverCalls=0.
 *    SnapshotInvestorFlowReplayAdapter 도 동일 invariant 강제."
 *
 * `withReplayContext(fn)` SSOT 진입점 — fn 안에서 `isReplayProviderCallBlocked()` 가
 * true 를 반환해 provider client 가 호출을 차단해야 한다.
 *
 * Replay mode 자체는 *진단 전용* — LIVE 매매 본체에 영향 0. 호출자는 read-only.
 *
 * 절대 invariants:
 *   1. replay mode 는 AsyncLocalStorage-like context — 동기 흐름에서만 안전
 *   2. context 밖에서 isReplayProviderCallBlocked() 는 항상 false 반환
 *   3. context 안에서 외부 fetch 호출 시점 시 BLOCKED 진단 로그 의무
 *   4. executionImpact: 'NONE' literal 강제 (TypeScript 컴파일 타임)
 *   5. context 가 throw 해도 context 자동 해제 의무 (try/finally)
 *   6. ReplayMode 'AFTER_HOURS_RUNTIME_DEBUG_SNAPSHOT' (Patch-002) — preflight supply
 *      hydration adapter wrapping 시 동일 guard 강제
 */

export type ReplayMode =
  | 'NONE'
  | 'MARKET_CLOSE_SNAPSHOT' // legacy — Patch-001 시기 호환 (현재 사용 0, 후속 PR 에서 제거 검토)
  | 'AFTER_HOURS_RUNTIME_DEBUG_SNAPSHOT'; // Patch-002 — 17:00 KST runtime debug snapshot replay

export interface ReplayContext {
  readonly mode: ReplayMode;
  readonly snapshotId: string | null;
  readonly providerCallsAllowed: false; // literal type 강제 — replay 시 항상 false
  readonly executionImpact: 'NONE'; // literal type 강제
  readonly enteredAt: number;
}

/** Module-local replay context stack — 단일 process 안에서 nested 안전. */
const _replayStack: ReplayContext[] = [];

/**
 * Replay context 안에서 함수 실행. 정상 종료 또는 throw 시점 모두 context 자동 해제.
 *
 * @param mode replay 분류 — 'MARKET_CLOSE_SNAPSHOT' 등 향후 확장 가능
 * @param snapshotId 진단 추적용 — provider call 차단 시 로그에 포함
 * @param fn 실행할 함수 (sync 또는 async)
 * @returns fn 반환값
 */
export async function withReplayContext<T>(
  mode: Exclude<ReplayMode, 'NONE'>,
  snapshotId: string | null,
  fn: () => T | Promise<T>
): Promise<T> {
  const ctx: ReplayContext = {
    mode,
    snapshotId,
    providerCallsAllowed: false,
    executionImpact: 'NONE',
    enteredAt: Date.now(),
  };
  _replayStack.push(ctx);
  try {
    return await fn();
  } finally {
    // FILO pop — push 한 ctx 만 정확히 제거 (safety check)
    const popped = _replayStack.pop();
    if (popped !== ctx) {
      // 예상치 못한 stack drift — push 후 다른 ctx 가 들어왔거나 비정상 상태
      console.warn(
        `[ReplayContext] stack drift detected — expected=${ctx.snapshotId} popped=${
          popped?.snapshotId ?? 'null'
        }`
      );
    }
  }
}

/**
 * 현재 replay context 조회. context 밖이면 null.
 * Provider client 가 호출 직전에 본 함수로 차단 여부 판정.
 */
export function getCurrentReplayContext(): ReplayContext | null {
  if (_replayStack.length === 0) return null;
  return _replayStack[_replayStack.length - 1] ?? null;
}

/**
 * Replay mode 안에서 외부 provider call 차단 여부.
 * `true` 반환 시 호출자는 즉시 차단하고 `[REPLAY_PROVIDER_CALL_BLOCKED]` 진단 로그.
 *
 * 후속 wiring (별도 PR scope): KIS/KRX/Yahoo/Naver client 진입부에서 본 함수 호출.
 * 본 PR 은 SSOT + replayCapture 만 — 실제 wiring 은 후속 PR (회귀 위험 격리).
 */
export function isReplayProviderCallBlocked(): boolean {
  const ctx = getCurrentReplayContext();
  return ctx !== null && ctx.providerCallsAllowed === false;
}

/**
 * Replay context 진단 메시지 — provider call 차단 시점에 로그 출력용.
 */
export function describeReplayBlock(provider: string): string {
  const ctx = getCurrentReplayContext();
  if (!ctx) return '';
  return `[REPLAY_PROVIDER_CALL_BLOCKED] provider=${provider} mode=${ctx.mode} snapshotId=${
    ctx.snapshotId ?? 'null'
  } executionImpact=${ctx.executionImpact}`;
}

/** 테스트 격리 헬퍼. 운영 환경 호출 금지. */
export function __resetReplayContextStackForTests(): void {
  _replayStack.length = 0;
}
