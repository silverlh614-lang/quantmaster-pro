// @responsibility Shadow Learning Dashboard 페이지 — 5 카드 (Missed Alpha / Good Rejection / Twin Ranking / Over-Strict / Good Defense).
import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ALL_TWIN_KEYS,
  fetchRejectionShadow,
  fetchShadowAttribution,
  fetchTwinPortfolio,
  type ClientRejectionShadowEntry,
  type ClientShadowConditionStat,
  type ClientTwinKey,
  type RejectionShadowResponse,
  type ShadowAttributionResponse,
  type TwinPortfolioResponse,
} from '../api/shadowLearningClient';
import { SampleProgressBar } from '../components/common/SampleProgressBar';

const STALE_MS = 60_000;
const REFETCH_MS = 60_000;

const TWIN_LABEL: Record<ClientTwinKey, string> = {
  AGGRESSIVE: '🔥 AGGRESSIVE',
  DISCIPLINED: '🎯 DISCIPLINED',
  EQUAL_WEIGHT: '⚖️ EQUAL_WEIGHT',
};

function classifyMiss(ret: number): { emoji: string; tone: string } {
  if (ret >= 5) return { emoji: '🔥', tone: 'text-rose-400' };
  if (ret >= 0) return { emoji: '🟢', tone: 'text-emerald-400' };
  return { emoji: '🔵', tone: 'text-sky-400' };
}

function classifyDefense(ret: number): { emoji: string; tone: string } {
  if (ret <= -10) return { emoji: '💪', tone: 'text-emerald-400' };
  if (ret <= -5) return { emoji: '🛡️', tone: 'text-emerald-300' };
  return { emoji: '🟡', tone: 'text-amber-300' };
}

export default function ShadowLearningPage(): React.ReactElement {
  const rejectionQuery = useQuery<RejectionShadowResponse>({
    queryKey: ['shadow-learning', 'rejection-shadow'],
    queryFn: () => fetchRejectionShadow(100),
    staleTime: STALE_MS,
    refetchInterval: REFETCH_MS,
    retry: 2,
  });

  const twinQuery = useQuery<TwinPortfolioResponse>({
    queryKey: ['shadow-learning', 'twin-portfolio'],
    queryFn: fetchTwinPortfolio,
    staleTime: STALE_MS,
    refetchInterval: REFETCH_MS,
    retry: 2,
  });

  const attributionQuery = useQuery<ShadowAttributionResponse>({
    queryKey: ['shadow-learning', 'shadow-attribution'],
    queryFn: fetchShadowAttribution,
    staleTime: STALE_MS,
    refetchInterval: REFETCH_MS,
    retry: 2,
  });

  const rejection = rejectionQuery.data;
  const twin = twinQuery.data;
  const attribution = attributionQuery.data;

  return (
    <div className="space-y-6 p-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-bold text-zinc-100">🌑 Shadow Learning Dashboard</h1>
        <p className="text-sm text-zinc-400">
          AI 가 추천하지 않은 선택까지 학습하는 메타 학습 엔진. Rejection + Twin Portfolio 데이터 기반.
        </p>
      </header>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <MissedAlphaCard data={rejection} loading={rejectionQuery.isLoading} error={rejectionQuery.error} />
        <GoodRejectionCard data={rejection} loading={rejectionQuery.isLoading} error={rejectionQuery.error} />
        <TwinRankingCard data={twin} loading={twinQuery.isLoading} error={twinQuery.error} />
        <OverStrictCard data={attribution} loading={attributionQuery.isLoading} error={attributionQuery.error} />
        <GoodDefenseCard data={attribution} loading={attributionQuery.isLoading} error={attributionQuery.error} />
      </div>
    </div>
  );
}

// ── 1. Missed Alpha (거절 후 +5% 이상) ─────────────────────────────────────────

interface CardProps<T> {
  data: T | undefined;
  loading: boolean;
  error: Error | null;
}

export function MissedAlphaCard({ data, loading, error }: CardProps<RejectionShadowResponse>): React.ReactElement {
  return (
    <Card title="🎯 Missed Alpha" subtitle="거절했지만 오른 종목 (≥+5%)" data-testid="missed-alpha-card">
      {error && <ErrorState message={error.message} />}
      {loading && !data && <LoadingState />}
      {data && (() => {
        const missed = data.entries
          .filter((e) => (e.currentReturnPct ?? 0) >= 5)
          .sort((a, b) => (b.currentReturnPct ?? 0) - (a.currentReturnPct ?? 0))
          .slice(0, 8);
        if (missed.length === 0) {
          return <EmptyState message={`종결 ${data.summary.closedCount}건 / Alpha 누락 ${(data.summary.falseNegativeRate * 100).toFixed(1)}%`} />;
        }
        return (
          <ul className="space-y-1.5">
            {missed.map((e: ClientRejectionShadowEntry) => {
              const ret = e.currentReturnPct ?? 0;
              const { emoji, tone } = classifyMiss(ret);
              return (
                <li key={e.id} className="flex items-center justify-between text-sm" data-testid={`missed-${e.stockCode}`}>
                  <span className="truncate text-zinc-200">{emoji} <strong>{e.stockName}</strong> <span className="text-xs text-zinc-500">({e.stockCode})</span></span>
                  <span className={`font-mono ${tone}`}>+{ret.toFixed(2)}%</span>
                </li>
              );
            })}
          </ul>
        );
      })()}
      {data && (
        <p className="mt-3 text-xs text-zinc-500">
          질문: <em>"우리가 너무 엄격했나?"</em> · 종결 {data.summary.closedCount}건 / 활성 {data.summary.activeCount}건
        </p>
      )}
    </Card>
  );
}

