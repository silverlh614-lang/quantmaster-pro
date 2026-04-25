// @responsibility: /kelly — 종목별 Kelly 헬스 카드 (entryKellySnapshot 대비 현재 Kelly/IPS decay + 권고).
import { loadKellyDampenerState } from '../../../trading/kellyDampener.js';
import { formatKellyHealthCards } from '../../../trading/kellyHealthCard.js';
import { loadMacroState } from '../../../persistence/macroStateRepo.js';
import { getLiveRegime } from '../../../trading/regimeBridge.js';
import { getShadowTrades } from '../../../orchestrator/tradingOrchestrator.js';
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';

const kelly: TelegramCommand = {
  name: '/kelly',
  category: 'LRN',
  visibility: 'ADMIN',
  riskLevel: 0,
  description: '종목별 Kelly 헬스 카드 (진입 vs 현재 + HOLD/TRIM/EXIT 권고)',
  async execute({ reply }) {
    const shadows = getShadowTrades();
    const dampener = loadKellyDampenerState();
    const macro = loadMacroState();
    const liveRegime = getLiveRegime(macro);
    await reply(
      formatKellyHealthCards({
        shadows,
        currentIps: dampener.ips,
        currentRegime: liveRegime,
        currentIpsMultiplier: dampener.multiplier,
      }),
    );
  },
};

commandRegistry.register(kelly);

export default kelly;
