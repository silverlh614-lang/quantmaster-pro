// @responsibility Verify frozen morning recommendation wording.
import { describe, expect, it } from 'vitest';
import type { PaperMorningPick, PaperMorningSelection } from '../../src/types/paperMorning.js';
import type { PaperExperimentView } from '../../src/types/paperExperiment.js';
import { formatPaperMorningMessage } from './paperMorningMessage.js';
import { validateTelegramHtml } from './telegramHtmlSanitizer.js';

function pick(rank = 1): PaperMorningPick {
  return { rank, symbol: '005930', name: '<삼성&>', purpose: 'VALIDATED', ruleValue: 35,
    referenceClose: { tradingDate: '2026-09-18', close: 10000, availableAt: '2026-09-20T23:00:00Z' },
    observation: { symbol: '005930', name: '<삼성&>', price: 10000, observedAt: '2026-09-20T23:00:00Z',
      source: 'KIS', news: [], dailyCloses: [], return1dPct: null, return5dPct: null, aboveMa20: null },
    candidate: { active: true, reason: 'ACTIVE', rule: { feature: 'rsi14', bucket: 1, horizon: 3 },
      training: { sampleCount: 20, dateCount: 5, symbolCount: 4, meanNetReturnPct: 1.5, meanDailyExcessPct: 0.2 },
      validation: { sampleCount: 12, dateCount: 3, symbolCount: 4, meanNetReturnPct: 0, meanDailyExcessPct: 0.15 } } };
}
function selection(): PaperMorningSelection {
  return { version: 'morning-recommendation-v1', id: 'morning:2026-09-21', tradingDate: '2026-09-21',
    scheduledAt: '2026-09-20T23:30:00Z', createdAt: '2026-09-20T23:30:00Z', status: 'READY', reason: '검증 규칙 우선 · 최대 3종목',
    sourceSnapshotId: 'scan', sourceAsOf: '2026-09-20T23:00:00Z', adaptiveEvaluatedAt: '2026-09-20T15:00:00Z',
    adaptiveCutoffAt: '2026-09-20T15:00:00Z', consideredCount: 100, matchedCount: 5, heldCount: 2, picks: [pick()] };
}

describe('morning recommendation message', () => {
  it('shows frozen ranked evidence, prior close timestamps and zero historical returns without promising a fill', () => {
    const report = selection(), before = structuredClone(report);
    const message = formatPaperMorningMessage(report);
    expect(message).toContain('1. &lt;삼성&amp;&gt; (005930)');
    expect(message).toContain('검증 통과 규칙 추천');
    expect(message).toContain('참고 종가 <b>10,000원</b> · 2026-09-18');
    expect(message).toContain('005930 종가 2026-09-18 15:30 KST · 확인 09. 21. 08:00 KST');
    expect(message).toContain('지표값 35 · D3 성과 비교');
    expect(message).toContain('과거 검증 12건/3일');
    expect(message).toContain('평균 순수익률 0.00% · 일당 대조군 차이 +0.15%p');
    expect(message).toContain('장중 새 가격·지표로 가상 매수·매도를 판단');
    expect(message.indexOf('<b>1.')).toBeLessThan(message.indexOf('<b>자료 기준</b>'));
    expect(message).not.toContain('자율 연구 · 지표 발명');
    expect(message).toContain('이 종목의 예상 수익률이 아닙니다');
    expect(report).toEqual(before);
  });
  it('keeps unvalidated exploration separate with training references and missing performance distinct from zero', () => {
    const report = selection(), exploratory = pick(2);
    exploratory.symbol = '000660'; exploratory.name = '탐색 종목'; exploratory.purpose = 'EXPLORATION';
    exploratory.candidate.active = false; exploratory.candidate.reason = 'INSUFFICIENT_VALIDATION';
    exploratory.candidate.training.meanNetReturnPct = null;
    exploratory.candidate.validation = { sampleCount: 0, dateCount: 0, symbolCount: 0, meanNetReturnPct: null, meanDailyExcessPct: null };
    report.picks.push(exploratory);
    const message = formatPaperMorningMessage(report), exploration = message.slice(message.indexOf('<b>2.'));
    expect(message.indexOf('<b>1.')).toBeLessThan(message.indexOf('<b>2.'));
    expect(exploration).toContain('탐색 후보 · 검증 전');
    expect(exploration).toContain('학습 참고 20건/5일 · 평균 순수익률 미집계');
    expect(exploration).toContain('검증 누적 0건/0일 · 성과 검증 전');
    expect(exploration).not.toContain('검증 통과 규칙 추천');
    expect(exploration).not.toContain('평균 순수익률 0.00%');
  });
  it('distinguishes no matches, unavailable data and holidays without manufacturing picks', () => {
    const report = selection(); report.picks = [];
    report.status = 'NO_MATCH';
    expect(formatPaperMorningMessage(report)).toContain('오늘 추천 조건에 맞는 신규 종목 없음');
    report.status = 'DATA_UNAVAILABLE'; report.reason = '오늘 스냅샷 미확인';
    const missing = formatPaperMorningMessage(report);
    expect(missing).toContain('추천 판단 자료 미확인');
    expect(missing).toContain('자율 연구 자료 미조회');
    expect(missing).not.toContain('검토 100종목');
    report.status = 'HOLIDAY'; report.reason = 'KRX 휴장';
    const view = { mode: 'SHADOW', strategyVersion: 'shadow-baseline-v1', totalCount: 0, openCount: 0, completedCount: 0,
      experiments: [], groups: [], outcomes: [], lastRun: null } as PaperExperimentView;
    const holiday = formatPaperMorningMessage(report, view);
    expect(holiday).toContain('휴장일 연구 현황');
    expect(holiday).toContain('오늘 신규 추천 없음');
    expect(holiday).toContain('자율 연구 · 지표 발명');
    expect(holiday).not.toContain('<b>1.');
  });
  it('keeps all three picks and complete HTML under the delivery limit with long escaped labels', () => {
    const report = selection(); report.reason = '<&>'.repeat(1000);
    report.picks = [pick(1), pick(2), pick(3)].map(item => ({ ...item, name: '<&>'.repeat(1000) }));
    const message = formatPaperMorningMessage(report);
    for (const rank of [1, 2, 3]) expect(message).toContain(`<b>${rank}.`);
    expect(message.length).toBeLessThan(3500);
    expect(validateTelegramHtml(message).valid).toBe(true);
    expect(message.endsWith('/paper_recommend · /paper_research')).toBe(true);
  });
});
