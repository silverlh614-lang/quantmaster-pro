// @responsibility Learning Diagnostics Dashboard — Stale Reflections 카드 (자기학습 모듈 자연선택, ADR-0181)
import * as React from 'react';
import type {
  ClientReflectionImpactSummary,
  ClientReflectionModuleReport,
  ClientReflectionModuleStatus,
} from '../../api/learningDashboardClient';

interface StaleReflectionsCardProps {
  data: ClientReflectionImpactSummary | undefined;
  loading: boolean;
  error: Error | null;
}

/**
 * silent + deprecated 합계로 자연선택 활성도 분류:
 *   ≥3건 rose 자연선택 활발 (가드 wiring 검토)
 *   1~2건 amber 경계
 *   0건 emerald 모든 모듈 정상
 *
 * 모든 모듈 grace (영향률 측정 부족) 시 zinc 표본 부족.
 */
export function classifyStaleTone(
  staleCount: number,
  graceCount: number,
  total: number,
): { tone: string; label: string } {
  if (total === 0) return { tone: 'text-zinc-400', label: '데이터 없음' };
  if (graceCount === total) return { tone: 'text-zinc-400', label: '표본 부족 — grace 단계' };
  if (staleCount >= 3) return { tone: 'text-rose-400', label: '자연선택 활발 — 가드 wiring 검토' };
  if (staleCount >= 1) return { tone: 'text-amber-400', label: '경계' };
  return { tone: 'text-emerald-400', label: '모든 모듈 정상' };
}

function statusEmoji(status: ClientReflectionModuleStatus): string {
  switch (status) {
    case 'normal': return '✅';
    case 'grace': return '⏳';
    case 'silent': return '⚠️';
    case 'deprecated': return '❌';
  }
}

function statusTone(status: ClientReflectionModuleStatus): string {
  switch (status) {
    case 'normal': return 'text-emerald-400';
    case 'grace': return 'text-zinc-400';
    case 'silent': return 'text-amber-400';
    case 'deprecated': return 'text-rose-400';
  }
}

/**
 * silent / deprecated 우선 노출 + 그 외는 impactRate 오름차순 (영향 적은 순).
 * 운영자가 *은퇴 후보 모듈* 즉시 인지 가능.
 */
function sortedTopModules(
  modules: ClientReflectionModuleReport[],
  limit: number,
): ClientReflectionModuleReport[] {
  const stale = modules.filter((m) => m.status === 'silent' || m.status === 'deprecated');
  const other = modules.filter((m) => m.status !== 'silent' && m.status !== 'deprecated');
  // stale: 우선 (deprecated 먼저, 그 다음 silent), 같은 status 내 impactRate 오름차순
  stale.sort((a, b) => {
    if (a.status === 'deprecated' && b.status !== 'deprecated') return -1;
    if (b.status === 'deprecated' && a.status !== 'deprecated') return 1;
    return a.impactRate - b.impactRate;
  });
  // other: impactRate 오름차순 (영향 적은 순)
  other.sort((a, b) => a.impactRate - b.impactRate);
  return [...stale, ...other].slice(0, limit);
}

export function StaleReflectionsCard(
  props: StaleReflectionsCardProps,
): React.ReactElement {
  const { data, loading, error } = props;

  return (
    <section
      data-testid="stale-reflections-card"
      className="rounded-lg border border-zinc-700 bg-zinc-900/50 p-4"
    >
      <header className="mb-3">
        <h2 className="text-base font-semibold text-zinc-100">
          🪦 Stale Reflections (자연선택)
        </h2>
        <p className="text-xs text-zinc-400 mt-1">
          13 reflection 모듈 중 영향률 ≤5% silent / ≤1% deprecated — 운영 데이터 누적 후 가드 wiring 검토
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

      {!loading && !error && data && data.summary.total === 0 && (
        <div className="text-sm text-zinc-500" data-testid="empty-placeholder">
          모듈 0건 — `nightlyReflectionEngine` 실행 후 자연 누적
        </div>
      )}

      {!loading && !error && data && data.summary.total > 0 && (
        <div data-testid="stats-grid" className="space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatCell
              label="정상"
              value={data.summary.normal.toString()}
              tone="text-emerald-400"
              testId="stat-normal"
            />
            <StatCell
              label="grace"
              value={data.summary.grace.toString()}
              tone="text-zinc-400"
              testId="stat-grace"
            />
            <StatCell
              label="silent"
              value={data.summary.silent.toString()}
              tone={data.summary.silent > 0 ? 'text-amber-400' : 'text-zinc-500'}
              testId="stat-silent"
            />
            <StatCell
              label="deprecated"
              value={data.summary.deprecated.toString()}
              tone={data.summary.deprecated > 0 ? 'text-rose-400' : 'text-zinc-500'}
              testId="stat-deprecated"
            />
          </div>

          {sortedTopModules(data.modules, 5).length > 0 && (
            <div data-testid="top-modules" className="text-xs space-y-1">
              {sortedTopModules(data.modules, 5).map((m) => (
                <div
                  key={m.module}
                  data-testid={`module-${m.module}`}
                  className="flex items-center justify-between"
                >
                  <span className={statusTone(m.status)}>
                    {statusEmoji(m.status)} {m.module}
                  </span>
                  <span className="text-zinc-500">
                    {(m.impactRate * 100).toFixed(1)}% · {m.runs}회
                  </span>
                </div>
              ))}
            </div>
          )}

          <div
            className={`text-xs pt-2 border-t border-zinc-800 ${
              classifyStaleTone(
                data.summary.silent + data.summary.deprecated,
                data.summary.grace,
                data.summary.total,
              ).tone
            }`}
            data-testid="verdict-label"
          >
            {classifyStaleTone(
              data.summary.silent + data.summary.deprecated,
              data.summary.grace,
              data.summary.total,
            ).label}
            <span className="text-zinc-500 ml-2">· 윈도우 {data.windowDays}일</span>
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
