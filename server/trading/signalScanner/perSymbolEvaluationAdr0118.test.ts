// @responsibility ADR-0118 perSymbolEvaluation 분기별 카운터 wiring 정적 회귀 가드
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// ADR-0134: perSymbolEvaluation.ts 분해 후 본체는 perSymbol/buyListLoop.ts + intradayLoop.ts.
// 정적 grep 가드는 두 파일 합친 source 를 검사한다 (byte-equivalent 정합 검증).
const BUY_LIST_LOOP = path.resolve(__dirname, 'perSymbol/buyListLoop.ts');
const INTRADAY_LOOP = path.resolve(__dirname, 'perSymbol/intradayLoop.ts');

function readSource(): string {
  return fs.readFileSync(BUY_LIST_LOOP, 'utf-8') + '\n' + fs.readFileSync(INTRADAY_LOOP, 'utf-8');
}

describe('ADR-0118 perSymbolEvaluation 분기별 카운터 wiring — 정적 가드', () => {
  it('waitDataHold++ — DATA_HOLD 분기에 카운터 증가', () => {
    const src = readSource();
    expect(src).toMatch(/ctx\.scanCounters\.waitDataHold\+\+/);
  });

  it('waitPreBreakout++ — pre-breakout 미도달 분기 (ADR-0115 WAIT)', () => {
    const src = readSource();
    expect(src).toMatch(/ctx\.scanCounters\.waitPreBreakout\+\+/);
  });

  it('waitGateFail++ — Gate 재검증 미달 분기', () => {
    const src = readSource();
    expect(src).toMatch(/ctx\.scanCounters\.waitGateFail\+\+/);
  });

  it('waitSizingBlocked++ — sizingTier BLOCKED 분기', () => {
    const src = readSource();
    expect(src).toMatch(/ctx\.scanCounters\.waitSizingBlocked\+\+/);
  });

  it('waitDriftRemove++ — driftAction REMOVE 분기', () => {
    const src = readSource();
    expect(src).toMatch(/ctx\.scanCounters\.waitDriftRemove\+\+/);
  });

  it('waitDriftCorpAction++ — driftAction CORPORATE_ACTION 분기', () => {
    const src = readSource();
    expect(src).toMatch(/ctx\.scanCounters\.waitDriftCorpAction\+\+/);
  });

  it("Gate 재검증의 DATA_HOLD waitReason 처리 — waitDataHold 우선", () => {
    const src = readSource();
    // revalResult.waitReason === 'DATA_HOLD' 분기 grep
    expect(src).toMatch(/revalResult\.waitReason === ['"]DATA_HOLD['"]/);
  });

  it('ADR-0118 주석 명문화', () => {
    const src = readSource();
    expect(src).toMatch(/ADR-0118/);
  });

  it('기존 gateMisses++ 보존 (후방호환)', () => {
    const src = readSource();
    expect(src).toMatch(/ctx\.scanCounters\.gateMisses\+\+/);
  });
});
