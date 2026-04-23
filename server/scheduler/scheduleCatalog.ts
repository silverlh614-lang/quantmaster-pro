/**
 * scheduleCatalog.ts — 등록된 스케줄러 작업 카탈로그 + 운영 가시성 헬퍼.
 *
 * 두 부분으로 구성:
 *   1) SCHEDULE_CATALOG: 사람이 읽을 수 있는 시간표 (수동 유지보수)
 *   2) recordScheduleRun() / getScheduleHistory(): 작업 실행 이력 in-memory 링버퍼
 *
 * 각 작업은 등록 시점에 자기 cron 콜백 진입/종료에서 recordScheduleRun() 을 호출하면
 * /scheduler history 에서 최근 실행 결과를 볼 수 있다 (운영 콘솔화 — 항목 1-4).
 */

export interface ScheduleEntry {
  timeKst: string;
  label: string;
  group: 'reports' | 'alerts' | 'trading' | 'screener' | 'learning' | 'maintenance';
  /** SCHEDULE_CATALOG의 항목과 recordScheduleRun() 의 jobName 매칭에 사용. 미지정 시 label 으로 매칭. */
  jobName?: string;
  /** 비활성 표시용 — env / 기능 토글로 꺼져 있을 때 true. */
  disabled?: boolean;
}

export const SCHEDULE_CATALOG: ScheduleEntry[] = [
  { timeKst: '08:30', label: '장전 방향 카드', group: 'alerts', jobName: 'pre_market_card' },
  { timeKst: '08:35', label: 'ADR 갭 스캔 / 최종 스크리닝', group: 'alerts', jobName: 'adr_gap_scan' },
  { timeKst: '08:45', label: '아침 통합 브리핑', group: 'reports', jobName: 'morning_briefing' },
  { timeKst: '09:00', label: 'MHS 알림 / 거시-섹터 동기화 시작', group: 'alerts', jobName: 'mhs_open' },
  { timeKst: '09:05', label: '보유 포지션 모닝카드', group: 'reports', jobName: 'morning_position_card' },
  { timeKst: '09:10', label: 'newsSupply 추적', group: 'screener', jobName: 'news_supply_tracker' },
  { timeKst: '12:30', label: '점심 통합 브리핑', group: 'reports', jobName: 'lunch_briefing' },
  { timeKst: '14:30', label: '섹터 사이클 대시보드', group: 'reports', jobName: 'sector_cycle_dashboard' },
  { timeKst: '15:35', label: 'INFO 일일 다이제스트 flush', group: 'reports', jobName: 'info_digest_flush' },
  { timeKst: '15:40', label: 'Ghost Portfolio 갱신', group: 'learning', jobName: 'ghost_portfolio' },
  { timeKst: '16:00', label: '장마감 통합 브리핑', group: 'reports', jobName: 'eod_briefing' },
  { timeKst: '16:25', label: '저녁 사이클 회로 자동 reset', group: 'maintenance', jobName: 'circuit_auto_reset' },
  { timeKst: '16:05', label: '52주 신고가 모멘텀 스캔', group: 'reports', jobName: 'high_52w_scan' },
  { timeKst: '16:30', label: '일일 종목 픽 리포트', group: 'reports', jobName: 'daily_pick_report' },
  { timeKst: '16:40', label: '스캔 회고 리포트', group: 'reports', jobName: 'scan_retrospective' },
  { timeKst: '19:00', label: 'Nightly Reflection', group: 'learning', jobName: 'nightly_reflection' },
  { timeKst: '20:30', label: 'KIS 토큰 강제 갱신', group: 'trading', jobName: 'kis_token_refresh' },
  { timeKst: '23:30', label: '일일 Reconciliation', group: 'maintenance', jobName: 'daily_reconcile' },
  { timeKst: '상시',  label: '오케스트레이터 1분 tick', group: 'trading', jobName: 'orchestrator_tick' },
  { timeKst: '상시',  label: 'OCO/매도 체결 감시', group: 'trading', jobName: 'oco_close_loop' },
  { timeKst: '상시',  label: 'DART/IPS/ACK 폴링', group: 'alerts', jobName: 'dart_ips_ack_poll' },
];

