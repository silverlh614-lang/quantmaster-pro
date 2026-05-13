// @responsibility Learning Flow Unclog Patch v1 required regression suite — virtual-only closed learning loop
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { LearningGhostCase } from './learningTypes.js';

let tmp = '';
const NOW = new Date('2026-05-13T07:00:00.000Z');
function ghost(over: Partial<LearningGhostCase> = {}): LearningGhostCase {
  return { id: `g-${Math.random()}`, stockCode: '005930', stockName: '삼성전자', signalPriceKrw: 100, signalDate: '2026-05-12', entryAt: '2026-05-12T00:00:00.000Z', entryPrice: 100, stopPrice: 95, targetPrice: 110, maxHoldingMinutes: 60, rejectionReason: 'gate', trackUntil: '2026-06-12', closed: false, conditionScores: { 1: 8, 2: 6 }, ...over };
}
function write(name: string, data: unknown) { fs.writeFileSync(path.join(tmp, name), JSON.stringify(data, null, 2)); }
function read<T>(name: string): T { return JSON.parse(fs.readFileSync(path.join(tmp, name), 'utf-8')) as T; }
async function mods() {
  vi.resetModules();
  return {
    close: await import('./ghostCloseResolver.js'),
    finalizer: await import('./ghostOutcomeFinalizer.js'),
    attr: await import('./attributionBackfillEngine.js'),
    starvation: await import('./sampleStarvationGuard.js'),
    suggest: await import('./suggestThresholdCalibrator.js'),
    gemini: await import('./geminiUtilizationScheduler.js'),
    integrity: await import('./learningIntegrityGuard.js'),
    repair: await import('./learningRepairCommand.js'),
    pulse: await import('./learningPulseDiagnostics.js'),
  };
}

beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lfu-')); process.env.PERSIST_DATA_DIR = tmp; write('reflection-budget.json', { month: '2026-05', tokensUsed: 0, callCount: 7, lastReflectionDate: '2026-05-10' }); write('condition-weights.json', { 1: 1, 2: 1 }); });
afterEach(() => { delete process.env.PERSIST_DATA_DIR; fs.rmSync(tmp, { recursive: true, force: true }); vi.resetModules(); });

describe('GhostCloseResolver', () => {
  it('OPEN ghost case가 targetPrice에 도달하면 VIRTUAL_TAKE_PROFIT으로 close되는가?', async () => {
    write('ghost-portfolio.json', [ghost({ id: 'tp' })]); const m = await mods();
    const r = await m.close.runGhostCloseResolver({ now: NOW, priceProvider: async () => ({ high: 111, low: 100, close: 111 }) });
    const [g] = read<LearningGhostCase[]>('ghost-portfolio.json');
    expect(r.closed).toBe(1); expect(g.closeReason).toBe('VIRTUAL_TAKE_PROFIT'); expect(g.executionImpact).toBe('NONE');
  });
  it('OPEN ghost case가 stopPrice에 도달하면 VIRTUAL_STOP_LOSS로 close되는가?', async () => {
    write('ghost-portfolio.json', [ghost({ id: 'sl' })]); const m = await mods();
    await m.close.runGhostCloseResolver({ now: NOW, priceProvider: async () => ({ high: 100, low: 94, close: 94 }) });
    expect(read<LearningGhostCase[]>('ghost-portfolio.json')[0].closeReason).toBe('VIRTUAL_STOP_LOSS');
  });
  it('maxHoldingMinutes 초과 case가 VIRTUAL_TIME_EXIT으로 close되는가?', async () => {
    write('ghost-portfolio.json', [ghost({ id: 'time', targetPrice: 200, stopPrice: 50, maxHoldingMinutes: 1 })]); const m = await mods();
    await m.close.runGhostCloseResolver({ now: NOW, priceProvider: async () => ({ high: 101, low: 99, close: 101 }) });
    expect(read<LearningGhostCase[]>('ghost-portfolio.json')[0].closeReason).toBe('VIRTUAL_TIME_EXIT');
  });
});

describe('Outcome, attribution, starvation', () => {
  it('close된 case에 finalReturnPct와 returnR이 계산되는가?', async () => {
    write('ghost-portfolio.json', [ghost({ closed: true, closedAt: NOW.toISOString(), exitPriceVirtual: 110, closeReason: 'VIRTUAL_TAKE_PROFIT', executionImpact: 'NONE' })]); const m = await mods();
    m.finalizer.runGhostOutcomeFinalizer(); const [g] = read<LearningGhostCase[]>('ghost-portfolio.json');
    expect(g.finalReturnPct).toBe(10); expect(g.returnR).toBe(2); expect(g.outcomeLabel).toBe('WIN');
  });
  it('close된 case에 outcomeLabel이 없으면 integrity warning이 발생하는가?', async () => {
    write('ghost-portfolio.json', [ghost({ id: 'warn', closed: true, closedAt: NOW.toISOString(), executionImpact: 'NONE' })]); const m = await mods();
    const events = m.integrity.runLearningIntegrityGuard();
    expect(events.some(e => e.check === 'close_without_outcome' && e.severity === 'WARN')).toBe(true);
  });
  it('DATA_CORRUPTED / QUARANTINED case는 attribution에서 제외되는가?', async () => {
    write('ghost-portfolio.json', [ghost({ closed: true, closedAt: NOW.toISOString(), outcomeLabel: 'DATA_CORRUPTED', finalReturnPct: 1, returnR: 1 }), ghost({ closed: true, closedAt: NOW.toISOString(), outcomeLabel: 'QUARANTINED', finalReturnPct: 1, returnR: 1 })]); write('attribution-records.json', []); const m = await mods();
    const r = m.attr.runAttributionBackfill({ now: NOW }); expect(r.processedCount).toBe(0); expect(r.skippedCount).toBe(2);
  });
  it('closed but attributionProcessed=false인 case가 backfill되는가?', async () => {
    write('ghost-portfolio.json', [ghost({ id: 'bf', closed: true, closedAt: NOW.toISOString(), outcomeLabel: 'WIN', finalReturnPct: 5, returnR: 1, attributionProcessed: false })]); write('attribution-records.json', []); const m = await mods();
    const r = m.attr.runAttributionBackfill({ now: NOW }); expect(r.processedCount).toBe(1); expect(read<any[]>('attribution-records.json')).toHaveLength(1); expect(read<LearningGhostCase[]>('ghost-portfolio.json')[0].attributionProcessed).toBe(true);
  });
  it('Attribution sample이 target 미만이면 starvationReason이 정확히 기록되는가?', async () => {
    write('ghost-portfolio.json', [ghost({ closed: true, closedAt: NOW.toISOString(), outcomeLabel: 'WIN', finalReturnPct: 5, returnR: 1, attributionProcessed: false })]); write('attribution-records.json', []); const m = await mods();
    const a = m.starvation.analyzeSampleStarvation(NOW, 70); expect(a.starvationFlag).toBe(true); expect(a.primaryReason).toBe('label_without_attribution');
  });
});

