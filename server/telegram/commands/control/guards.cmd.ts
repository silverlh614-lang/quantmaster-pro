// @responsibility guards.cmd 텔레그램 모듈
// @responsibility: /guards — 6 가드 (emergencyStop/dailyLoss/integrity/pause/blockNewBuy/manageOnly) 통합 조회. EMR (read-only).
//
// ADR-0194: ADR-0017 commandRegistry 위에 6 가드 단일 진단 SSOT.
// 사용자가 "지금 신규 매수가 왜 안 되는지" 1 명령으로 식별.
//
// 외부 호출 0 (state.ts read-only) — riskLevel=0.
import {
  getEmergencyStop,
  getAutoTradePaused,
  getDataIntegrityBlocked,
  getManualBlockNewBuy,
  getManualManageOnly,
  getDailyLossPct,
  getSmokeTestLiveBlocked,
  getSmokeTestLastFailedReason,
} from '../../../state.js';
// ADR-0195: 8번째 가드 — R3 sanity block 영속 latch 가시화.
import { loadR3SanityBlockState } from '../../../persistence/r3SanityBlockRepo.js';
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';

const guards: TelegramCommand = {
  name: '/guards',
  aliases: ['/block_status', '/blocks'],
  category: 'EMR',
  visibility: 'ADMIN',
  riskLevel: 0,
  description: '신규 매수 차단 가드 6종 통합 조회 (read-only)',
  async execute({ reply }) {
    const emergencyStop = getEmergencyStop();
    const paused = getAutoTradePaused();
    const integrity = getDataIntegrityBlocked();
    const blockNewBuy = getManualBlockNewBuy();
    const manageOnly = getManualManageOnly();
    const smokeBlocked = getSmokeTestLiveBlocked();
    const smokeReason = getSmokeTestLastFailedReason();
    const dailyLossPct = getDailyLossPct();
    const dailyLossLimit = parseFloat(process.env.DAILY_LOSS_LIMIT ?? '5');
    const dailyLossHit = dailyLossPct >= dailyLossLimit;
    // ADR-0195: 8번째 가드 — R3 sanity block 영속 latch.
    const r3Sanity = loadR3SanityBlockState();
    const r3Active = r3Sanity.active;

    const anyBlocked = emergencyStop || paused || integrity || blockNewBuy || manageOnly || smokeBlocked || dailyLossHit || r3Active;

    const lines = [
      `🛡️ <b>[신규 매수 가드 상태]</b>`,
      `─────────────────────`,
      `비상정지 (/stop·/reset): ${emergencyStop ? '🛑 활성' : '✅ 비활성'}`,
      `소프트 일시정지 (/pause·/resume): ${paused ? '⏸ 활성' : '✅ 비활성'}`,
      `데이터 무결성 (/integrity clear): ${integrity ? '🔴 차단' : '✅ 정상'}`,
      `신규 매수 차단 (/unblock_buy): ${blockNewBuy ? '🔴 활성' : '✅ 비활성'}`,
      `보유만 관리 (/unmanage_only): ${manageOnly ? '🔒 활성' : '✅ 비활성'}`,
      `Pre-Market Smoke Test: ${smokeBlocked ? `🟡 LIVE 차단 (${smokeReason ?? '사유 미상'}, 다음 08:45 자동 해제)` : '✅ 통과'}`,
      `일일 손실 한도: ${dailyLossPct.toFixed(2)}% / ${dailyLossLimit}% ${dailyLossHit ? '🔴 도달' : '✅ 여유'}`,
      // ADR-0195: 8번째 가드 — R3 sanity block 영속 latch (활성 시에만 운영자 인지용 라인 추가).
      `R3 Sanity Block (/r3_unblock): ${r3Active ? `🚨 활성 (${r3Sanity.violation}/${r3Sanity.regime})` : '✅ 비활성'}`,
      `─────────────────────`,
      anyBlocked ? '⚠️ <b>일부 가드 활성</b> — 위 명령으로 개별 해제 가능' : '🟢 <b>모든 가드 정상</b> — 신규 매수 가능 시간대 자동 진입',
    ];

    await reply(lines.join('\n'));
  },
};

commandRegistry.register(guards);

export default guards;
