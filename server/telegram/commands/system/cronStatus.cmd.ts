// @responsibility /cron_status — 등록된 cron 작업 전체 상태 (JobMetrics SSOT + lastRun + 부팅 진단)
import {
  SCHEDULE_CATALOG,
  getJobMetrics,
  getLastRunByJob,
  type ScheduleEntry,
  type JobMetrics,
  type ScheduleRunRecord,
} from '../../../scheduler/scheduleCatalog.js';
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';

export type CronJobStatus = 'NORMAL' | 'NEVER_RAN' | 'FAILING' | 'SKIPPED_ONLY' | 'NO_JOB_NAME';

export interface CronStatusEntry {
  catalog: ScheduleEntry;
  metrics?: JobMetrics;
  lastRun?: ScheduleRunRecord;
  status: CronJobStatus;
}

export interface CronStatusSnapshot {
  capturedAt: string;
  totalCatalogEntries: number;
  jobNamedEntries: number;
  /** JobMetrics 에 한 번이라도 기록된 작업 수 (runCount ≥ 0 — Map 등록만 돼도 카운트) */
  metricsRegistered: number;
  /** runCount > 0 — 한 번이라도 실행된 작업 */
  everRanCount: number;
  /** runCount = 0 (jobName 등록됨) — 부팅 후 미실행 */
  neverRanJobs: string[];
  /** failCount > 0 — 최근 실패 이력 */
  failingJobs: string[];
  entries: CronStatusEntry[];
  recommendation: string;
}

const STATUS_EMOJI: Record<CronJobStatus, string> = {
  NORMAL: '🟢',
  NEVER_RAN: '🔴',
  FAILING: '🟠',
  SKIPPED_ONLY: '🟡',
  NO_JOB_NAME: '⚪',
};

const GROUP_ORDER: ScheduleEntry['group'][] = [
  'trading',
  'learning',
  'reports',
  'alerts',
  'screener',
  'maintenance',
];

const GROUP_LABELS: Record<ScheduleEntry['group'], string> = {
  trading: '🤖 매매',
  learning: '📚 학습',
  reports: '📊 리포트',
  alerts: '🔔 알림',
  screener: '🔍 스크리너',
  maintenance: '🛠️ 유지보수',
};

/** 단일 catalog entry 의 상태 분류 SSOT */
export function classifyCronStatus(
  entry: ScheduleEntry,
  metrics: JobMetrics | undefined,
  lastRun: ScheduleRunRecord | undefined,
): CronJobStatus {
  if (!entry.jobName) return 'NO_JOB_NAME';
  if (!metrics || metrics.runCount === 0) return 'NEVER_RAN';
  // 최근 실행 (failure 있고 lastFailureAt ≥ lastSuccessAt) → FAILING
  const failedAfterSuccess =
    metrics.failCount > 0
    && (!metrics.lastSuccessAt
      || (metrics.lastFailureAt && metrics.lastFailureAt > metrics.lastSuccessAt));
  if (failedAfterSuccess) return 'FAILING';
  // success 0 + skipped 만 누적
  if (metrics.successCount === 0 && metrics.skippedCount > 0) return 'SKIPPED_ONLY';
  // lastRun 이 skipped 인데 successCount = 0 같은 케이스도 SKIPPED_ONLY 로 흡수
  if (metrics.successCount === 0 && lastRun?.status === 'skipped') return 'SKIPPED_ONLY';
  return 'NORMAL';
}

/** 권장 액션 — runCount=0 분포 기반 휴리스틱 */
export function buildRecommendation(snap: Pick<CronStatusSnapshot, 'jobNamedEntries' | 'neverRanJobs' | 'failingJobs'>): string {
  const total = snap.jobNamedEntries;
  const neverRan = snap.neverRanJobs.length;
  const failing = snap.failingJobs.length;
  if (total === 0) {
    return '⚠️ jobName 등록된 cron 0건 — SCHEDULE_CATALOG 비어 있음';
  }
  if (neverRan === 0 && failing === 0) {
    return '✅ 모든 등록 cron 정상 — runCount > 0 + 최근 실패 없음';
  }
  const neverRanRatio = neverRan / total;
  if (neverRanRatio >= 0.5) {
    return `🚨 다수 cron(${neverRan}/${total}) 미실행 — 부팅 시퀀스 전반 결함 의심 (registerXxxJobs 호출 누락 / 부팅 throw)`;
  }
  if (neverRan > 0 && neverRan <= 3) {
    return `⚠️ ${neverRan}개 cron 미실행 (${snap.neverRanJobs.join(', ')}) — 해당 jobName 등록 누락 또는 schedule 표현식 결함 / 잡 자체 throw 로 즉시 죽고 있을 가능성`;
  }
  if (failing > 0) {
    return `⚠️ ${failing}개 cron 최근 실패 (${snap.failingJobs.slice(0, 3).join(', ')}) — lastErrorMessage 확인`;
  }
  return `ℹ️ ${neverRan}개 미실행 + ${failing}개 실패 — 개별 점검 권장`;
}

