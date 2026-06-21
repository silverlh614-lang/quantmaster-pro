/**
 * @responsibility Patch 2 gap (d) 회귀 — collectLearningPulseV2 metadataHealth read-only 진단 + 메시지 라인
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('learningPulseDiagnostics v2 — attribution metadataHealth', { timeout: 30_000 }, () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-v2-meta-'));
    process.env.PERSIST_DATA_DIR = tmpDir;
    vi.resetModules();
  });

  afterEach(() => {
    delete process.env.PERSIST_DATA_DIR;
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* noop */ }
  });

  const NOW = new Date('2026-04-30T06:00:00Z');

  function writeAttr(records: unknown[]) {
    fs.writeFileSync(path.join(tmpDir, 'attribution-records.json'), JSON.stringify(records));
  }

  const base = {
    schemaVersion: 2,
    stockCode: '005930',
    stockName: '삼성전자',
    closedAt: '2026-04-28T00:00:00Z',
    returnPct: 0.02,
    isWin: true,
    conditionScores: {},
    holdingDays: 2,
  };

  it('counterfactual lane 결손 집계 (read-only) — missing 수와 ratio 정확', async () => {
    writeAttr([
      { ...base, tradeId: 'counterfactual:a' },                         // 결손(stop+target)
      { ...base, tradeId: 'counterfactual:b', stopPrice: 1 },           // target 결손
      { ...base, tradeId: 'counterfactual:c', stopPrice: 1, targetPrice: 2 }, // 완비
    ]);
    const { collectLearningPulseV2 } = await import('./learningPulseDiagnostics.js');
    const snap = collectLearningPulseV2(NOW);
    expect(snap.attribution.metadataHealth.counterfactualSamples).toBe(3);
    expect(snap.attribution.metadataHealth.missingStop).toBe(1);
    expect(snap.attribution.metadataHealth.missingTarget).toBe(2);
    expect(snap.attribution.metadataHealth.missingEither).toBe(2);
    expect(snap.attribution.metadataHealth.missingRatio).toBeCloseTo(0.667, 2);
  });

  it('결손 과반 → counterfactual_metadata_repair_needed flag 발동', async () => {
    writeAttr([
      { ...base, tradeId: 'counterfactual:a' },
      { ...base, tradeId: 'counterfactual:b' },
      { ...base, tradeId: 'counterfactual:c', stopPrice: 1, targetPrice: 2 },
    ]);
    const { collectLearningPulseV2 } = await import('./learningPulseDiagnostics.js');
    const snap = collectLearningPulseV2(NOW);
    expect(snap.diagnosticFlags).toContain('counterfactual_metadata_repair_needed');
  });

  it('counterfactual 표본 0 → flag 미발동 + ratio 0', async () => {
    writeAttr([{ ...base, tradeId: 'live-x', evidenceSource: 'LIVE' }]);
    const { collectLearningPulseV2 } = await import('./learningPulseDiagnostics.js');
    const snap = collectLearningPulseV2(NOW);
    expect(snap.attribution.metadataHealth.counterfactualSamples).toBe(0);
    expect(snap.attribution.metadataHealth.missingRatio).toBe(0);
    expect(snap.diagnosticFlags).not.toContain('counterfactual_metadata_repair_needed');
  });

  it('formatLearningPulseV2Message 에 metadata health 라인 포함 (read-only)', async () => {
    writeAttr([{ ...base, tradeId: 'counterfactual:a' }]);
    const { collectLearningPulseV2, formatLearningPulseV2Message } = await import('./learningPulseDiagnostics.js');
    const msg = formatLearningPulseV2Message(collectLearningPulseV2(NOW));
    expect(msg).toContain('Attribution Metadata Health:');
    expect(msg).toContain('(read-only)');
  });
});
