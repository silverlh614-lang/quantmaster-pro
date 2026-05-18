// @responsibility Normal supply preview value normalization and signal classification tests
import { describe, expect, it } from 'vitest';
import {
  classifySupplySignal,
  normalizeProgramFlowValue,
} from './normalSupplyPreview.js';

describe('normalizeProgramFlowValue', () => {
  it.each([
    [1234, true, 1234, 'PROGRAM_VALUE_PARSE_OK'],
    [0, true, 0, 'PROGRAM_VALUE_ZERO'],
    ['1234', true, 1234, 'PROGRAM_VALUE_NUMERIC_STRING'],
    ['1,234', true, 1234, 'PROGRAM_VALUE_COMMA_NUMERIC_STRING'],
    ['-1,234', true, -1234, 'PROGRAM_VALUE_COMMA_NUMERIC_STRING'],
    ['+1,234', true, 1234, 'PROGRAM_VALUE_COMMA_NUMERIC_STRING'],
    ['N/A', false, undefined, 'PROGRAM_VALUE_NA'],
    ['-', false, undefined, 'PROGRAM_VALUE_PLACEHOLDER'],
    ['', false, undefined, 'PROGRAM_VALUE_EMPTY'],
    [{ value: '1,234' }, true, 1234, 'PROGRAM_VALUE_OBJECT_WRAPPER'],
    [{ netAmount: '-1,234' }, true, -1234, 'PROGRAM_VALUE_OBJECT_WRAPPER'],
    ['매수우위', false, undefined, 'PROGRAM_VALUE_UNSUPPORTED_FORMAT'],
  ])('normalizes %o as diagnostic-only program value', (input, ok, value, reason) => {
    const normalized = normalizeProgramFlowValue(input);
    expect(normalized.ok).toBe(ok);
    expect(normalized.value).toBe(value);
    expect(normalized.reason).toBe(reason);
    expect(normalized.diagnosticOnly).toBe(true);
  });
});

describe('classifySupplySignal', () => {
  it('classifies the ACCUMULATING tier without weakening the BULLISH threshold', () => {
    expect(classifySupplySignal({
      supplyScore: 77,
      dataStatus: 'VERIFIED',
      providerIssue: false,
      marketSignal: true,
      foreignNetBuy: 100,
      institutionNetBuy: 50,
    })).toBe('ACCUMULATING');
    expect(classifySupplySignal({
      supplyScore: 81,
      dataStatus: 'VERIFIED',
      providerIssue: false,
      marketSignal: true,
      foreignNetBuy: 100,
      institutionNetBuy: 50,
    })).toBe('BULLISH');
    expect(classifySupplySignal({
      supplyScore: 65,
      dataStatus: 'VERIFIED',
      providerIssue: false,
      marketSignal: true,
      foreignNetBuy: 100,
      institutionNetBuy: 50,
    })).toBe('NEUTRAL');
    expect(classifySupplySignal({
      supplyScore: 28,
      dataStatus: 'VERIFIED',
      providerIssue: false,
      marketSignal: true,
      foreignNetBuy: -100,
      institutionNetBuy: -50,
    })).toBe('BEARISH');
    expect(classifySupplySignal({
      supplyScore: 77,
      dataStatus: 'STALE',
      providerIssue: false,
      marketSignal: true,
      foreignNetBuy: 100,
      institutionNetBuy: 50,
    })).toBe('UNUSABLE');
    expect(classifySupplySignal({
      supplyScore: 77,
      dataStatus: 'VERIFIED',
      providerIssue: true,
      marketSignal: true,
      foreignNetBuy: 100,
      institutionNetBuy: 50,
    })).toBe('UNUSABLE');
  });
});
