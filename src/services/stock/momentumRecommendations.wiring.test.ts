/**
 * @responsibility momentumRecommendations PR-25-B / PR-37 / PR-38 wiring 단위 테스트
 */
import { describe, it, expect } from 'vitest';
import {
  flattenCandidates,
  toUniverseMode,
  buildUniverseRuleLine,
  buildUniverseWarning,
  getUniverseConfidenceGrade,
} from './momentumRecommendations';
import type { AiUniverseDiscoverResult } from '../../api/aiUniverseClient';

describe('momentumRecommendations — toUniverseMode (PR-25-B / PR-39)', () => {
  it('EARLY_DETECT 는 그대로', () => {
    expect(toUniverseMode('EARLY_DETECT')).toBe('EARLY_DETECT');
  });

  it('PR-39: SMALL_MID_CAP 은 서버 정규 mode 로 그대로 위임 (이전엔 MOMENTUM 으로 흡수)', () => {
    expect(toUniverseMode('SMALL_MID_CAP')).toBe('SMALL_MID_CAP');
  });

  it('MOMENTUM / 기타 → MOMENTUM', () => {
    expect(toUniverseMode('MOMENTUM')).toBe('MOMENTUM');
    expect(toUniverseMode('UNKNOWN_MODE')).toBe('MOMENTUM');
  });
});

describe('momentumRecommendations — flattenCandidates (PR-25-B)', () => {
  it('null universe 는 빈 배열', () => {
    expect(flattenCandidates(null)).toEqual([]);
  });

  it('snapshot 있으면 PER/PBR/시총/등락률 매핑', () => {
    const universe: AiUniverseDiscoverResult = {
      mode: 'MOMENTUM',
      candidates: [
        {
          code: '005930', name: '삼성전자', market: 'KOSPI',
          discoveredFrom: ['m.stock.naver.com', 'hankyung.com'],
          snapshot: {
            code: '005930', name: '삼성전자',
            per: 12.5, pbr: 1.3, eps: 5000, bps: 50000,
            marketCap: 480_0000_0000_0000, marketCapDisplay: '480조',
            dividendYield: 1.8, foreignerOwnRatio: 52.5,
            closePrice: 75000, changeRate: 2.5,
            found: true, source: 'NAVER_MOBILE',
          },
        },
      ],
      fetchedAt: Date.now(),
      diagnostics: {
        googleQueries: 2, googleHits: 5, masterMisses: 0,
        enrichSucceeded: 1, enrichFailed: 0, budgetExceeded: false, sourceStatus: 'GOOGLE_OK', fallbackUsed: false,
      },
    };
    const flat = flattenCandidates(universe);
    expect(flat).toHaveLength(1);
    expect(flat[0]).toMatchObject({
      code: '005930',
      name: '삼성전자',
      market: 'KOSPI',
      changePercent: 2.5,
      rank: 1,
      source: 'm.stock.naver.com',
      per: 12.5,
      pbr: 1.3,
      marketCapDisplay: '480조',
    });
  });

  it('snapshot 없으면 0/빈 문자열로 fallback', () => {
    const universe: AiUniverseDiscoverResult = {
      mode: 'MOMENTUM',
      candidates: [
        {
          code: '999999', name: '테스트', market: 'KOSPI',
          discoveredFrom: [],
          snapshot: null,
        },
      ],
      fetchedAt: Date.now(),
      diagnostics: {
        googleQueries: 1, googleHits: 1, masterMisses: 0,
        enrichSucceeded: 0, enrichFailed: 1, budgetExceeded: false, sourceStatus: 'GOOGLE_OK', fallbackUsed: false,
      },
    };
    const flat = flattenCandidates(universe);
    expect(flat[0]).toMatchObject({
      code: '999999',
      changePercent: 0,
      per: 0,
      pbr: 0,
      marketCapDisplay: '',
      source: 'google_search',
    });
  });

  it('rank 는 배열 인덱스 + 1', () => {
    const universe: AiUniverseDiscoverResult = {
      mode: 'MOMENTUM',
      candidates: [
        { code: '001', name: 'A', market: 'KOSPI', discoveredFrom: ['x'], snapshot: null },
        { code: '002', name: 'B', market: 'KOSPI', discoveredFrom: ['y'], snapshot: null },
        { code: '003', name: 'C', market: 'KOSPI', discoveredFrom: ['z'], snapshot: null },
      ],
      fetchedAt: Date.now(),
      diagnostics: {
        googleQueries: 1, googleHits: 3, masterMisses: 0,
        enrichSucceeded: 0, enrichFailed: 3, budgetExceeded: false, sourceStatus: 'GOOGLE_OK', fallbackUsed: false,
      },
    };
    const flat = flattenCandidates(universe);
    expect(flat.map(c => c.rank)).toEqual([1, 2, 3]);
  });
});

