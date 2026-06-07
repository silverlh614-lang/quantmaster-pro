// @responsibility /vkospi_index_dump — KRX 파생지수 일별 응답 read-only 덤프 (진짜 VKOSPI 행/IDX_IND_CD 식별, executionImpact=NONE).
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';
import { fetchDerivativesIndexDaily, type KrxIndexDailyRow } from '../../../clients/krxOpenApi.js';
import { loadMacroState } from '../../../persistence/macroStateRepo.js';

const SUBSTRING_MATCH = (name: string): boolean =>
  name.includes('VKOSPI') || name.includes('변동성지수') || name.includes('코스피변동성');

function fmtRow(r: KrxIndexDailyRow): string {
  const close = Number.isFinite(r.close) ? r.close.toFixed(2) : 'N/A';
  const chg = Number.isFinite(r.changePct) ? r.changePct.toFixed(2) : 'N/A';
  return `  [${r.indexCode || '?'}] ${r.indexName} | close=${close} chg%=${chg} base=${r.baseDate || 'N/A'}`;
}

export async function formatVkospiIndexDump(): Promise<string> {
  const rows = await fetchDerivativesIndexDaily();
  const macro = loadMacroState();
  const vix = typeof macro?.vix === 'number' && Number.isFinite(macro.vix) ? macro.vix : null;

  const matches = rows.filter((r) => SUBSTRING_MATCH(r.indexName));
  const volCandidates = rows.filter((r) => /변동|VKOSPI/i.test(r.indexName) && !SUBSTRING_MATCH(r.indexName));
  const fullCap = 40;
  const byName = [...rows].sort((a, b) => a.indexName.localeCompare(b.indexName));

  return [
    '[vkospi_index_dump] KRX 파생지수 일별 (idx/drvprod_dd_trd)',
    `rowCount=${rows.length}${vix != null ? ` | 현재 VIX=${vix.toFixed(1)} (진짜 VKOSPI 는 통상 VIX±5~10 동행)` : ''}`,
    '',
    '🎯 현재 substring 매칭 (marketDataRefresh 가 실제로 줍는 행):',
    ...(matches.length ? matches.map(fmtRow) : ['  (매칭 0건 — 이름 규칙이 안 맞음)']),
    '',
    "📊 기타 '변동/VKOSPI' 이름 후보 (substring 비매칭):",
    ...(volCandidates.length ? volCandidates.map(fmtRow) : ['  (없음)']),
    '',
    `📋 전체 ${rows.length}행 (이름순 상위 ${fullCap}):`,
    ...byName.slice(0, fullCap).map(fmtRow),
    ...(rows.length > fullCap ? [`  …외 ${rows.length - fullCap}행 (더 필요하면 알려주세요)`] : []),
    '',
    '판독: VIX 근처 값(~15-25)인 행이 진짜 VKOSPI. 그 행의 IDX_IND_CD 를 pin(가) 하거나, 없으면 KIS 전환(나).',
    'executionImpact=NONE · read-only · KRX 파생지수 일별 1콜.',
  ].join('\n');
}

const vkospiIndexDump: TelegramCommand = {
  name: '/vkospi_index_dump',
  aliases: ['/vkospi_dump', '/vkospi_rows'],
  category: 'SYS',
  visibility: 'ADMIN',
  riskLevel: 0,
  description: 'KRX 파생지수 일별 응답 덤프 (진짜 VKOSPI 행/코드 식별, read-only)',
  usage: '/vkospi_index_dump',
  async execute({ reply }) {
    // 진단 명령은 어떤 경우에도 침묵하지 않는다 — fetch throw 시 사유 인밴드 보고.
    try {
      await reply(await formatVkospiIndexDump());
    } catch (e) {
      await reply(`[vkospi_index_dump] 실패: ${e instanceof Error ? e.message : String(e)}`);
    }
  },
};

commandRegistry.register(vkospiIndexDump);

export { vkospiIndexDump };
export default vkospiIndexDump;
