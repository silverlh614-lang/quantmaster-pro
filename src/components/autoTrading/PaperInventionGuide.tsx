// @responsibility Present understandable invented indicator research states.
import React, { useState } from 'react';
import { PAPER_ADAPTIVE_REASON_LABELS, type PaperAdaptiveState } from '../../types/paperAdaptive';
import { explainPaperIndicator } from '../../utils/paperIndicatorExplanation';
import { PaperFormulaExplanation } from './PaperFormulaExplanation';

export function PaperInventionGuide({ state }: { state?: PaperAdaptiveState }) {
  const [showAll, setShowAll] = useState(false);
  const inventions = new Map((state?.discovery?.inventions ?? []).map(item => [item.id, item]));
  for (const item of state?.candidates ?? []) if (item.rule.invention) inventions.set(item.rule.invention.id, item.rule.invention);
  for (const item of state?.exploration?.rules ?? []) if (item.candidate.rule.invention) inventions.set(item.candidate.rule.invention.id, item.candidate.rule.invention);
  const cards = [...inventions.values()].map(invention => {
    const evaluated = state?.candidates.find(item => item.rule.feature === invention.id);
    const trial = state?.exploration?.rules.find(item => item.candidate.rule.feature === invention.id);
    const candidate = evaluated?.active ? evaluated : trial?.candidate ?? evaluated;
    const status = evaluated?.active ? '검증 매수에 연결' : trial ? '탐색 가상매수 · 검증 전'
      : evaluated?.reason === 'DISCOVERY_RETIRED' ? '연구 종료' : '연구 중 · 매수 연결 없음';
    return { invention, candidate, status, priority: evaluated?.active ? 0 : trial ? 1 : 2,
      rule: candidate?.rule ?? { feature: invention.id, ...invention.rule, invention } };
  }).sort((a, b) => a.priority - b.priority || b.invention.createdAt.localeCompare(a.invention.createdAt));
  return <section className="paper-invention-guide" aria-label="발명 지표 쉽게 이해하기">
    <h3>발명 지표, 무엇을 만든 건가요?</h3>
    <p>기본 지표 두 개를 평균·차이·곱으로 묶어 만든 새로운 관측 기준입니다. 프로그램이 과거 자료에서 후보를 찾고, 만든 뒤 새로 들어온 자료에서 쓸모가 있는지 확인합니다.</p>
    <ol className="paper-invention-steps"><li><strong>만들기</strong><span>두 지표의 조합과 시험 구간 찾기</span></li>
      <li><strong>시험하기</strong><span>새 관측과 탐색 가상매수로 결과 기록</span></li>
      <li><strong>선택하기</strong><span>검증 성과에 따라 연결·해제·재검토</span></li></ol>
    <p>‘발명’은 수식을 만들었다는 뜻이며 수익성이 입증됐다는 뜻은 아닙니다. <strong>탐색 매수는 검증 전 시험</strong>이고, 검증 매수는 별도 성과 확인을 통과한 규칙을 사용합니다.</p>
    {!state ? <p>현재 발명 지표의 적용 상태는 자료를 확인한 뒤 표시합니다.</p> : <>
      <div className="paper-invention-heading"><h4>보관 중인 발명 지표 {cards.length}개</h4><span>항목을 펼쳐 재료·뜻·적용 구간 확인</span></div>
      {!cards.length && <p>아직 표시할 발명 지표가 없습니다. 기본 지표의 관측과 연구는 계속됩니다.</p>}
      <div className="paper-invention-cards">{(showAll ? cards : cards.slice(0, 3)).map(({ invention, candidate, status, rule }) => {
        const explanation = explainPaperIndicator(invention.formula);
        return <details className="paper-invention-card" key={invention.id}>
          <summary><span className="paper-invention-status">{status}</span><strong>{explanation.title}</strong><span>설명 펼치기</span></summary>
          <div><p><strong>현재 판단 이유</strong> · {candidate ? PAPER_ADAPTIVE_REASON_LABELS[candidate.reason] : '아직 평가 기록 없음'}</p>
            <PaperFormulaExplanation rule={rule} />
            <p>생성 {new Date(invention.createdAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })} KST</p>
            {candidate && <p>생성 후 검증 표본 {candidate.validation.sampleCount}건 · {candidate.validation.dateCount}개 진입일 · 평균 순수익률 {candidate.validation.meanNetReturnPct === null ? '미집계' : `${candidate.validation.meanNetReturnPct.toFixed(2)}%`}</p>}
            <p>이 상태는 현재 규칙의 연결 여부입니다. 실제 가상매수 여부는 종목별 거래 기록에서 확인하며, 이미 보유한 거래의 규칙은 바뀌지 않습니다.</p>
          </div>
        </details>;
      })}</div>
      {cards.length > 3 && <button type="button" className="lab-board-link" aria-expanded={showAll} onClick={() => setShowAll(value => !value)}>
        {showAll ? '주요 지표 3개만 보기' : `발명 지표 ${cards.length}개 모두 보기`}</button>}
    </>}
  </section>;
}
