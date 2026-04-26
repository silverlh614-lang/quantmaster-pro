// @responsibility 계좌 생존 게이지 — 일일손실/섹터집중도/Kelly정합도 3 게이지 단일 카드 (ADR-0050 PR-Z2)

import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Activity, ShieldAlert, Layers, Scale } from 'lucide-react';
import { Section } from '../../ui/section';
import { cn } from '../../ui/cn';
import {
  fetchAccountSurvival,
  type SurvivalSnapshot,
  type SurvivalTier,
  type SectorTier,
  type KellyTier,
} from '../../api/survivalClient';

type AnyTier = SurvivalTier | SectorTier | KellyTier;

const TIER_STYLE: Record<AnyTier, { dot: string; pill: string; text: string; ring: string; bar: string }> = {
  OK:          { dot: 'bg-emerald-400', pill: 'bg-emerald-500/15 border-emerald-400/30', text: 'text-emerald-200', ring: 'ring-emerald-400/30', bar: 'bg-emerald-400' },
  WARN:        { dot: 'bg-amber-400',   pill: 'bg-amber-500/15 border-amber-400/30',     text: 'text-amber-200',   ring: 'ring-amber-400/30',   bar: 'bg-amber-400' },
  CRITICAL:    { dot: 'bg-red-500 animate-pulse', pill: 'bg-red-500/15 border-red-400/30', text: 'text-red-200',   ring: 'ring-red-400/30',     bar: 'bg-red-500' },
  EMERGENCY:   { dot: 'bg-black animate-pulse',   pill: 'bg-black/40 border-red-400/40', text: 'text-red-100',     ring: 'ring-red-500/50',     bar: 'bg-black' },
  NA:          { dot: 'bg-zinc-500',   pill: 'bg-zinc-500/10 border-zinc-500/30',     text: 'text-zinc-400',   ring: 'ring-zinc-500/20',   bar: 'bg-zinc-500' },
  CALIBRATING: { dot: 'bg-zinc-500',   pill: 'bg-zinc-500/10 border-zinc-500/30',     text: 'text-zinc-400',   ring: 'ring-zinc-500/20',   bar: 'bg-zinc-500' },
};

const TIER_LABEL: Record<AnyTier, string> = {
  OK: '안전',
  WARN: '주의',
  CRITICAL: '위험',
  EMERGENCY: '비상',
  NA: '데이터 없음',
  CALIBRATING: '학습 중',
};

const OVERALL_HEADLINE: Record<SurvivalTier, string> = {
  OK: '🟢 계좌 생존 — 안전',
  WARN: '🟡 계좌 생존 — 주의 신호',
  CRITICAL: '🔴 계좌 생존 — 위험 영역',
  EMERGENCY: '⚫ 계좌 생존 — 비상정지 권고',
};

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(100, v));
}

interface GaugeBarProps {
  fillPct: number;       // 0~100
  tier: AnyTier;
  label: string;
}

function GaugeBar({ fillPct, tier, label }: GaugeBarProps) {
  const style = TIER_STYLE[tier];
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-xs">
        <span className="text-zinc-400">{label}</span>
        <span className={cn('font-semibold', style.text)}>{TIER_LABEL[tier]}</span>
      </div>
      <div className="h-2 rounded-full bg-zinc-800/80 overflow-hidden">
        <div
          className={cn('h-full transition-all duration-500 ease-out', style.bar)}
          style={{ width: `${clamp01(fillPct)}%` }}
        />
      </div>
    </div>
  );
}

interface GaugeCardProps {
  icon: React.ReactNode;
  title: string;
  primary: string;          // 큰 숫자/문자
  secondary: string;        // 보조 설명
  tier: AnyTier;
  fillPct: number;
  barLabel: string;
}

function GaugeCard({ icon, title, primary, secondary, tier, fillPct, barLabel }: GaugeCardProps) {
  const style = TIER_STYLE[tier];
  return (
    <div
      className={cn(
        'rounded-xl border px-4 py-3 ring-1 transition-colors',
        style.pill,
        style.ring,
      )}
      data-testid={`survival-gauge-${title}`}
      data-tier={tier}
    >
      <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-zinc-400">
        <span className={cn('inline-block h-2 w-2 rounded-full', style.dot)} />
        <span>{icon}</span>
        <span>{title}</span>
      </div>
      <div className={cn('mt-1.5 text-2xl font-bold', style.text)}>{primary}</div>
      <div className="text-xs text-zinc-400 mb-2">{secondary}</div>
      <GaugeBar fillPct={fillPct} tier={tier} label={barLabel} />
    </div>
  );
}

function fmtPct(v: number): string {
  if (!Number.isFinite(v)) return '—';
  return `${v.toFixed(1)}%`;
}

