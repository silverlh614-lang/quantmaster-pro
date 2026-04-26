import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'decision-replay-'));
process.env.PERSIST_DATA_DIR = tmpDir;

const mod = await import('./decisionReplayLog.js');
const { recordDecision, listDecisions, findDecision, replayDecision, replayDay } = mod;
type DecisionSnapshot = Parameters<typeof recordDecision>[0];

afterAll(() => {
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* noop */ }
});

beforeEach(() => {
  // 테스트 격리 — 디렉토리 청소.
  try {
    for (const f of fs.readdirSync(tmpDir)) {
      if (f.startsWith('decision-replay-')) fs.rmSync(path.join(tmpDir, f), { force: true });
    }
  } catch { /* noop */ }
});

function mkSnap(overrides: Partial<DecisionSnapshot> = {}): DecisionSnapshot {
  const at = overrides.at ?? new Date().toISOString();
  return {
    id: overrides.id ?? `BUY:005930:${at}:1`,
    at,
    kind: 'BUY',
    symbol: '005930',
    price: 70000,
    gateScores: { G0: 1, G1: 1, G2: 0.8, G3: 0.5 },
    weights: { momentum: 1.0, breakout: 0.5 },
    macro: { regime: 'R2_BULL', vix: 15 },
    outcome: { action: 'EXECUTE', reason: 'gate_pass', qty: 100 },
    aiInvolved: false,
    ...overrides,
  };
}

describe('decisionReplayLog', () => {
  it('recordDecision 후 listDecisions 가 동일 스냅샷 반환', () => {
    const snap = mkSnap();
    recordDecision(snap);
    const list = listDecisions(new Date(snap.at));
    expect(list.length).toBe(1);
    expect(list[0].id).toBe(snap.id);
  });

  it('같은 일자 다중 결정 — JSONL append', () => {
    const at = new Date().toISOString();
    recordDecision(mkSnap({ id: 'a', at }));
    recordDecision(mkSnap({ id: 'b', at }));
    recordDecision(mkSnap({ id: 'c', at }));
    expect(listDecisions(new Date(at)).length).toBe(3);
  });

  it('findDecision 은 ID 로 검색 후 스냅샷 반환', () => {
    const at = new Date().toISOString();
    recordDecision(mkSnap({ id: 'find-me', at }));
    const found = findDecision('find-me');
    expect(found).not.toBeNull();
    expect(found!.id).toBe('find-me');
  });

  it('findDecision — 없는 id 는 null', () => {
    expect(findDecision('non-existent')).toBeNull();
  });

  it('replayDecision — 같은 결과 evaluator → match=true', () => {
    const snap = mkSnap({ id: 'replay-1' });
    recordDecision(snap);
    const result = replayDecision('replay-1', { evaluator: (s) => s.outcome });
    expect(result.found).toBe(true);
    if (result.found) {
      expect(result.match).toBe(true);
    }
  });

  it('replayDecision — 다른 결과 evaluator → match=false', () => {
    const snap = mkSnap({ id: 'replay-2' });
    recordDecision(snap);
    const result = replayDecision('replay-2', {
      evaluator: () => ({ action: 'SKIP' as const }),
    });
    expect(result.found).toBe(true);
    if (result.found) {
      expect(result.match).toBe(false);
      expect(result.original.action).toBe('EXECUTE');
      expect(result.recomputed.action).toBe('SKIP');
    }
  });

  it('replayDecision — 없는 id 는 found=false', () => {
    const result = replayDecision('missing', { evaluator: (s) => s.outcome });
    expect(result.found).toBe(false);
  });

  it('replayDecision — aiInvolved 마킹 보존', () => {
    recordDecision(mkSnap({ id: 'ai-1', aiInvolved: true }));
    recordDecision(mkSnap({ id: 'det-1', aiInvolved: false }));
    const ai = replayDecision('ai-1', { evaluator: (s) => s.outcome });
    const det = replayDecision('det-1', { evaluator: (s) => s.outcome });
    expect(ai.found && ai.aiInvolved).toBe(true);
    expect(det.found && det.aiInvolved).toBe(false);
  });

  it('replayDay — mismatch 통계 + AI vs deterministic 분리', () => {
    const at = new Date().toISOString();
    recordDecision(mkSnap({ id: 'a', at, aiInvolved: false, outcome: { action: 'EXECUTE' } }));
    recordDecision(mkSnap({ id: 'b', at, aiInvolved: true,  outcome: { action: 'EXECUTE' } }));
    recordDecision(mkSnap({ id: 'c', at, aiInvolved: false, outcome: { action: 'SKIP' } }));
    // evaluator 가 모두 EXECUTE 로 단일 — c 가 mismatch (deterministic), b 는 match.
    const report = replayDay(new Date(at), { evaluator: () => ({ action: 'EXECUTE' as const }) });
    expect(report.total).toBe(3);
    expect(report.matched).toBe(2);
    expect(report.mismatched).toBe(1);
    expect(report.deterministicMismatched).toBe(1);
    expect(report.aiInvolvedMismatched).toBe(0);
  });

  it('잘린 JSONL 라인은 건너뜀 (조용한 손상 차단)', () => {
    const at = new Date().toISOString();
    recordDecision(mkSnap({ id: 'good-1', at }));
    // 일부러 손상된 라인 추가
    const ymd = new Date(at).toISOString().slice(0, 10).replace(/-/g, '');
    const file = path.join(tmpDir, `decision-replay-${ymd}.jsonl`);
    fs.appendFileSync(file, '{"id":"truncated', 'utf-8');
    fs.appendFileSync(file, '\n', 'utf-8');
    recordDecision(mkSnap({ id: 'good-2', at }));
    const list = listDecisions(new Date(at));
    expect(list.length).toBe(2); // 깨진 라인 제외
    expect(list.map((s) => s.id).sort()).toEqual(['good-1', 'good-2']);
  });
});
