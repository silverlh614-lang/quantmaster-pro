/**
 * 아이디어 3: Bear Regime 전용 종목 발굴 — "하락 수혜주" 자동 탐색
 * Gate -1이 Bear Regime을 감지하면 27조건 Bull 스크리너 대신 자동 활성화되는
 * Bear Screener 패널. 4개 카테고리별 하락 수혜주 발굴 조건을 표시한다.
 */
import React, { useState } from 'react';
import { ShieldAlert, TrendingDown, ChevronDown, ChevronUp, CheckCircle2, XCircle, Search, AlertTriangle } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../ui/cn';
import type { BearScreenerResult, BearScreenerCondition, BearScreenerCategory } from '../types/quant';
import type { StockRecommendation } from '../services/stockService';

interface BearScreenerPanelProps {
  bearScreenerResult: BearScreenerResult | null;
  loading: boolean;
  recommendations: StockRecommendation[];
  onBearScreen: () => Promise<void>;
  onStockClick?: (stock: StockRecommendation) => void;
}

const CATEGORY_META: Record<BearScreenerCategory, { label: string; emoji: string; color: string; bg: string; border: string }> = {
  DEFENSIVE: {
    label: '방어주',
    emoji: '🛡️',
    color: 'text-blue-400',
    bg: 'bg-blue-500/10',
    border: 'border-blue-500/30',
  },
  COUNTER_CYCLICAL: {
    label: '역주기주',
    emoji: '🔄',
    color: 'text-amber-400',
    bg: 'bg-amber-500/10',
    border: 'border-amber-500/30',
  },
  VALUE_DEPRESSED: {
    label: '숏 수혜주',
    emoji: '💎',
    color: 'text-green-400',
    bg: 'bg-green-500/10',
    border: 'border-green-500/30',
  },
  VOLATILITY_BENEFICIARY: {
    label: '변동성 수혜주',
    emoji: '📈',
    color: 'text-purple-400',
    bg: 'bg-purple-500/10',
    border: 'border-purple-500/30',
  },
};

const CATEGORY_DESCS: Record<BearScreenerCategory, string> = {
  DEFENSIVE: '음식료·통신·유틸리티 — 경기 둔화와 무관한 필수 소비 수요',
  COUNTER_CYCLICAL: '채권·금·달러 ETF — 하락장에서 역방향으로 움직이는 자산',
  VALUE_DEPRESSED: '실적은 탄탄하나 주가만 눌린 종목 — 공매도 반대편 기회',
  VOLATILITY_BENEFICIARY: '보험주·금융주(NIM 개선) — 변동성 상승 구간 수혜',
};

