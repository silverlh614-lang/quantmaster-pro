// @responsibility ledger.cmd 텔레그램 모듈
// @responsibility: /ledger — Parallel Universe Ledger Sharpe (A/B/C universe 별 win/μ/σ/Sharpe/PF).
import { getUniverseStats } from '../../../learning/ledgerSimulator.js';
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';

const ledger: TelegramCommand = {
  name: '/ledger',
  category: 'LRN',
  visibility: 'ADMIN',
  riskLevel: 0,
  description: 'Parallel Universe Ledger Sharpe (A/B/C 비교)',
  async execute({ reply }) {
    const stats = getUniverseStats();
    const lines = ['🌌 <b>[Parallel Universe Ledger]</b>', '━━━━━━━━━━━━━━━━'];
    for (const s of stats) {
      lines.push(
        `Universe ${s.universe} (${s.label})\n` +
        `   n=${s.closedSamples} · win=${(s.winRate * 100).toFixed(0)}% · μ=${s.meanReturn.toFixed(2)}% · σ=${s.stdReturn.toFixed(2)}%\n` +
        `   Sharpe=${s.sharpe.toFixed(2)} · PF=${
          s.profitFactor === null
            ? 'n/a'
            : s.profitFactor === Infinity
              ? '∞'
              : s.profitFactor.toFixed(2)
        }`,
      );
    }
    lines.push('━━━━━━━━━━━━━━━━');
    lines.push('<i>Universe A 는 실 진입과 동형. B/C 는 대안 세팅 학습 표본.</i>');
    await reply(lines.join('\n'));
  },
};

commandRegistry.register(ledger);

export default ledger;
