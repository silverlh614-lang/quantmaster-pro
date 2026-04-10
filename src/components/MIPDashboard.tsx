/**
 * IDEA 5: MIPD — Multi-dimensional Inflection Point Dashboard
 *
 * MDA 5개 차원(시간·공간·추상·인과·계층)을 0-100 점수로 신호화하여
 * 레이더 차트로 시각화. 수축 축 개수로 추세 변곡 경보를 발생.
 *
 *   수축 기준 (score < 40):
 *     0개 수축 → 정상 (넓은 오각형 유지)
 *     1개 수축 → 관찰 (한 축 꺼짐)
 *     2개 수축 → 주의 ⚠️
 *     3개+ 수축 → 즉각 비중 축소 🔴
 *
 * 프로토타입: MHS(추상) · THS(시간) · FSS(계층) 3개 축
 * 풀 버전:   + VDA(공간) · FBS(인과) 2개 추가
 */
import React, { useMemo, useState } from 'react';
import {
  RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  Radar, ResponsiveContainer, Tooltip,
} from 'recharts';
import { Activity, AlertTriangle, ChevronDown, ChevronUp } from 'lucide-react';
import type { Gate0Result, IpsResult, FssResult } from '../types/quant';
import { cn } from '../ui/cn';

// ─── Types ───────────────────────────────────────────────────────────────────

export type MipdAlertLevel = 'NORMAL' | 'WATCH' | 'CAUTION' | 'ALERT';

interface MdaAxis {
  /** MDA 차원 한국어 */
  dim: string;
  /** 레이더 라벨 */
  label: string;
  /** 0-100 점수 (낮을수록 수축) */
  score: number;
  /** 근거 설명 */
  rationale: string;
  /** 수축 여부 (score < 40) */
  contracting: boolean;
}

interface Props {
  gate0?: Gate0Result;
  ipsResult?: IpsResult | null;
  fssResult?: FssResult | null;
  /** 풀 5축 모드 (기본 false → 3축 프로토타입) */
  fullMode?: boolean;
}

// ─── Score Helpers ────────────────────────────────────────────────────────────

/** IPS 신호 ID로 triggered 여부를 꺼냄 */
function sig(ips: IpsResult | null | undefined, id: string): boolean {
  return ips?.signals.find(s => s.id === id)?.triggered ?? false;
}

/**
 * MHS 추상 차원 — gate0.macroHealthScore 직접 사용.
 * (0-100, 높을수록 건강)
 */
function scoreMHS(gate0?: Gate0Result): MdaAxis {
  const score = gate0?.macroHealthScore ?? 0;
  const level = gate0?.mhsLevel ?? 'LOW';
  return {
    dim: '추상',
    label: '추상\nMHS',
    score,
    rationale: gate0
      ? `MHS ${score}/100 · ${level === 'HIGH' ? '건전' : level === 'MEDIUM' ? '보통' : '매수 중단 구간'}`
      : 'MHS 데이터 없음',
    contracting: score < 40,
  };
}

/**
 * THS 시간 차원 — 추세 건전성.
 * THS 신호 (IPS) + TMA 신호 (IPS) 조합으로 연속 점수 산출.
 *   THS·TMA 모두 미발동 → 85
 *   TMA만 발동           → 60
 *   THS만 발동           → 40
 *   둘 다 발동           → 15
 */
function scoreTHS(gate0?: Gate0Result, ips?: IpsResult | null): MdaAxis {
  const thsTrig = sig(ips, 'THS');
  const tmaTrig = sig(ips, 'TMA');

  let score: number;
  let rationale: string;

  if (!thsTrig && !tmaTrig) {
    score = 85;
    rationale = '추세 건전 · 모멘텀 유지';
  } else if (!thsTrig && tmaTrig) {
    score = 60;
    rationale = '모멘텀 감속 감지 (OECD CLI 또는 수출 부진)';
  } else if (thsTrig && !tmaTrig) {
    score = 40;
    rationale = `MHS ${gate0?.macroHealthScore ?? '?'}/100 추세 역전${gate0?.buyingHalted ? ' · 매수 중단' : ''}`;
  } else {
    score = 15;
    rationale = '추세 역전 + 모멘텀 감속 동시 발동';
  }

  return { dim: '시간', label: '시간\nTHS', score, rationale, contracting: score < 40 };
}

