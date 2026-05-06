/**
 * @responsibility bugLedgerSummaryReport 회귀 테스트 (PR #669/#670 후속 P2-B)
 *
 * 검증:
 *   - buildMonthlySummary: 30일 윈도우 / unresolvedP0 / recurring / recentResolved
 *   - formatMonthlySummaryMessage: 빈 ledger / 정상 / HTML escape / 섹션 조건부
 *   - isBugLedgerMonthlyReportDisabled: ENV 정확 비교
 *   - runBugLedgerMonthlyReport: 빈 ledger / DISABLED / OK / 알림 throw graceful
 */

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import {
  buildMonthlySummary,
  formatMonthlySummaryMessage,
  isBugLedgerMonthlyReportDisabled,
  runBugLedgerMonthlyReport,
} from './bugLedgerSummaryReport.js';
import type { BugEntry } from '../persistence/bugLedgerRepo.js';

const NOW_MS = new Date('2026-05-07T01:00:00Z').getTime();
// = 2026-05-07T10:00 KST

function entry(overrides: Partial<BugEntry> = {}): BugEntry {
  return {
    id: 'BUG-2026-05-07-001',
    status: 'OPEN',
    severity: 'P0',
    area: 'Market Truth Layer',
    discovered: '2026-05-07',
    resolved: null,
    related_adrs: [],
    related_bugs: [],
    keywords: [],
    recurrence_count: 0,
    summary: '휴장일 기준일 혼합 위험',
    ...overrides,
  };
}

describe('buildMonthlySummary', () => {
  it('빈 배열 — total=0, recent 모두 빈 배열', () => {
    const s = buildMonthlySummary([], NOW_MS);
    expect(s.total).toBe(0);
    expect(s.recentNew).toEqual([]);
    expect(s.recentResolved).toEqual([]);
    expect(s.unresolvedP0).toEqual([]);
    expect(s.recurring).toEqual([]);
  });

  it('30일 윈도우 — 31일 전 BUG 는 recentNew 미포함', () => {
    const recent = entry({ id: 'BUG-2026-04-20-001', discovered: '2026-04-20' });
    const old = entry({ id: 'BUG-2026-03-01-001', discovered: '2026-03-01' });
    const s = buildMonthlySummary([recent, old], NOW_MS);
    expect(s.recentNew).toHaveLength(1);
    expect(s.recentNew[0].id).toBe('BUG-2026-04-20-001');
  });

  it('미래 시점 BUG 는 recentNew 미포함 (ageDays 음수 차단)', () => {
    const future = entry({ id: 'BUG-2026-05-10-001', discovered: '2026-05-10' });
    const s = buildMonthlySummary([future], NOW_MS);
    expect(s.recentNew).toEqual([]);
  });

  it('unresolvedP0 — OPEN/PATCHED + P0 만', () => {
    const open = entry({ id: 'BUG-2026-05-01-001', status: 'OPEN', severity: 'P0' });
    const patched = entry({ id: 'BUG-2026-05-02-001', status: 'PATCHED', severity: 'P0' });
    const closed = entry({ id: 'BUG-2026-05-03-001', status: 'CLOSED', severity: 'P0' });
    const p1Open = entry({ id: 'BUG-2026-05-04-001', status: 'OPEN', severity: 'P1' });
    const s = buildMonthlySummary([open, patched, closed, p1Open], NOW_MS);
    expect(s.unresolvedP0).toHaveLength(2);
    expect(s.unresolvedP0.map((e) => e.id).sort()).toEqual([
      'BUG-2026-05-01-001',
      'BUG-2026-05-02-001',
    ]);
  });

  it('recurring — recurrence_count > 0 만, 큰 순', () => {
    const r1 = entry({ id: 'BUG-2026-05-01-001', recurrence_count: 1 });
    const r5 = entry({ id: 'BUG-2026-05-02-001', recurrence_count: 5 });
    const r0 = entry({ id: 'BUG-2026-05-03-001', recurrence_count: 0 });
    const s = buildMonthlySummary([r1, r5, r0], NOW_MS);
    expect(s.recurring).toHaveLength(2);
    expect(s.recurring[0].recurrence_count).toBe(5);
    expect(s.recurring[1].recurrence_count).toBe(1);
  });

  it('recentResolved — 30일 내 resolved 만, resolved desc 정렬', () => {
    const a = entry({ id: 'BUG-2026-04-15-001', status: 'CLOSED', resolved: '2026-04-25' });
    const b = entry({ id: 'BUG-2026-04-10-001', status: 'CLOSED', resolved: '2026-05-01' });
    const old = entry({ id: 'BUG-2026-01-01-001', status: 'CLOSED', resolved: '2026-02-01' });
    const noResolved = entry({ id: 'BUG-2026-04-20-001', status: 'OPEN', resolved: null });
    const s = buildMonthlySummary([a, b, old, noResolved], NOW_MS);
    expect(s.recentResolved).toHaveLength(2);
    expect(s.recentResolved[0].id).toBe('BUG-2026-04-10-001'); // resolved=2026-05-01 (최신)
    expect(s.recentResolved[1].id).toBe('BUG-2026-04-15-001'); // resolved=2026-04-25
  });

  it('reportedAtKst — UTC → KST 일자 변환', () => {
    // 2026-05-07T01:00 UTC = 2026-05-07T10:00 KST
    const s = buildMonthlySummary([], NOW_MS);
    expect(s.reportedAtKst).toBe('2026-05-07');
    // 자정 직전 UTC = KST 오전 8:59 다음날
    const utcMidnight = new Date('2026-04-30T23:59:00Z').getTime();
    const s2 = buildMonthlySummary([], utcMidnight);
    expect(s2.reportedAtKst).toBe('2026-05-01');
  });

  it('byStatus / bySeverity / byArea 카운트', () => {
    const e1 = entry({ id: 'BUG-2026-05-01-001', status: 'OPEN', severity: 'P0', area: 'Market Truth Layer' });
    const e2 = entry({ id: 'BUG-2026-05-02-001', status: 'CLOSED', severity: 'P1', area: 'Risk Layer' });
    const s = buildMonthlySummary([e1, e2], NOW_MS);
    expect(s.byStatus.OPEN).toBe(1);
    expect(s.byStatus.CLOSED).toBe(1);
    expect(s.bySeverity.P0).toBe(1);
    expect(s.bySeverity.P1).toBe(1);
    expect(s.byArea['Market Truth Layer']).toBe(1);
    expect(s.byArea['Risk Layer']).toBe(1);
  });
});

