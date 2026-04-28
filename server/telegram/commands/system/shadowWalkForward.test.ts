// @responsibility shadowWalkForward.cmd 회귀 테스트 — formatShadowWalkForwardMessage + execute.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { commandRegistry } from '../../commandRegistry.js';
import type {
  WalkForwardResults,
  WalkForwardWindow,
} from '../../../persistence/walkForwardResultsRepo.js';

vi.mock('../../../persistence/shadowWalkForwardResultsRepo.js', async () => {
  const actual = await vi.importActual<Record<string, unknown>>(
    '../../../persistence/shadowWalkForwardResultsRepo.js',
  );
  return {
    ...actual,
    loadShadowWalkForwardResults: vi.fn(),
  };
});

vi.mock('../../../learning/shadowWalkForwardFramework.js', () => ({
  isShadowFrameworkDisabled: vi.fn(),
}));

import * as repo from '../../../persistence/shadowWalkForwardResultsRepo.js';
import * as framework from '../../../learning/shadowWalkForwardFramework.js';
import { formatShadowWalkForwardMessage } from './shadowWalkForward.cmd.js';
import './shadowWalkForward.cmd.js';

const mockedLoad = vi.mocked(repo.loadShadowWalkForwardResults);
const mockedDisabled = vi.mocked(framework.isShadowFrameworkDisabled);

function makeWindow(degradation: number, ts: string): WalkForwardWindow {
  return {
    windowId: `shadow_${ts}`,
    inSampleStart: '2026-01-01',
    inSampleEnd: '2026-03-01',
    outSampleStart: '2026-03-01',
    outSampleEnd: '2026-04-01',
    isMetrics: { sampleSize: 20, winRate: 0.6, avgReturn: 1.5, totalReturn: 12, sharpe: 0.4, maxDrawdown: 5 },
    oosMetrics: { sampleSize: 10, winRate: 0.5, avgReturn: 1.0, totalReturn: 6, sharpe: 0.3, maxDrawdown: 4 },
    degradation,
    computedAt: ts,
  };
}

describe('formatShadowWalkForwardMessage', () => {
  it('disabled=true → ⛔', () => {
    const results: WalkForwardResults = {
      schemaVersion: 1, generatedAt: '2026-04-28T00:00:00Z', windows: [],
      summary: { totalWindows: 0, avgDegradation: 0, medianDegradation: 0, overfitFlagged: 0, decayTrend: 'INSUFFICIENT' },
    };
    const msg = formatShadowWalkForwardMessage(results, 10, true);
    expect(msg).toContain('비활성');
    expect(msg).toContain('SHADOW_WALK_FORWARD_DISABLED');
  });

  it('윈도우 0건 → 📭 placeholder', () => {
    const results: WalkForwardResults = {
      schemaVersion: 1, generatedAt: '2026-04-28T00:00:00Z', windows: [],
      summary: { totalWindows: 0, avgDegradation: 0, medianDegradation: 0, overfitFlagged: 0, decayTrend: 'INSUFFICIENT' },
    };
    const msg = formatShadowWalkForwardMessage(results, 10, false);
    expect(msg).toContain('📭');
    expect(msg).toContain('Rejection/Twin');
  });

  it('정상 N=5 + decayTrend STABLE 🟡', () => {
    const windows = [
      makeWindow(2, '2026-04-01T00:00:00Z'),
      makeWindow(5, '2026-04-08T00:00:00Z'),
      makeWindow(8, '2026-04-15T00:00:00Z'),
    ];
    const results: WalkForwardResults = {
      schemaVersion: 1, generatedAt: '2026-04-28T00:00:00Z', windows,
      summary: { totalWindows: 3, avgDegradation: 5, medianDegradation: 5, overfitFlagged: 0, decayTrend: 'STABLE' },
    };
    const msg = formatShadowWalkForwardMessage(results, 5, false);
    expect(msg).toContain('Shadow Walk-Forward');
    expect(msg).toContain('Rejection + Twin');
    expect(msg).toContain('🟡 STABLE');
    expect(msg).toContain('avgDegradation: 5.0%p');
  });

  it('overfit > 15%p 윈도우 → 🔴 마커', () => {
    const windows = [makeWindow(20, '2026-04-15T00:00:00Z')];
    const results: WalkForwardResults = {
      schemaVersion: 1, generatedAt: '2026-04-28T00:00:00Z', windows,
      summary: { totalWindows: 1, avgDegradation: 20, medianDegradation: 20, overfitFlagged: 1, decayTrend: 'INSUFFICIENT' },
    };
    const msg = formatShadowWalkForwardMessage(results, 10, false);
    expect(msg).toContain('20.0%p 🔴');
    expect(msg).toContain('과최적화 의심');
  });

  it('LIVE walk-forward 와 prefix 분리 안내', () => {
    const windows = [makeWindow(2, '2026-04-01T00:00:00Z')];
    const results: WalkForwardResults = {
      schemaVersion: 1, generatedAt: '2026-04-28T00:00:00Z', windows,
      summary: { totalWindows: 1, avgDegradation: 2, medianDegradation: 2, overfitFlagged: 0, decayTrend: 'INSUFFICIENT' },
    };
    const msg = formatShadowWalkForwardMessage(results, 10, false);
    expect(msg).toContain("'shadow_'");
    expect(msg).toContain('/walk_forward');
  });
});

describe('shadowWalkForward.cmd execute', () => {
  let replies: string[];

  beforeEach(() => {
    replies = [];
    mockedLoad.mockReset();
    mockedDisabled.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('정상 응답 — load + disabled 호출 후 reply', async () => {
    mockedDisabled.mockReturnValue(false);
    mockedLoad.mockReturnValue({
      schemaVersion: 1, generatedAt: '2026-04-28T00:00:00Z',
      windows: [makeWindow(5, '2026-04-15T00:00:00Z')],
      summary: { totalWindows: 1, avgDegradation: 5, medianDegradation: 5, overfitFlagged: 0, decayTrend: 'INSUFFICIENT' },
    });
    const reply = async (m: string) => { replies.push(m); };
    const cmd = commandRegistry.resolve('/shadow_walk_forward');
    expect(cmd).toBeDefined();
    await cmd!.execute({ args: ['10'], reply });
    expect(replies).toHaveLength(1);
    expect(replies[0]).toContain('Shadow Walk-Forward');
  });

  it('alias /swf 도 동일 instance', () => {
    const cmd1 = commandRegistry.resolve('/shadow_walk_forward');
    const cmd2 = commandRegistry.resolve('/swf');
    expect(cmd1).toBe(cmd2);
  });

  it('load throw 시 graceful', async () => {
    mockedDisabled.mockReturnValue(false);
    mockedLoad.mockImplementation(() => { throw new Error('disk fail'); });
    const reply = async (m: string) => { replies.push(m); };
    const cmd = commandRegistry.resolve('/shadow_walk_forward');
    await cmd!.execute({ args: [], reply });
    expect(replies).toHaveLength(1);
    expect(replies[0]).toContain('❌');
  });

  it('메타데이터 — name + aliases + category + riskLevel + description', () => {
    const cmd = commandRegistry.resolve('/shadow_walk_forward');
    expect(cmd!.name).toBe('/shadow_walk_forward');
    expect(cmd!.aliases).toContain('/swf');
    expect(cmd!.category).toBe('LRN');
    expect(cmd!.riskLevel).toBe(0);
    expect(cmd!.visibility).toBe('ADMIN');
    expect(cmd!.description).toContain('Shadow');
  });
});
