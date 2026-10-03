// @responsibility Display empirical Shadow strategy decisions.
import React, { useMemo, useState } from 'react';
import type {
  PaperStrategyCohort, PaperStrategyDecision, PaperStrategyEvidence,
  PaperStrategyPolicy, PaperStrategySelection, PaperStrategyTrade, PaperStrategyView,
} from '../../types/paperStrategy';
import { Section } from '../../ui/section';
import { PaperNewsDetails } from './PaperNewsDetails';
import { summarizePaperNews } from '../../utils/paperNews';
import { PaperInvestorFlowDetails } from './PaperInvestorFlowPanel';
import { PaperAdaptiveEvidenceDetails, PaperAdaptivePanel } from './PaperAdaptivePanel';

const cohortLabels: Record<PaperStrategyCohort, string> = {
  NEWS_RECENT_ABOVE_MA20: '최근 관측 뉴스 있음 · 20일선 위',
  NEWS_RECENT_BELOW_MA20: '최근 관측 뉴스 있음 · 20일선 이하',
  NEWS_ABSENT_ABOVE_MA20: '최근 관측 뉴스 없음 · 20일선 위',
  NEWS_ABSENT_BELOW_MA20: '최근 관측 뉴스 없음 · 20일선 이하',
};
const actionLabels: Record<PaperStrategyDecision['action'], string> = {
  BUY: '매수 · BUY', WAIT: '대기 · WAIT', HOLD: '보유 · HOLD', EXIT: '청산 · EXIT',
};
const actionColors: Record<PaperStrategyDecision['action'], string> = {
  BUY: 'border-emerald-400/30 bg-emerald-500/10 text-emerald-200',
  WAIT: 'border-amber-400/30 bg-amber-500/10 text-amber-200',
  HOLD: 'border-sky-400/30 bg-sky-500/10 text-sky-200',
  EXIT: 'border-violet-400/30 bg-violet-500/10 text-violet-200',
};

function percent(value: number | null): string {
  return value !== null && Number.isFinite(value)
    ? `${value > 0 ? '+' : ''}${value.toFixed(2)}%` : '집계 대기';
}

