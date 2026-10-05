// @responsibility Present understandable invented indicator research states.
import React, { useState } from 'react';
import { PAPER_ADAPTIVE_REASON_LABELS, type PaperAdaptiveState } from '../../types/paperAdaptive';
import { PAPER_PROGRAM_LIMITS } from '../../types/paperIndicatorProgram';
import { explainPaperIndicator } from '../../utils/paperIndicatorExplanation';
import { PaperFormulaExplanation } from './PaperFormulaExplanation';
import { PaperAutonomyPanel } from './PaperAutonomyPanel';

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
    <p>기본 지표를 조합해 만든 새로운 관측 기준입니다. 두 지표의 평균·차이·곱을 탐색하고, AI도 여러 단계 계산이나 조건 분기로 새 가설을 제안합니다. 학습 자료에서 후보를 고른 뒤 새 관측으로 쓸모를 확인합니다.</p>
    <ol className="paper-invention-steps"><li><strong>만들기</strong><span>계산법 작성 → 계산 검사 → 학습에서 선발</span></li>
      <li><strong>시험하기</strong><span>새 관측과 탐색 가상매수로 결과 기록</span></li>
      <li><strong>선택하기</strong><span>검증 성과에 따라 연결·해제·재검토</span></li></ol>
    <p>‘발명’은 수식을 만들었다는 뜻이며 수익성이 입증됐다는 뜻은 아닙니다. <strong>탐색 매수는 검증 전 시험</strong>이고, 검증 매수는 별도 성과 확인을 통과한 규칙을 사용합니다.</p>
    <PaperProgramStatus state={state} />
    <PaperAutonomyPanel state={state} />
    {!state ? <p>현재 발명 지표의 적용 상태는 자료를 확인한 뒤 표시합니다.</p> : <>
      <div className="paper-invention-heading"><h4>보관 중인 발명 지표 {cards.length}개</h4><span>항목을 펼쳐 재료·뜻·적용 구간 확인</span></div>
      {!cards.length && <p>아직 표시할 발명 지표가 없습니다. 기본 지표의 관측과 연구는 계속됩니다.</p>}
      <div className="paper-invention-cards">{(showAll ? cards : cards.slice(0, 3)).map(({ invention, candidate, status, rule }) => {
        const explanation = explainPaperIndicator(invention.formula);
        return <details className="paper-invention-card" key={invention.id}>
          <summary><span className="paper-invention-status">{status}</span><strong>{explanation.title}</strong><span>설명 펼치기</span></summary>
          <div><p><strong>현재 판단 이유</strong> · {candidate ? PAPER_ADAPTIVE_REASON_LABELS[candidate.reason] : '아직 평가 기록 없음'}</p>
            <PaperFormulaExplanation rule={rule} />
            {invention.authorship && <p>AI 작성 {new Date(invention.authorship.generatedAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })} KST</p>}
            <p>연구 등록 {new Date(invention.createdAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })} KST · 이 시점 이후 새 관측으로 검증</p>
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

function PaperProgramStatus({ state }: { state?: PaperAdaptiveState }) {
  const research = state?.programResearch;
  const researchLabels = { IDLE: '새 학습 자료 대기', RUNNING: '새 계산법 작성 중', READY: '작성 회차 완료 · 수익성 검증과 별개', FAILED: '이번 작성 회차 확인 필요' };
  const reviewLabels = { REGISTERED: '연구 등록 후 현재 보관 종료', NO_TRAINING_EDGE: '학습 표본 또는 성과 부족',
    REDUNDANT_OR_CONSTANT: '다른 조건과 중복되거나 값 변화 부족', RANKED_OUT: '학습 검사 완료 · 이번 선발에서 제외' };
  if (!research) return null;
  return <div className="paper-program-research" aria-label="AI 계산법 연구 상태">
      <h4>AI 계산법 연구</h4><strong>{researchLabels[research.state]}</strong>
      <p>{research.message}</p>
      <p>장외 하루 최대 1회 · 후보 {PAPER_PROGRAM_LIMITS.dailyProposals}개까지 · 새 학습 자료나 검사 결과가 있을 때 작성합니다.</p>
      {research.attemptedAt && <p>마지막 시도 {new Date(research.attemptedAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })} KST</p>}
      <p>작성한 후보는 다음 일일 평가에서 선발합니다. 최대 2개 탐색 규칙에 연결된 뒤 새 관측과 진입 조건을 통과하면 가상 매수가 가능하며, 기존 거래의 계산법은 유지됩니다.</p>
      {!!research.proposals.length && <details><summary>최근 AI 후보 {research.proposals.length}개와 적용 상태</summary>
        <ul>{research.proposals.map(item => {
          const review = [...(state?.discovery?.programReviews ?? [])].reverse().find(review => review.id === item.id);
          return <li key={item.id}><strong>{item.title}</strong><span>{item.registered ? '연구 등록 · 연결 여부는 아래 지표에서 확인'
            : item.evaluated ? review ? reviewLabels[review.status] : '학습 검사 완료 · 현재 미등록' : '계산 검사 통과 · 학습 선발 대기'}</span></li>;
        })}</ul>
      </details>}
    </div>;
}
