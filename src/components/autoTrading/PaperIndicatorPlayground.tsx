// @responsibility Demonstrate indicator movement without changing trading inputs.
import React, { useState } from 'react';
import { createPaperIndicatorFormula, paperIndicatorFormulaValue, type PaperIndicatorOperation } from '../../types/paperIndicatorFormula';
import { explainPaperIndicator } from '../../utils/paperIndicatorExplanation';

const number = (value: number) => value.toLocaleString('ko-KR', { maximumFractionDigits: 3 });
export function PaperIndicatorPlayground() {
  const [close, setClose] = useState(10500), [volume, setVolume] = useState(20);
  const [adx, setAdx] = useState(45), [rsiChange, setRsiChange] = useState(10);
  const [operation, setOperation] = useState<PaperIndicatorOperation>('MEAN');
  const gap = (close / 10000 - 1) * 100, volumeRatio = volume / 10;
  const formula = createPaperIndicatorFormula(operation, 'adx14', 'rsiChange5');
  const values = { adx14: adx, rsiChange5: rsiChange };
  const normalize = (operand: typeof formula.left) => Math.max(-3, Math.min(3, (values[operand.feature as keyof typeof values] - operand.center) / operand.scale));
  const left = normalize(formula.left), right = normalize(formula.right);
  const combined = paperIndicatorFormulaValue(formula, values)!;
  const explanation = explainPaperIndicator(formula);
  return <section className="manual-playground" aria-label="지표 움직임 체험">
    <p className="manual-callout">직접 바꿔 보는 계산 예시 · 실제 종목 자료가 아니며 매매·설정에 반영되지 않습니다.</p>
    <div className="manual-experiment-grid">
      <article className="manual-experiment"><span className="manual-eyebrow">01 · 가격 → 평균선과의 거리</span><h3>가격이 평균보다 얼마나 높을까요?</h3>
        <p>비교할 20일 평균을 10,000원으로 고정한 예시입니다.</p>
        <label htmlFor="manual-close">예시 완료 종가 <strong>{number(close)}원</strong></label>
        <input id="manual-close" type="range" min="8000" max="12000" step="100" value={close} onChange={event => setClose(Number(event.target.value))} />
        <output aria-label="20일선 이격 계산 결과" aria-live="polite">20일선 이격 <strong>{gap > 0 ? '+' : ''}{number(gap)}%</strong></output>
        <p className="manual-calculation">({number(close)} ÷ 10,000 − 1) × 100</p>
        <p>{gap === 0 ? '평균선과 같은 위치입니다.' : `평균선보다 ${number(Math.abs(gap))}% ${gap > 0 ? '위' : '아래'}에 있습니다.`} 평균 자체도 실제로는 매일 움직입니다.</p>
      </article>
      <article className="manual-experiment"><span className="manual-eyebrow">02 · 거래량 → 평소 대비 규모</span><h3>평소보다 얼마나 많이 거래됐을까요?</h3>
        <p>이전 20일 평균 거래량을 10만 주로 고정했습니다.</p>
        <label htmlFor="manual-volume">예시 완료일 거래량 <strong>{number(volume)}만 주</strong></label>
        <input id="manual-volume" type="range" min="1" max="40" step="1" value={volume} onChange={event => setVolume(Number(event.target.value))} />
        <output aria-label="거래량 비율 계산 결과" aria-live="polite">거래량 비율 <strong>{number(volumeRatio)}배</strong></output>
        <p className="manual-calculation">{number(volume)}만 주 ÷ 10만 주</p>
        <p>{volumeRatio === 1 ? '평소 평균과 같습니다.' : `평소 평균보다 ${volumeRatio > 1 ? '많이' : '적게'} 거래됐습니다.`} 상승 중 증가인지 하락 중 증가인지는 별도로 봐야 합니다.</p>
      </article>
    </div>
    <article className="manual-experiment manual-composition"><span className="manual-eyebrow">03 · 두 재료 → 발명 지표 → 시험 구간</span>
      <h3>두 지표를 묶으면 무엇이 달라질까요?</h3>
      <p>ADX는 추세의 강도, RSI 변화는 상승·하락 힘의 변화를 봅니다. 서로 다른 눈금을 기준 대비 값으로 환산한 뒤 조합합니다.</p>
      <div className="manual-experiment-grid">
        <div><label htmlFor="manual-adx">예시 ADX <strong>{adx}</strong></label><input id="manual-adx" type="range" min="0" max="85" value={adx} onChange={event => setAdx(Number(event.target.value))} />
          <p>환산값: ({adx} − 25) ÷ 20 = {number(left)}</p></div>
        <div><label htmlFor="manual-rsi-change">예시 RSI 5일 변화 <strong>{rsiChange}p</strong></label><input id="manual-rsi-change" type="range" min="-40" max="40" value={rsiChange} onChange={event => setRsiChange(Number(event.target.value))} />
          <p>환산값: ({rsiChange} − 0) ÷ 10 → {number(right)} (−3~3 제한)</p></div>
      </div>
      <label htmlFor="manual-operation">조합 방식</label><select id="manual-operation" value={operation} onChange={event => setOperation(event.target.value as PaperIndicatorOperation)}>
        <option value="MEAN">평균 — 두 값의 평균 수준</option><option value="DIFFERENCE">차이 — 첫 값에서 두 번째 빼기</option><option value="PRODUCT">곱 — 같은 쪽인지 반대쪽인지</option>
      </select>
      <output className="manual-combined-result" aria-label="발명 지표 계산 결과" aria-live="polite">
        {operation === 'MEAN' ? `(${number(left)} + ${number(right)}) ÷ 2` : `${number(left)} ${operation === 'PRODUCT' ? '×' : '−'} ${number(right)}`} = <strong>{number(combined)}</strong>
      </output>
      <p>{explanation.meaning}</p>
      <div className="manual-callout" aria-live="polite"><strong>예시 시험 조건: 조합값 1 이상 → {combined >= 1 ? '해당' : '해당하지 않음'}</strong>
        <p>실제 규칙은 다른 구간을 선택할 수 있습니다. 예시 조건에 맞아도 여기서 매수는 발생하지 않습니다.</p></div>
    </article>
  </section>;
}
