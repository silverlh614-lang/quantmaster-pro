// @responsibility /macro_source_probe — FRED/ECOS 외부 거시지표 라이브 프로브 (read-only 진단, API 키 미출력).
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';
import { probeFred, type FredProbeResult } from '../../../clients/fredClient.js';
import { probeEcos, type EcosProbeResult } from '../../../clients/ecosClient.js';

function verdictFred(r: FredProbeResult): string {
  if (r.disabled) return 'DISABLED (FRED_API_DISABLED=true)';
  if (!r.hasKey) return 'NO_KEY (FRED_API_KEY 미설정)';
  if (r.error) return `NETWORK_FAIL (${r.error})`;
  if (r.ok === false) return `HTTP_${r.httpStatus} — 키 거부/요청 오류 (errorBody 참조)`;
  if (r.ok && (r.observationCount ?? 0) > 0) return 'OK';
  if (r.ok) return 'OK_BUT_EMPTY (series 무데이터)';
  return 'UNKNOWN';
}

function verdictEcos(r: EcosProbeResult): string {
  if (r.disabled) return 'DISABLED (ECOS_API_DISABLED=true)';
  if (!r.hasKey) return 'NO_KEY (ECOS_API_KEY 미설정)';
  if (r.error) return `NETWORK_FAIL (${r.error})`;
  if (r.ok === false) return `HTTP_${r.httpStatus}`;
  if ((r.rowCount ?? 0) > 0) return 'OK';
  if (r.resultCode && r.resultCode !== 'INFO-200') return `RESULT_${r.resultCode} (${r.resultMessage ?? ''})`;
  if (r.resultCode === 'INFO-200') return 'OK_BUT_EMPTY (해당기간 무데이터)';
  return 'UNKNOWN';
}

export async function formatMacroSourceProbe(): Promise<string> {
  const [fred, ecos] = await Promise.all([probeFred(), probeEcos()]);
  return [
    '[macro_source_probe] FRED / ECOS 라이브 프로브',
    '',
    '🇺🇸 FRED',
    `  verdict=${verdictFred(fred)}`,
    `  hasKey=${fred.hasKey} disabled=${fred.disabled} base=${fred.base}`,
    `  dnsV4=${fred.dnsV4.join(',') || 'NONE'} dnsV6=${fred.dnsV6.join(',') || 'NONE'}${fred.dnsError ? ` dnsError=${fred.dnsError}` : ''}`,
    `  series=${fred.seriesId} reachedNetwork=${fred.reachedNetwork} httpStatus=${fred.httpStatus ?? 'N/A'} ok=${fred.ok ?? 'N/A'} elapsedMs=${fred.elapsedMs}`,
    `  observationCount=${fred.observationCount ?? 'N/A'} sampleValue=${fred.sampleValue ?? 'N/A'}`,
    ...(fred.errorBody ? [`  errorBody=${fred.errorBody}`] : []),
    ...(fred.error ? [`  error=${fred.error}`] : []),
    '',
    '🇰🇷 ECOS',
    `  verdict=${verdictEcos(ecos)}`,
    `  hasKey=${ecos.hasKey} disabled=${ecos.disabled} base=${ecos.base}`,
    `  statCode=${ecos.statCode} reachedNetwork=${ecos.reachedNetwork} httpStatus=${ecos.httpStatus ?? 'N/A'} ok=${ecos.ok ?? 'N/A'} elapsedMs=${ecos.elapsedMs}`,
    `  rowCount=${ecos.rowCount ?? 'N/A'} resultCode=${ecos.resultCode ?? 'N/A'}`,
    ...(ecos.resultMessage ? [`  resultMessage=${ecos.resultMessage}`] : []),
    ...(ecos.error ? [`  error=${ecos.error}`] : []),
    '',
    'executionImpact=NONE · read-only live probe · API keys are never printed.',
  ].join('\n');
}

const macroSourceProbe: TelegramCommand = {
  name: '/macro_source_probe',
  aliases: ['/fred_status', '/fred_probe', '/ecos_probe', '/ecos_status', '/macro_probe'],
  category: 'SYS',
  visibility: 'ADMIN',
  riskLevel: 0,
  description: 'Live FRED/ECOS macro-source probe (read-only; HTTP/RESULT/timeout/key diagnosis)',
  usage: '/macro_source_probe',
  async execute({ reply }) {
    await reply(await formatMacroSourceProbe());
  },
};

commandRegistry.register(macroSourceProbe);

export { macroSourceProbe };
export default macroSourceProbe;
