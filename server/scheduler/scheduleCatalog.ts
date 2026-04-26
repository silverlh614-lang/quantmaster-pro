/**
 * @responsibility 등록 스케줄 카탈로그·다음/상세/이력 포맷·실행 링버퍼 제공
 *
 * SCHEDULE_CATALOG 가 사람이 읽는 시간표 SSOT, recordScheduleRun() 이 실행 이력을
 * 기록해 /scheduler history 에서 조회 가능하다.
 */

export interface ScheduleEntry {
  timeKst: string;
  label: string;
  group: 'reports' | 'alerts' | 'trading' | 'screener' | 'learning' | 'maintenance';
  /** SCHEDULE_CATALOG의 항목과 recordScheduleRun() 의 jobName 매칭에 사용. 미지정 시 label 으로 매칭. */
  jobName?: string;
  /** 비활성 표시용 — env / 기능 토글로 꺼져 있을 때 true. */
  disabled?: boolean;
  /**
   * 조건부 무음 설명 — cron 은 돌지만 조건 미달 시 Telegram 을 의도적으로 보내지 않는
   * 작업은 여기에 사유를 적는다. /scheduler detail 에 "🔕 조건부 무음: …" 으로 표시되어
   * "왜 이 시각에 메시지가 안 오느냐" 에 대한 운영 답변을 단일 소스로 관리한다.
   */
  silentWhen?: string;
}