function ConditionList({ conditions }: { conditions: BearScreenerCondition[] }) {
  return (
    <ul className="space-y-1.5">
      {conditions.map(cond => (
        <li key={cond.id} className="flex items-start gap-2 text-xs">
          {cond.passed
            ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
            : <XCircle className="w-3.5 h-3.5 text-gray-600 shrink-0 mt-0.5" />
          }
          <div>
            <span className={cn('font-semibold', cond.passed ? 'text-gray-200' : 'text-gray-500')}>
              {cond.name}
            </span>
            <p className="text-gray-500 leading-tight mt-0.5">{cond.description}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}

function StockCategoryBadge({ category }: { category?: BearScreenerCategory }) {
  if (!category) return null;
  const meta = CATEGORY_META[category];
  return (
    <span className={cn(
      'inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded border uppercase tracking-wide',
      meta.bg, meta.border, meta.color,
    )}>
      {meta.emoji} {meta.label}
    </span>
  );
}

export function BearScreenerPanel({
  bearScreenerResult,
  loading,
  recommendations,
  onBearScreen,
  onStockClick,
}: BearScreenerPanelProps) {
  const [expanded, setExpanded] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);

  if (!bearScreenerResult?.isActive) return null;

  const { categories, passedCount, conditions, screeningNote, triggerReason } = bearScreenerResult;
  const categoryKeys = Object.keys(CATEGORY_META) as BearScreenerCategory[];

  const handleScan = async () => {
    setScanError(null);
    try {
      await onBearScreen();
    } catch (err) {
      setScanError(err instanceof Error ? err.message : '탐색 중 오류가 발생했습니다.');
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: -12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -12 }}
      className="bg-red-950/60 border border-red-600/40 rounded-xl overflow-hidden"
    >
      {/* Header */}
      <div className="px-5 py-4 flex items-start gap-3">
        <div className="w-10 h-10 rounded-lg bg-red-500/20 border border-red-500/40 flex items-center justify-center shrink-0">
          <ShieldAlert className="w-5 h-5 text-red-400" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-base font-black text-red-200 uppercase tracking-wide flex items-center gap-1.5">
              <TrendingDown className="w-4 h-4 text-red-400" />
              Bear Screener 활성 — 하락 수혜주 자동 탐색
            </h2>
            <span className="text-[10px] font-black px-2 py-0.5 rounded bg-red-900/60 border border-red-500/50 text-red-300 uppercase tracking-widest">
              {passedCount}/{conditions.length} 조건 충족
            </span>
          </div>
          <p className="text-xs text-red-300/80 mt-1 leading-relaxed">{screeningNote}</p>
          <p className="text-[10px] text-red-400/60 mt-1 font-mono">{triggerReason}</p>
        </div>
        <button
          onClick={() => setExpanded(v => !v)}
          className="shrink-0 p-1.5 rounded-lg hover:bg-red-800/40 text-red-400 transition-colors"
          aria-label={expanded ? '접기' : '펼치기'}
        >
          {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>
      </div>

      {/* Category Cards */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden border-t border-red-600/20"
          >
            <div className="px-5 py-4 grid grid-cols-1 md:grid-cols-2 gap-4">
              {categoryKeys.map(cat => {
                const meta = CATEGORY_META[cat];
                const conds = categories[
                  cat === 'DEFENSIVE' ? 'defensive'
                  : cat === 'COUNTER_CYCLICAL' ? 'counterCyclical'
                  : cat === 'VALUE_DEPRESSED' ? 'valueDepressed'
                  : 'volatilityBeneficiary'
                ];
                const passedInCat = conds.filter(c => c.passed).length;
                return (
                  <div
                    key={cat}
                    className={cn(
                      'rounded-lg p-4 border',
                      meta.bg, meta.border,
                    )}
                  >
                    <div className="flex items-center justify-between mb-3">
                      <span className={cn('text-sm font-black flex items-center gap-1.5', meta.color)}>
                        {meta.emoji} {meta.label}
                      </span>
                      <span className={cn('text-[10px] font-bold px-1.5 py-0.5 rounded border', meta.bg, meta.border, meta.color)}>
                        {passedInCat}/{conds.length}
                      </span>
                    </div>
                    <p className="text-[11px] text-gray-400 mb-3 leading-snug">{CATEGORY_DESCS[cat]}</p>
                    <ConditionList conditions={conds} />
                  </div>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Scan Button */}
      <div className="px-5 py-4 border-t border-red-600/20 flex flex-col gap-2">
        <div className="flex items-center gap-3 flex-wrap">
          <button
            onClick={handleScan}
            disabled={loading}
            className={cn(
              'flex items-center gap-2 px-5 py-2.5 rounded-lg font-bold text-sm transition-all',
              loading
                ? 'bg-red-900/40 text-red-400 cursor-not-allowed'
                : 'bg-red-600 hover:bg-red-500 text-white shadow-lg shadow-red-900/40',
            )}
          >
            {loading ? (
              <>
                <span className="w-4 h-4 rounded-full border-2 border-red-300 border-t-transparent animate-spin" />
                Bear Screener 탐색 중...
              </>
            ) : (
              <>
                <Search className="w-4 h-4" />
                하락 수혜주 탐색 실행
              </>
            )}
          </button>
          <span className="text-xs text-gray-500 flex items-center gap-1">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
            파생상품 없이 하락장 수익 추구 — 방어주·역주기주·숏 수혜주·변동성 수혜주
          </span>
        </div>
        {scanError && (
          <p className="text-xs text-red-400 flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
            {scanError}
          </p>
        )}
      </div>

      {/* Results */}
      <AnimatePresence>
        {recommendations.length > 0 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="border-t border-red-600/20 px-5 py-4"
          >
            <h3 className="text-xs font-black uppercase tracking-widest text-red-300 mb-3 flex items-center gap-1.5">
              <ShieldAlert className="w-3.5 h-3.5" /> 발굴된 하락 수혜주 ({recommendations.length}종목)
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {recommendations.map(stock => {
                const bearCat = (stock as any).bearScreenerCategory as BearScreenerCategory | undefined;
                const catMeta = bearCat ? CATEGORY_META[bearCat] : null;
                return (
                  <button
                    key={stock.code}
                    onClick={() => onStockClick?.(stock)}
                    className="text-left p-3 rounded-lg bg-white/5 border border-white/10 hover:border-red-500/40 hover:bg-red-950/40 transition-all group"
                  >
                    <div className="flex items-start justify-between gap-2 mb-1.5">
                      <div>
                        <p className="text-sm font-bold text-white group-hover:text-red-200 transition-colors">
                          {stock.name}
                        </p>
                        <p className="text-[11px] text-gray-500">{stock.code}</p>
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        <span className={cn(
                          'text-[10px] font-black px-1.5 py-0.5 rounded border',
                          stock.type === 'STRONG_BUY'
                            ? 'bg-emerald-900/60 border-emerald-500/50 text-emerald-300'
                            : stock.type === 'BUY'
                            ? 'bg-blue-900/60 border-blue-500/50 text-blue-300'
                            : 'bg-gray-800 border-gray-600 text-gray-400',
                        )}>
                          {stock.type.replace('_', ' ')}
                        </span>
                        {catMeta && (
                          <span className={cn(
                            'text-[10px] font-bold px-1.5 py-0.5 rounded border',
                            catMeta.bg, catMeta.border, catMeta.color,
                          )}>
                            {catMeta.emoji} {catMeta.label}
                          </span>
                        )}
                      </div>
                    </div>
                    <p className="text-[11px] text-gray-400 leading-snug line-clamp-2">{stock.reason}</p>
                    {stock.currentPrice > 0 && (
                      <p className="text-xs font-mono text-gray-300 mt-2">
                        ₩{stock.currentPrice.toLocaleString()}
                        {stock.targetPrice > 0 && (
                          <span className="text-emerald-400 ml-2">
                            → ₩{stock.targetPrice.toLocaleString()}
                          </span>
                        )}
                      </p>
                    )}
                    <div className="mt-2 flex items-center gap-1 flex-wrap">
                      {stock.confidenceScore > 0 && (
                        <span className="text-[10px] text-gray-500">확신도 {stock.confidenceScore}%</span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
