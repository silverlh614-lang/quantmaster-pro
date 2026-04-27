// @responsibility krxScan.cmd 텔레그램 모듈
// @responsibility: /krx_scan — KRX 서킷·캐시 reset 후 Stage1+2+3 발굴 파이프라인 강제 재실행. TRD.
import { getEmergencyStop } from '../../../state.js';
import { loadMacroState } from '../../../persistence/macroStateRepo.js';
import { loadWatchlist } from '../../../persistence/watchlistRepo.js';
import { getLiveRegime } from '../../../trading/regimeBridge.js';
import { resetKrxCache } from '../../../clients/krxClient.js';
import {
  _resetKrxOpenApiBreaker,
  getKrxOpenApiStatus,
  resetKrxOpenApiCache,
} from '../../../clients/krxOpenApi.js';
import { runFullDiscoveryPipeline } from '../../../screener/universeScanner.js';
import { escapeHtml } from '../../../alerts/telegramClient.js';
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';

const krxScan: TelegramCommand = {
  name: '/krx_scan',
  category: 'TRD',
  visibility: 'ADMIN',
  riskLevel: 2,
  description: 'KRX 종목조회 강제 재스캔 (Stage1+2+3 — 회로/캐시 reset 후 재실행)',
  async execute({ reply }) {
    if (getEmergencyStop()) {
      await reply('🔴 비상 정지 상태 — 스캔 불가. /reset 으로 해제 후 재시도.');
      return;
    }
    const before = getKrxOpenApiStatus();
    _resetKrxOpenApiBreaker();
    resetKrxOpenApiCache();
    resetKrxCache();
    await reply(
      `🇰🇷 <b>KRX 강제 스캔 트리거</b>\n` +
      `서킷: ${before.circuitState} (실패 ${before.failures}회) → RESET\n` +
      `캐시: 초기화 완료\n` +
      `Stage1(KRX 종목조회) → Stage2 → Stage3 재실행 중...`,
    );
    try {
      const macroState = loadMacroState();
      const regime = getLiveRegime(macroState);
      await runFullDiscoveryPipeline(regime, macroState);
      const after = getKrxOpenApiStatus();
      const wl = loadWatchlist();
      await reply(
        `✅ <b>KRX 강제 스캔 완료</b>\n` +
        `서킷: ${after.circuitState} (실패 ${after.failures}회)\n` +
        `워치리스트: ${wl.length}개`,
      );
    } catch (e) {
      await reply(
        `❌ <b>KRX 강제 스캔 실패</b>\n` +
        `${escapeHtml(e instanceof Error ? e.message : String(e))}`,
      );
    }
  },
};

commandRegistry.register(krxScan);

export default krxScan;
