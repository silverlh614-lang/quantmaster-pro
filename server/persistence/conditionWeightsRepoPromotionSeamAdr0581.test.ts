// @responsibility ADR-0581 Phase 0~2 — provider seam byte-equivalence + candidate reader 회귀.
import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import fs from 'fs';
import {
  loadConditionWeights,
  loadConditionWeightsByRegime,
  loadCandidateConditionWeights,
  registerLearnedConditionWeightProvider,
  type ConditionWeights,
} from './conditionWeightsRepo.js';
import { DEFAULT_CONDITION_WEIGHTS } from '../quantFilter.js';
import { conditionWeightsCandidateFile, ensureDataDir } from './paths.js';

const FIRST_KEY = Object.keys(DEFAULT_CONDITION_WEIGHTS)[0] as keyof ConditionWeights;
const SENTINEL = 0.123456; // 기본값(1.0)·파일값과 충돌 없는 표식

beforeAll(() => ensureDataDir());
afterEach(() => registerLearnedConditionWeightProvider(null)); // 모듈 전역 상태 누수 차단

describe('ADR-0581 learned condition-weight provider seam', () => {
  it('미등록(기본) 이면 provider 영향 없음 — byte-equivalent', () => {
    registerLearnedConditionWeightProvider(null);
    expect(loadConditionWeights()[FIRST_KEY]).not.toBe(SENTINEL);
    expect(loadConditionWeightsByRegime('R2_BULL')[FIRST_KEY]).not.toBe(SENTINEL);
  });

  it('등록 시 provider 값이 우선되고 defaults 와 머지된다', () => {
    registerLearnedConditionWeightProvider(() => ({ [FIRST_KEY]: SENTINEL } as Partial<ConditionWeights>));
    const w = loadConditionWeights();
    expect(w[FIRST_KEY]).toBe(SENTINEL);
    // 머지: 나머지 키는 기본값 유지(누락 없음)
    expect(Object.keys(w).length).toBe(Object.keys(DEFAULT_CONDITION_WEIGHTS).length);
  });

  it('provider 가 null 반환하면 파일 경로로 폴백', () => {
    registerLearnedConditionWeightProvider(() => null);
    expect(loadConditionWeights()[FIRST_KEY]).not.toBe(SENTINEL);
  });

  it('등록 해제(null) 후 즉시 byte-equivalent 복귀', () => {
    registerLearnedConditionWeightProvider(() => ({ [FIRST_KEY]: SENTINEL } as Partial<ConditionWeights>));
    expect(loadConditionWeights()[FIRST_KEY]).toBe(SENTINEL);
    registerLearnedConditionWeightProvider(null);
    expect(loadConditionWeights()[FIRST_KEY]).not.toBe(SENTINEL);
  });

  it('regime provider 는 regime 인자를 받는다', () => {
    const seen: Array<string | undefined> = [];
    registerLearnedConditionWeightProvider((regime) => { seen.push(regime); return null; });
    loadConditionWeights();
    loadConditionWeightsByRegime('R5_CAUTION');
    expect(seen).toContain(undefined);
    expect(seen).toContain('R5_CAUTION');
  });
});

describe('ADR-0581 candidate weights reader', () => {
  const regime = 'ADR0581_SEAM_TEST';
  const file = conditionWeightsCandidateFile(regime);
  afterEach(() => { if (fs.existsSync(file)) fs.unlinkSync(file); });

  it('candidate 파일 부재 시 null', () => {
    if (fs.existsSync(file)) fs.unlinkSync(file);
    expect(loadCandidateConditionWeights(regime)).toBeNull();
  });

  it('candidate 파일을 읽어 반환 (signalCalibrator 가 쓴 것과 동일 경로)', () => {
    ensureDataDir();
    fs.writeFileSync(file, JSON.stringify({ [FIRST_KEY]: 0.7 }));
    expect(loadCandidateConditionWeights(regime)).toEqual({ [FIRST_KEY]: 0.7 });
  });

  it('손상 JSON 이면 null (silent, no throw)', () => {
    ensureDataDir();
    fs.writeFileSync(file, '{ not valid json');
    expect(loadCandidateConditionWeights(regime)).toBeNull();
  });
});
