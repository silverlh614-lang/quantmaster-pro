/**
 * @responsibility ADR-0128 dartCorpEventClassifier 회귀 테스트 — 5 분류 + lookback 매트릭스 + ENV 우회
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  classifyDartCorpEvent,
  CORP_EVENT_LOOKBACK_DAYS,
  getCorpEventLookback,
  isDartCorpEventLookbackDisabled,
} from './dartCorpEventClassifier.js';

const ENV_KEY = 'DART_CORP_EVENT_LOOKBACK_DISABLED';

beforeEach(() => {
  delete process.env[ENV_KEY];
});

afterEach(() => {
  delete process.env[ENV_KEY];
});

describe('classifyDartCorpEvent — 5 분류 매트릭스', () => {
  it('STOCK_SPLIT — 액면분할 / 주식분할 / split (대소문자 무관)', () => {
    expect(classifyDartCorpEvent('액면분할 결정')).toBe('STOCK_SPLIT');
    expect(classifyDartCorpEvent('주식분할 결정')).toBe('STOCK_SPLIT');
    expect(classifyDartCorpEvent('Stock Split Notice')).toBe('STOCK_SPLIT');
    expect(classifyDartCorpEvent('SPLIT 공시')).toBe('STOCK_SPLIT');
  });

  it('STOCK_MERGE — 액면병합 / 주식병합 / merge', () => {
    expect(classifyDartCorpEvent('액면병합 결정')).toBe('STOCK_MERGE');
    expect(classifyDartCorpEvent('주식병합 공시')).toBe('STOCK_MERGE');
    expect(classifyDartCorpEvent('Reverse merge notice')).toBe('STOCK_MERGE');
  });

  it('RIGHTS_OFFERING — 유상증자 / 신주인수권 / 권리락', () => {
    expect(classifyDartCorpEvent('유상증자 결정')).toBe('RIGHTS_OFFERING');
    expect(classifyDartCorpEvent('신주인수권 발행')).toBe('RIGHTS_OFFERING');
    expect(classifyDartCorpEvent('권리락 공시')).toBe('RIGHTS_OFFERING');
  });

  it('NEW_SHARES — 신주발행 / 주식배당', () => {
    expect(classifyDartCorpEvent('신주발행 결정')).toBe('NEW_SHARES');
    expect(classifyDartCorpEvent('주식배당 공시')).toBe('NEW_SHARES');
  });

  it('GENERAL — 그 외 (실적공시 / 일반 공시 / 임시주총)', () => {
    expect(classifyDartCorpEvent('영업실적 공시')).toBe('GENERAL');
    expect(classifyDartCorpEvent('임시주주총회 소집')).toBe('GENERAL');
    expect(classifyDartCorpEvent('단일판매·공급계약 체결')).toBe('GENERAL');
  });

  it('빈 입력 / null / undefined → GENERAL (안전 default)', () => {
    expect(classifyDartCorpEvent('')).toBe('GENERAL');
    expect(classifyDartCorpEvent('   ')).toBe('GENERAL');
    expect(classifyDartCorpEvent(null)).toBe('GENERAL');
    expect(classifyDartCorpEvent(undefined)).toBe('GENERAL');
  });

  it('우선순위 — 분할 키워드가 병합 키워드보다 먼저 매칭', () => {
    // 둘 다 포함된 인위적 케이스 — 분할이 먼저 매칭되어야 함
    expect(classifyDartCorpEvent('액면분할 후 액면병합')).toBe('STOCK_SPLIT');
  });
});

describe('CORP_EVENT_LOOKBACK_DAYS — 매트릭스 SSOT', () => {
  it('5종 lookback 정확 (사용자 정책 #5)', () => {
    expect(CORP_EVENT_LOOKBACK_DAYS.STOCK_SPLIT).toBe(90);
    expect(CORP_EVENT_LOOKBACK_DAYS.STOCK_MERGE).toBe(60);
    expect(CORP_EVENT_LOOKBACK_DAYS.RIGHTS_OFFERING).toBe(30);
    expect(CORP_EVENT_LOOKBACK_DAYS.NEW_SHARES).toBe(14);
    expect(CORP_EVENT_LOOKBACK_DAYS.GENERAL).toBe(7);
  });
});

describe('getCorpEventLookback — 통합 산출', () => {
  it('정상 — 분류 후 lookback 매핑', () => {
    expect(getCorpEventLookback('액면분할 결정')).toEqual({
      eventType: 'STOCK_SPLIT', lookbackDays: 90,
    });
    expect(getCorpEventLookback('유상증자')).toEqual({
      eventType: 'RIGHTS_OFFERING', lookbackDays: 30,
    });
    expect(getCorpEventLookback('영업실적')).toEqual({
      eventType: 'GENERAL', lookbackDays: 7,
    });
  });

  it('ENV 우회 → 모든 입력 GENERAL=7', () => {
    process.env[ENV_KEY] = 'true';
    expect(isDartCorpEventLookbackDisabled()).toBe(true);
    // 분할 키워드여도 GENERAL=7 (회로 무력화)
    expect(getCorpEventLookback('액면분할 결정')).toEqual({
      eventType: 'GENERAL', lookbackDays: 7,
    });
    expect(getCorpEventLookback('유상증자')).toEqual({
      eventType: 'GENERAL', lookbackDays: 7,
    });
  });

  it('ENV 미설정 시 isDartCorpEventLookbackDisabled=false', () => {
    expect(isDartCorpEventLookbackDisabled()).toBe(false);
    process.env[ENV_KEY] = 'false';
    expect(isDartCorpEventLookbackDisabled()).toBe(false); // 'true' 만 활성
  });
});
