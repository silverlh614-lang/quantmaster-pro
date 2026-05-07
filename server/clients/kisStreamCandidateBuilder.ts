/**
 * @responsibility KIS WebSocket startKisStream(codes) 호출자가 ADR-0437 우선순위 매트릭스를
 *                 통과하도록 정렬·절삭하는 단일 SSOT (재시작/재연결 30 슬롯 포화 재발 차단).
 *
 * ADR-0441 — 사용자 명시 1순위 #1 (운영 안정성 직결).
 *
 * 사용자 핵심 의도:
 *   "평상시 개별 구독 요청은 새 우선순위 정책을 타더라도, 재시작/재연결 시점에 예전 방식으로
 *    전체 watchlist 를 밀어 넣으면 다시 30 슬롯이 낮은 우선순위 종목으로 차버릴 수 있습니다.
 *    즉, 장애 복구나 Railway 재시작 후에 문제가 재발할 수 있습니다."
 *
 * 호출자 4 곳 (모두 본 SSOT 위임 의무, 호출자 측 inline `gateScore desc` 정렬 0건):
 *   - server/scheduler/kisStreamJobs.ts kis_stream_start (09:00 KST cron)
 *   - server/scheduler/kisStreamJobs.ts kis_stream_watchdog (09:05/15/30 KST cron)
 *   - server/scheduler/kisStreamJobs.ts boot auto-connect (장중 재배포)
 *   - server/telegram/commands/infra/reconnectWs.cmd.ts (운영자 강제 재연결)
 *
 * 12 invariants (정적 grep 회귀 가드):
 *   1. `gateScore desc` 단순 정렬 0건 (4 callsites 모두 SSOT 위임)
 *   2. ADR-0437 우선순위 매트릭스 (1000/900/800/700/600/500/300/100/0) 정확 사용
 *   3. 보유 종목 (active shadow) → OPEN_POSITION priority 1000 — 절대 우선
 *   4. 워치리스트 entry → gateScore 임계 기반 ENTRY_CANDIDATE / WATCHLIST / OBSERVE_ONLY 분류
 *   5. invalid code (`normalizeKrxCodeForWs(...) === null`) → builder 에서 제외 (ADR-0438 SSOT 통합)
 *   6. 30개 상한 — slice(top-N)
 *   7. LIVE 매매 본체 0줄 변경
 *   8. KIS 주문 함수 5종 import 0건
 *   9. 외부 fetch 추가 0
 *  10. ENV `KIS_STREAM_PRIORITY_BUILDER_DISABLED=true` (default OFF, ADR-0157 정확 비교)
 *      — 1줄 즉시 legacy `gateScore desc` 동작 복원
 *  11. 호출자 측 inline ENV 검사 0건 (builder SSOT 위임)
 *  12. `kisStreamClient.ts` `MAX_SUBSCRIPTIONS` 등 본체 무수정
 *
 * 본 SSOT 는 *initial* `startKisStream(codes)` 호출용 priority-sorted top-N codes 만 산출.
 * post-connect bulk subscribe (`bulkApplySubscriptionsByPriority`) 는 후속 PR scope 외.
 */

import type { WatchlistEntry } from '../persistence/watchlistRepo.js';
import {
  type SubscriptionCandidate,
  type SubscriptionPriorityReason,
  SUBSCRIPTION_PRIORITY_TABLE,
  normalizeKrxCodeForWs,
  sortCandidatesByPriority,
} from './kisWebSocketSubscriptionManager.js';

// ── Gate score 임계 SSOT (ADR-0437 priority 매핑 정합) ─────────────────────────

/**
 * gateScore → SubscriptionPriorityReason 분류 임계.
 *
 * ENTRY_CANDIDATE = 7.0 (BUY signal 임계 정합 — `Math.max(minGateBase - relaxedDelta, 5)` 이상)
 * WATCHLIST       = 4.0 (Gate1 통과 임계 정합)
 * 그 외 < 4.0     → OBSERVE_ONLY (priority 300)
 *
 * Object.freeze 로 호출자 mutate 차단.
 */
export const KIS_STREAM_GATE_THRESHOLDS = Object.freeze({
  ENTRY_CANDIDATE: 7.0,
  WATCHLIST: 4.0,
});

