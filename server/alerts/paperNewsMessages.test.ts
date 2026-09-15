// @responsibility Verify frozen news explanations in Telegram analysis.
import { describe, expect, it } from 'vitest';
import { formatPaperTradeAnalysis } from './paperBotMessages.js';
import { assessPaperNews } from '../trading/paper/paperNewsAssessment.js';
import { evaluatePaperStrategyScan } from '../trading/paper/paperStrategyPolicy.js';
import { emptyStrategyLedger, matureStrategySamples, strategyTestCost, strategyTestSnapshot } from '../trading/paper/paperStrategyFixtures.js';

function tradeFixture() {
  const snapshot = strategyTestSnapshot();
  const item = { id: 'disclosure', headline: '<b>대규모 수주</b> & 계약', source: 'DART', observedAt: snapshot.asOf };
  snapshot.observations[0].news = [{ ...item, assessment: assessPaperNews(item, snapshot.asOf) }];
  return evaluatePaperStrategyScan(emptyStrategyLedger(), matureStrategySamples([1, 9, 10], true), snapshot, strategyTestCost).trades[0];
}

describe('paper Telegram news evidence', () => {
  it('escapes headlines, identifies title inference and retains the entry assessment on exit', () => {
    const trade = tradeFixture();
    const buy = formatPaperTradeAnalysis([{ id: 'buy', at: trade.entryAt, side: 'BUY', trade }]);
    const exit = formatPaperTradeAnalysis([{ id: 'exit', at: '2026-09-23T07:00:00Z', side: 'EXIT', trade }]);
    for (const message of [buy, exit]) {
      expect(message).toContain('진입 당시 뉴스 평가: 호재 추정');
      expect(message).toContain('&lt;b&gt;대규모 수주&lt;/b&gt; &amp; 계약');
      expect(message).not.toContain('<b>대규모 수주</b>');
      expect(message).toContain('공시 제목');
      expect(message).toContain('현재 진입 조건에는 미반영');
      expect(message.length).toBeLessThan(3500);
    }
  });

  it('never labels missing or post-entry assessments as known good news', () => {
    const trade = tradeFixture();
    const item = trade.entryObservation.news[0];
    item.assessment!.assessedAt = '2026-09-23T07:00:00Z';
    const render = () => formatPaperTradeAnalysis([{ id: 'event', at: trade.entryAt, side: 'BUY', trade }]);
    expect(render()).toContain('진입 당시 뉴스 평가: 판단 불가');
    delete item.assessment;
    expect(render()).toContain('당시 유효한 방향 평가가 저장되지 않음');
  });
});
