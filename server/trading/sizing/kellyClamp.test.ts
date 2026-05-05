/**
 * @responsibility ADR-0168 Kelly clamp SSOT 회귀 — 상수 + applyKellyClamp + drift 정적 가드
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { KELLY_CAP, KELLY_FLOOR, applyKellyClamp } from './kellyClamp.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '../../..');

describe('ADR-0168 §1 KELLY_CAP / KELLY_FLOOR 상수 SSOT', () => {
  it('KELLY_CAP = 1.5 (POST 부스트 상한)', () => {
    expect(KELLY_CAP).toBe(1.5);
  });

  it('KELLY_FLOOR = 0.15 (누적 패널티 하한)', () => {
    expect(KELLY_FLOOR).toBe(0.15);
  });

  it('FLOOR < CAP — 클램프 범위 무결성', () => {
    expect(KELLY_FLOOR).toBeLessThan(KELLY_CAP);
  });
});

describe('ADR-0168 §2 applyKellyClamp 분기', () => {
  it('정상 범위 통과 — 1.0', () => {
    expect(applyKellyClamp(1.0)).toBe(1.0);
  });

  it('정상 범위 통과 — 0.5', () => {
    expect(applyKellyClamp(0.5)).toBe(0.5);
  });

  it('상한 캡 적용 — 2.0 → 1.5', () => {
    expect(applyKellyClamp(2.0)).toBe(KELLY_CAP);
  });

  it('상한 boundary — 정확히 1.5 통과', () => {
    expect(applyKellyClamp(1.5)).toBe(KELLY_CAP);
  });

  it('상한 boundary 외 — 1.501 → 1.5 캡', () => {
    expect(applyKellyClamp(1.501)).toBe(KELLY_CAP);
  });

  it('하한선 적용 — 0.05 → 0.15', () => {
    expect(applyKellyClamp(0.05)).toBe(KELLY_FLOOR);
  });

  it('하한선 boundary — 정확히 0.15 통과', () => {
    expect(applyKellyClamp(0.15)).toBe(KELLY_FLOOR);
  });

  it('하한선 boundary 외 — 0.149 → 0.15 floor', () => {
    expect(applyKellyClamp(0.149)).toBe(KELLY_FLOOR);
  });

  it('0 → 하한선', () => {
    expect(applyKellyClamp(0)).toBe(KELLY_FLOOR);
  });

  it('음수 → 하한선', () => {
    expect(applyKellyClamp(-1.0)).toBe(KELLY_FLOOR);
  });

  it('NaN 안전 fallback → 하한선', () => {
    expect(applyKellyClamp(NaN)).toBe(KELLY_FLOOR);
  });

  it('Infinity 안전 fallback → 하한선', () => {
    expect(applyKellyClamp(Infinity)).toBe(KELLY_FLOOR);
  });

  it('-Infinity 안전 fallback → 하한선', () => {
    expect(applyKellyClamp(-Infinity)).toBe(KELLY_FLOOR);
  });

  it('byte-equivalent 동작 — Math.min(1.5, Math.max(0.15, x)) 와 정합 (정상)', () => {
    const samples = [0.3, 0.5, 0.7, 1.0, 1.2, 1.4];
    for (const x of samples) {
      expect(applyKellyClamp(x)).toBe(Math.min(1.5, Math.max(0.15, x)));
    }
  });
});

describe('ADR-0168 §3 호출자 정합 정적 가드 — drift 차단', () => {
  function readSrc(rel: string): string {
    return readFileSync(path.join(REPO_ROOT, rel), 'utf-8');
  }

  // ADR-0147b (signalScanner Phase 3 6단계 오케스트레이터 승격, PR #523):
  // signalScanner.ts 본체는 분해 후 orchestrator 역할만 보유. Kelly clamp wiring 은
  // signalScanner/preflight.ts 단일 위치로 이주. 본 회귀 테스트는 preflight 측
  // 존재 단언 + signalScanner.ts 측 부재 단언 (drift 차단) 으로 정합.
  it('signalScanner.ts — applyKellyClamp 직접 import 부재 (분해 후 preflight 단일 사용)', () => {
    const src = readSrc('server/trading/signalScanner.ts');
    expect(src).not.toMatch(/import\s+\{[^}]*\bapplyKellyClamp\b/);
  });

  it('preflight.ts — applyKellyClamp import 보유', () => {
    const src = readSrc('server/trading/signalScanner/preflight.ts');
    expect(src).toMatch(/import\s+\{[^}]*\bapplyKellyClamp\b[^}]*\}\s+from\s+['"]\.\.\/sizing\/kellyClamp\.js['"]/);
  });

  it('signalScanner.ts — kellyMultiplier 직접 산출 부재 (preflight 위임)', () => {
    const src = readSrc('server/trading/signalScanner.ts');
    expect(src).not.toContain('const kellyMultiplier = applyKellyClamp(rawKelly);');
  });

  it('preflight.ts — kellyMultiplier 산출에 applyKellyClamp 사용', () => {
    const src = readSrc('server/trading/signalScanner/preflight.ts');
    expect(src).toContain('const kellyMultiplier = applyKellyClamp(rawKelly);');
  });

  it('signalScanner.ts — 매직 넘버 1.5 직접 clamp 패턴 부재', () => {
    const src = readSrc('server/trading/signalScanner.ts');
    expect(src).not.toMatch(/Math\.min\(\s*1\.5\s*,\s*Math\.max\(\s*KELLY_FLOOR/);
  });

  it('preflight.ts — 매직 넘버 1.5 직접 clamp 패턴 부재', () => {
    const src = readSrc('server/trading/signalScanner/preflight.ts');
    expect(src).not.toMatch(/Math\.min\(\s*1\.5\s*,\s*Math\.max\(\s*KELLY_FLOOR/);
  });

  it('signalScanner.ts — inline KELLY_FLOOR 상수 정의 부재 (SSOT import 만)', () => {
    const src = readSrc('server/trading/signalScanner.ts');
    expect(src).not.toMatch(/^\s*const\s+KELLY_FLOOR\s*=\s*0\.15/m);
  });

  it('preflight.ts — inline KELLY_FLOOR 상수 정의 부재 (SSOT import 만)', () => {
    const src = readSrc('server/trading/signalScanner/preflight.ts');
    expect(src).not.toMatch(/^\s*const\s+KELLY_FLOOR\s*=\s*0\.15/m);
  });

  it('진단 로그 형식 보존 — preflight.ts (KELLY_FLOOR 노출 보존, signalScanner.ts 는 분해 후 진단 로그 부재)', () => {
    const src = readSrc('server/trading/signalScanner/preflight.ts');
    expect(src).toContain('rawKelly < KELLY_FLOOR ? ` → floor ×${KELLY_FLOOR}`');
  });

  it('signalScanner.ts — KELLY_FLOOR 진단 로그 부재 (preflight 단일 위치, drift 차단)', () => {
    const src = readSrc('server/trading/signalScanner.ts');
    expect(src).not.toContain('rawKelly < KELLY_FLOOR ? ` → floor ×${KELLY_FLOOR}`');
  });

  it('ADR-0168 추적 주석 존재 — preflight.ts 또는 signalScanner.ts (분해 후 wiring 단일 위치)', () => {
    // ADR-0147b 분해 후 추적 주석은 preflight.ts (실제 wiring 위치) 또는 signalScanner.ts
    // (barrel) 중 어디에 있어도 통과. drift 추적성 본 검증의 핵심.
    const preflight = readSrc('server/trading/signalScanner/preflight.ts');
    const monolith = readSrc('server/trading/signalScanner.ts');
    expect(/ADR-0168/.test(preflight) || /ADR-0168/.test(monolith)).toBe(true);
  });
});
