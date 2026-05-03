/**
 * @responsibility R3 Sanity Block 텔레그램 운영자 제어 명령
 *
 * ADR-0146: 서버 재시작이나 환경변수 수정 없이 Telegram 환경에서
 * 즉각적으로 R3 Sanity 차단 상태를 조회하고 ack(해제) 할 수 있는 관리자 명령어.
 */
import { commandRegistry } from '../../commandRegistry.js';
import { sendTelegramAlert } from '../../../alerts/telegramClient.js';
import {
  loadR3SanityBlockState,
  acknowledgeR3SanityBlock,
} from '../../../persistence/r3SanityBlockRepo.js';

commandRegistry.register({
  command: '/sanity',
  aliases: ['/r3sanity', '/r3'],
  category: 'SYS',
  riskLevel: 1, // 시스템 상태(환경변수) 변경 허용
  visibility: 'ADMIN',
  description: 'R3 Sanity Block 상태 조회 및 해제',
  handler: async (_ctx, args) => {
    const state = loadR3SanityBlockState();
    const subCmd = args[0]?.toLowerCase();

    if (subCmd === 'ack' || subCmd === 'unlock') {
      if (!state.active) {
        return '✅ 현재 활성화된 R3 Sanity Block이 없습니다.';
      }

      // 메모리(환경변수)에 해제 토큰 주입 (다음 preflight 스캔 시 자동 적용/해제용)
      process.env.R3_SANITY_OPERATOR_ACK = state.triggeredAt;
      
      // 영속성 계층에 즉시 ack 처리 지시
      acknowledgeR3SanityBlock('R3_SANITY_OPERATOR_ACK');

      await sendTelegramAlert(
        `🔓 <b>[R3 Sanity Block 강제 해제]</b>\n운영자(Telegram) 명령으로 차단이 해제되었습니다.\n다음 스캔 사이클부터 정상 매수가 재개됩니다.`,
        { priority: 'HIGH' }
      ).catch(console.error);

      return '🔓 R3 Sanity Block이 성공적으로 해제되었습니다.';
    }

    // Default: status
    if (!state.active) {
      return '✅ <b>[R3 Sanity Status]</b>\n현재 시스템은 정상 상태입니다 (Sanity Block 없음).';
    }

    return `🚨 <b>[R3 Sanity Block Active]</b>\n` +
           `• 위반 사유: ${state.violation}\n` +
           `• 레짐: ${state.regime}\n` +
           `• 발생 일시: ${state.triggeredAt}\n\n` +
           `해제하려면 <code>/sanity ack</code> 명령을 전송하세요.`;
  },
});