// @responsibility PATCH-007 시장 프로그램매매 row selection/status regression tests.
import { describe, expect, it } from 'vitest';
import { buildMarketProgramTradeTodayParams, materializeKisMarketProgramTrade, parseKisNumber } from './programMaterializer.js';

const NOW = new Date('2026-05-15T01:00:00.000Z'); // 10:00 KST

describe('PATCH-007 market program materializer', () => {
  it('builds OFFICIAL params as J/K and J/Q without legacy keys', () => {
    const kospi = buildMarketProgramTradeTodayParams('K');
    const kosdaq = buildMarketProgramTradeTodayParams('Q');
    expect(kospi).toEqual({ FID_COND_MRKT_DIV_CODE: 'J', FID_MRKT_CLS_CODE: 'K' });
    expect(kosdaq).toEqual({ FID_COND_MRKT_DIV_CODE: 'J', FID_MRKT_CLS_CODE: 'Q' });
    expect(kospi).not.toHaveProperty('FID_INPUT_ISCD');
    expect(kospi).not.toHaveProperty('FID_SCTN_CLS_CODE');
    expect(kospi).not.toHaveProperty('FID_INPUT_HOUR_1');
    expect(kospi).not.toHaveProperty('FID_COND_MRKT_DIV_CODE1');
  });
  it('output[0] zero and output[1] non-zero selects latest non-zero row', () => {
    const result = materializeKisMarketProgramTrade({
      rt_cd: '0',
      msg_cd: 'MCA00000',
      output: [
        { bsop_hour: '090000', whol_smtn_ntby_tr_pbmn: '0' },
        { bsop_hour: '091000', whol_smtn_ntby_tr_pbmn: '120000000' },
      ],
    }, '2026-05-15T01:00:00.000Z', NOW);

    expect(result.status).toBe('OK_NONZERO');
    expect(result.outputPath).toBe('output[1]');
    expect(result.diagnostics?.selectedPath).toBe('output[1]');
    expect(result.diagnostics?.selectedReason).toBe('LATEST_NON_ZERO_ROW');
    expect(result.materialized?.programNetBuyAmount).toBe(120_000_000);
    expect(result.diagnostics?.providerIssue).toBe(false);
    expect(result.diagnostics?.executionImpact).toBe('NONE');
  });

  it('all-zero output rows are OK_RAW_ZERO and isolated from scoring/signals', () => {
    const output = Array.from({ length: 30 }, (_, i) => ({
      bsop_hour: String(90000 + i * 100).padStart(6, '0'),
      whol_smtn_ntby_tr_pbmn: '0',
      arbt_smtn_ntby_tr_pbmn: '0',
      nabt_smtn_ntby_tr_pbmn: '0',
    }));
    const result = materializeKisMarketProgramTrade({ rt_cd: '0', msg_cd: 'MCA00000', output }, '2026-05-15T01:00:00.000Z', NOW);

    expect(result.status).toBe('OK_RAW_ZERO');
    expect(result.diagnostics?.selectedReason).toBe('LATEST_ROW_ALL_ZERO');
    expect(result.diagnostics?.nonZeroRowCount).toBe(0);
    expect(result.diagnostics?.zeroReason).toBe('RAW_ZERO_ALL_ROWS');
    expect(result.diagnostics?.providerIssue).toBe(false);
    expect(result.diagnostics?.executionImpact).toBe('NONE');
    expect(result.diagnostics?.scoring).toBe('excluded');
    expect(result.diagnostics?.marketSignal).toBe(false);
  });

  it('empty output is OK_EMPTY_OUTPUT with no execution impact', () => {
    const result = materializeKisMarketProgramTrade({ rt_cd: '0', msg_cd: 'MCA00000', output: [] }, '2026-05-15T01:00:00.000Z', NOW);

    expect(result.status).toBe('OK_EMPTY_OUTPUT');
    expect(result.diagnostics?.rowCount).toBe(0);
    expect(result.diagnostics?.providerIssue).toBe(false);
    expect(result.diagnostics?.executionImpact).toBe('NONE');
    expect(result.diagnostics?.marketSignal).toBe(false);
    expect(result.diagnostics?.scoring).toBe('excluded');
  });

  it('rt_cd provider errors are isolated from engine execution impact', () => {
    const result = materializeKisMarketProgramTrade({ rt_cd: '1', msg_cd: 'ERROR', output: [] }, '2026-05-15T01:00:00.000Z', NOW);

    expect(result.status).toBe('PROVIDER_ERROR');
    expect(result.diagnostics?.providerIssue).toBe(true);
    expect(result.diagnostics?.executionImpact).toBe('NONE');
    expect(result.diagnostics?.marketSignal).toBe(false);
  });

  it('bsop_hour drives latest/updated instead of N/A', () => {
    const result = materializeKisMarketProgramTrade({ rt_cd: '0', msg_cd: 'MCA00000', output: [{ bsop_hour: '091500', whol_smtn_ntby_tr_pbmn: '1' }] }, '2026-05-15T01:00:00.000Z', NOW);

    expect(result.materialized?.latest).toBe('09:15');
    expect(result.materialized?.updated).toContain('2026-05-15 09:15:00 KST');
  });

  it('numeric comma strings are parsed without partial quality downgrade', () => {
    const result = materializeKisMarketProgramTrade({ rt_cd: '0', msg_cd: 'MCA00000', output: [{ bsop_hour: '091500', whol_smtn_ntby_tr_pbmn: '1,234,000,000' }] }, '2026-05-15T01:00:00.000Z', NOW);

    expect(parseKisNumber('1,234,000,000')).toBe(1_234_000_000);
    expect(result.materialized?.programNetBuyAmount).toBe(1_234_000_000);
    expect(result.diagnostics?.parseQuality).toBe('OK');
  });
});
