/**
 * IDEA 8: SRR — Sector Relative Strength Reversal
 *         섹터 내 상대강도 역전 감지
 *
 * RS Ratio = 종목 20일 수익률 / 섹터ETF 20일 수익률
 *
 * 사이클 후반 조기 감지 원리:
 *   주도 섹터가 살아있어도 내 종목만 뒤처지기 시작하면
 *   그 종목이 사이클 후반부에 진입했다는 신호다.
 *
 * 경보 체계:
 *   NORMAL   — RS Ratio ≥ 1.0 (섹터 대비 아웃퍼폼)
 *   WATCH    — RS Ratio < 1.0 시작 or 순위 이탈 임박
 *   WARNING  — RS Ratio < 1.0  3주 연속 (주도주 지위 상실)
 *   CRITICAL — RS Ratio < 0.8  5주 연속 (즉각 교체 검토)
 *
 * Gate 3 연동: 매수 시 상위 5% → 상위 20% 이탈 시 자동 경보
 */
import React, { useState } from 'react';
import {
  BarChart, Bar, Cell, ReferenceLine,
  XAxis, YAxis, ResponsiveContainer, Tooltip, CartesianGrid,
} from 'recharts';
import { TrendingDown, ChevronDown, ChevronUp, AlertTriangle, BarChart3 } from 'lucide-react';
import type { SRRResult } from '../types/quant';
import { cn } from '../ui/cn';

interface SRRPanelProps {
  srrResult: SRRResult | null | undefined;
  stockName?: string;
}

// ─── Alert 메타 ───────────────────────────────────────────────────────────────

function alertMeta(alert: SRRResult['alert']) {
  switch (alert) {
    case 'CRITICAL':
      return {
        icon: '🔴', label: 'CRITICAL', labelKo: '즉각 교체 검토',
        color: 'text-red-600', border: 'border-red-500', bg: 'bg-red-50',
      };
    case 'WARNING':
      return {
        icon: '⚠️', label: 'WARNING', labelKo: '주도주 지위 상실',
        color: 'text-amber-600', border: 'border-amber-400', bg: 'bg-amber-50',
      };
    case 'WATCH':
      return {
        icon: '👁', label: 'WATCH', labelKo: '상대강도 약화 주시',
        color: 'text-sky-600', border: 'border-sky-400', bg: 'bg-sky-50',
      };
    default:
      return {
        icon: '🟢', label: 'NORMAL', labelKo: '주도주 지위 유지',
        color: 'text-emerald-600', border: 'border-emerald-400', bg: 'bg-emerald-50',
      };
  }
}

// ─── RS Ratio 히스토리 바 차트 ────────────────────────────────────────────────

