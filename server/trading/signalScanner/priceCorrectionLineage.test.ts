/**
 * @responsibility ADR-0414 PriceCorrectionLineage 회귀 테스트
 *
 * lineage 영속 + ruleVersion 정합 검증.
 */

import { describe, it, expect } from 'vitest';
import {
  buildPriceCorrectionLineage,
  PRICE_CORRECTION_RULE_VERSION,
} from './priceCorrectionLineage.js';

describe('ADR-0414 §4 PriceCorrectionLineage', () => {
  it('rule version SSOT — `priceCorrectionEngine@v1-readonly`', () => {
    expect(PRICE_CORRECTION_RULE_VERSION).toBe('priceCorrectionEngine@v1-readonly');
  });

  it('inputSnapshot — 출처 부재 시 옵셔널 미포함', () => {
    const now = new Date('2026-05-06T10:00:00.000Z');
    const lineage = buildPriceCorrectionLineage({}, ['decision'], 'NONE', 0, now);
    expect(lineage.inputSnapshot.yahoo).toBeUndefined();
    expect(lineage.inputSnapshot.kis).toBeUndefined();
    expect(lineage.inputSnapshot.krx).toBeUndefined();
    expect(lineage.inputSnapshot.recentDailyClose).toBeUndefined();
  });

  it('inputSnapshot — 출처 모두 가용 시 모두 포함 (defensive copy)', () => {
    const now = new Date('2026-05-06T10:00:00.000Z');
    const yahoo = { current: 100, previousClose: 99, currentDate: '2026-05-06' };
    const kis = { current: 101, previousClose: 100 };
    const krx = { previousClose: 99 };
    const recent = { close: 99, date: '2026-05-04' };

    const lineage = buildPriceCorrectionLineage(
      { yahoo, kis, krx, recentDailyClose: recent },
      ['trace'],
      'USE_KIS_CURRENT',
      0.8,
      now,
    );
    expect(lineage.inputSnapshot.yahoo).toEqual(yahoo);
    expect(lineage.inputSnapshot.kis).toEqual(kis);
    expect(lineage.inputSnapshot.krx).toEqual(krx);
    expect(lineage.inputSnapshot.recentDailyClose).toEqual(recent);

    // defensive copy — input mutate 시 lineage 영향 없음
    yahoo.current = 999;
    expect(lineage.inputSnapshot.yahoo!.current).toBe(100);
  });

  it('decisionTrace — defensive copy (input array mutate 시 lineage 영향 없음)', () => {
    const now = new Date('2026-05-06T10:00:00.000Z');
    const trace = ['step 1', 'step 2'];
    const lineage = buildPriceCorrectionLineage({}, trace, 'NONE', 0, now);
    trace.push('step 3 mutate');
    expect(lineage.decisionTrace).toEqual(['step 1', 'step 2']);
    expect(lineage.decisionTrace).not.toContain('step 3 mutate');
  });

  it('correctionType + confidence + computedAt + ruleVersion 정합', () => {
    const now = new Date('2026-05-06T10:00:00.000Z');
    const lineage = buildPriceCorrectionLineage(
      {},
      ['t'],
      'USE_KRX_PREV_CLOSE',
      0.72,
      now,
    );
    expect(lineage.correctionType).toBe('USE_KRX_PREV_CLOSE');
    expect(lineage.confidence).toBe(0.72);
    expect(lineage.computedAt).toBe('2026-05-06T10:00:00.000Z');
    expect(lineage.ruleVersion).toBe('priceCorrectionEngine@v1-readonly');
  });

  it('default now — Date 미주입 시 현재 시각 사용', () => {
    const before = Date.now();
    const lineage = buildPriceCorrectionLineage({}, ['t'], 'NONE', 0);
    const after = Date.now();
    const computedTs = Date.parse(lineage.computedAt);
    expect(computedTs).toBeGreaterThanOrEqual(before - 100);
    expect(computedTs).toBeLessThanOrEqual(after + 100);
  });
});
