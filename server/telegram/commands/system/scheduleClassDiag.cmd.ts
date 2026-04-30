// @responsibility ScheduleClass 가드 라이브 시뮬레이션 — cron 차단 여부 확정 진단 SSOT
//
// /schedule_class_diag [jobName] (alias /scd) — read-only.
// 인자 없으면 ghost_portfolio 자동 검증. 등록된 cron 표현식 + ScheduleClass 를
// `shouldSkipForScheduleClass()` 에 직접 주입해 8일 시뮬레이션 + 다음 실행 예정일 판정.

import {
  shouldSkipForScheduleClass,
  type ScheduleClass,
} from '../../../scheduler/scheduleGuard.js';
import { getJobMetrics } from '../../../scheduler/scheduleCatalog.js';
import { isKstWeekend } from '../../../utils/marketClock.js';
import { isKrxHoliday } from '../../../trading/krxHolidays.js';
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';

const KST_OFFSET_MS = 9 * 3_600_000;
const DAY_MS = 86_400_000;
const SIM_LOOKBACK_DAYS = 8;
const NEXT_RUN_HORIZON_DAYS = 14;
const HEALTHY_ALLOW_THRESHOLD = 5;

/** 등록된 cron 의 SSOT — server/scheduler/*.ts 의 scheduledJob() 호출과 1:1 정합. */
interface KnownJob {
  cronExpr: string;
  scheduleClass: ScheduleClass;
  registeredAt: string;
}

const KNOWN_JOBS: Record<string, KnownJob> = {
  ghost_portfolio: { cronExpr: '40 6 * * 1-5', scheduleClass: 'TRADING_DAY_ONLY', registeredAt: 'server/scheduler/learningJobs.ts:69' },
  nightly_reflection: { cronExpr: '0 10 * * 1-5', scheduleClass: 'TRADING_DAY_ONLY', registeredAt: 'server/scheduler/learningJobs.ts:62' },
  f2w_reverse_loop: { cronExpr: '10 18 * * 0-4', scheduleClass: 'TRADING_DAY_ONLY', registeredAt: 'server/scheduler/learningJobs.ts:56' },
  weekly_calib: { cronExpr: '0 22 * * 0', scheduleClass: 'WEEKEND_MAINTENANCE', registeredAt: 'server/scheduler/learningJobs.ts:35' },
  weekly_sharpe_alert: { cronExpr: '30 7 * * 3', scheduleClass: 'TRADING_DAY_ONLY', registeredAt: 'server/scheduler/learningJobs.ts:49' },
};

interface SimEntry { dateYmd: string; allow: boolean; reason?: string; }

interface CronAnalysis {
  raw: string;
  minute: string;
  hour: string;
  dom: string;
  month: string;
  dow: string;
  parseable: boolean;
  nextRunUtc?: string;
  nextRunKst?: string;
  nextRunYmdKst?: string;
}

const ymdKst = (d: Date): string => new Date(d.getTime() + KST_OFFSET_MS).toISOString().slice(0, 10);
const fmtKstHm = (d: Date): string => new Date(d.getTime() + KST_OFFSET_MS).toISOString().slice(0, 16).replace('T', ' ');
const fmtUtcHm = (d: Date): string => d.toISOString().slice(0, 16).replace('T', ' ');

function parseDowSet(spec: string): Set<number> | null {
  if (spec === '*') return new Set([0, 1, 2, 3, 4, 5, 6]);
  const range = /^(\d)-(\d)$/.exec(spec);
  if (range) {
    const lo = parseInt(range[1], 10);
    const hi = parseInt(range[2], 10);
    if (Number.isNaN(lo) || Number.isNaN(hi) || lo > hi || lo < 0 || hi > 6) return null;
    const out = new Set<number>();
    for (let i = lo; i <= hi; i++) out.add(i);
    return out;
  }
  if (spec.includes(',')) {
    const out = new Set<number>();
    for (const part of spec.split(',')) {
      const v = parseInt(part, 10);
      if (Number.isNaN(v) || v < 0 || v > 6) return null;
      out.add(v);
    }
    return out;
  }
  const single = parseInt(spec, 10);
  if (Number.isNaN(single) || single < 0 || single > 6) return null;
  return new Set([single]);
}

