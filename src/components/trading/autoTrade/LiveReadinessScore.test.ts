// @responsibility LiveReadinessScore 순수 score 회귀 (Phase G v1)
import { describe, it, expect } from 'vitest';
import { computeLiveReadiness } from './LiveReadinessScore';
import type { ServerShadowTrade } from '../../../api';

const HOUR = 60 * 60 * 1000;

function nowMinus(ms: number): string {
  return new Date(Date.now() - ms).toISOString();
}

const baseProps = {
  shadowTrades: [] as ServerShadowTrade[] | null,
  isRunning: true,
  mode: 'SHADOW',
  emergencyStop: false,
  killSwitchActive: false,
  kisStreamConnected: true as boolean | undefined,
};

function trade(o: Partial<ServerShadowTrade>): ServerShadowTrade {
  return {
    stockCode: '005930',
    stockName: '삼성전자',
    status: 'PENDING',
    signalTime: nowMinus(2 * HOUR),
    ...o,
  };
}

describe('computeLiveReadiness (Phase G v1)', () => {
  it('빈 입력 — KPI INSUFFICIENT, 나머지는 measured', () => {
    const { total, effectiveMax, components } = computeLiveReadiness({ ...baseProps });
    const kpi = components.find((c) => c.code === 'KPI')!;
    expect(kpi.score).toBeNull();
    expect(effectiveMax).toBe(80); // 30+20+15+15 (KPI 20 제외)
    expect(total).toBeGreaterThan(0);
  });

  it('엔진 정지 → Gate consistency 3점 (불변식 #1 위반)', () => {
    const { components } = computeLiveReadiness({ ...baseProps, isRunning: false });
    const gate = components.find((c) => c.code === 'GATE_CONSISTENCY')!;
    expect(gate.score).toBe(3);
  });

  it('LIVE + safe + kisStream → 만점 component 3개 이상', () => {
    const trades: ServerShadowTrade[] = Array.from({ length: 12 }, (_, i) => trade({
      stockCode: `00593${i % 10}`,
      status: 'HIT_TARGET',
      signalTime: nowMinus((i + 1) * HOUR),
      exitTime: nowMinus(i * HOUR),
      resolvedAt: nowMinus(i * HOUR),
      returnPct: 2.5,
      fills: [
        { type: 'BUY', qty: 10, timestamp: nowMinus((i + 1) * HOUR + 30 * 60 * 1000) },
        { type: 'SELL', qty: 10, timestamp: nowMinus(i * HOUR) },
      ],
    }));
    const { total, effectiveMax, components } = computeLiveReadiness({
      ...baseProps, shadowTrades: trades, mode: 'LIVE',
    });
    expect(effectiveMax).toBe(100);
    expect(total).toBeGreaterThanOrEqual(80);
    expect(components.every((c) => c.score != null)).toBe(true);
  });

  it('의심 중복 신호 1h 내 → DUP_PREVENTION 감점', () => {
    const trades: ServerShadowTrade[] = [
      trade({ signalTime: nowMinus(30 * 60 * 1000) }),
      trade({ signalTime: nowMinus(10 * 60 * 1000) }), // same code, 20m 차이
    ];
    const { components } = computeLiveReadiness({ ...baseProps, shadowTrades: trades });
    const dup = components.find((c) => c.code === 'DUP_PREVENTION')!;
    expect(dup.score).toBeLessThan(20);
  });

  it('kisStreamConnected undefined → PROVIDER_HEALTH INSUFFICIENT', () => {
    const { components } = computeLiveReadiness({ ...baseProps, kisStreamConnected: undefined });
    const prov = components.find((c) => c.code === 'PROVIDER_HEALTH')!;
    expect(prov.score).toBeNull();
  });

  it('kisStreamConnected=false → PROVIDER_HEALTH 5점', () => {
    const { components } = computeLiveReadiness({ ...baseProps, kisStreamConnected: false });
    const prov = components.find((c) => c.code === 'PROVIDER_HEALTH')!;
    expect(prov.score).toBe(5);
  });

  it('LIVE + Emergency Stop ON → Gate consistency 8점', () => {
    const { components } = computeLiveReadiness({ ...baseProps, mode: 'LIVE', emergencyStop: true });
    const gate = components.find((c) => c.code === 'GATE_CONSISTENCY')!;
    expect(gate.score).toBe(8);
  });
});