const GROUP_LABELS: Record<ScheduleEntry['group'], string> = {
  reports: '리포트',
  alerts: '알림',
  trading: '트레이딩',
  screener: '스크리너',
  learning: '학습',
  maintenance: '유지보수',
};

// ── 실행 이력 (in-memory 링버퍼) ─────────────────────────────────────────────
//   서버 재시작 시 휘발됨 — 운영 디버깅용. 디스크 저장은 채널 audit 로그가 담당.

export interface ScheduleRunRecord {
  jobName: string;
  startedAt: string;       // ISO
  finishedAt: string;      // ISO
  durationMs: number;
  status: 'success' | 'failure' | 'skipped';
  /** 짧은 사유 — 실패면 에러 메시지 첫 줄, success 면 결과 요약 */
  note?: string;
}

const HISTORY_LIMIT = 100;
const _history: ScheduleRunRecord[] = [];
const _lastByJob = new Map<string, ScheduleRunRecord>();

export function recordScheduleRun(rec: ScheduleRunRecord): void {
  _history.push(rec);
  if (_history.length > HISTORY_LIMIT) _history.shift();
  _lastByJob.set(rec.jobName, rec);
}

export function getScheduleHistory(limit = 20): ScheduleRunRecord[] {
  return _history.slice(-limit).reverse();
}

export function getLastRunByJob(jobName: string): ScheduleRunRecord | undefined {
  return _lastByJob.get(jobName);
}

/**
 * cron 콜백 래퍼 — 시작/종료 시각, 성공/실패, 소요 시간을 자동 기록한다.
 * 사용 예: cron.schedule('30 11 * * *', wrapJob('kis_token_refresh', () => doStuff()))
 */
export function wrapJob<T>(
  jobName: string,
  fn: () => Promise<T> | T,
  noteFn?: (result: T) => string | undefined,
): () => Promise<void> {
  return async () => {
    const startedAt = new Date().toISOString();
    const t0 = Date.now();
    try {
      const result = await fn();
      const finishedAt = new Date().toISOString();
      recordScheduleRun({
        jobName,
        startedAt,
        finishedAt,
        durationMs: Date.now() - t0,
        status: 'success',
        note: noteFn ? noteFn(result) : undefined,
      });
    } catch (e) {
      const finishedAt = new Date().toISOString();
      const note = e instanceof Error ? e.message.split('\n')[0] : String(e);
      recordScheduleRun({
        jobName,
        startedAt,
        finishedAt,
        durationMs: Date.now() - t0,
        status: 'failure',
        note,
      });
      // 실패도 throw 하지 않고 swallow — 다음 cron 주기는 계속 살아있어야 한다.
      console.error(`[Scheduler:${jobName}] 실패:`, e);
    }
  };
}

/** 시:분 (KST) — 'HH:MM' 또는 '상시' → 분 정렬 키. '상시' 는 항상 마지막. */
function parseKstMinutes(s: string): number {
  if (!/^\d{2}:\d{2}$/.test(s)) return Number.MAX_SAFE_INTEGER;
  const [h, m] = s.split(':').map(Number);
  return h * 60 + m;
}

function nowKstMinutes(): number {
  const kstNow = new Date(Date.now() + 9 * 3_600_000);
  return kstNow.getUTCHours() * 60 + kstNow.getUTCMinutes();
}

/** 다음 실행 예정 작업 N개 — '상시' 작업은 next 결과에서 제외 (시각이 없음). */
export function getNextScheduled(limit = 5): ScheduleEntry[] {
  const now = nowKstMinutes();
  const timed = SCHEDULE_CATALOG
    .filter(e => /^\d{2}:\d{2}$/.test(e.timeKst))
    .map(e => ({ entry: e, mins: parseKstMinutes(e.timeKst) }))
    .sort((a, b) => a.mins - b.mins);
  // 오늘 남은 + 내일 새벽 (rotate)
  const remainingToday = timed.filter(x => x.mins >= now);
  const tomorrow = timed.filter(x => x.mins < now);
  return [...remainingToday, ...tomorrow].slice(0, limit).map(x => x.entry);
}

// ── 포맷터 ───────────────────────────────────────────────────────────────────

