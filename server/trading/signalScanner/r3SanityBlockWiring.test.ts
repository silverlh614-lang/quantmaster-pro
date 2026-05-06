// @responsibility R3 sanity violation latch wiring — alert에서 신규매수 차단/Shadow-only 전환까지 연결
//
// ADR-0401 — R3 Sanity 단계형 state machine 도입 후 wiring 검증.
// HARD_BLOCK_LATCH 일 때만 activateR3SanityBlock 호출 (절대 원칙 #11/12 정합).

import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

function read(rel: string): string {
  return fs.readFileSync(path.resolve(process.cwd(), rel), 'utf-8');
}

describe('R3 sanity block wiring', () => {
  it('scanDiagnostics state machine 경유 → HARD_BLOCK_LATCH 일 때만 activateR3SanityBlock', () => {
    const src = read('server/trading/signalScanner/scanDiagnostics.ts');
    // ADR-0401: 단일 분기 — state.action === 'HARD_BLOCK_LATCH' 일 때만 호출
    expect(src).toContain('activateR3SanityBlock');
    expect(src).toMatch(/stateResult\.action\s*===\s*['"]HARD_BLOCK_LATCH['"]/);
    // state machine 호출
    expect(src).toContain('evaluateR3ViolationState');
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

  it('preflight module preserves R3 sanity block behavior + ADR-0401 SHADOW_ONLY pre-scan', () => {
    // ADR-0147b 분해 후 preflight.ts 의 return 값 구조가 단순화 (`{ shouldAbort,
    // skipPersist }`). reason/abortReason 명시적 필드는 제거됐지만 R3 sanity
    // block 동작 자체는 보존.
    // ADR-0401 — SHADOW_ONLY ephemeral 차단도 preflight 에서 추가.
    const src = read('server/trading/signalScanner/preflight.ts');
    expect(src).toContain('loadR3SanityBlockState');
    expect(src).toContain('isR3SanityAckTokenValid');
    expect(src).toContain("recordBlockedDayShadowScan('R3_SANITY_BLOCK')");
    expect(src).toContain('R3 Sanity Block Active');
    expect(src).toMatch(/return\s+\{\s*shouldAbort:\s*true/);
    // ADR-0401 wiring
    expect(src).toContain('getEffectiveR3ViolationStreak');
    expect(src).toContain('SHADOW_ONLY ephemeral');
  });

  it('GATE_PASS_DATA_MISSING — state machine 안에서 WARNING_ONLY 처리 (절대 원칙 #8)', () => {
    // ADR-0401: scanDiagnostics 본체에서 violation 별 분기는 state machine 안에 캡슐화.
    // 외부 wiring 코드는 state.action 분기만 노출 — drift 차단.
    const src = read('server/trading/signalScanner/scanDiagnostics.ts');
    // 본체에서 violation 별 직접 분기 부재 (state machine 위임)
    expect(src).not.toMatch(/sanity\.violation\s*===\s*['"]CANDIDATES_ZERO['"]/);
    expect(src).not.toMatch(/sanity\.violation\s*===\s*['"]GATE1_PASS_ZERO['"]/);
    expect(src).not.toMatch(/sanity\.violation\s*===\s*['"]GATE_PASS_DATA_MISSING['"]/);
  });

  it('SHADOW_ONLY/WARNING/ELEVATED 시 activateR3SanityBlock 호출 부재 (정적 grep 가드)', () => {
    // 절대 원칙 #10 — SHADOW_ONLY 는 ephemeral, persistent latch 아님.
    const src = read('server/trading/signalScanner/scanDiagnostics.ts');
    // 주석 strip 후 코드 안 호출은 1회만 (HARD_BLOCK_LATCH 분기)
    const codeOnly = src.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    const calls = codeOnly.match(/^\s*activateR3SanityBlock\(/gm) || [];
    expect(calls.length).toBe(1);
    // import 도 1회
    const imports = codeOnly.match(/import\s*\{[^}]*activateR3SanityBlock[^}]*\}/g) || [];
    expect(imports.length).toBe(1);
  });

  it('dedupeKey 에 state + count 포함 (단계 전이 알림 보장)', () => {
    const src = read('server/trading/signalScanner/scanDiagnostics.ts');
    expect(src).toMatch(/r3_sanity:\$\{stateLabel\}/);
    expect(src).toMatch(/consecutiveCount/);
  });
});
