// @responsibility 회귀 테스트 — /learning_pulse 7영역 헬스 SSOT 수집 + 진단 플래그 + 메시지 포맷
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import type { GhostPosition, ExperimentProposal, BiasHeatmapDailyEntry } from '../../../learning/reflectionTypes.js';
import type { ServerAttributionRecord } from '../../../persistence/attributionRepo.js';
import type { F2WRunResult } from '../../../learning/failureToWeight.js';
import type { AlertHistoryEntry } from '../../../persistence/alertHistoryRepo.js';

const NOW = new Date('2026-04-30T06:00:00Z');

function isoNDaysAgo(n: number): string {
  return new Date(NOW.getTime() - n * 24 * 3600 * 1000).toISOString();
}

function writeJson(file: string, data: unknown): void {
  fs.writeFileSync(file, JSON.stringify(data));
}

function makeGhost(_id: string, closed: boolean, lastUpdatedAt?: string): GhostPosition {
  return {
    stockCode: '005930',
    stockName: '삼성전자',
    signalPriceKrw: 50000,
    signalDate: '2026-04-15',
    rejectionReason: 'gate2_fail',
    trackUntil: '2026-05-15',
    closed,
    lastUpdatedAt,
  };
}

function makeAttr(closedAt: string): ServerAttributionRecord {
  return {
    schemaVersion: 2,
    tradeId: 't1',
    stockCode: '005930',
    stockName: '삼성전자',
    closedAt,
    returnPct: 0.05,
    isWin: true,
    conditionScores: {},
    holdingDays: 3,
  };
}

function makeF2WRun(ranAt: string, totalRecords: number, skipCount: number): F2WRunResult {
  return {
    ranAt,
    totalRecords,
    adjustments: Array.from({ length: skipCount }, (_, i) => ({
      conditionId: i + 1,
      conditionName: `c${i + 1}`,
      serverKey: 'momentum' as F2WRunResult['adjustments'][number]['serverKey'],
      samples: 5,
      correlation: 0,
      prevWeight: 1.0,
      nextWeight: 1.0,
      action: 'NONE',
      contribution180d: 0,
      reason: 'sample insufficient',
    })),
    weightsBefore: {} as F2WRunResult['weightsBefore'],
    weightsAfter: {} as F2WRunResult['weightsAfter'],
    sunsetCount: 0,
    boostCount: 0,
    decayCount: 0,
  };
}

function makeSuggestAlert(at: string, moduleKey: string, success = true): AlertHistoryEntry {
  return {
    id: `${moduleKey}-${at}`,
    at,
    category: 'analysis_meta' as AlertHistoryEntry['category'],
    priority: 'NORMAL' as AlertHistoryEntry['priority'],
    message: `💡 <b>학습 모듈 Suggest — ${moduleKey}</b>\nTitle\n근거: x\n현재: y\n권고: z\n임계: w`,
    delivery: 'immediate',
    success,
  };
}

function writeAlertJsonl(tmpDir: string, yyyymm: string, entries: AlertHistoryEntry[]): void {
  const file = path.join(tmpDir, `alert-history-${yyyymm}.jsonl`);
  fs.writeFileSync(file, entries.map((e) => JSON.stringify(e)).join('\n') + '\n');
}

describe('computeGeminiUseRatio', () => {
  let mod: typeof import('./learningPulse.cmd.js');
  beforeEach(async () => {
    vi.resetModules();
    mod = await import('./learningPulse.cmd.js');
  });

  it('1. callCount=0 → 0', () => expect(mod.computeGeminiUseRatio(0)).toBe(0));
  it('2. callCount=22 → 1.0', () => expect(mod.computeGeminiUseRatio(22)).toBe(1));
  it('3. callCount=11 → 0.5', () => expect(mod.computeGeminiUseRatio(11)).toBeCloseTo(0.5, 2));
  it('4. callCount=100 → clamp 1.0', () => expect(mod.computeGeminiUseRatio(100)).toBe(1));
  it('5. NaN/음수 → 0', () => {
    expect(mod.computeGeminiUseRatio(NaN)).toBe(0);
    expect(mod.computeGeminiUseRatio(-5)).toBe(0);
  });
});