// ── 2. Good Rejection (거절 후 하락) ───────────────────────────────────────────

export function GoodRejectionCard({ data, loading, error }: CardProps<RejectionShadowResponse>): React.ReactElement {
  return (
    <Card title="🛡️ Good Rejection" subtitle="거절 후 하락한 종목 (≤-5%)" data-testid="good-rejection-card">
      {error && <ErrorState message={error.message} />}
      {loading && !data && <LoadingState />}
      {data && (() => {
        const defended = data.entries
          .filter((e) => (e.currentReturnPct ?? 0) <= -5)
          .sort((a, b) => (a.currentReturnPct ?? 0) - (b.currentReturnPct ?? 0))
          .slice(0, 8);
        if (defended.length === 0) {
          return <EmptyState message="회피 알파 추적 중 — 표본 누적 후 노출" />;
        }
        return (
          <ul className="space-y-1.5">
            {defended.map((e) => {
              const ret = e.currentReturnPct ?? 0;
              const { emoji, tone } = classifyDefense(ret);
              return (
                <li key={e.id} className="flex items-center justify-between text-sm" data-testid={`defended-${e.stockCode}`}>
                  <span className="truncate text-zinc-200">{emoji} <strong>{e.stockName}</strong> <span className="text-xs text-zinc-500">({e.stockCode})</span></span>
                  <span className={`font-mono ${tone}`}>{ret.toFixed(2)}%</span>
                </li>
              );
            })}
          </ul>
        );
      })()}
      {data && (
        <p className="mt-3 text-xs text-zinc-500">
          질문: <em>"우리가 잘 막아냈나?"</em> · 회피 비율: 종결 중 ≤-5% 분포 자동 산출
        </p>
      )}
    </Card>
  );
}

// ── 3. Twin Portfolio Ranking ─────────────────────────────────────────────────

