/**
 * @responsibility PR-4 ocoCloseLoop LIVE 경로 emitFullCloseAttributionForExit wiring 정적 가드
 *
 * LIVE 매매는 KIS OCO 체결로 종결되어 reserveSell 자체를 우회 — PR-2 의
 * emitPartialAttributionForSell baseline 도 호출 안 됨. 본 PR-4 가 STOP_FILLED /
 * PROFIT_FILLED 두 분기에서 잔량=0 시 FullClose attribution 명시 호출.
 *
 * 부분매도 (잔량 > 0) LIVE OCO attribution 은 본 PR scope 밖 — 후속 PR.
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const SOURCE = fs.readFileSync(
  path.join(__dirname, 'ocoCloseLoop.ts'),
  'utf-8',
);

describe('PR-4 ocoCloseLoop LIVE attribution wiring (정적 가드)', () => {
  it('emitFullCloseAttributionForExit import 존재 (cross-module)', () => {
    expect(SOURCE).toMatch(
      /import\s*\{\s*emitFullCloseAttributionForExit\s*\}\s*from\s*['"]\.\/exitEngine\/helpers\/attribution\.js['"]/,
    );
  });

  it('emitFullCloseAttributionForExit 호출 정확히 2건 (STOP + PROFIT)', () => {
    const noImport = SOURCE.replace(/import\s*\{[^}]*emitFullCloseAttributionForExit[^}]*\}[^;]*;/g, '');
    const callMatches = noImport.match(/emitFullCloseAttributionForExit\s*\(/g) ?? [];
    expect(callMatches.length).toBe(2);
  });

  it('STOP_FILLED 분기 — exitRuleTag: HARD_STOP wiring', () => {
    expect(SOURCE).toMatch(
      /\[ocoCloseLoop:STOP\][\s\S]*?attribution[\s\S]*?실패/,
    );
    // STOP 분기에서 try { emitFullCloseAttributionForExit({...exitRuleTag:'HARD_STOP'...
    expect(SOURCE).toMatch(
      /try\s*\{[\s\S]{0,400}emitFullCloseAttributionForExit\s*\(\s*\{[\s\S]{0,200}exitRuleTag:\s*['"]HARD_STOP['"]/,
    );
  });

  it('PROFIT_FILLED 분기 — exitRuleTag: TARGET_EXIT wiring', () => {
    expect(SOURCE).toMatch(
      /\[ocoCloseLoop:PROFIT\][\s\S]*?attribution[\s\S]*?실패/,
    );
    expect(SOURCE).toMatch(
      /try\s*\{[\s\S]{0,400}emitFullCloseAttributionForExit\s*\(\s*\{[\s\S]{0,200}exitRuleTag:\s*['"]TARGET_EXIT['"]/,
    );
  });

  it('두 분기 모두 if (remaining === 0) 가드 안 (전량 청산 시만 호출)', () => {
    // remaining === 0 다음에 try { emitFullCloseAttributionForExit (ε 없는 매칭)
    const guardedCalls = SOURCE.match(/if\s*\(\s*remaining\s*===\s*0\s*\)\s*\{[\s\S]{0,500}emitFullCloseAttributionForExit/g) ?? [];
    expect(guardedCalls.length).toBe(2);
  });

  it('try/catch 격리 — attribution 실패가 OCO 정리 흐름 차단 안 함', () => {
    // emitFullCloseAttributionForExit 호출 인근 catch 블록 존재
    const tryCatchBlocks = SOURCE.match(/try\s*\{[\s\S]*?emitFullCloseAttributionForExit[\s\S]*?\}\s*catch\s*\(/g) ?? [];
    expect(tryCatchBlocks.length).toBe(2);
  });

  it('catch 블록 — console.warn + ${shadow.stockCode}', () => {
    expect(SOURCE).toMatch(/console\.warn\(`\[ocoCloseLoop:STOP\][^`]*\$\{shadow\.stockCode\}/);
    expect(SOURCE).toMatch(/console\.warn\(`\[ocoCloseLoop:PROFIT\][^`]*\$\{shadow\.stockCode\}/);
  });

  it('updateShadow + saveShadowTrades 직후 wiring (이상적 위치)', () => {
    // saveShadowTrades(shadows); → if (remaining === 0) { try { emit...
    const matches = SOURCE.match(/saveShadowTrades\(shadows\);[\s\S]{0,400}if\s*\(\s*remaining\s*===\s*0\s*\)[\s\S]*?emitFullCloseAttributionForExit/g) ?? [];
    expect(matches.length).toBe(2);
  });

  it('호출 인자 — shadow / exitPrice: fillPrice / returnPct: pnlPct / closedAt: pair.resolvedAt', () => {
    const stopMatch = SOURCE.match(/\[ocoCloseLoop:STOP\][\s\S]{0,100}/);
    expect(stopMatch).toBeTruthy();

    // STOP / PROFIT 두 분기 모두 인자 정합 검증
    const stopCallMatch = SOURCE.match(/exitRuleTag:\s*['"]HARD_STOP['"]/);
    const profitCallMatch = SOURCE.match(/exitRuleTag:\s*['"]TARGET_EXIT['"]/);
    expect(stopCallMatch).toBeTruthy();
    expect(profitCallMatch).toBeTruthy();

    // exitPrice: fillPrice / returnPct: pnlPct / closedAt: pair.resolvedAt
    expect(SOURCE).toMatch(/exitPrice:\s*fillPrice[\s\S]{0,200}returnPct:\s*pnlPct[\s\S]{0,200}closedAt:\s*pair\.resolvedAt/);
  });

  it('PR-4 ADR-0006 주석 마커 존재', () => {
    const markers = SOURCE.match(/PR-4\s*\(ADR-0006\)/g) ?? [];
    expect(markers.length).toBe(2);
  });
});
