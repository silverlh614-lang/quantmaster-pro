/**
 * AntiFailurePanel.tsx — 반실패 학습 패턴 DB 패널
 *
 * 손절된 포지션의 진입 패턴을 역방향 학습하여 유사 패턴 재진입을 경고한다.
 * 코사인 유사도 85% 이상이면 경고 메시지를 자동으로 표시한다.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Shield, AlertTriangle, CheckCircle, RefreshCw, Database, ChevronDown, ChevronUp } from 'lucide-react';
import { cn } from '../../ui/cn';
import { useGlobalIntelStore } from '../../stores/useGlobalIntelStore';

// ─── 클라이언트측 타입 ────────────────────────────────────────────────────────

interface FailureWarning {
  hasWarning: boolean;
  similarCount: number;
  totalChecked: number;
  maxSimilarity: number;
  message: string;
  topMatches: Array<{
    stockName: string;
    stockCode: string;
    similarity: number;
    returnPct: number;
    exitDate: string;
  }>;
}

interface PatternSummary {
  count: number;
  patterns: Array<{
    stockName: string;
    stockCode: string;
    returnPct: number;
    exitDate: string;
    finalScore: number;
  }>;
}

// ─── 메인 컴포넌트 ────────────────────────────────────────────────────────────

export const AntiFailurePanel: React.FC = () => {
  const antiFailureWarning = useGlobalIntelStore(s => s.antiFailureWarning);
  const [summary, setSummary] = useState<PatternSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const fetchSummary = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/failure-patterns');
      if (res.ok) {
        const data = await res.json() as PatternSummary;
        setSummary(data);
      }
    } catch {
      // 네트워크 오류 무시
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchSummary();
  }, [fetchSummary]);

  // antiFailureWarning은 Gate 분석 결과에 첨부된 경고 문자열
  const hasActiveWarning = !!antiFailureWarning;

  return (
    <div className={cn(
      'rounded-xl border px-5 py-4 space-y-4 transition-colors',
      hasActiveWarning
        ? 'border-red-700/60 bg-red-950/20'
        : 'border-gray-700/40 bg-gray-900/40',
    )}>
      {/* 헤더 */}
      <div
        className="flex items-center justify-between cursor-pointer select-none"
        onClick={() => setExpanded(!expanded)}
        role="button"
        aria-expanded={expanded}
      >
        <div className="flex items-center gap-3">
          <Shield className={cn('w-5 h-5', hasActiveWarning ? 'text-red-400' : 'text-emerald-400')} />
          <div>
            <h3 className="text-sm font-semibold text-gray-100">
              반실패 학습 패턴 DB
            </h3>
            <p className="text-xs text-gray-500 mt-0.5">
              손절 패턴 역방향 학습 · 코사인 유사도 85% 이상 자동 경고
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5">
            <Database className="w-3.5 h-3.5 text-gray-600" />
            <span className="text-xs text-gray-500">
              {summary ? `${summary.count}건` : '—'}
            </span>
          </div>
          {expanded ? (
            <ChevronUp className="w-4 h-4 text-gray-500" />
          ) : (
            <ChevronDown className="w-4 h-4 text-gray-500" />
          )}
        </div>
      </div>

      {/* 경고 배너 */}
      {hasActiveWarning && antiFailureWarning && (
        <div className="flex items-start gap-2.5 rounded-lg bg-red-900/30 border border-red-700/50 p-3">
          <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
          <p className="text-xs text-red-200 leading-relaxed">{antiFailureWarning}</p>
        </div>
      )}

      {/* 정상 상태 */}
      {!hasActiveWarning && (
        <div className="flex items-center gap-2 text-xs text-emerald-400/80">
          <CheckCircle className="w-3.5 h-3.5" />
          유사 실패 패턴 없음 — 진입 패턴 안전 구간
        </div>
      )}

      {/* 확장 영역 */}
      {expanded && (
        <div className="space-y-3 pt-2 border-t border-gray-700/40">
          <div className="flex items-center justify-between">
            <p className="text-xs text-gray-500 font-medium">최근 실패 패턴 목록</p>
            <button
              onClick={() => void fetchSummary()}
              disabled={loading}
              className="flex items-center gap-1 text-xs text-indigo-400 hover:text-indigo-300 disabled:opacity-50"
            >
              <RefreshCw className={cn('w-3 h-3', loading && 'animate-spin')} />
              새로고침
            </button>
          </div>

          {summary && summary.patterns.length > 0 ? (
            <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
              {summary.patterns.map((p, i) => (
                <div
                  key={i}
                  className="flex items-center gap-3 rounded-lg bg-gray-800/40 px-3 py-2"
                >
                  <div className="flex-1 min-w-0">
                    <span className="text-xs font-medium text-gray-300">{p.stockName}</span>
                    <span className="text-xs text-gray-600 ml-1.5">{p.stockCode}</span>
                  </div>
                  <span className={cn(
                    'text-xs font-medium',
                    p.returnPct < 0 ? 'text-red-400' : 'text-emerald-400'
                  )}>
                    {p.returnPct > 0 ? '+' : ''}{p.returnPct.toFixed(1)}%
                  </span>
                  <span className="text-xs text-gray-600">{p.exitDate?.slice(0, 10)}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-gray-600 py-2">
              {loading ? '로딩 중...' : '저장된 실패 패턴이 없습니다. 손절 기록이 쌓이면 자동으로 DB가 구축됩니다.'}
            </p>
          )}

          {/* 설명 */}
          <div className="rounded-lg bg-gray-800/40 p-3 text-xs text-gray-500 leading-relaxed">
            <span className="text-gray-400 font-medium">핵심 통찰: </span>
            성공 패턴을 따라가는 것보다 실패 패턴을 피하는 것이 승률 개선에 더 빠르게 기여한다.
            시스템이 같은 실수를 반복하지 않도록 &quot;기억&quot;을 부여하는 것이다.
            <br />
            <span className="text-gray-400 font-medium">동작 방식: </span>
            손절 시 27조건 점수 벡터를 DB에 저장 → 신규 진입 시 코사인 유사도 ≥ 85%면 경고.
          </div>
        </div>
      )}
    </div>
  );
};
