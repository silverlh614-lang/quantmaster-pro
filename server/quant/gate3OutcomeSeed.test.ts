import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildGate3CandidateDetail, withGate3ShadowPolicy } from './gate3CandidateDetail.js';
import { buildGate3ShadowPolicy } from './gate3ShadowPolicy.js';
import { buildGate3OutcomeSeed, buildGate3OutcomeSeeds, gate3OutcomeDuplicateKey } from './gate3OutcomeSeed.js';
import {
  findBySymbolAndSnapshot,
  listPendingGate3Outcomes,
  upsertGate3OutcomeSeed,
} from '../persistence/gate3OutcomeRepo.js';

let tmpRoot: string | null = null;

function tempLedger(): string {
  tmpRoot = mkdtempSync(join(tmpdir(), 'gate3-outcome-'));
  return join(tmpRoot, 'ledger.json');
}

afterEach(() => {
  if (tmpRoot) rmSync(tmpRoot, { recursive: true, force: true });
  tmpRoot = null;
});

function diagnostic(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    timingReadiness: 'READY',
    falseBreakoutRisk: 'LOW',
    executionImpact: 'NONE',
    entryPriceGuard: { priceFreshness: 'VERIFIED' },
    rrrCheck: { rrr: 2.4, status: 'PASS', source: 'FALLBACK_PERCENT', entryPrice: 10_000, stopLoss: 9_300, targetPrice: 11_500 },
    lastTrigger: {
      status: 'FIRED',
      fired: true,
      liveBuyAllowed: true,
      shadowObservableAllowed: true,
      counterfactualAllowed: true,
      executionImpact: 'NONE',
      priceConfirmation: { status: 'BREAKOUT_CONFIRMED' },
      volumeConfirmationDetail: { status: 'CONFIRMED', volumeRatio20d: 1.8 },
    },
    ...overrides,
  };
}

function detail(overrides: Record<string, unknown> = {}) {
  const built = buildGate3CandidateDetail({
    symbol: '204320',
    name: 'HL만도',
    sourceSnapshotId: 'scan-eval:test',
    asOf: '2026-05-24T09:00:00.000Z',
    consolidatedDiagnostic: diagnostic(overrides),
  });
  const policy = buildGate3ShadowPolicy(built, { engineMode: 'SHADOW_ONLY' });
  return withGate3ShadowPolicy(built, policy);
}

function seedFor(overrides: Record<string, unknown> = {}) {
  const d = detail(overrides);
  return buildGate3OutcomeSeed(d, d.shadowPolicy!, {
    tradeDate: '2026-05-24',
    asOf: '2026-05-24T09:00:00.000Z',
    gate3SnapshotId: 'scan-eval:test:gate3',
  });
}

describe('Gate3 outcome seed', () => {
  it('creates READY seed with source snapshot invariant', () => {
    const seed = seedFor();

    expect(seed.readiness).toBe('READY');
    expect(seed.route).toBe('SHADOW_ENTRY_ALLOWED');
    expect(seed.entryReferencePrice).toBe(10_000);
    expect(seed.sourceSnapshotId).toBe('scan-eval:test');
    expect(seed.marketSignal).toBe(false);
    expect(seed.providerIssue).toBe(false);
    expect(seed.outcomeStatus).toBe('PENDING');
    expect(seed.learningLabel).toBe('GATE3_READY_FIRED');
  });

  it('creates WAIT, BLOCKED, and DATA_INCOMPLETE seeds too', () => {
    const wait = seedFor({
      timingReadiness: 'WAIT',
      lastTrigger: {
        status: 'THRESHOLD_NOT_MET',
        fired: false,
        liveBuyAllowed: false,
        shadowObservableAllowed: true,
        counterfactualAllowed: true,
        priceConfirmation: { status: 'NEAR_BREAKOUT' },
        volumeConfirmationDetail: { status: 'DRY_UP', volumeRatio20d: 0.42 },
      },
    });
    const blocked = seedFor({
      timingReadiness: 'BLOCKED',
      rrrCheck: { rrr: 1.2, status: 'FAIL', source: 'EXPLICIT', entryPrice: 10_000, stopLoss: 9_600, targetPrice: 10_500 },
      lastTrigger: {
        status: 'THRESHOLD_NOT_MET',
        fired: false,
        priceConfirmation: { status: 'NOT_CONFIRMED' },
        volumeConfirmationDetail: { status: 'WEAK', volumeRatio20d: 0.8 },
      },
    });
    const incomplete = seedFor({
      timingReadiness: 'DATA_INCOMPLETE',
      rrrCheck: { rrr: null, status: 'MISSING', source: 'MISSING', entryPrice: null },
      lastTrigger: {
        status: 'DATA_UNAVAILABLE',
        fired: false,
        priceConfirmation: { status: 'DATA_UNAVAILABLE' },
        volumeConfirmationDetail: { status: 'DATA_UNAVAILABLE' },
      },
    });

    expect(wait.route).toBe('NEAR_ENTRY_TRACKING');
    expect(blocked.route).toBe('COUNTERFACTUAL_ONLY');
    expect(incomplete.route).toBe('DIAGNOSTIC_ONLY');
    expect(incomplete.outcomeStatus).toBe('DATA_INSUFFICIENT');
  });

  it('builds one seed for every candidate detail', () => {
    const ready = detail();
    const wait = detail({
      timingReadiness: 'WAIT',
      lastTrigger: {
        status: 'THRESHOLD_NOT_MET',
        fired: false,
        priceConfirmation: { status: 'NEAR_BREAKOUT' },
        volumeConfirmationDetail: { status: 'DRY_UP', volumeRatio20d: 0.42 },
      },
    });
    const seeds = buildGate3OutcomeSeeds([ready, wait], [ready.shadowPolicy!, wait.shadowPolicy!], { tradeDate: '2026-05-24' });

    expect(seeds).toHaveLength(2);
    expect(seeds.every(seed => seed.sourceSnapshotId === 'scan-eval:test')).toBe(true);
    expect(seeds.every(seed => seed.marketSignal === false)).toBe(true);
  });

  it('suppresses duplicate seeds by symbol/tradeDate/source/readiness/issue', () => {
    const filePath = tempLedger();
    const seed = seedFor();
    const first = upsertGate3OutcomeSeed(seed, filePath);
    const second = upsertGate3OutcomeSeed({ ...seed, id: `${seed.id}:duplicate` }, filePath);

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.duplicateSuppressed).toBe(true);
    expect(listPendingGate3Outcomes(filePath)).toHaveLength(1);
    expect(findBySymbolAndSnapshot('204320', 'scan-eval:test', filePath)).toHaveLength(1);
    expect(gate3OutcomeDuplicateKey(seed)).toBe(gate3OutcomeDuplicateKey(second.seed));
  });
});
