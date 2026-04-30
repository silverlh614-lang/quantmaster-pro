// @responsibility cron JobMetrics 와 실제 파일 갱신 시각 교차 검증으로 메트릭 wiring 결함 진단
import fs from 'fs';
import {
  getJobMetrics,
  getLastRunByJob,
  type JobMetrics,
  type ScheduleRunRecord,
} from '../../../scheduler/scheduleCatalog.js';
import {
  REFLECTIONS_DIR,
  GHOST_PORTFOLIO_FILE,
  F2W_AUDIT_FILE,
  ATTRIBUTION_FILE,
  RECONCILE_LAST_FILE,
  tradeEventsFile,
} from '../../../persistence/paths.js';
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';

export type IntrospectVerdict =
  | 'CONTRADICTION_METRICS_LIES'  // 🚨 metrics=0 인데 파일 갱신됨 (메트릭 거짓)
  | 'BOTH_QUIET'                   // ⚠️ 메트릭+파일 둘 다 갱신 없음 (cron 진짜 사망 의심)
  | 'CONSISTENT'                   // ✅ 둘 다 일치
  | 'PATH_UNKNOWN'                 // ❓ 검증 파일 경로 미확인
  | 'PATH_INACCESSIBLE';           // ❌ 파일 접근 실패

export interface FileTrace {
  path: string;
  exists: boolean;
  lastModified?: string;
  recentFileCount?: number;        // 디렉토리일 때 최근 7일 파일 수
  mostRecentFile?: string;
  error?: string;
}

export interface IntrospectEntry {
  jobName: string;
  metrics?: JobMetrics;
  lastRun?: ScheduleRunRecord;
  filePath: string | null;
  fileTrace?: FileTrace;
  verdict: IntrospectVerdict;
  reasoning: string;
}

/** 핵심 4개 cron — jobName 미지정 시 자동 검증 */
const CORE_JOBS = ['nightly_reflection', 'ghost_portfolio', 'f2w_reverse_loop', 'orchestrator_tick'] as const;

/** jobName → 검증 파일 경로 매핑 SSOT (paths.ts 실제 export 사용, 추측 금지) */
export function resolveVerifyPath(jobName: string): string | null {
  const lower = jobName.toLowerCase();
  if (lower.includes('reflection')) return REFLECTIONS_DIR;
  if (lower.includes('ghost')) return GHOST_PORTFOLIO_FILE;
  if (lower.includes('f2w') || lower.includes('weight')) return F2W_AUDIT_FILE;
  if (lower.includes('attribution')) return ATTRIBUTION_FILE;
  if (lower.includes('reconcile')) return RECONCILE_LAST_FILE;
  if (lower.includes('orchestrator') || lower.includes('tick') || lower.includes('trade')) {
    // 현재 월 trade-events-YYYYMM.jsonl
    const yyyymm = new Date().toISOString().slice(0, 7).replace('-', '');
    return tradeEventsFile(yyyymm);
  }
  return null;
}

const SEVEN_DAYS_MS = 7 * 24 * 3600 * 1000;