describe('Suggest/Gemini safety', () => {
  it('suggest 7일 0건이면 diagnostic suggest proposal이 생성되는가?', async () => { write('ghost-portfolio.json', []); write('attribution-records.json', []); const m = await mods(); const r = m.suggest.runSuggestThresholdCalibrator({ now: NOW, suggest7d: {} }); expect(r.proposals.length).toBeGreaterThan(0); });
  it('diagnostic suggest는 autoApply=false인가?', async () => { const m = await mods(); const r = m.suggest.runSuggestThresholdCalibrator({ now: NOW, suggest7d: {} }); expect(r.proposals[0].autoApply).toBe(false); });
  it('Gemini 호출률이 목표 미만이면 nextScheduledAt이 생성되는가?', async () => { write('ghost-portfolio.json', []); write('attribution-records.json', []); const m = await mods(); const r = m.gemini.scheduleGeminiLearningReflection(NOW); expect(r.nextScheduledAt).toBeTruthy(); });
  it('Gemini 결과가 직접 condition weight를 변경하지 않는가?', async () => { write('attribution-records.json', []); const m = await mods(); const r = m.gemini.scheduleGeminiLearningReflection(NOW); expect(r.conditionWeightsChanged).toBe(0); expect(read<any>('condition-weights.json')).toEqual({ 1: 1, 2: 1 }); });
});

describe('LearningRepairCommand and safety invariants', () => {
  it('/learning_repair_dryrun은 데이터를 변경하지 않는가?', async () => {
    const data = [ghost({ id: 'dry', targetPrice: 110 })]; write('ghost-portfolio.json', data); write('attribution-records.json', []); const before = fs.readFileSync(path.join(tmp, 'ghost-portfolio.json'), 'utf-8'); const m = await mods();
    await m.repair.learningRepairDryRun(NOW); expect(fs.readFileSync(path.join(tmp, 'ghost-portfolio.json'), 'utf-8')).toBe(before);
  });
  it('/learning_repair_run은 GhostCloseResolver → OutcomeFinalizer → AttributionBackfill → SuggestDiagnostic 순서로 실행되는가?', async () => {
    write('ghost-portfolio.json', [ghost({ id: 'run' })]); write('attribution-records.json', []); const m = await mods(); const r = await m.repair.learningRepairRun(NOW);
    expect(r.order.slice(0, 4)).toEqual(['GhostCloseResolver','GhostOutcomeFinalizer','AttributionBackfillEngine','SuggestThresholdCalibrator']);
  });
  it('ghost/shadow case의 executionImpact가 NONE이 아니면 CRITICAL로 감지되는가?', async () => { write('ghost-portfolio.json', [ghost({ executionImpact: 'LIVE' as any })]); const m = await mods(); expect(m.integrity.runLearningIntegrityGuard().some(e => e.severity === 'CRITICAL' && e.check === 'executionImpact_not_NONE_in_ghost')).toBe(true); });
  it('ghost close가 실제 broker order를 만들지 않는가?', async () => { write('ghost-portfolio.json', [ghost()]); const m = await mods(); const r = await m.close.runGhostCloseResolver({ now: NOW, priceProvider: async () => ({ high: 111, low: 100, close: 111 }) }); expect(r.brokerOrdersCreated).toBe(0); });
  it('liveExecutionAllowed=false 상태에서 learning repair가 실거래 주문을 만들지 않는가?', async () => { write('ghost-portfolio.json', [ghost()]); write('attribution-records.json', []); const m = await mods(); const r = await m.repair.learningRepairRun(NOW); expect(r.brokerOrdersCreated).toBe(0); expect(r.criticalIntegrityEvents).toBe(0); });
  it('/learning_pulse v2가 closeRate, staleOpenCount, starvationReason, suggest blocker를 출력하는가?', async () => { write('ghost-portfolio.json', [ghost({ closed: false, lastUpdatedAt: '2026-05-10T00:00:00Z' })]); write('attribution-records.json', []); const m = await mods(); const msg = m.pulse.formatLearningPulseV2Message(m.pulse.collectLearningPulseV2(NOW)); expect(msg).toContain('closeRate7d'); expect(msg).toContain('staleOpenCount'); expect(msg).toContain('starvationReason'); expect(msg).toContain('blocker'); });
});
