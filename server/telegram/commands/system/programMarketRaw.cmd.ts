// @responsibility /program_market_raw — Patch-004 dedicated rawDiag exposure command (ADMIN read-only diagnostic).
//
// Patch-PROGRAM-MARKET-EMPTY-OUTPUT-ROUTER-004 §J #5:
//   rawDiag 는 Telegram 일반 알림에 노출되지 않는다. /program_market_raw 또는 Railway debug 로그에서만 노출.

import { diagnoseKisMarketProgramRaw } from '../../../clients/kisClient/supplyDiagnostics.js';
import { formatProgramMarketRawDiag } from '../../../clients/kisClient/programMarketRouterPatch004.js';
import { MARKET_PROGRAM_PARAM_MODE, MARKET_PROGRAM_TRADE_TR_ID, MARKET_PROGRAM_TRADE_PATH, buildMarketProgramTradeTodayParams } from '../../../clients/kisClient/programMaterializer.js';
import { fetchKrxIntradayProgramTradeAggregate, getKrxIntradayMarketProgramBld, isKrxIntradayMarketProgramEnabled } from '../../../clients/krxClient/intradayProgramTradeFetcher.js';
import { loadMacroState } from '../../../persistence/macroStateRepo.js';
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';

// 5분 rate-limit (다른 ADMIN diagnostic command 정합).
let _lastInvocationMs = 0;
const RATE_LIMIT_MS = 5 * 60 * 1000;

export function __resetProgramMarketRawRateLimitForTests(): void {
  _lastInvocationMs = 0;
}