/**
 * FSS 계층 차원 — 외국인 수급 계층.
 * fssResult.alertLevel → 연속 점수 변환.
 *   NORMAL  + 누적≥+5 → 85
 *   NORMAL           → 65
 *   CAUTION          → 35
 *   HIGH_ALERT       → 10
 */
function scoreFSS(fss?: FssResult | null): MdaAxis {
  if (!fss) {
    return { dim: '계층', label: '계층\nFSS', score: 50, rationale: 'FSS 데이터 없음', contracting: false };
  }

  let score: number;
  let rationale: string;

  if (fss.alertLevel === 'HIGH_ALERT') {
    score = 10;
    rationale = `수급 이탈 경보 · 누적 ${fss.cumulativeScore}pt · ${fss.consecutiveBothSellDays}일 연속 동반 매도`;
  } else if (fss.alertLevel === 'CAUTION') {
    score = 35;
    rationale = `수급 주의 · 누적 ${fss.cumulativeScore}pt`;
  } else if (fss.cumulativeScore >= 5) {
    score = 85;
    rationale = `수급 양호 · 누적 +${fss.cumulativeScore}pt`;
  } else {
    score = 65;
    rationale = `수급 정상 · 누적 ${fss.cumulativeScore}pt`;
  }

  return { dim: '계층', label: '계층\nFSS', score, rationale, contracting: score < 40 };
}

/**
 * VDA 공간 차원 — 변동성·섹터 로테이션 공간 분산.
 * VDA + SRR 신호 (IPS) 조합.
 *   미발동  → 85  발동 1개 → 45  둘 다 → 15
 */
function scoreVDA(ips?: IpsResult | null): MdaAxis {
  const vdaTrig = sig(ips, 'VDA');
  const srrTrig = sig(ips, 'SRR');
  const count = (vdaTrig ? 1 : 0) + (srrTrig ? 1 : 0);
  const score = count === 0 ? 85 : count === 1 ? 45 : 15;
  const rationale = count === 0
    ? '공포지수 정상 · 섹터 로테이션 중립'
    : `${vdaTrig ? 'VIX/VKOSPI 이탈' : ''}${vdaTrig && srrTrig ? ' + ' : ''}${srrTrig ? 'DXY 강세·KOSPI 120일선 하회' : ''}`;
  return { dim: '공간', label: '공간\nVDA', score, rationale, contracting: score < 40 };
}

/**
 * FBS 인과 차원 — 펀더멘털 인과 바이어스.
 * FBS + FSS(IPS) 신호 (IPS) 조합.
 *   미발동 → 85  1개 → 45  둘 다 → 15
 */
function scoreFBS(ips?: IpsResult | null): MdaAxis {
  const fbsTrig = sig(ips, 'FBS');
  const fssTrig = sig(ips, 'FSS');   // IPS 내 FSS (Bear Regime 조건 기반)
  const count = (fbsTrig ? 1 : 0) + (fssTrig ? 1 : 0);
  const score = count === 0 ? 85 : count === 1 ? 45 : 15;
  const rationale = count === 0
    ? '펀더멘털 인과 구조 정상'
    : `${fbsTrig ? 'FBS 2단계(Bear Regime)' : ''}${fbsTrig && fssTrig ? ' + ' : ''}${fssTrig ? 'Bear 조건 3개+ 발동' : ''}`;
  return { dim: '인과', label: '인과\nFBS', score, rationale, contracting: score < 40 };
}

// ─── Alert Meta ──────────────────────────────────────────────────────────────

