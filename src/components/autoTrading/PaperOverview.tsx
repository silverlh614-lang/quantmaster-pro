// @responsibility Present current Shadow progress.
import React from 'react';
import { ArrowUpRight, ArrowRight, Database, Radar, Route } from 'lucide-react';
import type { PaperOverviewView } from '../../types/paperExperiment';
import { useSettingsStore } from '../../stores/useSettingsStore';

const count = (value: number | undefined) => value === undefined ? '확인 대기' : value.toLocaleString('ko-KR');
const percent = (value: number | null | undefined) => value == null ? '집계 대기' : `${value > 0 ? '+' : ''}${value.toFixed(2)}%`;
export function paperTime(value: string | null | undefined) {
  return value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }) : '기록 대기';
}

export function PaperOverview({ view, mode, paused }: { view: PaperOverviewView; mode?: string; paused?: boolean }) {
  const setView = useSettingsStore(state => state.setView);
  const last = view.lastRun;
  const strategy = view.strategy;
  const research = view.research;
  const strategyUnavailable = Boolean(strategy?.error || strategy?.lastRun?.error);
  const stale = !!last && (!Number.isFinite(Date.parse(last.asOf)) || Date.now() - Date.parse(last.asOf) > 5 * 60_000);
  const status = !mode || paused === undefined ? '운영 상태 확인 중' : mode !== 'SHADOW' ? '저장 기록 조회 중' : paused ? '자동 관측 일시정지' : stale ? '최근 관측 갱신 확인 필요' : !last ? '첫 관측을 기다리고 있습니다' : last.marketOpen ? '장중 관측 기록을 쌓고 있습니다' : '장외 관측 · 다음 진입을 기다립니다';
  const features = research?.features ?? [];
  const extent = Math.max(0.01, ...features.map(item => Math.abs(item.matchedDifferencePct ?? 0)));
  return <>
    <section className="workspace-hero">
      <div><span className="workspace-eyebrow">현재 진행 상황</span><h2>{status}</h2>
        <p>종목당 1주를 관측하고, 결과가 쌓이면 뉴스·추세별 가상 전략의 근거로 사용합니다.</p>
        <div className="workspace-hero-meta"><span>마지막 스캔 <strong>{paperTime(last?.asOf)}</strong></span><span>신규 진입 <strong>거래일 09:00–15:30</strong></span></div>
      </div><div className="workspace-hero-mark" aria-hidden="true"><Radar size={64} strokeWidth={1} /><span>OBSERVE / LEARN</span></div>
    </section>
    <dl className="workspace-metrics">
      {[
        ['최근 관측 후보', count(last?.candidateCount), '종목', last ? `현재가 확인 ${count(last.observedCount)} · 미확인 ${count(last.missingPriceCount)}` : '첫 스캔 이후 집계'],
        ['기본 관측 누적', count(view.totalCount), '건', `관찰 중 ${count(view.openCount)} · D5 완료 ${count(view.completedCount)}`],
        ['전략 가상 보유', strategyUnavailable ? '확인 불가' : count(strategy?.openCount), '건', strategyUnavailable ? '전략 기록 확인 필요' : `가상 청산 ${count(strategy?.performance.closedCount)}건`],
        ['과거 자료 재현', count(research?.sampleCount), '건', research ? `${count(research.symbols)}종목 · 전략 학습 가능 ${count(research.learningSampleCount)}건` : '저장 자료 연구 대기'],
      ].map(([label, value, unit, note]) => <div key={label} className="workspace-metric"><dt>{label}</dt><dd>{value}<small>{/^\d/.test(value) ? unit : ''}</small></dd><p>{note}</p></div>)}
    </dl>
    <div className="workspace-two-column">
      <section className="workspace-card"><div className="workspace-card-heading"><div><span className="workspace-eyebrow">전략 판단</span><h2>지금 무엇을 기다리나요?</h2></div><Route size={20} /></div>
        {strategyUnavailable ? <p role="alert" className="workspace-alert">전략 기록 확인 불가 · 기본 관측은 별도로 표시됩니다.</p> : <>
          <div className="workspace-decision-counts">{([['BUY', '매수'], ['WAIT', '대기'], ['HOLD', '보유'], ['EXIT', '청산']] as const).map(([key, label]) => <div key={key}><span>{label}</span><strong>{count(strategy?.decisionCounts[key])}</strong></div>)}</div>
          <div className="workspace-reasons">{strategy?.waitingReasons.length ? strategy.waitingReasons.map(item => <div key={item.code}><span>{item.label}</span><strong>{count(item.count)}종목</strong></div>) : <p>대기 사유는 최근 전략 판단이 기록되면 표시됩니다.</p>}</div>
        </>}
        <button type="button" className="workspace-text-button" onClick={() => setView('PAPER_STRATEGY')}>종목별 판단과 진입 근거 <ArrowRight size={15} /></button>
      </section>
      <section className="workspace-card"><div className="workspace-card-heading"><div><span className="workspace-eyebrow">성과의 기준</span><h2>기본 관측과 선택 전략</h2></div><Radar size={20} /></div>
        <div className="workspace-horizons">{([1, 3, 5] as const).map(h => { const item = view.outcomes.find(row => row.horizon === h); return <div key={h}><span>D{h} 관측 평균</span><strong>{percent(item?.meanNetReturnPct)}</strong><small>{count(item?.count ?? 0)}건 완료</small></div>; })}</div>
        <div className="workspace-strategy-return"><span>전략 가상 청산 평균</span><strong>{strategyUnavailable ? '확인 불가' : percent(strategy?.performance.meanNetReturnPct)}</strong></div>
        <p className="workspace-note">각 실험의 비용 반영 순수익률입니다. 계좌 수익률이 아니며, 미완료 결과는 집계 대기로 표시합니다.</p>
        <button type="button" className="workspace-text-button" onClick={() => setView('PAPER_OBSERVATIONS')}>기본 관측 기록 <ArrowRight size={15} /></button>
      </section>
    </div>
    <section className="workspace-card"><div className="workspace-card-heading"><div><span className="workspace-eyebrow">연구에서 발견한 차이</span><h2>조건 하나씩, 같은 기준으로 비교</h2></div><button type="button" className="workspace-text-button" onClick={() => setView('PAPER_RESEARCH')}>연구 전체 보기 <ArrowUpRight size={16} /></button></div>
      {research?.error && <p role="alert" className="workspace-alert">연구 갱신 실패 · 저장된 결과를 표시합니다.</p>}
      <p className="workspace-note">후반 검증에서 날짜·뉴스·추세·보유기간을 맞춘 대조군 대비 차이(%p). 탐색 결과이며 매매에 자동 적용되지 않습니다.</p>
      <div className="workspace-feature-chart" aria-label="조건별 후반 검증 차이">
        {features.map(item => { const value = item.status === 'EVALUATED' ? item.matchedDifferencePct : null; return <div key={item.feature} className="workspace-feature-row">
          <span>{item.label}<small>{count(item.testCount)}건 · {count(item.testSymbolCount)}종목 · {count(item.testDateCount)}진입일</small></span>
          <div className="workspace-feature-track" aria-hidden="true"><i /><b className={value !== null && value < 0 ? 'negative' : ''} style={{ width: `${Math.abs(value ?? 0) / extent * 48}%`, left: value !== null && value < 0 ? `${50 - Math.abs(value) / extent * 48}%` : '50%' }} /></div>
          <strong>{value === null ? '비교 대기' : `${value > 0 ? '+' : ''}${value.toFixed(2)}%p`}</strong>
        </div>; })}
        {!features.length && <div className="workspace-empty">저장 자료 연구를 실행하면 조건별 비교 결과가 표시됩니다.</div>}
      </div>
      <div className="workspace-source-note"><Database size={15} /><span>과거 진입일 {research?.firstDate ?? '미확인'} ~ {research?.lastDate ?? '미확인'} · 연구 갱신 {paperTime(research?.asOf)}</span></div>
    </section>
    {!!last?.issues.length && <details className="workspace-card"><summary>관측 중 확인할 항목 {last.issues.length}건</summary><ul className="workspace-issues">{last.issues.map((issue, i) => <li key={i}>{issue.replace('CURRENT_QUOTE_UNAVAILABLE', '현재가 확인 불가')}</li>)}</ul></details>}
  </>;
}
