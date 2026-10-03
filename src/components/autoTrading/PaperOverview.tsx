// @responsibility Present the autonomous research dashboard.
import React from 'react';
import { Activity, ArrowRight, ArrowUpRight, Check, Clock3, Database, FlaskConical, Layers3, Radar, ScanLine, TrendingUp } from 'lucide-react';
import type { PaperOverviewView } from '../../types/paperExperiment';
import { PAPER_OBSERVATION_ISSUE_LABELS } from '../../types/paperExperiment';
import { useSettingsStore } from '../../stores/useSettingsStore';
import { PaperResearchBoard } from './PaperResearchBoard';
import '../../styles/paperDashboard.css';

const count = (value: number | undefined) => value === undefined ? '확인 대기' : value.toLocaleString('ko-KR');
const percent = (value: number | null | undefined) => value == null ? '집계 대기' : `${value > 0 ? '+' : ''}${value.toFixed(2)}%`;
export function paperTime(value: string | null | undefined) {
  return value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }) : '기록 대기';
}

export function PaperOverview({ view, mode, paused, refreshFailed = false }: {
  view: PaperOverviewView; mode?: string; paused?: boolean; refreshFailed?: boolean;
}) {
  const setView = useSettingsStore(state => state.setView);
  const { lastRun: last, strategy, research, collection } = view;
  const now = Date.now();
  const collectionAge = collection ? now - Date.parse(collection.lastProgressAt) : Infinity;
  const collecting = !refreshFailed && !!collection && collectionAge >= 0 && collectionAge <= 60_000;
  const strategyUnavailable = refreshFailed || Boolean(strategy?.error || strategy?.lastRun?.error);
  const age = last ? now - Date.parse(last.asOf) : Infinity;
  const stale = !!last && (!Number.isFinite(age) || age < 0 || age > 5 * 60_000);
  const status = !mode || paused === undefined ? '운영 상태 확인 중' : mode !== 'SHADOW' ? '저장 기록 조회 중'
    : paused ? '자동 관측 일시정지' : refreshFailed ? '최근 자료 조회 실패' : collecting ? '관측 자료 수집 중'
      : stale ? '최근 관측 갱신 확인 필요' : !last ? '첫 관측을 기다리고 있습니다'
        : last.marketOpen ? '장중 관측 기록을 쌓고 있습니다' : '장외 관측 · 다음 진입을 기다립니다';
  const healthy = mode === 'SHADOW' && paused === false && !refreshFailed && (collecting || (!!last && !stale));
  const adaptive = strategy?.adaptive;
  const active = adaptive?.candidates.filter(item => item.active).length;
  const inventions = adaptive?.discovery?.inventions.length;
  const performance = strategyUnavailable ? undefined : strategy?.performanceByVersion?.['adaptive-features-v1'];
  const decisionTotal = strategy ? Object.values(strategy.decisionCounts).reduce((sum, value) => sum + value, 0) : 0;
  const outcomeExtent = Math.max(0.01, ...view.outcomes.map(item => Math.abs(item.meanNetReturnPct ?? 0)));
  const features = research?.features ?? [];
  const featureExtent = Math.max(0.01, ...features.map(item => Math.abs(item.matchedDifferencePct ?? 0)));
  const stats = [
    { label: '누적 기본 관측', value: count(view.totalCount), unit: '건', note: `D5 완료 ${count(view.completedCount)}건`, icon: Radar, tone: 'mint' },
    { label: '발명 지표 연구', value: strategyUnavailable ? '확인 불가' : count(inventions), unit: '개',
      note: adaptive?.discovery ? `탐색 ${adaptive.discovery.round}차 · 보관 중인 수식` : '첫 수식 탐색을 기다립니다', icon: FlaskConical, tone: 'lilac' },
    { label: '매수에 연결된 지표', value: strategyUnavailable ? '확인 불가' : count(active), unit: '개',
      note: adaptive ? `기본·발명 지표 중 최대 ${adaptive.policy.maxActiveRules}개 선택` : '첫 지표 평가를 기다립니다', icon: Layers3, tone: 'mint' },
    { label: '자율 전략 평균 순수익', value: strategyUnavailable ? '확인 불가' : percent(performance?.meanNetReturnPct), unit: '',
      note: performance ? `실제 가상 청산 ${count(performance.closedCount)}건 기준` : '자율 전략의 청산 결과를 기다립니다', icon: TrendingUp,
      tone: (performance?.meanNetReturnPct ?? 0) < 0 ? 'negative' : 'mint' },
  ];
  return <div className="qdash">
    <section className={`qdash-status ${healthy ? 'is-current' : 'needs-review'}`} aria-label="관측 운영 상태">
      <span className="qdash-status-icon" aria-hidden="true"><Activity size={18} /></span>
      <div className="qdash-status-copy"><h2>{status}</h2><p>기본 관측은 쌓고, 지표는 검증하며, 판단은 기록합니다.</p></div>
      <div className="qdash-status-meta"><span><Clock3 size={13} />마지막 관측 완료 <strong>{paperTime(last?.asOf)}</strong></span>
        {collection && <span>{collecting ? '수집 진행' : '수집 지연 확인 필요'} <strong>{collection.completed}/{collection.total}종목</strong></span>}
        {last?.durationMs !== undefined && <span>수집 소요 <strong>{Math.round(last.durationMs / 1000)}초</strong></span>}</div>
      {collection && collecting && collection.total > 0 && <progress className="qdash-collection-progress" value={Math.max(0, Math.min(collection.completed, collection.total))} max={collection.total} aria-label="현재 관측 수집 진행률" />}
    </section>
    <dl className="qdash-metrics" aria-label="연구 핵심 지표">{stats.map(({ label, value, unit, note, icon: Icon, tone }) =>
      <div className={`qdash-metric tone-${tone}`} key={label}><dt>{label}<Icon size={16} aria-hidden="true" /></dt>
        <dd className={/^[-+\d]/.test(value) ? '' : 'is-pending'}>{value}{/^\d/.test(value) && unit && <small>{unit}</small>}</dd>
        <p>{strategyUnavailable && label !== '누적 기본 관측' ? '전략 기록 확인 필요' : note}</p>
      </div>)}</dl>
    <PaperResearchBoard state={adaptive} unavailable={strategyUnavailable} />
    <div className="qdash-detail-grid">
      <section className="qdash-panel" aria-label="성과 기록">
        <header className="qdash-panel-heading"><div><span className="qdash-kicker">성과 기록</span><h2>판단 이후, 어떤 결과였나요?</h2></div>
          <button type="button" className="qdash-link" onClick={() => setView('PAPER_OBSERVATIONS')}>관측 기록 <ArrowUpRight size={15} /></button></header>
        <div className="qdash-performance"><div><span>자율 전략 · 가상 청산 평균</span>
          <strong className={performance?.meanNetReturnPct == null ? 'is-pending' : performance.meanNetReturnPct < 0 ? 'is-negative' : ''}>{strategyUnavailable ? '확인 불가' : percent(performance?.meanNetReturnPct)}</strong></div>
          <dl><div><dt>자율 전략 누적 청산</dt><dd>{strategyUnavailable ? '확인 불가' : count(performance?.closedCount)}{performance && '건'}</dd></div>
            <div><dt>승률</dt><dd>{strategyUnavailable ? '확인 불가' : performance?.winRatePct == null ? '집계 대기' : `${performance.winRatePct.toFixed(1)}%`}</dd></div></dl></div>
        <div className="qdash-chart-heading"><h3>기본 관측의 보유기간별 성과</h3><span>비용 반영 순수익률</span></div>
        <div className="qdash-outcomes" aria-label="기본 관측 D1·D3·D5 평균 순수익률">
          {([1, 3, 5] as const).map(horizon => {
            const item = view.outcomes.find(row => row.horizon === horizon), value = item?.meanNetReturnPct;
            const width = Math.abs(value ?? 0) / outcomeExtent * 48;
            return <div key={horizon} className="qdash-outcome"><span className="qdash-horizon">D{horizon}<small>{item ? `${count(item.count)}건` : '표본 확인 대기'}</small></span>
              <div className="qdash-return-track" aria-hidden="true"><i /><b className={(value ?? 0) < 0 ? 'is-negative' : ''}
                style={{ width: `${width}%`, left: (value ?? 0) < 0 ? `${50 - width}%` : '50%' }} /></div>
              <strong className={(value ?? 0) < 0 ? 'is-negative' : ''}>{percent(value)}</strong></div>;
          })}
          <div className="qdash-chart-zero" aria-hidden="true">0%</div>
        </div>
        <p className="qdash-note">기본 관측과 자율 전략은 서로 다른 표본입니다. 각 실험의 확정 성과이며 계좌 수익률은 아닙니다.</p>
      </section>
      <section className="qdash-panel" aria-label="최근 전략 판단">
        <header className="qdash-panel-heading"><div><span className="qdash-kicker">이번 스캔의 판단</span><h2>지금의 선택과 대기 사유</h2></div><ScanLine size={20} aria-hidden="true" /></header>
        {strategyUnavailable ? <div role="alert" className="qdash-empty">전략 기록 확인 불가 · 기본 관측은 별도로 표시됩니다.</div> : <>
          <p className="qdash-note">스캔 시각 {paperTime(strategy?.lastRun?.asOf)} · 표시된 스캔 1회의 판단</p>
          <div className="qdash-decisions">{([['BUY', '신규 진입'], ['WAIT', '진입 대기'], ['HOLD', '보유 유지'], ['EXIT', '이번 청산']] as const).map(([key, label]) =>
            <div key={key} className={`qdash-decision is-${key.toLowerCase()}`}><span>{label}</span><strong className={strategy ? '' : 'is-pending'}>{count(strategy?.decisionCounts[key])}</strong></div>)}</div>
          {decisionTotal > 0 && <div className="qdash-decision-strip" aria-hidden="true">{(['BUY', 'WAIT', 'HOLD', 'EXIT'] as const).map(key =>
            <span className={`is-${key.toLowerCase()}`} key={key} style={{ width: `${strategy!.decisionCounts[key] / decisionTotal * 100}%` }} />)}</div>}
          <div className="qdash-chart-heading"><h3>보유 유지 사유</h3></div>
          <div className="qdash-waiting" role="group" aria-label="보유 유지 사유">{strategy?.holdingReasons?.length ? strategy.holdingReasons.slice(0, 3).map(item =>
            <div key={item.code}><span><i aria-hidden="true" />{item.label}</span><strong>{count(item.count)}<small>건</small></strong></div>)
            : <p>{strategy?.decisionCounts.HOLD === 0 ? '이번 스캔에 보유 유지 판단이 없습니다.' : '보유 사유 집계 확인 대기'}</p>}</div>
          <div className="qdash-chart-heading"><h3>진입 대기 사유</h3></div>
          <div className="qdash-waiting" role="group" aria-label="진입 대기 사유">{strategy?.waitingReasons.length ? strategy.waitingReasons.slice(0, 3).map(item =>
            <div key={item.code}><span><i aria-hidden="true" />{item.label}</span><strong>{count(item.count)}<small>종목</small></strong></div>)
            : <p>{strategy?.decisionCounts.WAIT === 0 ? '이번 스캔에 진입 대기 판단이 없습니다.' : '진입 대기 사유 집계 확인 대기'}</p>}</div>
          <div className="qdash-trade-meta"><span>전체 Shadow 보유 <strong>{strategy ? `${count(strategy.openCount)}건` : '확인 대기'}</strong></span>
            <span>전체 누적 청산 (구전략 포함) <strong>{strategy?.performance?.closedCount === undefined ? '확인 대기' : `${count(strategy.performance.closedCount)}건`}</strong></span></div>
        </>}
        <button type="button" className="qdash-link qdash-bottom-link" onClick={() => setView('PAPER_STRATEGY')}>종목별 판단과 진입 근거 <ArrowRight size={15} /></button>
      </section>
    </div>
    <section className="qdash-coverage" aria-label="관측 데이터 현황">
      <div className="qdash-coverage-title"><Database size={18} aria-hidden="true" /><div><h2>관측 데이터</h2><p>마지막 완료 스캔 기준</p></div></div>
      <dl><div><dt>관측 후보</dt><dd>{count(last?.candidateCount)}{last && <small>종목</small>}</dd></div>
        <div><dt><Check size={12} />현재가 확인</dt><dd>{count(last?.observedCount)}{last && <small>종목</small>}</dd></div>
        <div><dt>현재가 미확인</dt><dd>{count(last?.missingPriceCount)}{last && <small>종목</small>}</dd></div>
        <div><dt>기본 관찰 중</dt><dd>{count(view.openCount)}<small>건</small></dd></div></dl>
      <button type="button" className="qdash-link" onClick={() => setView('OPERATIONS')}>운영 상태 <ArrowUpRight size={15} /></button>
    </section>
    <section className="qdash-archive">
      <header><div><span className="qdash-kicker">저장 자료 연구</span><h2>과거 기록에서도 근거를 찾습니다.</h2><p>{research ? `재현 ${count(research.sampleCount)}건 · ${count(research.symbols)}종목 · 갱신 ${paperTime(research.asOf)}` : '저장 자료 연구 기록을 기다립니다.'}</p></div>
        <button type="button" className="qdash-link" onClick={() => setView('PAPER_RESEARCH')}>연구 전체 보기 <ArrowUpRight size={15} /></button></header>
      {research?.error && <p role="alert" className="workspace-alert">연구 갱신 실패 · 저장된 연구 결과를 표시합니다.</p>}
      <details><summary>과거 7개 조건의 후반 검증 결과 <span>자율 지표 연구와 별도</span></summary>
        <p className="qdash-note">날짜·뉴스·추세·보유기간이 같은 대조군 대비 차이입니다. 이 과거 재현 결과는 매수 판단에 자동 적용하지 않습니다.</p>
        <div className="qdash-archive-results">{features.map(item => {
          const value = item.status === 'EVALUATED' ? item.matchedDifferencePct : null, width = Math.abs(value ?? 0) / featureExtent * 48;
          return <div key={item.feature}><span>{item.label}<small>{count(item.testCount)}건 · {count(item.testDateCount)}진입일</small></span>
            <div className="qdash-return-track" aria-hidden="true"><i /><b className={(value ?? 0) < 0 ? 'is-negative' : ''}
              style={{ width: `${width}%`, left: (value ?? 0) < 0 ? `${50 - width}%` : '50%' }} /></div>
            <strong>{value === null ? '비교 대기' : `${value > 0 ? '+' : ''}${value.toFixed(2)}%p`}</strong></div>;
        })}</div>
        {!features.length && <p className="qdash-empty">저장 자료 연구 결과가 아직 없습니다.</p>}
        <p className="qdash-note">과거 진입일 {research?.firstDate ?? '미확인'} ~ {research?.lastDate ?? '미확인'}</p>
      </details>
    </section>
    {!!last?.issues.length && <details className="qdash-issues"><summary>관측 중 확인할 항목 <span>{last.issues.length}건</span></summary>
      <ul>{last.issues.map((issue, index) => <li key={index}>{issue.split(':').map(part => PAPER_OBSERVATION_ISSUE_LABELS[part] ?? part).join(': ')}</li>)}</ul></details>}
  </div>;
}
