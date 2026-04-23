import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import fs from 'fs';
import { COUNTERFACTUAL_FILE } from '../persistence/paths.js';
import {
  recordCounterfactual, resolveCounterfactuals, getCounterfactualStats,
  loadCounterfactuals,
} from './counterfactualShadow.js';

const _backup = fs.existsSync(COUNTERFACTUAL_FILE) ? fs.readFileSync(COUNTERFACTUAL_FILE, 'utf-8') : null;

function reset() {
  if (fs.existsSync(COUNTERFACTUAL_FILE)) fs.unlinkSync(COUNTERFACTUAL_FILE);
}

afterAll(() => {
  if (_backup !== null) fs.writeFileSync(COUNTERFACTUAL_FILE, _backup);
  else if (fs.existsSync(COUNTERFACTUAL_FILE)) fs.unlinkSync(COUNTERFACTUAL_FILE);
});

describe('counterfactualShadow', () => {
  beforeEach(reset);

  it('record: 같은 날 중복 스킵', () => {
    const now = new Date('2026-04-22T00:00:00Z');
    const a = recordCounterfactual({
      stockCode: '005930', stockName: '삼성전자',
      priceAtSignal: 10_000, gateScore: 5, regime: 'R2_BULL',
      conditionKeys: ['momentum'], skipReason: 'GATE_UNDER', now,
    });
    const dup = recordCounterfactual({
      stockCode: '005930', stockName: '삼성전자',
      priceAtSignal: 10_500, gateScore: 5, regime: 'R2_BULL',
      conditionKeys: [], skipReason: 'GATE_UNDER', now,
    });
    expect(a).not.toBeNull();
    expect(dup).toBeNull();
    expect(loadCounterfactuals()).toHaveLength(1);
  });

  it('resolveCounterfactuals: 30일 경과 시 return30d 채움', async () => {
    const signal = new Date('2026-01-01T00:00:00Z');
    recordCounterfactual({
      stockCode: '005930', stockName: '삼성전자',
      priceAtSignal: 10_000, gateScore: 5, regime: 'R2_BULL',
      conditionKeys: [], skipReason: 'GATE_UNDER', now: signal,
    });
    const now = new Date('2026-02-05T00:00:00Z'); // 35일 경과
    const res = await resolveCounterfactuals(async () => 11_000, now);
    expect(res.resolved30d).toBe(1);
    const entries = loadCounterfactuals();
    expect(entries[0].return30d).toBeCloseTo(10, 1);
  });

  it('getCounterfactualStats: 빈 데이터 → null', () => {
    expect(getCounterfactualStats(30)).toBeNull();
  });
});
