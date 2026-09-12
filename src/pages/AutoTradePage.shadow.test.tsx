// @vitest-environment jsdom
// @responsibility Verify actual server mode selects the Shadow screen before legacy account hooks mount.
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { AutoTradePage } from './AutoTradePage';
import { useEngineStatusQuery } from '../hooks/autoTrade/queries';
import { useAutoTradingDashboard } from '../hooks/useAutoTradingDashboard';

vi.mock('../hooks/autoTrade/queries', () => ({ useEngineStatusQuery: vi.fn() }));
vi.mock('../hooks/autoTrade/useEngineStream', () => ({ useEngineStream: vi.fn() }));
vi.mock('../hooks/useAutoTradingDashboard', () => ({ useAutoTradingDashboard: vi.fn() }));
vi.mock('../hooks/autoTrade', () => ({ useAutoTradeEngine: () => ({}) }));
vi.mock('../hooks/autoTrade/useEngineHeartbeat', () => ({ useEngineHeartbeat: () => ({}) }));
vi.mock('../hooks/autoTrade/useKillSwitchStatus', () => ({ useKillSwitchStatus: () => ({}) }));
vi.mock('../hooks/autoTrade/useAlertsFeed', () => ({ useAlertsFeed: () => ({}) }));
vi.mock('../hooks/autoTrade/useEngineArming', () => ({ useEngineArming: () => ({ state: 'IDLE' }) }));
vi.mock('../components/autoTrading/PaperExperimentPanel', () => ({ PaperExperimentPanel: () => <div>새 Shadow 실험 화면</div> }));

function modeResult(mode?: string, isError = false) {
  vi.mocked(useEngineStatusQuery).mockReturnValue({ data: mode === undefined ? undefined : { mode }, isError, refetch: vi.fn() } as unknown as ReturnType<typeof useEngineStatusQuery>);
}

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe('AutoTradePage mode selection', () => {
  it('mounts independent Shadow results without loading legacy KIS account hooks', () => {
    modeResult('SHADOW');
    render(<AutoTradePage />);
    expect(screen.getByText('새 Shadow 실험 화면')).toBeTruthy();
    expect(useAutoTradingDashboard).not.toHaveBeenCalled();
  });

  it('waits for actual mode and does not assume Shadow while loading', () => {
    modeResult();
    render(<AutoTradePage />);
    expect(screen.getByText('서버의 매매 모드를 확인하는 중입니다...')).toBeTruthy();
    expect(screen.queryByText('새 Shadow 실험 화면')).toBeNull();
    expect(useAutoTradingDashboard).not.toHaveBeenCalled();
  });

  it('surfaces mode lookup failure without presenting a successful Shadow screen', () => {
    modeResult(undefined, true);
    render(<AutoTradePage />);
    expect(screen.getByText('매매 모드를 확인할 수 없습니다')).toBeTruthy();
    expect(screen.queryByText('새 Shadow 실험 화면')).toBeNull();
  });

  it.each(['LIVE', 'PAPER'])('retains the legacy dashboard for %s', (mode) => {
    modeResult(mode);
    vi.mocked(useAutoTradingDashboard).mockReturnValue({ data: null, loading: true, error: null } as ReturnType<typeof useAutoTradingDashboard>);
    render(<AutoTradePage />);
    expect(useAutoTradingDashboard).toHaveBeenCalled();
    expect(screen.getByText('정밀 장비를 초기화하는 중입니다...')).toBeTruthy();
    expect(screen.queryByText('새 Shadow 실험 화면')).toBeNull();
  });
});