// ── ENV gate SSOT (호출자 측 inline ENV 검사 0건) ────────────────────────────

/**
 * ENV `KIS_STREAM_PRIORITY_BUILDER_DISABLED=true` (default OFF, ADR-0157 정확 비교).
 *
 * 활성 시 legacy `gateScore desc` fallback — ADR-0441 이전 동작 100% 복원.
 * `'1'` / `'TRUE'` / `'yes'` 거부 (정확 비교 의무).
 */
export function isKisStreamPriorityBuilderDisabled(): boolean {
  return process.env.KIS_STREAM_PRIORITY_BUILDER_DISABLED === 'true';
}

// ── BuildKisStreamCandidatesInput ────────────────────────────────────────────

export interface BuildKisStreamCandidatesInput {
  watchlist: WatchlistEntry[];
  /** active shadow trades 의 6자리 KRX code set (보유 종목 = OPEN_POSITION priority 1000). */
  openPositionCodes: ReadonlySet<string>;
  /** 테스트용 시간 주입 (ADR-0157 now injection 패턴). */
  now?: number;
}

// ── 핵심 builder ─────────────────────────────────────────────────────────────

/**
 * Watchlist + 보유 종목 → SubscriptionCandidate[] (priority-sorted).
 *
 * 분류 규칙:
 *   - 보유 종목 (openPositionCodes 포함) → OPEN_POSITION priority 1000
 *   - watchlist entry + gateScore ≥ 7.0 → ENTRY_CANDIDATE priority 800
 *   - watchlist entry + gateScore ≥ 4.0 → WATCHLIST priority 500
 *   - watchlist entry + gateScore < 4.0 → OBSERVE_ONLY priority 300
 *
 * invalid KRX code 는 builder 에서 자동 제외 (ADR-0438 SSOT `normalizeKrxCodeForWs`).
 * 보유 종목 + watchlist 중복은 보유 우선 (OPEN_POSITION 우선순위 매트릭스).
 *
 * 정렬: priority desc → openPosition / entryCandidate / shadowObservable 동률 우선
 *      → lastUpdatedAt desc → code asc (deterministic, ADR-0437 sortCandidatesByPriority).
 */
export function buildKisStreamSubscriptionCandidates(
  input: BuildKisStreamCandidatesInput,
): SubscriptionCandidate[] {
  const now = input.now ?? Date.now();
  const candidates: SubscriptionCandidate[] = [];
  // 보유 종목 dedup 추적 (watchlist 중복 시 보유 우선)
  const seen = new Set<string>();

  // 1. 보유 종목 → OPEN_POSITION priority 1000 (절대 우선)
  for (const rawCode of input.openPositionCodes) {
    const normalized = normalizeKrxCodeForWs(rawCode);
    if (!normalized) continue; // invalid code skip (ADR-0438 정합)
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    candidates.push({
      code: normalized,
      priority: SUBSCRIPTION_PRIORITY_TABLE.OPEN_POSITION,
      reasons: ['OPEN_POSITION'],
      openPosition: true,
      lastUpdatedAt: now,
    });
  }

  // 2. Watchlist entries → gateScore 임계 분류
  for (const entry of input.watchlist) {
    const normalized = normalizeKrxCodeForWs(entry.code);
    if (!normalized) continue; // invalid code skip
    if (seen.has(normalized)) continue; // 보유 종목 우선 (dedup)
    seen.add(normalized);

    const gateScore = entry.gateScore ?? 0;
    let priority: number;
    let reason: SubscriptionPriorityReason;

    if (gateScore >= KIS_STREAM_GATE_THRESHOLDS.ENTRY_CANDIDATE) {
      priority = SUBSCRIPTION_PRIORITY_TABLE.ENTRY_CANDIDATE;
      reason = 'ENTRY_CANDIDATE';
    } else if (gateScore >= KIS_STREAM_GATE_THRESHOLDS.WATCHLIST) {
      priority = SUBSCRIPTION_PRIORITY_TABLE.WATCHLIST;
      reason = 'WATCHLIST';
    } else {
      priority = SUBSCRIPTION_PRIORITY_TABLE.OBSERVE_ONLY;
      reason = 'OBSERVE_ONLY';
    }

    candidates.push({
      code: normalized,
      name: entry.name,
      priority,
      reasons: [reason],
      entryCandidate: reason === 'ENTRY_CANDIDATE',
      lastUpdatedAt: now,
    });
  }

  return sortCandidatesByPriority(candidates);
}

