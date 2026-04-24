/**
 * @responsibility AI 추천 universe 발굴 경고 영구 표시 — toast dismiss 후에도 사유 노출
 */
import type { ReactElement } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { useRecommendationStore } from '../../stores';

interface Props {
  className?: string;
}

/**
 * useStockSearch.fetchStocks 가 store 에 적재한 warnings 를 다음 분석 실행 전까지
 * 영구 표시. toast 가 8초 후 사라져 사용자가 "버튼만 누르고 결과 없음" 으로 인지하던
 * 문제 해소. dismiss 버튼은 사용자가 메시지를 확인 후 직접 닫게 한다.
 */
export function RecommendationWarningsBanner({ className = '' }: Props): ReactElement | null {
  const warnings = useRecommendationStore((s) => s.recommendationWarnings);
  const setWarnings = useRecommendationStore((s) => s.setRecommendationWarnings);
  if (!warnings || warnings.length === 0) return null;
  return (
    <div className={`rounded-xl border border-orange-500/30 bg-orange-500/10 p-4 space-y-2 ${className}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-orange-400" />
          <span className="text-xs font-black text-orange-300 uppercase tracking-widest">
            AI 추천 안내
          </span>
        </div>
        <button
          onClick={() => setWarnings([])}
          aria-label="경고 닫기"
          className="text-orange-300/60 hover:text-orange-200 transition-colors"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
      <ul className="space-y-1.5 text-xs text-orange-100/80 leading-relaxed">
        {warnings.map((w, i) => (
          <li key={i} className="flex gap-2">
            <span className="text-orange-400/60">·</span>
            <span>{w}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
