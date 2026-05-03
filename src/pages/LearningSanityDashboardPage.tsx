// @responsibility Learning Sanity Dashboard 페이지 — Phase 4-B-1 + 4-B-2-a/b1/b2 (5 카드, ADR-0178/0179/0180/0181)
import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  fetchSafetyGateAttribution,
  fetchShadowVsLiveDelta,
  fetchMissedLearningQueueStats,
  fetchRejectionShadowStats,
  fetchReflectionImpact,
  type ClientGateAttributionResult,
  type ClientDeltaCategoryResult,
  type ClientMissedLearningQueueStats,
  type ClientRejectionShadowSummary,
  type ClientReflectionImpactSummary,
} from '../api/learningDashboardClient';
import { SafetyGateAttributionCard } from '../components/learning/SafetyGateAttributionCard';
import { ShadowVsLiveDeltaCard } from '../components/learning/ShadowVsLiveDeltaCard';
import { MissedLearningQueueStatsCard } from '../components/learning/MissedLearningQueueStatsCard';
import { RejectedWinnersCard } from '../components/learning/RejectedWinnersCard';
import { StaleReflectionsCard } from '../components/learning/StaleReflectionsCard';

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

  return (
    <div className="px-4 py-6 space-y-6" data-testid="learning-sanity-dashboard-page">
      <header className="space-y-2">
        <h1 className="text-xl font-bold text-zinc-100">🧠 Learning Sanity Dashboard</h1>
        <p className="text-sm text-zinc-400">
          ADR-0178 + 0179 + 0180 + 0181 — 5 카드 (Safety Gate / Shadow vs Live /
          MissedLearningQueue / Rejected Winners / Stale Reflections).
          거짓 부정율 ≥0.3 시 게이트 완화 후보 + silent/deprecated ≥3 시 가드 wiring 검토.
        </p>
        <p className="text-xs text-zinc-500">
          잔여 4 지표 (unresolved counterfactuals / gate opportunity cost / reflection injection
          rate / learning freshness score) 는 Phase 4-B-2-b3/c 후속 PR.
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
      </div>
    </div>
  );
}