export function TwinRankingCard({ data, loading, error }: CardProps<TwinPortfolioResponse>): React.ReactElement {
  return (
    <Card title="👯 Twin Portfolio Ranking" subtitle="CURRENT vs 3 Twin 정책" data-testid="twin-ranking-card">
      {error && <ErrorState message={error.message} />}
      {loading && !data && <LoadingState />}
      {data && (() => {
        const ranking: Array<{ name: string; cumReturnPct: number; sharpe: number; closedCount: number; isTwin: boolean; winning: boolean }> = [
          {
            name: '👤 CURRENT (LIVE)',
            cumReturnPct: data.realCumReturnPct,
            sharpe: 0,
            closedCount: 0,
            isTwin: false,
            winning: false,
          },
        ];
        for (const k of ALL_TWIN_KEYS) {
          const stats = data.comparison.perTwin[k];
          ranking.push({
            name: TWIN_LABEL[k],
            cumReturnPct: stats.cumReturnPct,
            sharpe: stats.weeklySharpeProxy,
            closedCount: stats.closedCount,
            isTwin: true,
            winning: data.comparison.weekWinning[k],
          });
        }
        ranking.sort((a, b) => b.cumReturnPct - a.cumReturnPct);

        return (
          <ul className="space-y-2">
            {ranking.map((r, i) => {
              const rankEmoji = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : '4️⃣';
              const sign = r.cumReturnPct >= 0 ? '+' : '';
              return (
                <li key={r.name} className="flex items-center justify-between text-sm" data-testid={`twin-${i}`}>
                  <span className="truncate text-zinc-200">
                    {rankEmoji} {r.name} {r.winning && <span className="text-emerald-400">✅</span>}
                  </span>
                  <span className={`font-mono ${r.cumReturnPct >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {sign}{r.cumReturnPct.toFixed(2)}%{r.isTwin && (
                      <span className="ml-2 text-xs text-zinc-500">Sharpe {r.sharpe.toFixed(2)}</span>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        );
      })()}
      {data && (
        <p className="mt-3 text-xs text-zinc-500">
          ✅ = Twin 이 CURRENT 보다 우월 · 4주 연속 시 promotion 후보 (운영자 검토 — 자동 임계 조정 금지)
        </p>
      )}
    </Card>
  );
}

// ── 4. Over-Strict Conditions ─────────────────────────────────────────────────

export function OverStrictCard({ data, loading, error }: CardProps<ShadowAttributionResponse>): React.ReactElement {
  return (
    <Card title="⚠️ Over-Strict Conditions" subtitle="너무 엄격한 조건 후보 (완화 검토)" data-testid="over-strict-card">
      {error && <ErrorState message={error.message} />}
      {loading && !data && <LoadingState />}
      {data && data.status === 'DISABLED' && <EmptyState message="비활성 (SHADOW_CONDITION_ATTRIBUTION_DISABLED)" />}
      {data && data.status === 'NO_DATA' && (
        <div className="space-y-3">
          {data.progressTowardSampleSufficient && (
            <SampleProgressBar progress={data.progressTowardSampleSufficient} />
          )}
          <EmptyState message="conditionScores 호출자 wiring (PR-F-2 후속) 후 노출" />
        </div>
      )}
      {data && data.status === 'OK' && (() => {
        const overStrict = data.conditions
          .filter((c: ClientShadowConditionStat) => c.classification === 'over_strict_candidate')
          .sort((a, b) => b.overStrictCount - a.overStrictCount)
          .slice(0, 8);
        if (overStrict.length === 0) {
          return <EmptyState message="후보 없음 — 표본 부족 또는 균형 분포" />;
        }
        return (
          <ul className="space-y-1.5">
            {overStrict.map((c) => (
              <li key={c.conditionId} className="flex items-center justify-between text-sm" data-testid={`over-strict-${c.conditionId}`}>
                <span className="truncate text-zinc-200">⚠️ #{c.conditionId} {c.conditionName}</span>
                <span className="font-mono text-rose-300">over {c.overStrictCount}건 / {(c.ratio * 100).toFixed(0)}%</span>
              </li>
            ))}
          </ul>
        );
      })()}
      {data && data.status === 'OK' && (
        <p className="mt-3 text-xs text-zinc-500">
          거절했지만 +5% 이상 종목에서 자주 미달 → 임계 완화 검토 (운영자 결정)
        </p>
      )}
    </Card>
  );
}

// ── 5. Good Defense Conditions ────────────────────────────────────────────────

export function GoodDefenseCard({ data, loading, error }: CardProps<ShadowAttributionResponse>): React.ReactElement {
  return (
    <Card title="🛡️ Good Defense Conditions" subtitle="잘 막아준 조건 후보 (RISK_PROTECTOR)" data-testid="good-defense-card">
      {error && <ErrorState message={error.message} />}
      {loading && !data && <LoadingState />}
      {data && data.status === 'DISABLED' && <EmptyState message="비활성 (SHADOW_CONDITION_ATTRIBUTION_DISABLED)" />}
      {data && data.status === 'NO_DATA' && (
        <div className="space-y-3">
          {data.progressTowardSampleSufficient && (
            <SampleProgressBar progress={data.progressTowardSampleSufficient} />
          )}
          <EmptyState message="conditionScores 호출자 wiring (PR-F-2 후속) 후 노출" />
        </div>
      )}
      {data && data.status === 'OK' && (() => {
        const goodDefense = data.conditions
          .filter((c: ClientShadowConditionStat) => c.classification === 'good_defense_candidate')
          .sort((a, b) => b.goodDefenseCount - a.goodDefenseCount)
          .slice(0, 8);
        if (goodDefense.length === 0) {
          return <EmptyState message="후보 없음 — 표본 부족 또는 균형 분포" />;
        }
        return (
          <ul className="space-y-1.5">
            {goodDefense.map((c) => (
              <li key={c.conditionId} className="flex items-center justify-between text-sm" data-testid={`good-defense-${c.conditionId}`}>
                <span className="truncate text-zinc-200">🛡️ #{c.conditionId} {c.conditionName}</span>
                <span className="font-mono text-emerald-300">defense {c.goodDefenseCount}건 / {(c.ratio * 100).toFixed(0)}%</span>
              </li>
            ))}
          </ul>
        );
      })()}
      {data && data.status === 'OK' && (
        <p className="mt-3 text-xs text-zinc-500">
          거절 후 -5% 이하 종목에서 자주 미달 → RISK_PROTECTOR 강화 검토
        </p>
      )}
    </Card>
  );
}

// ── 공용 UI 프리미티브 ──────────────────────────────────────────────────────────

interface CardComposition {
  title: string;
  subtitle: string;
  children: React.ReactNode;
  'data-testid'?: string;
}

function Card({ title, subtitle, children, ...rest }: CardComposition): React.ReactElement {
  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 shadow-sm" {...rest}>
      <header className="mb-3">
        <h2 className="text-sm font-semibold text-zinc-200">{title}</h2>
        <p className="mt-0.5 text-xs text-zinc-500">{subtitle}</p>
      </header>
      <div>{children}</div>
    </section>
  );
}

function LoadingState(): React.ReactElement {
  return <p className="text-sm text-zinc-500">불러오는 중...</p>;
}

function EmptyState({ message }: { message: string }): React.ReactElement {
  return <p className="text-sm text-zinc-500">📭 {message}</p>;
}

function ErrorState({ message }: { message: string }): React.ReactElement {
  return <p className="text-sm text-rose-400">❌ 조회 실패 — {message}</p>;
}
