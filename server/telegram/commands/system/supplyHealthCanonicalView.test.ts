/**
 * @responsibility 스캔 정본 수급 뷰가 scanSummary 영속 필드만 read-only 추출(재fetch 0)함을 검증.
 */
import fs from 'fs';
import { describe, expect, it } from 'vitest';

import {
  buildCanonicalSupplyView,
  formatCanonicalSupplyViewLines,
} from './supplyHealthCanonicalView.js';
import type { ScanSummary } from '../../../trading/signalScanner/scanDiagnostics/scanSummaryTypes.js';

const VIEW_SOURCE = fs.readFileSync('server/telegram/commands/system/supplyHealthCanonicalView.ts', 'utf-8');

function makeSummaryFixture(overrides: Record<string, unknown> = {}): ScanSummary {
  const base = {
    scanEvaluation: {
      scanId: 'scan-eval-20260525093000',
      asOf: '2026-05-25T09:30:00.000+09:00',
    },
    candidatePool: {
      candidateSnapshots: Array.from({ length: 12 }, (_, i) => ({ symbol: `S${i}` })),
    },
    investorFlowProviderRouter: {
      code: '005930',
      selectedProvider: 'KIS_API',
      signal: 'BEARISH',
      status: 'VERIFIED',
      coverage: { available: 7, total: 10, missing: 3, stale: 0, acceptedEmpty: 0, providerMismatch: 0, notWired: 0 },
    },
    investorFlowSampleAdr0489: {
      samples: [
        { symbol: '005930', provider: 'KIS_API', foreignNetBuy: 1200, institutionNetBuy: -340, status: 'SAMPLE_READY' },
        { symbol: '000660', provider: 'KIS_API', foreignNetBuy: -50, institutionNetBuy: 800, status: 'SAMPLE_READY' },
      ],
    },
  };
  return { ...base, ...overrides } as unknown as ScanSummary;
}

