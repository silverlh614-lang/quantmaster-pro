// @responsibility Legacy /kelly command compatibility.
import { loadTradingSettings } from '../../../persistence/tradingSettingsRepo.js';
import { loadMacroState } from '../../../persistence/macroStateRepo.js';
import { resolveCanonicalRegimeLevel } from '../../../trading/regime/canonicalRegimeAccess.js';
import { calculateRegimePositionSizing } from '../../../trading/sizing/regimePositionPolicy.js';
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';

const kelly: TelegramCommand = {
  name: '/kelly',
  category: 'LRN',
  visibility: 'ADMIN',
  riskLevel: 0,
  description: 'Legacy probability sizing command; current regime position policy shown',
  async execute({ reply }) {
    const settings = loadTradingSettings();
    const totalEquity = settings.startingCapital ?? 0;
    const regime = resolveCanonicalRegimeLevel(loadMacroState()); // ADR-0531: Gate0 정본 레짐
    const sizing = calculateRegimePositionSizing({
      regime,
      totalEquity,
      currentPositions: 0,
    });

    await reply([
      '<b>Legacy probability sizing disabled</b>',
      'sizingPolicy=REGIME_GROSS_EXPOSURE_DIVIDED_BY_MAX_POSITIONS',
      `regime=${sizing.policy.regime}`,
      `maxPositions=${sizing.policy.maxPositions}`,
      `maxGrossExposurePct=${sizing.policy.maxGrossExposurePct}`,
      `perPositionPct=${sizing.policy.perPositionPct}`,
      `positionAmount=${Math.round(sizing.positionAmount).toLocaleString()} KRW`,
      'executionImpact=NONE',
    ].join('\n'));
  },
};

commandRegistry.register(kelly);
