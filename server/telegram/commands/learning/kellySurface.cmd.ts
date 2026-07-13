// @responsibility Legacy /kelly_surface command compatibility.
import { REGIME_POSITION_POLICIES } from '../../../trading/sizing/regimePositionPolicy.js';
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';

const kellySurface: TelegramCommand = {
  name: '/kelly_surface',
  category: 'LRN',
  visibility: 'ADMIN',
  riskLevel: 0,
  description: 'Legacy probability surface command; current regime sizing table shown',
  async execute({ reply }) {
    const rows = Object.values(REGIME_POSITION_POLICIES).map((policy) =>
      `${policy.regime}: maxPositions=${policy.maxPositions}, gross=${policy.maxGrossExposurePct}%, perPosition=${policy.perPositionPct}%`,
    );
    await reply([
      '<b>Legacy probability surface disabled</b>',
      'sizingPolicy=REGIME_GROSS_EXPOSURE_DIVIDED_BY_MAX_POSITIONS',
      ...rows,
      'executionImpact=NONE',
    ].join('\n'));
  },
};

commandRegistry.register(kellySurface);
