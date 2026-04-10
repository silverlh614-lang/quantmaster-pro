/**
 * IDEA 9: MAPC — Macro-Adaptive Position Controller
 *         매크로 임계값 연동 포지션 자동 조절기
 *
 * 조정 켈리 = 기본 켈리 × (MHS / 100)
 *
 *   MHS 90점 → 기본 켈리의 90% 집행
 *   MHS 40점 → 기본 켈리의 40% 집행
 *   MHS < 40  → 전면 매수 중단
 *
 * BOK 금리·USD/KRW·VIX·VKOSPI 4개 실시간 지표 → MHS 4개 축 분해 →
 * 인간의 판단 전에 시스템이 먼저 베팅 크기를 자동 수축.
 */
import React, { useState } from 'react';
import { ChevronDown, ChevronUp, AlertTriangle, Zap, Settings } from 'lucide-react';
import type { MAPCResult, MAPCFactor } from '../types/quant';
import { cn } from '../ui/cn';

interface MAPCPanelProps {
  mapcResult: MAPCResult | null | undefined;
  /** 종목명 (QuantDashboard 연동 시) */
  stockName?: string;
}

// ─── Alert 메타 ───────────────────────────────────────────────────────────────

function alertMeta(alert: MAPCResult['alert']) {
  switch (alert) {
    case 'RED':
      return {
        icon: '🔴', label: 'RED — 매수 중단',
        color: 'text-red-600', border: 'border-red-500', bg: 'bg-red-50',
        barBg: 'bg-red-500',
      };
    case 'YELLOW':
      return {
        icon: '🟡', label: 'YELLOW — Kelly 축소',
        color: 'text-amber-600', border: 'border-amber-400', bg: 'bg-amber-50',
        barBg: 'bg-amber-400',
      };
    default:
      return {
        icon: '🟢', label: 'GREEN — 정상',
        color: 'text-emerald-600', border: 'border-emerald-400', bg: 'bg-emerald-50',
        barBg: 'bg-emerald-500',
      };
  }
}

function factorStatusMeta(status: MAPCFactor['status']) {
  switch (status) {
    case 'RISK_ON': return { label: 'RISK ON', color: 'text-emerald-600', barColor: 'bg-emerald-400' };
    case 'RISK_OFF': return { label: 'RISK OFF', color: 'text-red-600', barColor: 'bg-red-400' };
    default: return { label: 'NEUTRAL', color: 'text-amber-600', barColor: 'bg-amber-400' };
  }
}

// ─── Kelly 전환 화살표 ────────────────────────────────────────────────────────