export function analyzeCron(expr: string, anchor: Date = new Date()): CronAnalysis {
  const parts = expr.trim().split(/\s+/);
  const out: CronAnalysis = {
    raw: expr,
    minute: parts[0] ?? '?', hour: parts[1] ?? '?', dom: parts[2] ?? '?',
    month: parts[3] ?? '?', dow: parts[4] ?? '?',
    parseable: false,
  };
  if (parts.length !== 5) return out;
  const minNum = parseInt(parts[0], 10);
  const hourNum = parseInt(parts[1], 10);
  if (Number.isNaN(minNum) || Number.isNaN(hourNum)) return out;
  if (parts[2] !== '*' || parts[3] !== '*') return out;
  const dowSet = parseDowSet(parts[4]);
  if (!dowSet) return out;
  for (let i = 0; i <= NEXT_RUN_HORIZON_DAYS; i++) {
    const t = new Date(Date.UTC(
      anchor.getUTCFullYear(), anchor.getUTCMonth(), anchor.getUTCDate() + i,
      hourNum, minNum,
    ));
    if (t.getTime() <= anchor.getTime()) continue;
    if (!dowSet.has(t.getUTCDay())) continue;
    out.parseable = true;
    out.nextRunUtc = fmtUtcHm(t);
    out.nextRunKst = fmtKstHm(t);
    out.nextRunYmdKst = ymdKst(t);
    break;
  }
  return out;
}

export function simulatePastDays(scheduleClass: ScheduleClass, anchor: Date, daysBack: number): SimEntry[] {
  const out: SimEntry[] = [];
  for (let i = daysBack; i >= 0; i--) {
    const d = new Date(anchor.getTime() - i * DAY_MS);
    const ymd = ymdKst(d);
    const dec = shouldSkipForScheduleClass(scheduleClass, ymd);
    out.push({ dateYmd: ymd, allow: !dec.skip, reason: dec.reason });
  }
  return out;
}

export function classifyDiagnosis(allowCount: number, total: number): {
  verdict: 'GUARD_BROKEN' | 'GUARD_DEGRADED' | 'GUARD_HEALTHY';
  recommendation: string;
} {
  if (allowCount === 0) {
    return {
      verdict: 'GUARD_BROKEN',
      recommendation:
        '🚨 가드가 모든 날을 비영업일로 판정 — krxHolidays 또는 marketClock 모듈 결함 확정. KRX_HOLIDAYS Set 부팅 reload 누락 가능성 점검.',
    };
  }
  if (allowCount < HEALTHY_ALLOW_THRESHOLD) {
    return {
      verdict: 'GUARD_DEGRADED',
      recommendation: `⚠️ ${allowCount}/${total} 만 허용 — 가드가 비정상적으로 다수 차단. KRX 패치 파일 또는 marketDayClassifier 분기 로직 점검.`,
    };
  }
  return {
    verdict: 'GUARD_HEALTHY',
    recommendation:
      '✅ 가드는 정상 — cron 미실행 원인은 다른 곳. scheduledJob wrapper 의 트리거 wiring 또는 부팅 단계 등록 누락 점검 (/cron_status 와 결합).',
  };
}

