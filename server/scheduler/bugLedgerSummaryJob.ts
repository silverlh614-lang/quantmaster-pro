// @responsibility BUG_LEDGER 월간 자동 요약 cron — 매월 1일 10:00 KST (PR #669/#670/#671/#672/#673 후속 P2-B).

import { scheduledJob } from './scheduleGuard.js';
import { sendTelegramAlert } from '../alerts/telegramClient.js';
import {
  runBugLedgerMonthlyReport,
  isBugLedgerMonthlyReportDisabled,
} from '../alerts/bugLedgerSummaryReport.js';

const JOB_NAME = 'bug_ledger_monthly_report';

/**
 * cron entry — 매월 1일 10:00 KST = UTC 01:00 1일.
 *
 * ScheduleClass='ALWAYS_ON' — 운영 리포트는 KRX 휴장 영향 없음
 * (1일이 공휴일이어도 발송 가치 있음). PR-B-2 ScheduleClass 정합.
 *
 * ENV `BUG_LEDGER_MONTHLY_REPORT_DISABLED=true` 우회 — cron 자체는 발동하지만
 * runBugLedgerMonthlyReport 진입부에서 DISABLED skip.
 */
export function registerBugLedgerSummaryJob(): void {
  scheduledJob('0 1 1 * *', 'ALWAYS_ON', JOB_NAME, async () => {
    if (isBugLedgerMonthlyReportDisabled()) {
      console.log('[BugLedgerMonthlyReport] DISABLED via ENV — skip');
      return;
    }
    const result = await runBugLedgerMonthlyReport(sendTelegramAlert);
    console.log(
      `[BugLedgerMonthlyReport] ${result.sent ? `발송됨 (${result.totalBugs}건)` : `skip (${result.reason ?? 'unknown'})`}`,
    );
  }, { timezone: 'UTC' });
}