export const SCHEDULE_CATALOG: ScheduleEntry[] = [
  // ── 리포트 (Telegram 송출 중심) ────────────────────────────────────────────
  { timeKst: '06:15', label: '미 섹터 ETF 모멘텀 스캔', group: 'reports', jobName: 'sector_etf_momentum' },
  { timeKst: '07:30', label: '외국인 수급 선행 경보', group: 'alerts', jobName: 'foreign_flow_leading', silentWhen: 'EWY·DXY·외인 3축 합치하지 않으면 무음' },
  { timeKst: '08:30', label: '장전 방향 카드', group: 'alerts', jobName: 'pre_market_card', silentWhen: '|Bias Score| < 40 (NEUTRAL) 이면 무음 — BULL/BEAR 일에만 발송' },
  { timeKst: '08:35', label: 'ADR 갭 스캔 / 최종 스크리닝', group: 'alerts', jobName: 'adr_gap_scan', silentWhen: '|ADR 역산 갭| < 2% 이면 무음' },
  { timeKst: '08:40', label: 'DXY 한국 개장 직전 모니터', group: 'alerts', jobName: 'dxy_kr_open', silentWhen: 'DXY 방향 전환 신호 없을 시 무음' },
  { timeKst: '08:45', label: '아침 통합 브리핑', group: 'reports', jobName: 'morning_briefing' },
  { timeKst: '09:00', label: 'MHS 알림 / 거시-섹터 동기화 시작', group: 'alerts', jobName: 'mhs_open', silentWhen: 'MHS 가 RED(<40) 또는 GREEN(≥70) 전환이 아니면 무음' },
  { timeKst: '09:05', label: '보유 포지션 모닝카드', group: 'reports', jobName: 'morning_position_card', silentWhen: '활성 포지션 없으면 무음' },
  { timeKst: '09:10', label: 'newsSupply 추적', group: 'screener', jobName: 'news_supply_tracker' },
  { timeKst: '10:45', label: '장전 방향 카드 (HK 개장 30분 후 재계산)', group: 'alerts', jobName: 'pre_market_card_hk', silentWhen: '|Bias Score| < 40 이면 무음' },
  { timeKst: '12:30', label: '점심 통합 브리핑', group: 'reports', jobName: 'lunch_briefing' },
  { timeKst: '14:30', label: '섹터 사이클 대시보드', group: 'reports', jobName: 'sector_cycle_dashboard' },
  { timeKst: '15:35', label: 'INFO 일일 다이제스트 flush', group: 'reports', jobName: 'info_digest_flush', silentWhen: 'INFO 버퍼 비어 있으면 무음 (당일 INFO 알림 없음)' },
  { timeKst: '15:40', label: 'Ghost Portfolio 갱신', group: 'learning', jobName: 'ghost_portfolio', silentWhen: '내부 캐시 갱신만 — Telegram 송출 없음' },
  { timeKst: '16:00', label: '장마감 통합 브리핑', group: 'reports', jobName: 'eod_briefing' },
  { timeKst: '16:05', label: '52주 신고가 모멘텀 스캔', group: 'reports', jobName: 'high_52w_scan', silentWhen: '편입 후보 0건이면 무음' },
  { timeKst: '16:05', label: 'Shadow 수량 drift 점검 (DRY-RUN)', group: 'maintenance', jobName: 'shadow_qty_dryrun_broadcast', silentWhen: 'drift 0건이면 무음' },
  { timeKst: '16:25', label: '저녁 사이클 회로 자동 reset', group: 'maintenance', jobName: 'circuit_auto_reset', silentWhen: '내부 회로 reset 만 — Telegram 송출 없음' },
  { timeKst: '16:30', label: '일일 종목 픽 리포트', group: 'reports', jobName: 'daily_pick_report' },
  { timeKst: '16:40', label: '스캔 회고 리포트', group: 'reports', jobName: 'scan_retrospective' },
  { timeKst: '19:00', label: 'Nightly Reflection', group: 'learning', jobName: 'nightly_reflection' },
  { timeKst: '20:30', label: 'KIS 토큰 강제 갱신', group: 'trading', jobName: 'kis_token_refresh', silentWhen: '성공 시 내부 로그만' },
  { timeKst: '23:30', label: '일일 Reconciliation', group: 'maintenance', jobName: 'daily_reconcile', silentWhen: '장부 일치 시 내부 로그만 — 불일치 임계 초과 시에만 CRITICAL' },

  // ── 주간 / 월간 리포트 ────────────────────────────────────────────────────
  { timeKst: '월 08:00', label: '주간 캘리브레이션 리포트', group: 'reports', jobName: 'weekly_report' },
  { timeKst: '월 08:10', label: '주간 조건 성과 스코어카드', group: 'reports', jobName: 'weekly_condition_scorecard' },
  { timeKst: '수 15:00', label: '주간 심층 분석 카드 (SWING)', group: 'reports', jobName: 'weekly_deep_analysis', silentWhen: 'SWING Gate 상위 종목 없을 시 무음' },
  { timeKst: '수 16:30', label: '주중 Sharpe 급락 조기 경보', group: 'learning', jobName: 'weekly_sharpe_alert', silentWhen: 'Sharpe 이번 주 > 4주 평균 50% 이면 무음' },
  { timeKst: '금 17:00', label: '주간 퀀트 인사이트', group: 'reports', jobName: 'weekly_quant_insight' },
  { timeKst: '금 17:00', label: 'SYSTEM 채널 주간 요약 flush', group: 'reports', jobName: 'system_weekly_flush', silentWhen: 'SYSTEM 버퍼 비어 있으면 무음' },
  { timeKst: '일 10:00', label: '주간 무결성 + 알림 감사 리포트', group: 'reports', jobName: 'weekly_integrity_report' },
  { timeKst: '1일 07:00', label: 'Walk-Forward Validation (월 1회)', group: 'learning', jobName: 'walk_forward_validation', silentWhen: 'IS↔OOS 승률 격차 ≤ 15%p 이면 무음' },

  // ── 상시 ──────────────────────────────────────────────────────────────────
  { timeKst: '상시',  label: '오케스트레이터 1분 tick', group: 'trading', jobName: 'orchestrator_tick' },
  { timeKst: '상시',  label: 'OCO/매도 체결 감시', group: 'trading', jobName: 'oco_close_loop' },
  { timeKst: '상시',  label: 'DART/IPS/ACK 폴링', group: 'alerts', jobName: 'dart_ips_ack_poll' },
  { timeKst: '상시',  label: 'DXY 인트라데이 5분 모니터 (US 장중)', group: 'alerts', jobName: 'dxy_intraday' },
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

/**
 * 작업별 누적 메트릭 — recordScheduleRun() 가 갱신.
 * 운영자가 "지난주 어떤 잡이 가장 많이 실패했나?" 같은 시계열 질문에 답하기 위한 SSOT.
 */
export interface JobMetrics {
  jobName: string;
  /** success + failure + skipped 누적 */
  runCount: number;
  successCount: number;
  failCount: number;
  skippedCount: number;
  /** 마지막 성공 시각 (ISO) */
  lastSuccessAt?: string;
  /** 마지막 실패 시각 (ISO) */
  lastFailureAt?: string;
  /** 마지막 실패 메시지 — note 첫 줄 ≤120자 절삭 */
  lastErrorMessage?: string;
  /**
   * 마지막 스킵 사유 — ScheduleGuard(ADR-0037) 가 기록.
   * 'WEEKEND' / 'KRX_HOLIDAY' / 'LONG_HOLIDAY' / 'TRADING_DAY' / 'NON_TRADING_DAY' 등.
   * 운영자가 "월요일 자기반성이 정상 실행됐는가" 같은 시계열 진단에 활용.
   */
  lastSkipReason?: string;
}

const _metricsByJob = new Map<string, JobMetrics>();
const ERROR_MESSAGE_LIMIT = 120;

function ensureMetrics(jobName: string): JobMetrics {
  let m = _metricsByJob.get(jobName);
  if (!m) {
    m = { jobName, runCount: 0, successCount: 0, failCount: 0, skippedCount: 0 };
    _metricsByJob.set(jobName, m);
  }
  return m;
}

export function recordScheduleRun(rec: ScheduleRunRecord): void {
  _history.push(rec);
  if (_history.length > HISTORY_LIMIT) _history.shift();
  _lastByJob.set(rec.jobName, rec);

  // 누적 메트릭 갱신 — JobMetrics SSOT
  const m = ensureMetrics(rec.jobName);
  m.runCount += 1;
  if (rec.status === 'success') {
    m.successCount += 1;
    m.lastSuccessAt = rec.finishedAt;
  } else if (rec.status === 'failure') {
    m.failCount += 1;
    m.lastFailureAt = rec.finishedAt;
    if (rec.note) {
      m.lastErrorMessage = rec.note.slice(0, ERROR_MESSAGE_LIMIT);
    }
  } else {
    m.skippedCount += 1;
    if (rec.note) {
      m.lastSkipReason = rec.note.slice(0, ERROR_MESSAGE_LIMIT);
    }
  }
}

export function getScheduleHistory(limit = 20): ScheduleRunRecord[] {
  return _history.slice(-limit).reverse();
}

export function getLastRunByJob(jobName: string): ScheduleRunRecord | undefined {
  return _lastByJob.get(jobName);
}

/** 단일 작업 누적 메트릭. 한 번도 실행 안 된 작업은 undefined. */
export function getJobMetrics(jobName: string): JobMetrics | undefined {
  return _metricsByJob.get(jobName);
}

/**
 * 등록된 모든 작업의 메트릭 — failCount 내림차순, 동률은 runCount 내림차순.
 * "최악 실패율" 작업이 항상 먼저 보이도록 정렬.
 */
export function getAllJobMetrics(): JobMetrics[] {
  return Array.from(_metricsByJob.values())
    .map((m) => ({ ...m })) // 외부에서 mutate 차단
    .sort((a, b) => {
      if (b.failCount !== a.failCount) return b.failCount - a.failCount;
      return b.runCount - a.runCount;
    });
}

/** 테스트 전용 — 메트릭/이력 초기화. */
export function __resetScheduleMetricsForTests(): void {
  _history.length = 0;
  _lastByJob.clear();
  _metricsByJob.clear();
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
      const silent = item.silentWhen ? ' 🔕' : '';
      lines.push(`• ${item.timeKst} — ${item.label}${disabled}${silent}${lastTag}`);
    }
  }
  lines.push('\n<i>🔕 = 조건부 무음 (상세는 /scheduler detail)</i>');
  lines.push('<i>/scheduler next · detail · history</i>');
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
      if (item.silentWhen) {
        lines.push(`   🔕 조건부 무음: ${item.silentWhen}`);
      }
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
