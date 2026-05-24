// @responsibility Learning Diagnostics Dashboard — Shadow vs Live Delta 5 카테고리 결과 카드 (ADR-0178)
import * as React from 'react';
import {
  ALL_DELTA_CATEGORIES,
  type ClientDeltaCategory,
  type ClientDeltaCategoryResult,
} from '../../api/learningDashboardClient';

const CATEGORY_LABEL: Record<ClientDeltaCategory, string> = {
  SHADOW_BUY_LIVE_BLOCKED: 'Shadow 매수 / LIVE 차단',
  LIVE_BUY_SHADOW_BETTER_SIZE: 'LIVE 매수 / Shadow 사이즈 우수',
  EXPOSURE_CAP_REDUCED: 'Exposure cap 축소',
  MACRO_GATE_BLOCKED: '매크로 게이트 차단',
  LIQUIDITY_GATE_BLOCKED: '유동성 게이트 차단',
};

function classifyMissedAlpha(alpha: number): { tone: string; label: string } {
  if (alpha > 0) return { tone: 'text-rose-400', label: '기회 손실' };
  if (alpha < 0) return { tone: 'text-emerald-400', label: '살아남은 효과' };
  return { tone: 'text-zinc-500', label: '중립' };
}

interface ShadowVsLiveDeltaCardProps {
  results: ClientDeltaCategoryResult[] | undefined;
  loading: boolean;
  error: Error | null;
}

export function ShadowVsLiveDeltaCard(
  props: ShadowVsLiveDeltaCardProps,
): React.ReactElement {
  const { results, loading, error } = props;

  const byCategory = React.useMemo(() => {
    const m = new Map<ClientDeltaCategory, ClientDeltaCategoryResult>();
    if (results) for (const r of results) m.set(r.category, r);
    return m;
  }, [results]);

  const totalSampleSize = React.useMemo(() => {
    if (!results) return 0;
    return results.reduce((sum, r) => sum + r.sampleSize, 0);
  }, [results]);

  return (
    <section
      data-testid="shadow-vs-live-delta-card"
      className="rounded-lg border border-zinc-700 bg-zinc-900/50 p-4"
    >
      <header className="mb-3">
        <h2 className="text-base font-semibold text-zinc-100">⚖️ Shadow vs Live Delta</h2>
        <p className="text-xs text-zinc-400 mt-1">
          missedAlpha = shadowReturn − liveReturn — &gt; 0 기회 손실 / &lt; 0 살아남은 효과
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

      {!loading && !error && totalSampleSize === 0 && (
        <div className="text-sm text-zinc-500" data-testid="empty-placeholder">
          데이터 0건 — ENV `SHADOW_LIVE_DELTA_REPORT_ENABLED` 활성화 또는 SHADOW 검증 필요
        </div>
      )}

      {!loading && !error && totalSampleSize > 0 && (
        <table
          className="w-full text-sm text-zinc-200 mt-2"
          data-testid="delta-table"
        >
          <thead className="text-xs text-zinc-400">
            <tr>
              <th className="text-left py-1">카테고리</th>
              <th className="text-right py-1">표본</th>
              <th className="text-right py-1">shadow Σ</th>
              <th className="text-right py-1">live Σ</th>
              <th className="text-right py-1">missedAlpha</th>
              <th className="text-right py-1">평균</th>
            </tr>
          </thead>
          <tbody>
            {ALL_DELTA_CATEGORIES.map((category) => {
              const r = byCategory.get(category);
              const sample = r?.sampleSize ?? 0;
              const alpha = r?.missedAlpha ?? 0;
              const tone = classifyMissedAlpha(alpha);
              return (
                <tr
                  key={category}
                  data-testid={`category-row-${category}`}
                  className="border-t border-zinc-800"
                >
                  <td className="py-2">{CATEGORY_LABEL[category]}</td>
                  <td className="text-right py-2">{sample}</td>
                  <td className="text-right py-2 text-zinc-400">
                    {sample > 0 ? r?.shadowReturnSum.toFixed(2) : '—'}
                  </td>
                  <td className="text-right py-2 text-zinc-400">
                    {sample > 0 ? r?.liveReturnSum.toFixed(2) : '—'}
                  </td>
                  <td className={`text-right py-2 ${sample > 0 ? tone.tone : 'text-zinc-500'}`}>
                    {sample > 0 ? `${alpha >= 0 ? '+' : ''}${alpha.toFixed(2)}` : '—'}
                  </td>
                  <td className="text-right py-2 text-zinc-400">
                    {sample > 0 ? `${r!.missedAlphaAvg >= 0 ? '+' : ''}${r!.missedAlphaAvg.toFixed(2)}` : '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}
