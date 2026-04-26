/**
 * @responsibility rrrGate 단위 테스트 — RRR 임계 분기 + 부수효과 키
 */

import { describe, it, expect } from 'vitest';
import { rrrGate } from '../rrrGate.js';
import { RRR_MIN_THRESHOLD } from '../../../riskManager.js';
import { makeMockCtx, makeMockStock } from './_testHelpers.js';

describe('rrrGate', () => {
  it('정상 RRR (>임계) → pass=true (entry=100, target=120, stop=90 → RRR=2.0)', async () => {
    const r = await rrrGate(makeMockCtx({ stock: makeMockStock({ entryPrice: 100, targetPrice: 120, stopLoss: 90 }) }));
    expect(r.pass).toBe(true);
  });

  it('RRR 미달 → pass=false + 부수효과 명시', async () => {
    // RRR_MIN_THRESHOLD 보다 낮은 시나리오: target=105, stop=95, entry=100 → RRR=0.5
    const stock = makeMockStock({ entryPrice: 100, targetPrice: 105, stopLoss: 95 });
    const r = await rrrGate(makeMockCtx({ stock }));
    expect(r.pass).toBe(false);
    if (!r.pass) {
      expect(r.logMessage).toContain('RRR');
      expect(r.logMessage).toContain('진입 제외');
      expect(r.counter).toBe('rrrMisses');
      expect(r.pushTrace).toBe(true);
      expect(r.stageLog?.key).toBe('rrr');
      expect(r.stageLog?.value).toContain('FAIL');
    }
  });

  it('정확히 임계값 — pass=true (>= 임계는 통과)', async () => {
    // target = entry + RRR_MIN_THRESHOLD * (entry - stop) → RRR 정확히 임계
    const stop = 90;
    const entry = 100;
    const target = entry + RRR_MIN_THRESHOLD * (entry - stop);
    const stock = makeMockStock({ entryPrice: entry, targetPrice: target, stopLoss: stop });
    const r = await rrrGate(makeMockCtx({ stock }));
    expect(r.pass).toBe(true);
  });

  it('logMessage 에 임계값 + 종목명 + 코드 + RRR 값 포함', async () => {
    const stock = makeMockStock({
      code: '000660', name: 'SK하이닉스',
      entryPrice: 100, targetPrice: 105, stopLoss: 95,
    });
    const r = await rrrGate(makeMockCtx({ stock }));
    if (!r.pass) {
      expect(r.logMessage).toContain('SK하이닉스');
      expect(r.logMessage).toContain('000660');
      expect(r.logMessage).toContain(RRR_MIN_THRESHOLD.toString());
    }
  });

  it('차단 시 stageLog.value 에 RRR 수치 + 임계 둘 다 노출', async () => {
    const stock = makeMockStock({ entryPrice: 100, targetPrice: 105, stopLoss: 95 });
    const r = await rrrGate(makeMockCtx({ stock }));
    if (!r.pass) {
      // 'FAIL(0.50 < 1.5)' 같은 형식
      expect(r.stageLog?.value).toMatch(/FAIL\(\d+\.\d+ < \d+(\.\d+)?\)/);
    }
  });
});