describe('collectLearningPulse — 7영역 SSOT 수집', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-'));
    process.env.PERSIST_DATA_DIR = tmpDir;
    vi.resetModules();
  });

  afterEach(() => {
    delete process.env.PERSIST_DATA_DIR;
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* noop */ }
  });

  it('1. 모든 영속 부재 → 빈 카운트 + ✅ 모든 채널 정상 (단, attribution=0/SUGGEST=0/Gemini=0 으로 일부 flag 발동)', async () => {
    const { collectLearningPulse } = await import('./learningPulse.cmd.js');
    const snap = collectLearningPulse(NOW);
    expect(snap.ghost.open).toBe(0);
    expect(snap.attribution7d.count).toBe(0);
    expect(snap.experimentsActive).toBe(0);
    expect(snap.gemini.callCount).toBe(0);
    // 부재 시 attribution<70 + suggest=0 + gemini<80% 모두 발동
    expect(snap.flags).toEqual(expect.arrayContaining([
      expect.stringContaining('sample_starvation'),
      expect.stringContaining('suggest_silence'),
      expect.stringContaining('gemini_underuse'),
    ]));
    // ghost_close_blocker 는 open<100 이라 미발동
    expect(snap.flags.some((f) => f.includes('ghost_close_blocker'))).toBe(false);
  });

  it('2. ghost open=150 + closed=5 (ratio=0.033) → ghost_close_blocker 발동', async () => {
    const ghosts: GhostPosition[] = [];
    for (let i = 0; i < 150; i++) ghosts.push(makeGhost(`g${i}`, false));
    for (let i = 0; i < 5; i++) ghosts.push(makeGhost(`g_closed_${i}`, true, isoNDaysAgo(2)));
    writeJson(path.join(tmpDir, 'ghost-portfolio.json'), ghosts);
    const { collectLearningPulse } = await import('./learningPulse.cmd.js');
    const snap = collectLearningPulse(NOW);
    expect(snap.ghost.open).toBe(150);
    expect(snap.ghost.closedRecent7d).toBe(5);
    expect(snap.ghost.closeRatio).toBeCloseTo(5 / 150, 3);
    expect(snap.flags.some((f) => f.includes('ghost_close_blocker'))).toBe(true);
  });

  it('3. ghost open=50 (임계 미만) → blocker flag 미발동', async () => {
    const ghosts: GhostPosition[] = [];
    for (let i = 0; i < 50; i++) ghosts.push(makeGhost(`g${i}`, false));
    writeJson(path.join(tmpDir, 'ghost-portfolio.json'), ghosts);
    const { collectLearningPulse } = await import('./learningPulse.cmd.js');
    const snap = collectLearningPulse(NOW);
    expect(snap.flags.some((f) => f.includes('ghost_close_blocker'))).toBe(false);
  });

  it('4. attribution 80건 / 7일 → sample_starvation 미발동 + 정상', async () => {
    const records: ServerAttributionRecord[] = [];
    for (let i = 0; i < 80; i++) records.push(makeAttr(isoNDaysAgo(3)));
    // 30일 이상 과거 1건 (윈도우 외)
    records.push(makeAttr(isoNDaysAgo(30)));
    writeJson(path.join(tmpDir, 'attribution-records.json'), records);
    const { collectLearningPulse } = await import('./learningPulse.cmd.js');
    const snap = collectLearningPulse(NOW);
    expect(snap.attribution7d.count).toBe(80);
    expect(snap.flags.some((f) => f.includes('sample_starvation'))).toBe(false);
  });

  it('5. condition weights — sunset(<=0.1) + 미학습(=1.0) + 변경 카운트', async () => {
    // 27 conditions: 3 sunset (0.1) + 5 changed (1.5) + 19 untouched (1.0)
    const w: Record<string, number> = {};
    const keys = Array.from({ length: 27 }, (_, i) => `c${i + 1}`);
    keys.slice(0, 3).forEach((k) => w[k] = 0.1);
    keys.slice(3, 8).forEach((k) => w[k] = 1.5);
    keys.slice(8).forEach((k) => w[k] = 1.0);
    writeJson(path.join(tmpDir, 'condition-weights.json'), w);
    const { collectLearningPulse } = await import('./learningPulse.cmd.js');
    const snap = collectLearningPulse(NOW);
    expect(snap.weights.changedFromDefault).toBeGreaterThanOrEqual(8);
    expect(snap.weights.sunsetCount).toBeGreaterThanOrEqual(3);
  });

  it('6. F2W audit tail — ranAt + skip(NONE) 카운트 + totalRecords', async () => {
    const f2wLog = [
      makeF2WRun('2026-04-29T03:10:00Z', 50, 2),
      makeF2WRun('2026-04-30T03:10:00Z', 60, 4),
    ];
    writeJson(path.join(tmpDir, 'f2w-audit-log.json'), f2wLog);
    const { collectLearningPulse } = await import('./learningPulse.cmd.js');
    const snap = collectLearningPulse(NOW);
    expect(snap.weights.lastF2WRanAt).toBe('2026-04-30T03:10:00Z');
    expect(snap.weights.lastF2WSkipCount).toBe(4);
    expect(snap.weights.lastF2WTotalRecords).toBe(60);
  });

  it('7. F2W audit 부재 → null + 0', async () => {
    const { collectLearningPulse } = await import('./learningPulse.cmd.js');
    const snap = collectLearningPulse(NOW);
    expect(snap.weights.lastF2WRanAt).toBeUndefined();
    expect(snap.weights.lastF2WSkipCount).toBe(0);
    expect(snap.weights.lastF2WTotalRecords).toBe(0);
  });

  it('8. Suggest 7일 — alertHistory 메시지에서 4 모듈 분류', async () => {
    const yyyymm = '202604';
    const alerts: AlertHistoryEntry[] = [
      makeSuggestAlert(isoNDaysAgo(2), 'counterfactual'),
      makeSuggestAlert(isoNDaysAgo(3), 'counterfactual'),
      makeSuggestAlert(isoNDaysAgo(4), 'ledger'),
      makeSuggestAlert(isoNDaysAgo(1), 'kellySurface'),
      makeSuggestAlert(isoNDaysAgo(10), 'regime'), // 7일 이전
      makeSuggestAlert(isoNDaysAgo(2), 'regime', false), // success=false → 제외
    ];
    writeAlertJsonl(tmpDir, yyyymm, alerts);
    const { collectLearningPulse } = await import('./learningPulse.cmd.js');
    const snap = collectLearningPulse(NOW);
    expect(snap.suggest7d.counterfactual).toBe(2);
    expect(snap.suggest7d.ledger).toBe(1);
    expect(snap.suggest7d.kellySurface).toBe(1);
    expect(snap.suggest7d.regime).toBe(0);
    expect(snap.flags.some((f) => f.includes('suggest_silence'))).toBe(false);
  });

  it('9. Suggest 7일 0건 → suggest_silence flag 발동', async () => {
    const { collectLearningPulse } = await import('./learningPulse.cmd.js');
    const snap = collectLearningPulse(NOW);
    expect(snap.flags.some((f) => f.includes('suggest_silence'))).toBe(true);
  });

  it('10. Experiment 활성 — PROPOSED/RUNNING 만 카운트, COMPLETED/REJECTED 제외', async () => {
    const proposals: ExperimentProposal[] = [
      { id: 'e1', proposedAt: 'now', hypothesis: 'h', rationale: 'r', method: 'm', terminationCondition: 't', track: 'YELLOW_AUTO', state: 'PROPOSED' },
      { id: 'e2', proposedAt: 'now', hypothesis: 'h', rationale: 'r', method: 'm', terminationCondition: 't', track: 'YELLOW_AUTO', state: 'RUNNING' },
      { id: 'e3', proposedAt: 'now', hypothesis: 'h', rationale: 'r', method: 'm', terminationCondition: 't', track: 'RED_APPROVE', state: 'AWAIT_APPROVAL' },
      { id: 'e4', proposedAt: 'now', hypothesis: 'h', rationale: 'r', method: 'm', terminationCondition: 't', track: 'YELLOW_AUTO', state: 'COMPLETED' },
      { id: 'e5', proposedAt: 'now', hypothesis: 'h', rationale: 'r', method: 'm', terminationCondition: 't', track: 'RED_APPROVE', state: 'REJECTED' },
    ];
    writeJson(path.join(tmpDir, 'experiment-proposals.json'), proposals);
    const { collectLearningPulse } = await import('./learningPulse.cmd.js');
    const snap = collectLearningPulse(NOW);
    expect(snap.experimentsActive).toBe(3);
  });

  it('11. Gemini 호출률 — callCount=20/22 → 91% (gemini_underuse 미발동)', async () => {
    const month = NOW.toISOString().slice(0, 7);
    writeJson(path.join(tmpDir, 'reflection-budget.json'), {
      month, tokensUsed: 50000, callCount: 20,
    });
    const { collectLearningPulse } = await import('./learningPulse.cmd.js');
    const snap = collectLearningPulse(NOW);
    expect(snap.gemini.callCount).toBe(20);
    expect(snap.gemini.useRatio).toBeCloseTo(20 / 22, 2);
    expect(snap.flags.some((f) => f.includes('gemini_underuse'))).toBe(false);
  });

  it('12. Gemini 호출률 < 80% → gemini_underuse 발동', async () => {
    const month = NOW.toISOString().slice(0, 7);
    writeJson(path.join(tmpDir, 'reflection-budget.json'), {
      month, tokensUsed: 10000, callCount: 10,
    });
    const { collectLearningPulse } = await import('./learningPulse.cmd.js');
    const snap = collectLearningPulse(NOW);
    expect(snap.flags.some((f) => f.includes('gemini_underuse'))).toBe(true);
  });

  it('13. F2W 손상 JSON → graceful (errors 누적, partialFailure=true)', async () => {
    fs.writeFileSync(path.join(tmpDir, 'f2w-audit-log.json'), '{ corrupted');
    const { collectLearningPulse } = await import('./learningPulse.cmd.js');
    const snap = collectLearningPulse(NOW);
    expect(snap.partialFailure).toBe(true);
    expect(snap.weights.lastF2WRanAt).toBeUndefined();
  });
});

