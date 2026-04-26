// @responsibility 추천 이력·승률·평균수익률 표시 페이지 (ADR-0019 PR-B)

import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { TrendingUp, TrendingDown, Clock, AlertCircle, Award } from 'lucide-react';
import { cn } from '../ui/cn';
import {
  fetchRecommendationHistory,
  fetchRecommendationStats,
  type ClientRecommendationRecord,
} from '../api/recommendationsClient';

const STATUS_STYLE: Record<ClientRecommendationRecord['status'], { label: string; cls: string; icon: React.ReactNode }> = {
  PENDING:  { label: '진행', cls: 'bg-gray-700/50 text-gray-300 border-gray-500/30', icon: <Clock className="w-3 h-3" /> },
  WIN:      { label: '승',   cls: 'bg-green-900/40 text-green-200 border-green-500/30', icon: <TrendingUp className="w-3 h-3" /> },
  LOSS:     { label: '패',   cls: 'bg-red-900/40 text-red-200 border-red-500/30', icon: <TrendingDown className="w-3 h-3" /> },
  EXPIRED:  { label: '만료', cls: 'bg-amber-900/40 text-amber-200 border-amber-500/30', icon: <AlertCircle className="w-3 h-3" /> },
};

function fmtPct(n: number | null | undefined, digits = 1): string {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '—';
  const sign = n >= 0 ? '+' : '';
  return `${sign}${n.toFixed(digits)}%`;
}

function fmtNum(n: number | null | undefined, digits = 0): string {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '—';
  return n.toLocaleString('ko-KR', { maximumFractionDigits: digits });
}

