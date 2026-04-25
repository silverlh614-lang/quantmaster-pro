/**
 * @responsibility aiUniverseSnapshotRepo 회귀 테스트 — ADR-0016 PR-37 Tier 2 폴백 영속
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  saveAiUniverseSnapshot,
  loadAiUniverseSnapshot,
  getSnapshotMeta,
  getSnapshotCandidates,
  SNAPSHOT_TTL_MS,
  __testOnly,
} from './aiUniverseSnapshotRepo.js';
import { aiUniverseSnapshotFile } from './paths.js';
import type {
  AiUniverseMode,
  AiUniverseSnapshot,
} from '../services/aiUniverseTypes.js';

const TMP_ROOT = path.join(os.tmpdir(), `snapshot-repo-test-${process.pid}-${Date.now()}`);

function makeSnapshot(overrides: Partial<AiUniverseSnapshot> = {}): AiUniverseSnapshot {
  return {
    mode: 'MOMENTUM',
    generatedAt: Date.now(),
    tradingDate: '2026-04-24',
    marketMode: 'WEEKEND_CACHE',
    sourceStatus: 'GOOGLE_OK',
    candidates: [
      { code: '005930', name: '삼성전자', market: 'KOSPI', sources: ['m.stock.naver.com'] },
      { code: '000660', name: 'SK하이닉스', market: 'KOSPI', sources: ['hankyung.com'] },
      { code: '247540', name: '에코프로비엠', market: 'KOSDAQ', sources: ['mk.co.kr'] },
    ],
    diagnostics: {
      googleQueries: 2,
      googleHits: 5,
      masterMisses: 0,
      enrichSucceeded: 3,
      enrichFailed: 0,
      budgetExceeded: false,
      sourceStatus: 'GOOGLE_OK',
      fallbackUsed: false,
      marketMode: 'WEEKEND_CACHE',
      tradingDateRef: '2026-04-24',
      snapshotAgeDays: null,
      tierAttempts: ['GOOGLE_OK'],
    },
    ...overrides,
  };
}

const MODES: AiUniverseMode[] = ['MOMENTUM', 'EARLY_DETECT', 'QUANT_SCREEN', 'BEAR_SCREEN'];

function cleanAllSnapshots(): void {
  for (const m of MODES) {
    try { fs.unlinkSync(aiUniverseSnapshotFile(m)); } catch { /* not present */ }
  }
  // 변형 mode (SMALL_MID_CAP) 도 제거
  try { fs.unlinkSync(aiUniverseSnapshotFile('SMALL_MID_CAP')); } catch { /* not present */ }
}

