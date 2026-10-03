// @responsibility Format frozen morning stock recommendations.
import type { PaperExperimentView } from '../../src/types/paperExperiment.js';
import type { PaperMorningSelection } from '../../src/types/paperMorning.js';
import { paperAdaptiveRuleLabel } from '../../src/types/paperAdaptive.js';
import { formatPaperAdaptiveSummary } from './paperResearchMessages.js';

const text = (value: string, limit = 100) => Array.from(value.replace(/\s+/g, ' ').trim()).slice(0, limit).join('')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const number = (value: number) => Number.isFinite(value) ? value.toLocaleString('ko-KR', { maximumFractionDigits: 4 }) : '미확인';
const pct = (value: number | null, unit = '%') => value === null || !Number.isFinite(value) ? '미집계'
  : `${value > 0 ? '+' : ''}${value.toFixed(2)}${unit}`;
const stamp = (value: string | null) => value && Number.isFinite(Date.parse(value))
  ? new Date(value).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
  : '시각 미확인';

export function formatPaperMorningMessage(selection: PaperMorningSelection, view?: PaperExperimentView): string {
  const title = selection.status === 'HOLIDAY' ? '휴장일 연구 현황' : '학습 기반 아침 추천';
  const lines = [`<b>${title} · ${text(selection.tradingDate, 10)}</b>`,
    `매일 08:30 KST · 생성 ${stamp(selection.createdAt)} KST`, text(selection.reason, 100)];
  if (selection.status === 'READY' || selection.status === 'NO_MATCH') {
    lines.push(`관측 기준 ${stamp(selection.sourceAsOf)} KST · 학습 평가 ${stamp(selection.adaptiveEvaluatedAt)} KST`,
      `검토 ${number(selection.consideredCount)}종목 · 규칙 일치 ${number(selection.matchedCount)} · 보유 제외 ${number(selection.heldCount)}`);
  }
  if (selection.status === 'NO_MATCH') lines.push('오늘 추천 조건에 맞는 신규 종목 없음');
  if (selection.status === 'DATA_UNAVAILABLE') lines.push('추천 판단 자료 미확인 · 추천 조건을 만족한 종목이 없다는 뜻은 아닙니다.');
  if (selection.status === 'HOLIDAY') lines.push('오늘 신규 추천 없음 · 휴장 중 학습·관측 현황을 전합니다.');
  if (selection.status === 'READY') {
    for (const pick of selection.picks.slice(0, 3)) {
      const { rule, training, validation } = pick.candidate;
      lines.push('', `<b>${pick.rank}. ${text(pick.name, 24)}(${text(pick.symbol, 12)})</b>`,
        pick.purpose === 'VALIDATED' ? '검증 통과 규칙 추천' : '탐색 후보 · 검증 전',
        `직전 거래일 참고 종가 ${number(pick.referenceClose.close)}원 · ${text(pick.referenceClose.tradingDate, 10)} 15:30 KST`,
        `종가 확인 ${stamp(pick.referenceClose.availableAt)} KST`,
        `고정 규칙: ${text(paperAdaptiveRuleLabel(rule), 110)}`,
        `관측 지표값 ${number(pick.ruleValue)} · 성과 비교 D${rule.horizon}거래일 · 매도는 장중 관측으로 별도 판단`);
      if (pick.purpose === 'VALIDATED') lines.push(
        `규칙 과거 ${rule.invention ? '생성 후 검증' : '검증'} ${number(validation.sampleCount)}건/${number(validation.dateCount)}일 · 평균 순수익률 ${pct(validation.meanNetReturnPct)}`,
        `과거 일당 대조군 차이 ${pct(validation.meanDailyExcessPct, '%p')}`);
      else lines.push(`학습 참고 ${number(training.sampleCount)}건/${number(training.dateCount)}일 · 평균 순수익률 ${pct(training.meanNetReturnPct)}`,
        `검증 누적 ${number(validation.sampleCount)}건/${number(validation.dateCount)}일 · 성과 검증 전`);
    }
  }
  const footer = [...(selection.status === 'READY' ? ['장전 후보이며 실제 가상 진입은 장중의 새 가격·지표 관측으로 별도 판단합니다.',
    '규칙의 과거 성과는 이 종목의 예상 수익률이 아닙니다. 실제 주문 없음.'] : ['가상 관측·연구 현황이며 실제 주문 없음.']),
    '/paper_recommend · /paper · /paper_bot'].join('\n');
  const research = view ? formatPaperAdaptiveSummary(view, new Date(selection.createdAt)) : ['자율 연구 자료 미조회'];
  lines.push('');
  for (const line of research) {
    if (lines.join('\n').length + line.length + footer.length + 60 >= 3500) { lines.push('연구 상세 /paper_research'); break; }
    lines.push(line);
  }
  return `${lines.join('\n')}\n\n${footer}`;
}
