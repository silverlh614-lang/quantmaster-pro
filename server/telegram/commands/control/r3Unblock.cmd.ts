// @responsibility r3Unblock.cmd 텔레그램 모듈
// @responsibility: /r3_unblock — R3 sanity block 영속 latch 즉시 해제 (ADR-0120 후속 ADR-0195). EMR riskLevel=2.
//
// ADR-0195: 사용자 5/6 KST 10:21 보고 — 정규 매매 시간대 + /guards 7가드 모두 비활성인데도
// R3 sanity block latch 가 매수 차단 + 텔레그램 즉시 해제 명령 부재 → ENV 재배포만 가능.
// 본 명령 신설로 텔레그램에서 즉시 latch 해제 → 다음 cron tick 부터 신규 매수 재개.
//
// ADR-0120 영속 latch 정책 보존 — `acknowledgeR3SanityBlock` 직접 호출 (자동 해제 금지).
// LIVE 매매 즉시 영향이라 riskLevel=2 (운영자 명시 의도 의무, ADR-0146 자가 review).
import {
  loadR3SanityBlockState,
  acknowledgeR3SanityBlock,
} from '../../../persistence/r3SanityBlockRepo.js';
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
      await reply(
        '✅ <b>이미 R3 sanity block 비활성 상태입니다.</b>\n' +
        (before.acknowledgedAt
          ? `<i>마지막 해제: ${before.acknowledgedAt} (${before.acknowledgedBy ?? 'unknown'})</i>`
          : '<i>한 번도 발동되지 않음.</i>'),
      );
      return;
    }
    const after = acknowledgeR3SanityBlock('telegram_operator');
    console.warn(
      `[TelegramBot] /r3_unblock — R3 sanity block latch 해제 ` +
      `(${before.violation}, ${before.regime}, triggeredAt=${before.triggeredAt})`,
    );
    await reply(
      '🟢 <b>[R3 Sanity Block 해제]</b>\n' +
      `위반: <code>${before.violation}</code> / 레짐: <code>${before.regime}</code>\n` +
      `발동: ${before.triggeredAt}\n` +
      `해제: ${after.acknowledgedAt} (telegram_operator)\n` +
      '<i>다음 cron tick 부터 신규 매수 재개. /guards 로 8가드 통합 상태 확인 가능.</i>',
    );
  },
};

commandRegistry.register(r3Unblock);

export default r3Unblock;
