// @responsibility ADR-0417 Phase 2 — postmortem action taxonomy split + unavailable/error/trueFail 분모 분리 회귀
/**
 * ADR-0417 (2026-05-07, Phase 2):
 *   기존 `LOOSEN_GATE` 위험 권고를 `REVIEW_GATE_THRESHOLD` 로 rename + `CHECK_DATA_SOURCE`
 *   / `PATCH_EVALUATOR` 액션 분리. 분모를 분리하여 데이터 결손 / evaluator 결함 /
 *   진짜 임계 미달을 구분 — 데이터 결손 우세 시 절대 Gate 완화 권고 금지.
 *
 * 핵심 불변식 (사용자 명시 절대 변경 금지):
 *   - REVIEW_GATE_THRESHOLD 는 trueFailRate > 0.95 AND unavailableRate ≤ 0.5 AND
 *     errorRate ≤ 0.3 인 경우에만 허용.
 *   - DATA_UNAVAILABLE 우세 시 → CHECK_DATA_SOURCE.
 *   - ERROR 우세 시 → PATCH_EVALUATOR.
 *   - 신규 postmortem 출력에 `LOOSEN_GATE` 문자열 등장 금지.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  deriveActionsByRates,
  type PostmortemAction,
} from './emptyScanPostmortem.js';

// ── 격리된 영속 디렉토리 — gateAuditRepo._auditCache 모듈 캐시 격리 ────────
let _tmpDataDir: string | null = null;

beforeEach(() => {
  _tmpDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adr0417-'));
  process.env.PERSIST_DATA_DIR = _tmpDataDir;
  vi.resetModules();
});

afterEach(() => {
  delete process.env.PERSIST_DATA_DIR;
  if (_tmpDataDir && fs.existsSync(_tmpDataDir)) {
    fs.rmSync(_tmpDataDir, { recursive: true, force: true });
  }
  _tmpDataDir = null;
});

// ─── Test 1: deriveActionsByRates SSOT 결정 트리 ─────────────────────────────
describe('deriveActionsByRates SSOT (ADR-0417)', () => {
  it('unavailableRate > 0.5 → CHECK_DATA_SOURCE 포함', () => {
    // passed=10, failed=5, unavailable=30, error=0 → total=45
    // unavailableRate=30/45≈0.67 (> 0.5) / errorRate=0 / trueFailRate=5/15≈0.33
    const actions = deriveActionsByRates({
      unavailableRate: 0.67,
      errorRate: 0,
      trueFailRate: 0.33,
    });
    expect(actions).toContain('CHECK_DATA_SOURCE');
    expect(actions).not.toContain('REVIEW_GATE_THRESHOLD');
  });

  it('errorRate > 0.3 → PATCH_EVALUATOR 포함', () => {
    // passed=10, failed=5, unavailable=0, error=10 → total=25
    // errorRate=10/25=0.4 (> 0.3) / unavailableRate=0 / trueFailRate=5/15≈0.33
    const actions = deriveActionsByRates({
      unavailableRate: 0,
      errorRate: 0.4,
      trueFailRate: 0.33,
    });
    expect(actions).toContain('PATCH_EVALUATOR');
    expect(actions).not.toContain('REVIEW_GATE_THRESHOLD');
  });

  it('trueFailRate > 0.95 + unavailable/error 낮음 → REVIEW_GATE_THRESHOLD', () => {
    // passed=1, failed=99, unavailable=0, error=0 → trueFailRate=99/100=0.99
    const actions = deriveActionsByRates({
      unavailableRate: 0,
      errorRate: 0,
      trueFailRate: 0.99,
    });
    expect(actions).toContain('REVIEW_GATE_THRESHOLD');
    expect(actions).not.toContain('CHECK_DATA_SOURCE');
    expect(actions).not.toContain('PATCH_EVALUATOR');
  });

  it('🚨 핵심 불변식 — unavailable 우세 시 trueFailRate 도 높아도 REVIEW_GATE_THRESHOLD 금지', () => {
    // passed=1, failed=99, unavailable=200, error=0
    // → trueFailRate=99/100=0.99 (HIGH)
    // → unavailableRate=200/300≈0.67 (> 0.5)
    // 사용자 명시: 데이터 부재가 우세하면 Gate 완화 절대 금지.
    const actions = deriveActionsByRates({
      unavailableRate: 0.67,
      errorRate: 0,
      trueFailRate: 0.99,
    });
    expect(actions).toContain('CHECK_DATA_SOURCE');
    expect(actions).not.toContain('REVIEW_GATE_THRESHOLD'); // 핵심 불변식
  });

  it('error 우세 + trueFailRate 높음 → PATCH_EVALUATOR 우선, REVIEW_GATE_THRESHOLD 금지', () => {
    const actions = deriveActionsByRates({
      unavailableRate: 0.1,
      errorRate: 0.4,
      trueFailRate: 0.99,
    });
    expect(actions).toContain('PATCH_EVALUATOR');
    expect(actions).not.toContain('REVIEW_GATE_THRESHOLD');
  });

  it('복합 장애 — unavailable 우세 + error 우세 → 두 액션 모두 추가', () => {
    const actions = deriveActionsByRates({
      unavailableRate: 0.67,
      errorRate: 0.4,
      trueFailRate: 0.99,
    });
    expect(actions).toContain('CHECK_DATA_SOURCE');
    expect(actions).toContain('PATCH_EVALUATOR');
    expect(actions).not.toContain('REVIEW_GATE_THRESHOLD');
  });

  it('boundary — unavailableRate=0.5 정확 → CHECK_DATA_SOURCE 미발화 (> 0.5 만 트리거)', () => {
    const actions = deriveActionsByRates({
      unavailableRate: 0.5,
      errorRate: 0,
      trueFailRate: 0.99,
    });
    expect(actions).not.toContain('CHECK_DATA_SOURCE');
    expect(actions).toContain('REVIEW_GATE_THRESHOLD'); // unavailable ≤ 0.5 정확 boundary
  });

  it('boundary — trueFailRate=0.95 정확 → REVIEW_GATE_THRESHOLD 미발화 (> 0.95 만)', () => {
    const actions = deriveActionsByRates({
      unavailableRate: 0,
      errorRate: 0,
      trueFailRate: 0.95,
    });
    expect(actions).not.toContain('REVIEW_GATE_THRESHOLD');
  });

  it('정상 운영 (모두 낮음) → 빈 배열', () => {
    const actions = deriveActionsByRates({
      unavailableRate: 0.1,
      errorRate: 0.05,
      trueFailRate: 0.5,
    });
    expect(actions).toEqual([]);
  });
});

// ─── Test 2: runPostmortem 통합 — recommendedActions 배열 + reason 메시지 ───
describe('runPostmortem — recommendedActions 통합 + LOOSEN_GATE 제거 (ADR-0417)', () => {
  async function setupAuditAndRunPostmortem(
    audit: Record<string, { passed: number; failed: number; unavailable?: number; error?: number }>,
    options: { riskOnRegime?: boolean; gateFailRatio?: number } = {},
  ) {
    // 직접 audit store 를 영속 파일에 기록 → loadGateAudit 가 그대로 read.
    const { saveGateAudit } = await import('../persistence/gateAuditRepo.js');
    saveGateAudit(audit);

    // regime 모킹 — RISK_ON 으로 강제하여 PATHOLOGICAL_BLOCK 분기 진입.
    vi.doMock('../trading/regimeBridge.js', () => ({
      getLiveRegime: () => (options.riskOnRegime !== false ? 'R2_BULL' : 'R5_CAUTION'),
    }));
    vi.doMock('../persistence/macroStateRepo.js', () => ({
      loadMacroState: () => null,
    }));

    // scanTracer 모킹 — 100 종목 스캔, 96건 gate FAIL (gateFailRatio=0.96 > 0.95).
    const tracesAll = Array.from({ length: 100 }, (_, i) => ({
      symbol: `0000${i.toString().padStart(2, '0')}`,
      stockName: 'TEST',
      timestamp: new Date().toISOString(),
      stages: i < 96 ? { gate: 'FAIL(test)' } : { buy: 'SHADOW' },
    }));
    vi.doMock('../trading/scanTracer.js', () => ({
      loadTodayScanTraces: () => tracesAll,
    }));

    const { runPostmortem } = await import('./emptyScanPostmortem.js');
    return runPostmortem();
  }

  it('🚨 핵심 회귀 — 데이터 부재 우세 시 REVIEW_GATE_THRESHOLD 절대 미권고', async () => {
    // passed=1, failed=99, unavailable=200, error=0 — trueFailRate 99% 인데 unavailable 우세.
    const report = await setupAuditAndRunPostmortem({
      supply_confluence: { passed: 1, failed: 99, unavailable: 200, error: 0 },
    });
    expect(report.recommendedActions).toContain('CHECK_DATA_SOURCE');
    expect(report.recommendedActions).not.toContain('REVIEW_GATE_THRESHOLD');
    expect(report.recommendedActions).not.toContain('LOOSEN_GATE');
    expect(report.recommendedAction).toBe(report.recommendedActions[0]);
  });

  it('데이터·evaluator 정상 + 진짜 임계 미달 우세 → REVIEW_GATE_THRESHOLD 허용', async () => {
    const report = await setupAuditAndRunPostmortem({
      momentum: { passed: 1, failed: 99, unavailable: 0, error: 0 },
    });
    expect(report.recommendedActions).toContain('REVIEW_GATE_THRESHOLD');
    expect(report.recommendedActions).not.toContain('LOOSEN_GATE');
  });

  it('evaluator 결함 우세 → PATCH_EVALUATOR 권고 + REVIEW_GATE_THRESHOLD 미권고', async () => {
    // passed=10, failed=5, error=10 → errorRate=10/25=0.4 (> 0.3)
    const report = await setupAuditAndRunPostmortem({
      per: { passed: 10, failed: 5, unavailable: 0, error: 10 },
    });
    expect(report.recommendedActions).toContain('PATCH_EVALUATOR');
    expect(report.recommendedActions).not.toContain('REVIEW_GATE_THRESHOLD');
  });

  it('LOOSEN_GATE 문자열이 신규 postmortem 출력에 등장 0건', async () => {
    const report = await setupAuditAndRunPostmortem({
      momentum: { passed: 1, failed: 99 },
    });
    // recommendedActions / reason 메시지에 LOOSEN_GATE 문자열 등장 금지.
    expect(report.recommendedActions.join(' ')).not.toContain('LOOSEN_GATE');
    expect(report.reason).not.toContain('LOOSEN_GATE');
    expect(report.reason).not.toContain('즉시 Gate 완화');
    expect(report.reason).not.toContain('threshold 낮추기');
  });

  it('metrics.unavailableRate / errorRate / trueFailRate 분리 분모 보고', async () => {
    const report = await setupAuditAndRunPostmortem({
      per: { passed: 10, failed: 5, unavailable: 30, error: 0 },
    });
    // unavailableRate = 30 / (10+5+30+0) = 30/45 ≈ 0.667
    expect(report.metrics.unavailableRate).toBeCloseTo(30 / 45, 3);
    // errorRate = 0
    expect(report.metrics.errorRate).toBe(0);
    // trueFailRate = failed / (passed + failed) = 5 / 15 ≈ 0.333 (분모에 unavailable 제외)
    expect(report.metrics.trueFailRate).toBeCloseTo(5 / 15, 3);
  });

  it('topTrueFailCondition 분모 정합 — unavailable + error 분모 제외', async () => {
    const report = await setupAuditAndRunPostmortem({
      // momentum: 데이터 정상 + 진짜 임계 미달 우세 (trueFailRate=99/100)
      momentum: { passed: 1, failed: 99, unavailable: 0, error: 0 },
      // supply_confluence: 데이터 결손 우세 (legacy failRate 가 높지만 trueFailRate 는 낮음)
      supply_confluence: { passed: 0, failed: 0, unavailable: 100, error: 0 },
    });
    // trueFailRate top 은 momentum (99/100=0.99) — supply_confluence 는 evaluatedTotal=0 으로 미참여.
    expect(report.topTrueFailCondition).toBe('momentum');
    expect(report.topTrueFailRate).toBeCloseTo(0.99, 2);
  });
});

// ─── Test 3: 정적 grep 가드 — 신규 출력 LOOSEN_GATE 등장 금지 ───────────────
describe('LOOSEN_GATE 신규 출력 금지 정적 가드 (ADR-0417)', () => {
  it('emptyScanPostmortem.ts 본체 — runPostmortem 결정 트리에서 LOOSEN_GATE 미발화', () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, './emptyScanPostmortem.ts'),
      'utf-8',
    );
    // 신규 PostmortemAction 도입 + 위험 메시지 영구 차단.
    expect(src).toContain('REVIEW_GATE_THRESHOLD');
    expect(src).toContain('CHECK_DATA_SOURCE');
    expect(src).toContain('PATCH_EVALUATOR');
    expect(src).toContain('ADR-0417');

    // 결정 트리 안 (`primaryAction = ` 또는 `action = ` 할당)에서 LOOSEN_GATE 미발화.
    // (legacy union 의 alias 정의 자체는 후방호환이라 허용.)
    expect(src).not.toMatch(/primaryAction\s*=\s*['"]LOOSEN_GATE['"]/);
    // 메시지 안 위험 문구 차단.
    expect(src).not.toMatch(/즉시 Gate 완화/);
    expect(src).not.toMatch(/threshold 낮추기 권장/);
  });

  it('adaptiveScanScheduler.ts — recommendedActions 사용 (recommendedAction 단독 미사용)', () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, './adaptiveScanScheduler.ts'),
      'utf-8',
    );
    expect(src).toContain('recommendedActions');
    expect(src).toMatch(/postmortem\.recommendedActions\.join/);
    // ADR-0417 분리 분모 표시 의무.
    expect(src).toMatch(/trueFailRate/);
    expect(src).toMatch(/unavailableRate/);
    expect(src).toMatch(/errorRate/);
  });
});

// ─── Test 4: PostmortemAction union 정합 ────────────────────────────────────
describe('PostmortemAction union (ADR-0417)', () => {
  it('ADR-0417 5 신규 액션 모두 deriveActionsByRates 결과에 등장 가능', () => {
    // CHECK_DATA_SOURCE
    expect(deriveActionsByRates({ unavailableRate: 0.6, errorRate: 0, trueFailRate: 0 }))
      .toContain('CHECK_DATA_SOURCE');
    // PATCH_EVALUATOR
    expect(deriveActionsByRates({ unavailableRate: 0, errorRate: 0.4, trueFailRate: 0 }))
      .toContain('PATCH_EVALUATOR');
    // REVIEW_GATE_THRESHOLD
    expect(deriveActionsByRates({ unavailableRate: 0, errorRate: 0, trueFailRate: 0.99 }))
      .toContain('REVIEW_GATE_THRESHOLD');
  });

  it('PostmortemAction 7 정식값 + 2 legacy alias 타입 호환', () => {
    // 컴파일 시점 검증 — 모든 값이 PostmortemAction 으로 할당 가능해야 함.
    const okValues: PostmortemAction[] = [
      'HOLD_AND_WAIT',
      'CHECK_DATA_SOURCE',
      'PATCH_EVALUATOR',
      'REVIEW_GATE_THRESHOLD',
      'INSPECT_MARKET_REGIME',
      'INSPECT_CANDIDATES',
      'NO_ACTION',
      'LOOSEN_GATE', // legacy alias (후방호환)
      'NONE',         // legacy alias
    ];
    expect(okValues.length).toBe(9);
  });
});