function fmtKstDate(iso: string | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export function RecommendationHistoryPage() {
  const historyQuery = useQuery({
    queryKey: ['recommendations', 'history', 100],
    queryFn: () => fetchRecommendationHistory(100),
    staleTime: 60_000,
    retry: 2,
  });

  const statsQuery = useQuery({
    queryKey: ['recommendations', 'stats'],
    queryFn: fetchRecommendationStats,
    staleTime: 60_000,
    retry: 2,
  });

  const records = historyQuery.data?.records ?? [];
  const stats = statsQuery.data;

  return (
    <div className="max-w-screen-xl mx-auto px-4 sm:px-6 py-4 sm:py-6 space-y-6">
      <header>
        <h1 className="text-2xl sm:text-3xl font-black tracking-tight">추천 이력 성과 추적</h1>
        <p className="text-xs sm:text-sm text-white/60 mt-1">
          시스템이 STRONG_BUY/BUY 추천한 종목의 이후 성과 — 승/패/만료 분류 + 월간 통계
        </p>
      </header>

      {/* 통계 박스 */}
      {statsQuery.isLoading ? (
        <div className="text-sm text-white/40">통계 로드 중…</div>
      ) : statsQuery.isError ? (
        <div className="rounded border border-red-500/30 bg-red-950/30 p-3 text-sm text-red-300">
          통계 로드 실패 — 서버 응답 오류
        </div>
      ) : stats ? (
        <section
          className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 sm:gap-3"
          aria-label="월간 통계"
        >
          <StatBox label="총 추천" value={fmtNum(stats.totalCount)} sub={`이번달 ${stats.monthly.total}건`} />
          <StatBox label="진행 중" value={fmtNum(stats.pendingCount)} sub="PENDING" />
          <StatBox
            label="승률"
            value={stats.monthly.sampleSufficient ? fmtPct(stats.monthly.winRate * 100, 1) : '표본 부족'}
            sub={`${stats.monthly.wins}승 / ${stats.monthly.losses}패`}
            tone={stats.monthly.sampleSufficient ? toneByPct(stats.monthly.winRate * 100, 50) : 'neutral'}
          />
          <StatBox
            label="평균 수익률"
            value={stats.monthly.sampleSufficient ? fmtPct(stats.monthly.avgReturn) : '표본 부족'}
            sub="단순 평균"
            tone={stats.monthly.sampleSufficient ? toneByPct(stats.monthly.avgReturn, 0) : 'neutral'}
          />
          <StatBox
            label="복리 수익률"
            value={stats.monthly.sampleSufficient ? fmtPct(stats.monthly.compoundReturn) : '표본 부족'}
            sub="누적 자본 성장"
            tone={stats.monthly.sampleSufficient ? toneByPct(stats.monthly.compoundReturn, 0) : 'neutral'}
          />
          <StatBox
            label="Profit Factor"
            value={stats.monthly.profitFactor != null ? stats.monthly.profitFactor.toFixed(2) : '—'}
            sub="이익 / 손실"
            tone={stats.monthly.profitFactor != null ? (stats.monthly.profitFactor >= 1.5 ? 'good' : stats.monthly.profitFactor >= 1 ? 'neutral' : 'bad') : 'neutral'}
          />
        </section>
      ) : null}

      {/* 이력 테이블 */}
      <section aria-label="추천 이력 목록">
        {historyQuery.isLoading ? (
          <div className="text-sm text-white/40">이력 로드 중…</div>
        ) : historyQuery.isError ? (
          <div className="rounded border border-red-500/30 bg-red-950/30 p-3 text-sm text-red-300">
            이력 로드 실패 — 서버 응답 오류
          </div>
        ) : records.length === 0 ? (
          <div className="rounded border border-white/10 bg-white/5 p-6 text-center text-sm text-white/50">
            아직 추천 이력이 없습니다.
          </div>
        ) : (
          <div className="overflow-x-auto rounded border border-white/10 bg-black/20">
            <table className="w-full text-xs sm:text-sm">
              <thead className="text-[10px] uppercase tracking-widest text-white/50 bg-white/5">
                <tr>
                  <th className="text-left p-2 font-black">시그널</th>
                  <th className="text-left p-2 font-black">종목</th>
                  <th className="text-left p-2 font-black hidden sm:table-cell">유형</th>
                  <th className="text-right p-2 font-black">진입</th>
                  <th className="text-right p-2 font-black hidden md:table-cell">손절</th>
                  <th className="text-right p-2 font-black hidden md:table-cell">목표</th>
                  <th className="text-center p-2 font-black">상태</th>
                  <th className="text-right p-2 font-black">실현 %</th>
                  <th className="text-left p-2 font-black hidden lg:table-cell">레짐</th>
                </tr>
              </thead>
              <tbody>
                {records.map(rec => (
                  <RecommendationRow key={rec.id} rec={rec} />
                ))}
              </tbody>
            </table>
            <div className="px-3 py-2 text-[10px] text-white/40 border-t border-white/5">
              최근 {records.length} / 전체 {historyQuery.data?.total ?? 0} 건 표시
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

interface StatBoxProps {
  label: string;
  value: string;
  sub?: string;
  tone?: 'good' | 'bad' | 'neutral';
}

function StatBox({ label, value, sub, tone = 'neutral' }: StatBoxProps) {
  const cls =
    tone === 'good' ? 'border-green-500/30 bg-green-950/30 text-green-200' :
    tone === 'bad'  ? 'border-red-500/30   bg-red-950/30   text-red-200' :
                      'border-white/10     bg-white/5      text-white/90';
  return (
    <div className={cn('rounded border p-3', cls)}>
      <div className="text-[10px] uppercase tracking-widest opacity-60 mb-1">{label}</div>
      <div className="text-lg sm:text-xl font-black font-num">{value}</div>
      {sub && <div className="text-[10px] opacity-60 mt-0.5">{sub}</div>}
    </div>
  );
}

function toneByPct(pct: number, threshold: number): 'good' | 'bad' | 'neutral' {
  if (!Number.isFinite(pct)) return 'neutral';
  if (pct > threshold) return 'good';
  if (pct < threshold) return 'bad';
  return 'neutral';
}

function RecommendationRow({ rec }: { rec: ClientRecommendationRecord }) {
  const status = STATUS_STYLE[rec.status];
  const returnTone = typeof rec.actualReturn === 'number'
    ? (rec.actualReturn > 0 ? 'text-green-300' : rec.actualReturn < 0 ? 'text-red-300' : 'text-white/60')
    : 'text-white/40';
  return (
    <tr className="border-t border-white/5 hover:bg-white/[0.03] transition-colors">
      <td className="p-2 font-num text-white/70">{fmtKstDate(rec.signalTime)}</td>
      <td className="p-2 font-bold">
        {rec.stockName}
        <span className="text-white/40 ml-1.5 text-[10px] font-num">{rec.stockCode}</span>
      </td>
      <td className="p-2 hidden sm:table-cell">
        <span className={cn(
          'text-[10px] font-black px-1.5 py-0.5 rounded border whitespace-nowrap',
          rec.signalType === 'STRONG_BUY' ? 'bg-violet-500/20 border-violet-500/40 text-violet-200' : 'bg-green-500/20 border-green-500/40 text-green-200',
        )}>
          {rec.signalType === 'STRONG_BUY' ? <Award className="w-3 h-3 inline mr-0.5" /> : null}
          {rec.signalType}
        </span>
      </td>
      <td className="p-2 text-right font-num">{fmtNum(rec.priceAtRecommend)}</td>
      <td className="p-2 text-right font-num text-white/60 hidden md:table-cell">{fmtNum(rec.stopLoss)}</td>
      <td className="p-2 text-right font-num text-white/60 hidden md:table-cell">{fmtNum(rec.targetPrice)}</td>
      <td className="p-2 text-center">
        <span className={cn('inline-flex items-center gap-1 text-[10px] font-black px-1.5 py-0.5 rounded border whitespace-nowrap', status.cls)}>
          {status.icon}
          {status.label}
          {rec.lateWin && <span className="ml-0.5 text-[8px] opacity-80">지연승</span>}
        </span>
      </td>
      <td className={cn('p-2 text-right font-num font-bold', returnTone)}>
        {fmtPct(rec.actualReturn)}
      </td>
      <td className="p-2 hidden lg:table-cell text-white/50 text-[10px]">{rec.entryRegime ?? '—'}</td>
    </tr>
  );
}
