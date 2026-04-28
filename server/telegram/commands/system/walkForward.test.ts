// @responsibility walkForward.cmd 회귀 테스트 — formatWalkForwardMessage 분기 + cmd execute.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { commandRegistry } from '../../commandRegistry.js';
import type {
  WalkForwardResults,
  WalkForwardWindow,
} from '../../../persistence/walkForwardResultsRepo.js';

vi.mock('../../../persistence/walkForwardResultsRepo.js', async () => {
  const actual = await vi.importActual<Record<string, unknown>>(
    '../../../persistence/walkForwardResultsRepo.js',
  );
  return {
    ...actual,
    loadWalkForwardResults: vi.fn(),
  };
});

vi.mock('../../../learning/walkForwardFramework.js', () => ({
  isFrameworkDisabled: vi.fn(),
}));

import * as repo from '../../../persistence/walkForwardResultsRepo.js';
import * as framework from '../../../learning/walkForwardFramework.js';
import { formatWalkForwardMessage } from './walkForward.cmd.js';
import './walkForward.cmd.js'; // commandRegistry.register 트리거

const mockedLoad = vi.mocked(repo.loadWalkForwardResults);
const mockedDisabled = vi.mocked(framework.isFrameworkDisabled);

function makeWindow(degradation: number, ts: string): WalkForwardWindow {
  return {
    windowId: `w_${ts}`,
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

describe('formatWalkForwardMessage', () => {
  it('FRAMEWORK_DISABLED=true → ⛔ 비활성 메시지', () => {
    const results: WalkForwardResults = {
      schemaVersion: 1,
      generatedAt: '2026-04-28T00:00:00Z',
      windows: [],
      summary: { totalWindows: 0, avgDegradation: 0, medianDegradation: 0, overfitFlagged: 0, decayTrend: 'INSUFFICIENT' },
    };
    const msg = formatWalkForwardMessage(results, 10, true);
    expect(msg).toContain('비활성');
    expect(msg).toContain('WALK_FORWARD_FRAMEWORK_DISABLED');
  });

  it('윈도우 0건 → 📭 placeholder', () => {
    const results: WalkForwardResults = {
      schemaVersion: 1,
      generatedAt: '2026-04-28T00:00:00Z',
      windows: [],
      summary: { totalWindows: 0, avgDegradation: 0, medianDegradation: 0, overfitFlagged: 0, decayTrend: 'INSUFFICIENT' },
    };
    const msg = formatWalkForwardMessage(results, 10, false);
    expect(msg).toContain('📭');
    expect(msg).toContain('framework 가 아직 실행되지 않음');
  });

  it('정상 N=5 표시 + decayTrend 이모지', () => {
    const windows = [
      makeWindow(2, '2026-04-01T00:00:00Z'),
      makeWindow(5, '2026-04-08T00:00:00Z'),
      makeWindow(8, '2026-04-15T00:00:00Z'),
    ];
    const results: WalkForwardResults = {
      schemaVersion: 1,
      generatedAt: '2026-04-28T00:00:00Z',
      windows,
      summary: { totalWindows: 3, avgDegradation: 5, medianDegradation: 5, overfitFlagged: 0, decayTrend: 'STABLE' },
    };
    const msg = formatWalkForwardMessage(results, 5, false);
    expect(msg).toContain('Walk-Forward Framework');
    expect(msg).toContain('🟡 STABLE');
    expect(msg).toContain('avgDegradation: 5.0%p');
    // 마지막 윈도우 degradation 8 → 🟡
    expect(msg).toContain('8.0%p 🟡');
  });

  it('overfit > 15%p 윈도우 → 🔴 마커', () => {
    const windows = [makeWindow(20, '2026-04-15T00:00:00Z')];
    const results: WalkForwardResults = {
      schemaVersion: 1,
      generatedAt: '2026-04-28T00:00:00Z',
      windows,
      summary: { totalWindows: 1, avgDegradation: 20, medianDegradation: 20, overfitFlagged: 1, decayTrend: 'INSUFFICIENT' },
    };
    const msg = formatWalkForwardMessage(results, 10, false);
    expect(msg).toContain('20.0%p 🔴');
    expect(msg).toContain('과최적화 의심');
  });

  it('Regime 분리 표시', () => {
    const w = makeWindow(5, '2026-04-15T00:00:00Z');
    w.regimeMetrics = {
      R2_BULL: {
        is: { sampleSize: 10, winRate: 0.7, avgReturn: 2, totalReturn: 12, sharpe: 0.5, maxDrawdown: 4 },
        oos: { sampleSize: 5, winRate: 0.6, avgReturn: 1.5, totalReturn: 6, sharpe: 0.4, maxDrawdown: 3 },
      },
      R5_CAUTION: {
        is: { sampleSize: 8, winRate: 0.4, avgReturn: 1, totalReturn: 4, sharpe: 0.2, maxDrawdown: 6 },
        oos: { sampleSize: 3, winRate: 0.33, avgReturn: 0.5, totalReturn: 1, sharpe: 0.1, maxDrawdown: 5 },
      },
    };
    const results: WalkForwardResults = {
      schemaVersion: 1,
      generatedAt: '2026-04-28T00:00:00Z',
      windows: [w],
      summary: { totalWindows: 1, avgDegradation: 5, medianDegradation: 5, overfitFlagged: 0, decayTrend: 'INSUFFICIENT' },
    };
    const msg = formatWalkForwardMessage(results, 10, false);
    expect(msg).toContain('Regime 분리');
    expect(msg).toContain('R2_BULL');
    expect(msg).toContain('R5_CAUTION');
    expect(msg).toContain('IS WR 70%');
    expect(msg).toContain('OOS WR 60%');
  });

  it('N 잘못된 입력 → 10 fallback', () => {
    const windows = Array.from({ length: 5 }, (_, i) =>
      makeWindow(2, `2026-04-${String(10 + i).padStart(2, '0')}T00:00:00Z`),
    );
    const results: WalkForwardResults = {
      schemaVersion: 1,
      generatedAt: '2026-04-28T00:00:00Z',
      windows,
      summary: { totalWindows: 5, avgDegradation: 2, medianDegradation: 2, overfitFlagged: 0, decayTrend: 'INSUFFICIENT' },
    };
    const msg = formatWalkForwardMessage(results, NaN, false);
    expect(msg).toContain('5/5개 윈도우'); // requestedN=NaN → 10 fallback, 그 후 windows.slice(-10) = 전체 5개
  });
});

describe('walkForward.cmd execute', () => {
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
      schemaVersion: 1,
      generatedAt: '2026-04-28T00:00:00Z',
      windows: [makeWindow(5, '2026-04-15T00:00:00Z')],
      summary: { totalWindows: 1, avgDegradation: 5, medianDegradation: 5, overfitFlagged: 0, decayTrend: 'INSUFFICIENT' },
    });
    const reply = async (m: string) => { replies.push(m); };
    const cmd = commandRegistry.resolve('/walk_forward');
    expect(cmd).toBeDefined();
    await cmd!.execute({ args: ['10'], reply });
    expect(replies).toHaveLength(1);
    expect(replies[0]).toContain('Walk-Forward Framework');
  });

  it('alias /wf 도 동일 instance', () => {
    const cmd1 = commandRegistry.resolve('/walk_forward');
    const cmd2 = commandRegistry.resolve('/wf');
    expect(cmd1).toBe(cmd2);
  });

  it('load throw 시 graceful', async () => {
    mockedDisabled.mockReturnValue(false);
    mockedLoad.mockImplementation(() => { throw new Error('disk fail'); });
    const reply = async (m: string) => { replies.push(m); };
    const cmd = commandRegistry.resolve('/walk_forward');
    await cmd!.execute({ args: [], reply });
    expect(replies).toHaveLength(1);
    expect(replies[0]).toContain('❌');
  });

  it('인자 N=5 propagate', async () => {
    mockedDisabled.mockReturnValue(false);
    const windows = Array.from({ length: 8 }, (_, i) =>
      makeWindow(3, `2026-04-${String(10 + i).padStart(2, '0')}T00:00:00Z`),
    );
    mockedLoad.mockReturnValue({
      schemaVersion: 1,
      generatedAt: '2026-04-28T00:00:00Z',
      windows,
      summary: { totalWindows: 8, avgDegradation: 3, medianDegradation: 3, overfitFlagged: 0, decayTrend: 'STABLE' },
    });
    const reply = async (m: string) => { replies.push(m); };
    const cmd = commandRegistry.resolve('/walk_forward');
    await cmd!.execute({ args: ['5'], reply });
    expect(replies[0]).toContain('5/8개 윈도우');
  });

  it('메타데이터 — name + aliases + category + riskLevel + description', () => {
    const cmd = commandRegistry.resolve('/walk_forward');
    expect(cmd!.name).toBe('/walk_forward');
    expect(cmd!.aliases).toContain('/wf');
    expect(cmd!.category).toBe('LRN');
    expect(cmd!.riskLevel).toBe(0);
    expect(cmd!.visibility).toBe('ADMIN');
    expect(cmd!.description).toContain('Walk-Forward');
    expect(cmd!.usage).toBeDefined();
  });
});
