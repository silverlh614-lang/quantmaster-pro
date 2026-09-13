// @responsibility Coordinate workspace page data.
import React, { lazy, Suspense } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCw, ScanLine } from 'lucide-react';
import { apiFetch } from '../api/client';
import type { EngineStatus, EngineGuardsState } from '../api/autoTradeClient';
import { paperExperimentApi, PAPER_EXPERIMENT_QUERY_KEY } from '../api/paperExperimentClient';
import type { View } from '../stores/useSettingsStore';
import { VIEW_LABELS } from '../config/viewRegistry';
import { PaperOverview } from '../components/autoTrading/PaperOverview';

const Observations = lazy(() => import('../components/autoTrading/PaperExperimentPanel').then(module => ({ default: module.PaperExperimentResults })));
const Strategy = lazy(() => import('../components/autoTrading/PaperStrategyPanel').then(module => ({ default: module.PaperStrategyPanel })));
const Research = lazy(() => import('../components/autoTrading/PaperResearchPanel').then(module => ({ default: module.PaperResearchPanel })));
const Operations = lazy(() => import('../components/autoTrading/PaperOperations').then(module => ({ default: module.PaperOperations })));

const descriptions: Partial<Record<View, string>> = {
  DASHBOARD: '관측은 얼마나 쌓였고, 전략은 왜 기다리는지 한눈에 확인합니다.',
  PAPER_OBSERVATIONS: '조건 없이 기록한 1주 실험으로 D1·D3·D5 성과를 비교합니다.',
  PAPER_STRATEGY: '뉴스와 추세가 같은 과거 표본을 근거로 가상 매매를 판단합니다.',
  PAPER_RESEARCH: '쌓아 둔 자료로 조건 하나씩 검증하고, 다음 연구의 근거를 찾습니다.',
  OPERATIONS: '서버 운영 상태와 자료의 연결 경로를 확인합니다.',
};
const polling = { staleTime: 25_000, refetchInterval: 30_000, refetchIntervalInBackground: false, refetchOnWindowFocus: true, retry: 1 } as const;
const pending = <div className="workspace-empty" role="status">화면을 불러오는 중입니다…</div>;

export function PaperDashboardPage({ page }: { page: View }) {
  const client = useQueryClient();
  const engine = useQuery({ queryKey: ['auto-trade', 'engine-status'], queryFn: () => apiFetch<EngineStatus>('/api/auto-trade/engine/status'), ...polling });
  const guards = useQuery({ queryKey: ['auto-trade', 'engine-guards'], queryFn: () => apiFetch<EngineGuardsState>('/api/auto-trade/engine/guards'), ...polling });
  const overview = useQuery({ queryKey: [...PAPER_EXPERIMENT_QUERY_KEY, 'overview'], queryFn: paperExperimentApi.getOverview, ...polling, enabled: page === 'DASHBOARD' || page === 'OPERATIONS' });
  const observations = useQuery({ queryKey: [...PAPER_EXPERIMENT_QUERY_KEY, 'observations'], queryFn: paperExperimentApi.getObservations, ...polling, enabled: page === 'PAPER_OBSERVATIONS' });
  const strategy = useQuery({ queryKey: [...PAPER_EXPERIMENT_QUERY_KEY, 'strategy'], queryFn: paperExperimentApi.getStrategy, ...polling, enabled: page === 'PAPER_STRATEGY' });
  const research = useQuery({ queryKey: [...PAPER_EXPERIMENT_QUERY_KEY, 'research'], queryFn: paperExperimentApi.getResearch, ...polling, staleTime: 60_000, refetchInterval: 60_000, enabled: page === 'PAPER_RESEARCH' });
  const active = page === 'PAPER_OBSERVATIONS' ? observations : page === 'PAPER_STRATEGY' ? strategy : page === 'PAPER_RESEARCH' ? research : overview;
  const mode = engine.isError ? undefined : engine.data?.mode;
  const paused = guards.isError ? undefined : guards.data?.autoTradingPaused;
  const scan = useMutation({ mutationFn: paperExperimentApi.scan, retry: false,
    onSuccess: async () => { await client.invalidateQueries({ queryKey: PAPER_EXPERIMENT_QUERY_KEY }); },
  });
  const refresh = () => { void active.refetch(); void engine.refetch(); void guards.refetch(); };
  return <div className="workspace-page">
    <div className="workspace-topline"><span>워크스페이스 <span aria-hidden="true">/</span> {VIEW_LABELS[page]}</span>
      <span className={`workspace-mode ${mode === 'SHADOW' ? '' : 'workspace-mode-unknown'}`}><i />{mode ? `서버 ${mode}` : '서버 모드 확인 중'}</span>
    </div>
    <header className="workspace-page-header"><div><h1>{VIEW_LABELS[page]}</h1><p>{descriptions[page]}</p></div>
      <div className="workspace-actions">
        <button type="button" className="workspace-button" disabled={active.isFetching || engine.isFetching || guards.isFetching} onClick={refresh}><RefreshCw size={15} />새로고침</button>
        {(page === 'DASHBOARD' || page === 'PAPER_OBSERVATIONS') && <button type="button" className="workspace-button workspace-button-primary"
          disabled={scan.isPending || mode !== 'SHADOW'} onClick={() => scan.mutate()}><ScanLine size={16} />{scan.isPending ? '관측 중…' : '지금 스캔'}</button>}
      </div>
    </header>
    {(engine.isError || guards.isError) && <p role="alert" className="workspace-alert">서버 운영 상태를 확인하지 못했습니다. 표시된 기록만으로 자동 관측 실행 여부를 판단할 수 없습니다.</p>}
    {mode && mode !== 'SHADOW' && <p role="alert" className="workspace-alert">현재 서버는 {mode} 모드입니다. 이 화면은 저장된 Shadow 기록을 보여줍니다. 실행 관리는 운영 설정에서 확인하세요.</p>}
    {scan.isError && <p role="alert" className="workspace-alert">스캔 실패 · {scan.error.message}</p>}
    {active.isError && <p role="alert" className="workspace-alert">기록을 불러오지 못했습니다. {active.data ? '마지막으로 불러온 자료를 표시합니다.' : '새로고침으로 다시 시도해 주세요.'}</p>}
    {active.isPending && pending}
    <Suspense fallback={pending}>
      {page === 'DASHBOARD' && overview.data && <PaperOverview view={overview.data} mode={mode} paused={paused} />}
      {page === 'PAPER_OBSERVATIONS' && observations.data && <Observations view={observations.data} showStrategy={false} />}
      {page === 'PAPER_STRATEGY' && strategy.data && <Strategy view={strategy.data} />}
      {page === 'PAPER_STRATEGY' && strategy.isSuccess && !strategy.data && <div className="workspace-empty">첫 스캔 이후 전략 판단과 근거가 표시됩니다.</div>}
      {page === 'PAPER_RESEARCH' && research.isSuccess && <Research view={research.data ?? undefined} />}
      {page === 'OPERATIONS' && <Operations engine={engine.isError ? undefined : engine.data} paused={paused} view={overview.data} />}
    </Suspense>
  </div>;
}
