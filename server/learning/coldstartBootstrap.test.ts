/**
 * coldstartBootstrap.test.ts — Phase 3-⑨ Mini-Bar Proxy + Cross-Sectional kNN.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('coldstartBootstrap — Mini-Bar snapshot', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coldstart-'));
    process.env.PERSIST_DATA_DIR = tmpDir;
    vi.resetModules();
    vi.doMock('../clients/kisStreamClient.js', () => ({
      getRealtimePrice: vi.fn(() => 51_000),
      subscribeStock:   vi.fn(),
    }));
    vi.doMock('../clients/kisClient.js', () => ({
      fetchCurrentPrice: vi.fn().mockResolvedValue(51_000),
    }));
  });

  afterEach(() => {
    delete process.env.PERSIST_DATA_DIR;
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* noop */ }
    vi.doUnmock('../clients/kisStreamClient.js');
    vi.doUnmock('../clients/kisClient.js');
  });

  it('entry 31분 경과 → 30분 offset snapshot 1건 저장', async () => {
    const { maybeCaptureSnapshots, getWeakLabels, WEAK_LABEL_WEIGHT } = await import('./coldstartBootstrap.js');
    const trade: any = {
      id: 't1', stockCode: '005930',
      signalTime: new Date(Date.now() - 31 * 60_000).toISOString(),
      shadowEntryPrice: 50_000, quantity: 10,
      status: 'ACTIVE',
    };
    const snaps = await maybeCaptureSnapshots(trade);
    expect(snaps).toHaveLength(1);
    expect(snaps[0].offsetMin).toBe(30);
    expect(snaps[0].weight).toBe(WEAK_LABEL_WEIGHT);
    expect(snaps[0].returnPct).toBeCloseTo(2.0, 1); // (51000-50000)/50000
    const saved = getWeakLabels();
    expect(saved.length).toBe(1);
  });

  it('entry 61분 경과 → 30분·60분 offset 2건 (아직 없을 때)', async () => {
    const { maybeCaptureSnapshots } = await import('./coldstartBootstrap.js');
    const trade: any = {
      id: 't2', stockCode: '005930',
      signalTime: new Date(Date.now() - 61 * 60_000).toISOString(),
      shadowEntryPrice: 50_000, quantity: 10,
      status: 'ACTIVE',
    };
    const snaps = await maybeCaptureSnapshots(trade);
    expect(snaps).toHaveLength(2);
    expect(snaps.map(s => s.offsetMin)).toEqual([30, 60]);
  });

  it('이미 30분 snapshot 있으면 재생성 안 함 (멱등)', async () => {
    const { maybeCaptureSnapshots } = await import('./coldstartBootstrap.js');
    const trade: any = {
      id: 't3', stockCode: '005930',
      signalTime: new Date(Date.now() - 31 * 60_000).toISOString(),
      shadowEntryPrice: 50_000, quantity: 10,
      status: 'ACTIVE',
    };
    const first = await maybeCaptureSnapshots(trade);
    expect(first).toHaveLength(1);
    const second = await maybeCaptureSnapshots(trade);
    expect(second).toHaveLength(0);
  });

  it('HIT_STOP 상태면 snapshot 생성 안 함', async () => {
    const { maybeCaptureSnapshots } = await import('./coldstartBootstrap.js');
    const trade: any = {
      id: 't4', stockCode: '005930',
      signalTime: new Date(Date.now() - 120 * 60_000).toISOString(),
      shadowEntryPrice: 50_000, quantity: 10,
      status: 'HIT_STOP',
    };
    const snaps = await maybeCaptureSnapshots(trade);
    expect(snaps).toHaveLength(0);
  });

  it('entry 10분 경과 → offset 미도래 0건', async () => {
    const { maybeCaptureSnapshots } = await import('./coldstartBootstrap.js');
    const trade: any = {
      id: 't5', stockCode: '005930',
      signalTime: new Date(Date.now() - 10 * 60_000).toISOString(),
      shadowEntryPrice: 50_000, quantity: 10,
      status: 'ACTIVE',
    };
    const snaps = await maybeCaptureSnapshots(trade);
    expect(snaps).toHaveLength(0);
  });
});

describe('coldstartBootstrap — Cross-Sectional prior', () => {
  let tmpDir: string;
  const SHADOW_FIXTURE = [
    { id: 'p1', stockCode: '005930', stockName: 'A', signalTime: '2026-01-01', signalPrice: 100, shadowEntryPrice: 100, quantity: 1, stopLoss: 95, targetPrice: 110, status: 'HIT_TARGET', exitTime: '2026-01-15', returnPct: 8.5, entryRegime: 'R2_BULL', profileType: 'B' },
    { id: 'p2', stockCode: '000660', stockName: 'B', signalTime: '2026-01-02', signalPrice: 100, shadowEntryPrice: 100, quantity: 1, stopLoss: 95, targetPrice: 110, status: 'HIT_STOP',   exitTime: '2026-01-10', returnPct: -4.8, entryRegime: 'R2_BULL', profileType: 'B' },
    { id: 'p3', stockCode: '035720', stockName: 'C', signalTime: '2026-01-03', signalPrice: 100, shadowEntryPrice: 100, quantity: 1, stopLoss: 95, targetPrice: 110, status: 'HIT_TARGET', exitTime: '2026-01-20', returnPct: 6.2, entryRegime: 'R4_NEUTRAL', profileType: 'C' },
  ];

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coldstart-prior-'));
    process.env.PERSIST_DATA_DIR = tmpDir;
    fs.writeFileSync(path.join(tmpDir, 'shadow-trades.json'), JSON.stringify(SHADOW_FIXTURE));
    vi.resetModules();
    // sector map — 간단 스텁
    vi.doMock('../screener/sectorMap.js', () => ({
      getSectorByCode: (code: string) => {
        if (code === '005930' || code === '000660') return '반도체';
        if (code === '035720') return '소프트웨어';
        return '미분류';
      },
    }));
  });

  afterEach(() => {
    delete process.env.PERSIST_DATA_DIR;
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* noop */ }
    vi.doUnmock('../screener/sectorMap.js');
  });

  it('반도체·R2_BULL·B — 2건 매칭, 평균 수익률 약 1.85%', async () => {
    const { buildBootstrapPrior } = await import('./coldstartBootstrap.js');
    const prior = buildBootstrapPrior({
      sector: '반도체', regime: 'R2_BULL', profileType: 'B',
    });
    expect(prior.sampleSize).toBe(2);
    expect(prior.meanReturn).toBeCloseTo((8.5 + -4.8) / 2, 1);
    expect(prior.topMatches[0].similarity).toBeCloseTo(1.0, 2);
  });

  it('매칭 없음 → sampleSize 0', async () => {
    const { buildBootstrapPrior } = await import('./coldstartBootstrap.js');
    const prior = buildBootstrapPrior({
      sector: '금융', regime: 'R6_DEFENSE', profileType: 'A',
    });
    expect(prior.sampleSize).toBe(0);
    expect(prior.meanReturn).toBe(0);
    expect(prior.confidence).toBe(0);
  });

  it('신뢰도 — 표본 10건 이상이면 1.0', async () => {
    const { buildBootstrapPrior } = await import('./coldstartBootstrap.js');
    // 3건뿐이므로 confidence ≤ 0.3
    const prior = buildBootstrapPrior({ sector: '반도체', regime: 'R2_BULL' });
    expect(prior.confidence).toBeLessThanOrEqual(0.3);
  });
});
