import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildOperatorActionQueueAdr0480,
  collectOperatorActionSourcesFromScanSummaryAdr0480,
  formatOperatorActionCompactSectionAdr0480,
  formatOperatorActionDetailAdr0480,
  getOperatorActionDetailRegistryEntryAdr0480,
  safeBuildOperatorActionQueueAdr0480,
  type OperatorActionSource,
} from './operatorActionRouterAdr0480.js';
import type { ScanSummary } from './scanDiagnostics.js';

function source(patch: Partial<OperatorActionSource>): OperatorActionSource {
  return {
    adr: '0477',
    sectionId: 'test',
    code: 'TEST',
    diagnosticKey: 'test',
    diagnosticValue: 'ok',
    severity: 'DEGRADED',
    ...patch,
  };
}

function roots(sources: OperatorActionSource[]) {
  return buildOperatorActionQueueAdr0480({ generatedAt: '2026-05-09T00:00:00.000Z', sources }).allActions.map((a) => a.rootCause);
}

const routerSrc = fs.readFileSync(path.resolve('server/trading/signalScanner/operatorActionRouterAdr0480.ts'), 'utf-8');
const scanBlockersSrc = fs.readFileSync(path.resolve('server/telegram/commands/system/scanBlockers.cmd.ts'), 'utf-8');
const runtimeAuditSrc = fs.readFileSync(path.resolve('server/diagnostics/runtimePipelineAudit.ts'), 'utf-8');
const minimumScoreSrc = fs.readFileSync(path.resolve('server/trading/signalScanner/minimumSignalScoreTrace.ts'), 'utf-8');

