// @responsibility Explain invented indicator arithmetic in plain language.
import React from 'react';
import type { PaperAdaptiveRule } from '../../types/paperAdaptive';
import { paperIndicatorFormulaLabel } from '../../types/paperIndicatorFormula';
import { explainPaperIndicator, inventedRuleRange } from '../../utils/paperIndicatorExplanation';
import '../../styles/paperInventions.css';

export function PaperFormulaExplanation({ rule }: { rule: PaperAdaptiveRule }) {
  if (!rule.invention) return null;
  const explanation = explainPaperIndicator(rule.invention.formula);
  return <div className="paper-invention-explanation">
    <h4>무엇을 함께 보나요?</h4>
    <dl>{explanation.ingredients.map(item => <div key={item.feature}><dt>{item.label}</dt><dd>{item.meaning}</dd></div>)}</dl>
    <h4>두 재료를 어떻게 조합하나요?</h4><p>{explanation.meaning}</p>
    <p>재료마다 단위가 달라 각각의 고정 기준을 빼고 정해진 폭으로 나눠 비교 가능한 값으로 바꿉니다. 0은 그 재료의 설정 기준이며, 시장 평균이나 백분위가 아닙니다.</p>
    <p className="paper-invention-example"><strong>계산 이해용 예시</strong> · {explanation.example} 실제 종목의 관측값은 아닙니다.</p>
    <h4>어떤 구간을 시험하나요?</h4>
    <p>조합값이 <strong>{inventedRuleRange(rule.bucket)}</strong>인 경우를 D{rule.horizon} 성과로 비교합니다. 값이 높을수록 좋다는 규칙은 아닙니다.</p>
    <p>D{rule.horizon}은 {rule.horizon}거래일 후 결과를 비교한다는 뜻입니다. 매도 날짜는 거래에 저장된 매도 정책으로 판단합니다.</p>
    <details><summary>정확한 계산식과 기준값</summary><p>{paperIndicatorFormulaLabel(rule.invention.formula)}</p>
      {explanation.ingredients.map(item => <p key={item.feature}>N({item.label}) = (값 − {item.center}) / {item.scale}</p>)}
      <p>각 재료의 환산값은 −3~3으로 제한한 뒤 조합합니다. 필요한 자료가 없으면 계산하지 않습니다.</p></details>
  </div>;
}
