/**
 * @responsibility Patch-SHADOW-GATE-AUDIT-001 — Shadow Gate audit diagnostic-only tests.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Gate1MinimumSignalForensicAuditAdr0505 } from '../trading/signalScanner/gate1MinimumSignalForensicAuditAdr0505.js';

const mocks = vi.hoisted(() => ({
  loadGate1ForensicTrace: vi.fn(),
}));

vi.mock('../persistence/gate1MinimumSignalForensicTraceRepo.js', () => ({
  loadGate1ForensicTrace: mocks.loadGate1ForensicTrace,
}));

import {
  __resetShadowGateAuditStoreForTests,
  formatShadowGateAuditSection,
  listShadowGateAuditRecords,
  markShadowGateAuditApprovalState,
  recordShadowApprovalCardAudit,
} from './shadowGateAuditStore.js';

function liveAudit(overrides: Partial<Gate1MinimumSignalForensicAuditAdr0505> = {}): Gate1MinimumSignalForensicAuditAdr0505 {
  return {
    symbol: '394280',
    name: '오픈엣지테크놀로지',
    scoreSystem: 'MINIMUM_SIGNAL_SCORE_100_SCALE',
    requiredScore: 70,
    actualScore: 3,
    scoreGap: 67,
    passed: false,
    positiveComponents: {},
    penaltyComponents: { UNKNOWN_DATA_PENALTY: {} as never },
    missingPositiveSources: [
      'WATCHLIST_UPSTREAM_SCORE_MISSING',
      'RELATIVE_STRENGTH_MISSING',
      'BREAKOUT_STRUCTURE_MISSING',
    ],
    dominantFailureReason: 'POSITIVE_SCORE_STARVATION',
    supplyScopeAudit: {} as never,
    sectorEnergyAudit: {} as never,
    wouldPassIf: {} as never,
    executionImpact: 'NONE',
    liveExecutionAllowed: false,
    policyPromotionMode: 'SHADOW_ONLY',
    ...overrides,
  };
}

beforeEach(() => {
  __resetShadowGateAuditStoreForTests();
  mocks.loadGate1ForensicTrace.mockReset();
});

describe('Patch-SHADOW-GATE-AUDIT-001 ShadowGateAudit', () => {
  it('Shadow approval card emitted 시 ShadowGateAuditRecord가 생성된다', () => {
    mocks.loadGate1ForensicTrace.mockReturnValue([]);

    const record = recordShadowApprovalCardAudit({
      symbol: '394280',
      name: '오픈엣지테크놀로지',
      tradeDate: '2026-05-13',
      marketSession: 'REGULAR',
      rawGateScore: 8.4,
      mtas: 9,
      compressionScore: 0.23,
      rrr: 2.6,
      approvalCardEmitted: true,
      approvalState: 'PENDING',
      shadowRecorded: false,
      triggerSource: 'SHADOW_APPROVAL_CARD',
      dedupeKey: 'SHADOW_APPROVAL:2026-05-13:REGULAR:394280:SHADOW:BUY_APPROVAL',
    });

    expect(record.shadow).toMatchObject({
      scoreSystem: 'SHADOW_GATE_RAW',
      rawGateScore: 8.4,
      mtas: 9,
      compressionScore: 0.23,
      rrr: 2.6,
      approvalCardEmitted: true,
      liveOrderPlaced: false,
    });
    expect(record.liveExecutionAllowed).toBe(false);
    expect(record.executionImpact).toBe('NONE');
  });

  it('manual approval 시 APPROVED, shadowRecorded=true, liveOrderPlaced=false가 기록된다', () => {
    mocks.loadGate1ForensicTrace.mockReturnValue([]);
    const dedupeKey = 'SHADOW_APPROVAL:2026-05-13:REGULAR:394280:SHADOW:BUY_APPROVAL';
    recordShadowApprovalCardAudit({
      symbol: '394280', tradeDate: '2026-05-13', marketSession: 'REGULAR',
      rawGateScore: 8.4, approvalCardEmitted: true, approvalState: 'PENDING', dedupeKey,
    });

    const updated = markShadowGateAuditApprovalState({
      dedupeKey,
      approvalState: 'APPROVED',
      shadowRecorded: true,
      triggerSource: 'DECISION_BROKER_MANUAL_APPROVAL',
    });

    expect(updated?.shadow.approvalState).toBe('APPROVED');
    expect(updated?.shadow.shadowRecorded).toBe(true);
    expect(updated?.shadow.liveOrderPlaced).toBe(false);
    expect(updated?.shadow.triggerSource).toBe('DECISION_BROKER_MANUAL_APPROVAL');
  });

  it('live forensic gate1Pass=false + shadow approval이면 divergence=true이며 missing RS/breakout/watchlist는 feature missing reason이다', () => {
    mocks.loadGate1ForensicTrace.mockReturnValue([{ scanId: 's1', capturedAtIso: '2026-05-13T01:00:00.000Z', audit: liveAudit() }]);

    const record = recordShadowApprovalCardAudit({
      symbol: '394280', name: '오픈엣지테크놀로지', tradeDate: '2026-05-13', marketSession: 'REGULAR',
      rawGateScore: 8.4, mtas: 9, rrr: 2.6, approvalCardEmitted: true, approvalState: 'APPROVED',
      shadowRecorded: true, dedupeKey: 'SHADOW_APPROVAL:2026-05-13:REGULAR:394280:SHADOW:BUY_APPROVAL',
    });

    expect(record.liveMinimum).toMatchObject({ requiredScore: 70, actualScore: 3, gate1Pass: false, minSignalPass: false });
    expect(record.divergence.shadowAllowedButLiveFailed).toBe(true);
    expect(record.divergence.reason).toBe('LIVE_MIN_SIGNAL_FEATURE_MISSING');
  });

  it('rawGateScore만으로 Shadow 승인된 경우 SHADOW_GATE_USES_RAW_SCORE reason이 가능하다', () => {
    mocks.loadGate1ForensicTrace.mockReturnValue([{ scanId: 's1', capturedAtIso: '2026-05-13T01:00:00.000Z', audit: liveAudit({ missingPositiveSources: [] }) }]);

    const record = recordShadowApprovalCardAudit({
      symbol: '394280', tradeDate: '2026-05-13', marketSession: 'REGULAR',
      rawGateScore: 8.4, gateBandNormal: 6.4, gateBandStrong: 8.4,
      approvalCardEmitted: true, approvalState: 'APPROVED', shadowRecorded: true,
      dedupeKey: 'SHADOW_APPROVAL:2026-05-13:REGULAR:394280:SHADOW:BUY_APPROVAL',
    });

    expect(record.divergence.reason).toBe('SHADOW_GATE_USES_RAW_SCORE');
  });

  it('deduped approval은 approvalCardEmitted=false 또는 state=DEDUPED로 기록된다', () => {
    mocks.loadGate1ForensicTrace.mockReturnValue([]);
    const record = recordShadowApprovalCardAudit({
      symbol: '394280', tradeDate: '2026-05-13', marketSession: 'REGULAR',
      approvalCardEmitted: false, approvalState: 'DEDUPED', shadowRecorded: false,
      dedupeKey: 'SHADOW_APPROVAL:2026-05-13:REGULAR:394280:SHADOW:BUY_APPROVAL',
    });

    expect(record.shadow.approvalCardEmitted).toBe(false);
    expect(record.shadow.approvalState).toBe('DEDUPED');
  });

  it('/scan_blockers runtime Shadow Gate Audit compact section이 표시된다', () => {
    mocks.loadGate1ForensicTrace.mockReturnValue([{ scanId: 's1', capturedAtIso: '2026-05-13T01:00:00.000Z', audit: liveAudit() }]);
    recordShadowApprovalCardAudit({
      symbol: '394280', name: '오픈엣지테크놀로지', tradeDate: '2026-05-13', marketSession: 'REGULAR',
      rawGateScore: 8.4, mtas: 9, rrr: 2.6, approvalCardEmitted: true, approvalState: 'APPROVED', shadowRecorded: true,
      dedupeKey: 'SHADOW_APPROVAL:2026-05-13:REGULAR:394280:SHADOW:BUY_APPROVAL',
    });

    const out = formatShadowGateAuditSection(listShadowGateAuditRecords({ hydrateLiveMinimum: true }));
    expect(out).toContain('🧪 Shadow Gate Audit [PATCH-RUNTIME]');
    expect(out).toContain('shadowSignals: 1');
    expect(out).toContain('liveOrderPlaced=false');
    expect(out).toContain('Shadow Gate 8.4 / MTAS 9 / RRR 2.60');
    expect(out).toContain('Live MinScore 3.0 / 70.0');
    expect(out).toContain('reason: LIVE_MIN_SIGNAL_FEATURE_MISSING');
    expect(out).toContain('executionImpact=NONE');
  });
});