describe('ADR-0480 Operator Action Router & Remediation Queue', () => {
  it('1. Groups ADR-0473 NOT_WIRED + ADR-0477 selectedProvider=NONE into one INVESTOR_FLOW_PROVIDER_UNWIRED action', () => {
    const report = buildOperatorActionQueueAdr0480({ sources: [
      source({ adr: '0473', code: 'NAVER_INVESTOR_TREND', diagnosticKey: 'NAVER_INVESTOR_TREND', diagnosticValue: 'NOT_WIRED', severity: 'DATA_UNAVAILABLE' }),
      source({ adr: '0477', diagnosticKey: 'selectedProvider', diagnosticValue: 'selectedProvider=NONE', severity: 'DATA_UNAVAILABLE' }),
    ] });
    expect(report.allActions).toHaveLength(1);
    expect(report.allActions[0].rootCause).toBe('INVESTOR_FLOW_PROVIDER_UNWIRED');
    expect(report.suppressedDuplicates).toBe(1);
  });

  it('2. Groups semantic net-buy missing into SEMANTIC_NETBUY_MISSING action', () => {
    expect(roots([source({ adr: '0477', diagnosticKey: 'semanticNetBuy', diagnosticValue: 'semanticNetBuy=null' })])).toContain('SEMANTIC_NETBUY_MISSING');
  });

  it('3. Groups CACHE_EMPTY into SUPPLY_CACHE_EMPTY action', () => {
    expect(roots([source({ adr: '0473', code: 'CACHE_EMPTY', diagnosticKey: 'cache', diagnosticValue: 'CACHE_EMPTY' })])).toContain('SUPPLY_CACHE_EMPTY');
  });

  it('4. Groups KIS PROVIDER_MISMATCH into KIS_PROVIDER_MISMATCH action', () => {
    expect(roots([source({ adr: '0477', code: 'KIS_API', diagnosticKey: 'KIS_API', diagnosticValue: 'PROVIDER_MISMATCH' })])).toContain('KIS_PROVIDER_MISMATCH');
  });

  it('5. Groups FSS stale / source stale into FSS_SOURCE_STALE action', () => {
    expect(roots([source({ adr: '0477', diagnosticKey: 'FSS Passive/Active', diagnosticValue: 'source stale' })])).toContain('FSS_SOURCE_STALE');
  });

  it('6. Groups SectorEnergy fallback-only diagnostics into SECTOR_ENERGY_FALLBACK_ONLY action', () => {
    expect(roots([source({ adr: '0474', diagnosticKey: 'SectorEnergy', diagnosticValue: 'fallback mounted; coverage degraded' })])).toContain('SECTOR_ENERGY_FALLBACK_ONLY');
  });

  it('7. Groups duplicate supply unknown penalties into SUPPLY_UNKNOWN_DUPLICATE_PENALTY action', () => {
    expect(roots([source({ adr: '0469', diagnosticKey: 'SUPPLY_UNKNOWN duplicate group', diagnosticValue: 'ADR-0469 dedup active' })])).toContain('SUPPLY_UNKNOWN_DUPLICATE_PENALTY');
  });

  it('8. Deduplicates repeated diagnostics across multiple ADRs', () => {
    const report = buildOperatorActionQueueAdr0480({ sources: [
      source({ adr: '0473', diagnosticKey: 'NAVER_INVESTOR_TREND', diagnosticValue: 'NOT_WIRED' }),
      source({ adr: '0477', diagnosticKey: 'coverage', diagnosticValue: 'coverage=0/5' }),
      source({ adr: '0465', diagnosticKey: 'investor_flow', diagnosticValue: 'DATA_UNAVAILABLE' }),
      source({ adr: '0466', diagnosticKey: 'UNKNOWN_DATA_PENALTY', diagnosticValue: 'provider issue' }),
    ] });
    expect(report.dedupedRootCauses).toEqual(['INVESTOR_FLOW_PROVIDER_UNWIRED', 'SUPPLY_UNKNOWN_DUPLICATE_PENALTY']);
    expect(report.allActions.find((a) => a.rootCause === 'INVESTOR_FLOW_PROVIDER_UNWIRED')?.evidenceCount).toBe(3);
  });

  it('9. Assigns P1 to investor-flow provider unwired', () => {
    const action = buildOperatorActionQueueAdr0480({ sources: [source({ diagnosticKey: 'selectedProvider', diagnosticValue: 'selectedProvider=NONE' })] }).allActions[0];
    expect(action.priority).toBe('P1');
  });

  it('10. Assigns P1 to semantic net-buy missing', () => {
    const action = buildOperatorActionQueueAdr0480({ sources: [source({ diagnosticKey: 'semanticNetBuy', diagnosticValue: 'semanticNetBuy=null' })] }).allActions[0];
    expect(action.priority).toBe('P1');
  });

  it('11. Assigns P2 to stale source refresh', () => {
    const action = buildOperatorActionQueueAdr0480({ sources: [source({ diagnosticKey: 'FSS_SOURCE_STALE', diagnosticValue: 'source stale' })] }).allActions[0];
    expect(action.priority).toBe('P2');
  });

  it('12. Assigns P3 to KIS provider role documentation when not causing primary block', () => {
    const action = buildOperatorActionQueueAdr0480({ sources: [source({ diagnosticKey: 'KIS_API', diagnosticValue: 'PROVIDER_MISMATCH' })] }).allActions[0];
    expect(action.priority).toBe('P3');
  });

  it('ADR-0544 T8a: 휴일 SectorEnergy verify-skip → REPAIR_SECTOR_INDEX_MASTER P1→P3 강등 + Observe 안내', () => {
    const action = buildOperatorActionQueueAdr0480({ sources: [
      source({ adr: '0488', diagnosticKey: 'REPAIR_SECTOR_INDEX_MASTER', diagnosticValue: 'REPAIR_SECTOR_INDEX_MASTER SECTOR_INDEX_MARKET_CLOSED' }),
    ] }).allActions.find((a) => a.rootCause === 'REPAIR_SECTOR_INDEX_MASTER');
    expect(action?.priority).toBe('P3');
    expect(action?.recommendedAction).toContain('next trading session');
    expect(action?.executionImpact).toBe('NONE');
  });

  it('ADR-0544 T8b: 장중 실제 SectorEnergy repair → P1 유지 (session 신호 없음)', () => {
    const action = buildOperatorActionQueueAdr0480({ sources: [
      source({ adr: '0488', diagnosticKey: 'REPAIR_SECTOR_INDEX_MASTER', diagnosticValue: 'REPAIR_SECTOR_INDEX_MASTER VERIFIED_INDEX_CODE_COVERAGE_LOW' }),
    ] }).allActions.find((a) => a.rootCause === 'REPAIR_SECTOR_INDEX_MASTER');
    expect(action?.priority).toBe('P1');
  });

  it('13. Top actions are sorted by priority and evidence count', () => {
    const report = buildOperatorActionQueueAdr0480({ sources: [
      source({ diagnosticKey: 'CACHE_EMPTY', diagnosticValue: 'CACHE_EMPTY' }),
      source({ diagnosticKey: 'KIS_API', diagnosticValue: 'PROVIDER_MISMATCH' }),
      source({ diagnosticKey: 'semanticNetBuy', diagnosticValue: 'semanticNetBuy=null' }),
      source({ diagnosticKey: 'selectedProvider', diagnosticValue: 'selectedProvider=NONE' }),
      source({ diagnosticKey: 'coverage', diagnosticValue: 'coverage=0/5' }),
    ] });
    expect(report.topActions.map((a) => a.rootCause)).toEqual(['INVESTOR_FLOW_PROVIDER_UNWIRED', 'SEMANTIC_NETBUY_MISSING', 'SUPPLY_CACHE_EMPTY']);
  });

  it('14. Default /scan_blockers integration shows only top 3 actions', () => {
    const report = buildOperatorActionQueueAdr0480({ sources: [
      source({ diagnosticKey: 'selectedProvider', diagnosticValue: 'selectedProvider=NONE' }),
      source({ diagnosticKey: 'semanticNetBuy', diagnosticValue: 'semanticNetBuy=null' }),
      source({ diagnosticKey: 'CACHE_EMPTY', diagnosticValue: 'CACHE_EMPTY' }),
      source({ diagnosticKey: 'KIS_API', diagnosticValue: 'PROVIDER_MISMATCH' }),
    ] });
    const section = formatOperatorActionCompactSectionAdr0480(report);
    expect(section).toContain('Top Operator Actions');
    expect(section.split('\n').filter((line) => line.startsWith('- '))).toHaveLength(3);
    expect(scanBlockersSrc).toContain('safeFormatOperatorActionCompactSectionAdr0480');
  });

  it('15. Detail mode shows all actions with evidence', () => {
    const report = buildOperatorActionQueueAdr0480({ sources: [
      source({ diagnosticKey: 'selectedProvider', diagnosticValue: 'selectedProvider=NONE' }),
      source({ diagnosticKey: 'CACHE_EMPTY', diagnosticValue: 'CACHE_EMPTY' }),
      source({ diagnosticKey: 'KIS_API', diagnosticValue: 'PROVIDER_MISMATCH' }),
      source({ diagnosticKey: 'FSS_SOURCE_STALE', diagnosticValue: 'source stale' }),
    ] });
    const detail = formatOperatorActionDetailAdr0480(report);
    expect(detail).toContain('Operator Action Queue (ADR-0480)');
    expect(detail).toContain('evidence:');
    expect(detail).toContain('KIS_PROVIDER_MISMATCH');
    expect(detail).toContain('FSS_SOURCE_STALE');
  });

  it('16. If no actions exist, safe “No open P0/P1 actions” message is rendered', () => {
    const section = formatOperatorActionCompactSectionAdr0480(buildOperatorActionQueueAdr0480({ sources: [] }));
    expect(section).toContain('No open P0/P1 actions. Continue observation.');
  });

  it('17. Router failure is try/catch isolated', () => {
    const bad = {} as OperatorActionSource;
    Object.defineProperty(bad, 'diagnosticKey', { get: () => { throw new Error('boom'); } });
    const report = safeBuildOperatorActionQueueAdr0480({ sources: [bad] });
    expect(report.totalActions).toBe(0);
    expect(report.executionImpact).toBe('NONE');
  });

  it('18. No live execution modules are imported', () => {
    expect(routerSrc).not.toMatch(/autoTradeEngine|orderExecutor|trancheExecutor|createLiveOrder|promoteToLive/);
  });

  it('19. No KIS order modules are imported', () => {
    expect(routerSrc).not.toMatch(/kis.*order|order.*kis|sendOrder|buyOrder|sellOrder/i);
  });

  it('20. requiredScore remains 70', () => {
    // ADR-0546: minimumSignalScoreTrace derives requiredScore from the carried
    // minSignalRequiredScore (settings fallback), never a hardcoded relaxed value.
    expect(minimumScoreSrc).toContain('const requiredScore = input.trace.minSignalRequiredScore');
  });

  it('21. Gate thresholds, weights, and Kelly remain unchanged', () => {
    expect(routerSrc).not.toMatch(/setGateThreshold|GATE_RELAX|requiredScore\s*=|kellyMultiplier\s*=|finalKellyMultiplier\s*=/);
  });

  it('22. UNKNOWN is never converted to bullish', () => {
    expect(routerSrc).not.toMatch(/UNKNOWN.*BULLISH|BULLISH.*UNKNOWN/);
  });

  it('23. Provider issue is never converted to bearish', () => {
    expect(routerSrc).not.toMatch(/providerIssue.*BEARISH|BEARISH.*providerIssue/);
  });

  it('24. executionImpact is always NONE', () => {
    const report = buildOperatorActionQueueAdr0480({ sources: [source({ diagnosticKey: 'selectedProvider', diagnosticValue: 'selectedProvider=NONE' })] });
    expect(report.allActions.every((a) => a.executionImpact === 'NONE')).toBe(true);
    expect(report.executionImpact).toBe('NONE');
  });

  it('25. liveExecutionAllowed is always false', () => {
    const report = buildOperatorActionQueueAdr0480({ sources: [source({ diagnosticKey: 'selectedProvider', diagnosticValue: 'selectedProvider=NONE' })] });
    expect(report.allActions.every((a) => a.liveExecutionAllowed === false)).toBe(true);
    expect(report.liveExecutionAllowed).toBe(false);
  });

  it('26. policyPromotionMode is always SHADOW_ONLY', () => {
    const report = buildOperatorActionQueueAdr0480({ sources: [source({ diagnosticKey: 'selectedProvider', diagnosticValue: 'selectedProvider=NONE' })] });
    expect(report.allActions.every((a) => a.policyPromotionMode === 'SHADOW_ONLY')).toBe(true);
  });

  it('27. operatorApprovalRequired is always true', () => {
    const report = buildOperatorActionQueueAdr0480({ sources: [source({ diagnosticKey: 'selectedProvider', diagnosticValue: 'selectedProvider=NONE' })] });
    expect(report.allActions.every((a) => a.operatorApprovalRequired === true)).toBe(true);
  });

  it('28. ADR-0478 compact output can include Top Operator Actions', () => {
    expect(scanBlockersSrc).toContain('safeFormatOperatorActionCompactSectionAdr0480');
    const summary = { time: 't', candidates: 1, trackB: 0, swing: 0, catalyst: 0, momentum: 0, yahooFails: 0, gateMisses: 0, rrrMisses: 0, entries: 0, waitDistribution: { dataHold: 1, preBreakout: 0, gateFail: 0, sizingBlocked: 0, driftRemove: 0, corpAction: 0, volumeDrop: 0, other: 0 } } as ScanSummary;
    expect(collectOperatorActionSourcesFromScanSummaryAdr0480(summary).length).toBeGreaterThan(0);
  });

  it('29. ADR-0479 detail registry can expose ADR-0480 detail', () => {
    const report = buildOperatorActionQueueAdr0480({ sources: [source({ diagnosticKey: 'selectedProvider', diagnosticValue: 'selectedProvider=NONE' })] });
    const entry = getOperatorActionDetailRegistryEntryAdr0480(report);
    expect(entry.adr).toBe('0480');
    expect(entry.sectionId).toBe('operator_actions');
    expect(entry.adrTraceHint).toBe('/adr_trace 0480');
    expect(entry.render()).toContain('INVESTOR_FLOW_PROVIDER_UNWIRED');
  });

  it('30. Runtime Pipeline Audit treats ADR-0480 as diagnostic evidence only', () => {
    expect(runtimeAuditSrc).toContain('operatorActionEvidenceCount');
    expect(runtimeAuditSrc).toContain('formatRuntimePipelineDiagnosticEvidenceLineAdr0480');
    expect(runtimeAuditSrc).toContain('adr460Installed: false');
  });

  // ADR-0544 follow-up: 휴일/세션닫힘 SectorEnergy 진단 소스 억제 → REPAIR action 미생성.
  const sectorSummary = (canonical: Record<string, unknown>): ScanSummary => ({
    time: 't', candidates: 1, trackB: 0, swing: 0, catalyst: 0, momentum: 0,
    yahooFails: 0, gateMisses: 0, rrrMisses: 0, entries: 0,
    sectorEnergyQuality: 'DEGRADED',
    sectorEnergySupplyUnknownAdr0488: {
      sectorEnergyCanonicalState: canonical,
      // collectOperatorActionSourcesFromAdr0488 가 읽는 최소 report (status!=FETCH_OK → REPAIR gap 후보).
      topGaps: [],
      sectorEnergyMaster: { status: 'PARTIAL', coveragePct: 0 },
      supplyUnknownPolicy: { unknownPolicyActive: false, providerIssue: false },
    },
  } as unknown as ScanSummary);

  it('31. 세션닫힘(SESSION_NOT_VERIFIABLE) → SECTOR_ENERGY_DEGRADED 소스 미push (REPAIR action 미생성)', () => {
    const sources = collectOperatorActionSourcesFromScanSummaryAdr0480(
      sectorSummary({ dataQuality: 'SESSION_NOT_VERIFIABLE', sectorIndexVerifyMode: 'VERIFY_SKIPPED_SESSION_CLOSED', verifiedOfficialSectorCount: 0, promotionCoveragePass: false }),
    );
    expect(sources.some((s) => s.code === 'SECTOR_ENERGY_DEGRADED')).toBe(false);
    const actions = buildOperatorActionQueueAdr0480({ sources }).allActions;
    expect(actions.some((a) => a.rootCause === 'REPAIR_SECTOR_INDEX_MASTER')).toBe(false);
  });

  it('32. 대조군: 장중 MISSING → SECTOR_ENERGY_DEGRADED 소스 유지 (분류 분리 보존)', () => {
    const sources = collectOperatorActionSourcesFromScanSummaryAdr0480(
      sectorSummary({ dataQuality: 'MISSING', sectorIndexVerifyMode: 'LIVE_VERIFY', verifiedOfficialSectorCount: 0, promotionCoveragePass: false }),
    );
    expect(sources.some((s) => s.code === 'SECTOR_ENERGY_DEGRADED')).toBe(true);
  });

  // 표기 정합 point 1: promotionCoveragePass=true(by-design 제외 테마로 count<11, dataQuality=PARTIAL)면
  // SectorEnergy repair P1 액션을 emit 하지 않는다. promotion 실패 시에는 그대로 emit (false-negative 방지).
  const sectorSummaryWithRepairGap = (canonical: Record<string, unknown>): ScanSummary => ({
    time: 't', candidates: 1, trackB: 0, swing: 0, catalyst: 0, momentum: 0,
    yahooFails: 0, gateMisses: 0, rrrMisses: 0, entries: 0,
    sectorEnergyQuality: 'PARTIAL',
    sectorEnergySupplyUnknownAdr0488: {
      sectorEnergyCanonicalState: canonical,
      // collectOperatorActionSourcesFromAdr0488 가 REPAIR_SECTOR_INDEX_MASTER gap 을 만들도록 status!=FETCH_OK.
      topGaps: [],
      sectorEnergyMaster: { status: 'PARTIAL', coveragePct: 0 },
      supplyUnknownPolicy: { unknownPolicyActive: false, providerIssue: false },
    },
  } as unknown as ScanSummary);

  it('33. promotionCoveragePass=true(count<11, PARTIAL) → REPAIR_SECTOR_INDEX_MASTER 미emit (by-design 제외 테마 repair 금지)', () => {
    const sources = collectOperatorActionSourcesFromScanSummaryAdr0480(
      sectorSummaryWithRepairGap({ dataQuality: 'PARTIAL', sectorIndexVerifyMode: 'LIVE_VERIFY', verifiedOfficialSectorCount: 9, promotionCoveragePass: true, promotionAllowed: true }),
    );
    expect(sources.some((s) => s.code === 'REPAIR_SECTOR_INDEX_MASTER')).toBe(false);
    expect(sources.some((s) => s.code === 'IMPROVE_INDEX_CODE_COVERAGE')).toBe(false);
    const actions = buildOperatorActionQueueAdr0480({ sources }).allActions;
    expect(actions.some((a) => a.rootCause === 'REPAIR_SECTOR_INDEX_MASTER')).toBe(false);
  });

  it('34. 대조군: promotionCoveragePass=false(실제 coverage 미달) → REPAIR_SECTOR_INDEX_MASTER emit (진짜 장애 경고 보존)', () => {
    const sources = collectOperatorActionSourcesFromScanSummaryAdr0480(
      sectorSummaryWithRepairGap({ dataQuality: 'PARTIAL', sectorIndexVerifyMode: 'LIVE_VERIFY', verifiedOfficialSectorCount: 5, promotionCoveragePass: false, promotionAllowed: false }),
    );
    expect(sources.some((s) => s.code === 'REPAIR_SECTOR_INDEX_MASTER')).toBe(true);
    const actions = buildOperatorActionQueueAdr0480({ sources }).allActions;
    expect(actions.some((a) => a.rootCause === 'REPAIR_SECTOR_INDEX_MASTER')).toBe(true);
  });
});
