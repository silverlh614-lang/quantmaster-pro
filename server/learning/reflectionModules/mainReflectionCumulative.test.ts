// @responsibility 회귀 테스트 — formatNarrativeInput 의 ADR-0130 누적 컨텍스트 섹션 3종
import { describe, it, expect } from 'vitest';
import {
  formatNarrativeInput,
  type MainReflectionInputs,
  type RecentReflectionContext,
  type ActiveFailurePatternSummary,
} from './mainReflection.js';

const BASE_INPUT: MainReflectionInputs = {
  date: '2026-04-30',
  closedTrades: [],
  partialRealizationsToday: [],
  attributionToday: [],
  incidentsToday: [],
  missedSignals: [],
};

describe('formatNarrativeInput — ADR-0130 cumulative context', () => {
  it('1. recentReflections 부재 + activeFailurePatterns 부재 → 신규 섹션 미렌더 (후방호환)', () => {
    const out = formatNarrativeInput(BASE_INPUT);
    expect(out).not.toContain('직전');
    expect(out).not.toContain('어제 너는 다음과 같이');
    expect(out).not.toContain('누적 실패 패턴');
  });

  it('2. recentReflections 빈 배열 → 섹션 1+2 미렌더', () => {
    const out = formatNarrativeInput({ ...BASE_INPUT, recentReflections: [] });
    expect(out).not.toContain('직전');
    expect(out).not.toContain('너는 다음과 같이 조정한다고 했다');
  });

  it('3. recentReflections 7일 입력 → 섹션 1 모든 일자 + verdict 이모지', () => {
    const recent: RecentReflectionContext[] = [];
    for (let i = 0; i < 7; i++) {
      const d = `2026-04-${String(23 + i).padStart(2, '0')}`;
      recent.push({
        date: d,
        verdict: i % 2 === 0 ? 'GOOD_DAY' : 'BAD_DAY',
        keyLessonsCount: i,
        tomorrowAdjustments: [`조정 ${i}`],
        biasTop3: [
          { bias: 'HERDING', score: 1.0 },
          { bias: 'RECENCY', score: 0.95 },
          { bias: 'FOMO', score: 0.8 },
        ],
      });
    }
    const out = formatNarrativeInput({ ...BASE_INPUT, recentReflections: recent });
    expect(out).toContain('직전 7일 자기반성 누적 컨텍스트');
    expect(out).toContain('2026-04-23');
    expect(out).toContain('2026-04-29');
    expect(out).toContain('✅'); // GOOD_DAY
    expect(out).toContain('❌'); // BAD_DAY
    expect(out).toContain('HERDING 1.00');
  });

  it('4. recentReflections 의 마지막 일자 tomorrowAdjustments → 어제 약속 평가 요청 섹션', () => {
    const recent: RecentReflectionContext[] = [
      {
        date: '2026-04-29',
        verdict: 'MIXED',
        keyLessonsCount: 1,
        tomorrowAdjustments: ['놓친 신호 분석', '감시 목록 관리', '진입 로직 개선'],
        biasTop3: [],
      },
    ];
    const out = formatNarrativeInput({ ...BASE_INPUT, recentReflections: recent });
    expect(out).toContain('어제(2026-04-29)');
    expect(out).toContain('너는 다음과 같이 조정한다고 했다');
    expect(out).toContain('놓친 신호 분석');
    expect(out).toContain('감시 목록 관리');
    expect(out).toContain('적용되었는가');
  });

  it('5. recentReflections 마지막 일자 tomorrowAdjustments 빈 배열 → 어제 약속 섹션 미렌더', () => {
    const recent: RecentReflectionContext[] = [
      {
        date: '2026-04-29',
        verdict: 'SILENT',
        keyLessonsCount: 0,
        tomorrowAdjustments: [],
        biasTop3: [],
      },
    ];
    const out = formatNarrativeInput({ ...BASE_INPUT, recentReflections: recent });
    expect(out).toContain('직전 1일 자기반성 누적 컨텍스트');
    expect(out).not.toContain('어제 너는 다음과 같이');
    expect(out).toContain('내일조정 없음');
  });

  it('6. activeFailurePatterns 빈 배열 → 섹션 3 미렌더', () => {
    const out = formatNarrativeInput({ ...BASE_INPUT, activeFailurePatterns: [] });
    expect(out).not.toContain('누적 실패 패턴');
  });

  it('7. activeFailurePatterns Top 5 → 섹션 3 모든 패턴 + 컨텍스트 표시', () => {
    const patterns: ActiveFailurePatternSummary[] = [
      {
        id: 'fp_001',
        stockName: '삼성전자',
        stockCode: '005930',
        exitDate: '2026-04-25',
        returnPct: -8.3,
        gate2PassCount: 7,
        marketRegime: 'R5_CAUTION',
        sector: '반도체',
      },
      {
        id: 'fp_002',
        stockName: 'SK하이닉스',
        stockCode: '000660',
        exitDate: '2026-04-20',
        returnPct: -5.2,
        gate2PassCount: null,
        marketRegime: null,
        sector: null,
      },
    ];
    const out = formatNarrativeInput({ ...BASE_INPUT, activeFailurePatterns: patterns });
    expect(out).toContain('누적 실패 패턴 2건 active');
    expect(out).toContain('fp_001');
    expect(out).toContain('삼성전자');
    expect(out).toContain('-8.3%');
    expect(out).toContain('Gate2 7/12');
    expect(out).toContain('반도체');
    expect(out).toContain('R5_CAUTION');
    expect(out).toContain('fp_002');
  });

  it('8. recentReflections + activeFailurePatterns 둘 다 입력 → 섹션 1+2+3 모두 노출 + 순서 보존', () => {
    const recent: RecentReflectionContext[] = [
      {
        date: '2026-04-29',
        verdict: 'GOOD_DAY',
        keyLessonsCount: 1,
        tomorrowAdjustments: ['조정'],
        biasTop3: [{ bias: 'HERDING', score: 0.5 }],
      },
    ];
    const patterns: ActiveFailurePatternSummary[] = [
      {
        id: 'fp_001',
        stockName: '삼성전자',
        stockCode: '005930',
        exitDate: '2026-04-25',
        returnPct: -8.3,
      },
    ];
    const out = formatNarrativeInput({
      ...BASE_INPUT,
      recentReflections: recent,
      activeFailurePatterns: patterns,
    });
    const idxRecent = out.indexOf('직전 1일');
    const idxPromise = out.indexOf('너는 다음과 같이 조정한다고 했다');
    const idxFailure = out.indexOf('누적 실패 패턴');
    expect(idxRecent).toBeGreaterThan(0);
    expect(idxPromise).toBeGreaterThan(idxRecent);
    expect(idxFailure).toBeGreaterThan(idxPromise);
  });
});
