// @responsibility Verify /paper_research explains why a research comparison is still waiting.
import { describe, expect, it } from 'vitest';
import type { PaperExperimentView } from '../../src/types/paperExperiment.js';
import { formatPaperBotStatus, formatPaperReport, formatPaperResearch, PAPER_BOT_SCHEDULES } from './paperBotMessages.js';
import { buildPaperStrategyView } from '../trading/paper/paperStrategyPolicy.js';
import { emptyStrategyLedger } from '../trading/paper/paperStrategyFixtures.js';
import { matureAdaptiveSamples } from '../trading/paper/paperAdaptiveFixtures.js';
import { selectPaperAdaptiveState } from '../trading/paper/paperAdaptiveSelection.js';
import { formatPaperAdaptiveSummary } from './paperResearchMessages.js';

const now = new Date('2026-09-18T05:00:00Z');
function autonomousView(): PaperExperimentView {
  const samples = matureAdaptiveSamples();
  for (const item of samples) {
    const index = Number(item.symbol.slice(-1));
    item.entryObservation.features!.values.rsi14 = index % 4 < 2 ? 20 : 80;
    item.entryObservation.features!.values.volumeRatio20 = [0, 1, 6, 7].includes(index) ? 0.25 : 1.75;
  }
  return { mode: 'SHADOW', strategyVersion: 'shadow-baseline-v1', totalCount: samples.length,
    openCount: 0, completedCount: samples.length, experiments: samples, groups: [], outcomes: [], lastRun: null,
    strategy: buildPaperStrategyView({ ...emptyStrategyLedger(),
      adaptive: selectPaperAdaptiveState(undefined, samples, '2026-09-18T01:00:00Z') }) };
}

const study = (label: string, status: string, availableCount: number, trainingCount: number) => ({
  label, status, availableCount, trainingCount, matchedDifferencePct: status === 'EVALUATED' ? 0.2 : null,
  testCount: status === 'EVALUATED' ? 5 : 0, testSymbolCount: 1, testDateCount: 1 });

