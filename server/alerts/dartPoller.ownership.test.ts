/**
 * dartPoller.ownership.test.ts
 * 지분 공시 필터 및 룰 기반 수급 분석 테스트
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  IGNORE_DISCLOSURES,
  isOwnershipDisclosure,
  analyzeOwnershipChange,
} from './dartPoller.js';

// analyzeOwnershipChange는 LLM fallback 경로가 있으므로
// GEMINI_API_KEY 없는 환경에서 동작을 보장한다.
beforeEach(() => {
  delete process.env.GEMINI_API_KEY;
});

// ── IGNORE_DISCLOSURES 상수 ────────────────────────────────────────────────

describe('IGNORE_DISCLOSURES', () => {
  it('should contain all required ownership keywords', () => {
    expect(IGNORE_DISCLOSURES).toContain('임원');
    expect(IGNORE_DISCLOSURES).toContain('주요주주');
    expect(IGNORE_DISCLOSURES).toContain('소유상황');
    expect(IGNORE_DISCLOSURES).toContain('특정증권');
    expect(IGNORE_DISCLOSURES).toContain('지분공시');
    expect(IGNORE_DISCLOSURES).toContain('주식등의 대량보유');
    expect(IGNORE_DISCLOSURES).toContain('변동보고서');
  });
});

// ── isOwnershipDisclosure ──────────────────────────────────────────────────

describe('isOwnershipDisclosure', () => {
  it('detects 임원ㆍ주요주주특정증권등소유상황보고서', () => {
    expect(isOwnershipDisclosure('임원ㆍ주요주주특정증권등소유상황보고서')).toBe(true);
  });

  it('detects 주요주주특정증권등소유상황보고서', () => {
    expect(isOwnershipDisclosure('주요주주특정증권등소유상황보고서')).toBe(true);
  });

  it('detects 주식등의 대량보유상황보고서', () => {
    expect(isOwnershipDisclosure('주식등의 대량보유상황보고서')).toBe(true);
  });

  it('detects 변동보고서', () => {
    expect(isOwnershipDisclosure('[기재정정]주식등의대량보유상황보고서(일반)_변동보고서')).toBe(true);
  });

  it('returns false for unrelated disclosures', () => {
    expect(isOwnershipDisclosure('무상증자 결정')).toBe(false);
    expect(isOwnershipDisclosure('영업이익 잠정실적 공시')).toBe(false);
    expect(isOwnershipDisclosure('자기주식취득결정')).toBe(false);
  });
});

// ── analyzeOwnershipChange ─────────────────────────────────────────────────

describe('analyzeOwnershipChange', () => {
  it('classifies buy (장내매수) as POSITIVE', async () => {
    const result = await analyzeOwnershipChange('삼성전자', '임원 장내매수 보고서');
    expect(result.sentiment).toBe('POSITIVE');
    expect(result.reason).toContain('삼성전자');
  });

  it('classifies acquisition (취득) as POSITIVE', async () => {
    const result = await analyzeOwnershipChange('카카오', '대표이사 주식 취득 보고');
    expect(result.sentiment).toBe('POSITIVE');
  });

  it('classifies sell (장내매도) as NEGATIVE', async () => {
    const result = await analyzeOwnershipChange('LG화학', '대주주 장내매도 보고서');
    expect(result.sentiment).toBe('NEGATIVE');
    expect(result.reason).toContain('LG화학');
  });

  it('classifies disposal (처분) as NEGATIVE', async () => {
    const result = await analyzeOwnershipChange('현대차', '임원 주식 처분 보고');
    expect(result.sentiment).toBe('NEGATIVE');
  });

  it('classifies plain ownership report as NEUTRAL (no LLM key)', async () => {
    const result = await analyzeOwnershipChange('네이버', '임원ㆍ주요주주특정증권등소유상황보고서');
    expect(result.sentiment).toBe('NEUTRAL');
    expect(result.reason).toContain('소폭 변동');
  });

  it('returns reason string for all sentiments', async () => {
    const pos = await analyzeOwnershipChange('A', '장내매수');
    expect(typeof pos.reason).toBe('string');
    expect(pos.reason.length).toBeGreaterThan(0);

    const neg = await analyzeOwnershipChange('B', '장내매도');
    expect(typeof neg.reason).toBe('string');
    expect(neg.reason.length).toBeGreaterThan(0);

    const neu = await analyzeOwnershipChange('C', '소유상황보고서');
    expect(typeof neu.reason).toBe('string');
    expect(neu.reason.length).toBeGreaterThan(0);
  });
});
