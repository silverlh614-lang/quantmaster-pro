// @responsibility ADR-0128 /data_verification_review — manual review queue 조회·승인·폐기 운영자 명령
/**
 * dataVerificationReview.cmd.ts (ADR-0128 정책 #6).
 *
 * 운영자 텔레그램 명령으로 verificationQueueRepo 의 manualReviewState='QUEUED' 종목을
 * 검토 + APPROVED/DROPPED 결정. 3회+ 연속 검증 실패 종목이 영구 차단되는 위험을
 * 운영자 개입으로 흡수.
 *
 * 사용법:
 *   /data_verification_review               — queue 조회
 *   /data_verification_review approve <code> — 격리 해제 (즉시 재검증 가능)
 *   /data_verification_review drop <code>    — universe 영구 제외
 *
 * Alias: /dvr / /verification_queue
 */

import {
  getManualReviewQueue,
  setManualReviewState,
  type VerificationQueueEntry,
} from '../../../persistence/verificationQueueRepo.js';
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';

function formatKstTime(iso: string): string {
  try {
    const ms = new Date(iso).getTime();
    if (!Number.isFinite(ms)) return '?';
    const kst = new Date(ms + 9 * 60 * 60 * 1000);
    return kst.toISOString().slice(0, 16).replace('T', ' ');
  } catch {
    return '?';
  }
}

/**
 * Manual review queue → 텔레그램 메시지 SSOT.
 * 빈 queue → "현재 검토 대기 종목 없음" 안내 + 사용법.
 */
export function formatVerificationReviewMessage(entries: VerificationQueueEntry[]): string {
  if (entries.length === 0) {
    return (
      '🛡️ [Data Verification Review]\n'
      + '현재 검토 대기 종목 없음.\n'
      + '\n사용법:\n'
      + '  /data_verification_review\n'
      + '  /data_verification_review approve <code>\n'
      + '  /data_verification_review drop <code>'
    );
  }

  const lines: string[] = [
    `🛡️ [Data Verification Review] ${entries.length}건 검토 대기`,
    '',
  ];
  for (const e of entries) {
    const name = e.stockName ? `${e.stockName} (${e.stockCode})` : e.stockCode;
    lines.push(
      `• ${name} — 연속 ${e.consecutiveFailures}회 실패`,
      `  사유: ${e.lastFailureReason}`,
      `  최근: ${formatKstTime(e.lastFailedAt)} KST`,
    );
  }
  lines.push(
    '',
    '/data_verification_review approve <code> — 격리 해제',
    '/data_verification_review drop <code> — 영구 제외',
  );
  return lines.join('\n');
}

const dataVerificationReview: TelegramCommand = {
  name: '/data_verification_review',
  aliases: ['/dvr', '/verification_queue'],
  category: 'SYS',
  visibility: 'ADMIN',
  riskLevel: 1,
  description: 'Data Verification 수동 검토 큐 — 3회+ 실패 종목 격리 해제(approve)/영구 제외(drop)',
  usage: '/data_verification_review [approve|drop <code>]',
  async execute({ args, reply }) {
    const sub = args[0]?.toLowerCase();

    // 인자 없음 → queue 조회
    if (!sub) {
      const queue = getManualReviewQueue();
      await reply(formatVerificationReviewMessage(queue));
      return;
    }

    // approve / drop 분기
    if (sub === 'approve' || sub === 'drop') {
      const code = args[1];
      if (!code || !/^\d{6}$/.test(code)) {
        await reply(
          `❌ 종목코드 누락 또는 형식 오류 (6자리).\n`
          + `사용법: /data_verification_review ${sub} <code>`,
        );
        return;
      }
      const newState = sub === 'approve' ? 'APPROVED' : 'DROPPED';
      const updated = setManualReviewState(code, newState, new Date(), 'telegram_operator');
      if (!updated) {
        await reply(`❌ ${code}: queue 에 entry 없음. /data_verification_review 로 검토 대기 목록 확인.`);
        return;
      }
      const label = newState === 'APPROVED' ? '✅ 격리 해제' : '🛑 영구 제외';
      await reply(
        `${label} — ${code} (state=${newState})\n`
        + (newState === 'APPROVED'
          ? '다음 사이클부터 정상 재검증 (cooldown 우회).'
          : '재시도 영구 차단. universe 진입 금지.'),
      );
      return;
    }

    // 알 수 없는 sub-command
    await reply(
      `❌ 알 수 없는 인자: ${sub}\n`
      + `사용법: /data_verification_review [approve|drop <code>]`,
    );
  },
};

commandRegistry.register(dataVerificationReview);

export default dataVerificationReview;
