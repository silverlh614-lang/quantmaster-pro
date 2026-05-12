/**
 * @responsibility EnemyChecklist/DataQuality 표시 정합성 회귀 테스트
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  buildEnemyCheckItems,
  buildEnemyDataQualitySummary,
  buildPreMortem,
  formatDataQualityBadge,
  formatEnemyCheckSummary,
  type EnemyCheckResult,
} from './enemyCheckClient.js';

const base = (overrides: Partial<EnemyCheckResult> = {}): EnemyCheckResult => ({
  creditRate: null,
  individualDominance: null,
  shortSaleIncreaseRate: null,
  loanIncreaseRate: null,
  creditIncreaseRate: null,
  source: 'KIS_PARTIAL',
  priceMaterialized: true,
  flowMaterialized: false,
  ...overrides,
});

beforeEach(() => {
  process.env.CARD_HIDE_UNMATERIALIZED_ENEMY_ITEMS = 'false';
  process.env.TELEGRAM_HIDE_UNMATERIALIZED_ENEMY_ITEMS = 'false';
  process.env.DATAQUALITY_BADGE_ENABLED = 'true';
});

afterEach(() => {
  delete process.env.CARD_HIDE_UNMATERIALIZED_ENEMY_ITEMS;
  delete process.env.TELEGRAM_HIDE_UNMATERIALIZED_ENEMY_ITEMS;
  delete process.env.DATAQUALITY_BADGE_ENABLED;
});

describe('EnemyCheckItem nullable display', () => {
  it('short materialized=false이면 공매도 증가율은 N/A로 출력된다', () => {
    const summary = formatEnemyCheckSummary(base({ shortSaleIncreaseRate: -100, shortMaterialized: false }));
    expect(summary).toContain('공매도 증가율: N/A');
    expect(summary).not.toContain('공매도 증가율: -100.0%');
  });

  it('short FIELD_MISMATCH_CONFIRMED이면 -100.0%로 출력되지 않는다', () => {
    const summary = formatEnemyCheckSummary(base({ shortSaleIncreaseRate: -100, shortStatus: 'FIELD_MISMATCH_CONFIRMED' }));
    expect(summary).toContain('공매도 증가율: N/A');
    expect(summary).not.toContain('공매도 증가율: -100.0%');
  });

  it('short value null이면 -100.0%로 대체되지 않는다', () => {
    const item = buildEnemyCheckItems(base()).find((x) => x.key === 'shortGrowthPct');
    expect(item?.value).toBeNull();
    expect(item?.displayValue).toBe('N/A');
  });

  it('credit ratio null이면 0.0%가 아니라 N/A로 출력된다', () => {
    const summary = formatEnemyCheckSummary(base({ creditRate: null }));
    expect(summary).toContain('신용잔고율: N/A');
    expect(summary).not.toContain('신용잔고율: 0.0%');
  });

  it('credit ratio 실제 0이면 0.0% 출력이 허용된다', () => {
    const summary = formatEnemyCheckSummary(base({ creditRate: 0, creditStatus: 'OK', creditMaterialized: true }));
    expect(summary).toContain('신용잔고율: 0.0%');
  });

  it('credit materialized=false이면 원천값처럼 보이는 0도 N/A로 출력된다', () => {
    const summary = formatEnemyCheckSummary(base({ creditRate: 0, creditMaterialized: false }));
    expect(summary).toContain('신용잔고율: N/A');
    expect(summary).not.toContain('신용잔고율: 0.0%');
  });

  it('loan materialized=false이면 대차잔고 증가율은 N/A이며 score 미반영이다', () => {
    const item = buildEnemyCheckItems(base({ loanIncreaseRate: 25, loanMaterialized: false })).find((x) => x.key === 'loanBalanceGrowthPct');
    expect(item?.value).toBeNull();
    expect(item?.displayValue).toBe('N/A');
    expect(item?.severity).toBe('INFO');
    expect(item?.usableForScore).toBe(false);
  });

  it('loanBalanceGrowthPct=4.0이면 severity=INFO, usableForScore=false다', () => {
    const item = buildEnemyCheckItems(base({ loanIncreaseRate: 4, loanStatus: 'OK' })).find((x) => x.key === 'loanBalanceGrowthPct');
    expect(item?.displayValue).toBe('+4.0%');
    expect(item?.severity).toBe('INFO');
    expect(item?.usableForScore).toBe(false);
  });

  it('loanBalanceGrowthPct=12.0이면 severity=WARN, usableForScore=true다', () => {
    const item = buildEnemyCheckItems(base({ loanIncreaseRate: 12, loanStatus: 'OK' })).find((x) => x.key === 'loanBalanceGrowthPct');
    expect(item?.severity).toBe('WARN');
    expect(item?.usableForScore).toBe(true);
  });

  it('loanBalanceGrowthPct=25.0이면 severity=BLOCK, usableForScore=true다', () => {
    const item = buildEnemyCheckItems(base({ loanIncreaseRate: 25, loanStatus: 'OK' })).find((x) => x.key === 'loanBalanceGrowthPct');
    expect(item?.severity).toBe('BLOCK');
    expect(item?.usableForScore).toBe(true);
  });
});

describe('Pre-Mortem confidence and score/execution isolation', () => {
  it('AI 생성이고 데이터 근거가 없으면 LOW 및 execution/score false다', () => {
    const pm = buildPreMortem({ lines: ['수급 악화 가능성'], enemyCheck: base() });
    expect(pm.source).toBe('AI_GENERATED_HYPOTHESIS');
    expect(pm.confidence).toBe('LOW');
    expect(pm.usableForExecution).toBe(false);
    expect(pm.usableForScore).toBe(false);
  });

  it('materialized된 실제 기관 순매도 또는 대차 급증이 있으면 DATA_DRIVEN으로 승격 가능하다', () => {
    const byInstitution = buildPreMortem({ lines: ['기관 순매도 확인'], institutionNetSellMaterialized: true });
    const byLoan = buildPreMortem({ lines: ['대차 급증'], enemyCheck: base({ loanIncreaseRate: 25, loanStatus: 'OK', loanMaterialized: true }) });
    expect(byInstitution.source).toBe('DATA_DRIVEN');
    expect(byLoan.source).toBe('DATA_DRIVEN');
    expect(byLoan.usableForScore).toBe(true);
    expect(byLoan.usableForExecution).toBe(false);
  });
});

describe('DataQuality badge', () => {
  it('FLOW/SHORT materialized=false이면 N/A, PRICE OK이면 OK로 표시된다', () => {
    const dq = buildEnemyDataQualitySummary(base({ priceMaterialized: true, flowMaterialized: false, individualDominance: 70, shortSaleIncreaseRate: 31, shortMaterialized: false }));
    expect(dq.FLOW).toBe('N/A');
    expect(dq.SHORT).toBe('N/A');
    expect(dq.PRICE).toBe('OK');
    expect(dq.executionImpact).toBe('NONE');
    expect(formatDataQualityBadge(dq)).toContain('PRICE=OK / FLOW=N/A / SHORT=N/A');
  });
});