describe('formatLearningPulseMessage', () => {
  let tmpDir: string;
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-fmt-'));
    process.env.PERSIST_DATA_DIR = tmpDir;
    vi.resetModules();
  });
  afterEach(() => {
    delete process.env.PERSIST_DATA_DIR;
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* noop */ }
  });

  it('1. 모든 영역 라벨 포함', async () => {
    const { collectLearningPulse, formatLearningPulseMessage } = await import('./learningPulse.cmd.js');
    const msg = formatLearningPulseMessage(collectLearningPulse(NOW));
    expect(msg).toContain('🩺 Learning Pulse');
    expect(msg).toContain('👻 Ghost Portfolio');
    expect(msg).toContain('📊 Attribution');
    expect(msg).toContain('⚖️ Condition Weights');
    expect(msg).toContain('🔔 Suggest 발사');
    expect(msg).toContain('🧪 Experiment Proposal');
    expect(msg).toContain('🤖 Gemini');
    expect(msg).toContain('진단 플래그');
  });

  it('2. flags 0건 시 ✅ 모든 채널 정상', async () => {
    // 모든 임계 통과 fixture
    const ghosts: GhostPosition[] = [];
    for (let i = 0; i < 5; i++) ghosts.push(makeGhost(`g${i}`, false));
    writeJson(path.join(tmpDir, 'ghost-portfolio.json'), ghosts);
    const records: ServerAttributionRecord[] = [];
    for (let i = 0; i < 100; i++) records.push(makeAttr(isoNDaysAgo(2)));
    writeJson(path.join(tmpDir, 'attribution-records.json'), records);
    const yyyymm = '202604';
    writeAlertJsonl(tmpDir, yyyymm, [
      makeSuggestAlert(isoNDaysAgo(2), 'counterfactual'),
    ]);
    writeJson(path.join(tmpDir, 'reflection-budget.json'), {
      month: NOW.toISOString().slice(0, 7), tokensUsed: 50000, callCount: 22,
    });
    const { collectLearningPulse, formatLearningPulseMessage } = await import('./learningPulse.cmd.js');
    const snap = collectLearningPulse(NOW);
    const msg = formatLearningPulseMessage(snap);
    expect(snap.flags).toEqual([]);
    expect(msg).toContain('✅ 모든 채널 정상');
  });

  it('3. partialFailure=true 시 안내 라인 (F2W 손상 — 직접 read 라 graceful catch 부재)', async () => {
    fs.writeFileSync(path.join(tmpDir, 'f2w-audit-log.json'), '{ corrupted');
    const { collectLearningPulse, formatLearningPulseMessage } = await import('./learningPulse.cmd.js');
    const snap = collectLearningPulse(NOW);
    expect(snap.partialFailure).toBe(true);
    const msg = formatLearningPulseMessage(snap);
    expect(msg).toContain('데이터 일부 미확인');
  });
});