export function AccountSurvivalGauge() {
  const { data, isLoading, isError } = useQuery<SurvivalSnapshot>({
    queryKey: ['account-survival'],
    queryFn: fetchAccountSurvival,
    staleTime: 60_000,
    refetchInterval: 60_000,
    retry: 2,
  });

  if (isLoading || (!data && !isError)) {
    return (
      <Section>
        <div className="flex items-center gap-2 text-zinc-400 text-sm">
          <Activity className="h-4 w-4 animate-pulse" />
          <span>계좌 생존 게이지 로딩 중…</span>
        </div>
      </Section>
    );
  }

  if (isError || !data) {
    return (
      <Section>
        <div className="flex items-center gap-2 text-zinc-400 text-sm">
          <Activity className="h-4 w-4" />
          <span>계좌 생존 데이터를 불러올 수 없습니다 — 60초 뒤 자동 재시도.</span>
        </div>
      </Section>
    );
  }

  const overallStyle = TIER_STYLE[data.overallTier];

  // 좌측: Daily Loss Buffer
  const dailyPrimary = `${data.dailyLoss.bufferPct.toFixed(0)}% 여유`;
  const dailySecondary = `${fmtPct(data.dailyLoss.currentPct)} 손실 / ${fmtPct(data.dailyLoss.limitPct)} 한도`;
  const dailyFill = clamp01(data.dailyLoss.bufferPct);

  // 중앙: Sector HHI
  const sec = data.sectorConcentration;
  const sectorPrimary = sec.tier === 'NA' ? 'N/A' : `HHI ${sec.hhi}`;
  const sectorSecondary = sec.tier === 'NA'
    ? '활성 포지션 없음'
    : sec.topSector
      ? `최대 ${sec.topSector} ${(sec.topWeight * 100).toFixed(0)}% · ${sec.activePositions}개 보유`
      : `${sec.activePositions}개 보유`;
  // HHI 게이지: 0=완전 분산(100% fill 녹색), 10000=단일 섹터(0% fill). 역방향 표시.
  const sectorFill = sec.tier === 'NA' ? 0 : Math.max(0, 100 - sec.hhi / 100);

  // 우측: Kelly Concordance
  const kel = data.kellyConcordance;
  const kellyPrimary = kel.tier === 'CALIBRATING'
    ? '학습 중'
    : kel.ratio != null ? `${kel.ratio.toFixed(2)}x` : '—';
  const kellySecondary = kel.tier === 'CALIBRATING'
    ? `표본 ${kel.sampleSize}건 (5건 이상 필요)`
    : `현재 ${kel.currentAvgKelly.toFixed(2)} / 권고 ${kel.recommendedKelly.toFixed(2)}`;
  // Kelly 게이지: ratio=1.0 정합(100% fill, 단 1.0 이상은 점차 감소 — 과대 베팅 시 fill 줄어듦)
  const kellyFill = kel.ratio == null
    ? 0
    : kel.ratio <= 1.0
      ? clamp01(kel.ratio * 100)
      : clamp01(Math.max(0, 200 - kel.ratio * 100));

  return (
    <Section>
      <div className="flex items-center justify-between mb-3">
        <div className={cn('flex items-center gap-2 text-sm font-bold', overallStyle.text)}>
          <ShieldAlert className="h-4 w-4" />
          <span>{OVERALL_HEADLINE[data.overallTier]}</span>
        </div>
        <span className="text-[10px] text-zinc-500">자동 갱신 · 60초</span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <GaugeCard
          icon={<Activity className="h-3 w-3" />}
          title="일일 손실 여유"
          primary={dailyPrimary}
          secondary={dailySecondary}
          tier={data.dailyLoss.tier}
          fillPct={dailyFill}
          barLabel="버퍼"
        />
        <GaugeCard
          icon={<Layers className="h-3 w-3" />}
          title="섹터 집중도"
          primary={sectorPrimary}
          secondary={sectorSecondary}
          tier={sec.tier}
          fillPct={sectorFill}
          barLabel="분산도"
        />
        <GaugeCard
          icon={<Scale className="h-3 w-3" />}
          title="Kelly 정합도"
          primary={kellyPrimary}
          secondary={kellySecondary}
          tier={kel.tier}
          fillPct={kellyFill}
          barLabel="능선 정합"
        />
      </div>
      {data.overallTier === 'EMERGENCY' && (
        <div className="mt-3 px-3 py-2 rounded-lg bg-red-500/15 border border-red-400/30 text-red-100 text-xs">
          ⚫ 일일 손실 한도 도달 — 비상정지 또는 신규 진입 차단을 검토하세요.
        </div>
      )}
    </Section>
  );
}
