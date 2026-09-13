// @responsibility 운영자 수동 스캔을 현재 시그널 경로로 연결하고 재호출 제한과 비상정지를 유지한다.
import { getEmergencyStop } from '../../../state.js';
import { runAutoSignalScan } from '../../../trading/scanDispatcher.js';
import { composeNowVerdict } from '../../metaCommands.js';
import { escapeHtml } from '../../../alerts/telegramClient.js';
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';

let _lastForceScanAt = 0;
const FORCE_SCAN_RATE_LIMIT_MS = 60_000;

/** 테스트 전용 — rate-limit state 초기화. */
export function __resetForceWatchScanRateLimitForTests(): void {
  _lastForceScanAt = 0;
}

const forceWatchScan: TelegramCommand = {
  name: '/force_watch_scan',
  aliases: ['/force_scan'],
  category: 'TRD',
  visibility: 'ADMIN',
  riskLevel: 1,
  description: '현재 모델의 관측·매매 시그널 수동 스캔',
  usage: '/force_watch_scan [full]',
  async execute({ reply }) {
    const now = Date.now();
    if (now - _lastForceScanAt < FORCE_SCAN_RATE_LIMIT_MS) {
      const wait = Math.ceil((FORCE_SCAN_RATE_LIMIT_MS - (now - _lastForceScanAt)) / 1000);
      await reply(`⏱️ 60초 이내 재호출 차단 — ${wait}초 후 다시 시도`);
      return;
    }
    if (getEmergencyStop()) {
      await reply('🛑 비상정지 활성 — /reset 으로 해제 후 재시도');
      return;
    }
    // 과거 full 인자도 현재 스캔으로 처리한다. 실패 시도도 재호출 제한에 포함한다.
    _lastForceScanAt = now;
    try {
      await runAutoSignalScan();
      await reply(composeNowVerdict());
    } catch (error) {
      await reply(`❌ 재스캔 실패: ${escapeHtml(error instanceof Error ? error.message : String(error))}`);
    }
  },
};
commandRegistry.register(forceWatchScan);
export default forceWatchScan;
