// @responsibility 보유·관심 종목 NxN 상관계수 매트릭스 — Yahoo OHLCV 기반 (PR-N)

import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { GitMerge, RefreshCw } from 'lucide-react';
import { cn } from '../../ui/cn';
import { useRecommendationStore } from '../../stores';
import { fetchHistoricalData } from '../../services/stock/historicalData';
import {
  correlationMatrix,
  dailyReturns,
  classifyCorrelation,
  type CorrelationTone,
} from '../../utils/correlationMatrix';

const MAX_SYMBOLS = 8;

const TONE_CSS: Record<CorrelationTone, string> = {
  STRONG_POS: 'bg-red-500/40 text-red-100',     // 위험 — 동일 방향 동조
  POS:        'bg-amber-500/30 text-amber-100',
  NEUTRAL:    'bg-white/5 text-white/70',
  NEG:        'bg-cyan-500/30 text-cyan-100',
  STRONG_NEG: 'bg-blue-500/40 text-blue-100',   // 자연 헤지
  UNDEF:      'bg-black/30 text-white/30',
};

function fmtCoef(coef: number | null): string {
  if (coef == null || !Number.isFinite(coef)) return '—';
  return (coef >= 0 ? '+' : '') + coef.toFixed(2);
}

interface SymbolPick {
  code: string;
  name: string;
}

/**
 * watchlist 우선 + 추천 종목으로 보충하여 N개 symbols 선택. dedupe (code).
 */
function pickSymbols(watchlist: { code: string; name: string }[], recommendations: { code: string; name: string }[]): SymbolPick[] {
  const seen = new Set<string>();
  const result: SymbolPick[] = [];
  for (const s of [...watchlist, ...recommendations]) {
    if (!s?.code || seen.has(s.code)) continue;
    seen.add(s.code);
    result.push({ code: s.code, name: s.name });
    if (result.length >= MAX_SYMBOLS) break;
  }
  return result;
}

async function loadReturns(symbols: SymbolPick[]): Promise<Record<string, number[]>> {
  const result: Record<string, number[]> = {};
  // 동시 fetch (병렬) — Yahoo proxy 가 inflight coalescing 가짐 (PR-24)
  const promises = symbols.map(async sym => {
    try {
      const data = await fetchHistoricalData(sym.code, '3mo', '1d');
      const closes: number[] = (data?.indicators?.quote?.[0]?.close ?? [])
        .filter((v: unknown): v is number => typeof v === 'number' && Number.isFinite(v));
      result[`${sym.code}|${sym.name}`] = dailyReturns(closes);
    } catch {
      result[`${sym.code}|${sym.name}`] = [];
    }
  });
  await Promise.all(promises);
  return result;
}

interface PortfolioCorrelationMatrixProps {
  className?: string;
}

/**
 * 보유·관심 종목 NxN Pearson 상관계수 매트릭스.
 * - watchlist + recommendations 통합, dedupe, 최대 8 종목.
 * - 3개월 일별 return 으로 계산.
 * - heatmap 5분류: STRONG_POS(적) / POS(황) / NEUTRAL(회) / NEG(청) / STRONG_NEG(진청).
 *
 * 외부 의존 (Yahoo 프록시) 발생 — fetchHistoricalData (이미 PR-23 LRU 캐시 + PR-24 coalescing 보유).
 */
