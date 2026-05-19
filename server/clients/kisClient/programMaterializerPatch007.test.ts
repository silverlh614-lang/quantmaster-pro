// @responsibility PATCH-007 시장 프로그램매매 row selection/status regression tests.
import { describe, expect, it } from 'vitest';
import { buildMarketProgramTradeTodayParams, materializeKisMarketProgramTrade, parseKisNumber } from './programMaterializer.js';

const NOW = new Date('2026-05-15T01:00:00.000Z'); // 10:00 KST

describe('PATCH-007 market program materializer', () => {
  it('builds OFFICIAL params with all official keys and empty optional values', () => {
    const kospi = buildMarketProgramTradeTodayParams('K');
    const kosdaq = buildMarketProgramTradeTodayParams('Q');
    expect(Object.keys(kospi)).toEqual([
      'FID_COND_MRKT_DIV_CODE',
      'FID_MRKT_CLS_CODE',
      'FID_SCTN_CLS_CODE',
      'FID_INPUT_ISCD',
      'FID_COND_MRKT_DIV_CODE1',
      'FID_INPUT_HOUR_1',
    ]);
    expect(Object.keys(kosdaq)).toEqual(Object.keys(kospi));
    expect(kospi.FID_MRKT_CLS_CODE).toBe('K');
    expect(kosdaq.FID_MRKT_CLS_CODE).toBe('Q');
    expect(kospi.FID_INPUT_ISCD).toBe('');
    expect(kosdaq.FID_INPUT_ISCD).toBe('');
    expect(new URLSearchParams(kospi).toString()).toContain('FID_SCTN_CLS_CODE=');
    expect(new URLSearchParams(kospi).toString()).toContain('FID_INPUT_ISCD=');
    expect(new URLSearchParams(kospi).toString()).toContain('FID_COND_MRKT_DIV_CODE1=');
    expect(new URLSearchParams(kospi).toString()).toContain('FID_INPUT_HOUR_1=');
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
    expect(result.diagnostics?.selectedReason).toBe('LATEST_BY_BSOP_HOUR');
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

  it('selects latest by bsop_hour even when output[0] is newer non-zero ordering mismatch', () => {
    const result = materializeKisMarketProgramTrade({
      rt_cd: '0',
      msg_cd: 'MCA00000',
      output: [
        { bsop_hour: '090000', whol_smtn_ntby_tr_pbmn: '100' },
        { bsop_hour: '100300', whol_smtn_ntby_tr_pbmn: '-1303641' },
      ],
    }, '2026-05-15T01:10:00.000Z', new Date('2026-05-15T01:10:00.000Z'));
    expect(result.materialized?.programNetBuyAmount).toBe(-1303641);
    expect(result.outputPath).toBe('output[1]');
  });
});
