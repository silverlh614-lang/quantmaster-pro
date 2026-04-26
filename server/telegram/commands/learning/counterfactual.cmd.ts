// @responsibility counterfactual.cmd 텔레그램 모듈
// @responsibility: /counterfactual — Gate 탈락 후보의 30/60/90일 수익률 분포 통계.
import { getCounterfactualStats } from '../../../learning/counterfactualShadow.js';
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';

const counterfactual: TelegramCommand = {
  name: '/counterfactual',
  category: 'LRN',
  visibility: 'ADMIN',
  riskLevel: 0,
  description: '탈락 후보 가상 추적 통계 (30/60/90일 분포)',
  async execute({ reply }) {
    const lines = ['🔬 <b>[Counterfactual Shadow — 탈락 후보 추적]</b>', '━━━━━━━━━━━━━━━━'];
    for (const h of [30, 60, 90] as const) {
      const s = getCounterfactualStats(h);
      if (!s) {
        lines.push(`${h}일: 샘플 부족`);
        continue;
      }
      lines.push(
        `${h}일: n=${s.samples} · μ=${s.mean.toFixed(2)}% · median=${s.median.toFixed(2)}% · win=${(s.winRate * 100).toFixed(0)}% · σ=${s.stdDev.toFixed(2)}%`,
      );
    }
    lines.push('━━━━━━━━━━━━━━━━');
    lines.push('<i>만약 수익률 분포가 통과 샘플과 유의하게 다르지 않다면 Gate 기준이 과잉.</i>');
    await reply(lines.join('\n'));
  },
};

commandRegistry.register(counterfactual);

export default counterfactual;
