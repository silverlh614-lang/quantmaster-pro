// @responsibility /normal_supply_preview diagnostic-only normal-mode supply preview.
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';
import {
  formatNormalSupplyPreviewMissingSection,
  formatNormalSupplyPreviewSection,
  getLastNormalSupplyPreview,
} from '../../../trading/signalScanner/normalSupplyPreview.js';
import { collectNormalSupplyPreviewFromWatchlist } from '../../../trading/signalScanner/normalSupplyPreviewRunner.js';

const normalSupplyPreview: TelegramCommand = {
  name: '/normal_supply_preview',
  aliases: ['/normal_supply', '/supply_preview'],
  category: 'SYS',
  visibility: 'ADMIN',
  riskLevel: 0,
  description: 'SELL_ONLY/macro live block 중 정상모드 기준 후보별 수급 preview',
  usage: '/normal_supply_preview',
  async execute({ reply }) {
    await reply(
      [
        '🧪 <b>[Normal Supply Preview]</b> collecting...',
        'previewMode=NORMAL_SUPPLY_DIAGNOSTIC',
        'liveExecutionAllowed=false',
        'realOrderAllowed=false',
        'executionImpact=NONE',
      ].join('\n'),
    );
    try {
      const preview = await collectNormalSupplyPreviewFromWatchlist({
        reason: 'telegram operator /normal_supply_preview',
      });
      await reply(formatNormalSupplyPreviewSection(preview, { maxTopCandidates: 10 }) ?? formatNormalSupplyPreviewMissingSection());
    } catch (error) {
      const latest = getLastNormalSupplyPreview();
      const message = error instanceof Error ? error.message : String(error);
      await reply(
        latest
          ? [
              formatNormalSupplyPreviewSection(latest, { maxTopCandidates: 10 }),
              '',
              `refreshError: ${message}`,
            ].filter((line): line is string => Boolean(line)).join('\n')
          : formatNormalSupplyPreviewMissingSection(message),
      );
    }
  },
};

commandRegistry.register(normalSupplyPreview);

export default normalSupplyPreview;