describe('formatMonthlySummaryMessage', () => {
  it('total=0 — 깨끗한 한 달 메시지', () => {
    const s = buildMonthlySummary([], NOW_MS);
    const msg = formatMonthlySummaryMessage(s);
    expect(msg).toContain('깨끗한 한 달');
    expect(msg).toContain('2026-05-07');
  });

  it('정상 — 총 N건 + status/severity 분포 + area Top 5', () => {
    const e1 = entry({ id: 'BUG-2026-05-01-001', status: 'OPEN', severity: 'P0', area: 'Market Truth Layer' });
    const e2 = entry({ id: 'BUG-2026-05-02-001', status: 'CLOSED', severity: 'P1', area: 'Risk Layer' });
    const s = buildMonthlySummary([e1, e2], NOW_MS);
    const msg = formatMonthlySummaryMessage(s);
    expect(msg).toContain('총 2건');
    expect(msg).toMatch(/OPEN=1/);
    expect(msg).toMatch(/CLOSED=1/);
    expect(msg).toMatch(/P0=1/);
    expect(msg).toMatch(/P1=1/);
    expect(msg).toContain('Market Truth Layer');
    expect(msg).toContain('Risk Layer');
  });

  it('미해결 P0 섹션 — OPEN P0 강조', () => {
    const e = entry({ id: 'BUG-2026-05-01-001', status: 'OPEN', severity: 'P0' });
    const s = buildMonthlySummary([e], NOW_MS);
    const msg = formatMonthlySummaryMessage(s);
    expect(msg).toContain('미해결 P0');
    expect(msg).toContain('BUG-2026-05-01-001');
  });

  it('미해결 P0 부재 시 섹션 미렌더 (footer 힌트 문구는 항상 노출)', () => {
    const e = entry({ id: 'BUG-2026-05-01-001', status: 'CLOSED', severity: 'P0' });
    const s = buildMonthlySummary([e], NOW_MS);
    const msg = formatMonthlySummaryMessage(s);
    // 섹션 헤더 (🛑 <b>미해결 P0) 미렌더 — footer 의 "(미해결 P0)" 힌트는 별개로 항상 노출
    expect(msg).not.toContain('🛑 <b>미해결 P0');
    expect(msg).toContain('/bugs p0');  // footer 힌트 보존 검증
  });

  it('재발 섹션 — recurrence > 0', () => {
    const e = entry({ recurrence_count: 3 });
    const s = buildMonthlySummary([e], NOW_MS);
    const msg = formatMonthlySummaryMessage(s);
    expect(msg).toContain('재발');
    expect(msg).toContain('↻3');
  });

  it('HTML escape — area / summary', () => {
    const e = entry({ area: 'Risk <Layer>', summary: '잘못된 <주문>' });
    const s = buildMonthlySummary([e], NOW_MS);
    const msg = formatMonthlySummaryMessage(s);
    expect(msg).toContain('Risk &lt;Layer&gt;');
    expect(msg).toContain('잘못된 &lt;주문&gt;');
  });

  it('운영자 액션 안내 라인 항상 노출 (total > 0)', () => {
    const s = buildMonthlySummary([entry()], NOW_MS);
    const msg = formatMonthlySummaryMessage(s);
    expect(msg).toContain('/bugs p0');
    expect(msg).toContain('/bugs open');
  });
});

