// @responsibility BUG 후보 검출 cron — 매일 09:30 KST alertAuditLog 7일 윈도우 분석 (PR #669~#674 후속 P3).
//
// 절대 규칙:
//   1. 자동 BUG_LEDGER 전사 0건 (후보만 생성).
//   2. ENV `BUG_CANDIDATE_DETECTOR_ENABLED=true` default OFF (cron 발동 + ENV gate 안에서 skip).
//   3. KIS 주문 함수 import 금지.

import { scheduledJob } from './scheduleGuard.js';
import { sendTelegramAlert } from '../alerts/telegramClient.js';
import {
  detectBugCandidates,
  isBugCandidateDetectorEnabled,
} from '../learning/bugCandidateDetector.js';

const JOB_NAME = 'bug_candidate_detector';

/**
 * cron — 매일 09:30 KST = UTC 00:30.
 *
 * ScheduleClass='ALWAYS_ON' — 운영 진단은 KRX 휴장일에도 의미 있음
 * (휴장 직전/직후 알림 패턴 분석).
 *
 * ENV `BUG_CANDIDATE_DETECTOR_ENABLED` default OFF — 운영자 명시 활성화 의무.
 * 활성화 시 added > 0 일 때만 텔레그램 알림 (조용한 운영 — 신규 후보 발생 알림).
 */
export function registerBugCandidateJob(): void {
  scheduledJob('30 0 * * *', 'ALWAYS_ON', JOB_NAME, async () => {
    if (!isBugCandidateDetectorEnabled()) {
      console.log('[BugCandidateDetector] DISABLED via ENV — skip');
      return;
    }
    const result = detectBugCandidates();
    console.log(
      `[BugCandidateDetector] analyzed=${result.analyzedEntries} added=${result.added} updated=${result.updated} belowThreshold=${result.belowThreshold}`,
    );
    if (result.added > 0) {
      const date = new Date().toISOString().slice(0, 10);
      const message = [
        '🐛 <b>BUG 후보 신규 발견</b>',
        '',
        `📊 신규 ${result.added}건 / 갱신 ${result.updated}건 / 분석 ${result.analyzedEntries}건`,
        `📆 ${date} KST 기준 (7일 윈도우)`,
        '',
        '운영자 액션: <code>/bug_candidates</code> — 후보 검토 + dismiss/review',
        '',
        '<i>※ 자동 BUG_LEDGER 전사는 영구 금지 — 운영자가 수동 전사 (PR #669 SSOT 정책)</i>',
      ].join('\n');
      await sendTelegramAlert(message, {
        priority: 'NORMAL',
        tier: 'T2_REPORT',
        category: 'bug_candidate_detector',
        dedupeKey: `bug-candidate-detector:${date}`,
      }).catch((err) => {
        console.warn('[BugCandidateDetector] 알림 발송 실패:', err instanceof Error ? err.message : err);
      });
    }
  }, { timezone: 'UTC' });
}
