// @responsibility Format recommendation follow-up evidence for Telegram reports.
import { PAPER_MORNING_RESULT_LABELS, type PaperMorningReview } from '../../src/types/paperMorning.js';
import { paperAdaptiveRuleLabel } from '../../src/types/paperAdaptive.js';
const text = (value: string, max = 120) => {
  let result = '';
  for (const character of value.replace(/\s+/g, ' ')) {
    const escaped = character.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    if (result.length + escaped.length > max) break;
    result += escaped;
  }
  return result;
};
const price = (value: number | null) => value === null ? '미확인' : `${value.toLocaleString('ko-KR')}원`;
const pct = (value: number) => `${value > 0 ? '+' : ''}${value.toFixed(2)}%`;
const stamp = (value: string | null) => value ? new Date(value).toLocaleString('ko-KR', {
  timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
}) : '미확인';

export function formatPaperMorningFollowup(review: PaperMorningReview, compact = false): string {
  if (review.trackingError && !review.report) return '추천 이후 추적 · 기록 조회 실패';
  const report = review.report;
  if (!report) return '해당 날짜의 아침 추천 기록이 없습니다. 매일 08:30 KST에 거래일 추천 또는 휴장일 연구 현황을 발송합니다.';
  if (!report.picks.length) return compact ? `아침 추천: ${text(report.reason)}` : report.message;
  const sent = report.delivery && Date.parse(report.delivery.sentAt) <= Date.parse(review.asOf);
  const lines = [`<b>추천 이후 추적 · ${report.tradingDate}</b>`,
    `Shadow · 실제 주문 없음 · ${sent ? `발송 ${stamp(report.delivery!.sentAt)}` : '발송 확인 대기'}`];
  if (review.trackingError) lines.push(text(review.trackingError));
  for (const item of review.results.slice(0, 3)) {
    const pick = report.picks.find(value => value.symbol === item.symbol)!;
    lines.push('', `<b>${item.rank}. ${text(item.name, 24)} (${item.symbol})</b> · ${PAPER_MORNING_RESULT_LABELS[item.status]}`);
    if (!compact) lines.push(`추천 참고 종가 ${price(pick.referenceClose.close)} · ${pick.referenceClose.tradingDate}`,
      `추천 근거: ${text(paperAdaptiveRuleLabel(pick.candidate.rule), 100)}`);
    if (item.entryAt) lines.push(`매수 ${price(item.entryPrice)} · ${stamp(item.entryAt)}`);
    if (item.exitAt) lines.push(`매도 ${price(item.exitPrice)} · ${stamp(item.exitAt)}`,
      `확정 순수익 ${pct(item.netReturnPct!)} · 매도 사유: ${text(item.exitReason ?? '미기록', 80)}`);
    else if (item.status === 'OPEN') {
      const point = item.measurement?.latest;
      lines.push(point ? `관측가 ${price(point.price)} · 평가 순수익 ${pct(point.netReturnPct)} · ${stamp(point.observedAt)}` : '보유 중 가격 관측 미확인');
    } else if (item.status !== 'UNSENT') lines.push(item.lastDecision
      ? `마지막 장중 판단 ${stamp(item.lastDecision.decisionAt)}: ${text(item.lastDecision.reason, 100)}`
      : '장중 판단 근거 미기록 · 미진입 사유를 추정하지 않습니다.');
    if (item.matchesEntryRule === false) lines.push('추천과 다른 규칙으로 가상 진입');
    if (!compact && item.entryReason) lines.push(`매수 사유: ${text(item.entryReason, 100)}`);
  }
  if (!compact) lines.push('', '수익률은 가상 매수가 기준·비용 반영입니다. 추천 종가 대비 성과와 구분합니다.',
    '마지막 장중 판단은 당일 전체 미진입 원인을 대표하지 않습니다.', '과거 추천의 현재 결과는 대시보드에서 날짜를 선택해 확인하세요.');
  return lines.join('\n');
}