describe('aiUniverseSnapshotRepo (PR-37, ADR-0016)', () => {
  beforeEach(() => {
    if (!fs.existsSync(TMP_ROOT)) fs.mkdirSync(TMP_ROOT, { recursive: true });
    cleanAllSnapshots();
  });
  afterEach(() => {
    cleanAllSnapshots();
  });

  it('save → load — round-trip 성공', () => {
    const snap = makeSnapshot();
    expect(saveAiUniverseSnapshot('MOMENTUM', snap)).toBe(true);

    const loaded = loadAiUniverseSnapshot('MOMENTUM');
    expect(loaded).not.toBeNull();
    expect(loaded?.mode).toBe('MOMENTUM');
    expect(loaded?.candidates.length).toBe(3);
    expect(loaded?.candidates[0].code).toBe('005930');
  });

  it('갱신 정책 가드 — sourceStatus !== GOOGLE_OK 는 거부', () => {
    const snap = makeSnapshot({ sourceStatus: 'FALLBACK_SEED' as 'GOOGLE_OK' });
    expect(saveAiUniverseSnapshot('MOMENTUM', snap)).toBe(false);
    expect(loadAiUniverseSnapshot('MOMENTUM')).toBeNull();
  });

  it('갱신 정책 가드 — candidates < 3 는 거부', () => {
    const snap = makeSnapshot({
      candidates: [
        { code: '005930', name: '삼성전자', market: 'KOSPI', sources: [] },
        { code: '000660', name: 'SK하이닉스', market: 'KOSPI', sources: [] },
      ],
    });
    expect(saveAiUniverseSnapshot('MOMENTUM', snap)).toBe(false);
    expect(loadAiUniverseSnapshot('MOMENTUM')).toBeNull();
  });

  it('7일 만료 — generatedAt 이 7일 + 1ms 이전이면 null', () => {
    const now = Date.now();
    const snap = makeSnapshot({ generatedAt: now - SNAPSHOT_TTL_MS - 1 });
    saveAiUniverseSnapshot('MOMENTUM', snap);
    expect(loadAiUniverseSnapshot('MOMENTUM', now)).toBeNull();
    // meta 는 expired=true 로 표시
    const meta = getSnapshotMeta('MOMENTUM', now);
    expect(meta.exists).toBe(true);
    expect(meta.expired).toBe(true);
  });

  it('손상된 JSON — null 반환 (호출자가 Tier 3 진행)', () => {
    const file = aiUniverseSnapshotFile('MOMENTUM');
    fs.writeFileSync(file, '{not-valid-json');
    expect(loadAiUniverseSnapshot('MOMENTUM')).toBeNull();
    // meta 는 exists=true, 다른 필드 null
    const meta = getSnapshotMeta('MOMENTUM');
    expect(meta.exists).toBe(true);
    expect(meta.generatedAt).toBeNull();
    expect(meta.tradingDate).toBeNull();
  });

  it('mode 별 분리 — MOMENTUM 저장이 BEAR_SCREEN 에 영향 없음', () => {
    const momentum = makeSnapshot({ mode: 'MOMENTUM', tradingDate: '2026-04-24' });
    saveAiUniverseSnapshot('MOMENTUM', momentum);

    expect(loadAiUniverseSnapshot('MOMENTUM')).not.toBeNull();
    expect(loadAiUniverseSnapshot('BEAR_SCREEN')).toBeNull();
    expect(loadAiUniverseSnapshot('QUANT_SCREEN')).toBeNull();
    expect(loadAiUniverseSnapshot('EARLY_DETECT')).toBeNull();
  });

  it('변형 mode (SMALL_MID_CAP) — paths.aiUniverseSnapshotFile 가 안전 정규화', () => {
    const snap = makeSnapshot({ mode: 'MOMENTUM' });
    expect(saveAiUniverseSnapshot('SMALL_MID_CAP', snap)).toBe(true);
    const loaded = loadAiUniverseSnapshot('SMALL_MID_CAP');
    expect(loaded).not.toBeNull();
    __testOnly.removeSnapshotFile('SMALL_MID_CAP');
  });

  it('getSnapshotMeta — 부재 / 정상 / ageDays 계산', () => {
    expect(getSnapshotMeta('MOMENTUM').exists).toBe(false);

    const now = Date.now();
    // 2일 전 생성된 snapshot
    const twoDaysOld = makeSnapshot({ generatedAt: now - 2 * 24 * 60 * 60 * 1000 });
    saveAiUniverseSnapshot('MOMENTUM', twoDaysOld);

    const meta = getSnapshotMeta('MOMENTUM', now);
    expect(meta.exists).toBe(true);
    expect(meta.expired).toBe(false);
    expect(meta.ageDays).toBe(2);
    expect(meta.tradingDate).toBe('2026-04-24');
  });

  it('getSnapshotCandidates — 만료 시 빈 배열', () => {
    const now = Date.now();
    saveAiUniverseSnapshot('MOMENTUM', makeSnapshot({ generatedAt: now }));
    expect(getSnapshotCandidates('MOMENTUM', now).length).toBe(3);

    // 만료 후
    expect(getSnapshotCandidates('MOMENTUM', now + SNAPSHOT_TTL_MS + 1).length).toBe(0);
  });
});
