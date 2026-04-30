/**
 * @responsibility fillMonitor auto-close 분기 emitFullCloseAttributionForExit wiring 정적 가드
 *
 * correctShadowFill 의 잔량=0 → HIT_STOP 자동 전환 분기에서 FULL_CLOSE attribution
 * baseline 영속을 보장하는 wiring 정적 검증. 누적 부분청산이 마지막 fill 의
 * emitPartialAttributionForSell remainingQty<=0 가드로 null 반환 후 도달하는
 * 경로를 catch — 본 PR 직전 attribution 누락 위치.
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const SOURCE = fs.readFileSync(
  path.join(__dirname, 'fillMonitor.ts'),
  'utf-8',
);

describe('fillMonitor auto-close attribution wiring (정적 가드)', () => {
  it('emitFullCloseAttributionForExit import 존재 (cross-module)', () => {
    expect(SOURCE).toMatch(
      /import\s*\{\s*emitFullCloseAttributionForExit\s*\}\s*from\s*['"]\.\/exitEngine\/helpers\/attribution\.js['"]/,
    );
  });

  it('getWeightedPnlPct import 존재 (가중 returnPct 산출)', () => {
    expect(SOURCE).toMatch(/getWeightedPnlPct/);
  });

  it('emitFullCloseAttributionForExit 호출 정확히 1건 (auto-close 분기)', () => {
    const noImport = SOURCE.replace(/import\s*\{[^}]*emitFullCloseAttributionForExit[^}]*\}[^;]*;/g, '');
    const callMatches = noImport.match(/emitFullCloseAttributionForExit\s*\(/g) ?? [];
    expect(callMatches.length).toBe(1);
  });

  it('autoClosed=true 분기 안에 wiring (잔량 0 + status 미전이 케이스)', () => {
    // if (autoClosed) { ... try { emitFullCloseAttributionForExit({...
    expect(SOURCE).toMatch(
      /if\s*\(\s*autoClosed\s*\)\s*\{[\s\S]*?try\s*\{[\s\S]*?emitFullCloseAttributionForExit/,
    );
  });

  it('try/catch 격리 — 매매 흐름 무중단 보장', () => {
    expect(SOURCE).toMatch(
      /try\s*\{[\s\S]{0,500}?emitFullCloseAttributionForExit[\s\S]*?catch\s*\([^)]*\)\s*\{[\s\S]*?console\.warn/,
    );
  });

  it('호출 인자 — shadow / exitPrice / returnPct / closedAt / exitRuleTag 5종 모두', () => {
    const callMatch = SOURCE.match(/emitFullCloseAttributionForExit\s*\(\s*\{([\s\S]*?)\}\s*\)/);
    expect(callMatch).not.toBeNull();
    const args = callMatch![1];
    expect(args).toMatch(/shadow:\s*trade/);
    expect(args).toMatch(/exitPrice:\s*effectivePrice/);
    expect(args).toMatch(/returnPct:\s*getWeightedPnlPct\(trade\)/);
    expect(args).toMatch(/closedAt:/);
    expect(args).toMatch(/exitRuleTag:/);
  });

  it('exitRuleTag fallback — trade.exitRuleTag ?? "FILL_MONITOR_AUTO_CLOSE"', () => {
    expect(SOURCE).toMatch(
      /exitRuleTag:\s*trade\.exitRuleTag\s*\?\?\s*['"]FILL_MONITOR_AUTO_CLOSE['"]/,
    );
  });

  it('saveShadowTrades 호출 후 wiring (영속 실패 시 attribution 무영속)', () => {
    // saveShadowTrades 의 catch 블록 (롤백) 다음에 if (autoClosed) wiring 존재
    expect(SOURCE).toMatch(
      /saveShadowTrades\(trades\)[\s\S]+if\s*\(\s*autoClosed\s*\)[\s\S]*?emitFullCloseAttributionForExit/,
    );
  });

  it('PR-Fix-Attribution-FullClose-Followup ADR-0006 주석 마커 존재', () => {
    expect(SOURCE).toMatch(/PR-Fix-Attribution-FullClose-Followup\s*\(ADR-0006\)/);
  });
});