export function inspectFileTrace(filePath: string, now: Date = new Date()): FileTrace {
  try {
    if (!fs.existsSync(filePath)) {
      return { path: filePath, exists: false };
    }
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      const entries = fs.readdirSync(filePath);
      let recentCount = 0;
      let mostRecent: { name: string; mtime: number } | null = null;
      for (const name of entries) {
        try {
          const child = fs.statSync(`${filePath}/${name}`);
          if (!child.isFile()) continue;
          if (now.getTime() - child.mtimeMs <= SEVEN_DAYS_MS) recentCount++;
          if (!mostRecent || child.mtimeMs > mostRecent.mtime) {
            mostRecent = { name, mtime: child.mtimeMs };
          }
        } catch {
          /* 단일 파일 stat 실패 silent skip */
        }
      }
      return {
        path: filePath,
        exists: true,
        lastModified: mostRecent ? new Date(mostRecent.mtime).toISOString() : undefined,
        recentFileCount: recentCount,
        mostRecentFile: mostRecent?.name,
      };
    }
    return {
      path: filePath,
      exists: true,
      lastModified: stat.mtime.toISOString(),
    };
  } catch (e) {
    return {
      path: filePath,
      exists: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/** 핵심 진단 — JobMetrics 보고 vs 파일 흔적 교차 검증 */
export function classifyIntrospect(
  metrics: JobMetrics | undefined,
  trace: FileTrace | undefined,
  now: Date = new Date(),
): { verdict: IntrospectVerdict; reasoning: string } {
  if (!trace) {
    return {
      verdict: 'PATH_UNKNOWN',
      reasoning: '검증 파일 경로 미확인 — JobMetrics 만 보고',
    };
  }
  if (trace.error) {
    return {
      verdict: 'PATH_INACCESSIBLE',
      reasoning: `파일 접근 실패: ${trace.error}`,
    };
  }
  if (!trace.exists || !trace.lastModified) {
    // 파일 자체 없음 + 메트릭도 0 → BOTH_QUIET
    if (!metrics || metrics.runCount === 0) {
      return {
        verdict: 'BOTH_QUIET',
        reasoning: '파일 부재 + 메트릭 0 — cron 진짜 미실행 의심',
      };
    }
    // 메트릭은 있는데 파일이 없음 — 결과 누락
    return {
      verdict: 'CONTRADICTION_METRICS_LIES',
      reasoning: `메트릭 runCount=${metrics.runCount} 인데 파일 부재 — 결과 누락 또는 다른 경로`,
    };
  }
  // 파일 존재 + lastModified 있음
  const fileMs = new Date(trace.lastModified).getTime();
  const ageMs = now.getTime() - fileMs;
  const recentlyTouched = ageMs <= SEVEN_DAYS_MS;
  const metricsRan = metrics && metrics.runCount > 0;

  if (recentlyTouched && !metricsRan) {
    return {
      verdict: 'CONTRADICTION_METRICS_LIES',
      reasoning: `JobMetrics runCount=0 이지만 파일 ${Math.floor(ageMs / 3600000)}h 전 갱신 — 메트릭 메모리 reset 또는 wiring 결함`,
    };
  }
  if (!recentlyTouched && !metricsRan) {
    const ageDays = Math.floor(ageMs / (24 * 3600 * 1000));
    return {
      verdict: 'BOTH_QUIET',
      reasoning: `메트릭 + 파일 모두 ${ageDays}일+ 미갱신 — cron 진짜 미실행 의심`,
    };
  }
  if (recentlyTouched && metricsRan) {
    return {
      verdict: 'CONSISTENT',
      reasoning: `메트릭 runCount=${metrics!.runCount} + 파일 최근 갱신 — 정상`,
    };
  }
  // metricsRan && !recentlyTouched
  return {
    verdict: 'CONTRADICTION_METRICS_LIES',
    reasoning: `메트릭 runCount=${metrics!.runCount} 인데 파일 7일+ 미갱신 — 다른 경로 의심`,
  };
}

export function buildIntrospectEntry(jobName: string, now: Date = new Date()): IntrospectEntry {
  const metrics = getJobMetrics(jobName);
  const lastRun = getLastRunByJob(jobName);
  const filePath = resolveVerifyPath(jobName);
  const fileTrace = filePath ? inspectFileTrace(filePath, now) : undefined;
  const { verdict, reasoning } = classifyIntrospect(metrics, fileTrace, now);
  return { jobName, metrics, lastRun, filePath, fileTrace, verdict, reasoning };
}

export interface IntrospectSnapshot {
  capturedAt: string;
  entries: IntrospectEntry[];
  summary: { contradictionCount: number; bothQuietCount: number; consistentCount: number; unknownCount: number };
  recommendation: string;
}

export function collectIntrospect(jobNames: string[], now: Date = new Date()): IntrospectSnapshot {
  const entries = jobNames.map((j) => buildIntrospectEntry(j, now));
  const summary = {
    contradictionCount: entries.filter((e) => e.verdict === 'CONTRADICTION_METRICS_LIES').length,
    bothQuietCount: entries.filter((e) => e.verdict === 'BOTH_QUIET').length,
    consistentCount: entries.filter((e) => e.verdict === 'CONSISTENT').length,
    unknownCount: entries.filter((e) => e.verdict === 'PATH_UNKNOWN' || e.verdict === 'PATH_INACCESSIBLE').length,
  };
  const recommendation = buildRecommendation(summary, entries.length);
  return { capturedAt: now.toISOString(), entries, summary, recommendation };
}

export function buildRecommendation(
  s: IntrospectSnapshot['summary'],
  total: number,
): string {
  if (total === 0) return '⚠️ 검증 대상 cron 0건';
  const ratio = s.contradictionCount / total;
  if (s.contradictionCount > 0 && ratio >= 0.5) {
    return `🚨 ${s.contradictionCount}/${total} 모순 — JobMetrics 메모리 reset 또는 scheduleGuard wiring 결함 확정 의심. PR-Fix-JobMetrics 권장 (메트릭 영속화 또는 부팅 시 디스크에서 복원)`;
  }
  if (s.contradictionCount > 0) {
    return `⚠️ ${s.contradictionCount}/${total} 모순 — 일부 cron 메트릭 거짓. 영향받은 jobName 만 별도 점검`;
  }
  if (s.bothQuietCount > 0 && s.consistentCount === 0) {
    return `⚠️ ${s.bothQuietCount}/${total} 모두 미실행 — cron 진짜 사망 가능성, /cron_status 와 결합해 부팅 점검`;
  }
  if (s.consistentCount === total) {
    return '✅ 모든 검증 cron 메트릭과 파일 일치 — 정상';
  }
  return `ℹ️ 정상 ${s.consistentCount} / 모순 ${s.contradictionCount} / 미실행 ${s.bothQuietCount} / 미확인 ${s.unknownCount}`;
}

const VERDICT_EMOJI: Record<IntrospectVerdict, string> = {
  CONTRADICTION_METRICS_LIES: '🚨',
  BOTH_QUIET: '⚠️',
  CONSISTENT: '✅',
  PATH_UNKNOWN: '❓',
  PATH_INACCESSIBLE: '❌',
};

function fmtKstHm(iso?: string): string {
  if (!iso) return 'never';
  const t = new Date(iso).getTime() + 9 * 3600 * 1000;
  return new Date(t).toISOString().slice(0, 16).replace('T', ' ');
}

export function formatIntrospectMessage(snap: IntrospectSnapshot): string {
  const lines: string[] = [
    `🔬 Cron Introspect (${snap.capturedAt.slice(0, 10)})`,
    '━━━━━━━━━━━━━━━━',
    '',
  ];
  for (const e of snap.entries) {
    const m = e.metrics;
    const t = e.fileTrace;
    lines.push(`📊 ${e.jobName}`);
    lines.push('  JobMetrics 보고:');
    lines.push(`    runCount: ${m?.runCount ?? 0}`);
    lines.push(`    lastRun: ${m?.lastSuccessAt ? fmtKstHm(m.lastSuccessAt) : 'never'}`);
    lines.push(`    failCount: ${m?.failCount ?? 0}`);
    if (m?.lastErrorMessage) lines.push(`    lastError: ${m.lastErrorMessage.slice(0, 60)}`);
    lines.push('  실제 파일 흔적:');
    if (!e.filePath) {
      lines.push('    경로: 미확인');
    } else if (!t) {
      lines.push(`    경로: ${e.filePath}`);
      lines.push('    상태: 검사 미수행');
    } else {
      lines.push(`    경로: ${t.path}`);
      if (t.error) {
        lines.push(`    에러: ${t.error}`);
      } else if (!t.exists) {
        lines.push('    상태: 파일 부재');
      } else {
        lines.push(`    lastModified: ${fmtKstHm(t.lastModified)} KST`);
        if (t.recentFileCount !== undefined) {
          lines.push(`    파일 수 (최근 7일): ${t.recentFileCount}회`);
        }
        if (t.mostRecentFile) lines.push(`    최근 파일: ${t.mostRecentFile}`);
      }
    }
    lines.push(`  진단: ${VERDICT_EMOJI[e.verdict]} ${e.verdict}`);
    lines.push(`    ${e.reasoning}`);
    lines.push('');
  }
  lines.push('━━━━━━━━━━━━━━━━');
  lines.push('🎯 종합 진단');
  lines.push(`  모순: ${snap.summary.contradictionCount} / 미실행: ${snap.summary.bothQuietCount} / 정상: ${snap.summary.consistentCount} / 미확인: ${snap.summary.unknownCount}`);
  lines.push('');
  lines.push(`권장 액션: ${snap.recommendation}`);
  return lines.join('\n');
}

const cronIntrospect: TelegramCommand = {
  name: '/cron_introspect',
  aliases: ['/ci'],
  category: 'SYS',
  visibility: 'ADMIN',
  riskLevel: 0,
  description:
    'cron JobMetrics 보고와 실제 파일 갱신 흔적을 교차 검증해 메트릭 wiring 결함 진단 (인자 없으면 핵심 4개 cron 자동)',
  usage: '/cron_introspect [jobName]  — 인자 없으면 nightly_reflection/ghost_portfolio/f2w_reverse_loop/orchestrator_tick 자동',
  async execute({ args, reply }) {
    try {
      const target = args && args.length > 0 ? args[0] : null;
      const jobNames: string[] = target ? [target] : [...CORE_JOBS];
      const snap = collectIntrospect(jobNames);
      await reply(formatIntrospectMessage(snap));
    } catch (e) {
      console.error('[TelegramBot] /cron_introspect 실패:', e);
      await reply('❌ Cron 메타 진단 실패 — 데이터 일부 미확인.');
    }
  },
};

commandRegistry.register(cronIntrospect);

export default cronIntrospect;
export { CORE_JOBS, VERDICT_EMOJI };
