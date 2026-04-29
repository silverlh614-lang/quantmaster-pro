// @responsibility AUTO gate Stage 2-2 (enemy) 정적 패턴 회귀 (ADR-0106).
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * 사용자 요청 4 후속 (4/29) — AUTO gate 품질 강화 Stage 2-2:
 *   enemyAutoBlock (ADR-0078) 을 autoPopulateWatchlist 의 AUTO gate 단계에서도
 *   호출. 매수 직전 차단 vs 후보 등록 차단 양쪽 안전망.
 *
 * 비용 절감: Stage 1 (gateScore≥7.8) + Stage 2-1 (거래대금≥5억) 통과한 종목만
 * enemy check 호출 (50개 universe 중 5~10개 정도).
 */
function readFile(rel: string): string {
  return fs.readFileSync(path.join(process.cwd(), rel), 'utf-8');
}

describe('AUTO gate Stage 2-2 (enemy) — 정적 패턴', () => {
  it('stockScreener.ts 가 fetchEnemyCheckData + evaluateEnemyAutoBlock dynamic import', () => {
    const src = readFile('server/screener/stockScreener.ts');
    expect(src).toContain("import('../clients/enemyCheckClient.js')");
    expect(src).toContain("import('../trading/enemyAutoBlock.js')");
    expect(src).toContain('fetchEnemyCheckData');
    expect(src).toContain('evaluateEnemyAutoBlock');
  });

  it('AUTO_ENEMY_GATE_DISABLED ENV 우회 회로', () => {
    const src = readFile('server/screener/stockScreener.ts');
    expect(src).toContain("process.env.AUTO_ENEMY_GATE_DISABLED !== 'true'");
  });

  it('decision.shouldBlock 분기 + rejectionLog reason "enemy 차단"', () => {
    const src = readFile('server/screener/stockScreener.ts');
    expect(src).toContain('decision.shouldBlock');
    expect(src).toContain('enemy 차단');
  });

  it('Stage 2-2 위치 — Stage 2-1 직후 + 섹션 분류 전 (continue 로 등록 차단)', () => {
    const src = readFile('server/screener/stockScreener.ts');
    const stage2_1Idx = src.indexOf('AUTO_MIN_TURNOVER_KRW');
    const stage2_2Idx = src.indexOf('AUTO_ENEMY_GATE_DISABLED');
    const sectionIdx = src.indexOf("const section: WatchlistSection = gate.signalType !== 'SKIP' ?");
    expect(stage2_1Idx).toBeGreaterThan(0);
    expect(stage2_2Idx).toBeGreaterThan(stage2_1Idx);
    expect(sectionIdx).toBeGreaterThan(stage2_2Idx);
  });

  it('graceful degradation — try/catch + 평가 실패 시 다음 단계 진행', () => {
    const src = readFile('server/screener/stockScreener.ts');
    // enemy 평가 try 블록 안에 catch 가 있어야 함
    const enemyIdx = src.indexOf('AUTO_ENEMY_GATE_DISABLED');
    expect(enemyIdx).toBeGreaterThan(0);
    const block = src.slice(enemyIdx, enemyIdx + 1500);
    expect(block).toContain('try');
    expect(block).toContain('catch');
    expect(block).toContain('graceful degradation');
  });

  it('비용 절감 안내 주석 (Stage 1 + 2-1 통과 종목만 호출)', () => {
    const src = readFile('server/screener/stockScreener.ts');
    expect(src).toContain('비용 절감');
  });
});
