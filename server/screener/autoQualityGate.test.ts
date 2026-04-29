// @responsibility AUTO gate 품질 강화 회귀 — Stage 1 score 임계 + Stage 2-1 거래대금 (사용자 요청 2026-04-29).
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * 사용자 요청 4 (4/29) — AUTO gate 품질 강화:
 *   Stage 1: AUTO 최소 score 임계 (default 7.8) — SKIP signalType 종목 차단
 *   Stage 2-1: 거래대금 하위 제거 (default 5억원)
 *
 * 본 테스트는 stockScreener.ts 의 정적 패턴 검증 + ENV 임계값 검증.
 * autoPopulateWatchlist 본체 통합 테스트는 인접 watchlistManager.test.ts 가 담당.
 */
function readFile(rel: string): string {
  return fs.readFileSync(path.join(process.cwd(), rel), 'utf-8');
}

describe('AUTO gate 품질 강화 (사용자 요청 4) — 정적 패턴', () => {
  it('stockScreener.ts 가 AUTO_MIN_SCORE ENV 임계 사용', () => {
    const src = readFile('server/screener/stockScreener.ts');
    expect(src).toContain('AUTO_MIN_SCORE');
    expect(src).toContain("process.env.AUTO_MIN_SCORE ?? '7.8'");
  });

  it('SKIP 분기에 gateScore < AUTO_MIN_SCORE 거부 패턴', () => {
    const src = readFile('server/screener/stockScreener.ts');
    expect(src).toMatch(/gate\.signalType === 'SKIP' && gate\.gateScore < AUTO_MIN_SCORE/);
  });

  it('AUTO 최소 점수 미달 rejectionLog reason 형식 검증', () => {
    const src = readFile('server/screener/stockScreener.ts');
    expect(src).toContain('AUTO 최소 점수 미달');
  });

  it('stockScreener.ts 가 AUTO_MIN_TURNOVER_KRW ENV 임계 사용 (Stage 2-1)', () => {
    const src = readFile('server/screener/stockScreener.ts');
    expect(src).toContain('AUTO_MIN_TURNOVER_KRW');
    expect(src).toContain("process.env.AUTO_MIN_TURNOVER_KRW ?? '500000000'");
  });

  it('거래대금 = price × volume 산식 + 임계 비교 패턴', () => {
    const src = readFile('server/screener/stockScreener.ts');
    expect(src).toContain('quote.price * quote.volume');
    expect(src).toContain('turnoverKrw < AUTO_MIN_TURNOVER_KRW');
  });

  it('거래대금 부족 rejectionLog reason 형식 (억원 표기)', () => {
    const src = readFile('server/screener/stockScreener.ts');
    expect(src).toContain('거래대금 부족');
    expect(src).toMatch(/turnoverKrw \/ 1e8/);
  });

  it('Stage 1 + Stage 2-1 둘 다 섹션 분류 *전* 위치 (continue 로 등록 차단)', () => {
    const src = readFile('server/screener/stockScreener.ts');
    const stage1Idx = src.indexOf('AUTO_MIN_SCORE');
    const stage2Idx = src.indexOf('AUTO_MIN_TURNOVER_KRW');
    const sectionIdx = src.indexOf("const section: WatchlistSection = gate.signalType !== 'SKIP' ?");
    expect(stage1Idx).toBeGreaterThan(0);
    expect(stage2Idx).toBeGreaterThan(stage1Idx);
    expect(sectionIdx).toBeGreaterThan(stage2Idx);
  });

  it('회귀 차단 — 사용자 통찰 "자동 시스템이 자기증식" 안내 주석 보존', () => {
    const src = readFile('server/screener/stockScreener.ts');
    expect(src).toContain('자기증식');
  });
});
