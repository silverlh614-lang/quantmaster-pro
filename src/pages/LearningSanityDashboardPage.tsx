// @responsibility Learning Sanity Dashboard 페이지 — Phase 4-B-1 + 4-B-2-a/b1/b2/b3 (6 카드, ADR-0178/0179/0180/0181/0182)
import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  fetchSafetyGateAttribution,
  fetchShadowVsLiveDelta,
  fetchMissedLearningQueueStats,
  fetchRejectionShadowStats,
  fetchReflectionImpact,
  fetchCounterfactualUnresolvedStats,
  type ClientGateAttributionResult,
  type ClientDeltaCategoryResult,
  type ClientMissedLearningQueueStats,
  type ClientRejectionShadowSummary,
  type ClientReflectionImpactSummary,
  type ClientCounterfactualUnresolvedStats,
} from '../api/learningDashboardClient';
import { SafetyGateAttributionCard } from '../components/learning/SafetyGateAttributionCard';
import { ShadowVsLiveDeltaCard } from '../components/learning/ShadowVsLiveDeltaCard';
import { MissedLearningQueueStatsCard } from '../components/learning/MissedLearningQueueStatsCard';
import { RejectedWinnersCard } from '../components/learning/RejectedWinnersCard';
import { StaleReflectionsCard } from '../components/learning/StaleReflectionsCard';
import { UnresolvedCounterfactualsCard } from '../components/learning/UnresolvedCounterfactualsCard';

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

  const rejectedWinnersQuery = useQuery<ClientRejectionShadowSummary>({
    queryKey: ['learning-sanity', 'rejection-shadow-stats'],
    queryFn: fetchRejectionShadowStats,
    staleTime: STALE_MS,
    refetchInterval: REFETCH_MS,
    retry: 2,
  });

  const reflectionImpactQuery = useQuery<ClientReflectionImpactSummary>({
    queryKey: ['learning-sanity', 'reflection-impact'],
    queryFn: () => fetchReflectionImpact(),
    staleTime: STALE_MS,
    refetchInterval: REFETCH_MS,
    retry: 2,
  });

  const unresolvedCounterfactualsQuery = useQuery<ClientCounterfactualUnresolvedStats>({
    queryKey: ['learning-sanity', 'counterfactual-unresolved-stats'],
    queryFn: fetchCounterfactualUnresolvedStats,
    staleTime: STALE_MS,
    refetchInterval: REFETCH_MS,
    retry: 2,
  });

  return (
    <div className="px-4 py-6 space-y-6" data-testid="learning-sanity-dashboard-page">
      <header className="space-y-2">
        <h1 className="text-xl font-bold text-zinc-100">🧠 Learning Sanity Dashboard</h1>
        <p className="text-sm text-zinc-400">
          ADR-0178~0182 — 6 카드 (Safety Gate / Shadow vs Live / MissedLearningQueue
          / Rejected Winners / Stale Reflections / Unresolved Counterfactuals).
          Phase 4-B-2-b 시리즈 완주 (3/3).
        </p>
        <p className="text-xs text-zinc-500">
          잔여 3 지표 (gate opportunity cost / reflection injection rate / learning freshness score)
          는 Phase 4-B-2-c 후속 PR — Phase 3 결합 지표.
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
        <RejectedWinnersCard
          summary={rejectedWinnersQuery.data}
          loading={rejectedWinnersQuery.isLoading}
          error={rejectedWinnersQuery.error}
        />
        <StaleReflectionsCard
          data={reflectionImpactQuery.data}
          loading={reflectionImpactQuery.isLoading}
          error={reflectionImpactQuery.error}
        />
        <UnresolvedCounterfactualsCard
          stats={unresolvedCounterfactualsQuery.data}
          loading={unresolvedCounterfactualsQuery.isLoading}
          error={unresolvedCounterfactualsQuery.error}
        />
      </div>
    </div>
  );
}
