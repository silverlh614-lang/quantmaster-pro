/**
 * @responsibility aiUniverseHealthRouter 회귀 테스트 — PR-37 (ADR-0016) /api/health/ai-universe
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import { __testOnly } from './aiUniverseHealthRouter.js';
import {
  saveAiUniverseSnapshot,
  __testOnly as __snapshotTestOnly,
} from '../persistence/aiUniverseSnapshotRepo.js';
import { aiUniverseSnapshotFile, STOCK_MASTER_HEALTH_FILE } from '../persistence/paths.js';
import type { AiUniverseSnapshot } from '../services/aiUniverseTypes.js';

function cleanFiles(): void {
  for (const m of ['MOMENTUM', 'EARLY_DETECT', 'QUANT_SCREEN', 'BEAR_SCREEN']) {
    try { fs.unlinkSync(aiUniverseSnapshotFile(m)); } catch { /* not present */ }
  }
  try { fs.unlinkSync(STOCK_MASTER_HEALTH_FILE); } catch { /* not present */ }
}

function makeSnapshot(overrides: Partial<AiUniverseSnapshot> = {}): AiUniverseSnapshot {
  return {
    mode: 'MOMENTUM',
    generatedAt: Date.now(),
    tradingDate: '2026-04-24',
    marketMode: 'AFTER_MARKET',
    sourceStatus: 'GOOGLE_OK',
    candidates: [
      { code: '005930', name: '삼성전자', market: 'KOSPI', sources: ['naver.com'] },
      { code: '000660', name: 'SK하이닉스', market: 'KOSPI', sources: ['hankyung.com'] },
      { code: '247540', name: '에코프로비엠', market: 'KOSDAQ', sources: ['mk.co.kr'] },
    ],
    diagnostics: {
      googleQueries: 2, googleHits: 5, masterMisses: 0,
      enrichSucceeded: 0, enrichFailed: 0, budgetExceeded: false,
      sourceStatus: 'GOOGLE_OK', fallbackUsed: false,
      marketMode: 'AFTER_MARKET', tradingDateRef: '2026-04-24',
      snapshotAgeDays: null, tierAttempts: ['GOOGLE_OK'],
    },
    ...overrides,
  };
}

describe('aiUniverseHealthRouter — buildSnapshotsBlock (PR-37)', () => {
  beforeEach(() => { cleanFiles(); });
  afterEach(() => { cleanFiles(); });

  it('snapshot 부재 → 모든 mode null', () => {
    const block = __testOnly.buildSnapshotsBlock();
    expect(block.MOMENTUM).toBeNull();
    expect(block.QUANT_SCREEN).toBeNull();
    expect(block.BEAR_SCREEN).toBeNull();
    expect(block.EARLY_DETECT).toBeNull();
  });

  it('snapshot 정상 → tradingDate / ageDays / expired 반환', () => {
    saveAiUniverseSnapshot('MOMENTUM', makeSnapshot());
    const block = __testOnly.buildSnapshotsBlock();
    expect(block.MOMENTUM).not.toBeNull();
    expect(block.MOMENTUM?.tradingDate).toBe('2026-04-24');
    expect(block.MOMENTUM?.ageDays).toBe(0);
    expect(block.MOMENTUM?.expired).toBe(false);
    expect(block.QUANT_SCREEN).toBeNull(); // 다른 mode 영향 없음
    __snapshotTestOnly.removeSnapshotFile('MOMENTUM');
  });

  it('손상된 snapshot → null 반환 (안전 분기)', () => {
    fs.writeFileSync(aiUniverseSnapshotFile('MOMENTUM'), '{not-valid-json');
    const block = __testOnly.buildSnapshotsBlock();
    // 손상은 exists=true 지만 ageDays/tradingDate=null → 우리 응답에서는 null 처리
    expect(block.MOMENTUM).toBeNull();
  });
});

describe('aiUniverseHealthRouter — buildMasterHealthBlock', () => {
  beforeEach(() => { cleanFiles(); });
  afterEach(() => { cleanFiles(); });

  it('overall + 4 source score', () => {
    const block = __testOnly.buildMasterHealthBlock();
    expect(typeof block.overall).toBe('number');
    expect(block.sources.KRX_CSV).toBeGreaterThanOrEqual(0);
    expect(block.sources.NAVER_LIST).toBeGreaterThanOrEqual(0);
    expect(block.sources.SHADOW_DB).toBeGreaterThanOrEqual(0);
    expect(block.sources.STATIC_SEED).toBeGreaterThanOrEqual(0);
  });
});

describe('aiUniverseHealthRouter — buildSourcesBlock', () => {
  afterEach(() => {
    delete process.env.GOOGLE_SEARCH_API_KEY;
    delete process.env.GOOGLE_SEARCH_CX;
  });

  it('Google 미설정 → status=NOT_CONFIGURED', () => {
    delete process.env.GOOGLE_SEARCH_API_KEY;
    delete process.env.GOOGLE_SEARCH_CX;
    const block = __testOnly.buildSourcesBlock();
    expect(block.google.status).toBe('NOT_CONFIGURED');
    expect(block.google.remaining).toBeUndefined();
    expect(block.naver.status).toBe('OK');
    expect(block.yahoo.status).toBe('OK');
  });

  it('Google 설정됨 + 잔여 있음 → status=OK', () => {
    process.env.GOOGLE_SEARCH_API_KEY = 'test';
    process.env.GOOGLE_SEARCH_CX = 'test';
    const block = __testOnly.buildSourcesBlock();
    expect(block.google.status).toBe('OK');
    expect(typeof block.google.remaining).toBe('number');
  });
});
