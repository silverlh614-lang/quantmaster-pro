// @responsibility signals 영역 ConditionLearningPanel 컴포넌트
/**
 * ConditionLearningPanel.tsx — 아이디어 11 (Phase 5): 조건 학습 상태 대시보드.
 *
 * GET /api/system/learning/condition-state 응답을 기반으로 표시:
 *   ① 27 조건별 가중치 / boost / 감사 상태 (ACTIVE/PROBATION/SUSPENDED 색상)
 *   ② 레짐별 위험 캡 (Phase Map)
 *   ③ Shadow vs Real 드리프트 계수
 *   ④ 실험 조건(Gemini 제안) 현황
 *   ⑤ 시너지 bestPartners/worstPartners
 *
 * SYSTEMATIC ALPHA HUNTER 원칙 "뉴스보다 데이터" — 학습 결과를 시각적으로 확인.
 */
import React, { useEffect, useState } from 'react';
import { RefreshCw, Activity, AlertTriangle, CheckCircle2, TrendingDown, Sparkles } from 'lucide-react';
import { cn } from '../../ui/cn';

interface ConditionView {
  conditionId: number;
  conditionName: string;
  serverKey: string | null;
  weight: number | null;
  promptBoost: number | null;
  auditStatus: string;
  winRate: number;
  sharpe: number;
  totalTrades: number;
  recentTrend: 'IMPROVING' | 'STABLE' | 'DECLINING';
  byRegime: Record<string, { winRate: number; avgReturn: number; count: number }>;
  bestPartners: number[];
  worstPartners: number[];
  recommendation: string;
  dangerRegimes: string[];
}

interface DriftView {
  shadowAvgReturn: number;
  liveAvgReturn: number;
  driftPct: number;
  targetBoost: number;
  stopBoost: number;
  shadowCount: number;
  liveCount: number;
  updatedAt: string;
}

interface ExperimentalView {
  id: string;
  name: string;
  dataSource: string;
  status: string;
  rationale: string;
  backtestResult?: { lift: number; precision: number; sampleSize: number };
  proposedAt: string;
}

interface ConditionStateResponse {
  conditions: ConditionView[];
  conditionNames: Record<number, string>;
  drift: DriftView;
  weightHistory: Array<{ timestamp: string; source: string; weights: Record<string, number> }>;
  experimentalConditions: ExperimentalView[];
  phaseMap: {
    updatedAt: string;
    dangerMatrix: Array<{
      conditionId: number;
      conditionName: string;
      dangerRegimes: string[];
      regimeWinRates: Record<string, { winRate: number; count: number }>;
    }>;
  };
  timestamp: string;
}

