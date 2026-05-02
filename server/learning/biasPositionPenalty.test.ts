import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { BiasHeatmapDailyEntry, BiasType } from './reflectionTypes.js';

const NOW = new Date('2026-05-02T06:00:00Z');

function day(offset: number): string {
  const d = new Date(NOW);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}

function writeHeatmap(tmpDir: string, entries: BiasHeatmapDailyEntry[]): void {
  fs.writeFileSync(path.join(tmpDir, 'bias-heatmap.json'), JSON.stringify(entries, null, 2));
}

function entry(offset: number, bias: BiasType, score: number): BiasHeatmapDailyEntry {
  return { date: day(offset), scores: [{ bias, score, evidence: 'test' }] };
}

describe('computeBiasPositionPenalty', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bias-penalty-'));
    process.env.PERSIST_DATA_DIR = tmpDir;
    vi.resetModules();
  });

  afterEach(() => {
    delete process.env.PERSIST_DATA_DIR;
    delete process.env.LEARNING_BIAS_POSITION_PENALTY_DISABLED;
    fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('returns multiplier 0.5 for 3 consecutive hot bias scores', async () => {
    writeHeatmap(tmpDir, [entry(-2, 'FOMO', 0.8), entry(-1, 'FOMO', 0.75), entry(0, 'FOMO', 0.7)]);
    const { computeBiasPositionPenalty } = await import('./biasPositionPenalty.js');
    expect(computeBiasPositionPenalty(NOW).multiplier).toBe(0.5);
  });

  it('returns multiplier 0.7 for 2 consecutive hot bias scores', async () => {
    writeHeatmap(tmpDir, [entry(-2, 'FOMO', 0.1), entry(-1, 'FOMO', 0.75), entry(0, 'FOMO', 0.7)]);
    const { computeBiasPositionPenalty } = await import('./biasPositionPenalty.js');
    expect(computeBiasPositionPenalty(NOW).multiplier).toBe(0.7);
  });

  it('returns multiplier 1.0 LOW when data is insufficient', async () => {
    writeHeatmap(tmpDir, [entry(-1, 'FOMO', 0.9), entry(0, 'FOMO', 0.9)]);
    const { computeBiasPositionPenalty } = await import('./biasPositionPenalty.js');
    const penalty = computeBiasPositionPenalty(NOW);
    expect(penalty.multiplier).toBe(1.0);
    expect(penalty.confidence).toBe('LOW');
  });

  it('uses the most conservative multiplier across multiple biases', async () => {
    writeHeatmap(tmpDir, [
      { date: day(-2), scores: [{ bias: 'FOMO', score: 0.8, evidence: '' }, { bias: 'RECENCY', score: 0.1, evidence: '' }] },
      { date: day(-1), scores: [{ bias: 'FOMO', score: 0.8, evidence: '' }, { bias: 'RECENCY', score: 0.8, evidence: '' }] },
      { date: day(0), scores: [{ bias: 'FOMO', score: 0.8, evidence: '' }, { bias: 'RECENCY', score: 0.8, evidence: '' }] },
    ]);
    const { computeBiasPositionPenalty } = await import('./biasPositionPenalty.js');
    expect(computeBiasPositionPenalty(NOW).multiplier).toBe(0.5);
  });

  it('returns neutral when disabled and never touches condition weights', async () => {
    process.env.LEARNING_BIAS_POSITION_PENALTY_DISABLED = 'true';
    const { computeBiasPositionPenalty } = await import('./biasPositionPenalty.js');
    const penalty = computeBiasPositionPenalty(NOW);
    const source = fs.readFileSync(path.join(process.cwd(), 'server/learning/biasPositionPenalty.ts'), 'utf-8');
    expect(penalty.multiplier).toBe(1.0);
    expect(source).not.toContain('loadConditionWeights');
    expect(source).not.toContain('saveConditionWeights');
  });

  it('uses loadBiasHeatmap and not reflectionModules/biasHeatmap calculation', async () => {
    const { computeBiasPositionPenalty } = await import('./biasPositionPenalty.js');
    computeBiasPositionPenalty(NOW);
    const source = fs.readFileSync(path.join(process.cwd(), 'server/learning/biasPositionPenalty.ts'), 'utf-8');
    expect(source).toContain('loadBiasHeatmap()');
    expect(source).not.toContain('reflectionModules/biasHeatmap');
    expect(source).not.toContain('computeBiasHeatmap');
  });
});
