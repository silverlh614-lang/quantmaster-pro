/**
 * @responsibility check_decision_log_correlation 회귀 테스트 (ADR-0528 §Decision.4)
 *
 * 검증:
 *   (i)   상관 필드 누락 fixture → R2 fail
 *   (ii)  헬퍼(logDecisionEvent) 경유 완비 fixture → pass
 *   (iii) /* DECISION-LOG-IGNORE: <사유> *​/ 주석(allowlist) → pass, 빈 사유 → R0 fail
 *   (iv)  5-event 체인 태그 1개 제거 → R3 fail
 *   (v)   실제 repo 가드 EXIT 0 (현 stamp 완결 증명)
 */
import { describe, it, expect } from 'vitest';
import { execSync } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import {
  checkSource,
  checkChainCompleteness,
  SHADOW_LIFECYCLE_TAGS,
} from './check_decision_log_correlation.js';

const __filename = fileURLToPath(import.meta.url);
const ROOT = join(dirname(__filename), '..');

describe('check_decision_log_correlation guard rules', () => {
  it('(i) fails R2 when a core decision log omits sourceSnapshotId/symbol', () => {
    // 태그는 stamp 됐으나 상관 필드(sourceSnapshotId/symbol)가 블록 안에 없음.
    const src = [
      "console.log([",
      "  '[SHADOW_ORDER_CREATED]',",
      "  'decisionStage=SHADOW_ORDER_CREATED',",
      "  kv('shadowOrderId', order.shadowOrderId),",
      "].join(' '));",
    ].join('\n');
    const { violations } = checkSource(src, 'fixture.ts');
    const rules = violations.map((v) => v.rule);
    expect(rules).toContain('R2');
  });

  it('(ii) passes when correlation fields are stamped near the decision log', () => {
    const src = [
      "console.log([",
      "  '[SHADOW_ORDER_CREATED]',",
      "  'decisionStage=SHADOW_ORDER_CREATED',",
      "  kv('sourceSnapshotId', sourceSnapshotId),",
      "  kv('symbol', order.symbol),",
      "].join(' '));",
    ].join('\n');
    const { violations } = checkSource(src, 'fixture.ts');
    expect(violations).toHaveLength(0);
  });

  it('(ii-helper) passes when routed through logDecisionEvent helper', () => {
    const src = [
      "logDecisionEvent('POSITION_POLICY', {",
      "  sourceSnapshotId: ctx.sourceSnapshotId ?? 'NA',",
      "  decisionStage: 'POSITION_POLICY',",
      "  symbol: stock.code,",
      "}, { policy: 'simple position policy' });",
    ].join('\n');
    const { violations } = checkSource(src, 'fixture.ts');
    expect(violations).toHaveLength(0);
  });

  it('(iii) allowlist comment with reason suppresses the violation', () => {
    // 태그를 가진 부수 진단 라인이지만 사유 명시 → 제외.
    const src = [
      "console.log('[SHADOW_ORDER_CREATED] diag-only'); /* DECISION-LOG-IGNORE: 부수 진단 로그 */",
    ].join('\n');
    const { violations } = checkSource(src, 'fixture.ts');
    expect(violations).toHaveLength(0);
  });

  it('(iii-empty) empty-reason ignore comment is rejected (silent skip 차단)', () => {
    const src = [
      "console.log('[SHADOW_ORDER_CREATED] diag-only'); /* DECISION-LOG-IGNORE: */",
    ].join('\n');
    const { violations } = checkSource(src, 'fixture.ts');
    expect(violations.some((v) => v.rule === 'R0')).toBe(true);
  });

  it('(iv) flags R3 when a shadow lifecycle tag is missing from emit set', () => {
    const present = new Set(
      SHADOW_LIFECYCLE_TAGS.slice(0, 4).map((t) => t.replace(/[[\]]/g, '')),
    );
    const missing = checkChainCompleteness(present);
    expect(missing).toEqual(['[PAPER_TRADE_LEDGER_RECORDED]']);
  });

  it('(iv-complete) no R3 when all 5 chain tags present', () => {
    const all = new Set(SHADOW_LIFECYCLE_TAGS.map((t) => t.replace(/[[\]]/g, '')));
    expect(checkChainCompleteness(all)).toHaveLength(0);
  });

  it('(R4) flags proxy snapshotId used as sourceSnapshotId in position log', () => {
    const src = [
      "console.log([",
      "  '[POSITION_POLICY_SIMPLE_APPLIED]',",
      "  'decisionStage=POSITION_POLICY',",
      "  `sourceSnapshotId=buyList:${stock.code}`,",
      "  `symbol=${stock.code}`,",
      "].join(' '));",
    ].join('\n');
    const { violations } = checkSource(src, 'fixture.ts');
    expect(violations.some((v) => v.rule === 'R4')).toBe(true);
  });

  it('(v) current repo passes the guard (stamp 완결 증명)', () => {
    let exitCode = 0;
    try {
      execSync('node scripts/check_decision_log_correlation.js', {
        cwd: ROOT,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (err) {
      exitCode = err.status ?? 1;
    }
    expect(exitCode).toBe(0);
  });
});
