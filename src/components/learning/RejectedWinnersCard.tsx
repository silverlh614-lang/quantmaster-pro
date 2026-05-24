// @responsibility Learning Diagnostics Dashboard — Rejected Winners 카드 (거짓 부정율, ADR-0180)
import * as React from 'react';
import type { ClientRejectionShadowSummary } from '../../api/learningDashboardClient';

interface RejectedWinnersCardProps {
  summary: ClientRejectionShadowSummary | undefined;
  loading: boolean;
  error: Error | null;
}

function classifyTone(
  falseNegativeRate: number,
  reliable: boolean,
): { tone: string; label: string } {
  if (!reliable) return { tone: 'text-zinc-400', label: '표본 부족' };
  if (falseNegativeRate >= 0.3) return { tone: 'text-rose-400', label: '게이트 완화 후보' };
  if (falseNegativeRate < 0.1) return { tone: 'text-emerald-400', label: '게이트 정합' };
  return { tone: 'text-amber-400', label: '경계' };
}

export function RejectedWinnersCard(
  props: RejectedWinnersCardProps,
): React.ReactElement {
  const { summary, loading, error } = props;

  return (
    <section
      data-testid="rejected-winners-card"
      className="rounded-lg border border-zinc-700 bg-zinc-900/50 p-4"
    >
      <header className="mb-3">
        <h2 className="text-base font-semibold text-zinc-100">
          🎯 Rejected Winners (거짓 부정율)
        </h2>
        <p className="text-xs text-zinc-400 mt-1">
          거절된 종목 중 사후 +5% 이상 상승 비율 — `≥0.3` 게이트 완화 후보
        </p>
      </header>

      {loading && (
        <div className="text-sm text-zinc-400" data-testid="loading">
          데이터 로드 중...
        </div>
      )}

      {error && (
        <div className="text-sm text-rose-400" data-testid="error">
          데이터 로드 실패 — {error.message}
        </div>
      )}

      {!loading && !error && summary && summary.closedCount === 0 && (
        <div className="text-sm text-zinc-500" data-testid="empty-placeholder">
          종결된 거절 0건 — `recordRejection` 활성화 또는 SHADOW 검증 필요
        </div>
      )}

      {!loading && !error && summary && summary.closedCount > 0 && (
        <div data-testid="stats-grid" className="space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatCell
              label="종결 거절"
              value={summary.closedCount.toString()}
              tone="text-zinc-400"
              testId="stat-closed-count"
            />
            <StatCell
              label="Winners"
              value={Math.round(summary.falseNegativeRate * summary.closedCount).toString()}
              tone={
                classifyTone(summary.falseNegativeRate, summary.reliable ?? false).tone
              }
              testId="stat-winner-count"
            />
            <StatCell
              label="거짓 부정율"
              value={`${(summary.falseNegativeRate * 100).toFixed(1)}%`}
              tone={
                classifyTone(summary.falseNegativeRate, summary.reliable ?? false).tone
              }
              testId="stat-false-negative-rate"
            />
            <StatCell
              label="신뢰성"
              value={summary.reliable ? '✓' : '✗'}
              tone={summary.reliable ? 'text-emerald-400' : 'text-zinc-500'}
              testId="stat-reliable"
            />
          </div>
          <div
            className={`text-xs pt-2 border-t border-zinc-800 ${
              classifyTone(summary.falseNegativeRate, summary.reliable ?? false).tone
            }`}
            data-testid="verdict-label"
          >
            {classifyTone(summary.falseNegativeRate, summary.reliable ?? false).label}
            {summary.activeCount > 0 && (
              <span className="text-zinc-500 ml-2">
                · 추적 중 {summary.activeCount}건
              </span>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

interface StatCellProps {
  label: string;
  value: string;
  tone: string;
  testId: string;
}

function StatCell(props: StatCellProps): React.ReactElement {
  const { label, value, tone, testId } = props;
  return (
    <div data-testid={testId} className="rounded bg-zinc-800/50 p-2 text-center">
      <div className={`text-xl font-bold ${tone}`}>{value}</div>
      <div className="text-xs text-zinc-500 mt-1">{label}</div>
    </div>
  );
}