describe('momentumRecommendations — buildUniverseRuleLine (PR-37 ADR-0016)', () => {
  it('GOOGLE_OK 는 엄격한 universe 한정 룰', () => {
    const line = buildUniverseRuleLine('GOOGLE_OK', 5, false);
    expect(line).toContain('이 목록 외 종목은 추천 금지');
  });

  it('FALLBACK_SNAPSHOT 은 직전 거래일 표시 + 학습 지식 확장 허용', () => {
    const line = buildUniverseRuleLine('FALLBACK_SNAPSHOT', 5, true, '2026-04-24');
    expect(line).toContain('2026-04-24');
    expect(line).toContain('직전 정상 거래일');
    expect(line).toContain('학습 지식');
  });

  it('FALLBACK_QUANT 는 Yahoo OHLCV 정량 후보 + metric 이름 명시 + 보수적 BUY/STRONG_BUY 지시 (PR-38)', () => {
    const line = buildUniverseRuleLine('FALLBACK_QUANT', 10, true);
    expect(line).toContain('Yahoo OHLCV');
    expect(line).toContain('metric');
    // PR-38: metric 이름이 프롬프트에 명시되어 AI 가 어떤 수치를 검토해야 하는지 모호함 제거
    expect(line).toContain('momentum20d');
    expect(line).toContain('avgTurnoverKrw');
    expect(line).toContain('volatility20d');
    expect(line).toContain('drawdownFromHigh');
    expect(line).toContain('보수적');
  });

  it('FALLBACK_NAVER 는 펀더멘털 단독 + 뉴스 비활성 명시', () => {
    const line = buildUniverseRuleLine('FALLBACK_NAVER', 8, true);
    expect(line).toContain('Naver Finance');
    expect(line).toContain('뉴스 분석은 비활성');
  });

  it('FALLBACK_SEED 는 하드코딩 대표주 seed 명시 + 신뢰도 낮음 + 보수적 추천 지시 (PR-38)', () => {
    const line = buildUniverseRuleLine('FALLBACK_SEED', 24, true);
    // PR-38: FALLBACK_SEED 는 정량 산출 결과가 아니라 하드코딩 KOSPI/KOSDAQ 대표주 seed
    expect(line).toContain('seed');
    expect(line).toContain('하드코딩');
    expect(line).toContain('대표주');
    expect(line).toContain('정량 metric');
    expect(line).toContain('신뢰도');
    expect(line).toContain('보수적');
    // ADR §6 금지 표현 유지
    expect(line).not.toContain('baseline');
    expect(line).not.toContain('시총 상위');
    // PR-38: "마지막 거래일 정량 데이터" 라는 잘못된 표기는 제거됐다
    expect(line).not.toContain('마지막 거래일 기준 정량 데이터');
  });

  it('NOT_CONFIGURED / BUDGET_EXCEEDED / ERROR / NO_MATCHES 는 동일 폴백 문구 (FALLBACK_SEED 와 분리)', () => {
    const a = buildUniverseRuleLine('NOT_CONFIGURED', 10, true);
    const b = buildUniverseRuleLine('BUDGET_EXCEEDED', 10, true);
    const c = buildUniverseRuleLine('ERROR', 10, true);
    const d = buildUniverseRuleLine('NO_MATCHES', 10, true);
    [a, b, c, d].forEach(line => {
      expect(line).toContain('마지막 거래일');
      expect(line).toContain('Yahoo/Naver/KRX');
      expect(line).not.toContain('baseline');
      // PR-38: FALLBACK_SEED 와는 별도 분기여야 한다 (하드코딩 seed 표기 없음)
      expect(line).not.toContain('하드코딩');
    });
  });

  it('sourceStatus 미제공 (구버전 서버) 는 candidates/fallbackUsed 기반 호환 분기', () => {
    expect(buildUniverseRuleLine(undefined, 5, false)).toContain('이 목록 외 종목은 추천 금지');
    expect(buildUniverseRuleLine(undefined, 5, true)).toContain('마지막 거래일');
    expect(buildUniverseRuleLine(undefined, 0, false)).toContain('후보군 없음');
  });
});