function fmtRunStatus(rec?: ScheduleRunRecord): string {
  if (!rec) return '<i>실행 이력 없음</i>';
  const ts = new Date(rec.finishedAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  const emoji = rec.status === 'success' ? '✅' : rec.status === 'failure' ? '❌' : '⏭';
  const note = rec.note ? ` — ${rec.note.slice(0, 60)}` : '';
  return `${emoji} ${ts} (${rec.durationMs}ms)${note}`;
}

/** 기본 시간표 (group 별 정리). /scheduler */
export function formatSchedulerSummary(): string {
  const lines: string[] = ['🗓 <b>[스케줄러 시간표]</b>'];
  const order: ScheduleEntry['group'][] = ['reports', 'alerts', 'trading', 'screener', 'learning', 'maintenance'];

  for (const group of order) {
    const items = SCHEDULE_CATALOG.filter((entry) => entry.group === group);
    if (items.length === 0) continue;
    lines.push(`\n<b>${GROUP_LABELS[group]}</b>`);
    for (const item of items) {
      const last = item.jobName ? getLastRunByJob(item.jobName) : undefined;
      const lastTag = last
        ? ` <i>(${last.status === 'success' ? '✅' : last.status === 'failure' ? '❌' : '⏭'})</i>`
        : '';
      const disabled = item.disabled ? ' <i>[비활성]</i>' : '';
      lines.push(`• ${item.timeKst} — ${item.label}${disabled}${lastTag}`);
    }
  }
  lines.push('\n<i>/scheduler next · detail · history</i>');
  return lines.join('\n');
}

/** 다음 실행 예정 작업 5개. /scheduler next */
export function formatSchedulerNext(): string {
  const next = getNextScheduled(5);
  if (next.length === 0) return '🗓 다음 실행 예정 작업이 없습니다 (상시 tick 만 등록됨).';
  const lines: string[] = ['⏭ <b>[다음 실행 예정 5건]</b>'];
  const now = nowKstMinutes();
  for (const e of next) {
    const mins = parseKstMinutes(e.timeKst);
    const delta = mins - now;
    const eta = delta >= 0
      ? `+${Math.floor(delta / 60)}h${(delta % 60).toString().padStart(2, '0')}m 뒤`
      : `내일 ${e.timeKst}`;
    lines.push(`• ${e.timeKst} (${eta}) — ${e.label}`);
  }
  return lines.join('\n');
}

/** 작업별 상세: cron 시각, timezone, 활성 여부, 마지막 실행 결과. /scheduler detail */
export function formatSchedulerDetail(): string {
  const lines: string[] = ['🔧 <b>[스케줄러 상세]</b>', `<i>timezone: Asia/Seoul (UTC+9)</i>`];
  const order: ScheduleEntry['group'][] = ['reports', 'alerts', 'trading', 'screener', 'learning', 'maintenance'];
  for (const group of order) {
    const items = SCHEDULE_CATALOG.filter(e => e.group === group);
    if (items.length === 0) continue;
    lines.push(`\n<b>${GROUP_LABELS[group]}</b>`);
    for (const item of items) {
      const enabled = item.disabled ? '🔴 DISABLED' : '🟢 ENABLED';
      const last = item.jobName ? getLastRunByJob(item.jobName) : undefined;
      lines.push(`• <b>${item.label}</b> — ${item.timeKst} — ${enabled}`);
      lines.push(`   마지막: ${fmtRunStatus(last)}`);
    }
  }
  return lines.join('\n');
}

/** 최근 실행 이력 N건 (시간 역순). /scheduler history [n] */
export function formatSchedulerHistory(limit = 15): string {
  const hist = getScheduleHistory(limit);
  if (hist.length === 0) {
    return '📜 <b>[스케줄러 이력]</b>\n<i>아직 기록된 실행이 없습니다.</i>\n(서버 재시작 후 in-memory 링버퍼이며, 작업이 실행될수록 누적됩니다.)';
  }
  const lines: string[] = [`📜 <b>[스케줄러 이력 — 최근 ${hist.length}건]</b>`];
  for (const r of hist) {
    const ts = new Date(r.finishedAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
    const emoji = r.status === 'success' ? '✅' : r.status === 'failure' ? '❌' : '⏭';
    const note = r.note ? ` — ${r.note.slice(0, 50)}` : '';
    lines.push(`• ${ts} ${emoji} <b>${r.jobName}</b> (${r.durationMs}ms)${note}`);
  }
  return lines.join('\n');
}