function alertMeta(level: MipdAlertLevel) {
  switch (level) {
    case 'ALERT':
      return {
        icon: '🔴', label: 'ALERT', color: 'text-red-600',
        border: 'border-red-500', bg: 'bg-red-50',
        msg: '3개+ 차원 수축 — 즉각 비중 축소 권고',
      };
    case 'CAUTION':
      return {
        icon: '⚠️', label: 'CAUTION', color: 'text-amber-600',
        border: 'border-amber-400', bg: 'bg-amber-50',
        msg: '2개 차원 수축 — 신규 매수 자제, 기존 포지션 점검',
      };
    case 'WATCH':
      return {
        icon: '👁', label: 'WATCH', color: 'text-sky-600',
        border: 'border-sky-400', bg: 'bg-sky-50',
        msg: '1개 차원 이상 신호 — 모니터링 강화',
      };
    default:
      return {
        icon: '🟢', label: 'NORMAL', color: 'text-emerald-600',
        border: 'border-emerald-400', bg: 'bg-emerald-50',
        msg: '전 차원 정상 — 추세 변곡 징조 없음',
      };
  }
}

// ─── Component ───────────────────────────────────────────────────────────────

export function MIPDashboard({ gate0, ipsResult, fssResult, fullMode = false }: Props) {
  const [expanded, setExpanded] = useState(true);

  const axes = useMemo<MdaAxis[]>(() => {
    const base = [
      scoreMHS(gate0),
      scoreTHS(gate0, ipsResult),
      scoreFSS(fssResult),
    ];
    if (fullMode) {
      base.push(scoreVDA(ipsResult), scoreFBS(ipsResult));
    }
    return base;
  }, [gate0, ipsResult, fssResult, fullMode]);

  const contractingCount = axes.filter(a => a.contracting).length;

  const alertLevel: MipdAlertLevel =
    contractingCount >= 3 ? 'ALERT' :
    contractingCount >= 2 ? 'CAUTION' :
    contractingCount >= 1 ? 'WATCH' :
    'NORMAL';

  const meta = alertMeta(alertLevel);

  // 레이더가 얼마나 채워졌는지 = 평균 점수
  const avgScore = Math.round(axes.reduce((s, a) => s + a.score, 0) / axes.length);

  const radarData = axes.map(a => ({
    subject: a.label,
    score: a.score,
    fullMark: 100,
  }));

  const radarColor =
    alertLevel === 'ALERT' ? '#ef4444' :
    alertLevel === 'CAUTION' ? '#f59e0b' :
    alertLevel === 'WATCH' ? '#38bdf8' :
    '#22c55e';

  return (
    <div className={cn('border-2 bg-theme-card shadow-[4px_4px_0px_0px_rgba(128,128,128,0.3)]', meta.border)}>
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 sm:px-6 py-3 cursor-pointer select-none"
        onClick={() => setExpanded(v => !v)}
        role="button"
        aria-expanded={expanded}
      >
        <div className="flex items-center gap-2">
          <Activity className="w-3.5 h-3.5 text-theme-text-muted" />
          <h3 className="text-[10px] font-black uppercase tracking-widest text-theme-text-muted">
            MIPD · 다차원 변곡점 예측 대시보드
          </h3>
          {!fullMode && (
            <span className="text-[8px] font-bold px-1.5 py-0.5 border border-sky-300 text-sky-600 bg-sky-50">
              3축 프로토타입
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <span className={cn('text-[10px] font-black px-2 py-0.5 border', meta.border, meta.bg, meta.color)}>
            {meta.icon} {meta.label}
          </span>
          <span className="text-xs font-mono text-theme-text-muted">{avgScore}/100</span>
          {expanded
            ? <ChevronUp className="w-3.5 h-3.5 text-theme-text-muted" />
            : <ChevronDown className="w-3.5 h-3.5 text-theme-text-muted" />}
        </div>
      </div>

      {expanded && (
        <div className="px-4 sm:px-6 pb-5 space-y-4">
          {/* Alert Banner */}
          {alertLevel !== 'NORMAL' && (
            <div className={cn('flex items-start gap-2 px-3 py-2 border', meta.border, meta.bg)}>
              <AlertTriangle className={cn('w-3.5 h-3.5 mt-0.5 flex-shrink-0', meta.color)} />
              <div>
                <p className={cn('text-[10px] font-black', meta.color)}>
                  수축 차원 {contractingCount}개 감지 — {meta.msg}
                </p>
              </div>
            </div>
          )}

          {/* Radar + Detail */}
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_1.1fr] gap-6">
            {/* Radar */}
            <div>
              <p className="text-[9px] font-bold text-theme-text-muted mb-1 text-center">
                면적 수축 방향 → 변곡 경보 (점수 &lt; 40 = 수축)
              </p>
              <ResponsiveContainer width="100%" height={300}>
                <RadarChart cx="50%" cy="50%" outerRadius="72%" data={radarData}>
                  <PolarGrid stroke="rgba(0,0,0,0.08)" />
                  <PolarAngleAxis
                    dataKey="subject"
                    tick={{ fill: '#555', fontSize: 9, fontWeight: 700 }}
                  />
                  <PolarRadiusAxis angle={90} domain={[0, 100]} tick={false} axisLine={false} />
                  {/* 기준선: 40pt (수축 임계) */}
                  <PolarRadiusAxis
                    angle={90}
                    domain={[0, 100]}
                    tick={false}
                    axisLine={false}
                    stroke="rgba(239,68,68,0.3)"
                  />
                  <Radar
                    name="MIPD"
                    dataKey="score"
                    stroke={radarColor}
                    fill={radarColor}
                    fillOpacity={0.2}
                    strokeWidth={2.5}
                    dot={{ r: 4, fill: radarColor, strokeWidth: 0 }}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#fff',
                      border: '1px solid #e5e7eb',
                      fontSize: 11,
                      fontWeight: 700,
                    }}
                    formatter={(value: any) => [`${value}/100`, 'Score']}
                  />
                </RadarChart>
              </ResponsiveContainer>
            </div>

            {/* Axis Detail */}
            <div className="flex flex-col justify-center space-y-2">
              {axes.map(a => (
                <div
                  key={a.dim}
                  className={cn(
                    'flex items-start gap-3 px-3 py-2 border',
                    a.contracting
                      ? 'border-red-300 bg-red-50'
                      : 'border-theme-border bg-theme-card',
                  )}
                >
                  <div className="flex-shrink-0 w-10 text-center">
                    <div className={cn(
                      'text-[8px] font-black uppercase',
                      a.contracting ? 'text-red-600' : 'text-theme-text-muted',
                    )}>
                      {a.dim}
                    </div>
                    <div className={cn(
                      'text-lg font-black leading-none',
                      a.contracting ? 'text-red-600' : 'text-theme-text',
                    )}>
                      {a.score}
                    </div>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1 mb-1">
                      <div className="flex-1 h-1.5 bg-gray-100">
                        <div
                          className={cn(
                            'h-full transition-all',
                            a.contracting ? 'bg-red-400' : a.score >= 70 ? 'bg-emerald-400' : 'bg-amber-400',
                          )}
                          style={{ width: `${a.score}%` }}
                        />
                      </div>
                      {a.contracting && (
                        <span className="text-[8px] font-black text-red-600 flex-shrink-0">수축</span>
                      )}
                    </div>
                    <p className="text-[9px] text-theme-text-muted leading-tight">{a.rationale}</p>
                  </div>
                </div>
              ))}

              {/* Summary */}
              <div className={cn('mt-2 px-3 py-2 border-2 text-center', meta.border, meta.bg)}>
                <p className={cn('text-[10px] font-black', meta.color)}>
                  {meta.icon} {contractingCount}/{axes.length} 차원 수축 — {meta.msg}
                </p>
              </div>
            </div>
          </div>

          {/* Legend */}
          <div className="flex flex-wrap gap-3 pt-1 border-t border-theme-border">
            <span className="text-[8px] text-theme-text-muted font-mono">
              수축 기준 &lt; 40pt
            </span>
            {[
              { icon: '🟢', label: 'NORMAL — 0개 수축' },
              { icon: '👁', label: 'WATCH — 1개' },
              { icon: '⚠️', label: 'CAUTION — 2개' },
              { icon: '🔴', label: 'ALERT — 3개+' },
            ].map(l => (
              <span key={l.label} className="text-[8px] text-theme-text-muted">
                {l.icon} {l.label}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