describe('paper research message', () => {
  it('shows the wait reason, benchmark series count and KIS index status', () => {
    const view = { research: { asOf: '2026-10-01T03:00:00Z', symbols: 1, sampleCount: 10, learningSampleCount: 1,
      firstDate: '2026-01-30', lastDate: '2026-09-21', benchmarkSeriesCount: 2,
      inventory: [{ file: 'KIS 지수 일봉(KOSPI·KOSDAQ)', records: 400, status: 'FOUND' }],
      longHorizon: { horizon: 20, sampleCount: 900, symbolCount: 300, entryDateCount: 120, firstDate: '2026-01-30', lastDate: '2026-08-21',
        meanNetReturnPct: 1.2, winRatePct: 51.5, excessCount: 880, meanExcessReturnPct: -0.4, splitDate: '2026-06-30', features: [
          { feature: 'return5dPct', label: '5거래일 가격 모멘텀', availableCount: 800, trainingCount: 500, selectedGroup: '하위',
            testCount: 120, testDateCount: 30, matchedDifferencePct: 0.85, status: 'EVALUATED' }] },
      featureStudies: [study('시장 대비 20일 상대강도', 'NO_TRAIN_VARIATION', 120, 0), study('5거래일 가격 모멘텀', 'EVALUATED', 10, 8)] },
      relativeStrengthStudy: { experimentCount: 10, measuredCount: 8, indexReady: true, horizons: [
        { horizon: 1, cellCount: 3, upperWinCount: 2, entryDateCount: 2, sampleCount: 6, upperMeanPct: 0.5, lowerMeanPct: -0.25, differencePct: 0.75 },
        { horizon: 3, cellCount: 0, upperWinCount: 0, entryDateCount: 0, sampleCount: 0, upperMeanPct: null, lowerMeanPct: null, differencePct: null },
        { horizon: 5, cellCount: 0, upperWinCount: 0, entryDateCount: 0, sampleCount: 0, upperMeanPct: null, lowerMeanPct: null, differencePct: null }] },
    } as unknown as PaperExperimentView;
    view.strategy = {
      strategyVersion: 'adaptive-features-v1', mode: 'SHADOW', policy: { version: 'adaptive-features-v1', newsLookbackHours: 72,
        minimumSamples: 10, minimumEntryDates: 3, horizonSelection: 'FORWARD_VALIDATED_FEATURE', exitModel: 'SCHEDULED_CLOSE' },
      totalCount: 10, openCount: 0, lastRun: { snapshotId: 'research', asOf: '2026-10-01T03:00:00Z',
        openedCount: 0, closedCount: 0, waitingCount: 0, holdingCount: 0 }, latestDecisions: [], trades: [],
      performance: { closedCount: 10, meanNetReturnPct: 1, winRatePct: 60, totalNetPnl: 1000 },
      performanceByVersion: { 'adaptive-features-v1': { closedCount: 2, meanNetReturnPct: 0.3, winRatePct: 50, totalNetPnl: 60 } },
      selection: { dateCount: 3, candidateCount: 30, boughtCount: 10, heldCount: 2, notBoughtCount: 18, selectionRatePct: 33.3,
        cohorts: [{ cohort: 'NEWS_RECENT_ABOVE_MA20', candidateCount: 30, boughtCount: 10 }],
        comparison: { groupCount: 3, strategyTradeCount: 10, unselectedCount: 18,
          strategyMeanPct: 1, unselectedMeanPct: 0.2, baselineMeanPct: 0.5, differencePct: 0.8 },
        adaptive: { entry: { dateCount: 4, tradeCount: 6, edgePct: 0.5 }, validatedEntry: { dateCount: 3, tradeCount: 4, edgePct: 0.7 },
          explorationEntry: { dateCount: 2, tradeCount: 2, edgePct: -0.2 }, exit: { dateCount: 3, tradeCount: 5, edgePct: -0.3 },
          months: [{ month: '2026-09', entry: { dateCount: 4, tradeCount: 6, edgePct: 0.5 }, exit: { dateCount: 3, tradeCount: 5, edgePct: -0.3 } }] } },
    };
    const text = formatPaperResearch(view, new Date('2026-10-01T04:00:00Z'));
    expect(text).toContain('지수 대비 20일 상대강도 계산 8/10건');
    expect(text).toContain('900건/300종목/120진입일 (2026-01-30~2026-08-21)');
    expect(text).toContain('비용 차감 평균 +1.20% · 승률 51.5% · 같은 기간 지수 대비 -0.40% (880건)');
    expect(text).toContain('• 5거래일 가격 모멘텀: 하위 선택 → +0.85%p · 120건/30진입일');
    expect(text).toContain('독립 구간은 약 6개뿐입니다');
    expect(text).toContain('D1: 상위 +0.50% vs 하위 -0.25% → +0.75%p · 3개 날짜·그룹 중 상위 우세 2 · 2진입일/6건');
    expect(text).toContain('D3: 확정 성과가 있는 같은 날·같은 그룹 비교 대기');
    expect(text).toContain('시장 대비 20일 상대강도: 비교 대기(학습 구간 비교군 부족 · 값 있음 120건·학습 0건)');
    expect(text).toContain('5거래일 가격 모멘텀: +0.20%p');
    expect(text).toContain('상대강도 기준 지수 시계열 2개');
    expect(text).toContain('상대강도 기준 KIS 지수 일봉 400건 · 수집 완료');
    expect(text).toContain('전략 선별력 · 같은 날 후보 대비');
    expect(text).toContain('청산 전략 +1.00% vs 같은 날·같은 기간 미진입 +0.20% → 차이 +0.80%p');
    expect(text).toContain('종목 선택: 산 종목 − 같은 날 안 산 종목 +0.50%p (4일·6건)\n• 검증 통과 +0.70%p (3일·4건) · 탐색 -0.20%p (2일·2건)');
    expect(text).toContain('매도: 실제 청산 − 같은 거래 D5 보유 -0.30%p (3일·5건)\n• 2026-09: 선택 +0.50%p (4일·6건) · 매도 -0.30%p (3일·5건)');
    expect(text).toContain('현행 자율 전략 전체(검증+탐색) 가상 청산 2건 · 평균 순수익률 +0.30% (구전략 제외)');
  });

  it('reports autonomous discovery even when archived seven-condition research is unavailable', () => {
    const view = autonomousView(), original = structuredClone(view);
    expect(view.strategy!.adaptive!.discovery!.inventions).toHaveLength(2);
    const summary = formatPaperAdaptiveSummary(view, now).join('\n');
    const weekly = formatPaperResearch(view, now);
    expect(weekly).toContain(summary);
    expect(weekly).toContain('발명 1차 · 이번 회차 검토 3개 · 보관 2개\n생성 후 검증 대기 2개');
    expect(weekly).toContain('<b>검증 지표 자동 연결 0개/최대 3개</b>\n이 중 발명 지표 0개');
    expect(summary).toMatch(/🎲 무작위 대조 50회 · 검증 통과 실제 0개, 무작위 평균 \d+\.\d개 · 우연히 이만큼 나올 확률 \d+%/);
    expect(summary).toContain('무작위 대조는 종목끼리 수익 기록을 바꿔 같은 검증을 반복합니다.');
    expect(summary).toContain('⏳ 검증 매수 대기 · 후반 확인 5일 충족 · 기준을 통과한 지표 없음 · 매일 재평가');
    expect(weekly).toContain('저장 자료 연구 결과를 아직 불러오지 못했습니다');
    expect(weekly.length).toBeLessThanOrEqual(3500);
    expect(formatPaperReport(view, 'status', '2026-09-18', [], now)).toContain(summary);
    expect(view).toEqual(original);
  });

  it.each(['view', 'lastRun'] as const)('preserves the unavailable research state after a %s failure', source => {
    const view = autonomousView();
    if (source === 'view') view.strategy!.error = '원장 읽기 실패';
    else view.strategy!.lastRun = { snapshotId: 'error', asOf: now.toISOString(), openedCount: 0,
      closedCount: 0, waitingCount: 0, holdingCount: 0, error: '평가 실패' };
    const expected = formatPaperAdaptiveSummary(view, now).join('\n');
    expect(formatPaperResearch(view, now)).toContain(expected);
    expect(formatPaperResearch(view, now)).toContain('전략 갱신 오류 · 연구 상태 확인 불가');
    expect(formatPaperReport(view, 'status', '2026-09-18', [], now)).toContain(expected);
    expect(formatPaperResearch(view, now)).not.toContain('전체 전략 이력 가상 청산');
    expect(formatPaperResearch(view, now)).not.toContain('지표 자동 연결');
  });

  it('caps lengthy archived research at whole HTML lines while retaining autonomous status and navigation', () => {
    const view = autonomousView();
    view.research = { asOf: now.toISOString(), symbols: 10, sampleCount: 100, learningSampleCount: 30,
      firstDate: '2026-01-01', lastDate: '2026-09-17', featureStudies: Array.from({ length: 60 }, (_, index) =>
        study(`<연구 ${index} & 기록>`, 'NO_TRAIN_VARIATION', 100, 30)) } as unknown as NonNullable<PaperExperimentView['research']>;
    const message = formatPaperResearch(view, now);
    expect(message).toContain(formatPaperAdaptiveSummary(view, now).join('\n'));
    expect(message).toContain('&lt;연구 0 &amp; 기록&gt;');
    expect(message).not.toContain('<연구 0');
    expect(message).toContain('일부 상세는 대시보드에서 확인하세요.');
    expect(message.endsWith('/paper · /paper_bot')).toBe(true);
    expect(message.length).toBeLessThanOrEqual(3500);
    expect((message.match(/<b>/g) ?? []).length).toBe((message.match(/<\/b>/g) ?? []).length);
  });

  it('declares the two bounded intraday slots and the correct semantic destinations', () => {
    expect(PAPER_BOT_SCHEDULES.filter(item => item.kind === 'intraday').map(({ minute, graceMinutes }) => ({ minute, graceMinutes })))
      .toEqual([{ minute: 630, graceMinutes: 45 }, { minute: 810, graceMinutes: 45 }]);
    const message = formatPaperBotStatus({ schemaVersion: 1, initializedAt: null, lastCheckedAt: null,
      health: 'OK', notifiedHealth: 'OK', seenEvents: {}, messages: [] });
    expect(message).toContain('CH1 매매: 가상 계좌 체결만');
    expect(message).toContain('CH2 판단: 08:30 후보·계좌 체결 근거·10:30/13:30 계좌 요약');
    expect(message).toContain('CH4 연구: 지표 변경·16:10 성과·일요일 연구');
    expect(message).toContain('CH3 정보: 08:45 준비');
    expect(message).toContain('거래일 10:30');
    expect(message).toContain('거래일 13:30');
  });

  it('shows each connected rule with the chance of matching it on stock-shuffled returns', () => {
    const samples = matureAdaptiveSamples();
    const view = { ...autonomousView(), strategy: buildPaperStrategyView({ ...emptyStrategyLedger(),
      adaptive: selectPaperAdaptiveState(undefined, samples, '2026-09-18T01:00:00Z') }) };
    const summary = formatPaperAdaptiveSummary(view, now).join('\n');
    expect(summary).toContain('검증 통과 실제 1개');
    expect(summary).toMatch(/후반 검증 \d+건\/\d+일 · 일당 차이 \+\d+\.\d{2}%p · 무작위로 이 이상 \d+%/);
    expect(formatPaperAdaptiveSummary(view, now, 'brief').join('\n')).not.toContain('무작위 대조는');
  });
});