export function collectCronStatus(now: Date = new Date()): CronStatusSnapshot {
  const entries: CronStatusEntry[] = [];
  const neverRanJobs: string[] = [];
  const failingJobs: string[] = [];
  let jobNamedEntries = 0;
  let metricsRegistered = 0;
  let everRanCount = 0;

  for (const cat of SCHEDULE_CATALOG) {
    if (cat.jobName) jobNamedEntries++;
    const metrics = cat.jobName ? getJobMetrics(cat.jobName) : undefined;
    const lastRun = cat.jobName ? getLastRunByJob(cat.jobName) : undefined;
    if (metrics) metricsRegistered++;
    if (metrics && metrics.runCount > 0) everRanCount++;
    const status = classifyCronStatus(cat, metrics, lastRun);
    if (status === 'NEVER_RAN' && cat.jobName) neverRanJobs.push(cat.jobName);
    if (status === 'FAILING' && cat.jobName) failingJobs.push(cat.jobName);
    entries.push({ catalog: cat, metrics, lastRun, status });
  }

  return {
    capturedAt: now.toISOString(),
    totalCatalogEntries: SCHEDULE_CATALOG.length,
    jobNamedEntries,
    metricsRegistered,
    everRanCount,
    neverRanJobs,
    failingJobs,
    entries,
    recommendation: buildRecommendation({ jobNamedEntries, neverRanJobs, failingJobs }),
  };
}

function fmtKstHm(iso?: string): string {
  if (!iso) return 'never';
  const t = new Date(iso).getTime() + 9 * 3600 * 1000;
  return new Date(t).toISOString().slice(0, 16).replace('T', ' ');
}

export function formatCronStatusMessage(snap: CronStatusSnapshot): string {
  const lines: string[] = [
    `⏰ Cron Status (${snap.capturedAt.slice(0, 10)})`,
    '━━━━━━━━━━━━━━━━',
    `등록 카탈로그: ${snap.totalCatalogEntries}건 (jobName 있음 ${snap.jobNamedEntries})`,
    `한 번이라도 실행: ${snap.everRanCount}/${snap.jobNamedEntries}건 / 최근 실패: ${snap.failingJobs.length}건`,
    '',
  ];

  for (const group of GROUP_ORDER) {
    const groupEntries = snap.entries.filter((e) => e.catalog.group === group);
    if (groupEntries.length === 0) continue;
    lines.push(`${GROUP_LABELS[group]}`);
    for (const e of groupEntries) {
      const emoji = STATUS_EMOJI[e.status];
      const job = e.catalog.jobName ?? '(no jobName)';
      const m = e.metrics;
      const runCountStr = m
        ? `runs=${m.runCount} (✅${m.successCount} ❌${m.failCount} ⏭️${m.skippedCount})`
        : 'runs=N/A';
      const lastStr = e.lastRun
        ? `last=${fmtKstHm(e.lastRun.finishedAt)} [${e.lastRun.status}]`
        : 'last=never';
      lines.push(`  ${emoji} ${e.catalog.timeKst} ${job}`);
      lines.push(`     ${runCountStr} · ${lastStr}`);
      if (e.status === 'NEVER_RAN') {
        lines.push('     ⚠️ 등록은 있으나 한 번도 실행 안 됨');
      } else if (e.status === 'FAILING' && m?.lastErrorMessage) {
        lines.push(`     ⚠️ ${m.lastErrorMessage.slice(0, 80)}`);
      } else if (e.status === 'SKIPPED_ONLY' && m?.lastSkipReason) {
        lines.push(`     ⏭️ skipReason: ${m.lastSkipReason.slice(0, 60)}`);
      }
    }
    lines.push('');
  }

  lines.push('━━━━━━━━━━━━━━━━');
  if (snap.neverRanJobs.length > 0) {
    lines.push(`🔴 runCount=0 인 cron (${snap.neverRanJobs.length}개):`);
    for (const j of snap.neverRanJobs.slice(0, 10)) lines.push(`   - ${j}`);
    if (snap.neverRanJobs.length > 10) {
      lines.push(`   ... 외 ${snap.neverRanJobs.length - 10}건`);
    }
    lines.push('');
  }
  lines.push(`권장 액션: ${snap.recommendation}`);
  return lines.join('\n');
}

const cronStatus: TelegramCommand = {
  name: '/cron_status',
  aliases: ['/cron', '/cs'],
  category: 'SYS',
  visibility: 'ADMIN',
  riskLevel: 0,
  description:
    '등록된 cron 작업 전체 상태 (jobName/runCount/lastRun/실패) — 부팅 시퀀스 결함 진단',
  async execute({ reply }) {
    try {
      const snap = collectCronStatus();
      await reply(formatCronStatusMessage(snap));
    } catch (e) {
      console.error('[TelegramBot] /cron_status 실패:', e);
      await reply('❌ Cron 상태 조회 실패 — 데이터 일부 미확인.');
    }
  },
};

commandRegistry.register(cronStatus);

export default cronStatus;
export { STATUS_EMOJI, GROUP_LABELS };
