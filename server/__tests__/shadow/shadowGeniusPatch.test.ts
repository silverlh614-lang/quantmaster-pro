import { describe, expect, it } from 'vitest';
import { InMemoryShadowCaseLedger } from '../../shadow/shadowCaseLedger.js';
import type { ShadowCase } from '../../shadow/shadowTypes.js';
import { transitionShadowState } from '../../shadow/shadowStateMachine.js';
import { inspectShadowIntegrity } from '../../shadow/shadowIntegrityGuard.js';
import { buildPromotionReport } from '../../shadow/shadowPromotionGate.js';
import { ShadowReturnFlow } from '../../shadow/shadowReturnFlow.js';
import { formatShadowStatus } from '../../shadow/shadowCommands.js';

function mkCase(patch: Partial<ShadowCase>): ShadowCase {
  const now = '2026-05-13T00:00:00.000Z';
  return {
    caseId: patch.caseId ?? `case-${Math.random()}`,
    signalId: patch.signalId ?? `sig-${Math.random()}`,
    symbol: patch.symbol ?? '005930',
    symbolName: patch.symbolName ?? '삼성전자',
    detectedAt: now,
    marketSession: 'REGULAR',
    engineMode: patch.engineMode ?? 'SHADOW_ONLY',
    dataHealth: 'OK',
    providerHealth: 'OK',
    confidenceLevel: 'CALCULATED',
    executionImpact: patch.executionImpact ?? 'NONE',
    sourceConfidence: 'CALCULATED',
    createdAt: now,
    updatedAt: now,
    ...patch,
  };
}

