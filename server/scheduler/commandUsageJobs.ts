/**
 * @responsibility 명령어 사용량 텔레메트리 cron — 주간 폐기 후보 리포트 발송 (ADR-0017 §Stage 3, PR-48).
 *
 * 매주 월요일 09:00 KST (UTC 00:00 월요일) — collectDeprecationCandidates(30) 후
 * 후보가 ≥ 1개일 때만 텔레그램 T2_REPORT 로 발송. 후보 0건이면 채팅 노이즈 방지로 스킵.
 * Stage 3 텔레메트리 폐쇄루프(ADR-0007 §학습 모듈 폐쇄루프 정책) 와 동일 패턴.
 */
import { scheduledJob } from './scheduleGuard.js';

import { sendTelegramAlert } from '../alerts/telegramClient.js';
import {
  collectDeprecationCandidates,
  formatDeprecationReport,
} from '../telegram/deprecationReport.js';

const DEFAULT_THRESHOLD_DAYS = 30;

export async function runDeprecationReport(
  thresholdDays: number = DEFAULT_THRESHOLD_DAYS,
  now: number = Date.now(),
): Promise<{ sent: boolean; candidates: number }> {
  const data = collectDeprecationCandidates(thresholdDays, now);
  if (data.totalCandidates === 0) {
    return { sent: false, candidates: 0 };
  }
  const message = formatDeprecationReport(data);
  await sendTelegramAlert(message, {
    priority: 'NORMAL',
    tier: 'T2_REPORT',
    category: 'deprecation_report',
    dedupeKey: `deprecation-report:${new Date(now).toISOString().slice(0, 10)}`,
  }).catch(e =>
    console.error('[CommandUsageJobs] 폐기 리포트 발송 실패:', e instanceof Error ? e.message : e),
  );
  return { sent: true, candidates: data.totalCandidates };
}

export function registerCommandUsageJobs(): void {
  // 매주 월요일 09:00 KST = UTC 00:00 월요일.
  // PR-B-2: ALWAYS_ON — 운영 리포트는 KRX 공휴일이어도 발송 가치 있음
  // (월요일이 공휴일이면 후보 분석 결과만 silent 발송).
  scheduledJob('0 0 * * 1', 'ALWAYS_ON', 'deprecation_report', async () => {
    const res = await runDeprecationReport();
    console.log(
      `[CommandUsageJobs] 폐기 후보 리포트: ${res.sent ? `발송됨 (${res.candidates}건)` : '후보 0건 — 스킵'}`,
    );
  }, { timezone: 'UTC' });
}
