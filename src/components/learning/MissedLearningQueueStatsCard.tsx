// @responsibility Learning Diagnostics Dashboard — MissedLearningQueue 4 status 카운트 카드 (ADR-0179)
import * as React from 'react';
import type { ClientMissedLearningQueueStats } from '../../api/learningDashboardClient';

interface MissedLearningQueueStatsCardProps {
  stats: ClientMissedLearningQueueStats | undefined;
  loading: boolean;
  error: Error | null;
}

function formatKstTime(iso: string | undefined): string {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
  } catch {
    return '—';
  }
}

export function MissedLearningQueueStatsCard(
  props: MissedLearningQueueStatsCardProps,
): React.ReactElement {
  const { stats, loading, error } = props;

  return (
    <section
      data-testid="missed-learning-queue-stats-card"
      className="rounded-lg border border-zinc-700 bg-zinc-900/50 p-4"
    >
      <header className="mb-3">
        <h2 className="text-base font-semibold text-zinc-100">
          📦 MissedLearningQueue Stats
        </h2>
        <p className="text-xs text-zinc-400 mt-1">
          KRX 휴장일·서버 장애·배포 시 스킵된 학습 작업 큐 상태 (ADR-0173 §1)
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

      {!loading && !error && stats && stats.total === 0 && (
        <div className="text-sm text-zinc-500" data-testid="empty-placeholder">
          MissedLearningQueue 비어있음 — 휴장일/장애 미발생 또는 ENV{' '}
          <code className="text-xs">MISSED_LEARNING_QUEUE_ENABLED</code> 미활성
        </div>
      )}

      {!loading && !error && stats && stats.total > 0 && (
        <div data-testid="stats-grid" className="space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatCell
              label="대기 중"
              value={stats.pending}
              tone={stats.pending > 0 ? 'amber' : 'zinc'}
              testId="stat-pending"
            />
            <StatCell
              label="복구 완료"
              value={stats.replayed}
              tone="emerald"
              testId="stat-replayed"
            />
            <StatCell
              label="실패"
              value={stats.failed}
              tone={stats.failed > 0 ? 'rose' : 'zinc'}
              testId="stat-failed"
            />
            <StatCell
              label="만료 폐기"
              value={stats.dropped}
              tone="zinc"
              testId="stat-dropped"
            />
          </div>
          <div className="flex justify-between text-xs text-zinc-500 pt-2 border-t border-zinc-800">
            <span>전체: {stats.total}건</span>
            <span data-testid="last-enqueued-at">
              최종 enqueue: {formatKstTime(stats.lastEnqueuedAt)}
            </span>
          </div>
        </div>
      )}
    </section>
  );
}

interface StatCellProps {
  label: string;
  value: number;
  tone: 'emerald' | 'amber' | 'rose' | 'zinc';
  testId: string;
}

function StatCell(props: StatCellProps): React.ReactElement {
  const { label, value, tone, testId } = props;
  const toneClass =
    tone === 'emerald'
      ? 'text-emerald-400'
      : tone === 'amber'
        ? 'text-amber-400'
        : tone === 'rose'
          ? 'text-rose-400'
          : 'text-zinc-400';
  return (
    <div data-testid={testId} className="rounded bg-zinc-800/50 p-2 text-center">
      <div className={`text-2xl font-bold ${toneClass}`}>{value}</div>
      <div className="text-xs text-zinc-500 mt-1">{label}</div>
    </div>
  );
}