describe('momentumRecommendations — buildUniverseWarning (PR-37 ADR-0016 §6)', () => {
  it('GOOGLE_OK / undefined 는 warning 미표시', () => {
    expect(buildUniverseWarning('GOOGLE_OK', false)).toBeNull();
    expect(buildUniverseWarning(undefined, false)).toBeNull();
  });

  it('FALLBACK_SNAPSHOT 은 거래일 + 노화일 표시', () => {
    const msg = buildUniverseWarning('FALLBACK_SNAPSHOT', false, '2026-04-24', 1);
    expect(msg).toContain('2026-04-24');
    expect(msg).toContain('1일');
  });

  it('FALLBACK_QUANT 메시지에 Yahoo OHLCV 출처 + 뉴스 비활성 안내', () => {
    const msg = buildUniverseWarning('FALLBACK_QUANT', false);
    expect(msg).toContain('Yahoo OHLCV');
    expect(msg).toContain('뉴스');
  });

  it('FALLBACK_NAVER 메시지에 Naver Finance 출처', () => {
    const msg = buildUniverseWarning('FALLBACK_NAVER', false);
    expect(msg).toContain('Naver Finance');
  });

  it('FALLBACK_SEED 는 PR-38 권장 문구 — 하드코딩 대표주 seed + 신뢰도 낮음 + 비활성화', () => {
    const msg = buildUniverseWarning('FALLBACK_SEED', false);
    // PR-38: "마지막 거래일 기준 정량 데이터" 표기는 잘못된 정보였으므로 제거.
    // FALLBACK_SEED 는 하드코딩 KOSPI/KOSDAQ 대표주 seed 라는 사실을 사용자에게 명시.
    expect(msg).toContain('seed');
    expect(msg).toContain('하드코딩');
    expect(msg).toContain('신뢰도');
    expect(msg).toContain('비활성화');
    // 금지 표현 없음 + 잘못된 표기 제거
    expect(msg).not.toContain('baseline');
    expect(msg).not.toContain('시총 상위');
    expect(msg).not.toContain('임시 추천');
    expect(msg).not.toContain('fallback seed');
    expect(msg).not.toContain('마지막 거래일 기준 정량 데이터');
  });

  it('NOT_CONFIGURED 는 PR-38 권장 문구 — Google API 미설정 + 폴백 사슬 명시', () => {
    const msg = buildUniverseWarning('NOT_CONFIGURED', false);
    expect(msg).toContain('Google Search API 미설정');
    expect(msg).toContain('비활성화');
    expect(msg).toContain('Naver/KRX 캐시');
    // PR-38: 폴백 사슬을 정확히 표기 (snapshot/정량/Naver/KRX 캐시 우선, 모두 실패 시 seed)
    expect(msg).toContain('snapshot');
    expect(msg).toContain('seed');
    expect(msg).not.toContain('baseline');
  });

  it('BUDGET_EXCEEDED 는 한도 도달 + 자정 복구 안내', () => {
    const msg = buildUniverseWarning('BUDGET_EXCEEDED', true);
    expect(msg).toContain('한도');
    expect(msg).toContain('자정');
    expect(msg).not.toContain('baseline');
  });

  it('ERROR 는 일시 오류 + 빨강 톤 분류 (메시지에 "오류" 포함)', () => {
    const msg = buildUniverseWarning('ERROR', false);
    expect(msg).toContain('오류');
    expect(msg).not.toContain('baseline');
  });

  it('NO_MATCHES 는 KRX 매칭 0건 안내', () => {
    const msg = buildUniverseWarning('NO_MATCHES', false);
    expect(msg).toContain('KRX 마스터');
    expect(msg).not.toContain('baseline');
  });
});

