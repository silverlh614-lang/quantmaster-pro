/**
 * @responsibility useTradeStore.setLossReason 회귀 테스트 (ADR-0025 PR-H)
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useTradeStore } from './useTradeStore';
import type { TradeRecord, LossReason } from '../types/portfolio';
import type { ConditionId } from '../types/quant';

function makeClosedTrade(overrides: Partial<TradeRecord> = {}): TradeRecord {
  return {
    id: 't-1',
    stockCode: 'A005930',
    stockName: '삼성전자',
    sector: 'IT',
    buyDate: '2026-04-01T00:00:00.000Z',
    buyPrice: 70000,
    quantity: 10,
    positionSize: 10,
    systemSignal: 'BUY',
    recommendation: '절반 포지션',
    gate1Score: 5, gate2Score: 5, gate3Score: 5, finalScore: 150,
    conditionScores: {} as Record<ConditionId, number>,
    followedSystem: true,
    status: 'CLOSED',
    returnPct: -7,
    ...overrides,
  };
}

beforeEach(() => {
  useTradeStore.setState({ tradeRecords: [] });
});

describe('useTradeStore.setLossReason', () => {
  it('수동 lossReason 부여 → lossReasonAuto=false + classifiedAt 기록', () => {
    useTradeStore.setState({
      tradeRecords: [makeClosedTrade()],
    });
    useTradeStore.getState().setLossReason('t-1', 'EARNINGS_MISS');
    const t = useTradeStore.getState().tradeRecords[0];
    expect(t.lossReason).toBe('EARNINGS_MISS');
    expect(t.lossReasonAuto).toBe(false);
    expect(t.lossReasonClassifiedAt).toBeDefined();
  });

  it('reason=null → 수동 분류 해제 (자동 분류 모드 복원)', () => {
    useTradeStore.setState({
      tradeRecords: [makeClosedTrade({
        lossReason: 'EARNINGS_MISS',
        lossReasonAuto: false,
        lossReasonClassifiedAt: '2026-04-26T01:00:00.000Z',
      })],
    });
    useTradeStore.getState().setLossReason('t-1', null);
    const t = useTradeStore.getState().tradeRecords[0];
    expect(t.lossReason).toBeUndefined();
    expect(t.lossReasonAuto).toBeUndefined();
    expect(t.lossReasonClassifiedAt).toBeUndefined();
  });

  it('자동 분류된 lossReason 을 사용자가 override 시 lossReasonAuto=false', () => {
    useTradeStore.setState({
      tradeRecords: [makeClosedTrade({
        lossReason: 'STOP_TOO_TIGHT',
        lossReasonAuto: true,
      })],
    });
    useTradeStore.getState().setLossReason('t-1', 'EARNINGS_MISS');
    const t = useTradeStore.getState().tradeRecords[0];
    expect(t.lossReason).toBe('EARNINGS_MISS');
    expect(t.lossReasonAuto).toBe(false);
  });

  it('알 수 없는 tradeId 는 no-op', () => {
    useTradeStore.setState({
      tradeRecords: [makeClosedTrade()],
    });
    useTradeStore.getState().setLossReason('not-found', 'EARNINGS_MISS');
    const t = useTradeStore.getState().tradeRecords[0];
    expect(t.lossReason).toBeUndefined();
  });

  it('LossReason 9 종 모두 입력 가능', () => {
    const reasons: LossReason[] = [
      'FALSE_BREAKOUT', 'MACRO_SHOCK', 'SECTOR_ROTATION_OUT', 'EARNINGS_MISS',
      'LIQUIDITY_TRAP', 'OVERHEATED_ENTRY', 'STOP_TOO_TIGHT', 'STOP_TOO_LOOSE',
      'UNCLASSIFIED',
    ];
    for (const r of reasons) {
      useTradeStore.setState({ tradeRecords: [makeClosedTrade()] });
      useTradeStore.getState().setLossReason('t-1', r);
      expect(useTradeStore.getState().tradeRecords[0].lossReason).toBe(r);
    }
  });
});
