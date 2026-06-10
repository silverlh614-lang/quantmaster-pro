/**
 * @responsibility /gate_audit (alias /ga) 회귀 가드 — ghost rejection 분포 + 일별 추이 + 진단
 */
import { describe, it, expect } from 'vitest';
import type { GhostPosition } from '../../../learning/reflectionTypes.js';
import type { ServerShadowTrade } from '../../../persistence/shadowTradeRepo.js';
import { commandRegistry } from '../../commandRegistry.js';
import {
  isoToKstDate,
  buildDateWindow,
  normalizeRejectionReason,
  aggregateGhostRejections,
  tallyDailyGhostStats,
  inferDiagnosticCase,
  formatGateAuditMessage,
} from './gateAudit.cmd.js';
import './gateAudit.cmd.js';

function ghost(over: Partial<GhostPosition> = {}): GhostPosition {
  return {
    stockCode: '005930',
    stockName: '삼성전자',
    signalPriceKrw: 70_000,
    signalDate: '2026-04-30',
    rejectionReason: 'WATCHLIST_NOT_ENTERED',
    trackUntil: '2026-05-30',
    ...over,
  };
}

function trade(over: Partial<ServerShadowTrade> = {}): ServerShadowTrade {
  return {
    id: 'T1',
    stockCode: '005930',
    stockName: '삼성전자',
    signalTime: '2026-04-30T00:00:00.000Z',
    signalPrice: 70_000,
    shadowEntryPrice: 70_000,
    quantity: 10,
    originalQuantity: 10,
    stopLoss: 65_000,
    targetPrice: 80_000,
    status: 'ACTIVE',
    fills: [],
    ...over,
  } as ServerShadowTrade;
}

describe('isoToKstDate', () => {
  it('UTC 자정 → KST 다음날 09:00', () => expect(isoToKstDate('2026-04-29T15:00:00.000Z')).toBe('2026-04-30'));
  it('잘못된 입력 → null', () => {
    expect(isoToKstDate(undefined)).toBeNull();
    expect(isoToKstDate(null)).toBeNull();
    expect(isoToKstDate('not-a-date')).toBeNull();
  });
});

describe('buildDateWindow', () => {
  it('7일 윈도우는 정확히 7개 날짜 + 오름차순', () => {
    const dates = buildDateWindow(new Date('2026-04-30T05:00:00.000Z'), 7);
    expect(dates).toHaveLength(7);
    expect(dates[0]).toBe('2026-04-24');
    expect(dates[6]).toBe('2026-04-30');
  });
  it('윈도우 마지막 = today KST', () => {
    const dates = buildDateWindow(new Date('2026-04-30T15:30:00.000Z'), 3);
    expect(dates[dates.length - 1]).toBe('2026-05-01');
  });
});

describe('normalizeRejectionReason', () => {
  it('prefix 분리 (entryRevalidation:GATE_MISS → ENTRYREVALIDATION)', () => {
    expect(normalizeRejectionReason('entryRevalidation:GATE_MISS,RRR<1')).toBe('ENTRYREVALIDATION');
  });
  it('빈 입력 → UNKNOWN', () => {
    expect(normalizeRejectionReason(undefined)).toBe('UNKNOWN');
    expect(normalizeRejectionReason('')).toBe('UNKNOWN');
    expect(normalizeRejectionReason('   ')).toBe('UNKNOWN');
  });
  it('prefix 없는 사유는 대문자 통일', () => {
    expect(normalizeRejectionReason('WATCHLIST_NOT_ENTERED')).toBe('WATCHLIST_NOT_ENTERED');
  });
});

describe('aggregateGhostRejections', () => {
  const window = ['2026-04-25', '2026-04-26', '2026-04-27', '2026-04-28', '2026-04-29', '2026-04-30'];
  it('윈도우 밖 ghost 제외 + 사유 분포 내림차순', () => {
    const ghosts: GhostPosition[] = [
      ghost({ signalDate: '2026-04-25', rejectionReason: 'WATCHLIST_NOT_ENTERED' }),
      ghost({ signalDate: '2026-04-26', rejectionReason: 'entryRevalidation:GATE_MISS' }),
      ghost({ signalDate: '2026-04-26', rejectionReason: 'entryRevalidation:RRR_LOW' }),
      ghost({ signalDate: '2026-04-27', rejectionReason: 'entryRevalidation:GATE_MISS' }),
      ghost({ signalDate: '2026-04-01', rejectionReason: 'OUT_OF_WINDOW' }), // 윈도우 밖
    ];
    const buckets = aggregateGhostRejections(ghosts, window, 5);
    expect(buckets[0].reason).toBe('ENTRYREVALIDATION');
    expect(buckets[0].count).toBe(3);
    expect(buckets.find((b) => b.reason === 'WATCHLIST_NOT_ENTERED')?.count).toBe(1);
    expect(buckets.find((b) => b.reason === 'OUT_OF_WINDOW')).toBeUndefined();
  });
  it('topN 절삭', () => {
    const ghosts = ['A', 'B', 'C', 'D', 'E'].flatMap((r, i) =>
      Array.from({ length: 5 - i }, () => ghost({ signalDate: '2026-04-30', rejectionReason: r })),
    );
    const buckets = aggregateGhostRejections(ghosts, window, 3);
    expect(buckets).toHaveLength(3);
    expect(buckets.map((b) => b.reason)).toEqual(['A', 'B', 'C']);
  });
  it('빈 입력 → []', () => expect(aggregateGhostRejections([], window, 7)).toEqual([]));
});

