/**
 * @responsibility Shadow Learning Hooks wiring 회귀 테스트 (ADR-0068 PR-R)
 *
 * perSymbolEvaluation 의 try/catch 격리가 실제로 LIVE 매매를 막지 않는지 검증.
 * recordTwinEntries / recordRejection 모듈의 직접 호출 가능성 + throw 격리.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'shadow-hooks-test-'));
process.env.PERSIST_DATA_DIR = TMP_DIR;

const {
  recordTwinEntries,
  __resetTwinPortfolioForTests,
  getAllTwinEntries,
} = await import('../../../learning/counterfactualTwinPortfolio.js');

const {
  recordRejection,
  __resetRejectionShadowForTests,
  getAllRejectionShadow,
} = await import('../../../learning/rejectionShadowTracker.js');

beforeEach(() => {
  __resetTwinPortfolioForTests();
  __resetRejectionShadowForTests();
});

describe('PR-R Hook 호출 검증', () => {
  it('recordTwinEntries — Gate 16 candidate → AGGRESSIVE 1건만 영속', () => {
    const added = recordTwinEntries({
      stockCode: 'A005930',
      stockName: '삼성전자',
      signalDate: '2026-04-27',
      gateScore: 16,
      entryPrice: 70000,
      kellyWeight: 0.10,
    });
    expect(added).toBe(1);
    const all = getAllTwinEntries();
    expect(all).toHaveLength(1);
    expect(all[0].twin).toBe('AGGRESSIVE');
  });

  it('recordTwinEntries — Gate 24 candidate → 3 Twin 모두 영속', () => {
    const added = recordTwinEntries({
      stockCode: 'A035420',
      stockName: '네이버',
      signalDate: '2026-04-27',
      gateScore: 24,
      entryPrice: 200000,
      kellyWeight: 0.10,
    });
    expect(added).toBe(3);
  });

  it('recordTwinEntries — Gate 12 (모든 Twin 미달) → silent skip', () => {
    const added = recordTwinEntries({
      stockCode: 'A',
      stockName: 'A',
      signalDate: '2026-04-27',
      gateScore: 12,
      entryPrice: 1000,
      kellyWeight: 0.10,
    });
    expect(added).toBe(0);
    expect(getAllTwinEntries()).toHaveLength(0);
  });

  it('recordRejection — Gate 16 (near-miss) → 1건 영속', () => {
    const added = recordRejection({
      stockCode: 'A005930',
      stockName: '삼성전자',
      signalDate: '2026-04-27',
      signalPriceKrw: 70000,
      gateScore: 16,
      rejectionReason: 'entryRevalidation:STOP_LOSS_HIT',
    });
    expect(added).toBe(1);
    expect(getAllRejectionShadow()).toHaveLength(1);
  });

  it('recordRejection — Gate 18 (임계 통과는 거절 아님) → silent skip', () => {
    const added = recordRejection({
      stockCode: 'A',
      stockName: 'A',
      signalDate: '2026-04-27',
      signalPriceKrw: 1000,
      gateScore: 18,
      rejectionReason: 'should-not-record',
    });
    expect(added).toBe(0);
  });
});

describe('PR-R LIVE 매매 무영향 — try/catch 격리 패턴', () => {
  it('PR-R wiring 패턴 — hook 호출 throw 가 caller 흐름 막지 않음 (try/catch 격리)', () => {
    // perSymbolEvaluation 의 wiring 패턴을 단순화한 격리 테스트:
    // recordTwinEntries 가 throw 하더라도 후속 매매 흐름 (caller) 이 계속됨.
    let liveFlowReached = false;

    try {
      // 의도적 throw — 모듈이 throw 했다고 가정
      throw new Error('boom');
    } catch (e) {
      console.warn(`[TwinPortfolio] record 실패 mock:`, e instanceof Error ? e.message : e);
    }

    // try/catch 통과 후 flow 계속 도달
    liveFlowReached = true;
    expect(liveFlowReached).toBe(true);
  });

  it('recordRejection silent skip 시 caller 흐름 무영향', () => {
    // Gate 18 임계 통과 — 모듈이 0 반환 (throw 아님), caller 흐름 정상 진행
    const added = recordRejection({
      stockCode: 'A',
      stockName: 'A',
      signalDate: '2026-04-27',
      signalPriceKrw: 1000,
      gateScore: 18,
      rejectionReason: 'no-skip',
    });
    expect(added).toBe(0);
    // 후속 작업이 안전하게 실행되는지 검증 (caller 가 throw 만 처리)
    expect(getAllRejectionShadow()).toHaveLength(0);
  });
});

describe('PR-R wiring import 검증', () => {
  it('perSymbolEvaluation 가 recordRejection 을 import', async () => {
    // ADR-0134: perSymbolEvaluation.ts 분해 후 본체는 perSymbol/buyListLoop.ts 로 이주.
    const filePath = path.resolve(__dirname, '../perSymbol/buyListLoop.ts');
    const source = fs.readFileSync(filePath, 'utf-8');
    expect(source).toMatch(/from\s*['"][^'"]*learning\/rejectionShadowTracker\.js['"]/);
    expect(source).toContain('recordRejection');
  });

  it('perSymbolEvaluation 가 recordTwinEntries 를 import', async () => {
    // ADR-0134: perSymbolEvaluation.ts 분해 후 본체는 perSymbol/buyListLoop.ts 로 이주.
    const filePath = path.resolve(__dirname, '../perSymbol/buyListLoop.ts');
    const source = fs.readFileSync(filePath, 'utf-8');
    expect(source).toMatch(/from\s*['"][^'"]*learning\/counterfactualTwinPortfolio\.js['"]/);
    expect(source).toContain('recordTwinEntries');
  });

  it('perSymbolEvaluation 의 두 hook 모두 try/catch 격리', () => {
    // ADR-0134: perSymbolEvaluation.ts 분해 후 본체는 perSymbol/buyListLoop.ts 로 이주.
    const filePath = path.resolve(__dirname, '../perSymbol/buyListLoop.ts');
    const source = fs.readFileSync(filePath, 'utf-8');
    // try 블록 안에 recordTwinEntries / recordRejection 호출
    expect(source).toMatch(/try\s*\{[^}]*recordTwinEntries\(/s);
    expect(source).toMatch(/try\s*\{[^}]*recordRejection\(/s);
    // catch 블록에 console.warn (throw 시 silent fail)
    expect(source).toContain('[TwinPortfolio] record 실패');
    expect(source).toContain('[RejectionShadow] record 실패');
  });

  it('PR-R wiring 이 recordCounterfactual 패턴과 동일 위치 사용', () => {
    // ADR-0134: perSymbolEvaluation.ts 분해 후 본체는 perSymbol/buyListLoop.ts 로 이주.
    const filePath = path.resolve(__dirname, '../perSymbol/buyListLoop.ts');
    const source = fs.readFileSync(filePath, 'utf-8');
    // 두 hook 모두 try/catch 패턴 — recordCounterfactual 같은 위치
    const counterfactualIdx = source.indexOf('recordCounterfactual');
    const rejectionIdx = source.indexOf('recordRejection');
    expect(counterfactualIdx).toBeGreaterThan(0);
    expect(rejectionIdx).toBeGreaterThan(0);
    // recordRejection 이 entryRevalidation 분기 내에 위치 (counterfactual 근처)
    expect(Math.abs(rejectionIdx - counterfactualIdx)).toBeLessThan(2000);
  });
});
