// @responsibility Verify autonomous proposal budgets, chronology, isolation and durable recovery.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../clients/geminiClient.js', () => ({ callGeminiText: vi.fn(() => { throw new Error('Tests must inject the generator'); }) }));
import { parsePaperProgramProposals, paperProgramResearchPrompt, queuePaperProgramResearch, readPaperProgramProposals, readPaperProgramResearch } from './paperProgramResearch.js';
import { selectPaperAdaptiveState } from './paperAdaptiveSelection.js';
import { matureAdaptiveSamples } from './paperAdaptiveFixtures.js';

const asOf = '2026-09-18T08:00:00.000Z';
const definition = { title: '가격 힘 대비 거래량', hypothesis: '거래량과 가격 힘의 차이를 연구합니다.', interpretation: '거래량이 크고 RSI 이탈 폭이 작을수록 높습니다.',
  limitation: '하락 중 거래량 증가를 구분하지 못할 수 있습니다.', expression: { op: 'subtract', left: { op: 'feature', key: 'volumeRatio20' }, right: { op: 'abs', value: { op: 'feature', key: 'rsi14' } } } };
const response = JSON.stringify([definition]);
let directory: string;
beforeEach(() => { directory = fs.mkdtempSync(path.join(os.tmpdir(), 'qmp-program-test-')); });
afterEach(() => { fs.rmSync(directory, { recursive: true, force: true }); vi.restoreAllMocks(); });
const state = () => selectPaperAdaptiveState(undefined, matureAdaptiveSamples(), asOf);
const options = () => ({ directory, asOf, marketOpen: false, now: () => '2026-09-18T08:00:10.000Z' });

describe('AI research proposal lifecycle', () => {
  it('accepts strict JSON proposals and rejects oversized or executable outputs', () => {
    expect(parsePaperProgramProposals('```json\n' + response + '\n```')).toHaveLength(1);
    for (const raw of ['function x() {}', '{}', JSON.stringify([definition, definition, definition]),
      JSON.stringify([{ ...definition, expression: { op: 'require', module: 'fs' } }])]) expect(() => parsePaperProgramProposals(raw)).toThrow();
  });
  it('does not expose validation returns, individual IDs or transactions in prompts', () => {
    const adaptive = state();
    adaptive.candidates[0].validation.meanNetReturnPct = 987654321;
    adaptive.candidates[0].validation.experimentIds = ['validation-secret'];
    const prompt = paperProgramResearchPrompt(adaptive, []);
    expect(prompt).not.toContain('987654321'); expect(prompt).not.toContain('validation-secret');
    expect(prompt).not.toContain(adaptive.candidates[0].training.experimentIds![0]);
    expect(prompt).toContain('학습 구간 집계');
  });
  it('claims before generation, coalesces overlap and persists the daily limit across callers', async () => {
    let finish!: (value: string) => void;
    const generate = vi.fn(() => new Promise<string>(resolve => { finish = resolve; }));
    const work = queuePaperProgramResearch(state(), { ...options(), generate });
    expect(readPaperProgramResearch(undefined, directory).state).toBe('RUNNING');
    expect(queuePaperProgramResearch(state(), { ...options(), generate })).toBe(work);
    finish(response); await work;
    await queuePaperProgramResearch(state(), { ...options(), generate });
    expect(generate).toHaveBeenCalledTimes(1);
    expect(readPaperProgramResearch(undefined, directory)).toMatchObject({ state: 'READY', proposals: [{ registered: false }] });
    expect(readPaperProgramProposals(directory)[0].generatedAt).toBe('2026-09-18T08:00:10.000Z');
  });
  it('skips market hours, empty training and unchanged successful inputs on later days', async () => {
    const generate = vi.fn(async () => response);
    await queuePaperProgramResearch(state(), { ...options(), marketOpen: true, generate });
    await queuePaperProgramResearch(selectPaperAdaptiveState(undefined, [], asOf), { ...options(), generate });
    expect(generate).not.toHaveBeenCalled();
    await queuePaperProgramResearch(state(), { ...options(), generate });
    await queuePaperProgramResearch(state(), { ...options(), asOf: '2026-09-19T08:00:00Z', generate });
    expect(generate).toHaveBeenCalledTimes(1);
  });
  it('reports failures without fabricating candidates, then retries on a later date', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const generate = vi.fn(async () => null as string | null);
    await queuePaperProgramResearch(state(), { ...options(), generate });
    expect(readPaperProgramResearch(undefined, directory).state).toBe('FAILED');
    expect(readPaperProgramProposals(directory)).toEqual([]);
    await queuePaperProgramResearch(state(), { ...options(), generate });
    expect(generate).toHaveBeenCalledTimes(1);
    generate.mockResolvedValue(response);
    await queuePaperProgramResearch(state(), { ...options(), asOf: '2026-09-19T08:00:00Z', now: () => '2026-09-19T08:00:10Z', generate });
    expect(generate).toHaveBeenCalledTimes(2); expect(readPaperProgramResearch(undefined, directory).state).toBe('READY');
  });
  it('feeds training rejection back into the next research attempt without reusing the same program', async () => {
    const adaptive = state(), generate = vi.fn(async (_prompt: string) => response);
    await queuePaperProgramResearch(adaptive, { ...options(), generate });
    const proposal = readPaperProgramProposals(directory)[0];
    const id = `invented:program:${proposal.formula.digest}` as const;
    adaptive.discovery!.programAttemptedIds = [id];
    adaptive.discovery!.programReviews = [{ id, at: asOf, status: 'NO_TRAINING_EDGE', sampleCount: 20, dateCount: 4, meanDailyExcessPct: -0.25 }];
    await queuePaperProgramResearch(adaptive, { ...options(), asOf: '2026-09-19T08:00:00Z', now: () => '2026-09-19T08:00:10Z', generate });
    expect(generate).toHaveBeenCalledTimes(2);
    expect(generate.mock.calls[1][0]).toContain('NO_TRAINING_EDGE');
    expect(readPaperProgramProposals(directory)).toHaveLength(1);
    expect(readPaperProgramResearch(adaptive, directory).proposals[0]).toMatchObject({ registered: false, evaluated: true });
  });
  it('keeps previous candidates when a new generation fails and blocks corrupted files', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const generate = vi.fn(async () => response), adaptive = state();
    await queuePaperProgramResearch(adaptive, { ...options(), generate });
    adaptive.candidates[0].training.meanNetReturnPct! += 1;
    generate.mockResolvedValue('bad json');
    await queuePaperProgramResearch(adaptive, { ...options(), asOf: '2026-09-19T08:00:00Z', now: () => '2026-09-19T08:00:10Z', generate });
    expect(readPaperProgramProposals(directory)).toHaveLength(1);
    const target = path.join(directory, 'paper-program-research.json'); fs.writeFileSync(target, '{broken');
    await queuePaperProgramResearch(adaptive, { ...options(), asOf: '2026-09-20T08:00:00Z', generate });
    expect(generate).toHaveBeenCalledTimes(2); expect(fs.readFileSync(target, 'utf8')).toBe('{broken');
    expect(readPaperProgramProposals(directory)).toEqual([]); expect(readPaperProgramResearch(undefined, directory).state).toBe('FAILED');
  });
});
