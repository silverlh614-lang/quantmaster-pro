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

  it('signalScanner.ts (monolith) — R3 sanity block wiring 부재 (분해 후 preflight 단일)', () => {
    // ADR-0147b (signalScanner Phase 3 6단계 오케스트레이터 승격, PR #523):
    // R3 sanity block wiring 은 signalScanner/preflight.ts 단일 위치로 이주.
    // signalScanner.ts 본체는 orchestrator 역할만 보유, drift 차단을 위해 부재 단언.
    const src = read('server/trading/signalScanner.ts');
    expect(src).not.toContain('loadR3SanityBlockState');
    expect(src).not.toContain('isR3SanityAckTokenValid');
  });

  it('preflight module preserves R3 sanity block behavior (single source of wiring)', () => {
    // ADR-0147b 분해 후 preflight.ts 의 return 값 구조가 단순화 (`{ shouldAbort,
    // skipPersist }`). reason/abortReason 명시적 필드는 제거됐지만 R3 sanity
    // block 동작 자체는 보존 — recordBlockedDayShadowScan + loadR3SanityBlockState
    // + isR3SanityAckTokenValid + 텔레그램 알림 + shouldAbort 모두 정상.
    const src = read('server/trading/signalScanner/preflight.ts');
    expect(src).toContain('loadR3SanityBlockState');
    expect(src).toContain('isR3SanityAckTokenValid');
    expect(src).toContain("recordBlockedDayShadowScan('R3_SANITY_BLOCK')");
    expect(src).toContain('R3 Sanity Block Active');
    expect(src).toMatch(/return\s+\{\s*shouldAbort:\s*true/);
  });

  it('GATE_PASS_DATA_MISSING remains diagnostic and does not activate block latch', () => {
    const src = read('server/trading/signalScanner/scanDiagnostics.ts');
    expect(src).toContain("sanity.violation === 'CANDIDATES_ZERO'");
    expect(src).toContain("sanity.violation === 'GATE1_PASS_ZERO'");
    expect(src).not.toContain("sanity.violation === 'GATE_PASS_DATA_MISSING'");
  });
});
