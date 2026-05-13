// @responsibility /program_market_raw — Patch-004 dedicated rawDiag exposure command (ADMIN read-only diagnostic).
//
// Patch-PROGRAM-MARKET-EMPTY-OUTPUT-ROUTER-004 §J #5:
//   rawDiag 는 Telegram 일반 알림에 노출되지 않는다. /program_market_raw 또는 Railway debug 로그에서만 노출.

import { diagnoseKisMarketProgramRaw } from '../../../clients/kisClient/supplyDiagnostics.js';
import { formatProgramMarketRawDiag } from '../../../clients/kisClient/programMarketRouterPatch004.js';
import { MARKET_PROGRAM_INDEX_CODE, MARKET_PROGRAM_TRADE_TR_ID, MARKET_PROGRAM_TRADE_PATH } from '../../../clients/kisClient/programMaterializer.js';
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
    marketCode: MARKET_PROGRAM_INDEX_CODE,
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
