// @responsibility Learning Sanity Dashboard 페이지 — Phase 4-B-1 2 핵심 카드 (Safety Gate Attribution + Shadow vs Live Delta, ADR-0178)
import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  fetchSafetyGateAttribution,
  fetchShadowVsLiveDelta,
  type ClientGateAttributionResult,
  type ClientDeltaCategoryResult,
} from '../api/learningDashboardClient';
import { SafetyGateAttributionCard } from '../components/learning/SafetyGateAttributionCard';
import { ShadowVsLiveDeltaCard } from '../components/learning/ShadowVsLiveDeltaCard';

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

  return (
    <div className="px-4 py-6 space-y-6" data-testid="learning-sanity-dashboard-page">
      <header className="space-y-2">
        <h1 className="text-xl font-bold text-zinc-100">🧠 Learning Sanity Dashboard</h1>
        <p className="text-sm text-zinc-400">
          ADR-0178 Phase 4-B-1 — Phase 2a 영속 분석 SSOT 의 *2 핵심 지표* 가시화.
          ENV `SAFETY_GATE_ATTRIBUTION_ENABLED` / `SHADOW_LIVE_DELTA_REPORT_ENABLED`
          활성화 + SHADOW 검증 데이터 누적 시 자연 가시화.
        </p>
        <p className="text-xs text-zinc-500">
          잔여 9 지표 (skipped jobs / replayed / failed replay / unresolved counterfactuals /
          stale reflections / rejected winners / gate opportunity cost / reflection injection
          rate / learning freshness score) 는 Phase 4-B-2 후속 PR.
        </p>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
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
      </div>
    </div>
  );
}
