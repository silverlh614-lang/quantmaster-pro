// @responsibility R3 sanity violation latch wiring — alert에서 신규매수 차단/Shadow-only 전환까지 연결

import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

function read(rel: string): string {
  return fs.readFileSync(path.resolve(process.cwd(), rel), 'utf-8');
}

describe('R3 sanity block wiring', () => {
  it('scanDiagnostics violation path activates persistent R3 sanity block', () => {
    const src = read('server/trading/signalScanner/scanDiagnostics.ts');
    expect(src).toContain('activateR3SanityBlock');
    expect(src).toMatch(/sanity\.violation\s*!==\s*['"]NONE['"]/);
  });

  it('monolith signalScanner blocks new buys while R3 sanity block is active', () => {
    const src = read('server/trading/signalScanner.ts');
    expect(src).toContain('loadR3SanityBlockState');
    expect(src).toContain("recordBlockedDayShadowScan('R3_SANITY_BLOCK')");
    expect(src).toContain('R3_SANITY_OPERATOR_ACK');
  });

  it('preflight module preserves same R3 sanity block behavior for migrated path', () => {
    const src = read('server/trading/signalScanner/preflight.ts');
    expect(src).toContain('loadR3SanityBlockState');
    expect(src).toContain("reason: 'R3_SANITY_BLOCK'");
    expect(src).toContain("abortReason: 'R3_SANITY_BLOCK'");
  });
});
