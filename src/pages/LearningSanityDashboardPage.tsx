// @responsibility Learning Sanity Dashboard 페이지 — Phase 4-B-1 2 핵심 카드 (Safety Gate Attribution + Shadow vs Live Delta, ADR-0178)
import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  fetchSafetyGateAttribution,
  fetchShadowVsLiveDelta,
  fetchMissedLearningQueueStats,
  type ClientGateAttributionResult,
  type ClientDeltaCategoryResult,
  type ClientMissedLearningQueueStats,
} from '../api/learningDashboardClient';
import { SafetyGateAttributionCard } from '../components/learning/SafetyGateAttributionCard';
import { ShadowVsLiveDeltaCard } from '../components/learning/ShadowVsLiveDeltaCard';
import { MissedLearningQueueStatsCard } from '../components/learning/MissedLearningQueueStatsCard';

const STALE_MS = 60_000;
const REFETCH_MS = 60_000;

export default function LearningSanityDashboardPage(): React.ReactElement {
  const safetyQuery = useQuery<ClientGateAttributionResult[]>({
    queryKey: ['learning-sanity', 'safety-gate-attribution'],
    queryFn: () => fetchSafetyGateAttribution(),
    staleTime: STALE_MS,
    refetchInterval: REFETCH_MS,
    retry: 2,
  });

  const deltaQuery = useQuery<ClientDeltaCategoryResult[]>({
    queryKey: ['learning-sanity', 'shadow-vs-live-delta'],
    queryFn: () => fetchShadowVsLiveDelta(),
    staleTime: STALE_MS,
    refetchInterval: REFETCH_MS,
    retry: 2,
  });

  const missedQueueQuery = useQuery<ClientMissedLearningQueueStats>({
    queryKey: ['learning-sanity', 'missed-learning-queue-stats'],
    queryFn: fetchMissedLearningQueueStats,
    staleTime: STALE_MS,
    refetchInterval: REFETCH_MS,
    retry: 2,
  });

  return (
    <div className="px-4 py-6 space-y-6" data-testid="learning-sanity-dashboard-page">
      <header className="space-y-2">
        <h1 className="text-xl font-bold text-zinc-100">🧠 Learning Sanity Dashboard</h1>
        <p className="text-sm text-zinc-400">
          ADR-0178 Phase 4-B-1 + ADR-0179 Phase 4-B-2-a — Phase 2a 영속 분석 SSOT *2 핵심 지표*
          + MissedLearningQueue 큐 상태 가시화.
        </p>
        <p className="text-xs text-zinc-500">
          잔여 6 지표 (unresolved counterfactuals / stale reflections / rejected winners /
          gate opportunity cost / reflection injection rate / learning freshness score) 는
          Phase 4-B-2-b/c 후속 PR.
        </p>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
        <SafetyGateAttributionCard
          results={safetyQuery.data}
          loading={safetyQuery.isLoading}
          error={safetyQuery.error}
        />
        <ShadowVsLiveDeltaCard
          results={deltaQuery.data}
          loading={deltaQuery.isLoading}
          error={deltaQuery.error}
        />
        <MissedLearningQueueStatsCard
          stats={missedQueueQuery.data}
          loading={missedQueueQuery.isLoading}
          error={missedQueueQuery.error}
        />
      </div>
    </div>
  );
}