function KellyArrow({
  base, adjusted, multiplier, halted,
}: {
  base: number;
  adjusted: number;
  multiplier: number;
  halted: boolean;
}) {
  const pctBase = Math.min(100, base * 4); // 25% → 100% bar
  const pctAdj = halted ? 0 : Math.min(100, adjusted * 4);

  return (
    <div className="space-y-3">
      <div>
        <div className="flex items-center justify-between mb-1">
          <span className="text-[9px] font-black uppercase text-theme-text-muted tracking-widest">기본 켈리</span>
          <span className="text-sm font-black font-mono text-theme-text">{base.toFixed(1)}%</span>
        </div>
        <div className="h-4 bg-gray-100 w-full relative">
          <div className="absolute h-full bg-blue-300 transition-all" style={{ width: `${pctBase}%` }} />
        </div>
      </div>

      {/* 공식 */}
      <div className="flex items-center gap-2 py-1">
        <div className="flex-1 border-t border-dashed border-gray-300" />
        <div className="text-[9px] font-mono text-theme-text-muted px-2 whitespace-nowrap">
          × MHS({(multiplier * 100).toFixed(0)}%) ÷ 100
        </div>
        <div className="flex-1 border-t border-dashed border-gray-300" />
      </div>

      <div>
        <div className="flex items-center justify-between mb-1">
          <span className="text-[9px] font-black uppercase text-theme-text-muted tracking-widest">조정 켈리</span>
          <span className={cn(
            'text-xl font-black font-mono',
            halted ? 'text-red-600' : multiplier >= 0.7 ? 'text-emerald-600' : 'text-amber-600',
          )}>
            {halted ? '0%' : `${adjusted.toFixed(1)}%`}
          </span>
        </div>
        <div className="h-4 bg-gray-100 w-full relative">
          <div
            className={cn(
              'absolute h-full transition-all',
              halted ? 'bg-red-400' : multiplier >= 0.7 ? 'bg-emerald-400' : 'bg-amber-400',
            )}
            style={{ width: `${pctAdj}%` }}
          />
          {halted && (
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-[8px] font-black text-red-600">매수 중단</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── 실시간 스냅샷 뱃지 ──────────────────────────────────────────────────────

function SnapshotBadge({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className={cn(
      'px-2 py-1.5 border text-center',
      warn ? 'border-red-300 bg-red-50' : 'border-theme-border',
    )}>
      <p className={cn('text-[8px] font-black uppercase tracking-widest', warn ? 'text-red-500' : 'text-theme-text-muted')}>
        {label}
      </p>
      <p className={cn('text-sm font-black font-mono', warn ? 'text-red-600' : 'text-theme-text')}>
        {value}
      </p>
    </div>
  );
}

// ─── Component ───────────────────────────────────────────────────────────────

export function MAPCPanel({ mapcResult, stockName }: MAPCPanelProps) {
  const [expanded, setExpanded] = useState(true);

  if (!mapcResult) {
    return (
      <div className="p-4 sm:p-6 border-2 border-theme-border bg-theme-card shadow-[4px_4px_0px_0px_rgba(128,128,128,0.3)]">
        <div className="flex items-center gap-2">
          <Settings className="w-3.5 h-3.5 text-theme-text-muted" />
          <h3 className="text-[10px] font-black uppercase tracking-widest text-theme-text-muted">
            MAPC 포지션 자동 조절기
          </h3>
        </div>
        <p className="text-[9px] text-theme-text-muted mt-3">
          Gate 0(MHS) + MacroEnvironment 데이터가 필요합니다.
        </p>
      </div>
    );
  }

  const meta = alertMeta(mapcResult.alert);

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
          <Settings className="w-3.5 h-3.5 text-theme-text-muted" />
          <h3 className="text-[10px] font-black uppercase tracking-widest text-theme-text-muted">
            MAPC · 포지션 자동 조절기{stockName ? ` — ${stockName}` : ''}
          </h3>
        </div>
        <div className="flex items-center gap-3">
          <span className={cn(
            'text-[10px] font-black px-2 py-0.5 border',
            meta.border, meta.bg, meta.color,
          )}>
            {meta.icon} {meta.label}
          </span>
          <span className={cn('font-black font-mono text-sm', meta.color)}>
            {mapcResult.buyingHalted ? '매수 HALT' : `${(mapcResult.mhsMultiplier * 100).toFixed(0)}%`}
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
            <Zap className="w-3 h-3 mt-0.5 flex-shrink-0 text-blue-500" />
            <p className="text-[9px] text-theme-text-muted leading-relaxed">
              <span className="font-black text-theme-text">조정 켈리 = 기본 켈리 × (MHS / 100)</span> —
              매크로 악화가 변곡점 전조 단계에서 인간 판단 전에 시스템이 먼저 베팅 크기를 수축.
              4축(금리·유동성·경기·리스크)의 실시간 점수가 MHS를 결정한다.
            </p>
          </div>

          {/* ── Alert Banner ── */}
          {mapcResult.alert !== 'GREEN' && (
            <div className={cn('flex items-start gap-2 px-3 py-2 border', meta.border, meta.bg)}>
              <AlertTriangle className={cn('w-3.5 h-3.5 mt-0.5 flex-shrink-0', meta.color)} />
              <div>
                <p className={cn('text-[10px] font-black', meta.color)}>{mapcResult.alertReason}</p>
                <p className="text-[9px] text-theme-text-muted mt-0.5">{mapcResult.actionMessage}</p>
              </div>
            </div>
          )}

          {/* ── 실시간 스냅샷 ── */}
          <div>
            <p className="text-[9px] font-black uppercase text-theme-text-muted tracking-widest mb-2">
              실시간 모니터링 스냅샷
            </p>
            <div className="grid grid-cols-4 gap-1.5">
              <SnapshotBadge
                label="BOK 금리"
                value={
                  mapcResult.snapshot.bokRate === 'HIKING' ? '인상↑' :
                  mapcResult.snapshot.bokRate === 'CUTTING' ? '인하↓' : '동결'
                }
                warn={mapcResult.snapshot.bokRate === 'HIKING'}
              />
              <SnapshotBadge
                label="USD/KRW"
                value={mapcResult.snapshot.usdKrw.toLocaleString()}
                warn={mapcResult.snapshot.usdKrw >= 1350}
              />
              <SnapshotBadge
                label="VIX"
                value={mapcResult.snapshot.vix.toFixed(1)}
                warn={mapcResult.snapshot.vix >= 22}
              />
              <SnapshotBadge
                label="VKOSPI"
                value={mapcResult.snapshot.vkospi.toFixed(1)}
                warn={mapcResult.snapshot.vkospi >= 22}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-[1fr_1.2fr] gap-5">
            {/* 왼쪽: Kelly 변환 + MHS 게이지 */}
            <div className="space-y-4">
              {/* Kelly 수축 시각화 */}
              <KellyArrow
                base={mapcResult.baseKellyPct}
                adjusted={mapcResult.adjustedKellyPct}
                multiplier={mapcResult.mhsMultiplier}
                halted={mapcResult.buyingHalted}
              />

              {/* 축소 요약 */}
              <div className="grid grid-cols-2 gap-2">
                <div className="px-3 py-2 border border-theme-border text-center">
                  <p className="text-[8px] font-black uppercase text-theme-text-muted">MHS 배율</p>
                  <p className={cn('text-xl font-black font-mono', meta.color)}>
                    {mapcResult.buyingHalted ? '0%' : `${(mapcResult.mhsMultiplier * 100).toFixed(0)}%`}
                  </p>
                </div>
                <div className="px-3 py-2 border border-theme-border text-center">
                  <p className="text-[8px] font-black uppercase text-theme-text-muted">켈리 축소</p>
                  <p className={cn(
                    'text-xl font-black font-mono',
                    mapcResult.reductionPct > 50 ? 'text-red-600' :
                    mapcResult.reductionPct > 20 ? 'text-amber-600' : 'text-theme-text',
                  )}>
                    -{mapcResult.reductionPct.toFixed(0)}%
                  </p>
                </div>
              </div>

              {/* MHS 전체 게이지 */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[9px] font-black uppercase text-theme-text-muted tracking-widest">MHS 종합</span>
                  <span className={cn('text-sm font-black font-mono', meta.color)}>
                    {mapcResult.mhsScore}/100
                  </span>
                </div>
                <div className="h-3 bg-gray-100 w-full relative">
                  <div
                    className={cn('absolute h-full transition-all', meta.barBg)}
                    style={{ width: `${mapcResult.mhsScore}%` }}
                  />
                  {/* 임계선 40 */}
                  <div
                    className="absolute top-0 bottom-0 w-px bg-red-500"
                    style={{ left: '40%' }}
                    title="매수 중단 임계(40)"
                  />
                  {/* 기준선 70 */}
                  <div
                    className="absolute top-0 bottom-0 w-px bg-emerald-500 opacity-50"
                    style={{ left: '70%' }}
                    title="GREEN 임계(70)"
                  />
                </div>
                <div className="flex justify-between mt-0.5">
                  <span className="text-[7px] text-red-500">0 중단</span>
                  <span className="text-[7px] text-red-500" style={{ marginLeft: '38%' }}>40</span>
                  <span className="text-[7px] text-emerald-500 ml-auto">70 정상 100</span>
                </div>
              </div>
            </div>

            {/* 오른쪽: 4개 축 상세 */}
            <div className="space-y-2">
              <p className="text-[9px] font-black uppercase text-theme-text-muted tracking-widest">
                MHS 4개 축 분해 (각 0-25점)
              </p>
              {mapcResult.factors.map(factor => {
                const fMeta = factorStatusMeta(factor.status);
                return (
                  <div
                    key={factor.id}
                    className={cn(
                      'px-3 py-2 border',
                      factor.status === 'RISK_OFF'
                        ? 'border-red-200 bg-red-50'
                        : factor.status === 'NEUTRAL'
                          ? 'border-amber-200 bg-amber-50'
                          : 'border-emerald-100 bg-emerald-50',
                    )}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[9px] font-black text-theme-text">{factor.nameKo}</span>
                      <div className="flex items-center gap-2">
                        <span className={cn('text-[8px] font-black', fMeta.color)}>
                          {fMeta.label}
                        </span>
                        <span className="text-sm font-black font-mono text-theme-text">
                          {factor.score}<span className="text-[8px] font-normal text-theme-text-muted">/25</span>
                        </span>
                      </div>
                    </div>
                    {/* 점수 바 */}
                    <div className="h-1.5 bg-white w-full mb-1">
                      <div
                        className={cn('h-full', fMeta.barColor)}
                        style={{ width: `${(factor.score / 25) * 100}%` }}
                      />
                    </div>
                    <p className="text-[8px] text-theme-text-muted leading-tight">{factor.keySignal}</p>
                    <p className="text-[7px] text-theme-text-muted mt-0.5 font-mono">{factor.currentValue}</p>
                  </div>
                );
              })}

              {/* 조정 결과 요약 */}
              <div className={cn('px-3 py-2 border-2 text-center', meta.border, meta.bg)}>
                <p className={cn('text-[10px] font-black', meta.color)}>
                  {mapcResult.actionMessage}
                </p>
                {!mapcResult.buyingHalted && (
                  <p className="text-[8px] text-theme-text-muted mt-1 font-mono">
                    {mapcResult.baseKellyPct.toFixed(1)}% → {mapcResult.adjustedKellyPct.toFixed(1)}%
                    <span className="ml-1 text-red-500">(-{mapcResult.reductionAmt.toFixed(1)}%p)</span>
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* ── 동작 원리 주석 ── */}
          <div className="flex flex-wrap gap-3 pt-2 border-t border-theme-border text-[8px] text-theme-text-muted">
            <span>🟢 MHS≥70 → GREEN (정상 집행)</span>
            <span>🟡 MHS 40-69 → YELLOW (비례 축소)</span>
            <span>🔴 MHS&lt;40 → RED (전면 중단)</span>
            <span className="ml-auto font-mono">축소 공식: Kelly × (MHS/100)</span>
          </div>
        </div>
      )}
    </div>
  );
}