export function PortfolioCorrelationMatrix({ className }: PortfolioCorrelationMatrixProps) {
  const recommendations = useRecommendationStore(s => s.recommendations);
  const watchlist = useRecommendationStore(s => s.watchlist);
  const [enabled, setEnabled] = useState(false);

  const symbols = pickSymbols(watchlist, recommendations);

  const queryKey = ['portfolio-correlation', symbols.map(s => s.code).join(',')];
  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey,
    queryFn: () => loadReturns(symbols),
    enabled: enabled && symbols.length >= 2,
    staleTime: 10 * 60_000, // 10분 — 일별 데이터라 자주 갱신 불필요
    retry: 1,
  });

  const matrix = data ? correlationMatrix(data) : null;

  if (symbols.length < 2) {
    return (
      <div className={cn('rounded border border-white/10 bg-white/5 p-3 sm:p-4', className)}>
        <div className="flex items-center gap-1.5 mb-2 text-[10px] font-black uppercase tracking-widest opacity-70">
          <GitMerge className="w-3 h-3" />
          <span>보유 종목 상관관계</span>
        </div>
        <p className="text-xs opacity-60">
          관심·추천 종목이 2개 이상 있어야 매트릭스 계산 가능 — 현재 {symbols.length} 종목.
        </p>
      </div>
    );
  }

  return (
    <div
      className={cn('rounded border border-white/10 bg-black/20 p-3 sm:p-4', className)}
      role="region"
      aria-label="보유 종목 상관관계 매트릭스"
    >
      <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
        <span className="text-[11px] font-black uppercase tracking-widest opacity-70 flex items-center gap-1.5">
          <GitMerge className="w-3 h-3" /> 보유 종목 상관관계
        </span>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-white/50 font-num">
            {symbols.length} 종목 · 3개월 일별
          </span>
          {!enabled ? (
            <button
              type="button"
              onClick={() => setEnabled(true)}
              className="text-[10px] font-black px-2 py-1 rounded border bg-violet-500/20 border-violet-500/40 text-violet-200 hover:bg-violet-500/30"
            >
              계산 시작
            </button>
          ) : (
            <button
              type="button"
              onClick={() => refetch()}
              disabled={isFetching}
              className="text-[10px] font-black px-2 py-1 rounded border bg-white/5 border-white/10 text-white/60 hover:bg-white/10 flex items-center gap-1"
              aria-label="새로고침"
            >
              <RefreshCw className={cn('w-3 h-3', isFetching && 'animate-spin')} /> 새로고침
            </button>
          )}
        </div>
      </div>

      {!enabled ? (
        <p className="text-xs opacity-60">
          버튼 클릭 시 Yahoo OHLCV 를 fetch 해 NxN 상관계수 계산. 종목당 1회 외부 호출.
        </p>
      ) : isLoading || isFetching ? (
        <p className="text-xs opacity-50">매트릭스 계산 중…</p>
      ) : isError ? (
        <p className="text-xs text-red-300">매트릭스 계산 실패 — Yahoo proxy 오류</p>
      ) : !matrix || matrix.symbols.length === 0 ? (
        <p className="text-xs opacity-60">데이터 없음</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="text-[10px] border-collapse w-full min-w-[400px]">
            <thead>
              <tr>
                <th className="bg-transparent" />
                {matrix.symbols.map(sym => {
                  const [, name] = sym.split('|');
                  return (
                    <th
                      key={`h-${sym}`}
                      className="font-bold text-white/70 px-1 py-1 truncate max-w-[5rem]"
                      title={name}
                    >
                      {name.length > 4 ? name.slice(0, 4) : name}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {matrix.symbols.map((rowSym, i) => {
                const [, rowName] = rowSym.split('|');
                return (
                  <tr key={`r-${rowSym}`}>
                    <td
                      className="font-bold text-white/70 px-1 py-1 truncate max-w-[5rem] text-right"
                      title={rowName}
                    >
                      {rowName.length > 4 ? rowName.slice(0, 4) : rowName}
                    </td>
                    {matrix.matrix[i].map((coef, j) => {
                      const tone = classifyCorrelation(coef);
                      return (
                        <td
                          key={`c-${rowSym}-${j}`}
                          className={cn(
                            'text-center font-num font-black p-0.5',
                            TONE_CSS[tone],
                          )}
                          title={`${rowName} × ${matrix.symbols[j].split('|')[1]} = ${fmtCoef(coef)}`}
                        >
                          {fmtCoef(coef)}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="mt-2 text-[10px] opacity-60 leading-snug">
            🔴 ≥0.7 동조(분산 리스크) · 🟡 ≥0.4 약한 동조 · ⚪ 무관 · 🔵 ≤-0.4 헤지 · 🟦 ≤-0.7 강한 헤지
          </p>
        </div>
      )}
    </div>
  );
}
