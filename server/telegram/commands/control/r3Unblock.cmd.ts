// @responsibility r3Unblock.cmd 텔레그램 모듈
// @responsibility: /r3_unblock — R3 sanity block 영속 latch 즉시 해제 (ADR-0120 후속 ADR-0195). EMR riskLevel=2.
//
// ADR-0195: 사용자 5/6 KST 10:21 보고 — 정규 매매 시간대 + /guards 7가드 모두 비활성인데도
// R3 sanity block latch 가 매수 차단 + 텔레그램 즉시 해제 명령 부재 → ENV 재배포만 가능.
// 본 명령 신설로 텔레그램에서 즉시 latch 해제 → 다음 cron tick 부터 신규 매수 재개.
//
// ADR-0120 영속 latch 정책 보존 — `acknowledgeR3SanityBlock` 직접 호출 (자동 해제 금지).
// LIVE 매매 즉시 영향이라 riskLevel=2 (운영자 명시 의도 의무, ADR-0146 자가 review).
//
// ADR-0401 — 본 명령 추가 동작: latch 해제 직후 violation streak 도 reset 호출.
// 운영자가 latch 해제 시 다음 누적 cycle 을 0 부터 시작하도록 보장 (절대 원칙 #15 정합).
import {
  loadR3SanityBlockState,
  acknowledgeR3SanityBlock,
} from '../../../persistence/r3SanityBlockRepo.js';
import { resetR3ViolationStreakState } from '../../../persistence/r3ViolationStreakRepo.js';
import { emitReportSectionWarn } from '../../../observability/reportSectionWarn.js';

function emitR3UnblockSectionWarn(message: string, error?: unknown): void {
  emitReportSectionWarn({
    section: 'R3_UNBLOCK',
    message: String(message).slice(0, 180),
    error,
    dedupKey: `p2:telegram:section:R3_UNBLOCK:${String(message).slice(0, 96)}`,
  });
}

import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';

const r3Unblock: TelegramCommand = {
  name: '/r3_unblock',
  aliases: ['/r3_clear', '/clear_r3_sanity'],
  category: 'EMR',
  visibility: 'ADMIN',
  riskLevel: 2,
  description: 'R3 sanity block 영속 latch 즉시 해제 (다음 cron tick 부터 신규 매수 재개)',
  async execute({ reply }) {
    const before = loadR3SanityBlockState();
    if (!before.active) {
      // ADR-0401 — latch 비활성이어도 streak 은 누적 가능. 운영자 명시 reset 의도 충족.
      try {
        resetR3ViolationStreakState();
      } catch (e) {
        emitR3UnblockSectionWarn('[TelegramBot] /r3_unblock — streak reset 실패 (latch 비활성 분기):', e);
      }
      await reply(
        '✅ <b>이미 R3 sanity block 비활성 상태입니다.</b>\n' +
        (before.acknowledgedAt
          ? `<i>마지막 해제: ${before.acknowledgedAt} (${before.acknowledgedBy ?? 'unknown'})</i>`
          : '<i>한 번도 발동되지 않음.</i>') +
        '\n<i>R3 violation streak 도 reset (ADR-0401).</i>',
      );
      return;
    }
    const after = acknowledgeR3SanityBlock('telegram_operator');
    // ADR-0401 — latch 해제 + streak reset (다음 누적 cycle 0 부터 시작).
    try {
      resetR3ViolationStreakState();
    } catch (e) {
      emitR3UnblockSectionWarn('[TelegramBot] /r3_unblock — streak reset 실패:', e);
    }
    emitR3UnblockSectionWarn(
      `[TelegramBot] /r3_unblock — R3 sanity block latch 해제 ` +
      `(${before.violation}, ${before.regime}, triggeredAt=${before.triggeredAt})`,
    );
    await reply(
      '🟢 <b>[R3 Sanity Block 해제]</b>\n' +
      `위반: <code>${before.violation}</code> / 레짐: <code>${before.regime}</code>\n` +
      `발동: ${before.triggeredAt}\n` +
      `해제: ${after.acknowledgedAt} (telegram_operator)\n` +
      '<i>R3 violation streak 도 reset (ADR-0401). 다음 cron tick 부터 신규 매수 재개.</i>',
    );
  },
};

commandRegistry.register(r3Unblock);
