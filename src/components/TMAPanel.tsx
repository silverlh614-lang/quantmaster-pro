/**
 * IDEA 7: TMA — Trend Momentum Accelerometer (추세 모멘텀 가속도 측정기)
 *
 * 수익률의 2차 미분(가속도)을 추적하여 가격 변곡점을 1~2주 선행 포착.
 *
 * 물리학 원리: 포물선 운동에서 최고점 전에 이미 가속도는 0이 된다.
 * → 가격이 여전히 상승 중이어도 TMA 음수 전환 순간이 변곡점의 전조.
 *
 *   TMA = (오늘 수익률 - N일전 수익률) / N  [%/일]
 *
 *   ACCELERATING          — TMA > 0 & 상승 추세 (정상 모멘텀)
 *   DECELERATING_POSITIVE — TMA > 0 이지만 감소 추세 → ⚠️ 경계
 *   DECELERATING_NEGATIVE — TMA < 0 → 🟠 변곡 경보
 *   CRASHED               — TMA < -0.5 → 🔴 즉각 대응
 */
import React, { useState } from 'react';
import {
  LineChart, Line, ReferenceLine, XAxis, YAxis,
  ResponsiveContainer, Tooltip, CartesianGrid,
} from 'recharts';
import { Activity, ChevronDown, ChevronUp, AlertTriangle, Zap } from 'lucide-react';
import type { TMAResult } from '../types/quant';
import { cn } from '../ui/cn';

interface TMAPanelProps {
  tmaResult: TMAResult | null | undefined;
  /** 종목명 (있으면 헤더에 표시) */
  stockName?: string;
}

// ─── Phase 메타 ───────────────────────────────────────────────────────────────

type Phase = TMAResult['phase'];

function phaseMeta(phase: Phase) {
  switch (phase) {
    case 'CRASHED':
      return {
        icon: '🔴',
        label: 'CRASHED',
        labelKo: '급격 감속',
        color: 'text-red-600',
        border: 'border-red-500',
        bg: 'bg-red-50',
        bar: 'bg-red-500',
        desc: 'TMA < -0.5%/일 — 즉각 포지션 점검. 가격보다 먼저 꺾인 가속도.',
      };
    case 'DECELERATING_NEGATIVE':
      return {
        icon: '🟠',
        label: 'DECELERATING',
        labelKo: '감속 진입',
        color: 'text-orange-600',
        border: 'border-orange-400',
        bg: 'bg-orange-50',
        bar: 'bg-orange-500',
        desc: 'TMA < 0 — 변곡 경보. 가격이 아직 상승 중이어도 모멘텀 동력 소실.',
      };
    case 'DECELERATING_POSITIVE':
      return {
        icon: '⚠️',
        label: 'CAUTION',
        labelKo: '가속 멈춤',
        color: 'text-amber-600',
        border: 'border-amber-400',
        bg: 'bg-amber-50',
        bar: 'bg-amber-400',
        desc: 'TMA > 0이지만 감소 추세 — "속도는 있지만 가속 멈춤". 변곡 1~2주 전 신호.',
      };
    default: // ACCELERATING
      return {
        icon: '🚀',
        label: 'ACCELERATING',
        labelKo: '가속 중',
        color: 'text-emerald-600',
        border: 'border-emerald-400',
        bg: 'bg-emerald-50',
        bar: 'bg-emerald-500',
        desc: 'TMA > 0 & 상승 추세 — 모멘텀 건전. 추세 지속 구간.',
      };
  }
}

// ─── Gauge Bar (TMA 수치를 -2 ~ +2 범위로 시각화) ──────────────────────────

function TMAGauge({ tma }: { tma: number }) {
  // 클램프: -2 ~ +2 범위
  const clamped = Math.max(-2, Math.min(2, tma));
  // 0 기준 중앙. 양수면 오른쪽, 음수면 왼쪽
  const isPositive = clamped >= 0;
  const pct = Math.abs(clamped) / 2 * 50; // 최대 50% (게이지 절반)

  return (
    <div className="relative h-3 w-full bg-gray-100 flex items-center">
      {/* 중앙선 */}
      <div className="absolute left-1/2 top-0 bottom-0 w-px bg-gray-400" />
      {/* 채움 바 */}
      <div
        className={cn(
          'absolute h-full transition-all',
          tma < -0.5 ? 'bg-red-500' :
          tma < 0    ? 'bg-orange-400' :
          tma < 0.1  ? 'bg-amber-400' : 'bg-emerald-400',
        )}
        style={
          isPositive
            ? { left: '50%', width: `${pct}%` }
            : { right: '50%', width: `${pct}%` }
        }
      />
      {/* 라벨 */}
      <span className="absolute -bottom-4 left-0 text-[8px] text-gray-400 font-mono">-2%</span>
      <span className="absolute -bottom-4 left-1/2 -translate-x-1/2 text-[8px] text-gray-400 font-mono">0</span>
      <span className="absolute -bottom-4 right-0 text-[8px] text-gray-400 font-mono">+2%</span>
    </div>
  );
}

