// @responsibility ADR-0128 stockScreener autoPopulateWatchlist verifyStockIncremental(WATCHLIST) wiring 정적 회귀 가드
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TARGET_FILE = path.resolve(__dirname, 'stockScreener.ts');

function readSource(): string {
  return fs.readFileSync(TARGET_FILE, 'utf-8');
}

describe('ADR-0128 §Wiring 1B — autoPopulateWatchlist WATCHLIST role 검증', () => {
  it('verifyStockIncremental import 존재', () => {
    const src = readSource();
    expect(src).toMatch(/import\s*\{\s*verifyStockIncremental\s*\}\s*from\s*['"]\.\.\/data\/dataVerificationIncremental\.js['"]/);
  });

  it('markDataQuarantine import 존재', () => {
    const src = readSource();
    expect(src).toMatch(/import\s*\{\s*markDataQuarantine\s*\}\s*from\s*['"]\.\.\/persistence\/watchlistRepo\.js['"]/);
  });

  it("WATCHLIST role 호출 — verifyStockIncremental(<code>, 'WATCHLIST') 패턴", () => {
    const src = readSource();
    const matches = src.match(/verifyStockIncremental\([^,]+,\s*['"]WATCHLIST['"]\)/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(2); // KIS path + Yahoo path
  });

  it('verify 실패 시 markDataQuarantine 호출 패턴 — dataQuality 부재 시 skip', () => {
    const src = readSource();
    // !verified && dataQuality 분기
    expect(src).toMatch(/!\w+\.verified && \w+\.dataQuality/);
    expect(src).toMatch(/markDataQuarantine\(/);
  });

  it('try/catch 격리 — verify error 가 워치리스트 등록 차단 안 함', () => {
    const src = readSource();
    const safeSkipMatches = src.match(/\[autoPopulateWatchlist\] verify error \(skip\)/g) ?? [];
    expect(safeSkipMatches.length).toBeGreaterThanOrEqual(2);
  });
});

describe('ADR-0128 회귀 가드 — 워치리스트 등록 자체는 차단 금지', () => {
  it('verify wiring 은 existingCodes.add + added++ *이후* 위치 — 등록 절대 보존', () => {
    const src = readSource();
    // existingCodes.add(...) → added++ → console.log → ADR-0128 wiring 순서 검증
    // 패턴: existingCodes.add → ADR-0128 §Wiring 1B 주석
    expect(src).toMatch(/existingCodes\.add[\s\S]{0,500}ADR-0128 §Wiring 1B/);
  });

  it("HELD_POSITION 미사용 — autoPopulateWatchlist 는 신규 후보 영역 (보유 종목 무관)", () => {
    const src = readSource();
    expect(src).not.toMatch(/HELD_POSITION/);
  });

  it("BUY_CANDIDATE role 사용 0건 — autoPopulateWatchlist 는 워치리스트 단계 (매수 후보 단계 아님)", () => {
    const src = readSource();
    // verifyStockIncremental 의 BUY_CANDIDATE 호출은 perSymbolEvaluation 단독
    expect(src).not.toMatch(/verifyStockIncremental\([^,]+,\s*['"]BUY_CANDIDATE['"]\)/);
  });

  it('action 객체 사용 0건 — WATCHLIST role 은 dataQuality 영속만 (blockBuy 분기 사용 안 함)', () => {
    const src = readSource();
    // _verifyKis.action / _verifyYahoo.action 등 .action 접근 패턴이 없어야 함
    expect(src).not.toMatch(/_verify(Kis|Yahoo)\.action/);
  });
});
