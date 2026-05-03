// @responsibility Learning Sanity Dashboard — Safety Gate Attribution 7 GateName 결과 카드 (ADR-0178)
import * as React from 'react';
import {
  ALL_GATE_NAMES,
  type ClientGateAttributionResult,
  type ClientGateName,
} from '../../api/learningDashboardClient';

const GATE_LABEL: Record<ClientGateName, string> = {
  FOMC: 'FOMC',
  VIX: 'VIX 급등',
  R0_R1_REGIME: 'R0/R1 방어',
  LIQUIDITY: '유동성',
  DATA_SANITY: '데이터 sanity',
  EXPOSURE_BUDGET: '노출 예산',
  ENEMY_CHECKLIST: 'Enemy 체크리스트',
};

function classifyImpact(net: number): { tone: string; label: string } {
  if (net > 0) return { tone: 'text-emerald-400', label: '손실 방지' };
  if (net < 0) return { tone: 'text-rose-400', label: '과보호 가능' };
  return { tone: 'text-zinc-500', label: '중립' };
}

interface SafetyGateAttributionCardProps {
  results: ClientGateAttributionResult[] | undefined;
  loading: boolean;
  error: Error | null;
}

export function SafetyGateAttributionCard(
  props: SafetyGateAttributionCardProps,
): React.ReactElement {
  const { results, loading, error } = props;

  // Map for O(1) lookup
  const byGate = React.useMemo(() => {
    const m = new Map<ClientGateName, ClientGateAttributionResult>();
    if (results) for (const r of results) m.set(r.gate, r);
    return m;
  }, [results]);

  const totalSampleSize = React.useMemo(() => {
    if (!results) return 0;
    return results.reduce((sum, r) => sum + r.sampleSize, 0);
  }, [results]);

  return (
    <section
      data-testid="safety-gate-attribution-card"
      className="rounded-lg border border-zinc-700 bg-zinc-900/50 p-4"
    >
      <header className="mb-3">
        <h2 className="text-base font-semibold text-zinc-100">🛡️ Safety Gate Attribution</h2>
        <p className="text-xs text-zinc-400 mt-1">
          7 게이트 사후 효과 — `netGateImpact` &gt; 0 손실 방지 / &lt; 0 과보호 가능성
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
          데이터 0건 — ENV `SAFETY_GATE_ATTRIBUTION_ENABLED` 활성화 또는 SHADOW 검증 필요
        </div>
      )}

      {!loading && !error && totalSampleSize > 0 && (
        <table
          className="w-full text-sm text-zinc-200 mt-2"
          data-testid="safety-gate-table"
        >
          <thead className="text-xs text-zinc-400">
            <tr>
              <th className="text-left py-1">게이트</th>
              <th className="text-right py-1">표본</th>
              <th className="text-right py-1">avoidedLoss</th>
              <th className="text-right py-1">missedGain</th>
              <th className="text-right py-1">netImpact</th>
              <th className="text-right py-1">정밀도</th>
            </tr>
          </thead>
          <tbody>
            {ALL_GATE_NAMES.map((gate) => {
              const r = byGate.get(gate);
              const sample = r?.sampleSize ?? 0;
              const impact = r?.netGateImpact ?? 0;
              const tone = classifyImpact(impact);
              return (
                <tr
                  key={gate}
                  data-testid={`gate-row-${gate}`}
                  className="border-t border-zinc-800"
                >
                  <td className="py-2">{GATE_LABEL[gate]}</td>
                  <td className="text-right py-2">{sample}</td>
                  <td className="text-right py-2 text-zinc-400">
                    {sample > 0 ? r?.avoidedLoss.toFixed(2) : '—'}
                  </td>
                  <td className="text-right py-2 text-zinc-400">
                    {sample > 0 ? r?.missedGain.toFixed(2) : '—'}
                  </td>
                  <td className={`text-right py-2 ${sample > 0 ? tone.tone : 'text-zinc-500'}`}>
                    {sample > 0 ? `${impact >= 0 ? '+' : ''}${impact.toFixed(2)}` : '—'}
                  </td>
                  <td className="text-right py-2 text-zinc-400">
                    {sample > 0 ? `${(r!.gatePrecision * 100).toFixed(1)}%` : '—'}
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