// ── 4 callsites entry-point ──────────────────────────────────────────────────

/**
 * 4 callsites (`kis_stream_start` / `kis_stream_watchdog` / boot auto-connect / `/reconnect_ws`)
 * 가 `startKisStream(codes[])` 에 전달할 priority-sorted top-N codes 헬퍼.
 *
 * ENV `KIS_STREAM_PRIORITY_BUILDER_DISABLED=true` 시 legacy `gateScore desc` fallback.
 *
 * @param watchlist          현재 watchlist entries
 * @param openPositionCodes  active shadow trades 의 6자리 codes (보유 종목)
 * @param maxSubscriptions   KIS 단일 세션 30 슬롯 상한 (또는 호출자 정의)
 * @returns top-N (≤ maxSubscriptions) priority-sorted codes string[]
 */
export function selectKisStreamSubscribableCodes(
  watchlist: WatchlistEntry[],
  openPositionCodes: ReadonlySet<string>,
  maxSubscriptions: number,
): string[] {
  // Legacy fallback (ADR-0157 ENV gate, default OFF)
  if (isKisStreamPriorityBuilderDisabled()) {
    return [...watchlist]
      .sort((a, b) => (b.gateScore ?? 0) - (a.gateScore ?? 0))
      .slice(0, maxSubscriptions)
      .map((w) => w.code);
  }

  // 정상 경로 — ADR-0437 우선순위 매트릭스 통과
  const candidates = buildKisStreamSubscriptionCandidates({
    watchlist,
    openPositionCodes,
  });
  return candidates.slice(0, maxSubscriptions).map((c) => c.code);
}

// ── deriveOpenPositionCodes — active shadow trades read SSOT ─────────────────

/**
 * `loadShadowTrades` + status 분류 + `getRemainingQty > 0` filter → 보유 6자리 code Set.
 *
 * 순환 import 회피를 위해 dynamic import 사용 (kisStreamCandidateBuilder ↔ shadowTradeRepo
 * 직접 import 시 module load 순서 의존성 위험).
 *
 * 호출자 (kisStreamJobs / reconnectWs.cmd) 가 `selectKisStreamSubscribableCodes` 직전 호출.
 * 영속 read-only — 외부 API 호출 0건 (KIS/KRX/Yahoo/Naver outbound 0).
 *
 * 실패 시 (영속 손상 등) 빈 Set 반환 — 매수 흐름 차단 안 함 (try/catch 격리).
 */
export async function deriveOpenPositionCodes(): Promise<Set<string>> {
  try {
    const repo = await import('../persistence/shadowTradeRepo.js');
    const trades = repo.loadShadowTrades();
    const codes = new Set<string>();
    for (const trade of trades) {
      if (!isOpenShadowStatusLocal(trade.status)) continue;
      if (repo.getRemainingQty(trade) <= 0) continue;
      const normalized = normalizeKrxCodeForWs(trade.stockCode);
      if (!normalized) continue;
      codes.add(normalized);
    }
    return codes;
  } catch (err) {
    // 영속 read 실패 → 빈 Set (보유 종목 보호 정책 의존성 보존, ADR-0437 정합)
    console.warn(
      '[KIS-STREAM-BUILDER] deriveOpenPositionCodes failed — empty set fallback (ADR-0441):',
      err,
    );
    return new Set();
  }
}

/**
 * `entryEngine.isOpenShadowStatus` 와 동일 분류 — 순환 import 회피용 모듈-로컬 정의.
 *
 * shadowTradeRepo 가 entryEngine 을 import 하지 않는 패턴을 본 SSOT 도 따른다.
 * 향후 분류 union 변경 시 entryEngine.OPEN_SHADOW_STATUSES 와 동시 갱신 의무.
 */
function isOpenShadowStatusLocal(status: string): boolean {
  return (
    status === 'PENDING' ||
    status === 'ORDER_SUBMITTED' ||
    status === 'PARTIALLY_FILLED' ||
    status === 'ACTIVE' ||
    status === 'EUPHORIA_PARTIAL'
  );
}