export async function buildProgramMarketRawMessage(): Promise<string> {
  const requestedAt = new Date().toISOString();
  const startMs = Date.now();
  const rawDiag = await diagnoseKisMarketProgramRaw('LOW');
  const latencyMs = Date.now() - startMs;
  const lines = formatProgramMarketRawDiag({
    endpoint: rawDiag.path ?? MARKET_PROGRAM_TRADE_PATH,
    trId: rawDiag.trId ?? MARKET_PROGRAM_TRADE_TR_ID,
    marketCode: undefined,
    queryParams: undefined, // sanitized — raw query 노출 안 함 (token 위험)
    httpStatus: rawDiag.ok ? 200 : undefined,
    responseCode: rawDiag.zeroReason ?? undefined,
    msgCd: rawDiag.rootSample?.msg_cd as string | undefined,
    msg1: rawDiag.rootSample?.msg1 as string | undefined,
    zeroReason: rawDiag.zeroReason ?? undefined,
    outputLength: rawDiag.outputKeys?.length ?? 0,
    outputKeys: rawDiag.outputKeys,
    firstRowSample: rawDiag.sample,
    requestedAt,
    providerLatencyMs: latencyMs,
  });
  lines.push('');
  lines.push('🔬 <b>[KRX Intraday Shape Probe]</b>');
  lines.push(`krxIntradayEnabled: ${isKrxIntradayMarketProgramEnabled()}`);
  lines.push(`krxBldMarketProgramIntraday: ${getKrxIntradayMarketProgramBld()}`);
  if (isKrxIntradayMarketProgramEnabled()) {
    const krxStartMs = Date.now();
    const krx = await fetchKrxIntradayProgramTradeAggregate(Date.now());
    const shapeProbe = krx.intradayShapeProbe ?? null;
    lines.push(`krxFallbackStatus: ${krx.confidence}`);
    lines.push(`krxProviderLatencyMs: ${Date.now() - krxStartMs}`);
    lines.push(`krxIntradayConfidence: ${shapeProbe?.confidence ?? krx.confidence}`);
    lines.push(`selectedPath: ${shapeProbe?.shapeCandidatePath ?? 'NONE'}`);
    lines.push(`topLevelKeys: ${shapeProbe?.topLevelKeys.join(', ') || 'NONE'}`);
    lines.push(`rowCount: ${shapeProbe?.rowCount ?? 0}`);
    lines.push(`firstRowKeys: ${shapeProbe?.firstRowKeys.slice(0, 12).join(', ') || 'NONE'}`);
    lines.push(`numericFieldCandidates: ${shapeProbe?.numericFieldCandidates.slice(0, 12).join(', ') || 'NONE'}`);
    if (shapeProbe?.firstRowSample) {
      const sample = Object.entries(shapeProbe.firstRowSample).slice(0, 8).map(([k, v]) => `${k}:${v ?? 'NULL'}`).join(', ');
      lines.push(`firstRowSample: ${sample || 'NONE'}`);
    }
  } else {
    lines.push('krxFallbackStatus: NOT_TRIED');
    lines.push('krxIntradayConfidence: DISABLED');
    lines.push('operatorHint: set KRX_INTRADAY_MARKET_PROGRAM_ENABLED=true and optionally KRX_BLD_MARKET_PROGRAM_INTRADAY for shape verification');
  }
  const kospiParams = buildMarketProgramTradeTodayParams('K');
  const kosdaqParams = buildMarketProgramTradeTodayParams('Q');
  const serializerProbe = new URLSearchParams(kospiParams).toString();
  const droppedEmpty = !serializerProbe.includes('FID_SCTN_CLS_CODE=')
    || !serializerProbe.includes('FID_INPUT_ISCD=')
    || !serializerProbe.includes('FID_COND_MRKT_DIV_CODE1=')
    || !serializerProbe.includes('FID_INPUT_HOUR_1=');
  const missingField = typeof rawDiag.rootSample?.msg1 === 'string'
    ? (rawDiag.rootSample.msg1.match(/\[([^\]]+)\]/)?.[1] ?? 'N/A')
    : 'N/A';
  lines.push(`paramMode: ${MARKET_PROGRAM_PARAM_MODE}`);
  lines.push(`kospiRequestParams: ${JSON.stringify(kospiParams)}`);
  lines.push(`kosdaqRequestParams: ${JSON.stringify(kosdaqParams)}`);
  lines.push(`requestSerializerDroppedEmptyFields: ${droppedEmpty}`);
  lines.push(`missingFieldFromKisError: ${missingField}`);
  lines.push(`zeroReason: ${rawDiag.zeroReason === 'NON_ZERO' ? 'NON_ZERO' : (rawDiag.zeroReason ?? 'N/A')}`);
  lines.push('executionImpact=NONE, providerIssue=false, marketSignal=false, scoring=excluded until mapping verified');

  const macro = loadMacroState();
  const pm = macro?.programMarket;

  const aggregate = (pm as any)?.aggregateDiagnostic;
  const kospiResp = aggregate?.kospiResponse;
  const kosdaqResp = aggregate?.kosdaqResponse;
  if (kospiResp) {
    lines.push('');
    lines.push('KIS KOSPI Response:');
    for (const k of ['requested','marketClassCode','httpStatus','responseCode','msgCd','msg1','outputLength','outputKeys','firstRowSample','firstRowBsopHour','lastRowBsopHour','selectedBsopHour','selectedRawWholeNetBuy','zeroReason']) {
      lines.push(`- ${k}: ${typeof kospiResp[k] === 'object' ? JSON.stringify(kospiResp[k]) : (kospiResp[k] ?? 'N/A')}`);
    }
  }
  if (kosdaqResp) {
    lines.push('');
    lines.push('KIS KOSDAQ Response:');
    for (const k of ['requested','marketClassCode','httpStatus','responseCode','msgCd','msg1','outputLength','outputKeys','firstRowSample','firstRowBsopHour','lastRowBsopHour','selectedBsopHour','selectedRawWholeNetBuy','zeroReason']) {
      lines.push(`- ${k}: ${typeof kosdaqResp[k] === 'object' ? JSON.stringify(kosdaqResp[k]) : (kosdaqResp[k] ?? 'N/A')}`);
    }
  }

  if (pm?.rowBreakdown) {
    lines.push('');
    lines.push('rowBreakdown:');
    if (pm.splitAvailable) {
      for (const [name, row] of Object.entries(pm.rowBreakdown)) {
        lines.push(`${name.toUpperCase()}: outputLength=${row.outputLength} nonZeroRows=${row.nonZeroRows} selectedBsopHour=${row.selectedBsopHour} rawWholeNetBuy=${row.rawWholeNetBuy} rawArbitrageNetBuy=${row.rawArbitrageNetBuy} rawNonArbitrageNetBuy=${row.rawNonArbitrageNetBuy} displayWholeNetBuy=${row.displayWholeNetBuy}`);
        lines.push(`  unitCandidates: KRW=${row.unitCandidates.KRW} KRW_1K=${row.unitCandidates.KRW_1K} KRW_1M=${row.unitCandidates.KRW_1M}`);
      }
    } else {
      lines.push(`KOSPI: N/A (split unavailable)`);
      lines.push(`KOSDAQ: N/A (split unavailable)`);
      const c = pm.rowBreakdown.combined;
      lines.push(`COMBINED: outputLength=${c.outputLength} nonZeroRows=${c.nonZeroRows} selectedBsopHour=${c.selectedBsopHour} rawWholeNetBuy=${c.rawWholeNetBuy}`);
    }
  }
  if (pm?.unit.rawUnitAssumption === 'UNVERIFIED' && pm.unitCandidates) {
    lines.push('unitCandidates:');
    lines.push(`  KRW: ${pm.unitCandidates.KRW}`);
    lines.push(`  KRW_1K: ${pm.unitCandidates.KRW_1K}`);
    lines.push(`  KRW_1M: ${pm.unitCandidates.KRW_1M}`);
    lines.push('selectedDisplayUnitAssumption=UNVERIFIED');
    lines.push('mappingConfidence=UNIT_UNVERIFIED');
    lines.push('scoring=shadow_only');
    lines.push('useForExecution=false');
  }

  return lines.join('\n');
}

const programMarketRaw: TelegramCommand = {
  name: '/program_market_raw',
  aliases: ['/pmr', '/program_market_diag'],
  category: 'SYS',
  visibility: 'ADMIN',
  riskLevel: 0,
  description: 'KIS 시장 프로그램 매매 rawDiag — endpoint/trId/marketCode/queryParams/responseCode/outputKeys (Patch-004 §J #5, ADMIN only)',
  usage: '/program_market_raw',
  async execute({ reply }) {
    const nowMs = Date.now();
    if (nowMs - _lastInvocationMs < RATE_LIMIT_MS) {
      const remainSec = Math.ceil((RATE_LIMIT_MS - (nowMs - _lastInvocationMs)) / 1000);
      await reply(`⏳ /program_market_raw rate-limit (5분, 잔여 ${remainSec}s)`);
      return;
    }
    _lastInvocationMs = nowMs;
    try {
      const message = await buildProgramMarketRawMessage();
      await reply(message);
    } catch (err) {
      console.error('[programMarketRaw.cmd] failed', err);
      await reply('❌ rawDiag 진단 실패 — 서버 로그 확인 필요');
    }
  },
};

commandRegistry.register(programMarketRaw);

export default programMarketRaw;