export function buildDiagMessage(jobName: string, now: Date = new Date()): string {
  const known = KNOWN_JOBS[jobName];
  const lines: string[] = [];
  lines.push(`📐 Schedule Class Diagnostics: ${jobName}`);
  lines.push('━━━━━━━━━━━━━━━━', '');

  if (!known) {
    lines.push('📋 등록 상태:');
    lines.push(`   jobName: ${jobName}`);
    lines.push('   등록됨: ❌ NO (KNOWN_JOBS SSOT 미등재)', '');
    lines.push('🎯 진단:');
    lines.push(`   본 진단 모듈에 ${jobName} 매핑 부재. 등록된 jobName:`);
    for (const k of Object.keys(KNOWN_JOBS)) lines.push(`     • ${k}`);
    lines.push('', '   /cron_status 또는 /cron_introspect 로 일반 진단 사용 권장.');
    return lines.join('\n');
  }

  const metrics = getJobMetrics(jobName);
  const cronAnalysis = analyzeCron(known.cronExpr, now);
  const sim = simulatePastDays(known.scheduleClass, now, SIM_LOOKBACK_DAYS - 1);
  const allowCount = sim.filter((s) => s.allow).length;

  lines.push('📋 등록 상태:');
  lines.push(`   jobName: ${jobName}`);
  lines.push(`   cron: ${known.cronExpr}`);
  lines.push(`   ScheduleClass: ${known.scheduleClass}`);
  lines.push(`   등록 위치: ${known.registeredAt}`);
  lines.push('   등록됨: ✅ YES');
  lines.push(metrics
    ? `   JobMetrics: runCount=${metrics.runCount} success=${metrics.successCount} skipped=${metrics.skippedCount} fail=${metrics.failCount}`
    : '   JobMetrics: ⚠️ 등록 후 실행 이력 0회 (Map entry 부재)');
  lines.push('');

  lines.push('⏰ Cron 표현식 분석:');
  lines.push(`   분: ${cronAnalysis.minute} / 시: ${cronAnalysis.hour} (UTC) / 요일: ${cronAnalysis.dow}`);
  if (cronAnalysis.parseable && cronAnalysis.nextRunUtc && cronAnalysis.nextRunKst) {
    lines.push(`   다음 실행 (UTC): ${cronAnalysis.nextRunUtc}`);
    lines.push(`   다음 실행 (KST): ${cronAnalysis.nextRunKst}`);
  } else {
    lines.push('   다음 실행 예정: 복잡한 cron — 본 진단에서 미산출');
  }
  lines.push('');

  const todayYmd = ymdKst(now);
  const tomorrowYmd = ymdKst(new Date(now.getTime() + DAY_MS));
  const nextRunYmd = cronAnalysis.nextRunYmdKst ?? '?';
  const todayDec = shouldSkipForScheduleClass(known.scheduleClass, todayYmd);
  const tomorrowDec = shouldSkipForScheduleClass(known.scheduleClass, tomorrowYmd);
  const nextRunDec = nextRunYmd !== '?' ? shouldSkipForScheduleClass(known.scheduleClass, nextRunYmd) : null;

  lines.push('🚦 ScheduleClass 가드 라이브 시뮬레이션:');
  lines.push(`   현재 시각: ${fmtKstHm(now)} KST`);
  lines.push(`   isKstWeekend(now)? ${isKstWeekend(now) ? 'YES' : 'NO'}`);
  lines.push(`   isKrxHoliday(${todayYmd})? ${isKrxHoliday(todayYmd) ? 'YES' : 'NO'}`);
  lines.push(nextRunYmd !== '?'
    ? `   isKrxHoliday(${nextRunYmd})? ${isKrxHoliday(nextRunYmd) ? 'YES' : 'NO'} (다음 실행 예정일)`
    : '   isKrxHoliday(다음 실행일)? — 다음 실행일 미산출');
  lines.push(`   ${known.scheduleClass} 종합 판정:`);
  lines.push(`     ${todayYmd} (오늘): ${todayDec.skip ? `BLOCK (${todayDec.reason})` : 'ALLOW'}`);
  lines.push(`     ${tomorrowYmd} (내일): ${tomorrowDec.skip ? `BLOCK (${tomorrowDec.reason})` : 'ALLOW'}`);
  if (nextRunDec) {
    lines.push(`     ${nextRunYmd} (다음 실행 예정): ${nextRunDec.skip ? `BLOCK (${nextRunDec.reason})` : 'ALLOW'}`);
  }
  lines.push('');

  lines.push(`🧪 ${SIM_LOOKBACK_DAYS}일 시뮬레이션 (오늘 포함 지난 ${SIM_LOOKBACK_DAYS - 1}일):`);
  for (const s of sim) {
    lines.push(`   ${s.dateYmd}: ${s.allow ? 'ALLOW' : `BLOCK (${s.reason})`}`);
  }
  lines.push(`   허용 일수: ${allowCount}/${sim.length}`);
  lines.push('');

  const diag = classifyDiagnosis(allowCount, sim.length);
  lines.push('🎯 진단:');
  lines.push(`   ${diag.recommendation}`);
  return lines.join('\n');
}

const scheduleClassDiag: TelegramCommand = {
  name: '/schedule_class_diag',
  aliases: ['/scd'],
  category: 'SYS',
  visibility: 'ADMIN',
  riskLevel: 0,
  description: '특정 cron 의 ScheduleClass 가드가 차단하는지 라이브 검증 (인자 없으면 ghost_portfolio 자동 검증).',
  usage: '/schedule_class_diag [jobName]  — 인자 없으면 ghost_portfolio',
  async execute({ args, reply }) {
    try {
      const target = args && args.length > 0 ? args[0] : 'ghost_portfolio';
      await reply(buildDiagMessage(target));
    } catch (e) {
      console.error('[TelegramBot] /schedule_class_diag 실패:', e);
      await reply('❌ ScheduleClass 진단 실패 — 데이터 일부 미확인.');
    }
  },
};

commandRegistry.register(scheduleClassDiag);

export default scheduleClassDiag;
export { KNOWN_JOBS, SIM_LOOKBACK_DAYS, HEALTHY_ALLOW_THRESHOLD };
