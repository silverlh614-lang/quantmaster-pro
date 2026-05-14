// @responsibility ADR-0108 + Patch-WATCHLIST-SATURATION-COOLDOWN-001 — 운영자 노이즈 감축 회귀 (픽 OFF / Auto-Trim cooldown / 포화 SSOT / reflection 토큰).
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

describe('ADR-0108 #2 + Patch-WATCHLIST-SATURATION-COOLDOWN-001 — Watchlist 노이즈 cooldown', () => {
  // Auto-Trim 알림은 watchlistRepo.ts 에 잔존, 포화 알림은 watchlistSaturationPolicy.ts
  // SSOT 로 이관 (Patch-WATCHLIST-SATURATION-COOLDOWN-001 PR #995). 따옴표 정규화는
  // ['"] 양쪽 허용 — prettier double-quote 통일과 정합.
  it('Auto-Trim cooldown 15분 → 8시간 — watchlistRepo.ts 잔존', () => {
    const src = readFile('server/persistence/watchlistRepo.ts');
    expect(src).toMatch(/dedupeKey:\s*["']watchlist-autotrim["']/);
    expect(src).toContain('8 * 60 * 60 * 1000');
    expect(src).not.toContain('15 * 60 * 1000,');
  });

  it('Auto-Trim 발송 임계 — totalDropped >= 3 (1~2개 무음)', () => {
    const src = readFile('server/persistence/watchlistRepo.ts');
    expect(src).toContain('totalDropped >= 3');
  });

  it('포화 알림 — watchlistSaturationPolicy SSOT 이관 + cooldown 상태머신', () => {
    // Patch-WATCHLIST-SATURATION-COOLDOWN-001: ADR-0108 의 단순 12h cooldown 을
    // 30분 default + cooldown 상태머신(severity 상승 / count+5 / soft·hard 최초
    // 도달 / below-alert 재진입 bypass)으로 재설계. watchlistRepo.ts 는 SSOT 위임만.
    const policy = readFile('server/persistence/watchlistSaturationPolicy.ts');
    expect(policy).toContain(
      'export const WATCHLIST_SATURATION_COOLDOWN_MS = 30 * 60 * 1000',
    );
    expect(policy).toContain('WATCHLIST_SATURATION_COOLDOWN_MIN'); // ENV override
    expect(policy).toContain('export function evaluateWatchlistSaturationAlert');
    const repo = readFile('server/persistence/watchlistRepo.ts');
    expect(repo).toContain('evaluateWatchlistSaturationAlert(');
    expect(repo).not.toContain('watchlist-momentum-overflow'); // 폐기 확인
  });

  it('포화 severity 분류 — classifyWatchlistSaturation ADVISORY/WARNING/CRITICAL', () => {
    // Patch-WATCHLIST-SATURATION-COOLDOWN-001: ADR-0108 의 "soft cap 90% 임박" 단순
    // 임계를 alertCap/softCap/hardCap 3단계 severity 분류로 대체.
    const policy = readFile('server/persistence/watchlistSaturationPolicy.ts');
    expect(policy).toContain('export function classifyWatchlistSaturation');
    expect(policy).toContain('"ADVISORY"');
    expect(policy).toContain('"WARNING"');
    expect(policy).toContain('"CRITICAL"');
    const repo = readFile('server/persistence/watchlistRepo.ts');
    expect(repo).not.toContain('soft.MOMENTUM * 0.9'); // 폐기 확인
    expect(repo).not.toContain('overflowThreshold'); // 폐기 확인
  });

  it('ENV 우회 회로 2종 — Auto-Trim(watchlistRepo) + 포화(watchlistSaturationPolicy)', () => {
    const repo = readFile('server/persistence/watchlistRepo.ts');
    expect(repo).toMatch(/WATCHLIST_TRIM_ALERT_DISABLED\s*!==\s*["']true["']/);
    const policy = readFile('server/persistence/watchlistSaturationPolicy.ts');
    expect(policy).toMatch(/WATCHLIST_OVERFLOW_ALERT_DISABLED\s*===\s*["']true["']/);
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
