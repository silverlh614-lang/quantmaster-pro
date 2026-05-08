// @responsibility ADR-458 Gate Reclassification Dry-Run buyListLoop wiring 정적 회귀 테스트
import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

describe('ADR-458 buyListLoop dry-run wiring', () => {
  it('ENV disabled 시 dry-run skip 경로가 wiring 되어 있다', () => {
    const src = fs.readFileSync(path.resolve('server/trading/signalScanner/perSymbol/buyListLoop.ts'), 'utf-8');
    expect(src).toContain('isGateReclassificationDryRunDisabled()');
    expect(src).toContain('evaluateGateReclassificationDryRun');
    expect(src).toContain('upsertGateReclassificationDryRunRecord');
    expect(src).toContain('accumulateGateReclassificationDryRun');
  });

  it('승인 plan은 APPROVED item만 dry-run에 사용한다', () => {
    const src = fs.readFileSync(path.resolve('server/trading/signalScanner/perSymbol/buyListLoop.ts'), 'utf-8');
    expect(src).toContain('loadGateReclassificationApprovalPlan().items');
    expect(src).toContain(".filter((item) => item.status === 'APPROVED')");
  });

  it('KIS order API import 없음 및 live order 생성 없음', () => {
    const dryRunSrc = fs.readFileSync(path.resolve('server/learning/gateReclassificationDryRun.ts'), 'utf-8');
    const repoSrc = fs.readFileSync(path.resolve('server/persistence/gateReclassificationDryRunRepo.ts'), 'utf-8');
    expect(`${dryRunSrc}\n${repoSrc}`).not.toMatch(/placeKisMarketOrder|placeKisSellOrder|kisPost\(/);
    expect(dryRunSrc).not.toMatch(/createLiveOrder:\s*true/);
    expect(dryRunSrc).not.toMatch(/executionImpact:\s*['"]FULL['"]|executionImpact:\s*['"]PARTIAL['"]/);
  });

  it('Gate config / threshold / Kelly 변경 함수나 normalizedGateScore live signal 연결이 없다', () => {
    const dryRunSrc = fs.readFileSync(path.resolve('server/learning/gateReclassificationDryRun.ts'), 'utf-8');
    expect(dryRunSrc).not.toMatch(/setRuntimeThresholdDelta|GATE_SCORE_THRESHOLD_BY_REGIME|positionPct|Kelly|kelly/i);
    expect(dryRunSrc).not.toMatch(/normalizedGateScore.*signalType|signalType.*normalizedGateScore/);
  });
});