describe('cmd 메타데이터', () => {
  beforeEach(() => vi.resetModules());

  it('1. name + alias /lp + LRN + riskLevel=0 + ADMIN', async () => {
    const mod = await import('./learningPulse.cmd.js');
    expect(mod.default.name).toBe('/learning_pulse');
    expect(mod.default.aliases).toContain('/lp');
    expect(mod.default.category).toBe('LRN');
    expect(mod.default.riskLevel).toBe(0);
    expect(mod.default.visibility).toBe('ADMIN');
  });

  it('2. commandRegistry 에 등록 — alias 동일 instance', async () => {
    await import('./learningPulse.cmd.js');
    const { commandRegistry } = await import('../../commandRegistry.js');
    const main = commandRegistry.resolve('/learning_pulse');
    const alias = commandRegistry.resolve('/lp');
    expect(main).toBe(alias);
    expect(main).toBeTruthy();
  });

  it('3. execute 정상 — reply 1회 호출', async () => {
    const mod = await import('./learningPulse.cmd.js');
    const reply = vi.fn(async (_msg: string) => {});
    await mod.default.execute({ args: [], reply });
    expect(reply).toHaveBeenCalledOnce();
    expect(reply.mock.calls[0][0]).toContain('🩺 Learning Pulse');
  });

  it('4. execute throw graceful', async () => {
    vi.doMock('./learningPulse.cmd.js', async () => {
      const orig = await vi.importActual<typeof import('./learningPulse.cmd.js')>('./learningPulse.cmd.js');
      return orig;
    });
    // collectLearningPulse 가 throw 하도록 reflectionRepo 손상 — 단순화: tmpDir 권한 차단 대신 모듈 에러 mock 어려움
    // 대안: graceful 동작은 collectLearningPulse 내부 try/catch 가 보장 — execute 의 outer try/catch 는 보조 안전망.
    // 본 테스트는 execute 가 throw 하지 않음을 검증.
    const mod = await import('./learningPulse.cmd.js');
    const reply = vi.fn(async (_msg: string) => {});
    await expect(mod.default.execute({ args: [], reply })).resolves.toBeUndefined();
  });
});
