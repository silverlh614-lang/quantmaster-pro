// @responsibility KIS sector iscd brute-force probe for FINANCE/IT_INTERNET verification; read-only diagnostic.

import { fetchKisSectorIndexDaily, isKisSectorIndexDailyDisabled } from '../../../clients/kisClient/query.js';
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';

const PROBE_RANGE_START = 1;
const PROBE_RANGE_END = 50;
const PROBE_DELAY_MS = 350;

interface SectorIscdProbeHit {
  iscd: string;
  name: string;
  rows: number;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatProbeCandidates(label: string, candidates: readonly SectorIscdProbeHit[]): string {
  if (candidates.length === 0) return `${label} 후보: 없음 - 범위 확장 필요`;
  return `${label} 후보: ${candidates.map((item) => `${item.iscd}(${item.name})`).join(', ')}`;
}

export async function buildSectorIscdProbeMessage(): Promise<string> {
  if (isKisSectorIndexDailyDisabled()) {
    return 'KIS_SECTOR_INDEX_DAILY_ENABLED=true 필요';
  }

  const results: string[] = ['KIS ISCD Probe (0001~0050)', '```'];
  const found: SectorIscdProbeHit[] = [];

  for (let i = PROBE_RANGE_START; i <= PROBE_RANGE_END; i += 1) {
    const iscd = String(i).padStart(4, '0');
    await delay(PROBE_DELAY_MS);
    try {
      const result = await fetchKisSectorIndexDaily(iscd, undefined, undefined, 'LOW');
      if (result && result.series.length > 0) {
        const name = result.sectorName || '(name-empty)';
        found.push({ iscd, name, rows: result.series.length });
        results.push(`OK ${iscd} ${name} rows=${result.series.length}`);
      } else {
        results.push(`EMPTY ${iscd}`);
      }
    } catch {
      results.push(`ERROR ${iscd}`);
    }
  }

  results.push('```');
  results.push('');
  results.push('금융/IT 후보 확인:');
  const financeCandidates = found.filter((item) =>
    ['금융', '은행', '증권', '보험'].some((keyword) => item.name.includes(keyword)),
  );
  const itCandidates = found.filter((item) =>
    ['인터넷', 'IT', '플랫폼', '서비스', '소프트', '통신'].some((keyword) => item.name.includes(keyword)),
  );
  results.push(formatProbeCandidates('금융', financeCandidates));
  results.push(formatProbeCandidates('IT/인터넷', itCandidates));
  results.push('');
  results.push('결과를 PR에 기록 후 KIS_SECTOR_ISCD_MAP 수정');
  return results.join('\n');
}

const sectorIscdProbeCommand: TelegramCommand = {
  name: '/sector_iscd_probe',
  category: 'SYS',
  visibility: 'ADMIN',
  riskLevel: 0,
  description: 'KIS 업종 iscd 전수 탐색 (0001~0050)',
  usage: '/sector_iscd_probe',
  async execute({ reply }) {
    await reply(await buildSectorIscdProbeMessage());
  },
};

commandRegistry.register(sectorIscdProbeCommand);

export default sectorIscdProbeCommand;
