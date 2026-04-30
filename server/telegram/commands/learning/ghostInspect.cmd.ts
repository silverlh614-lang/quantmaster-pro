// @responsibility /ghost_inspect [N] — Ghost Portfolio 적체 진단 (oldest OPEN N건 + blocker 분포 + cron 메트릭)
import { loadGhostPortfolio } from '../../../persistence/reflectionRepo.js';
import {
  getJobMetrics,
  getLastRunByJob,
} from '../../../scheduler/scheduleCatalog.js';
import type { GhostPosition } from '../../../learning/reflectionTypes.js';
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';

/** TRACK_DAYS=30 (ghostPortfolioTracker.ts SSOT 정합). signalDate + 30일 = trackUntil. */
const GHOST_TRACK_DAYS = 30;
/** lastUpdatedAt 24h+ 미갱신 시 KIS fetcher 실패 의심 */
const PRICE_STALE_HOURS = 24;
const ARG_MIN = 1;
const ARG_MAX = 30;
const ARG_DEFAULT = 10;
const GHOST_JOB_NAME = 'ghost_portfolio';

export type GhostBlocker =
  | 'KIS_PRICE_FETCH_FAIL'
  | 'HOLD_DAYS_NOT_REACHED'
  | 'TRACK_EXPIRED_NOT_CLOSED'
  | 'STATUS_UNKNOWN';

export interface GhostInspectEntry {
  position: GhostPosition;
  daysOpen: number;
  blocker: GhostBlocker;
  /** 진단 추가 정보 — daysOpen 비교 등 */
  detail?: string;
}

/** 사용자 인자 N 파싱 — 1~30 외 입력은 default 10 */
export function parseGhostInspectArg(args: string[] | undefined): number {
  if (!args || args.length === 0) return ARG_DEFAULT;
  const n = Number(args[0]);
  if (!Number.isFinite(n)) return ARG_DEFAULT;
  return Math.max(ARG_MIN, Math.min(ARG_MAX, Math.floor(n)));
}

function daysOpenFor(p: GhostPosition, now: Date): number {
  const t = new Date(`${p.signalDate}T00:00:00Z`).getTime();
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, Math.floor((now.getTime() - t) / (24 * 3600 * 1000)));
}

/**
 * Blocker 분류 SSOT — 코드에 명시 enum 부재라 휴리스틱 4분기.
 * 우선순위: TRACK_EXPIRED_NOT_CLOSED (진짜 적체) > KIS_PRICE_FETCH_FAIL > HOLD_DAYS_NOT_REACHED > STATUS_UNKNOWN.
 */
export function classifyBlocker(p: GhostPosition, now: Date): GhostBlocker {
  const daysOpen = daysOpenFor(p, now);
  // 1) trackUntil 초과인데 closed 안 됨 → cron 미실행 또는 close 로직 누락 (진짜 적체)
  if (p.trackUntil && now.toISOString().slice(0, 10) > p.trackUntil && !p.closed) {
    return 'TRACK_EXPIRED_NOT_CLOSED';
  }
  // 2) lastUpdatedAt 부재 또는 24h+ 미갱신 → KIS fetcher throw → skipped 만 됨
  if (!p.lastUpdatedAt) return 'KIS_PRICE_FETCH_FAIL';
  const lastMs = new Date(p.lastUpdatedAt).getTime();
  if (!Number.isFinite(lastMs)) return 'KIS_PRICE_FETCH_FAIL';
  const hoursSinceUpdate = (now.getTime() - lastMs) / (3600 * 1000);
  if (hoursSinceUpdate >= PRICE_STALE_HOURS) return 'KIS_PRICE_FETCH_FAIL';
  // 3) 정상 추적 중 (TRACK_DAYS=30 미달)
  if (daysOpen < GHOST_TRACK_DAYS) return 'HOLD_DAYS_NOT_REACHED';
  return 'STATUS_UNKNOWN';
}

export interface GhostInspectSnapshot {
  capturedAt: string;
  totalCount: number;
  openCount: number;
  closedCount: number;
  /** signalDate 오름차순 (가장 오래된 먼저) Top N */
  oldestOpen: GhostInspectEntry[];
  /** Blocker 분포 (전체 OPEN 기준) */
  blockerDistribution: Record<GhostBlocker, number>;
  /** 가장 큰 적체 원인 + 추천 액션 */
  topBlocker: { blocker: GhostBlocker; count: number; recommendation: string } | null;
  cron: {
    jobName: string;
    lastRunAt?: string;
    lastDurationMs?: number;
    lastStatus?: 'success' | 'failure' | 'skipped';
    lastNote?: string;
    runCount: number;
    successCount: number;
    failCount: number;
    skippedCount: number;
    lastErrorMessage?: string;
  };
}