describe('tallyDailyGhostStats', () => {
  it('일별 ghost + buy + Top 1 사유 정확 카운트', () => {
    const window = ['2026-04-29', '2026-04-30'];
    const ghosts: GhostPosition[] = [
      ghost({ signalDate: '2026-04-29', rejectionReason: 'GATE_MISS' }),
      ghost({ signalDate: '2026-04-30', rejectionReason: 'GATE_MISS' }),
      ghost({ signalDate: '2026-04-30', rejectionReason: 'GATE_MISS' }),
      ghost({ signalDate: '2026-04-30', rejectionReason: 'RRR_LOW' }),
    ];
    const trades: ServerShadowTrade[] = [
      trade({ signalTime: '2026-04-30T01:00:00.000Z' }), // KST 04-30 10:00
    ];
    const rows = tallyDailyGhostStats(ghosts, trades, window);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ date: '2026-04-29', ghosts: 1, buys: 0, topReason: 'GATE_MISS', topReasonCount: 1 });
    expect(rows[1]).toEqual({ date: '2026-04-30', ghosts: 3, buys: 1, topReason: 'GATE_MISS', topReasonCount: 2 });
  });
  it('ghost 없는 날 — topReason=null', () => {
    const rows = tallyDailyGhostStats([], [], ['2026-04-30']);
    expect(rows[0]).toEqual({ date: '2026-04-30', ghosts: 0, buys: 0, topReason: null, topReasonCount: 0 });
  });
});

describe('inferDiagnosticCase 우선순위 SSOT', () => {
  const base = {
    emergencyStop: false, autoTradePaused: false, autoTradeEnabled: true,
    regime: 'R2_BULL', vix: 18, mhs: 70, bearDefenseMode: false,
    watchlistEmpty: false, topReasonRatio: 0, topReason: null as string | null,
  };
  it('EMERGENCY_STOP 최우선', () => {
    expect(inferDiagnosticCase({ ...base, emergencyStop: true, autoTradeEnabled: false, regime: 'R6_DEFENSE' }))
      .toBe('EMERGENCY_STOP');
  });
  it('AUTO_TRADE_DISABLED > AUTO_TRADE_PAUSED', () => {
    expect(inferDiagnosticCase({ ...base, autoTradeEnabled: false, autoTradePaused: true })).toBe('AUTO_TRADE_DISABLED');
  });
  it('AUTO_TRADE_PAUSED > R6_DEFENSE', () => {
    expect(inferDiagnosticCase({ ...base, autoTradePaused: true, regime: 'R6_DEFENSE' })).toBe('AUTO_TRADE_PAUSED');
  });
  it('R6_DEFENSE > BEAR_DEFENSE', () => {
    expect(inferDiagnosticCase({ ...base, regime: 'R6_DEFENSE', bearDefenseMode: true })).toBe('R6_DEFENSE');
  });
  it('BEAR_DEFENSE > VIX_HIGH', () => {
    expect(inferDiagnosticCase({ ...base, bearDefenseMode: true, vix: 35 })).toBe('BEAR_DEFENSE');
  });
  it('VIX_HIGH 임계 28 boundary', () => {
    expect(inferDiagnosticCase({ ...base, vix: 28 })).toBe('VIX_HIGH');
    expect(inferDiagnosticCase({ ...base, vix: 27.99 })).toBe('NO_OBVIOUS_BLOCK');
  });
  it('MHS_LOW 임계 30 boundary', () => {
    expect(inferDiagnosticCase({ ...base, mhs: 29 })).toBe('MHS_LOW');
    expect(inferDiagnosticCase({ ...base, mhs: 30 })).toBe('NO_OBVIOUS_BLOCK');
  });
  it('WATCHLIST_EMPTY > GHOST_HEAVY', () => {
    expect(inferDiagnosticCase({ ...base, watchlistEmpty: true, topReasonRatio: 0.8, topReason: 'X' }))
      .toBe('WATCHLIST_EMPTY');
  });
  it('GHOST_HEAVY 임계 40% boundary', () => {
    expect(inferDiagnosticCase({ ...base, topReasonRatio: 0.4, topReason: 'GATE_MISS' })).toBe('GHOST_HEAVY');
    expect(inferDiagnosticCase({ ...base, topReasonRatio: 0.39, topReason: 'GATE_MISS' })).toBe('NO_OBVIOUS_BLOCK');
  });
  it('topReason=null 시 GHOST_HEAVY 미진입', () => {
    expect(inferDiagnosticCase({ ...base, topReasonRatio: 1.0, topReason: null })).toBe('NO_OBVIOUS_BLOCK');
  });
  it('정상 운영 환경 → NO_OBVIOUS_BLOCK', () => {
    expect(inferDiagnosticCase(base)).toBe('NO_OBVIOUS_BLOCK');
  });
});