describe('momentumRecommendations — getUniverseConfidenceGrade (PR-38)', () => {
  it('candidates=0 은 항상 UNAVAILABLE (sourceStatus 무관)', () => {
    expect(getUniverseConfidenceGrade('GOOGLE_OK', 0)).toBe('UNAVAILABLE');
    expect(getUniverseConfidenceGrade('FALLBACK_SEED', 0)).toBe('UNAVAILABLE');
    expect(getUniverseConfidenceGrade(undefined, 0)).toBe('UNAVAILABLE');
  });

  it('GOOGLE_OK 는 A', () => {
    expect(getUniverseConfidenceGrade('GOOGLE_OK', 5)).toBe('A');
  });

  it('FALLBACK_SNAPSHOT 은 노화일 기반 A-/B+/B 분기', () => {
    expect(getUniverseConfidenceGrade('FALLBACK_SNAPSHOT', 5, 0)).toBe('A-');
    expect(getUniverseConfidenceGrade('FALLBACK_SNAPSHOT', 5, 1)).toBe('A-');
    expect(getUniverseConfidenceGrade('FALLBACK_SNAPSHOT', 5, 2)).toBe('B+');
    expect(getUniverseConfidenceGrade('FALLBACK_SNAPSHOT', 5, 3)).toBe('B+');
    expect(getUniverseConfidenceGrade('FALLBACK_SNAPSHOT', 5, 4)).toBe('B');
    expect(getUniverseConfidenceGrade('FALLBACK_SNAPSHOT', 5, 7)).toBe('B');
    // 노화일 미상 → B+ 기본값
    expect(getUniverseConfidenceGrade('FALLBACK_SNAPSHOT', 5)).toBe('B+');
    expect(getUniverseConfidenceGrade('FALLBACK_SNAPSHOT', 5, null)).toBe('B+');
  });

  it('Tier 3 FALLBACK_QUANT 는 B', () => {
    expect(getUniverseConfidenceGrade('FALLBACK_QUANT', 8)).toBe('B');
  });

  it('Tier 4 FALLBACK_NAVER 는 C+', () => {
    expect(getUniverseConfidenceGrade('FALLBACK_NAVER', 6)).toBe('C+');
  });

  it('Tier 5 FALLBACK_SEED / NOT_CONFIGURED / BUDGET_EXCEEDED 는 C', () => {
    expect(getUniverseConfidenceGrade('FALLBACK_SEED', 24)).toBe('C');
    expect(getUniverseConfidenceGrade('NOT_CONFIGURED', 10)).toBe('C');
    expect(getUniverseConfidenceGrade('BUDGET_EXCEEDED', 10)).toBe('C');
  });

  it('ERROR / NO_MATCHES 는 C-', () => {
    expect(getUniverseConfidenceGrade('ERROR', 10)).toBe('C-');
    expect(getUniverseConfidenceGrade('NO_MATCHES', 10)).toBe('C-');
  });

  it('sourceStatus 미제공이고 후보가 있으면 C- 기본값', () => {
    expect(getUniverseConfidenceGrade(undefined, 5)).toBe('C-');
  });
});