const RECOMMENDATIONS: Record<GhostBlocker, string> = {
  TRACK_EXPIRED_NOT_CLOSED:
    'cron 실행 점검 필요 — `/scheduler` 로 ghost_portfolio 마지막 실행 확인 + 운영자 수동 trigger 검토',
  KIS_PRICE_FETCH_FAIL:
    'KIS 회로/블랙리스트 점검 — `/circuits` 명령으로 KIS 회로 상태 확인 + 점검시간 외 fetcher throw 누적 가능성',
  HOLD_DAYS_NOT_REACHED:
    '정상 추적 중 (TRACK_DAYS=30 미달) — 적체 아님, 자연스러운 추적 윈도우',
  STATUS_UNKNOWN:
    '분류 미달 — schema 변경 가능성, ghostPortfolioTracker.ts close 로직 점검',
};

export function collectGhostInspect(
  topN: number = ARG_DEFAULT,
  now: Date = new Date(),
): GhostInspectSnapshot {
  const all = loadGhostPortfolio();
  const open = all.filter((p) => !p.closed);
  const closed = all.filter((p) => p.closed);

  // signalDate 오름차순 (가장 오래된 = 가장 적체 의심)
  const sorted = open
    .slice()
    .sort((a, b) => a.signalDate.localeCompare(b.signalDate));

  const oldestOpen: GhostInspectEntry[] = sorted.slice(0, topN).map((p) => {
    const blocker = classifyBlocker(p, now);
    const daysOpen = daysOpenFor(p, now);
    let detail: string | undefined;
    if (blocker === 'HOLD_DAYS_NOT_REACHED') {
      detail = `target=${GHOST_TRACK_DAYS}일`;
    } else if (blocker === 'KIS_PRICE_FETCH_FAIL') {
      detail = p.lastUpdatedAt
        ? `lastUpdate=${p.lastUpdatedAt.slice(0, 16).replace('T', ' ')}`
        : 'lastUpdatedAt 부재 — 한 번도 갱신 안 됨';
    } else if (blocker === 'TRACK_EXPIRED_NOT_CLOSED') {
      detail = `trackUntil=${p.trackUntil} 초과 (${daysOpen - GHOST_TRACK_DAYS}일 경과)`;
    }
    return { position: p, daysOpen, blocker, detail };
  });

  const blockerDistribution: Record<GhostBlocker, number> = {
    KIS_PRICE_FETCH_FAIL: 0,
    HOLD_DAYS_NOT_REACHED: 0,
    TRACK_EXPIRED_NOT_CLOSED: 0,
    STATUS_UNKNOWN: 0,
  };
  for (const p of open) {
    blockerDistribution[classifyBlocker(p, now)]++;
  }

  // top blocker 산출 (count 내림차순, 동률은 advisory 우선순위)
  const blockerOrder: GhostBlocker[] = [
    'TRACK_EXPIRED_NOT_CLOSED',
    'KIS_PRICE_FETCH_FAIL',
    'STATUS_UNKNOWN',
    'HOLD_DAYS_NOT_REACHED',
  ];
  let topBlocker: GhostInspectSnapshot['topBlocker'] = null;
  for (const b of blockerOrder) {
    const c = blockerDistribution[b];
    if (c > 0 && (!topBlocker || c > topBlocker.count)) {
      topBlocker = { blocker: b, count: c, recommendation: RECOMMENDATIONS[b] };
    }
  }

  // JobMetrics SSOT (PR-50)
  const metrics = getJobMetrics(GHOST_JOB_NAME);
  const lastRun = getLastRunByJob(GHOST_JOB_NAME);
  const cron: GhostInspectSnapshot['cron'] = {
    jobName: GHOST_JOB_NAME,
    lastRunAt: lastRun?.finishedAt,
    lastDurationMs: lastRun?.durationMs,
    lastStatus: lastRun?.status,
    lastNote: lastRun?.note,
    runCount: metrics?.runCount ?? 0,
    successCount: metrics?.successCount ?? 0,
    failCount: metrics?.failCount ?? 0,
    skippedCount: metrics?.skippedCount ?? 0,
    lastErrorMessage: metrics?.lastErrorMessage,
  };

  return {
    capturedAt: now.toISOString(),
    totalCount: all.length,
    openCount: open.length,
    closedCount: closed.length,
    oldestOpen,
    blockerDistribution,
    topBlocker,
    cron,
  };
}

function fmtKstHm(iso?: string): string {
  if (!iso) return 'N/A';
  const t = new Date(iso).getTime() + 9 * 3600 * 1000;
  return new Date(t).toISOString().slice(0, 16).replace('T', ' ');
}

