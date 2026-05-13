// @responsibility Learning Outcome Quality Patch v1 regression suite — read-only quality reports and safety guards
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { LearningGhostCase } from './learningTypes.js';

let tmp = '';
const NOW = new Date('2026-05-13T07:00:00.000Z');
function write(name: string, data: unknown) { fs.writeFileSync(path.join(tmp, name), JSON.stringify(data, null, 2)); }
function ghost(over: Partial<LearningGhostCase> = {}): LearningGhostCase {
  return { id: `g-${over.stockCode ?? '005930'}-${over.signalDate ?? '2026-05-12'}-${Math.random()}`, stockCode: '005930', stockName: '삼성전자', signalPriceKrw: 100, signalDate: '2026-05-12', entryAt: '2026-05-12T00:00:00.000Z', entryPrice: 100, stopPrice: 95, targetPrice: 110, maxHoldingMinutes: 60, rejectionReason: 'gate', trackUntil: '2026-06-12', closed: false, conditionScores: { 1: 8, 2: 6, 3: 2 }, executionImpact: 'NONE', ...over };
}
function closed(i: number): LearningGhostCase {
  const win = i < 90;
  const loss = i >= 90 && i < 180;
  const expired = i >= 180 && i < 210;
  const quarantined = i >= 210 && i < 225;
  const finalReturnPct = win ? 5 : loss ? -6 : expired ? 0 : undefined;
  const returnR = win ? 1 : loss ? -1.2 : expired ? 0 : undefined;
  return ghost({ id: `closed-${i}`, stockCode: `00${(5000 + (i % 20)).toString()}`, closed: true, closedAt: NOW.toISOString(), closeReason: win ? 'VIRTUAL_TAKE_PROFIT' : loss ? 'VIRTUAL_STOP_LOSS' : expired ? 'VIRTUAL_TIME_EXIT' : 'QUARANTINED_DATA_MISSING', outcomeLabel: win ? 'WIN' : loss ? 'LOSS' : expired ? 'EXPIRED' : 'QUARANTINED', finalReturnPct, returnR, sourceConfidence: quarantined ? 0.4 : 0.9, dataQuality: quarantined ? 'QUARANTINED' : 'OK', attributionProcessed: i < 225 && !quarantined, exitPriceVirtual: win ? 105 : loss ? 94 : expired ? 100 : undefined });
}
function openCase(i: number): LearningGhostCase {
  if (i < 16) return ghost({ id: `q-${i}`, closed: false, outcomeLabel: 'QUARANTINED', dataQuality: 'QUARANTINED', quarantinedReason: i % 2 ? 'price_or_ohlc_missing' : 'entry_price_missing', entryPrice: i % 2 ? 100 : undefined, signalPriceKrw: i % 2 ? 100 : undefined as any });
  if (i < 46) return ghost({ id: `missing-price-${i}`, closed: false, currentReturnPct: undefined, lastUpdatedAt: '2026-05-10T00:00:00.000Z' });
  return ghost({ id: `mature-${i}`, closed: false, currentReturnPct: 1, maxHoldingMinutes: 999999, lastUpdatedAt: NOW.toISOString() });
}
function attr(i: number) { return { schemaVersion: 2, attributionType: 'FULL_CLOSE', qtyRatio: 1, tradeId: `t-${i}`, stockCode: `00${5000 + (i % 20)}`, stockName: 'T', closedAt: NOW.toISOString(), returnPct: i % 2 ? 3 : -2, isWin: i % 2 === 1, conditionScores: { 1: i % 2 ? 8 : 3, 2: 6, 3: i % 3 ? 2 : 9 }, holdingDays: 1 }; }
async function quality() { vi.resetModules(); return import('./learningOutcomeQuality.js'); }

beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'loq-')); process.env.PERSIST_DATA_DIR = tmp; write('reflection-budget.json', { month: '2026-05', tokensUsed: 0, callCount: 7, lastReflectionDate: '2026-05-10' }); write('condition-weights.json', Object.fromEntries(Array.from({ length: 27 }, (_, i) => [String(i + 1), 1]))); });
afterEach(() => { delete process.env.PERSIST_DATA_DIR; fs.rmSync(tmp, { recursive: true, force: true }); vi.resetModules(); vi.doUnmock('../alerts/telegramClient.js'); });