describe('formatGateAuditMessage', () => {
  const baseInput = {
    windowDays: 7,
    buckets: [{ reason: 'GATE_MISS', count: 4 }, { reason: 'RRR_LOW', count: 1 }],
    daily: [
      { date: '2026-04-29', ghosts: 2, buys: 0, topReason: 'GATE_MISS', topReasonCount: 2 },
      { date: '2026-04-30', ghosts: 3, buys: 1, topReason: 'GATE_MISS', topReasonCount: 2 },
    ],
    totalGhostsInWindow: 5,
    macro: null,
    scan: null,
    diagnostic: 'NO_OBVIOUS_BLOCK' as const,
    diagnosticHint: 'ℹ️ test hint',
    emergencyStop: false,
    autoTradePaused: false,
    autoTradeEnabled: true,
    autoTradeMode: 'SHADOW',
  };
  it('5 섹션 모두 노출 + 일별 추이 + 진단 case', () => {
    const msg = formatGateAuditMessage(baseInput);
    expect(msg).toContain('Gate Audit (last 7 days)');
    expect(msg).toContain('거시 게이트 상태');
    expect(msg).toContain('Ghost 거절 사유 (총 5건)');
    expect(msg).toContain('GATE_MISS: 4건 (80.0%)');
    expect(msg).toContain('일별 ghost / buy');
    expect(msg).toContain('2026-04-30: ghost=3  buy=1 (GATE_MISS 2건)');
    expect(msg).toContain('case=NO_OBVIOUS_BLOCK');
  });
  it('R6_DEFENSE 시 regime 라벨 + emergencyStop ⚠️ 마커', () => {
    const msg = formatGateAuditMessage({
      ...baseInput,
      macro: { mhs: 25, regime: 'R6_DEFENSE', updatedAt: '2026-04-30T00:00:00Z', vix: 30 } as never,
      emergencyStop: true,
      diagnostic: 'EMERGENCY_STOP',
      diagnosticHint: '🛑 비상정지 활성',
    });
    expect(msg).toContain('regime: R6_DEFENSE');
    expect(msg).toContain('MHS: 25 ⚠️ <30');
    expect(msg).toContain('VIX: 30 ⚠️ ≥28');
    expect(msg).toContain('emergencyStop: true 🛑');
    expect(msg).toContain('case=EMERGENCY_STOP');
  });
  it('ghost 없는 윈도우 — placeholder 표시', () => {
    const msg = formatGateAuditMessage({ ...baseInput, buckets: [], totalGhostsInWindow: 0 });
    expect(msg).toContain('해당 윈도우 ghost 등록 0건');
  });
  it('scan summary 발췌 — gatePassDistribution 라인', () => {
    const msg = formatGateAuditMessage({
      ...baseInput,
      scan: {
        time: '14:30 KST', candidates: 130, trackB: 80, swing: 60, catalyst: 20,
        momentum: 30, quoteFails: 5, gateMisses: 95, rrrMisses: 4, entries: 0,
        gatePassDistribution: { gate1Pass: 30, gate2Pass: 12, gate3Pass: 3, lastTriggerPass: 0 },
      } as never,
    });
    expect(msg).toContain('직전 스캔 (`/scan_blockers` 발췌)');
    expect(msg).toContain('candidates=130');
    expect(msg).toContain('gate1Pass=30  gate2Pass=12  gate3Pass=3');
  });
});

describe('gateAudit 메타데이터 + commandRegistry 등록', () => {
  it('/gate_audit 등록 + alias /ga 동일 인스턴스', () => {
    const cmd = commandRegistry.resolve('/gate_audit');
    expect(cmd).toBeDefined();
    expect(commandRegistry.resolve('/ga')).toBe(cmd);
  });
  it('category SYS / riskLevel 0 / visibility ADMIN', () => {
    const cmd = commandRegistry.resolve('/gate_audit')!;
    expect(cmd.category).toBe('SYS');
    expect(cmd.riskLevel).toBe(0);
    expect(cmd.visibility).toBe('ADMIN');
  });
  it('description + usage 라벨 존재', () => {
    const cmd = commandRegistry.resolve('/gate_audit')!;
    expect(cmd.description.length).toBeGreaterThan(10);
    expect(cmd.usage).toBeTruthy();
  });
});