export function formatGhostInspectMessage(snap: GhostInspectSnapshot): string {
  const lines: string[] = [
    `👻 Ghost Inspect (oldest ${snap.oldestOpen.length} OPEN of ${snap.openCount})`,
    '━━━━━━━━━━━━━━━━',
    '',
  ];
  if (snap.oldestOpen.length === 0) {
    lines.push('OPEN ghost 부재 — 적체 0건.');
  }
  snap.oldestOpen.forEach((entry, idx) => {
    const p = entry.position;
    lines.push(`${idx + 1}. ${p.stockCode} ${p.stockName}`);
    lines.push(`   signalDate: ${p.signalDate} (daysOpen: ${entry.daysOpen}일)`);
    if (p.lastUpdatedAt) {
      lines.push(`   lastUpdate: ${fmtKstHm(p.lastUpdatedAt)} KST`);
    }
    if (p.currentReturnPct !== undefined) {
      const sign = p.currentReturnPct >= 0 ? '+' : '';
      lines.push(`   return: ${sign}${p.currentReturnPct.toFixed(2)}%`);
    }
    lines.push(`   blocker: ${entry.blocker}${entry.detail ? ` (${entry.detail})` : ''}`);
    lines.push('');
  });

  lines.push('━━━━━━━━━━━━━━━━');
  lines.push(`Blocker 분류 (${snap.openCount}건 OPEN):`);
  lines.push(`- TRACK_EXPIRED_NOT_CLOSED: ${snap.blockerDistribution.TRACK_EXPIRED_NOT_CLOSED}건`);
  lines.push(`- KIS_PRICE_FETCH_FAIL: ${snap.blockerDistribution.KIS_PRICE_FETCH_FAIL}건`);
  lines.push(`- HOLD_DAYS_NOT_REACHED: ${snap.blockerDistribution.HOLD_DAYS_NOT_REACHED}건 (정상 추적)`);
  lines.push(`- STATUS_UNKNOWN: ${snap.blockerDistribution.STATUS_UNKNOWN}건`);
  lines.push('');
  if (snap.topBlocker) {
    lines.push(`가장 큰 적체 원인: ${snap.topBlocker.blocker} (${snap.topBlocker.count}건)`);
    lines.push(`→ ${snap.topBlocker.recommendation}`);
  } else {
    lines.push('✅ 적체 없음 — OPEN 0건');
  }

  lines.push('');
  lines.push('━━━━━━━━━━━━━━━━');
  lines.push(`🔧 refreshGhostPortfolio cron 진단 (${snap.cron.jobName}):`);
  lines.push(`- 마지막 실행: ${fmtKstHm(snap.cron.lastRunAt)} KST${snap.cron.lastStatus ? ` [${snap.cron.lastStatus}]` : ''}`);
  if (snap.cron.lastDurationMs !== undefined) {
    lines.push(`- 처리 시간: ${snap.cron.lastDurationMs}ms`);
  }
  if (snap.cron.lastNote) {
    lines.push(`- 노트: ${snap.cron.lastNote.slice(0, 100)}`);
  }
  lines.push(`- 누적: ${snap.cron.runCount}회 (✅${snap.cron.successCount} / ❌${snap.cron.failCount} / ⏭️${snap.cron.skippedCount})`);
  if (snap.cron.lastErrorMessage) {
    lines.push(`- 마지막 에러: ${snap.cron.lastErrorMessage}`);
  }
  if (snap.cron.runCount === 0) {
    lines.push('⚠️ cron 실행 이력 0건 — JobMetrics 미등록 또는 부팅 후 미실행');
  }

  lines.push('', `<i>capturedAt: ${snap.capturedAt}</i>`);
  return lines.join('\n');
}

const ghostInspect: TelegramCommand = {
  name: '/ghost_inspect',
  aliases: ['/gi'],
  category: 'LRN',
  visibility: 'ADMIN',
  riskLevel: 0,
  description:
    'Ghost Portfolio 적체 진단 — 가장 오래된 OPEN N건 (1~30, default 10) + blocker 분포 + cron 메트릭',
  usage: '/ghost_inspect [N=10]  — N: 1~30',
  async execute({ args, reply }) {
    try {
      const topN = parseGhostInspectArg(args);
      const snap = collectGhostInspect(topN);
      await reply(formatGhostInspectMessage(snap));
    } catch (e) {
      console.error('[TelegramBot] /ghost_inspect 실패:', e);
      await reply('❌ Ghost 진단 실패 — 데이터 일부 미확인.');
    }
  },
};

commandRegistry.register(ghostInspect);

export default ghostInspect;
export { GHOST_TRACK_DAYS, PRICE_STALE_HOURS, RECOMMENDATIONS };
