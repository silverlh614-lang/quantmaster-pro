/**
 * @responsibility AI 추천 universe 발굴 경고 영구 표시 — sourceStatus 5-Tier 색상 분기
 */
import type { ReactElement } from 'react';
import { AlertTriangle, X, Info, Database, AlertCircle } from 'lucide-react';
import { useRecommendationStore } from '../../stores';

interface Props {
  className?: string;
}

/**
 * sourceStatus 별 톤(색상·아이콘·레이블) — ADR-0016 §6 SSOT.
 *
 * - GOOGLE_OK            : 표시 없음 (정상)
 * - FALLBACK_SNAPSHOT    : 회색 정보 — 직전 거래일 universe 재평가
 * - FALLBACK_QUANT/NAVER : 노랑 — 정량/펀더멘털 단독, 뉴스 비활성
 * - FALLBACK_SEED/NOT_CONFIGURED/BUDGET_EXCEEDED : 노랑 — 운영자 안내
 * - ERROR/NO_MATCHES     : 빨강 — 일시 오류
 */
type SourceStatus =
  | 'GOOGLE_OK'
  | 'FALLBACK_SNAPSHOT'
  | 'FALLBACK_QUANT'
  | 'FALLBACK_NAVER'
  | 'FALLBACK_SEED'
  | 'NOT_CONFIGURED'
  | 'BUDGET_EXCEEDED'
  | 'ERROR'
  | 'NO_MATCHES';

interface Tone {
  border: string;
  bg: string;
  badge: string;
  iconColor: string;
  text: string;
  Icon: typeof AlertTriangle;
  label: string;
}

function pickTone(status?: SourceStatus): Tone {
  if (status === 'FALLBACK_SNAPSHOT') {
    return {
      border: 'border-slate-500/30', bg: 'bg-slate-500/10',
      badge: 'text-slate-300', iconColor: 'text-slate-300',
      text: 'text-slate-100/80', Icon: Database, label: 'AI 추천 안내 (스냅샷)',
    };
  }
  if (status === 'ERROR' || status === 'NO_MATCHES') {
    return {
      border: 'border-red-500/30', bg: 'bg-red-500/10',
      badge: 'text-red-300', iconColor: 'text-red-400',
      text: 'text-red-100/80', Icon: AlertCircle, label: 'AI 추천 안내 (오류)',
    };
  }
  if (status === 'NOT_CONFIGURED') {
    return {
      border: 'border-slate-500/30', bg: 'bg-slate-500/10',
      badge: 'text-slate-300', iconColor: 'text-slate-300',
      text: 'text-slate-100/80', Icon: Info, label: 'AI 추천 안내 (설정)',
    };
  }
  // 기본 — 노랑 (FALLBACK_QUANT / FALLBACK_NAVER / FALLBACK_SEED / BUDGET_EXCEEDED / 미지정)
  return {
    border: 'border-orange-500/30', bg: 'bg-orange-500/10',
    badge: 'text-orange-300', iconColor: 'text-orange-400',
    text: 'text-orange-100/80', Icon: AlertTriangle, label: 'AI 추천 안내',
  };
}

/**
 * useStockSearch.fetchStocks 가 store 에 적재한 warnings + sourceStatus 를 다음 분석
 * 실행 전까지 영구 표시. toast 가 8초 후 사라져 사용자가 "버튼만 누르고 결과 없음" 으로
 * 인지하던 문제 해소. dismiss 버튼은 사용자가 메시지를 확인 후 직접 닫게 한다.
 */
export function RecommendationWarningsBanner({ className = '' }: Props): ReactElement | null {
  const warnings = useRecommendationStore((s) => s.recommendationWarnings);
  const setWarnings = useRecommendationStore((s) => s.setRecommendationWarnings);
  const sourceStatus = useRecommendationStore((s) => s.recommendationSourceStatus);
  if (!warnings || warnings.length === 0) return null;

  const tone = pickTone(sourceStatus as SourceStatus | undefined);
  const Icon = tone.Icon;

  return (
    <div className={`rounded-xl border ${tone.border} ${tone.bg} p-4 space-y-2 ${className}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon className={`w-4 h-4 ${tone.iconColor}`} />
          <span className={`text-xs font-black ${tone.badge} uppercase tracking-widest`}>
            {tone.label}
          </span>
        </div>
        <button
          onClick={() => setWarnings([])}
          aria-label="경고 닫기"
          className={`${tone.badge} opacity-60 hover:opacity-100 transition-opacity`}
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
      <ul className={`space-y-1.5 text-xs ${tone.text} leading-relaxed`}>
        {warnings.map((w, i) => (
          <li key={i} className="flex gap-2">
            <span className={`${tone.iconColor} opacity-60`}>·</span>
            <span>{w}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