function auditBadge(status: string): { label: string; cls: string } {
  switch (status) {
    case 'SUSPENDED':
      return { label: 'SUSPENDED', cls: 'bg-red-500/20 text-red-300 border-red-500/40' };
    case 'PROBATION':
      return { label: 'PROBATION', cls: 'bg-amber-500/20 text-amber-300 border-amber-500/40' };
    case 'CLIENT_SOFT':
      return { label: 'SOFT', cls: 'bg-blue-500/20 text-blue-300 border-blue-500/40' };
    default:
      return { label: 'ACTIVE', cls: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40' };
  }
}

function trendIcon(trend: string): React.ReactNode {
  if (trend === 'IMPROVING') return <span className="text-emerald-400">↑</span>;
  if (trend === 'DECLINING') return <span className="text-red-400">↓</span>;
  return <span className="text-gray-400">—</span>;
}

function recommendationBadge(rec: string): { label: string; cls: string } {
  switch (rec) {
    case 'INCREASE_WEIGHT':
      return { label: '↑↑', cls: 'bg-emerald-500/20 text-emerald-300' };
    case 'DECREASE_WEIGHT':
      return { label: '↓', cls: 'bg-amber-500/20 text-amber-300' };
    case 'SUSPEND':
      return { label: '✕', cls: 'bg-red-500/20 text-red-300' };
    default:
      return { label: '=', cls: 'bg-gray-500/20 text-gray-300' };
  }
}

export function ConditionLearningPanel(): React.ReactElement {
  const [data, setData] = useState<ConditionStateResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState<'conditions' | 'phase' | 'drift' | 'experimental'>('conditions');

  async function fetchData(): Promise<void> {
    try {
      setLoading(true);
      const res = await fetch('/api/system/learning/condition-state');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json() as ConditionStateResponse;
      setData(json);
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchData();
    const id = setInterval(fetchData, 120_000); // 2분마다 재조회
    return () => clearInterval(id);
  }, []);

  if (loading && !data) {
    return (
      <div className="bg-gray-900 border border-gray-700 rounded-lg p-4 text-gray-400 text-sm flex items-center gap-2">
        <RefreshCw className="w-4 h-4 animate-spin" /> 조건 학습 상태 로드 중…
      </div>
    );
  }

  if (err && !data) {
    return (
      <div className="bg-red-900/20 border border-red-700 rounded-lg p-4 text-red-300 text-sm flex items-center gap-2">
        <AlertTriangle className="w-4 h-4" /> 학습 상태 API 오류: {err}
      </div>
    );
  }

  if (!data) return <></>;

  const conditions = [...data.conditions].sort((a, b) => b.totalTrades - a.totalTrades);
  const synergyPairs = conditions.flatMap((c) =>
    c.bestPartners.map((pId) => ({ a: c.conditionId, b: pId, aName: c.conditionName, bName: data.conditionNames[pId] ?? `조건${pId}` })),
  ).slice(0, 10);

  return (
    <div className="bg-gray-900 border border-gray-700 rounded-lg p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-white font-bold flex items-center gap-2">
          <Activity className="w-4 h-4 text-cyan-400" />
          조건 학습 대시보드
        </h3>
        <button
          onClick={fetchData}
          className="text-xs text-gray-400 hover:text-white flex items-center gap-1"
          disabled={loading}
        >
          <RefreshCw className={cn('w-3 h-3', loading && 'animate-spin')} /> 갱신
        </button>
      </div>

      {/* 탭 */}
      <div className="flex gap-1 text-xs">
        {([
          ['conditions', '조건 27개'],
          ['phase', '위상 맵'],
          ['drift', 'Shadow↔Real'],
          ['experimental', '실험 조건'],
        ] as Array<[typeof tab, string]>).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={cn(
              'px-3 py-1 rounded border',
              tab === k
                ? 'bg-cyan-500/20 border-cyan-500/40 text-cyan-300'
                : 'bg-gray-800 border-gray-700 text-gray-400 hover:text-white',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {/* 탭: 조건 목록 */}
      {tab === 'conditions' && (
        <div className="space-y-1">
          <div className="grid grid-cols-12 gap-2 text-[10px] text-gray-500 px-2 pb-1 border-b border-gray-800">
            <div className="col-span-4">조건</div>
            <div className="col-span-1 text-right">거래</div>
            <div className="col-span-1 text-right">WR</div>
            <div className="col-span-1 text-right">Sharpe</div>
            <div className="col-span-1 text-center">추세</div>
            <div className="col-span-1 text-right">가중치</div>
            <div className="col-span-2 text-center">상태</div>
            <div className="col-span-1 text-center">권고</div>
          </div>
          {conditions.map((c) => {
            const ab = auditBadge(c.auditStatus);
            const rb = recommendationBadge(c.recommendation);
            const w = c.weight ?? c.promptBoost ?? 1.0;
            const wColor = w > 1.15 ? 'text-emerald-300' : w < 0.85 ? 'text-red-300' : 'text-gray-200';
            return (
              <div key={c.conditionId} className="grid grid-cols-12 gap-2 text-xs text-gray-300 px-2 py-1 hover:bg-gray-800/50 rounded">
                <div className="col-span-4 truncate">
                  <span className="text-gray-500 mr-1">#{c.conditionId}</span>
                  {c.conditionName}
                  {c.dangerRegimes.length > 0 && (
                    <span className="ml-1 text-[9px] text-red-400">
                      🔒{c.dangerRegimes.length}
                    </span>
                  )}
                </div>
                <div className="col-span-1 text-right font-mono">{c.totalTrades}</div>
                <div className="col-span-1 text-right font-mono">{(c.winRate * 100).toFixed(0)}%</div>
                <div className="col-span-1 text-right font-mono">{c.sharpe.toFixed(2)}</div>
                <div className="col-span-1 text-center">{trendIcon(c.recentTrend)}</div>
                <div className={cn('col-span-1 text-right font-mono font-bold', wColor)}>
                  {w.toFixed(2)}
                  {c.serverKey == null && <span className="text-[9px] text-blue-400 ml-0.5">b</span>}
                </div>
                <div className="col-span-2 text-center">
                  <span className={cn('text-[9px] px-1.5 py-0.5 rounded border font-bold', ab.cls)}>
                    {ab.label}
                  </span>
                </div>
                <div className={cn('col-span-1 text-center text-xs font-black', rb.cls, 'rounded')}>
                  {rb.label}
                </div>
              </div>
            );
          })}
          {synergyPairs.length > 0 && (
            <div className="mt-3 p-2 bg-gray-800/50 rounded border border-gray-700">
              <div className="text-[10px] text-gray-500 mb-1 flex items-center gap-1">
                <Sparkles className="w-3 h-3 text-purple-400" /> 시너지 파트너 TOP
              </div>
              <div className="flex flex-wrap gap-1 text-[10px]">
                {synergyPairs.map((p, i) => (
                  <span key={i} className="px-2 py-0.5 bg-purple-500/10 border border-purple-500/30 rounded text-purple-200">
                    #{p.a}↔#{p.b}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* 탭: 위상 맵 */}
      {tab === 'phase' && (
        <div className="space-y-2">
          <div className="text-[10px] text-gray-500">
            마지막 갱신: {data.phaseMap.updatedAt ? new Date(data.phaseMap.updatedAt).toLocaleString() : '—'}
          </div>
          {data.phaseMap.dangerMatrix.length === 0 && (
            <div className="text-xs text-gray-400">위상 맵 데이터 없음</div>
          )}
          {data.phaseMap.dangerMatrix
            .filter((e) => Object.keys(e.regimeWinRates).length > 0)
            .slice(0, 15)
            .map((e) => (
              <div key={e.conditionId} className="text-xs border-b border-gray-800 pb-2">
                <div className="text-gray-300 font-bold mb-1">
                  #{e.conditionId} {e.conditionName}
                  {e.dangerRegimes.length > 0 && (
                    <span className="ml-2 text-red-400 text-[10px]">
                      🔒 위험: {e.dangerRegimes.join(', ')}
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(e.regimeWinRates).map(([regime, rw]) => {
                    const isDanger = e.dangerRegimes.includes(regime);
                    const wr = rw.winRate * 100;
                    const color = isDanger ? 'bg-red-500/20 border-red-500/40 text-red-300'
                      : wr >= 60 ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300'
                      : 'bg-gray-800 border-gray-700 text-gray-400';
                    return (
                      <span key={regime} className={cn('text-[10px] px-2 py-0.5 rounded border font-mono', color)}>
                        {regime}: {wr.toFixed(0)}% ({rw.count})
                      </span>
                    );
                  })}
                </div>
              </div>
            ))}
        </div>
      )}

      {/* 탭: 드리프트 */}
      {tab === 'drift' && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div className="bg-gray-800 p-3 rounded">
              <div className="text-gray-500 text-[10px]">SHADOW 평균 ({data.drift.shadowCount}건)</div>
              <div className="text-lg font-mono font-bold text-gray-200">{data.drift.shadowAvgReturn}%</div>
            </div>
            <div className="bg-gray-800 p-3 rounded">
              <div className="text-gray-500 text-[10px]">LIVE 평균 ({data.drift.liveCount}건)</div>
              <div className="text-lg font-mono font-bold text-gray-200">{data.drift.liveAvgReturn}%</div>
            </div>
          </div>
          <div className={cn(
            'p-3 rounded border',
            Math.abs(data.drift.driftPct) >= 2
              ? 'bg-amber-500/10 border-amber-500/40 text-amber-300'
              : 'bg-gray-800 border-gray-700 text-gray-300',
          )}>
            <div className="flex items-center justify-between">
              <div>
                <div className="text-[10px] opacity-70">드리프트 (LIVE − SHADOW)</div>
                <div className="text-lg font-mono font-bold">
                  {data.drift.driftPct >= 0 ? '+' : ''}{data.drift.driftPct}%p
                </div>
              </div>
              <TrendingDown className="w-6 h-6" />
            </div>
            <div className="mt-2 text-[11px] flex gap-4">
              <span>target × <span className="font-mono font-bold">{data.drift.targetBoost}</span></span>
              <span>stop × <span className="font-mono font-bold">{data.drift.stopBoost}</span></span>
            </div>
          </div>
          <div className="text-[10px] text-gray-500">
            마지막 갱신: {data.drift.updatedAt ? new Date(data.drift.updatedAt).toLocaleString() : '—'}
          </div>
        </div>
      )}

      {/* 탭: 실험 조건 */}
      {tab === 'experimental' && (
        <div className="space-y-2">
          {data.experimentalConditions.length === 0 && (
            <div className="text-xs text-gray-400">Gemini 제안 조건 없음 — L4 월간 사이클에서 등록됨</div>
          )}
          {data.experimentalConditions.map((exp) => {
            const isPassed = exp.status === 'BACKTESTED_PASSED';
            const isFailed = exp.status === 'BACKTESTED_FAILED';
            const cls = isPassed ? 'bg-emerald-500/10 border-emerald-500/40'
              : isFailed ? 'bg-red-500/10 border-red-500/30'
              : exp.status === 'ACTIVE' ? 'bg-cyan-500/10 border-cyan-500/40'
              : 'bg-gray-800 border-gray-700';
            return (
              <div key={exp.id} className={cn('p-2 rounded border text-xs', cls)}>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="text-gray-200 font-bold">{exp.name}</div>
                    <div className="text-[10px] text-gray-500 mt-0.5">
                      {exp.dataSource} · {new Date(exp.proposedAt).toLocaleDateString()}
                    </div>
                    <div className="text-[11px] text-gray-400 mt-1">{exp.rationale}</div>
                  </div>
                  <div className="text-right shrink-0">
                    <span className="text-[10px] font-black uppercase">{exp.status}</span>
                    {exp.backtestResult && (
                      <div className="text-[10px] font-mono text-gray-400 mt-1">
                        lift {exp.backtestResult.lift.toFixed(2)} · n={exp.backtestResult.sampleSize}
                        {isPassed && <CheckCircle2 className="inline w-3 h-3 ml-1 text-emerald-400" />}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default ConditionLearningPanel;
