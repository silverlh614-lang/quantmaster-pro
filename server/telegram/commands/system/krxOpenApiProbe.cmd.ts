// @responsibility krxOpenApiProbe.cmd 텔레그램 모듈
/**
 * /krx_probe — KRX OpenAPI index/stock daily raw row-count 진단.
 *
 * ADR-0363: sectorEnergy 0/12 persistent failure 원인 분리용 read-only probe.
 * - 실제 read base/env/auth 상태
 * - 최근 KRX 거래일 후보
 * - KOSPI/KOSDAQ index daily row count
 * - KOSPI/KOSDAQ stock daily row count
 * - sector map coverage
 * - sectorEnergy meta reason 전체
 */

import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';
import { getKrxOpenApiStatus, recentBusinessDaysKst } from '../../../clients/krxOpenApi.js';
import { probeKrxOpenApiBases, formatRawProbeSummary } from '../../../clients/krxOpenApiRawProbe.js';
import { getSectorMapStats } from '../../../screener/sectorMap.js';
import { buildSectorEnergyInputsWithMeta } from '../../../clients/sectorEnergyProvider.js';

const PROBE_RATE_LIMIT_MS = 60_000;
let _lastProbeAt = 0;

export function __resetKrxOpenApiProbeRateLimitForTests(): void {
  _lastProbeAt = 0;
}

function shortPreview(s: string | undefined, max = 120): string {
  if (!s) return '';
  const cleaned = s.replace(/\s+/g, ' ').trim();
  return cleaned.length > max ? `${cleaned.slice(0, max)}…` : cleaned;
}

function oneLine(label: string, probes: Awaited<ReturnType<typeof probeKrxOpenApiBases>>): string {
  const primary = probes[0];
  const preview = primary?.first300Chars ? ` | ${shortPreview(primary.first300Chars, 90)}` : '';
  return `• ${label}: ${formatRawProbeSummary(probes)}${preview}`;
}

const krxOpenApiProbe: TelegramCommand = {
  name: '/krx_probe',
  aliases: ['/kop', '/krx_openapi_probe'],
  category: 'SYS',
  visibility: 'ADMIN',
  riskLevel: 0,
  description: 'KRX OpenAPI index/stock daily row-count 진단 — sectorEnergy 0/12 원인 분리 (read-only)',
  usage: '/krx_probe',
  async execute({ reply }) {
    const now = Date.now();
    if (now - _lastProbeAt < PROBE_RATE_LIMIT_MS) {
      const wait = Math.ceil((PROBE_RATE_LIMIT_MS - (now - _lastProbeAt)) / 1000);
      await reply(`⏱️ 60초 이내 재호출 차단 — ${wait}초 후 다시 시도`);
      return;
    }
    _lastProbeAt = now;

    await reply('🔍 KRX OpenAPI Probe — index/stock daily raw row-count 확인 중...');

    try {
      const status = getKrxOpenApiStatus();
      const recent = recentBusinessDaysKst(5);
      const basDd = recent[0] ?? '';
      const pastBasDd = recentBusinessDaysKst(25)[20] ?? '';
      const paramsToday: Record<string, string> = basDd ? { basDd } : {};
      const paramsPast: Record<string, string> = pastBasDd ? { basDd: pastBasDd } : {};

      const [
        kospiIdx,
        kosdaqIdx,
        kospiStock,
        kosdaqStock,
        kospiStockPast,
        kosdaqStockPast,
      ] = await Promise.all([
        probeKrxOpenApiBases('idx/kospi_dd_trd', paramsToday),
        probeKrxOpenApiBases('idx/kosdaq_dd_trd', paramsToday),
        probeKrxOpenApiBases('sto/stk_bydd_trd', paramsToday),
        probeKrxOpenApiBases('sto/ksq_bydd_trd', paramsToday),
        probeKrxOpenApiBases('sto/stk_bydd_trd', paramsPast),
        probeKrxOpenApiBases('sto/ksq_bydd_trd', paramsPast),
      ]);

      const sectorStats = getSectorMapStats();
      const sectorMeta = await buildSectorEnergyInputsWithMeta().catch((e) => ({
        inputs: [],
        dataQuality: 'FAILED' as const,
        validSectorCount: 0,
        totalSectorCount: 12,
        reasons: [`sectorEnergy meta throw: ${e instanceof Error ? e.message : String(e)}`],
      }));

      const lines: string[] = [];
      lines.push('🔍 <b>KRX OpenAPI Probe Result</b>');
      lines.push('');
      lines.push('<b>① Runtime config</b>');
      lines.push(`• base: ${status.base}`);
      lines.push(`• enabled: ${status.enabled ? '✅' : '❌'} | authKey: ${status.authKeyConfigured ? '✅' : '❌'} | circuit: ${status.circuitState} failures=${status.failures}`);
      lines.push(`• recentBusinessDaysKst(5): ${recent.join(', ') || 'NONE'}`);
      lines.push(`• today basDd: ${basDd || 'NONE'} | past basDd: ${pastBasDd || 'NONE'}`);
      lines.push('');
      lines.push('<b>② Raw row counts by endpoint</b>');
      lines.push(oneLine('KOSPI index', kospiIdx));
      lines.push(oneLine('KOSDAQ index', kosdaqIdx));
      lines.push(oneLine('KOSPI stock', kospiStock));
      lines.push(oneLine('KOSDAQ stock', kosdaqStock));
      lines.push(oneLine('KOSPI stock past', kospiStockPast));
      lines.push(oneLine('KOSDAQ stock past', kosdaqStockPast));
      lines.push('');
      lines.push('<b>③ Sector map</b>');
      lines.push(`• loaded: ${sectorStats.krxMapLoaded ? '✅' : '❌'} | krxAutoMap=${sectorStats.krxAutoMap} | manual=${sectorStats.manualOverrides} | total=${sectorStats.totalCoverage}`);
      lines.push('');
      lines.push('<b>④ SectorEnergy meta</b>');
      lines.push(`• dataQuality: ${sectorMeta.dataQuality}`);
      lines.push(`• validSectorCount: ${sectorMeta.validSectorCount}/${sectorMeta.totalSectorCount}`);
      if (sectorMeta.reasons.length > 0) {
        lines.push(`• reasons: ${sectorMeta.reasons.join('; ')}`);
      }

      await reply(lines.join('\n'));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await reply(`❌ KRX OpenAPI Probe 실패: ${msg}`);
    }
  },
};

commandRegistry.register(krxOpenApiProbe);

export default krxOpenApiProbe;
