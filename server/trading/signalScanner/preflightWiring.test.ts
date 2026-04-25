/**
 * @responsibility PR-42 M3 — signalScanner inline 헬퍼 → preflight 단일 SSOT 회귀 가드
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import * as preflight from './preflight.js';

describe('signalScanner ↔ preflight 단일 SSOT (PR-42 M3)', () => {
  it('preflight.evaluateSellOnlyException export 존재', () => {
    expect(typeof preflight.evaluateSellOnlyException).toBe('function');
  });

  it('preflight.getAccountScaleKellyMultiplier export 존재', () => {
    expect(typeof preflight.getAccountScaleKellyMultiplier).toBe('function');
  });

  it('signalScanner.ts 본체는 inline 정의 미보유 (drift 차단)', () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, '..', 'signalScanner.ts'),
      'utf-8',
    );
    // inline 함수/타입 시그니처가 다시 들어오면 즉시 실패.
    expect(src).not.toMatch(/^function\s+evaluateSellOnlyException\s*\(/m);
    expect(src).not.toMatch(/^function\s+getAccountScaleKellyMultiplier\s*\(/m);
    expect(src).not.toMatch(/^interface\s+SellOnlyExceptionDecision\b/m);
    // import 는 반드시 preflight 에서.
    expect(src).toContain("from './signalScanner/preflight.js'");
  });

  it('getAccountScaleKellyMultiplier — 계좌 규모 별 정확한 배수', () => {
    expect(preflight.getAccountScaleKellyMultiplier(500_000_000)).toBe(1.15);
    expect(preflight.getAccountScaleKellyMultiplier(300_000_000)).toBe(1.15);
    expect(preflight.getAccountScaleKellyMultiplier(150_000_000)).toBe(1.08);
    expect(preflight.getAccountScaleKellyMultiplier(100_000_000)).toBe(1.08);
    expect(preflight.getAccountScaleKellyMultiplier(50_000_000)).toBe(1.0);
    expect(preflight.getAccountScaleKellyMultiplier(20_000_000)).toBe(0.92);
    expect(preflight.getAccountScaleKellyMultiplier(5_000_000)).toBe(0.92);
  });

  it('evaluateSellOnlyException — sellOnlyException disabled 시 allow=false', () => {
    const cfg = { sellOnlyException: { enabled: false } } as any;
    const r = preflight.evaluateSellOnlyException(cfg, null);
    expect(r.allow).toBe(false);
    expect(r.reason).toBe('disabled');
  });

  it('evaluateSellOnlyException — VIX 임계 초과 시 allow=false', () => {
    const cfg = {
      sellOnlyException: {
        enabled: true, maxVix: 25, maxSlots: 2, kellyFactor: 0.3, minLiveGate: 9, minMtas: 8,
      },
    } as any;
    const macro = { vix: 30 } as any;
    const r = preflight.evaluateSellOnlyException(cfg, macro);
    expect(r.allow).toBe(false);
    expect(r.reason).toContain('VIX 30 ≥ 25');
  });

  it('evaluateSellOnlyException — sectorAligned 통과 시 allow=true', () => {
    const cfg = {
      sellOnlyException: {
        enabled: true, maxVix: 25, maxSlots: 2, kellyFactor: 0.3, minLiveGate: 9, minMtas: 8,
      },
    } as any;
    const macro = { vix: 18, leadingSectorRS: 70, sectorCycleStage: 'EARLY' } as any;
    const r = preflight.evaluateSellOnlyException(cfg, macro);
    expect(r.allow).toBe(true);
    expect(r.maxSlots).toBe(2);
    expect(r.kellyFactor).toBe(0.3);
  });
});