describe('buildCanonicalSupplyView — 정본 read-only 추출', () => {
  it('scanEvaluation.scanId 를 sourceSnapshotId 정본으로 추출한다', () => {
    const view = buildCanonicalSupplyView(makeSummaryFixture());
    expect(view.available).toBe(true);
    expect(view.sourceSnapshotId).toBe('scan-eval-20260525093000');
    expect(view.scanAsOf).toBe('2026-05-25T09:30:00.000+09:00');
    expect(view.unavailableReason).toBeNull();
  });

  it('router coverage 와 selectedProvider/signal 을 스캔 실사용분으로 추출한다', () => {
    const view = buildCanonicalSupplyView(makeSummaryFixture());
    expect(view.coverage).toEqual({ available: 7, total: 10 });
    expect(view.routerSelectedProvider).toBe('KIS_API');
    expect(view.routerSignal).toBe('BEARISH');
    expect(view.routerStatus).toBe('VERIFIED');
  });

  it('per-candidate 수급(symbol/foreignNetBuy/institutionalNetBuy/source/health)을 추출한다', () => {
    const view = buildCanonicalSupplyView(makeSummaryFixture());
    expect(view.candidateCount).toBe(12);
    expect(view.perCandidate).toHaveLength(2);
    expect(view.perCandidate[0]).toEqual({
      symbol: '005930',
      source: 'KIS_API',
      foreignNetBuy: 1200,
      institutionalNetBuy: -340,
      supplyProviderHealth: 'SAMPLE_READY',
    });
    expect(view.perCandidate[1].symbol).toBe('000660');
    expect(view.perCandidate[1].institutionalNetBuy).toBe(800);
  });

  it('재fetch 안 함 — summary 를 변형하지 않는 read-only 추출이다', () => {
    const summary = makeSummaryFixture();
    const before = JSON.stringify(summary);
    const view = buildCanonicalSupplyView(summary);
    formatCanonicalSupplyViewLines(view);
    // summary 를 변형하지 않는다(read-only 순수 추출).
    expect(JSON.stringify(summary)).toBe(before);
  });

  it('재fetch 안 함 — 뷰 빌더 소스에 provider/network/fs 호출이 없다 (단일 통로 보존)', () => {
    expect(VIEW_SOURCE).not.toMatch(/\bfetch\s*\(/);
    expect(VIEW_SOURCE).not.toMatch(/kisGet|kisPost|getKisToken|fetchInvestorFlow|fetchKis/);
    expect(VIEW_SOURCE).not.toMatch(/\bfs\.|readFileSync|axios|require\(/);
  });

  it('per-candidate 는 top-N(8) 으로 제한한다', () => {
    const samples = Array.from({ length: 20 }, (_, i) => ({
      symbol: `S${i}`,
      provider: 'KIS_API',
      foreignNetBuy: i,
      institutionNetBuy: -i,
      status: 'SAMPLE_READY',
    }));
    const view = buildCanonicalSupplyView(makeSummaryFixture({ investorFlowSampleAdr0489: { samples } }));
    expect(view.perCandidate).toHaveLength(8);
  });

  it('비유한 netBuy 값은 null 로 정규화한다', () => {
    const view = buildCanonicalSupplyView(
      makeSummaryFixture({
        investorFlowSampleAdr0489: {
          samples: [{ symbol: 'X', provider: 'CACHE', foreignNetBuy: null, institutionNetBuy: Number.NaN, status: 'STALE_SAMPLE' }],
        },
      }),
    );
    expect(view.perCandidate[0].foreignNetBuy).toBeNull();
    expect(view.perCandidate[0].institutionalNetBuy).toBeNull();
    expect(view.perCandidate[0].source).toBe('CACHE');
  });
});

describe('buildCanonicalSupplyView — summary 부재 SDS(silent drop 금지)', () => {
  it('summary 가 null 이면 정본 없음 사유를 명시한다', () => {
    const view = buildCanonicalSupplyView(null);
    expect(view.available).toBe(false);
    expect(view.sourceSnapshotId).toBeNull();
    expect(view.unavailableReason).toBe('정본 없음 (스캔 미실행 또는 미persist)');
  });

  it('scanEvaluation 부재(scanId null) 시 carry 끊김 사유를 명시한다', () => {
    const view = buildCanonicalSupplyView(makeSummaryFixture({ scanEvaluation: undefined }));
    expect(view.available).toBe(false);
    expect(view.unavailableReason).toContain('정본 carry 끊김');
  });

  it('scanId 있으나 router/sample 모두 부재 시 수급 미persist 사유를 명시한다', () => {
    const view = buildCanonicalSupplyView(
      makeSummaryFixture({ investorFlowProviderRouter: undefined, investorFlowSampleAdr0489: undefined }),
    );
    expect(view.available).toBe(true);
    expect(view.unavailableReason).toContain('정본 수급 미persist');
  });
});

describe('formatCanonicalSupplyViewLines — 섹션 렌더', () => {
  it('정본 헤더에 sourceSnapshotId 를 노출하고 read-only 임을 명시한다', () => {
    const lines = formatCanonicalSupplyViewLines(buildCanonicalSupplyView(makeSummaryFixture()));
    const text = lines.join('\n');
    expect(text).toContain('📋 스캔 정본 수급 (이 사이클 실제 사용 · sourceSnapshotId=scan-eval-20260525093000)');
    expect(text).toContain('supplyCoverage: 7/10');
    expect(text).toContain('selectedProvider: KIS_API');
    expect(text).toContain('signal: BEARISH (status=VERIFIED)');
    expect(text).toContain('source: scanSummary read-only (재fetch 없음');
    expect(text).toContain('005930 foreignNetBuy=+1,200 institutionalNetBuy=-340 source=KIS_API health=SAMPLE_READY');
    expect(text).toContain('executionImpact=NONE');
  });

  it('summary 부재 시 SDS 사유와 live-probe 구분 안내를 출력한다', () => {
    const lines = formatCanonicalSupplyViewLines(buildCanonicalSupplyView(null));
    const text = lines.join('\n');
    expect(text).toContain('sourceSnapshotId=NONE');
    expect(text).toContain('정본 없음 (스캔 미실행 또는 미persist)');
    expect(text).toContain('스캔 정본과 다를 수 있음');
  });
});