function RSRatioChart({ ratios }: { ratios: number[] }) {
  if (ratios.length < 2) {
    return (
      <div className="flex items-center justify-center h-20 text-[9px] text-theme-text-muted">
        RS Ratio 이력 부족 (최소 2주)
      </div>
    );
  }

  const data = ratios.map((v, i) => ({
    week: `W-${ratios.length - 1 - i}`,
    ratio: +v.toFixed(3),
    fill: v >= 1.0 ? '#22c55e' : v >= 0.8 ? '#f59e0b' : '#ef4444',
  }));

  return (
    <ResponsiveContainer width="100%" height={100}>
      <BarChart data={data} margin={{ top: 4, right: 4, left: -22, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.05)" />
        <XAxis dataKey="week" tick={{ fontSize: 8, fill: '#999' }} />
        <YAxis
          domain={[0, 'auto']}
          tick={{ fontSize: 8, fill: '#999' }}
          tickFormatter={(v: number) => v.toFixed(1)}
        />
        <Tooltip
          contentStyle={{ fontSize: 10, fontWeight: 700, padding: '4px 8px' }}
          formatter={(v: any) => [Number(v).toFixed(3), 'RS Ratio']}
        />
        {/* 1.0 기준선 */}
        <ReferenceLine y={1.0} stroke="#3b82f6" strokeDasharray="4 2" strokeWidth={1.5} label={{ value: '1.0', position: 'right', fontSize: 8, fill: '#3b82f6' }} />
        {/* 0.8 경보선 */}
        <ReferenceLine y={0.8} stroke="#ef4444" strokeDasharray="2 2" strokeWidth={1} label={{ value: '0.8', position: 'right', fontSize: 8, fill: '#ef4444' }} />
        <Bar dataKey="ratio" radius={[2, 2, 0, 0]}>
          {data.map((entry, index) => (
            <Cell key={`cell-${index}`} fill={entry.fill} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

// ─── RS 순위 이동 게이지 ──────────────────────────────────────────────────────

function RankGauge({ entry, current }: { entry: number; current: number }) {
  // 0 = 최상위, 100 = 최하위
  // 바는 낮을수록(왼쪽) 좋음
  const entryPct = Math.min(100, Math.max(0, entry));
  const currentPct = Math.min(100, Math.max(0, current));
  const drifted = current > entry;

  return (
    <div className="relative h-4 w-full bg-gray-100">
      {/* 진입 시점 마커 */}
      <div
        className="absolute top-0 bottom-0 w-0.5 bg-blue-500"
        style={{ left: `${entryPct}%` }}
        title={`매수 시점: 상위 ${entry.toFixed(1)}%`}
      />
      {/* 현재 마커 */}
      <div
        className={cn(
          'absolute top-0 bottom-0 w-1',
          drifted ? 'bg-red-500' : 'bg-emerald-500',
        )}
        style={{ left: `${currentPct}%` }}
        title={`현재: 상위 ${current.toFixed(1)}%`}
      />
      {/* 이동 화살표 영역 */}
      {Math.abs(currentPct - entryPct) > 2 && (
        <div
          className={cn('absolute top-0 bottom-0 opacity-20', drifted ? 'bg-red-400' : 'bg-emerald-400')}
          style={
            drifted
              ? { left: `${entryPct}%`, width: `${currentPct - entryPct}%` }
              : { left: `${currentPct}%`, width: `${entryPct - currentPct}%` }
          }
        />
      )}
      {/* 5% / 20% 기준선 */}
      <div className="absolute top-0 bottom-0 w-px bg-gray-400 opacity-50" style={{ left: '5%' }} />
      <div className="absolute top-0 bottom-0 w-px bg-gray-300 opacity-50" style={{ left: '20%' }} />
      <span className="absolute -bottom-4 left-[5%] -translate-x-1/2 text-[7px] text-gray-400">5%</span>
      <span className="absolute -bottom-4 left-[20%] -translate-x-1/2 text-[7px] text-gray-400">20%</span>
      <span className="absolute -bottom-4 right-0 text-[7px] text-gray-400">100%</span>
    </div>
  );
}

// ─── Component ───────────────────────────────────────────────────────────────

export function SRRPanel({ srrResult, stockName }: SRRPanelProps) {
  const [expanded, setExpanded] = useState(true);

  if (!srrResult) {
    return (
      <div className="p-4 sm:p-6 border-2 border-theme-border bg-theme-card shadow-[4px_4px_0px_0px_rgba(128,128,128,0.3)]">
        <div className="flex items-center gap-2">
          <BarChart3 className="w-3.5 h-3.5 text-theme-text-muted" />
          <h3 className="text-[10px] font-black uppercase tracking-widest text-theme-text-muted">
            SRR 섹터 내 상대강도 역전 감지
          </h3>
        </div>
        <p className="text-[9px] text-theme-text-muted mt-3">
          20일 수익률 데이터(종목·섹터ETF)가 필요합니다.
        </p>
      </div>
    );
  }

  const meta = alertMeta(srrResult.alert);
  const fmt1 = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`;
  const fmtRatio = (n: number) => n.toFixed(3);

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
          <BarChart3 className="w-3.5 h-3.5 text-theme-text-muted" />
          <h3 className="text-[10px] font-black uppercase tracking-widest text-theme-text-muted">
            SRR · 섹터 내 상대강도 역전 감지{stockName ? ` — ${stockName}` : ''}
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
            RS {fmtRatio(srrResult.rsRatio)}
          </span>
          {expanded
            ? <ChevronUp className="w-3.5 h-3.5 text-theme-text-muted" />
            : <ChevronDown className="w-3.5 h-3.5 text-theme-text-muted" />}
        </div>
      </div>

      {expanded && (
        <div className="px-4 sm:px-6 pb-5 space-y-5">

          {/* ── 개념 설명 ── */}
          <div className="flex items-start gap-2 px-3 py-2 bg-gray-50 border border-gray-200">
            <TrendingDown className="w-3 h-3 mt-0.5 flex-shrink-0 text-orange-500" />
            <p className="text-[9px] text-theme-text-muted leading-relaxed">
              <span className="font-black text-theme-text">사이클 후반 조기 탈출 원리</span> —
              주도 섹터가 살아있어도 내 종목만 뒤처지기 시작하면 사이클 후반 진입 신호.
              RS Ratio = 종목 20일 수익률 ÷ 섹터ETF 20일 수익률.
            </p>
          </div>

          {/* ── Alert Banner ── */}
          {srrResult.alert !== 'NORMAL' && (
            <div className={cn('flex items-start gap-2 px-3 py-2 border', meta.border, meta.bg)}>
              <AlertTriangle className={cn('w-3.5 h-3.5 mt-0.5 flex-shrink-0', meta.color)} />
              <div>
                <p className={cn('text-[10px] font-black', meta.color)}>
                  {meta.labelKo}
                </p>
                <p className="text-[9px] text-theme-text-muted mt-0.5">{srrResult.actionMessage}</p>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-[1.1fr_1fr] gap-5">
            {/* 왼쪽 */}
            <div className="space-y-4">
              {/* RS Ratio 수치 */}
              <div className="grid grid-cols-3 gap-2">
                <div className="col-span-1 px-3 py-3 border border-theme-border text-center">
                  <p className="text-[8px] font-black uppercase text-theme-text-muted tracking-widest">RS Ratio</p>
                  <p className={cn('text-2xl font-black font-mono', meta.color)}>
                    {fmtRatio(srrResult.rsRatio)}
                  </p>
                  <p className="text-[7px] text-theme-text-muted mt-0.5">종목 ÷ 섹터</p>
                </div>
                <div className="px-3 py-3 border border-theme-border text-center">
                  <p className="text-[8px] font-black uppercase text-theme-text-muted">종목 20일</p>
                  <p className={cn(
                    'text-lg font-black font-mono',
                    srrResult.stockReturn20d >= 0 ? 'text-emerald-600' : 'text-red-600',
                  )}>
                    {fmt1(srrResult.stockReturn20d)}
                  </p>
                </div>
                <div className="px-3 py-3 border border-theme-border text-center">
                  <p className="text-[8px] font-black uppercase text-theme-text-muted">섹터 20일</p>
                  <p className={cn(
                    'text-lg font-black font-mono',
                    srrResult.sectorReturn20d >= 0 ? 'text-emerald-600' : 'text-red-600',
                  )}>
                    {fmt1(srrResult.sectorReturn20d)}
                  </p>
                </div>
              </div>

              {/* 연속 위반 카운터 */}
              <div className="space-y-2">
                {/* RS < 1.0 위반 */}
                <div className={cn(
                  'flex items-center justify-between px-3 py-2 border',
                  srrResult.consecutiveBelowOne >= 3
                    ? 'border-amber-400 bg-amber-50'
                    : 'border-theme-border',
                )}>
                  <div>
                    <p className="text-[9px] font-black text-theme-text">RS Ratio &lt; 1.0 연속 주수</p>
                    <p className="text-[8px] text-theme-text-muted">3주 이상 → 주도주 지위 상실 경보</p>
                  </div>
                  <div className="text-right">
                    <span className={cn(
                      'text-xl font-black font-mono',
                      srrResult.consecutiveBelowOne >= 3 ? 'text-amber-600'
                        : srrResult.consecutiveBelowOne >= 1 ? 'text-sky-600'
                        : 'text-emerald-600',
                    )}>
                      {srrResult.consecutiveBelowOne}
                    </span>
                    <span className="text-[9px] text-theme-text-muted ml-1">주</span>
                    {srrResult.leadingStockLost && (
                      <span className="block text-[8px] font-black text-amber-600">⚠️ 경보</span>
                    )}
                  </div>
                </div>

                {/* RS < 0.8 위반 */}
                <div className={cn(
                  'flex items-center justify-between px-3 py-2 border',
                  srrResult.consecutiveBelowEight >= 5
                    ? 'border-red-500 bg-red-50'
                    : 'border-theme-border',
                )}>
                  <div>
                    <p className="text-[9px] font-black text-theme-text">RS Ratio &lt; 0.8 연속 주수</p>
                    <p className="text-[8px] text-theme-text-muted">5주 이상 → 즉각 교체 매매 검토</p>
                  </div>
                  <div className="text-right">
                    <span className={cn(
                      'text-xl font-black font-mono',
                      srrResult.consecutiveBelowEight >= 5 ? 'text-red-600'
                        : srrResult.consecutiveBelowEight >= 2 ? 'text-amber-600'
                        : 'text-emerald-600',
                    )}>
                      {srrResult.consecutiveBelowEight}
                    </span>
                    <span className="text-[9px] text-theme-text-muted ml-1">주</span>
                    {srrResult.replaceSignal && (
                      <span className="block text-[8px] font-black text-red-600">🔴 교체</span>
                    )}
                  </div>
                </div>
              </div>

              {/* Gate 3 연동: RS 순위 이탈 */}
              <div className={cn(
                'px-3 py-3 border',
                srrResult.rankBandBreached ? 'border-orange-400 bg-orange-50' : 'border-theme-border',
              )}>
                <div className="flex items-center justify-between mb-3">
                  <p className="text-[9px] font-black text-theme-text">Gate 3 RS 순위 추적</p>
                  {srrResult.rankBandBreached && (
                    <span className="text-[8px] font-black text-orange-600 px-1.5 py-0.5 border border-orange-400 bg-orange-50">
                      상위 20% 이탈
                    </span>
                  )}
                </div>
                <div className="mb-5">
                  <RankGauge
                    entry={srrResult.entryRsRank}
                    current={srrResult.currentRsRank}
                  />
                </div>
                <div className="flex justify-between mt-1">
                  <div className="flex items-center gap-1">
                    <div className="w-2 h-2 bg-blue-500" />
                    <span className="text-[8px] text-theme-text-muted">
                      매수 상위 {srrResult.entryRsRank.toFixed(1)}%
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    <div className={cn(
                      'w-2 h-2',
                      srrResult.rankDrift > 0 ? 'bg-red-500' : 'bg-emerald-500',
                    )} />
                    <span className={cn(
                      'text-[8px] font-bold',
                      srrResult.rankDrift > 0 ? 'text-red-600' : 'text-emerald-600',
                    )}>
                      현재 상위 {srrResult.currentRsRank.toFixed(1)}%
                      {srrResult.rankDrift !== 0 && (
                        <span className="ml-1">
                          ({srrResult.rankDrift > 0 ? '+' : ''}{srrResult.rankDrift.toFixed(1)}%p)
                        </span>
                      )}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* 오른쪽: RS Ratio 이력 차트 */}
            <div>
              <p className="text-[9px] font-black uppercase text-theme-text-muted tracking-widest mb-2">
                RS Ratio 주간 이력
              </p>
              <RSRatioChart ratios={srrResult.weeklyRsRatios} />

              <div className="flex flex-col gap-1 mt-3">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-1 bg-blue-500" style={{ borderTop: '2px dashed #3b82f6' }} />
                  <span className="text-[8px] text-theme-text-muted">1.0선 — 아웃퍼폼/언더퍼폼 기준</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-3 h-px bg-red-500" />
                  <span className="text-[8px] text-theme-text-muted">0.8선 — 5주 지속 시 교체 검토</span>
                </div>
                <div className="flex items-center gap-3 mt-1">
                  <span className="flex items-center gap-1"><span className="w-2 h-2 bg-emerald-500 inline-block" /><span className="text-[8px] text-theme-text-muted">RS≥1.0</span></span>
                  <span className="flex items-center gap-1"><span className="w-2 h-2 bg-amber-400 inline-block" /><span className="text-[8px] text-theme-text-muted">0.8~1.0</span></span>
                  <span className="flex items-center gap-1"><span className="w-2 h-2 bg-red-500 inline-block" /><span className="text-[8px] text-theme-text-muted">&lt;0.8</span></span>
                </div>
              </div>

              {/* 상태 요약 */}
              <div className={cn('mt-4 px-3 py-2 border-2 text-center', meta.border, meta.bg)}>
                <p className={cn('text-[10px] font-black', meta.color)}>
                  {meta.icon} {meta.labelKo}
                </p>
                <p className="text-[8px] text-theme-text-muted mt-0.5 leading-tight">
                  {srrResult.actionMessage}
                </p>
              </div>
            </div>
          </div>

          {/* 경보 단계 가이드 */}
          <div className="flex flex-wrap gap-2 pt-2 border-t border-theme-border">
            {[
              { icon: '🟢', label: 'NORMAL', desc: 'RS≥1.0 유지' },
              { icon: '👁', label: 'WATCH', desc: 'RS<1.0 진입 or 순위 이탈 10%p+' },
              { icon: '⚠️', label: 'WARNING', desc: 'RS<1.0 · 3주 연속 or 상위 20% 이탈' },
              { icon: '🔴', label: 'CRITICAL', desc: 'RS<0.8 · 5주 연속 → 교체' },
            ].map(g => (
              <span key={g.label} className={cn(
                'text-[8px] px-2 py-1 border',
                srrResult.alert === g.label ? 'border-gray-400 bg-gray-100 font-black' : 'border-gray-100 text-theme-text-muted',
              )}>
                {g.icon} {g.label} — {g.desc}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
