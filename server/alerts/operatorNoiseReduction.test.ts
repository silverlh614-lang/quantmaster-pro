// @responsibility ADR-0108 — 운영자 노이즈 감축 회귀 (사용자 4/29 보고 4건 통합).
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * 사용자 4/29 보고 — 운영자 인지 부담 감축 3건:
 *   1. 일일 종목 픽 (16:30 KST) default OFF — ENV 명시 활성화
 *   2. Watchlist Auto-Trim / 포화 알림 cooldown 8h/12h + ENV 우회
 *   3. 자기반성 narrative maxOutputTokens 4096 → 8192 (텍스트 잘림)
 */
function readFile(rel: string): string {
  return fs.readFileSync(path.join(process.cwd(), rel), 'utf-8');
}

describe('ADR-0108 #1 — 일일 종목 픽 default OFF', () => {
  it('stockPickReporter.ts 진입부에 DAILY_PICK_REPORT_ENABLED 가드', () => {
    const src = readFile('server/alerts/stockPickReporter.ts');
    expect(src).toContain("process.env.DAILY_PICK_REPORT_ENABLED !== 'true'");
    expect(src).toContain('발송 skip (ADR-0108)');
  });

  it('가드 위치 — generateDailyPickReport 함수 시작 직후 (조기 return)', () => {
    const src = readFile('server/alerts/stockPickReporter.ts');
    const fnIdx = src.indexOf('export async function generateDailyPickReport');
    expect(fnIdx).toBeGreaterThan(0);
    const block = src.slice(fnIdx, fnIdx + 600);
    expect(block).toContain('DAILY_PICK_REPORT_ENABLED');
    // const macroState 호출 *전* 에 가드 위치
    const guardIdx = block.indexOf('DAILY_PICK_REPORT_ENABLED');
    const macroIdx = block.indexOf('loadMacroState');
    expect(guardIdx).toBeLessThan(macroIdx);
  });
});

describe('ADR-0108 #2 — Watchlist 노이즈 cooldown 확대', () => {
  it('Auto-Trim cooldown 15분 → 8시간', () => {
    const src = readFile('server/persistence/watchlistRepo.ts');
    expect(src).toContain("dedupeKey: 'watchlist-autotrim'");
    expect(src).toContain('8 * 60 * 60 * 1000');
    expect(src).not.toContain('15 * 60 * 1000,');
  });

  it('Auto-Trim 발송 임계 — totalDropped >= 3 (1~2개 무음)', () => {
    const src = readFile('server/persistence/watchlistRepo.ts');
    expect(src).toContain('totalDropped >= 3');
  });

  it('포화 cooldown 30분 → 12시간', () => {
    const src = readFile('server/persistence/watchlistRepo.ts');
    expect(src).toContain("dedupeKey: 'watchlist-momentum-overflow'");
    expect(src).toContain('12 * 60 * 60 * 1000');
    expect(src).not.toContain('30 * 60 * 1000,');
  });

  it('포화 임계 강화 — soft cap 90% 임박 시에만 발송', () => {
    const src = readFile('server/persistence/watchlistRepo.ts');
    expect(src).toContain('soft.MOMENTUM * 0.9');
    expect(src).toContain('hard.MOMENTUM * 0.9');
    expect(src).toContain('overflowThreshold');
  });

  it('ENV 우회 회로 2종', () => {
    const src = readFile('server/persistence/watchlistRepo.ts');
    expect(src).toContain("process.env.WATCHLIST_TRIM_ALERT_DISABLED !== 'true'");
    expect(src).toContain("process.env.WATCHLIST_OVERFLOW_ALERT_DISABLED !== 'true'");
  });
});

describe('ADR-0108 #3 — 자기반성 maxOutputTokens 8192', () => {
  it('REFLECTION_MAX_OUTPUT_TOKENS 4096 → 8192', () => {
    const src = readFile('server/learning/reflectionIntegrity.ts');
    expect(src).toContain('export const REFLECTION_MAX_OUTPUT_TOKENS = 8192');
    expect(src).not.toContain('export const REFLECTION_MAX_OUTPUT_TOKENS = 4096');
  });

  it('ADR-0108 보강 안내 주석 보존', () => {
    const src = readFile('server/learning/reflectionIntegrity.ts');
    expect(src).toContain('ADR-0108');
    expect(src).toContain('이익 실현을 저해할');
  });

  it('reflectionGemini.test.ts 단언 정합화 (4096 → 8192)', () => {
    const src = readFile('server/learning/reflectionModules/reflectionGemini.test.ts');
    expect(src).toContain('maxOutputTokens:8192');
    expect(src).toContain('toBe(8192)');
  });
});
