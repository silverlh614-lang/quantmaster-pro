// @responsibility ADR-0117 perSymbolEvaluation DATA_HOLD wiring 정적 가드
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TARGET_FILE = path.resolve(__dirname, 'perSymbolEvaluation.ts');

function readSource(): string {
  return fs.readFileSync(TARGET_FILE, 'utf-8');
}

describe('ADR-0117 perSymbolEvaluation DATA_HOLD 분기 — 정적 가드', () => {
  it("driftAction === 'DATA_HOLD' 분기 존재", () => {
    const src = readSource();
    expect(src).toMatch(/if\s*\(\s*driftAction\s*===\s*['"]DATA_HOLD['"]/);
  });

  it('isDataQuarantined = true 마커 부착', () => {
    const src = readSource();
    expect(src).toMatch(/stock\.isDataQuarantined\s*=\s*true/);
  });

  it('stock.dataQuality 영속 — STALE_BASE_OR_SPLIT_ADJUSTMENT 상태', () => {
    const src = readSource();
    expect(src).toMatch(/stock\.dataQuality\s*=/);
    expect(src).toMatch(/status:\s*['"]STALE_BASE_OR_SPLIT_ADJUSTMENT['"]/);
  });

  it("WAIT 메시지 형식: '→ WAIT / DATA_HOLD / DATA_HOLD_STALE_BASE_OR_SPLIT_ADJUSTMENT'", () => {
    const src = readSource();
    expect(src).toMatch(/→ WAIT \/ DATA_HOLD \/ DATA_HOLD_STALE_BASE_OR_SPLIT_ADJUSTMENT/);
  });

  it('failCount 미증가 — DATA_HOLD 분기에 stock.entryFailCount 증가 코드 없음', () => {
    const src = readSource();
    // DATA_HOLD 분기 영역 추출 — 'DATA_HOLD' 시작부터 다음 } 까지
    const match = src.match(/if\s*\(\s*driftAction\s*===\s*['"]DATA_HOLD['"][^]*?continue;\s*\}/);
    expect(match).not.toBeNull();
    if (match) {
      expect(match[0]).not.toMatch(/stock\.entryFailCount\s*=/);
    }
  });

  it("stageLog.drift = 'DATA_HOLD' 영속", () => {
    const src = readSource();
    expect(src).toMatch(/stageLog\.drift\s*=\s*['"]DATA_HOLD['"]/);
  });

  it('drift update skipped 진단 로그 (사용자 명시 형식)', () => {
    const src = readSource();
    expect(src).toMatch(/drift update skipped/);
  });
});
