// @responsibility Explain a frozen Shadow rule with its validation evidence.
import React from 'react';
import { paperAdaptiveRuleLabel, type PaperAdaptiveCandidate } from '../../types/paperAdaptive';
import { paperIndicatorFormulaLabel } from '../../types/paperIndicatorFormula';

const pct = (value: number | null, unit = '%') => value === null ? '미집계' : `${value > 0 ? '+' : ''}${value.toFixed(2)}${unit}`;
export function PaperRuleDetails({ candidate, exploration, observedValue }: {
  candidate: PaperAdaptiveCandidate; exploration: boolean; observedValue?: number;
}) {
  const { rule, training, validation } = candidate;
  return <section className="paper-detail-section">
    <h3>어떤 조건을 적용했나요?</h3>
    <p className="paper-detail-emphasis">{paperAdaptiveRuleLabel(rule)}</p>
    <p>{exploration ? '탐색용 규칙입니다. 성과 검증을 마치기 전에 가상 매매로 새 결과를 측정합니다.'
      : '학습 구간에서 선택한 뒤 별도의 후반 구간 검증을 통과해 매수 판단에 연결된 규칙입니다.'}</p>
    {observedValue !== undefined && <p>추천 당시 지표값 <strong>{observedValue.toLocaleString('ko-KR', { maximumFractionDigits: 4 })}</strong></p>}
    <div className="paper-detail-metrics"><div><span>학습 표본</span><strong>{training.sampleCount}건 / {training.dateCount}진입일</strong></div>
      <div><span>{exploration ? '검증 중인 표본' : '후반 검증 표본'}</span><strong>{validation.sampleCount}건 / {validation.dateCount}진입일</strong></div>
      <div><span>검증 평균 순수익률</span><strong>{pct(validation.meanNetReturnPct)}</strong></div>
      <div><span>검증 일당 대조군 차이</span><strong>{pct(validation.meanDailyExcessPct, '%p')}</strong></div></div>
    <p className="paper-detail-note">D{rule.horizon}은 {rule.horizon}거래일 후의 성과 비교 기준입니다. 해당 날짜에 반드시 매도한다는 뜻은 아닙니다.
      표본 평균 수익률은 이 종목의 예상 수익률이 아닙니다.</p>
    {rule.invention && <div className="paper-detail-formula"><h4>자동 발명한 수식</h4><p>{paperIndicatorFormulaLabel(rule.invention.formula)}</p>
      <p>생성 시각 {new Date(rule.invention.createdAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}</p>
      <p>수식 생성 이후 새 관측으로 성과를 검증합니다.</p></div>}
  </section>;
}