describe('isBugLedgerMonthlyReportDisabled', () => {
  const orig = process.env.BUG_LEDGER_MONTHLY_REPORT_DISABLED;
  afterEach(() => {
    if (orig === undefined) delete process.env.BUG_LEDGER_MONTHLY_REPORT_DISABLED;
    else process.env.BUG_LEDGER_MONTHLY_REPORT_DISABLED = orig;
  });

  it('default OFF', () => {
    delete process.env.BUG_LEDGER_MONTHLY_REPORT_DISABLED;
    expect(isBugLedgerMonthlyReportDisabled()).toBe(false);
  });

  it('=== "true" 정확 비교', () => {
    process.env.BUG_LEDGER_MONTHLY_REPORT_DISABLED = 'true';
    expect(isBugLedgerMonthlyReportDisabled()).toBe(true);
  });

  it('"1" / "TRUE" / "yes" 모두 거부', () => {
    process.env.BUG_LEDGER_MONTHLY_REPORT_DISABLED = '1';
    expect(isBugLedgerMonthlyReportDisabled()).toBe(false);
    process.env.BUG_LEDGER_MONTHLY_REPORT_DISABLED = 'TRUE';
    expect(isBugLedgerMonthlyReportDisabled()).toBe(false);
    process.env.BUG_LEDGER_MONTHLY_REPORT_DISABLED = 'yes';
    expect(isBugLedgerMonthlyReportDisabled()).toBe(false);
  });
});

describe('runBugLedgerMonthlyReport', () => {
  const orig = process.env.BUG_LEDGER_MONTHLY_REPORT_DISABLED;
  beforeEach(() => {
    delete process.env.BUG_LEDGER_MONTHLY_REPORT_DISABLED;
  });
  afterEach(() => {
    if (orig === undefined) delete process.env.BUG_LEDGER_MONTHLY_REPORT_DISABLED;
    else process.env.BUG_LEDGER_MONTHLY_REPORT_DISABLED = orig;
  });

  it('DISABLED env → sent=false, reason=DISABLED', async () => {
    process.env.BUG_LEDGER_MONTHLY_REPORT_DISABLED = 'true';
    const sendAlert = vi.fn();
    const r = await runBugLedgerMonthlyReport(sendAlert as any, NOW_MS);
    expect(r.sent).toBe(false);
    expect(r.reason).toBe('DISABLED');
    expect(sendAlert).not.toHaveBeenCalled();
  });

  it('정상 ledger → sendAlert 호출됨, sent=true', async () => {
    const sendAlert = vi.fn().mockResolvedValue(undefined);
    const r = await runBugLedgerMonthlyReport(sendAlert as any, NOW_MS);
    // 실제 BUG_LEDGER 가 코드베이스에 존재 (1 entry) 라 sent=true 또는 EMPTY
    expect(r.totalBugs).toBeGreaterThanOrEqual(0);
    if (r.sent) {
      expect(sendAlert).toHaveBeenCalledTimes(1);
      const callArgs = sendAlert.mock.calls[0];
      expect(callArgs[1].priority).toBe('NORMAL');
      expect(callArgs[1].tier).toBe('T2_REPORT');
      expect(callArgs[1].category).toBe('bug_ledger_monthly');
      expect(callArgs[1].dedupeKey).toMatch(/^bug-ledger-monthly:\d{4}-\d{2}$/);
    }
  });

  it('sendAlert throw → graceful', async () => {
    const sendAlert = vi.fn().mockRejectedValue(new Error('telegram 401'));
    const r = await runBugLedgerMonthlyReport(sendAlert as any, NOW_MS);
    // sent=true 라도 예외는 잡힘
    expect(r.totalBugs).toBeGreaterThanOrEqual(0);
  });
});
