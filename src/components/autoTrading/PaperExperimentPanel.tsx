// @responsibility Display independent Shadow experiment results.
import React, { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FlaskConical, Play, RefreshCw } from 'lucide-react';
import { paperExperimentApi, PAPER_EXPERIMENT_QUERY_KEY } from '../../api/paperExperimentClient';
import type { PaperExperiment, PaperExperimentView, PaperLearningGroup } from '../../types/paperExperiment';
import { PAPER_OBSERVATION_ISSUE_LABELS } from '../../types/paperExperiment';
import { Stack } from '../../layout/Stack';
import { PageHeader, LoadingState } from '../../ui';
import { Section } from '../../ui/section';
import { PaperStrategyPanel } from './PaperStrategyPanel';
import { PaperResearchPanel } from './PaperResearchPanel';
import { PaperNewsDetails } from './PaperNewsDetails';
import { PAPER_NEWS_LABELS, summarizePaperNews } from '../../utils/paperNews';
import { PaperInvestorFlowPanel, PaperInvestorFlowDetails } from './PaperInvestorFlowPanel';
import { PaperNewsFactsPanel } from './PaperNewsFactsPanel';
import { PaperFeaturePanel, PaperFeatureDetails } from './PaperFeaturePanel';

const buttonClass = 'inline-flex items-center justify-center gap-2 rounded-lg border border-sky-400/30 bg-sky-500/10 px-3 py-2 text-sm font-semibold text-sky-200 transition hover:bg-sky-500/20 disabled:cursor-wait disabled:opacity-50';
const groupLabels: Record<string, string> = {
  NEWS_PRESENT: '관측 뉴스 있음',
  NEWS_ABSENT: '관측 뉴스 없음',
  ABOVE_MA20: '20일선 위',
  BELOW_MA20: '20일선 이하',
  TREND_UNKNOWN: '추세 미확인',
};

function percent(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value)
    ? `${value > 0 ? '+' : ''}${value.toFixed(2)}%`
    : '집계 대기';
}

function timestamp(value: string | null | undefined): string {
  if (!value) return '아직 실행하지 않음';
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? date.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', hour12: false })
    : '시각 확인 불가';
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-700/60 bg-slate-900/50 p-4">
      <dt className="text-xs text-slate-400">{label}</dt>
      <dd className="mt-2 text-2xl font-semibold tabular-nums text-slate-100">{value}</dd>
    </div>
  );
}

