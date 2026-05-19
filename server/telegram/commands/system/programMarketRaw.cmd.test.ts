// @responsibility Patch-004 §J #5 — /program_market_raw command regression.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CMD_SOURCE = readFileSync(resolve(__dirname, 'programMarketRaw.cmd.ts'), 'utf8');

vi.mock('../../../clients/kisClient/supplyDiagnostics.js', () => ({
  diagnoseKisMarketProgramRaw: vi.fn(async () => ({
    kind: 'MARKET_PROGRAM',
    code: '0001',
    ok: true,
    trId: 'FHPPG04600101',
    path: '/uapi/domestic-stock/v1/quotations/comp-program-trade-today',
    rootKeys: ['rt_cd', 'msg_cd', 'output'],
    outputPath: 'output',
    outputKeys: [],
    parsed: {},
    zeroReason: 'ACCEPTED_EMPTY',
    sample: {},
    rootSample: { rt_cd: '0', msg_cd: 'MCA00000', msg1: 'NORMAL' },
  })),
}));

vi.mock('../../../persistence/macroStateRepo.js', () => ({
  loadMacroState: vi.fn(() => ({
    programMarket: {
      unit: { rawUnitAssumption: 'UNVERIFIED' },
      unitCandidates: { KRW: '-0.02억원', KRW_1K: '-16.88억원', KRW_1M: '-16,879.44억원' },
      rowBreakdown: {
        kospi: { outputLength: 11, nonZeroRows: 15, selectedBsopHour: '153000', rawWholeNetBuy: -1000, rawArbitrageNetBuy: null, rawNonArbitrageNetBuy: null, displayWholeNetBuy: '-0.01억원', unitCandidates: { KRW: '-0.01억원', KRW_1K: '-0.10억원', KRW_1M: '-100.00억원' } },
        kosdaq: { outputLength: 19, nonZeroRows: 15, selectedBsopHour: '153000', rawWholeNetBuy: -687944, rawArbitrageNetBuy: null, rawNonArbitrageNetBuy: null, displayWholeNetBuy: '-0.01억원', unitCandidates: { KRW: '-0.01억원', KRW_1K: '-6.88억원', KRW_1M: '-6,879.44억원' } },
        combined: { outputLength: 30, nonZeroRows: 30, selectedBsopHour: '153000', rawWholeNetBuy: -1687944, rawArbitrageNetBuy: 46866, rawNonArbitrageNetBuy: -1734809, displayWholeNetBuy: '-0.02억원', unitCandidates: { KRW: '-0.02억원', KRW_1K: '-16.88억원', KRW_1M: '-16,879.44억원' } },
      },
    },
  })),
}));

import { buildProgramMarketRawMessage, __resetProgramMarketRawRateLimitForTests } from './programMarketRaw.cmd.js';
import programMarketRaw from './programMarketRaw.cmd.js';

describe('/program_market_raw — Patch-004 §J #5', () => {
  beforeEach(() => __resetProgramMarketRawRateLimitForTests());

  it('command registered as SYS riskLevel=0 ADMIN', () => {
    expect(programMarketRaw.name).toBe('/program_market_raw');
    expect(programMarketRaw.category).toBe('SYS');
    expect(programMarketRaw.riskLevel).toBe(0);
    expect(programMarketRaw.visibility).toBe('ADMIN');
    expect(programMarketRaw.aliases).toContain('/pmr');
    expect(programMarketRaw.aliases).toContain('/program_market_diag');
  });

  it('buildProgramMarketRawMessage returns rawDiag lines with endpoint / trId / marketCode', async () => {
    const msg = await buildProgramMarketRawMessage();
    expect(msg).toContain('Program Market Raw Diagnostic');
    expect(msg).toContain('trId: FHPPG04600101');
    expect(msg).toContain('marketCode: N/A');
    expect(msg).toContain('paramMode: OFFICIAL');
    expect(msg).toContain('requestSerializerDroppedEmptyFields: false');
    expect(msg).toContain('kospiRequestParams:');
    expect(msg).toContain('zeroReason: ACCEPTED_EMPTY');
    expect(msg).toContain('executionImpact=NONE');
    expect(msg).toContain('KOSPI: N/A (split unavailable)');
    expect(msg).toContain('KOSDAQ: N/A (split unavailable)');
    expect(msg).toContain('COMBINED: outputLength=30 nonZeroRows=30');
    expect(msg).toContain('unitCandidates:');
    expect(msg).toContain('KRW_1K: -16.88억원');
    expect(msg).toContain('useForExecution=false');
    expect(msg).toContain('providerIssue=false');
    expect(msg).toContain('marketSignal=false');
  });

  it('rate-limit 5min blocks repeat call within window', async () => {
    const replies: string[] = [];
    const reply = async (m: string) => { replies.push(m); };
    await programMarketRaw.execute({ args: [], reply });
    await programMarketRaw.execute({ args: [], reply });
    expect(replies).toHaveLength(2);
    expect(replies[1]).toContain('rate-limit');
  });

  it('execute throws graceful → ❌ message', async () => {
    const replies: string[] = [];
    const supplyDiag = await import('../../../clients/kisClient/supplyDiagnostics.js');
    (supplyDiag.diagnoseKisMarketProgramRaw as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('boom'));
    await programMarketRaw.execute({ args: [], reply: async (m: string) => { replies.push(m); } });
    expect(replies[0]).toContain('rawDiag 진단 실패');
  });
});

describe('Patch-004 /program_market_raw static grep guards', () => {
  function stripComments(s: string): string {
    return s.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  }
  const code = stripComments(CMD_SOURCE);

  it('KIS 주문 함수 5종 import 0건', () => {
    expect(code).not.toMatch(/placeKisMarketOrder|placeKisSellOrder|placeKisStopLossOrder|placeKisTakeProfitOrder|cancelKisOrder/);
  });

  it('autoTradeEngine / orderExecutor / trancheExecutor import 0건', () => {
    expect(code).not.toMatch(/autoTradeEngine|orderExecutor|trancheExecutor/i);
  });

  it('외부 fetch / axios / node-fetch import 0건', () => {
    expect(code).not.toMatch(/from ['"]node-fetch['"]|from ['"]axios['"]|\bfetch\(/);
  });

  it('Patch-004 marker present', () => {
    expect(CMD_SOURCE).toMatch(/Patch-PROGRAM-MARKET-EMPTY-OUTPUT-ROUTER-004/);
  });
});