describe('Learning Outcome Quality Patch v1 reports', () => {
  it('/learning_outcome_summary가 225건 close 결과와 expectancy safety guard를 요약하는가?', async () => {
    write('ghost-portfolio.json', Array.from({ length: 225 }, (_, i) => closed(i)));
    write('attribution-records.json', Array.from({ length: 146 }, (_, i) => attr(i)));
    const q = await quality();
    const s = q.collectLearningOutcomeSummary(NOW);
    const msg = q.formatLearningOutcomeSummary(s);
    expect(s.closedTotal).toBe(225);
    expect(s.WIN).toBe(90);
    expect(s.LOSS).toBe(90);
    expect(s.EXPIRED).toBe(30);
    expect(s.QUARANTINED).toBe(15);
    expect(s.expectancyR).toBeLessThanOrEqual(0);
    expect(s.promotionAllowed).toBe(false);
    expect(msg).toContain('closedTotal=225');
    expect(msg).toContain('executionImpact=NONE');
  });

  it('/learning_open_residue가 남은 86건과 closeCandidates=0 사유를 분해하는가?', async () => {
    write('ghost-portfolio.json', Array.from({ length: 86 }, (_, i) => openCase(i)));
    write('attribution-records.json', []);
    const q = await quality();
    const s = q.collectLearningOpenResidue(NOW);
    expect(s.openRemaining).toBe(86);
    expect(s.closeCandidates).toBe(0);
    expect(s.quarantined).toBe(16);
    expect(s.zeroCloseReasonTop3.length).toBeGreaterThan(0);
    expect(q.formatLearningOpenResidue(s)).toContain('zeroCloseReasonTop3');
  });

  it('/learning_quarantine_report가 quarantined 16건의 reasonBreakdown을 출력하는가?', async () => {
    write('ghost-portfolio.json', Array.from({ length: 86 }, (_, i) => openCase(i)));
    const q = await quality();
    const s = q.collectLearningQuarantineReport();
    expect(s.totalQuarantined).toBe(16);
    expect(s.reasonBreakdown.MISSING_ENTRY_PRICE).toBeGreaterThan(0);
    expect(s.reasonBreakdown.MISSING_PRICE_DATA).toBeGreaterThan(0);
    expect(s.examples.length).toBeLessThanOrEqual(5);
    expect(q.formatLearningQuarantineReport(s)).toContain('reasonBreakdown');
  });

  it('/learning_attribution_quality가 conditionCoverage와 overfitRisk를 계산하는가?', async () => {
    write('ghost-portfolio.json', []);
    write('attribution-records.json', Array.from({ length: 146 }, (_, i) => attr(i)));
    const q = await quality();
    const s = q.collectLearningAttributionQuality(NOW);
    expect(s.samples7d).toBe(146);
    expect(s.conditionCoverage).toBeGreaterThan(0);
    expect(s.recommendationOnly).toBe(true);
    expect(q.formatLearningAttributionQuality(s)).toContain('overfitRisk');
  });

  it('/learning_suggest_report가 diagnosticSuggest 1건과 autoApply=false를 표시하는가?', async () => {
    write('ghost-portfolio.json', []);
    write('attribution-records.json', []);
    write('suggest_diagnostic_proposals.json', [{ id: 'p1', createdAt: NOW.toISOString(), channel: 'counterfactual', currentThreshold: 0.7, observedScore: 0.4, sampleSize: 12, blocker: 'THRESHOLD_NOT_MET', recommendation: 'observe only', riskLevel: 'LOW', autoApply: false }]);
    const q = await quality();
    const s = q.collectLearningSuggestReport(NOW);
    expect(s.diagnosticProposals).toBe(1);
    expect(s.autoApply).toBe(false);
    expect(s.promotionAllowed).toBe(false);
    expect(q.formatLearningSuggestReport(s)).toContain('autoApply=false');
  });

  it('/learning_pulse v3가 repair/outcome/open residue/attribution/suggest/gemini 섹션을 출력하는가?', async () => {
    write('ghost-portfolio.json', [...Array.from({ length: 225 }, (_, i) => closed(i)), ...Array.from({ length: 86 }, (_, i) => openCase(i))]);
    write('attribution-records.json', Array.from({ length: 146 }, (_, i) => attr(i)));
    write('learning_repair_runs.json', [{ close: { closed: 225, brokerOrdersCreated: 0 }, outcome: { finalized: 225 }, attr: { processedCount: 225 }, suggest: { proposals: [{}] }, criticalIntegrityEvents: 0, brokerOrdersCreated: 0 }]);
    write('gemini_learning_runs.json', [{ nextScheduledAt: '2026-05-13T09:00:00.000Z' }]);
    const q = await quality();
    const msg = q.formatLearningPulseV3(q.collectLearningPulseV3(NOW));
    expect(msg).toContain('Repair Last Run');
    expect(msg).toContain('Outcome Quality');
    expect(msg).toContain('Open Residue');
    expect(msg).toContain('Attribution Quality');
    expect(msg).toContain('Gemini:');
  });
});