function GroupTable({ groups }: { groups: PaperLearningGroup[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="text-xs text-slate-400">
          <tr><th className="p-3">관측 그룹</th><th className="p-3">결과 표본</th><th className="p-3">평균 순수익률</th><th className="p-3">승률</th></tr>
        </thead>
        <tbody className="divide-y divide-slate-800 text-slate-200">
          {groups.map(group => (
            <tr key={group.label}>
              <th className="p-3 font-medium">{groupLabels[group.label] ?? group.label}</th>
              <td className="p-3 tabular-nums">{group.count}건</td>
              <td className="p-3 tabular-nums">{percent(group.meanNetReturnPct)}</td>
              <td className="p-3 tabular-nums">{group.winRatePct === null ? '집계 대기' : `${group.winRatePct.toFixed(1)}%`}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {groups.length === 0 && <p className="p-3 text-sm text-slate-400">그룹별 결과가 아직 없습니다.</p>}
    </div>
  );
}

function trendLabel(experiment: PaperExperiment): string {
  const above = experiment.entryObservation.aboveMa20;
  return above === null ? '추세 미확인' : above ? '20일선 위' : '20일선 이하';
}

export function PaperExperimentResults({ view, showStrategy = true }: { view: PaperExperimentView; showStrategy?: boolean }) {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('ALL');
  const [page, setPage] = useState(0);
  const last = view.lastRun;
  const filtered = useMemo(() => [...view.experiments].filter(item => (status === 'ALL' || item.status === status) && `${item.name} ${item.symbol}`.toLowerCase().includes(search.trim().toLowerCase())).sort((a, b) => b.entryAt.localeCompare(a.entryAt)), [view.experiments, status, search]);
  const currentPage = Math.min(page, Math.max(0, Math.ceil(filtered.length / 20) - 1));
  const recent = filtered.slice(currentPage * 20, (currentPage + 1) * 20);
  return (
    <>
      {showStrategy && view.strategy && <PaperStrategyPanel view={view.strategy} />}
      <Section title="최근 관측" variant="neo">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-slate-300">
          <span>마지막 스캔: {timestamp(last?.asOf)}</span>
          {last && <span>{last.marketOpen ? '장중 관측' : '장외 관측 · 신규 진입 대기'}</span>}
        </div>
        <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="최근 후보" value={last ? `${last.candidateCount}종목` : '미실행'} />
          <Stat label="누적 실험" value={`${view.totalCount}건`} />
          <Stat label="관찰 중" value={`${view.openCount}건`} />
          <Stat label="D5 완료" value={`${view.completedCount}건`} />
        </dl>
        {last && (
          <p className="text-sm text-slate-400">
            관측 {last.observedCount}건 · 신규 실험 {last.openedCount}건 · 이번 완료 {last.completedCount}건 · 가격 미확인 {last.missingPriceCount}건
          </p>
        )}
        {last && last.issues.length > 0 && (
          <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 p-3 text-sm text-amber-200">
            <p className="font-semibold">이번 관측에서 확인할 항목</p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              {last.issues.slice(0, 5).map((issue, index) => <li key={`${index}-${issue}`}>{issue.split(':').map(part => PAPER_OBSERVATION_ISSUE_LABELS[part] ?? part).join(': ')}</li>)}
            </ul>
            {last.issues.length > 5 && <p className="mt-2">외 {last.issues.length - 5}건</p>}
          </div>
        )}
      </Section>

      <Section title="기본 관측 실험 · 거래일별 학습 결과" subtitle="조건 없이 수집한 관측 실험의 진입 이후 D1·D3·D5 종가 기준. 비용을 반영한 독립 실험의 평균입니다." variant="neo">
        <dl className="grid gap-3 sm:grid-cols-3">
          {([1, 3, 5] as const).map(horizon => {
            const result = view.outcomes.find(item => item.horizon === horizon);
            return (
              <div key={horizon} className="rounded-xl border border-slate-700/60 bg-slate-900/50 p-4">
                <dt className="text-sm text-slate-400">D{horizon} 평균 순수익률</dt>
                <dd className="mt-2 text-2xl font-semibold tabular-nums text-sky-200">{percent(result?.meanNetReturnPct)}</dd>
                <p className="mt-2 text-xs text-slate-400">결과 표본 {result?.count ?? 0}건</p>
              </div>
            );
          })}
        </dl>
        <p className="text-xs text-slate-400">각 종목을 1주씩 관찰한 독립 실험의 평균 순수익률이며, 계좌 수익률을 뜻하지 않습니다. 아직 도래하지 않은 결과는 집계 대기로 표시합니다.</p>
      </Section>

      <Section title="뉴스·추세별 비교" subtitle="D5 결과 기준 · 진입 당시 관측 정보로 그룹을 나눕니다. 뉴스·추세 그룹에는 같은 실험이 각각 포함될 수 있습니다." variant="neo">
        <GroupTable groups={view.groups} />
      </Section>

      <Section title="호재·악재별 후속 성과" subtitle="진입 전 최근 72시간 뉴스 · 당시 저장한 분류로 D1·D3·D5 결과를 비교합니다." variant="neo">
        <p className="text-xs text-slate-400">기존 관측을 소급 분류하지 않습니다. 분류 기록이 없거나 일부 뉴스의 방향이 불명확하면 판단 불가로 남깁니다. 표본·기간이 다른 단순 평균으로, 뉴스 효과가 입증됐다는 뜻은 아닙니다. 현재 진입 조건에는 미반영입니다.</p>
        {view.newsStudy ? <div className="overflow-x-auto"><table className="w-full min-w-[620px] text-left text-sm">
          <caption className="sr-only">뉴스 방향별 관측 수와 비용 차감 후 평균 수익률</caption>
          <thead className="text-xs text-slate-400"><tr>{['뉴스 방향', '관측 / 진입일', 'D1 평균 / 표본', 'D3 평균 / 표본', 'D5 평균 / 표본'].map(label => <th key={label} className="p-3">{label}</th>)}</tr></thead>
          <tbody className="divide-y divide-slate-800 text-slate-200">{view.newsStudy.groups.map(group => <tr key={group.direction}>
            <th className="p-3 font-medium">{PAPER_NEWS_LABELS[group.direction]}</th><td className="p-3 tabular-nums">{group.observationCount}건 / {group.entryDateCount}일</td>
            {group.outcomes.map(outcome => <td key={outcome.horizon} className="p-3 tabular-nums">{percent(outcome.meanNetReturnPct)}<div className="mt-1 text-xs text-slate-400">{outcome.count}건 · 승률 {percent(outcome.winRatePct)}</div></td>)}
          </tr>)}</tbody>
        </table></div> : <p className="workspace-empty">다음 관측 갱신부터 뉴스 방향별 결과를 확인할 수 있습니다.</p>}
      </Section>

      <PaperInvestorFlowPanel study={view.investorFlowStudy} snapshot={view.lastRun?.investorFlow} />
      <PaperNewsFactsPanel status={view.lastRun?.disclosures} study={view.newsFactsStudy} />
      <PaperFeaturePanel coverage={view.lastRun?.featureCoverage} study={view.featureStudy} />

      <Section title="관측 기록" subtitle="각 실험 1주 · D5 결과가 확인되면 완료 · 페이지당 20건" variant="neo">
        <div className="workspace-filters"><input data-search-focus aria-label="관측 종목 검색" placeholder="종목명 또는 코드 검색" value={search} onChange={event => { setSearch(event.target.value); setPage(0); }} />
          <select aria-label="관측 상태" value={status} onChange={event => { setStatus(event.target.value); setPage(0); }}><option value="ALL">전체 상태</option><option value="OPEN">관찰 중</option><option value="COMPLETED">D5 완료</option></select></div>
        {recent.length === 0 ? (
          <p className="workspace-empty">{view.experiments.length ? '검색 조건에 맞는 관측 기록이 없습니다.' : '아직 생성된 실험이 없습니다. 장중 첫 진입 이후 관측 결과가 쌓입니다.'}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="text-xs text-slate-400">
                <tr>{['종목', '진입일', '가상 진입가', '진입 당시 관측', '상태', 'D1', 'D3', 'D5'].map(label => <th key={label} className="p-3">{label}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-slate-800 text-slate-200">
                {recent.map(experiment => (
                  <tr key={experiment.id}>
                    <th className="p-3 font-medium"><div>{experiment.name}</div><div className="mt-1 text-xs font-normal text-slate-500">{experiment.symbol}</div></th>
                    <td className="p-3 whitespace-nowrap">{experiment.tradingDate}</td>
                    <td className="p-3 tabular-nums">{experiment.entryPrice.toLocaleString('ko-KR')}원</td>
                    <td className="p-3"><PaperNewsDetails summary={summarizePaperNews(experiment.entryObservation.news, experiment.entryAt)} /><PaperInvestorFlowDetails flow={experiment.entryObservation.investorFlow} /><PaperFeatureDetails features={experiment.entryObservation.features} /><div className="mt-1 text-xs text-slate-400">{trendLabel(experiment)}</div></td>
                    <td className="p-3 whitespace-nowrap">{experiment.status === 'COMPLETED' ? '완료' : '관찰 중'}</td>
                    {([1, 3, 5] as const).map(horizon => <td key={horizon} className="p-3 whitespace-nowrap tabular-nums">{percent(experiment.outcomes.find(outcome => outcome.horizon === horizon)?.netReturnPct)}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {filtered.length > 0 && <div className="workspace-pagination"><span>{filtered.length}건 · {currentPage + 1} / {Math.ceil(filtered.length / 20)}</span><button type="button" className="workspace-button" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>이전</button><button type="button" className="workspace-button" disabled={(currentPage + 1) * 20 >= filtered.length} onClick={() => setPage(currentPage + 1)}>다음</button></div>}
      </Section>
    </>
  );
}

export function PaperExperimentPanel() {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: PAPER_EXPERIMENT_QUERY_KEY,
    queryFn: paperExperimentApi.getView,
    staleTime: 10_000,
    refetchInterval: 30_000,
    retry: 1,
  });
  const scan = useMutation({
    mutationFn: paperExperimentApi.scan,
    retry: false,
    onSuccess: async () => { await client.invalidateQueries({ queryKey: PAPER_EXPERIMENT_QUERY_KEY }); },
  });

  return (
    <Stack gap="xl">
      <PageHeader
        title="Shadow 실험실"
        subtitle="종목당 1주 관측 실험과 뉴스·추세 성과로 선택한 가상 매매 전략을 함께 확인합니다."
        accentColor="bg-gradient-to-b from-sky-400 to-indigo-500"
        actions={
          <div className="flex flex-wrap gap-2">
            <button type="button" className={buttonClass} disabled={query.isFetching} onClick={() => { void query.refetch(); }}><RefreshCw className={`h-4 w-4 ${query.isFetching ? 'animate-spin' : ''}`} />새로고침</button>
            <button type="button" className={buttonClass} disabled={scan.isPending} onClick={() => scan.mutate()}><Play className="h-4 w-4" />{scan.isPending ? '관측 중...' : '지금 스캔'}</button>
          </div>
        }
      />
      <div className="flex items-start gap-3 rounded-xl border border-sky-500/20 bg-sky-500/10 p-4 text-sm text-sky-100">
        <FlaskConical className="mt-0.5 h-5 w-5 shrink-0" />
        <p>독립 가상 실험을 기록합니다. 실제 주문과 기존 포트폴리오 기록은 이 화면의 성과에 포함되지 않습니다.</p>
      </div>
      {scan.isError && <p role="alert" className="rounded-lg bg-red-500/10 p-4 text-sm text-red-200">스캔에 실패했습니다. {scan.error instanceof Error ? scan.error.message : '잠시 후 다시 시도해 주세요.'}</p>}
      {query.isError && <p role="alert" className="rounded-lg bg-amber-500/10 p-4 text-sm text-amber-200">실험 기록을 불러오지 못했습니다. {query.data ? '마지막으로 불러온 기록을 표시합니다.' : '새로고침으로 다시 시도해 주세요.'}</p>}
      {query.isPending && <LoadingState message="독립 Shadow 실험 기록을 불러오는 중입니다..." />}
      <PaperResearchPanel view={query.data?.research} />
      {query.data && <PaperExperimentResults view={query.data} />}
    </Stack>
  );
}