// ─── Sparkline Chart ─────────────────────────────────────────────────────────

function TMASparkline({ history }: { history: number[] }) {
  if (history.length < 2) {
    return (
      <div className="flex items-center justify-center h-20 text-[9px] text-theme-text-muted">
        데이터 부족 (최소 {2}일)
      </div>
    );
  }

  const data = history.map((v, i) => ({ i: i + 1, tma: +v.toFixed(4) }));

  return (
    <ResponsiveContainer width="100%" height={90}>
      <LineChart data={data} margin={{ top: 4, right: 4, left: -20, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.05)" />
        <XAxis dataKey="i" hide />
        <YAxis
          domain={['auto', 'auto']}
          tick={{ fontSize: 8, fill: '#999' }}
          tickFormatter={(v: number) => `${v > 0 ? '+' : ''}${v.toFixed(2)}`}
        />
        <Tooltip
          contentStyle={{ fontSize: 10, fontWeight: 700, padding: '4px 8px' }}
          formatter={(v: any) => [`${Number(v) > 0 ? '+' : ''}${Number(v).toFixed(3)}%/일`, 'TMA']}
          labelFormatter={(l: any) => `Day ${l}`}
        />
        {/* 0 기준선 */}
        <ReferenceLine y={0} stroke="#ef4444" strokeDasharray="4 2" strokeWidth={1.5} />
        {/* -0.5 경보선 */}
        <ReferenceLine y={-0.5} stroke="#ef4444" strokeDasharray="2 2" strokeWidth={1} opacity={0.5} />
        <Line
          type="monotone"
          dataKey="tma"
          dot={false}
          strokeWidth={2}
          stroke="#3b82f6"
          activeDot={{ r: 3 }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

// ─── Component ───────────────────────────────────────────────────────────────

export function TMAPanel({ tmaResult, stockName }: TMAPanelProps) {
  const [expanded, setExpanded] = useState(true);

  if (!tmaResult) {
    return (
      <div className="p-4 sm:p-6 border-2 border-theme-border bg-theme-card shadow-[4px_4px_0px_0px_rgba(128,128,128,0.3)]">
        <div className="flex items-center gap-2">
          <Activity className="w-3.5 h-3.5 text-theme-text-muted" />
          <h3 className="text-[10px] font-black uppercase tracking-widest text-theme-text-muted">
            TMA 추세 모멘텀 가속도 측정기
          </h3>
        </div>
        <p className="text-[9px] text-theme-text-muted mt-3">
          일봉 종가 데이터({'>'}7일)가 필요합니다.
        </p>
      </div>
    );
  }

  const meta = phaseMeta(tmaResult.phase);

  const sign = (n: number) => (n >= 0 ? '+' : '');
  const fmt = (n: number) => `${sign(n)}${n.toFixed(3)}`;

  return (
    <div className={cn(
      'border-2 bg-theme-card shadow-[4px_4px_0px_0px_rgba(128,128,128,0.3)]',
      meta.border,
    )}>
      {/* ── Header ── */}
      <div
        className="flex items-center justify-between px-4 sm:px-6 py-3 cursor-pointer select-none"
        onClick={() => setExpanded(v => !v)}
        role="button"
        aria-expanded={expanded}
      >
        <div className="flex items-center gap-2">
          <Activity className="w-3.5 h-3.5 text-theme-text-muted" />
          <h3 className="text-[10px] font-black uppercase tracking-widest text-theme-text-muted">
            TMA · 추세 모멘텀 가속도 측정기{stockName ? ` — ${stockName}` : ''}
          </h3>
        </div>
        <div className="flex items-center gap-3">
          <span className={cn(
            'text-[10px] font-black px-2 py-0.5 border',
            meta.border, meta.bg, meta.color,
          )}>
            {meta.icon} {meta.label}
          </span>
          <span className={cn('text-sm font-black font-mono', meta.color)}>
            {fmt(tmaResult.tma)}%
          </span>
          {expanded
            ? <ChevronUp className="w-3.5 h-3.5 text-theme-text-muted" />
            : <ChevronDown className="w-3.5 h-3.5 text-theme-text-muted" />}
        </div>
      </div>

      {expanded && (
        <div className="px-4 sm:px-6 pb-5 space-y-5">

          {/* ── 물리학 원리 설명 배너 ── */}
          <div className="flex items-start gap-2 px-3 py-2 bg-gray-50 border border-gray-200">
            <Zap className="w-3 h-3 mt-0.5 flex-shrink-0 text-blue-500" />
            <p className="text-[9px] text-theme-text-muted leading-relaxed">
              <span className="font-black text-theme-text">포물선 운동 원리 적용</span> —
              물체가 최고점에 도달하기 <span className="font-black">전에</span> 가속도는 이미 0이 된다.
              TMA는 가격보다 <span className="font-black">1~2주 선행</span>하는 수학적 변곡 지표.
            </p>
          </div>

          {/* ── Alert Banner ── */}
          {tmaResult.phase !== 'ACCELERATING' && (
            <div className={cn('flex items-start gap-2 px-3 py-2 border', meta.border, meta.bg)}>
              <AlertTriangle className={cn('w-3.5 h-3.5 mt-0.5 flex-shrink-0', meta.color)} />
              <div>
                <p className={cn('text-[10px] font-black', meta.color)}>
                  {meta.labelKo} 감지
                </p>
                <p className="text-[9px] text-theme-text-muted mt-0.5">{meta.desc}</p>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-[1.2fr_1fr] gap-5">
            {/* 왼쪽: 수치 + 게이지 */}
            <div className="space-y-4">
              {/* TMA 수치 */}
              <div>
                <div className="flex items-end justify-between mb-1">
                  <span className="text-[9px] font-black uppercase text-theme-text-muted tracking-widest">
                    TMA = (R₀ − R₋{tmaResult.period}) ÷ {tmaResult.period}
                  </span>
                  <span className={cn('text-2xl font-black font-mono', meta.color)}>
                    {fmt(tmaResult.tma)}
                    <span className="text-xs ml-1 font-mono font-normal text-theme-text-muted">%/일</span>
                  </span>
                </div>
                <div className="mt-4 mb-6">
                  <TMAGauge tma={tmaResult.tma} />
                </div>
              </div>

              {/* 수익률 비교 */}
              <div className="grid grid-cols-2 gap-2">
                <div className="px-3 py-2 border border-theme-border">
                  <p className="text-[8px] font-black uppercase text-theme-text-muted tracking-widest">오늘 수익률</p>
                  <p className={cn(
                    'text-lg font-black font-mono',
                    tmaResult.returnToday >= 0 ? 'text-emerald-600' : 'text-red-600',
                  )}>
                    {fmt(tmaResult.returnToday)}%
                  </p>
                </div>
                <div className="px-3 py-2 border border-theme-border">
                  <p className="text-[8px] font-black uppercase text-theme-text-muted tracking-widest">
                    {tmaResult.period}일 전 수익률
                  </p>
                  <p className={cn(
                    'text-lg font-black font-mono',
                    tmaResult.returnNAgo >= 0 ? 'text-emerald-600' : 'text-red-600',
                  )}>
                    {fmt(tmaResult.returnNAgo)}%
                  </p>
                </div>
              </div>

              {/* 단계 해설 */}
              <div className="space-y-1.5">
                {(
                  [
                    { phase: 'ACCELERATING', icon: '🚀', label: '가속 중', cond: 'TMA > 0 & 상승', desc: '모멘텀 건전' },
                    { phase: 'DECELERATING_POSITIVE', icon: '⚠️', label: '가속 멈춤', cond: 'TMA > 0 → 하락', desc: '경계 구간 진입' },
                    { phase: 'DECELERATING_NEGATIVE', icon: '🟠', label: '감속 진입', cond: 'TMA < 0', desc: '변곡 경보' },
                    { phase: 'CRASHED', icon: '🔴', label: '급격 감속', cond: 'TMA < -0.5', desc: '즉각 대응' },
                  ] as const
                ).map(row => (
                  <div
                    key={row.phase}
                    className={cn(
                      'flex items-center gap-2 px-2 py-1.5 border',
                      tmaResult.phase === row.phase
                        ? phaseMeta(row.phase).border + ' ' + phaseMeta(row.phase).bg
                        : 'border-transparent opacity-40',
                    )}
                  >
                    <span className="text-[10px]">{row.icon}</span>
                    <span className={cn(
                      'text-[9px] font-black w-16',
                      tmaResult.phase === row.phase ? phaseMeta(row.phase).color : 'text-theme-text-muted',
                    )}>
                      {row.label}
                    </span>
                    <span className="text-[8px] font-mono text-theme-text-muted">{row.cond}</span>
                    <span className="ml-auto text-[8px] text-theme-text-muted">{row.desc}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* 오른쪽: TMA 시계열 */}
            <div>
              <p className="text-[9px] font-black uppercase text-theme-text-muted tracking-widest mb-2">
                TMA 시계열 ({tmaResult.tmaHistory.length}일)
              </p>
              <TMASparkline history={tmaResult.tmaHistory} />
              <div className="flex items-center gap-3 mt-2">
                <span className="flex items-center gap-1">
                  <span className="inline-block w-6 h-px bg-red-400 border-dashed border-t-2 border-red-400" />
                  <span className="text-[8px] text-theme-text-muted">0선 (감속 임계)</span>
                </span>
                <span className="flex items-center gap-1">
                  <span className="inline-block w-4 h-px bg-red-300" style={{ opacity: 0.5 }} />
                  <span className="text-[8px] text-theme-text-muted">-0.5선 (즉각 대응)</span>
                </span>
              </div>

              {/* 선행성 인사이트 */}
              <div className="mt-4 px-3 py-2 border border-dashed border-blue-200 bg-blue-50">
                <p className="text-[9px] text-blue-700 font-bold leading-relaxed">
                  💡 가격이 최고점을 유지하는 동안 TMA가 0선을 하향 돌파하면,
                  통계적으로 <span className="font-black">1~2주 후</span> 가격 변곡이 확인된다.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