describe('Learning Outcome Quality safety guarantees', () => {
  it('autoApply=false, executionImpact=NONE, brokerOrdersCreated=0, Gemini recommendationOnly=true가 유지되는가?', async () => {
    write('ghost-portfolio.json', Array.from({ length: 225 }, (_, i) => closed(i)));
    write('attribution-records.json', Array.from({ length: 146 }, (_, i) => attr(i)));
    const q = await quality();
    expect(q.collectLearningOutcomeSummary(NOW).autoApply).toBe(false);
    expect(q.collectLearningOutcomeSummary(NOW).executionImpact).toBe('NONE');
    expect(q.collectLearningOpenResidue(NOW).brokerOrdersCreated).toBe(0);
    expect(q.collectLearningPulseV3(NOW).gemini.recommendationOnly).toBe(true);
  });

  it('criticalIntegrityEvents가 0이 아니면 Telegram 경고가 발생하는가?', async () => {
    const sendTelegramAlert = vi.fn(async () => 1);
    vi.doMock('../alerts/telegramClient.js', () => ({ sendTelegramAlert }));
    write('ghost-portfolio.json', [ghost({ id: 'live-contam', closed: true, closedAt: NOW.toISOString(), outcomeLabel: 'WIN', finalReturnPct: 1, returnR: 1, attributionProcessed: true, executionImpact: 'LIVE' as any })]);
    write('attribution-records.json', []);
    const repair = await import('./learningRepairCommand.js');
    const r = await repair.learningRepairRun(NOW);
    expect(r.criticalIntegrityEvents).toBeGreaterThan(0);
    expect(sendTelegramAlert).toHaveBeenCalledTimes(1);
  });
});

