// @responsibility Fresh Shadow Lifecycle Activation Patch v1 regression tests — fresh cohort, integrity, promotion, and command output
import { describe, expect, it } from 'vitest';
import { InMemoryShadowCaseLedger } from './shadowCaseLedger.js';
import { transitionShadowState } from './shadowStateMachine.js';
import { collectFreshOnlyPromotion, collectFreshShadowInletStatus, formatFreshShadowLifecycle, formatFreshShadowStatus, inspectFreshShadowIntegrity, collectFreshShadowLifecycle, collectFreshShadowStatus } from './freshShadowLifecycle.js';
import type { ShadowCase, ShadowLifecycleState } from './shadowTypes.js';

const now = new Date();
function base(id: string, patch: Partial<ShadowCase> = {}): ShadowCase {
  return {
    caseId: id,
    signalId: `sig-${id}`,
    symbol: '005930',
    symbolName: 'Samsung Electronics',
    detectedAt: now.toISOString(),
    marketSession: 'REGULAR',
    engineMode: 'SHADOW',
    dataHealth: 'OK',
    providerHealth: 'OK',
    confidenceLevel: 'CALCULATED',
    executionImpact: 'LIVE',
    entryPriceVirtual: 70000,
    targetPriceVirtual: 73500,
    stopPriceVirtual: 68600,
    sourceConfidence: 'CALCULATED',
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    state: 'CANDIDATE_DETECTED',
    ...patch,
  };
}
function step(ledger: InMemoryShadowCaseLedger, id: string, to: ShadowLifecycleState): void {
  const c = ledger.getCase(id)!;
  const r = transitionShadowState({ caseId: id, from: c.state, to, reason: 'test', engineMode: c.engineMode, executionImpact: c.executionImpact, dataHealth: c.dataHealth, confidenceLevel: c.confidenceLevel, now });
  ledger.recordTransition(r.transition);
}
function fullLifecycle(id = 'fresh-1'): InMemoryShadowCaseLedger {
  const ledger = new InMemoryShadowCaseLedger();
  ledger.upsertCase(base(id));
  for (const s of ['SHADOW_SIGNAL_APPROVED','SHADOW_ORDER_CREATED','SHADOW_PAPER_FILLED','SHADOW_POSITION_OPENED','SHADOW_MONITORING','SHADOW_EXIT_TRIGGERED','SHADOW_PAPER_SOLD','SHADOW_POSITION_CLOSED','OUTCOME_LABELED'] as ShadowLifecycleState[]) step(ledger, id, s);
  ledger.updateCase(id, { outcomeLabel: 'WIN', finalReturnPct: 0.05, returnR: 2 });
  return ledger;
}

describe('Fresh Shadow Lifecycle Activation Patch v1', () => {
  it('assigns FRESH_SHADOW only for normal fresh shadow lifecycle and excludes repair/recovered cases', () => {
    const ledger = fullLifecycle();
    expect(ledger.getCase('fresh-1')?.cohortType).toBe('FRESH_SHADOW');
    const repair = ledger.upsertCase(base('repair', { repairRunId: 'rr-1', state: 'SHADOW_ORDER_CREATED' }));
    const recovered = ledger.upsertCase(base('recovered', { metadataRecovered: true, state: 'SHADOW_ORDER_CREATED' }));
    expect(repair.cohortType).not.toBe('FRESH_SHADOW');
    expect(recovered.cohortType).not.toBe('FRESH_SHADOW');
  });

  it('quarantines missing target/stop/entry metadata and preserves executionImpact=NONE with zero broker orders', () => {
    const ledger = new InMemoryShadowCaseLedger();
    const c = ledger.upsertCase(base('missing-stop', { stopPriceVirtual: undefined, state: 'SHADOW_ORDER_CREATED', brokerOrdersCreated: 0 }));
    expect(c.cohortType).toBe('QUARANTINED');
    expect(c.state).toBe('QUARANTINED');
    expect(c.quarantinedReason).toBe('stopPrice missing');
    expect(c.executionImpact).toBe('NONE');
    expect(c.brokerOrdersCreated).toBe(0);
  });

  it('detects lifecycle breaks and CRITICAL wrong repair cohort / broker order violations', () => {
    const ledger = new InMemoryShadowCaseLedger();
    ledger.upsertCase(base('approved', { state: 'CANDIDATE_DETECTED' }));
    step(ledger, 'approved', 'SHADOW_SIGNAL_APPROVED');
    ledger.upsertCase(base('wrong-cohort', { state: 'SHADOW_ORDER_CREATED', cohortType: 'GHOST_REPAIR' }));
    ledger.upsertCase(base('broker', { state: 'SHADOW_ORDER_CREATED', brokerOrderCreated: true, brokerOrdersCreated: 1 }));
    const issues = inspectFreshShadowIntegrity(ledger, now);
    expect(issues.find((i) => i.item === 'approved_without_order')?.count).toBe(1);
    expect(issues.find((i) => i.item === 'fresh_case_marked_as_ghost_repair')?.severity).toBe('CRITICAL');
    expect(issues.find((i) => i.item === 'broker_order_created_in_shadow')?.severity).toBe('CRITICAL');
  });

  it('uses FRESH_SHADOW only for promotion and blocks below 100 fresh samples', () => {
    const ledger = fullLifecycle();
    ledger.upsertCase(base('ghost-diagnostic', { state: 'OUTCOME_LABELED', cohortType: 'GHOST_REPAIR', outcomeLabel: 'WIN', returnR: 10 }));
    const p = collectFreshOnlyPromotion(ledger, 1);
    expect(p.freshSampleSize).toBe(1);
    expect(p.freshClosedSampleSize).toBe(1);
    expect(p.freshExpectancyR).toBe(2);
    expect(p.promotionAllowed).toBe(false);
    expect(p.blocker).toBe('FRESH_SAMPLE_SIZE_LT_100');
  });


  it('renders fresh expectancy as N/A when there are zero fresh samples', () => {
    const ledger = new InMemoryShadowCaseLedger();
    const p = collectFreshOnlyPromotion(ledger, 1);
    expect(p.freshSampleSize).toBe(0);
    expect(p.freshExpectancyR).toBe('N/A');
    expect(p.freshExpectancyReason).toBe('NO_FRESH_SAMPLE');
    expect(p.blocker).toBe('NO_FRESH_SAMPLE');
  });

  it('explains fresh=0 inlet blockers without execution impact', () => {
    const ledger = new InMemoryShadowCaseLedger();
    const closed = collectFreshShadowInletStatus(ledger, new Date('2026-05-16T03:00:00.000Z'), { marketOpen: false });
    expect(closed.nextAction).toBe('MARKET_CLOSED');
    expect(closed.executionImpact).toBe('NONE');
    expect(closed.brokerOrdersCreated).toBe(0);

    const active = new InMemoryShadowCaseLedger();
    active.upsertCase(base('candidate-only'));
    const inlet = collectFreshShadowInletStatus(active, now, { marketOpen: true });
    expect(inlet.scanCandidatesToday).toBe(1);
    expect(inlet.nextAction).toBe('SHADOW_SIGNAL_NOT_APPROVED');
  });

  it('formats fresh shadow status and lifecycle command output', () => {
    const ledger = fullLifecycle();
    expect(formatFreshShadowStatus(collectFreshShadowStatus(ledger, now))).toContain('todayFreshCandidates');
    const lifecycle = formatFreshShadowLifecycle(collectFreshShadowLifecycle(ledger));
    expect(lifecycle).toContain('caseId=fresh-1');
    expect(lifecycle).toContain('executionImpact=NONE');
  });
});
