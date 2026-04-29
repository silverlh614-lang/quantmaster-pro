// @responsibility AUTO gate Stage 3 (MOMENTUM decay) 회귀 — cleanupWatchlist demotion 로직 (ADR-0106).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * 사용자 요청 4 후속 (4/29) — AUTO gate 품질 강화 Stage 3:
 *   MOMENTUM 약세 강등 — 등록 후 1일+ 경과 + gateScore < (AUTO_MIN_SCORE - 1.0)
 *   인 entry 즉시 제거. expiresAt 만료 대기 안 함.
 *
 * 사용자 통찰: "약한 종목은 자연 탈락" — watchlist 자기증식 차단.
 */
function readFile(rel: string): string {
  return fs.readFileSync(path.join(process.cwd(), rel), 'utf-8');
}

describe('AUTO gate Stage 3 (MOMENTUM decay) — 정적 패턴', () => {
  it('watchlistManager.ts 가 AUTO_MIN_SCORE 임계 - 1.0 사용', () => {
    const src = readFile('server/screener/watchlistManager.ts');
    expect(src).toContain("parseFloat(process.env.AUTO_MIN_SCORE ?? '7.8')");
    expect(src).toContain('decayThreshold');
    expect(src).toContain('- 1.0');
  });

  it('AUTO_MOMENTUM_DECAY_DISABLED ENV 우회 회로', () => {
    const src = readFile('server/screener/watchlistManager.ts');
    expect(src).toContain("process.env.AUTO_MOMENTUM_DECAY_DISABLED !== 'true'");
  });

  it('등록 1일+ 경과 + gateScore 미달 시 제거', () => {
    const src = readFile('server/screener/watchlistManager.ts');
    expect(src).toContain('oneDayAgoMs');
    expect(src).toContain('24 * 3600 * 1000');
  });

  it('약세 강등 로그 메시지 — MOMENTUM 약세 강등 + 카운트 + 임계', () => {
    const src = readFile('server/screener/watchlistManager.ts');
    expect(src).toContain('MOMENTUM 약세 강등');
    expect(src).toContain('1일 경과');
  });

  it('Stage 3 위치 — MOMENTUM 초과 제거 직후', () => {
    const src = readFile('server/screener/watchlistManager.ts');
    const stage3Idx = src.indexOf('Stage 3 — MOMENTUM 약세 강등');
    const momentumOverIdx = src.indexOf('MOMENTUM 섹션 초과 시');
    expect(stage3Idx).toBeGreaterThan(0);
    expect(stage3Idx).toBeGreaterThan(momentumOverIdx);
  });

  it('SWING/CATALYST 보존 — section !== MOMENTUM 시 즉시 통과', () => {
    const src = readFile('server/screener/watchlistManager.ts');
    expect(src).toContain("if (w.section !== 'MOMENTUM') return true;");
  });

  it('addedAt 부재 또는 NaN 시 안전 통과 (graceful)', () => {
    const src = readFile('server/screener/watchlistManager.ts');
    expect(src).toContain('if (!w.addedAt) return true;');
    expect(src).toContain('Number.isFinite(addedMs)');
  });

  it('회귀 차단 — 사용자 통찰 "자연 탈락" 안내 주석 보존', () => {
    const src = readFile('server/screener/watchlistManager.ts');
    expect(src).toContain('자연 탈락');
  });
});

// ── 통합 동작 테스트 — cleanupWatchlist 실제 호출 + watchlist 영속 검증 ──────