describe('Learning Sample Quality Segmentation & Metadata Recovery Patch v1', () => {
  async function sampleQuality() { vi.resetModules(); return import('./learningSampleQuality.js'); }

  it('cohort segmentation test: backlog repair와 fresh shadow sample을 promotion 기준에서 분리한다', async () => {
    write('ghost-portfolio.json', [
      ...Array.from({ length: 225 }, (_, i) => closed(i)),
      ghost({ id: 'fresh-1', caseKind: 'shadow', closed: true, outcomeLabel: 'WIN', returnR: 1, finalReturnPct: 3, entryAt: '2026-05-13T06:30:00.000Z', closedAt: NOW.toISOString(), maxHoldingMinutes: 60, closeReason: undefined }),
    ]);
    write('counterfactual-shadow.json', []);
    const q = await sampleQuality();
    const s = q.collectLearningCohortSummary(NOW);
    expect(s.backlogRepairCount).toBe(210);
    expect(s.freshShadowCount).toBe(1);
    expect(s.promotionEligibleSamples).toBe(1);
    expect(q.formatLearningCohortSummary(s)).toContain('exclusionReason=promotion primary metric uses FRESH_SHADOW only');
  });

  it('metadata repair dryrun no-write test: 86건 open metadata 복구 가능성을 쓰기 없이 계산한다', async () => {
    const rows = Array.from({ length: 86 }, (_, i) => ghost({ id: `open-${i}`, closed: false, entryPrice: i < 16 ? undefined : 100, signalPriceKrw: i < 8 ? 100 : (i < 16 ? undefined as any : 100), targetPrice: undefined, stopPrice: undefined, currentReturnPct: undefined, exitPriceVirtual: undefined }));
    write('ghost-portfolio.json', rows);
    const before = fs.readFileSync(path.join(tmp, 'ghost-portfolio.json'), 'utf-8');
    const q = await sampleQuality();
    const s = q.learningMetadataRepairDryRun();
    const after = fs.readFileSync(path.join(tmp, 'ghost-portfolio.json'), 'utf-8');
    expect(s.scanned).toBe(86);
    expect(s.missingEntryPrice).toBe(8);
    expect(s.missingTargetStop).toBe(86);
    expect(s.recoverableTargetStop).toBe(78);
    expect(after).toBe(before);
    expect(s.executionImpact).toBe('NONE');
  });

  it('metadata repair confidence not HIGH test 및 executionImpact NONE / broker order zero test', async () => {
    write('ghost-portfolio.json', [ghost({ id: 'recoverable', closed: false, entryPrice: undefined, signalPriceKrw: 100, targetPrice: undefined, stopPrice: undefined, currentReturnPct: undefined, exitPriceVirtual: undefined })]);
    const q = await sampleQuality();
    const r = q.learningMetadataRepairRun(NOW);
    const saved = JSON.parse(fs.readFileSync(path.join(tmp, 'ghost-portfolio.json'), 'utf-8'))[0];
    expect(r.entryRecovered).toBe(1);
    expect(r.targetStopRecovered).toBe(1);
    expect(r.executionImpact).toBe('NONE');
    expect(r.brokerOrdersCreated).toBe(0);
    expect(r.livePositionTouched).toBe(false);
    expect(saved.cohortType).toBe('RECOVERED_METADATA');
    expect(saved.recoveryConfidence).not.toBe('HIGH');
    expect(saved.sourceConfidence).not.toBe('HIGH');
  });

  it('counterfactual build no-live-impact test: sampleSize=0 원인을 분해하고 run 후 증가시킨다', async () => {
    write('ghost-portfolio.json', [ghost({ id: 'blocked-1', stockCode: '111111', closed: false, entryPrice: 100, signalPriceKrw: 100, rejectionReason: 'SELL_ONLY_BLOCK' } as any)]);
    write('counterfactual-shadow.json', []);
    const q = await sampleQuality();
    const dry = q.counterfactualBuildDryRun(NOW);
    expect(dry.scannedBlocked).toBeGreaterThan(0);
    expect(dry.eligible).toBeGreaterThan(0);
    expect(dry.executionImpact).toBe('NONE');
    const run = q.counterfactualBuildRun(NOW);
    expect(run.built).toBeGreaterThan(0);
    expect(run.sampleSize).toBeGreaterThan(0);
    expect(run.executionImpact).toBe('NONE');
  });

  it('low sample condition ranking guard test: samples<30 효과값은 DO_NOT_TRADE로 보호한다', async () => {
    write('ghost-portfolio.json', []);
    write('attribution-records.json', [attr(1), attr(2)]);
    const q = await quality();
    const s = q.collectLearningAttributionQuality(NOW);
    expect(s.learnedConditions).toEqual([]);
    expect(s.lowSampleConditions).toContain(1);
    expect(JSON.stringify(s.topPositiveConditions)).toContain('LOW_SAMPLE / DO_NOT_TRADE');
    expect(q.formatLearningConditionReport(q.collectLearningConditionReport(NOW))).toContain('weightUpdateAllowed=false');
  });

  it('holding outlier exclusion test: 장기 backlog holding은 promotion에서 제외한다', async () => {
    write('ghost-portfolio.json', [closed(1), ghost({ id: 'fresh-outlier', caseKind: 'shadow', closed: true, outcomeLabel: 'WIN', returnR: 1, closedAt: NOW.toISOString(), entryAt: '2026-05-10T00:00:00.000Z', maxHoldingMinutes: 60 })]);
    const q = await sampleQuality();
    const s = q.collectLearningHoldingOutliers(NOW);
    expect(s.outlierCount).toBeGreaterThan(0);
    expect(s.excludedFromPromotion).toBeGreaterThan(0);
    expect(q.collectLearningCohortSummary(NOW).promotionEligibleSamples).toBe(0);
  });

  it('promotion fresh-only metric test: 전체 expectancy 대신 freshShadowExpectancyR와 counterfactual guard를 사용한다', async () => {
    write('ghost-portfolio.json', Array.from({ length: 225 }, (_, i) => closed(i)));
    write('attribution-records.json', Array.from({ length: 2 }, (_, i) => attr(i)));
    write('counterfactual-shadow.json', []);
    const q = await quality();
    const s = q.collectLearningOutcomeSummary(NOW);
    expect(s.promotionAllowed).toBe(false);
    expect(s.guardBlockers).toContain('freshShadowSampleSize<100');
    expect(s.guardBlockers).toContain('counterfactualSampleSize=0');
    expect(s.promotionMetricBasis).toBe('BLOCKED');
  });
});