describe('Shadow Learning Genius Patch v1', () => {
  it('SELL_ONLY 상태에서도 Shadow case가 생성된다', () => {
    const ledger = new InMemoryShadowCaseLedger();
    const c = ledger.upsertCase(mkCase({ caseId: 'sell-only', engineMode: 'SELL_ONLY', executionImpact: 'LIVE_ORDER_ALLOWED' }));
    expect(c.engineMode).toBe('SELL_ONLY');
    expect(c.executionImpact).toBe('NONE');
  });

  it('SHADOW_ONLY 상태에서 executionImpact가 항상 NONE이다', () => {
    const t = transitionShadowState({ caseId: 'c1', to: 'CANDIDATE_DETECTED', reason: 'test', engineMode: 'SHADOW_ONLY', executionImpact: 'LIVE_ORDER_ALLOWED', dataHealth: 'OK', confidenceLevel: 'CALCULATED' });
    expect(t.ok).toBe(true);
    expect(t.transition.executionImpact).toBe('NONE');
  });

  it('HARD_BLOCK 상태에서 live order가 생성되지 않는 것으로 integrity가 강제 감지한다', () => {
    const ledger = new InMemoryShadowCaseLedger();
    ledger.upsertCase(mkCase({ caseId: 'hard', engineMode: 'OBSERVE_ONLY', liveOrderCreated: true }));
    const issues = inspectShadowIntegrity(ledger);
    expect(issues.find((i) => i.item === 'live_order_created_in_shadow_mode')?.severity).toBe('CRITICAL');
  });

  it('closed position에 outcomeLabel이 없으면 integrity warning이 발생한다', () => {
    const ledger = new InMemoryShadowCaseLedger();
    ledger.upsertCase(mkCase({ caseId: 'closed', state: 'SHADOW_POSITION_CLOSED', outcomeLabel: undefined }));
    expect(inspectShadowIntegrity(ledger).find((i) => i.item === 'closed_without_label')?.severity).toBe('WARN');
  });

  it('executionImpact가 NONE이 아닌 Shadow case는 CRITICAL로 감지된다', () => {
    const ledger = new InMemoryShadowCaseLedger();
    ledger.upsertCase(mkCase({ caseId: 'impact', engineMode: 'NORMAL', executionImpact: 'LIVE_ORDER_ALLOWED' }));
    ledger.updateCase('impact', { engineMode: 'SHADOW_ONLY', executionImpact: 'LIVE_ORDER_ALLOWED' });
    expect(ledger.getCase('impact')?.executionImpact).toBe('NONE');
    const raw = mkCase({ caseId: 'raw', engineMode: 'SHADOW_ONLY', executionImpact: 'LIVE_ORDER_ALLOWED' });
    const hacked = { listCases: () => [raw], getCase: () => raw, upsertCase: (x: ShadowCase) => x, updateCase: () => raw, recordTransition: () => undefined, listTransitions: () => [] };
    expect(inspectShadowIntegrity(hacked).find((i) => i.item === 'executionImpact_not_NONE_in_shadow')?.severity).toBe('CRITICAL');
  });

  it('return flow hitRate가 90% 미만이면 promotionStatus가 BLOCKED이다', () => {
    const ledger = new InMemoryShadowCaseLedger();
    for (let i = 0; i < 120; i++) ledger.upsertCase(mkCase({ caseId: `p${i}`, signalId: `p${i}`, state: 'SHADOW_PAPER_FILLED', outcomeLabel: i < 80 ? 'WIN' : 'LOSS', finalReturnPct: i < 80 ? 2 : -1 }));
    expect(buildPromotionReport(ledger, 0.89).promotionStatus).toBe('BLOCKED');
  });

  it('sampleSize가 100 미만이면 promotionStatus가 READY_FOR_CANARY가 될 수 없다', () => {
    const ledger = new InMemoryShadowCaseLedger();
    for (let i = 0; i < 99; i++) ledger.upsertCase(mkCase({ caseId: `s${i}`, signalId: `s${i}`, state: 'SHADOW_PAPER_FILLED', outcomeLabel: 'WIN', finalReturnPct: 1 }));
    expect(buildPromotionReport(ledger, 1).promotionStatus).toBe('BLOCKED');
  });

  it('duplicate signal이 중복 Telegram 발송으로 이어지지 않는다', () => {
    const ledger = new InMemoryShadowCaseLedger();
    ledger.upsertCase(mkCase({ caseId: 'd1', signalId: 'same', duplicateTelegramSuppressed: true }));
    ledger.upsertCase(mkCase({ caseId: 'd2', signalId: 'same', duplicateTelegramSuppressed: true }));
    expect(formatShadowStatus(ledger)).toContain('duplicateSuppressed: 2');
  });

  it('provider error가 market risk로 오해되지 않는다', () => {
    const flow = new ShadowReturnFlow();
    flow.record({ caseId: 'r1', symbol: '1', lookupDay: 1, checkedAt: new Date().toISOString(), hit: false, stale: false, pending: true, providerFallbackUsed: true, providerHealth: 'KRX_UNAVAILABLE', sourceConfidence: 'EXTERNAL_API', marketRiskInferred: false });
    expect(flow.list()[0].marketRiskInferred).toBe(false);
    expect(flow.list()[0].sourceConfidence).toBe('FALLBACK');
  });

  it('DATA_CORRUPTED / QUARANTINED 샘플이 성과 통계에서 제외된다', () => {
    const ledger = new InMemoryShadowCaseLedger();
    ledger.upsertCase(mkCase({ caseId: 'good', signalId: 'good', outcomeLabel: 'WIN', finalReturnPct: 2, state: 'SHADOW_PAPER_FILLED' }));
    ledger.upsertCase(mkCase({ caseId: 'bad-data', signalId: 'bad-data', outcomeLabel: 'DATA_CORRUPTED', finalReturnPct: -99, state: 'SHADOW_PAPER_FILLED' }));
    ledger.upsertCase(mkCase({ caseId: 'q', signalId: 'q', outcomeLabel: 'QUARANTINED', finalReturnPct: -99, state: 'SHADOW_PAPER_FILLED' }));
    expect(buildPromotionReport(ledger, 1).sampleSize).toBe(1);
  });
});
