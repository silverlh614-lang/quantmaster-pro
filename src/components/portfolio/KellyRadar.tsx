/**
 * KellyRadar — Idea 9: 5축 레이더 차트로 보유 포지션의 Kelly 열화 상태 가시화.
 *
 * 축:
 *   1. entryKelly        — 진입 시점 effective Kelly (정규화: / 0.5)
 *   2. currentKelly      — 현재 추정 Kelly (정규화: / 0.5)
 *   3. decayResistance   — 1 - decayPct/100 (시간·IPS 감쇠 반영)
 *   4. ipsDrift          — 1 - |현재IPS - 진입IPS| / 100 (변동 적을수록 1 에 가까움)
 *   5. regimeStability   — 진입/현재 레짐 일치 시 1, 악화 정도에 따라 감소
 *
 * 각 축 0~1 스케일. "외곽선" 이 초기(진입 시점) 상태이고 "내부" 가 현재 — 포지션이
 * 외곽에서 안쪽으로 수축할수록 열화가 심하다. 페르소나 "다차원 감시" 철학의 UI 실현.
 */
import React, { useMemo } from 'react';
import {
  Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ResponsiveContainer,
  Legend, Tooltip,
} from 'recharts';
import type { ServerShadowTrade } from '../../api/autoTradeClient';

export interface KellyRadarProps {
  trade: ServerShadowTrade;
  /** 서버 /api 에서 가져온 현재 IPS 값 (0~100). 미지정 시 엔트리 IPS 로 가정. */
  currentIps?: number;
  /** 서버 /api 에서 가져온 현재 레짐 문자열. 미지정 시 엔트리 레짐 로 가정. */
  currentRegime?: string;
  /** 카드 크기. 기본 280. */
  size?: number;
}

const KELLY_NORM = 0.5;

function regimeSeverity(r?: string | null): number {
  if (!r) return 4;
  const m = /R(\d+)/.exec(r);
  return m ? Number(m[1]) : 4;
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

export function KellyRadar({ trade, currentIps, currentRegime, size = 280 }: KellyRadarProps) {
  const snap = trade.entryKellySnapshot;

  const data = useMemo(() => {
    if (!snap) return null;
    const entryIps = snap.ipsAtEntry ?? 0;
    const nowIps = currentIps ?? entryIps;
    const entryReg = snap.regimeAtEntry;
    const nowReg = currentRegime ?? entryReg;

    const entrySev = regimeSeverity(entryReg);
    const nowSev = regimeSeverity(nowReg);
    // 레짐이 악화되면 (숫자 증가) regimeStability 가 1 에서 감소. 최대 3 step 까지 선형.
    const regimeStabilityNow = clamp01(1 - Math.max(0, nowSev - entrySev) / 3);
    // 엔트리에서는 레짐 일치 가정 → 1
    const regimeStabilityEntry = 1;

    // IPS drift — 절대값 기반. entry 에서는 0 drift → 1.
    const ipsDriftNow = clamp01(1 - Math.abs(nowIps - entryIps) / 100);
    const ipsDriftEntry = 1;

    // Kelly decay
    // 현재 Kelly 는 서버 /kelly 카드 와 동일한 간이 근사 (IPS 비율 기반) — Radar 는 진단
    // 용도이므로 exact 계산 없이 "entry 대비 감쇠 정도" 만 노출.
    const decayRatio = entryIps > 0 && snap.effectiveKelly > 0
      ? clamp01(nowIps > 0 ? (snap.effectiveKelly * (nowIps / entryIps)) / snap.effectiveKelly : 1)
      : 1;
    const decayResistanceNow = decayRatio;
    const decayResistanceEntry = 1;

    // Kelly axes 정규화 — 최대 0.5 Kelly 를 1 로 매핑
    const entryKellyNorm = clamp01(snap.effectiveKelly / KELLY_NORM);
    const currentKellyNorm = clamp01((snap.effectiveKelly * decayRatio) / KELLY_NORM);

    return [
      { axis: 'entryKelly',       entry: entryKellyNorm,      current: currentKellyNorm },
      { axis: 'currentKelly',     entry: 1,                   current: currentKellyNorm },
      { axis: 'decayResistance',  entry: decayResistanceEntry, current: decayResistanceNow },
      { axis: 'ipsDrift',         entry: ipsDriftEntry,        current: ipsDriftNow },
      { axis: 'regimeStability',  entry: regimeStabilityEntry, current: regimeStabilityNow },
    ];
  }, [snap, currentIps, currentRegime]);

  if (!snap || !data) {
    return (
      <div
        className="flex items-center justify-center rounded-xl border border-theme-border/60 bg-theme-surface p-4 text-xs text-theme-muted"
        style={{ width: size, height: size }}
      >
        <span>{trade.stockName} — entryKellySnapshot 없음 (레거시)</span>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-theme-border/60 bg-theme-surface p-2">
      <div className="px-2 pb-1 text-xs font-semibold text-theme-strong">
        {trade.stockName} · {snap.tier} · {snap.signalGrade}
      </div>
      <ResponsiveContainer width={size} height={size - 32}>
        <RadarChart data={data} outerRadius="70%">
          <PolarGrid stroke="var(--color-theme-border)" />
          <PolarAngleAxis dataKey="axis" tick={{ fontSize: 10 }} />
          <PolarRadiusAxis domain={[0, 1]} tick={false} axisLine={false} />
          <Radar name="entry"   dataKey="entry"   stroke="#60a5fa" fill="#60a5fa" fillOpacity={0.15} />
          <Radar name="current" dataKey="current" stroke="#f97316" fill="#f97316" fillOpacity={0.25} />
          <Tooltip formatter={(v) => typeof v === 'number' ? v.toFixed(2) : String(v)} />
          <Legend wrapperStyle={{ fontSize: 10 }} />
        </RadarChart>
      </ResponsiveContainer>
    </div>
  );
}

export interface KellyRadarGridProps {
  trades: ServerShadowTrade[];
  currentIps?: number;
  currentRegime?: string;
}

/** 다중 포지션을 그리드 형태로 렌더. */
export function KellyRadarGrid({ trades, currentIps, currentRegime }: KellyRadarGridProps) {
  const withSnap = trades.filter(t => t.entryKellySnapshot);
  if (withSnap.length === 0) {
    return (
      <div className="rounded-xl border border-theme-border/60 bg-theme-surface p-6 text-sm text-theme-muted">
        현재 entryKellySnapshot 이 기록된 활성 포지션이 없습니다.
      </div>
    );
  }
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {withSnap.map(t => (
        <KellyRadar
          key={t.id ?? t.stockCode}
          trade={t}
          currentIps={currentIps}
          currentRegime={currentRegime}
        />
      ))}
    </div>
  );
}
