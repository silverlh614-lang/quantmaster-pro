/**
 * @responsibility resolveGeminiOpts SSOT 회귀 테스트 — maxOutputTokens 절삭 방지 (ADR-0058)
 *
 * 사용자 보고 [글로벌 스캔 06:00] "**주" 에서 잘림 — Gemini 응답이 default 2048 token
 * 한도로 절삭된 케이스. callGemini opts.maxOutputTokens 가 4096 등 상향 가능한지 검증.
 *
 * callGemini 본체는 callGeminiText 내부 위임 — ESM 모듈 내부 호출은 vi.mock partial 가
 * 안 닿으므로 opts 처리 SSOT 인 resolveGeminiOpts 만 단위 테스트.
 */
import { describe, expect, it } from 'vitest';
import { resolveGeminiOpts } from './geminiClient.js';

describe('resolveGeminiOpts — opts 처리 SSOT (ADR-0058)', () => {
  it('opts 미전달 시 default maxOutputTokens=2048 / temperature=0.4 (회귀 안전)', () => {
    const r = resolveGeminiOpts();
    expect(r.maxOutputTokens).toBe(2048);
    expect(r.temperature).toBe(0.4);
  });

  it('opts={} 빈 객체 시 default 적용', () => {
    const r = resolveGeminiOpts({});
    expect(r.maxOutputTokens).toBe(2048);
    expect(r.temperature).toBe(0.4);
  });

  it('opts.maxOutputTokens=4096 전달 시 적용 (글로벌 스캔 케이스)', () => {
    const r = resolveGeminiOpts({ maxOutputTokens: 4096 });
    expect(r.maxOutputTokens).toBe(4096);
    expect(r.temperature).toBe(0.4); // default
  });

  it('opts.temperature override 만 전달 시 적용', () => {
    const r = resolveGeminiOpts({ temperature: 0.1 });
    expect(r.maxOutputTokens).toBe(2048); // default
    expect(r.temperature).toBe(0.1);
  });

  it('opts.maxOutputTokens=0 (falsy) — ?? 연산자라 0 그대로 전달 (의도)', () => {
    const r = resolveGeminiOpts({ maxOutputTokens: 0 });
    expect(r.maxOutputTokens).toBe(0);
  });

  it('opts.temperature=0 (falsy) — ?? 연산자라 0 그대로 전달', () => {
    const r = resolveGeminiOpts({ temperature: 0 });
    expect(r.temperature).toBe(0);
  });

  it('opts.maxOutputTokens=undefined 명시 → default fallback', () => {
    const r = resolveGeminiOpts({ maxOutputTokens: undefined });
    expect(r.maxOutputTokens).toBe(2048);
  });

  it('두 옵션 모두 전달 (8192 + 0.7)', () => {
    const r = resolveGeminiOpts({ maxOutputTokens: 8192, temperature: 0.7 });
    expect(r.maxOutputTokens).toBe(8192);
    expect(r.temperature).toBe(0.7);
  });
});

describe('callGemini opts wiring — 실제 호출자 SSOT 정합성 회귀', () => {
  it('globalScanAgent.ts 가 maxOutputTokens=4096 명시 (사용자 보고 케이스)', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync(
      new URL('../alerts/globalScanAgent.ts', import.meta.url),
      'utf-8',
    );
    expect(src).toContain("'global-scan'");
    expect(src).toMatch(/maxOutputTokens:\s*4096/);
  });

  it('weeklyQuantInsight.ts 가 maxOutputTokens=4096 명시', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync(
      new URL('../alerts/weeklyQuantInsight.ts', import.meta.url),
      'utf-8',
    );
    expect(src).toContain("'weekly-quant-insight'");
    expect(src).toMatch(/maxOutputTokens:\s*4096/);
  });

  it('reportGenerator.ts 의 daily report-generator narrative 가 maxOutputTokens=4096 명시', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync(
      new URL('../alerts/reportGenerator.ts', import.meta.url),
      'utf-8',
    );
    // report-generator narrative 직후 또는 같은 라인에 maxOutputTokens=4096
    const reportGenIdx = src.indexOf("'report-generator'");
    expect(reportGenIdx).toBeGreaterThan(-1);
    const surrounding = src.slice(reportGenIdx, reportGenIdx + 200);
    expect(surrounding).toMatch(/maxOutputTokens:\s*4096/);
  });
});