function SelectionSummary({ selection }: { selection: PaperStrategySelection }) {
  const c = selection.comparison;
  return (
    <div>
      <h4 className="mb-3 text-sm font-semibold text-slate-200">전략 선별력 · 같은 날 후보 대비</h4>
      <dl className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {[
          ['신규 진입률', selection.selectionRatePct === null ? '집계 대기' : `${selection.selectionRatePct.toFixed(1)}%`, `후보 ${selection.candidateCount}건 중 ${selection.boughtCount}건 · ${selection.dateCount}일`],
          ['전략 청산 평균', percent(c.strategyMeanPct), `${c.strategyTradeCount}건`],
          ['같은 날 미진입 평균', percent(c.unselectedMeanPct), `${c.unselectedCount}건`],
          ['차이', c.differencePct === null ? '비교 대기' : `${c.differencePct > 0 ? '+' : ''}${c.differencePct.toFixed(2)}%p`, `${c.groupCount}개 날짜·기간`],
        ].map(([label, value, note]) => (
          <div key={label} className="rounded-xl border border-slate-700/60 bg-slate-900/50 p-3">
            <dt className="text-xs text-slate-400">{label}</dt><dd className="mt-2 text-xl font-semibold tabular-nums text-sky-200">{value}</dd>
            <p className="mt-1 text-xs text-slate-500">{note}</p>
          </div>
        ))}
      </dl>
      <ul className="mt-3 space-y-1 text-xs text-slate-400">
        {selection.cohorts.filter(item => item.candidateCount).map(item => (
          <li key={item.cohort}>{cohortLabels[item.cohort]} · {item.boughtCount}/{item.candidateCount} 진입</li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-slate-400">전략이 진입한 날의 기본 관측 후보를 같은 진입일·같은 보유기간으로 맞춰 비교합니다. 기존 보유 {selection.heldCount}건은 그날 판단에서 빠진 종목입니다. 진입률이 높고 차이가 0 근처면 종목을 거르지 못하는 상태입니다. 연구 표시이며 매수 조건에 쓰지 않습니다.</p>
    </div>
  );
}

function money(value: number | null): string {
  return value !== null && Number.isFinite(value)
    ? `${value > 0 ? '+' : ''}${value.toLocaleString('ko-KR', { maximumFractionDigits: 2 })}원` : '집계 대기';
}

function timestamp(value: string): string {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? date.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', hour12: false }) : '시각 확인 불가';
}

function ActionBadge({ action }: { action: PaperStrategyDecision['action'] }) {
  return <span className={`inline-flex rounded-md border px-2 py-1 text-xs font-semibold ${actionColors[action]}`}>{actionLabels[action]}</span>;
}

function Evidence({ evidence, policy }: { evidence: PaperStrategyEvidence; policy: PaperStrategyPolicy }) {
  return (
    <details className="rounded-lg border border-slate-700/60 bg-slate-950/30 text-xs text-slate-300">
      <summary className="cursor-pointer p-3 font-medium">
        근거 표본 {evidence.sampleCount}건 / 최소 {policy.minimumSamples}건 · 진입일 {evidence.entryDateCount}일 / 최소 {policy.minimumEntryDates}일
        {' · '}{evidence.selectedHorizon === null ? '선택 기간 없음' : `선택 D${evidence.selectedHorizon}`}
      </summary>
      <div className="space-y-2 px-3 pb-3">
        <p>{cohortLabels[evidence.cohort]} · 근거 기준 시각 {timestamp(evidence.cutoffAt)} KST</p>
        <p className="text-slate-400">D1·D3·D5 결과가 모두 확인된 동일 표본으로 기간을 비교합니다.</p>
        {evidence.historicalSampleCount !== undefined && <p>새 기준 실험 {evidence.baselineSampleCount ?? 0}건 · 과거 종가 재현 {evidence.historicalSampleCount}건</p>}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[440px] text-left">
            <caption className="sr-only">진입 판단에 사용한 기간별 성과</caption>
            <thead className="text-slate-400"><tr>{['기간', '표본', '평균 순수익률', '일당 순수익률', '승률'].map(label => <th key={label} className="py-2 pr-3">{label}</th>)}</tr></thead>
            <tbody className="divide-y divide-slate-800">
              {evidence.horizons.map(item => (
                <tr key={item.horizon} className={item.horizon === evidence.selectedHorizon ? 'text-emerald-200' : ''}>
                  <th className="py-2 pr-3 font-medium">D{item.horizon}{item.horizon === evidence.selectedHorizon ? ' · 선택' : ''}</th>
                  <td className="py-2 pr-3 tabular-nums">{item.count}건</td>
                  <td className="py-2 pr-3 tabular-nums">{percent(item.meanNetReturnPct)}</td>
                  <td className="py-2 pr-3 tabular-nums">{percent(item.meanDailyNetReturnPct)}</td>
                  <td className="py-2 pr-3 tabular-nums">{item.winRatePct === null ? '집계 대기' : `${item.winRatePct.toFixed(1)}%`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </details>
  );
}

function DecisionCard({ decision, policy }: { decision: PaperStrategyDecision; policy: PaperStrategyPolicy }) {
  return (
    <article className="space-y-3 rounded-xl border border-slate-700/60 bg-slate-900/40 p-4" aria-label={`${decision.name} ${actionLabels[decision.action]} 판단`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-slate-100">{decision.name} <span className="font-normal text-slate-500">{decision.symbol}</span></p>
        <ActionBadge action={decision.action} />
      </div>
      <p className="text-sm text-slate-200">{decision.reason}</p>
      <p className="text-xs text-slate-400">{decision.explorationEvidence ? '탐색 가상매수 · 검증 전' : decision.adaptiveEvidence ? '개별 지표 성과로 선택' : decision.cohort ? cohortLabels[decision.cohort] : '관측 정보 확인 대기'} · 판단 {timestamp(decision.decisionAt)} KST</p>
      {decision.adaptiveEvidence && <PaperAdaptiveEvidenceDetails evidence={decision.adaptiveEvidence} />}
      {decision.explorationEvidence && <PaperAdaptiveEvidenceDetails evidence={decision.explorationEvidence} />}
      {decision.evidence && <Evidence evidence={decision.evidence} policy={policy} />}
      {decision.newsSummary && <PaperNewsDetails summary={decision.newsSummary} />}
      {decision.investorFlow && <PaperInvestorFlowDetails flow={decision.investorFlow} />}
    </article>
  );
}

function TradeCard({ trade }: { trade: PaperStrategyTrade }) {
  const measurement = trade.measurement;
  return (
    <article className="space-y-3 rounded-xl border border-slate-700/60 bg-slate-900/40 p-4" aria-label={`${trade.name} 전략 거래`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-slate-100">{trade.name} <span className="font-normal text-slate-500">{trade.symbol}</span></p>
        <ActionBadge action={trade.status === 'CLOSED' ? 'EXIT' : 'HOLD'} />
      </div>
      <div className="grid gap-x-6 gap-y-2 text-xs text-slate-300 sm:grid-cols-2">
        <p>진입 {timestamp(trade.entryAt)} KST · {trade.entryPrice.toLocaleString('ko-KR')}원 · {trade.quantity}주</p>
        <p>확정 보유 기간 D{trade.horizon} · 예정 청산일 {trade.scheduledExitDate}</p>
        <p className="sm:col-span-2">예정 종가 시각 {timestamp(trade.scheduledExitAt)} KST</p>
      </div>
      <p className="text-xs text-slate-400">진입 근거: {trade.entryDecision.reason}</p>
      {trade.morningRecommendation && <p className="text-xs text-sky-200">08:30 추천 {trade.morningRecommendation.rank}순위 · {trade.morningRecommendation.purpose === 'VALIDATED' ? '검증 규칙 추천' : '탐색 추천 · 검증 전'} · {trade.morningRecommendation.matchesEntryRule ? '같은 규칙으로 가상 진입' : '다른 규칙으로 가상 진입'} · 추천 발송 {timestamp(trade.morningRecommendation.sentAt)} KST</p>}
      {measurement ? <div className="space-y-2 rounded-lg border border-slate-700/60 bg-slate-950/30 p-3 text-xs text-slate-300" role="group" aria-label="가상매수 이후 가격 관측">
        <p className="font-medium">가상매수 이후 가격 관측 · {measurement.pointCount.toLocaleString('ko-KR')}개 표본</p>
        <p>{measurement.fromEntry ? '진입부터 추적' : '진입 후 중간 추적 · 이전 구간 미기록'} · 추적 시작 {timestamp(measurement.startedAt)} KST</p>
        {([['최근 관측', measurement.latest], ['관측 최고 순수익', measurement.highest], ['관측 최저 순수익', measurement.lowest]] as const).map(([label, point]) =>
          <div key={label} className="space-y-1"><p>{label} {percent(point.netReturnPct)} · {point.price.toLocaleString('ko-KR')}원</p>
            <p className="text-slate-400">가격 기준 {timestamp(point.effectiveAt)} KST · 관측 {timestamp(point.observedAt)} KST · 기록 {timestamp(point.recordedAt)} KST</p></div>)}
        <p className="text-slate-400">진입 당시 비용을 반영한 가상 청산 순수익입니다. 수집된 가격의 범위이며 실제 장중 최고·최저나 최적 매도점은 아닙니다.</p>
      </div> : <p className="text-xs text-slate-400">{trade.exit ? '보유 중 가격 측정 미기록' : '가격 측정 대기 · 휴장·장외에는 새 측정 없이 유효한 관측 또는 예정 종가 확인을 기다립니다.'}</p>}
      <PaperNewsDetails summary={summarizePaperNews(trade.entryObservation.news, trade.entryAt, trade.policy.newsLookbackHours)} />
      <PaperInvestorFlowDetails flow={trade.entryObservation.investorFlow} />
      {trade.exit ? (
        <div className="space-y-2 rounded-lg border border-violet-400/20 bg-violet-500/5 p-3 text-xs text-slate-300">
          <p className="font-semibold text-violet-200">예약 종가 가상 청산 · 순수익률 {percent(trade.exit.netReturnPct)} · 순손익 {money(trade.exit.netPnl)}</p>
          <p>청산 근거: {trade.exit.decision.reason}</p>
          <p>평가 종가 시각 {timestamp(trade.exit.effectiveAt)} KST · 종가 {trade.exit.price.toLocaleString('ko-KR')}원</p>
          <p>종가 확인 시각 {timestamp(trade.exit.observedAt)} KST</p>
          <p>{measurement ? `관측 최고 순수익 − 청산 순수익 ${(measurement.highest.netReturnPct - trade.exit.netReturnPct).toFixed(2)}%p${measurement.fromEntry ? '' : ' · 중간 추적 구간 기준'}` : '관측 최고 대비 청산 차이 미집계 · 보유 중 측정 미기록'}</p>
        </div>
      ) : <p className="text-xs text-sky-200">진입 시 정한 날짜의 종가 확인까지 보유합니다. 청산 순손익은 집계 대기입니다.</p>}
      {trade.entryDecision.evidence && <Evidence evidence={trade.entryDecision.evidence} policy={trade.policy} />}
      {trade.entryDecision.adaptiveEvidence && <PaperAdaptiveEvidenceDetails evidence={trade.entryDecision.adaptiveEvidence} />}
      {trade.entryDecision.explorationEvidence && <PaperAdaptiveEvidenceDetails evidence={trade.entryDecision.explorationEvidence} />}
    </article>
  );
}

export function PaperStrategyPanel({ view }: { view: PaperStrategyView }) {
  const [search, setSearch] = useState('');
  const [action, setAction] = useState('ALL');
  const [tradeStatus, setTradeStatus] = useState('ALL');
  const [decisionPage, setDecisionPage] = useState(0);
  const [tradePage, setTradePage] = useState(0);
  const unavailable = Boolean(view.error || view.lastRun?.error);
  const history = view.measurementHistory;
  const measurementWarning = history && (history.error || history.failedBatchCount === null || history.unrecordedPointCount === null
    || history.failedBatchCount > 0 || history.unrecordedPointCount > 0);
  const adaptive = view.strategyVersion === 'adaptive-features-v1';
  const adaptivePerformance = view.performanceByVersion?.['adaptive-features-v1'];
  const matchingDecisions = useMemo(() => [...view.latestDecisions].filter(item => (action === 'ALL' || item.action === action) && `${item.name} ${item.symbol}`.toLowerCase().includes(search.trim().toLowerCase())).sort((a, b) => b.decisionAt.localeCompare(a.decisionAt)), [view.latestDecisions, action, search]);
  const matchingTrades = useMemo(() => [...view.trades].filter(item => (tradeStatus === 'ALL' || item.status === tradeStatus) && `${item.name} ${item.symbol}`.toLowerCase().includes(search.trim().toLowerCase())).sort((a, b) => b.entryAt.localeCompare(a.entryAt)), [view.trades, tradeStatus, search]);
  const currentDecisionPage = Math.min(decisionPage, Math.max(0, Math.ceil(matchingDecisions.length / 12) - 1));
  const currentTradePage = Math.min(tradePage, Math.max(0, Math.ceil(matchingTrades.length / 10) - 1));
  const decisions = matchingDecisions.slice(currentDecisionPage * 12, (currentDecisionPage + 1) * 12);
  const trades = matchingTrades.slice(currentTradePage * 10, (currentTradePage + 1) * 10);
  return (
    <Section title={adaptive ? '지표 자율 판단 전략' : '뉴스·추세 매매 전략'} subtitle="관측 성과로 진입과 보유 기간을 선택하는 독립 Shadow 전략" variant="neo">
      {unavailable ? (
        <p role="alert" className="rounded-lg border border-amber-500/20 bg-amber-500/10 p-4 text-sm text-amber-200">전략 기록 확인 불가 · 판단과 성과를 불러오지 못했습니다. 기본 관측은 별도로 확인할 수 있습니다.</p>
      ) : (
        <>
          {measurementWarning && history && <p role="status" className="rounded-lg border border-amber-500/20 bg-amber-500/10 p-3 text-xs text-amber-200">
            상세 가격 기록 확인 필요 · 누적 저장 실패 {history.failedBatchCount === null ? '집계 확인 불가' : `${history.failedBatchCount}회`}
            {' · '}상세 저장 미확인 {history.unrecordedPointCount === null ? '집계 확인 불가' : `${history.unrecordedPointCount}개`}
            {' · '}마지막 상세 저장 {history.lastRecordedAt ? `${timestamp(history.lastRecordedAt)} KST` : history.failedBatchCount === null || history.unrecordedPointCount === null ? '확인 불가' : '기록 없음'}{history.error ? ` · ${history.error}` : ''}</p>}
          <div className="space-y-2 text-xs leading-relaxed text-slate-400">
            {adaptive ? <p>완료된 기본 관측으로 지표별 구간과 보유기간을 학습하고, 이후 기간의 성과로 매수 연결을 매일 갱신합니다. 성과가 부족해지면 연결을 해제하며 기존 보유 거래는 진입 당시 정한 기간을 유지합니다.</p>
              : <p>최근 {view.policy.newsLookbackHours}시간에 관측한 뉴스와 20일선 위치가 같은 그룹에서, 완료 표본 최소 {view.policy.minimumSamples}건·진입일 최소 {view.policy.minimumEntryDates}일을 요구합니다. 양수인 일당 평균 순수익률이 가장 높은 기간을 선택합니다.</p>}
            <p>진입 시 청산 날짜를 확정하며 해당 날짜의 종가로 가상 청산합니다. 브로커 체결 기록이 아닙니다.</p>
            <p>호재·악재 분류는 근거로 표시하고 별도 성과를 관측합니다. 현재 전략의 진입 조건에는 아직 반영하지 않습니다.</p>
            <p>전략 {view.strategyVersion} · 마지막 판단 {view.lastRun ? `${timestamp(view.lastRun.asOf)} KST` : '아직 실행하지 않음'}</p>
          </div>
          {adaptive && (view.adaptive ? <PaperAdaptivePanel state={view.adaptive} /> : <p className="text-sm text-amber-200">지표 자동 연결 평가 대기 · 다음 관측에서 평가합니다.</p>)}
          {adaptive && <section className="rounded-xl border border-emerald-400/20 bg-emerald-500/5 p-4" aria-label="자율 판단 전략의 가상 청산 성과">
            <h4 className="mb-3 text-sm font-semibold text-emerald-200">자율 전략 전체 · 검증 매수와 탐색 매수</h4>
            <dl className="grid grid-cols-2 gap-3 xl:grid-cols-4">{[
              ['자율 전략 청산', adaptivePerformance ? `${adaptivePerformance.closedCount}건` : '집계 대기'],
              ['자율 전략 평균 순수익률', percent(adaptivePerformance?.meanNetReturnPct ?? null)],
              ['자율 전략 승률', adaptivePerformance?.winRatePct == null ? '집계 대기' : `${adaptivePerformance.winRatePct.toFixed(1)}%`],
              ['자율 전략 순손익 합계', money(adaptivePerformance?.totalNetPnl ?? null)],
            ].map(([label, value]) => <div key={label}><dt className="text-xs text-slate-400">{label}</dt><dd className="mt-2 text-lg font-semibold tabular-nums text-emerald-200">{value}</dd></div>)}</dl>
            <div className="mt-4 grid gap-2 text-xs text-slate-300" aria-label="매수 목적별 성과">{(['VALIDATED', 'EXPLORATION'] as const).map(purpose => {
              const result = view.performanceByPurpose?.[purpose];
              return <p key={purpose}>{purpose === 'VALIDATED' ? '검증 매수' : '탐색 매수 · 검증 전'}: {result
                ? `보유 ${result.openCount}건 · 청산 ${result.closedCount}건 · 평균 ${percent(result.meanNetReturnPct)}` : '집계 확인 대기'}</p>;
            })}</div>
            <p className="mt-3 text-xs text-slate-400">위 전체 성과에는 검증 전 탐색 매수가 포함됩니다. 지표를 고르는 학습·후반 확인 표본과 별도입니다.</p>
          </section>}
          <div>
            <h4 className="mb-3 text-sm font-semibold text-slate-200">{adaptive ? '전체 전략 이력 성과' : '전략 청산 성과'}</h4>
            <dl className="grid grid-cols-2 gap-3 xl:grid-cols-5">
              {[
                ['전략 보유', `${view.openCount}건`],
                ['전략 청산', `${view.performance.closedCount}건`],
                ['청산 평균 순수익률', percent(view.performance.meanNetReturnPct)],
                ['청산 승률', view.performance.winRatePct === null ? '집계 대기' : `${view.performance.winRatePct.toFixed(1)}%`],
                ['청산 순손익 합계', money(view.performance.totalNetPnl)],
              ].map(([label, value]) => (
                <div key={label} className="rounded-xl border border-slate-700/60 bg-slate-900/50 p-3">
                  <dt className="text-xs text-slate-400">{label}</dt><dd className="mt-2 text-xl font-semibold tabular-nums text-sky-200">{value}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-3 text-xs text-slate-400">이 전략이 선택하고 가상 청산한 거래만 비용을 반영해 집계합니다. 기본 관측 실험의 D1·D3·D5 평균 및 계좌 포트폴리오 성과와 별도입니다.</p>
            {adaptive && <p className="mt-2 text-xs text-slate-400">전체 이력에는 기존 뉴스·추세 전략의 거래도 포함됩니다. 각 거래의 진입 당시 전략과 근거는 그대로 보존됩니다.</p>}
          </div>
          {view.selection && view.selection.candidateCount > 0 && <SelectionSummary selection={view.selection} />}
          <div className="space-y-3">
            <h4 className="text-sm font-semibold text-slate-200">최근 전략 판단 <span className="font-normal text-slate-500">{matchingDecisions.length}건 · 페이지당 12건</span></h4>
            <div className="workspace-filters"><input data-search-focus aria-label="전략 종목 검색" placeholder="종목명 또는 코드 검색" value={search} onChange={event => { setSearch(event.target.value); setDecisionPage(0); setTradePage(0); }} /><select aria-label="전략 판단 종류" value={action} onChange={event => { setAction(event.target.value); setDecisionPage(0); }}><option value="ALL">전체 판단</option><option value="BUY">매수</option><option value="WAIT">대기</option><option value="HOLD">보유</option><option value="EXIT">청산</option></select></div>
            {decisions.length === 0 ? <p className="workspace-empty">{view.latestDecisions.length ? '검색 조건에 맞는 전략 판단이 없습니다.' : '아직 전략 판단이 없습니다. 스캔 후 매수·대기·보유·청산 근거가 표시됩니다.'}</p> : (
              <div className="grid gap-3 lg:grid-cols-2">{decisions.map((decision, index) => <DecisionCard key={`${decision.snapshotId}-${decision.symbol}-${decision.tradeId ?? index}`} decision={decision} policy={view.policy} />)}</div>
            )}
            {matchingDecisions.length > 12 && <div className="workspace-pagination"><span>{currentDecisionPage + 1} / {Math.ceil(matchingDecisions.length / 12)}</span><button type="button" className="workspace-button" disabled={!currentDecisionPage} onClick={() => setDecisionPage(currentDecisionPage - 1)}>이전 판단</button><button type="button" className="workspace-button" disabled={(currentDecisionPage + 1) * 12 >= matchingDecisions.length} onClick={() => setDecisionPage(currentDecisionPage + 1)}>다음 판단</button></div>}
          </div>
          <div className="space-y-3">
            <h4 className="text-sm font-semibold text-slate-200">전략 진입·청산 기록 <span className="font-normal text-slate-500">누적 {view.totalCount}건 · 페이지당 10건</span></h4>
            <div className="workspace-filters"><select aria-label="전략 거래 상태" value={tradeStatus} onChange={event => { setTradeStatus(event.target.value); setTradePage(0); }}><option value="ALL">전체 거래</option><option value="OPEN">가상 보유</option><option value="CLOSED">가상 청산</option></select></div>
            {trades.length === 0 ? <p className="workspace-empty">{view.trades.length ? '검색 조건에 맞는 전략 거래가 없습니다.' : '아직 전략 진입이 없습니다. 판단 근거와 표본 충족 상태는 최근 전략 판단에서 확인하세요.'}</p> : trades.map(trade => <TradeCard key={trade.id} trade={trade} />)}
            {matchingTrades.length > 10 && <div className="workspace-pagination"><span>{currentTradePage + 1} / {Math.ceil(matchingTrades.length / 10)}</span><button type="button" className="workspace-button" disabled={!currentTradePage} onClick={() => setTradePage(currentTradePage - 1)}>이전 거래</button><button type="button" className="workspace-button" disabled={(currentTradePage + 1) * 10 >= matchingTrades.length} onClick={() => setTradePage(currentTradePage + 1)}>다음 거래</button></div>}
          </div>
        </>
      )}
    </Section>
  );
}
