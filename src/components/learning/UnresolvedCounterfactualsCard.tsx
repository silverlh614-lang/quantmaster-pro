// @responsibility Learning Sanity Dashboard — Unresolved Counterfactuals 카드 (학습 입력 진단, ADR-0182)
import * as React from 'react';
import type { ClientCounterfactualUnresolvedStats } from '../../api/learningDashboardClient';

interface UnresolvedCounterfactualsCardProps {
  stats: ClientCounterfactualUnresolvedStats | undefined;
  loading: boolean;
  error: Error | null;
}

/**
 * pending30dCount tone 분기 (ADR-0182 §2.4):
 *   pending30dCount === 0 + totalCount ≥ 5 → emerald (cron 정상)
 *   pending30dCount ≥ 5 → rose (cron 미실행 또는 가격 fetcher 실패)
 *   pending30dCount ≥ 1 → amber (경계)
 *   totalCount === 0 → zinc (데이터 없음)
 */
export function classifyUnresolvedTone(
  pending30dCount: number,
  totalCount: number,
): { tone: string; label: string } {
  if (totalCount === 0) return { tone: 'text-zinc-400', label: '데이터 없음' };
  if (pending30dCount >= 5) {
    return {
      tone: 'text-rose-400',
      label: 'cron 미실행 또는 가격 fetcher 실패 의심',
    };
  }
  if (pending30dCount >= 1) {
    return { tone: 'text-amber-400', label: '경계 — 일부 미해결' };
  }
  if (totalCount >= 5) {
    return { tone: 'text-emerald-400', label: 'cron 정상' };
  }
  return { tone: 'text-zinc-400', label: '표본 부족' };
}

/**
 * horizon 별 진행률 — `resolved / (resolved + pending)`. 0/0 fallback null.
 */
export function computeHorizonProgress(
  resolved: number,
  pending: number,
): number | null {
  const denom = resolved + pending;
  if (denom <= 0) return null;
  return resolved / denom;
}

function formatPct(ratio: number | null): string {
  if (ratio === null) return '—';
  return `${(ratio * 100).toFixed(0)}%`;
}

function formatKstDate(isoOrYmd: string | undefined): string {
  if (!isoOrYmd) return '—';
  // signalDate 형식 = YYYY-MM-DD KST. 그대로 표시.
  if (/^\d{4}-\d{2}-\d{2}$/.test(isoOrYmd)) return isoOrYmd;
  // ISO 인 경우 KST 일자 변환
  const ms = Date.parse(isoOrYmd);
  if (!Number.isFinite(ms)) return '—';
  const kst = new Date(ms + 9 * 3600 * 1000);
  return kst.toISOString().slice(0, 10);
}

export function UnresolvedCounterfactualsCard(
  props: UnresolvedCounterfactualsCardProps,
): React.ReactElement {
  const { stats, loading, error } = props;

  return (
    <section
      data-testid="unresolved-counterfactuals-card"
      className="rounded-lg border border-zinc-700 bg-zinc-900/50 p-4"
    >
      <header className="mb-3">
        <h2 className="text-base font-semibold text-zinc-100">
          ⏳ Unresolved Counterfactuals (학습 입력 진단)
        </h2>
        <p className="text-xs text-zinc-400 mt-1">
          counterfactual 거절 후보의 30/60/90일 사후 수익률 해결 진행도 — `pending30dCount ≥ 5` 시 cron 미실행 의심
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

      {!loading && !error && stats && stats.totalCount === 0 && (
        <div className="text-sm text-zinc-500" data-testid="empty-placeholder">
          거절 후보 0건 — `recordCounterfactual` wiring 후 자연 누적
        </div>
      )}

      {!loading && !error && stats && stats.totalCount > 0 && (
        <div data-testid="stats-grid" className="space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatCell
              label="전체"
              value={stats.totalCount.toString()}
              tone="text-zinc-400"
              testId="stat-total-count"
            />
            <StatCell
              label="30d 해결"
              value={stats.resolved30dCount.toString()}
              tone={
                stats.resolved30dCount > 0 ? 'text-emerald-400' : 'text-zinc-500'
              }
              testId="stat-resolved-30d-count"
            />
            <StatCell
              label="30d 미해결"
              value={stats.pending30dCount.toString()}
              tone={
                classifyUnresolvedTone(stats.pending30dCount, stats.totalCount).tone
              }
              testId="stat-pending-30d-count"
            />
            <StatCell
              label="대기"
              value={stats.awaitingHorizonCount.toString()}
              tone="text-zinc-400"
              testId="stat-awaiting-horizon-count"
            />
          </div>

          <div data-testid="horizon-progress" className="text-xs space-y-1">
            <ProgressRow
              label="30d"
              resolved={stats.resolved30dCount}
              pending={stats.pending30dCount}
              testId="progress-30d"
            />
            <ProgressRow
              label="60d"
              resolved={stats.resolved60dCount}
              pending={stats.pending60dCount}
              testId="progress-60d"
            />
            <ProgressRow
              label="90d"
              resolved={stats.resolved90dCount}
              pending={stats.pending90dCount}
              testId="progress-90d"
            />
          </div>

          <div
            className={`text-xs pt-2 border-t border-zinc-800 ${
              classifyUnresolvedTone(stats.pending30dCount, stats.totalCount).tone
            }`}
            data-testid="verdict-label"
          >
            {classifyUnresolvedTone(stats.pending30dCount, stats.totalCount).label}
            {stats.oldestSignalDate && (
              <span className="text-zinc-500 ml-2" data-testid="oldest-signal-date">
                · 최오래 {formatKstDate(stats.oldestSignalDate)}
              </span>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

interface ProgressRowProps {
  label: string;
  resolved: number;
  pending: number;
  testId: string;
}

function ProgressRow(props: ProgressRowProps): React.ReactElement {
  const { label, resolved, pending, testId } = props;
  const ratio = computeHorizonProgress(resolved, pending);
  return (
    <div data-testid={testId} className="flex items-center justify-between">
      <span className="text-zinc-400">{label}</span>
      <span className="text-zinc-500">
        {resolved} / {resolved + pending} ({formatPct(ratio)})
      </span>
    </div>
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