describe('cleanupWatchlist Stage 3 통합 — MOMENTUM decay 실제 동작', () => {
  let tmpDir: string;
  let tmpFile: string;
  const origDataDir = process.env.PERSIST_DATA_DIR;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'momentum-decay-'));
    tmpFile = path.join(tmpDir, 'watchlist.json');
    process.env.PERSIST_DATA_DIR = tmpDir;
    delete process.env.AUTO_MOMENTUM_DECAY_DISABLED;
    delete process.env.AUTO_MIN_SCORE;
    vi.resetModules();
  });

  afterEach(() => {
    if (origDataDir === undefined) delete process.env.PERSIST_DATA_DIR;
    else process.env.PERSIST_DATA_DIR = origDataDir;
    if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
    if (fs.existsSync(tmpDir)) fs.rmdirSync(tmpDir);
  });

  function writeWatchlist(entries: unknown[]): void {
    fs.writeFileSync(tmpFile, JSON.stringify(entries, null, 2));
  }

  it('등록 1일+ 경과 + gateScore 6.7 (임계 6.8 미달) → 제거', async () => {
    const yesterday = new Date(Date.now() - 25 * 3600 * 1000).toISOString();
    writeWatchlist([
      {
        code: '005930',
        name: '삼성전자',
        section: 'MOMENTUM',
        gateScore: 6.7,
        addedAt: yesterday,
        addedBy: 'AUTO',
      },
    ]);
    const { cleanupWatchlist } = await import('./watchlistManager.js');
    const { loadWatchlist } = await import('../persistence/watchlistRepo.js');
    await cleanupWatchlist();
    const result = loadWatchlist();
    expect(result.find((w) => w.code === '005930')).toBeUndefined();
  });

  it('등록 1일+ 경과 + gateScore 7.0 (임계 6.8 통과) → 보존', async () => {
    const yesterday = new Date(Date.now() - 25 * 3600 * 1000).toISOString();
    writeWatchlist([
      {
        code: '000660',
        name: 'SK하이닉스',
        section: 'MOMENTUM',
        gateScore: 7.0,
        addedAt: yesterday,
        addedBy: 'AUTO',
      },
    ]);
    const { cleanupWatchlist } = await import('./watchlistManager.js');
    const { loadWatchlist } = await import('../persistence/watchlistRepo.js');
    await cleanupWatchlist();
    const result = loadWatchlist();
    expect(result.find((w) => w.code === '000660')).toBeDefined();
  });

  it('등록 1일 미경과 (12h 전) + gateScore 5.0 → 보존 (시간 미경과)', async () => {
    const halfDayAgo = new Date(Date.now() - 12 * 3600 * 1000).toISOString();
    writeWatchlist([
      {
        code: '247540',
        name: '에코프로비엠',
        section: 'MOMENTUM',
        gateScore: 5.0,
        addedAt: halfDayAgo,
        addedBy: 'AUTO',
      },
    ]);
    const { cleanupWatchlist } = await import('./watchlistManager.js');
    const { loadWatchlist } = await import('../persistence/watchlistRepo.js');
    await cleanupWatchlist();
    const result = loadWatchlist();
    expect(result.find((w) => w.code === '247540')).toBeDefined();
  });

  it('SWING 섹션은 약세 강등 대상 아님 (gateScore 4.0 도 보존)', async () => {
    const yesterday = new Date(Date.now() - 48 * 3600 * 1000).toISOString();
    writeWatchlist([
      {
        code: '035420',
        name: 'NAVER',
        section: 'SWING',
        gateScore: 4.0,
        addedAt: yesterday,
        addedBy: 'AUTO',
        // SWING expiresAt 충분히 미래
        expiresAt: new Date(Date.now() + 5 * 24 * 3600 * 1000).toISOString(),
      },
    ]);
    const { cleanupWatchlist } = await import('./watchlistManager.js');
    const { loadWatchlist } = await import('../persistence/watchlistRepo.js');
    await cleanupWatchlist();
    const result = loadWatchlist();
    expect(result.find((w) => w.code === '035420')).toBeDefined();
  });

  it('AUTO_MOMENTUM_DECAY_DISABLED=true 시 보존', async () => {
    process.env.AUTO_MOMENTUM_DECAY_DISABLED = 'true';
    const yesterday = new Date(Date.now() - 25 * 3600 * 1000).toISOString();
    writeWatchlist([
      {
        code: '005930',
        name: '삼성전자',
        section: 'MOMENTUM',
        gateScore: 5.0,
        addedAt: yesterday,
        addedBy: 'AUTO',
        expiresAt: new Date(Date.now() + 5 * 24 * 3600 * 1000).toISOString(),
      },
    ]);
    const { cleanupWatchlist } = await import('./watchlistManager.js');
    const { loadWatchlist } = await import('../persistence/watchlistRepo.js');
    await cleanupWatchlist();
    const result = loadWatchlist();
    expect(result.find((w) => w.code === '005930')).toBeDefined();
  });

  it('AUTO_MIN_SCORE=8.5 (임계 7.5) — gateScore 7.4 → 제거', async () => {
    process.env.AUTO_MIN_SCORE = '8.5';
    const yesterday = new Date(Date.now() - 25 * 3600 * 1000).toISOString();
    writeWatchlist([
      {
        code: '005930',
        name: '삼성전자',
        section: 'MOMENTUM',
        gateScore: 7.4,
        addedAt: yesterday,
        addedBy: 'AUTO',
      },
    ]);
    const { cleanupWatchlist } = await import('./watchlistManager.js');
    const { loadWatchlist } = await import('../persistence/watchlistRepo.js');
    await cleanupWatchlist();
    const result = loadWatchlist();
    expect(result.find((w) => w.code === '005930')).toBeUndefined();
  });
});
