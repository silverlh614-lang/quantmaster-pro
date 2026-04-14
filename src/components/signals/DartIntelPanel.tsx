/**
 * DartIntelPanel.tsx — DART 공시 LLM 인텔리전스 필터 패널
 *
 * Gemini 5단계 임팩트 분류(-2~+2), 악재 소화 완료, 내부자 매수 감지 결과 표시.
 */
import React, { useEffect, useState } from 'react';
import { FileText, TrendingUp, TrendingDown, AlertTriangle, RefreshCw, Eye } from 'lucide-react';
import { cn } from '../../ui/cn';

// ─── 클라이언트측 DartAlert 뷰 타입 ─────────────────────────────────────────

interface DartAlertView {
  corp_name: string;
  stock_code: string;
  report_nm: string;
  rcept_dt: string;
  rcept_no: string;
  sentiment: string;
  alertedAt: string;
  llmImpact?: number;
  llmReason?: string;
  insiderBuy?: boolean;
  badNewsAbsorbed?: boolean;
  ownershipSignal?: {
    sentiment: 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL';
    reason: string;
  };
}

// ─── 공시 종합 판정 (Bull / Bear / Neutral) ───────────────────────────────────

function classifyDisclosureSentiment(alert: DartAlertView): 'BULL' | 'BEAR' | 'NEUTRAL' {
  // 내부자 매수 또는 악재 소화 완료 → BULL
  if (alert.insiderBuy || alert.badNewsAbsorbed) return 'BULL';
  // 수급 이벤트
  if (alert.ownershipSignal?.sentiment === 'POSITIVE') return 'BULL';
  if (alert.ownershipSignal?.sentiment === 'NEGATIVE') return 'BEAR';
  // LLM 임팩트 기반
  if ((alert.llmImpact ?? 0) >= 1) return 'BULL';
  if ((alert.llmImpact ?? 0) <= -1) return 'BEAR';
  return 'NEUTRAL';
}

function SentimentBadge({ sentiment }: { sentiment: 'BULL' | 'BEAR' | 'NEUTRAL' }) {
  if (sentiment === 'BULL') {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-black px-2 py-0.5 rounded-md bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 shadow-[0_0_8px_rgba(16,185,129,0.15)]">
        <TrendingUp className="w-3 h-3" />
        호재
      </span>
    );
  }
  if (sentiment === 'BEAR') {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-black px-2 py-0.5 rounded-md bg-red-500/20 text-red-300 border border-red-500/40 shadow-[0_0_8px_rgba(239,68,68,0.15)]">
        <TrendingDown className="w-3 h-3" />
        악재
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-black px-2 py-0.5 rounded-md bg-gray-500/20 text-gray-400 border border-gray-500/30">
      중립
    </span>
  );
}

// ─── 임팩트 배지 ──────────────────────────────────────────────────────────────

function ImpactBadge({ impact }: { impact: number | undefined }) {
  if (impact === undefined) return null;
  const sign = impact > 0 ? '+' : '';
  const color =
    impact >= 2  ? 'bg-emerald-900/60 text-emerald-300 border-emerald-700/50' :
    impact === 1 ? 'bg-green-900/60 text-green-300 border-green-700/50' :
    impact === 0 ? 'bg-gray-800/60 text-gray-400 border-gray-600/50' :
    impact === -1 ? 'bg-orange-900/60 text-orange-300 border-orange-700/50' :
    'bg-red-900/60 text-red-300 border-red-700/50';

  return (
    <span className={cn('text-xs font-bold px-2 py-0.5 rounded-full border', color)}>
      {sign}{impact}
    </span>
  );
}

// ─── 공시 카드 ────────────────────────────────────────────────────────────────

/** ownershipSignal이 실제 수급 이벤트(POSITIVE/NEGATIVE)인지 확인 */
function isActiveOwnershipSignal(alert: DartAlertView): boolean {
  return !!alert.ownershipSignal && alert.ownershipSignal.sentiment !== 'NEUTRAL';
}

function AlertCard({ alert }: { alert: DartAlertView }) {
  const dartUrl = `https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${alert.rcept_no}`;
  const hasOwnershipEvent = isActiveOwnershipSignal(alert);
  const sentiment = classifyDisclosureSentiment(alert);

  return (
    <div className={cn(
      'rounded-lg border p-3 space-y-1.5 transition-colors',
      alert.insiderBuy
        ? 'border-violet-700/50 bg-violet-900/10'
        : alert.badNewsAbsorbed
        ? 'border-amber-700/50 bg-amber-900/10'
        : alert.ownershipSignal?.sentiment === 'POSITIVE'
        ? 'border-emerald-700/30 bg-emerald-900/5'
        : alert.ownershipSignal?.sentiment === 'NEGATIVE'
        ? 'border-red-700/30 bg-red-900/5'
        : (alert.llmImpact ?? 0) >= 1
        ? 'border-emerald-700/30 bg-emerald-900/5'
        : (alert.llmImpact ?? 0) <= -1
        ? 'border-red-700/30 bg-red-900/5'
        : 'border-gray-700/40 bg-gray-900/20',
    )}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <SentimentBadge sentiment={sentiment} />
            <span className="text-xs font-semibold text-gray-200">{alert.corp_name}</span>
            {alert.insiderBuy && (
              <span className="text-xs bg-violet-900/60 text-violet-300 rounded-full px-1.5 py-0.5 border border-violet-700/50">
                내부자 매수
              </span>
            )}
            {alert.badNewsAbsorbed && (
              <span className="text-xs bg-amber-900/60 text-amber-300 rounded-full px-1.5 py-0.5 border border-amber-700/50">
                악재 소화 완료
              </span>
            )}
            {hasOwnershipEvent && (
              <span className={cn(
                'text-xs rounded-full px-1.5 py-0.5 border',
                alert.ownershipSignal!.sentiment === 'POSITIVE'
                  ? 'bg-emerald-900/60 text-emerald-300 border-emerald-700/50'
                  : 'bg-red-900/60 text-red-300 border-red-700/50',
              )}>
                {alert.ownershipSignal!.sentiment === 'POSITIVE' ? '수급 매수' : '수급 매도'}
              </span>
            )}
          </div>
          <p className="text-xs text-gray-400 mt-0.5 line-clamp-2">{alert.report_nm}</p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <ImpactBadge impact={alert.llmImpact} />
          <a
            href={dartUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-indigo-400 hover:text-indigo-300 transition-colors"
            title="DART 원문"
          >
            <Eye className="w-3.5 h-3.5" />
          </a>
        </div>
      </div>
      {(alert.llmReason || alert.ownershipSignal?.reason) && (
        <p className="text-xs text-gray-500 leading-relaxed">
          {alert.ownershipSignal?.reason ?? alert.llmReason}
        </p>
      )}
      <p className="text-xs text-gray-600">{alert.rcept_dt}</p>
    </div>
  );
}

// ─── 메인 컴포넌트 ────────────────────────────────────────────────────────────

export const DartIntelPanel: React.FC = () => {
  const [alerts, setAlerts] = useState<DartAlertView[]>([]);
  const [loading, setLoading] = useState(false);
  const [lastFetched, setLastFetched] = useState<string | null>(null);
  const [filter, setFilter] = useState<'ALL' | 'INSIDER' | 'ABSORBED' | 'POSITIVE' | 'NEGATIVE' | 'OWNERSHIP'>('ALL');

  const fetchAlerts = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/dart/intel');
      if (res.ok) {
        const data = await res.json() as DartAlertView[];
        // 최신순 정렬
        setAlerts(data.sort((a, b) => b.alertedAt.localeCompare(a.alertedAt)));
        setLastFetched(new Date().toLocaleTimeString('ko-KR'));
      }
    } catch {
      // 네트워크 오류 무시
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchAlerts();
    // 5분마다 자동 갱신
    const interval = setInterval(() => void fetchAlerts(), 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  const filtered = alerts.filter((a) => {
    if (filter === 'INSIDER')    return a.insiderBuy;
    if (filter === 'ABSORBED')   return a.badNewsAbsorbed;
    if (filter === 'POSITIVE')   return (a.llmImpact ?? 0) >= 1;
    if (filter === 'NEGATIVE')   return (a.llmImpact ?? 0) <= -1;
    if (filter === 'OWNERSHIP')  return isActiveOwnershipSignal(a);
    return true;
  });

  const insiderCount    = alerts.filter(a => a.insiderBuy).length;
  const absorbedCount   = alerts.filter(a => a.badNewsAbsorbed).length;
  const positiveCount   = alerts.filter(a => (a.llmImpact ?? 0) >= 1).length;
  const negativeCount   = alerts.filter(a => (a.llmImpact ?? 0) <= -1).length;
  const ownershipCount  = alerts.filter(isActiveOwnershipSignal).length;

  return (
    <div className="rounded-xl border border-indigo-800/40 bg-gray-900/50 px-5 py-4 space-y-4">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <FileText className="w-5 h-5 text-indigo-400" />
          <div>
            <h3 className="text-sm font-semibold text-gray-100">
              DART 공시 LLM 인텔리전스 필터
            </h3>
            <p className="text-xs text-gray-500 mt-0.5">
              Gemini 5단계 임팩트 분류 · 악재 소화 감지 · 내부자 매수 탐지
            </p>
          </div>
        </div>
        <button
          onClick={() => void fetchAlerts()}
          disabled={loading}
          className="flex items-center gap-1.5 text-xs text-indigo-400 hover:text-indigo-300 disabled:opacity-50 transition-colors"
        >
          <RefreshCw className={cn('w-3.5 h-3.5', loading && 'animate-spin')} />
          {lastFetched ? `갱신: ${lastFetched}` : '새로고침'}
        </button>
      </div>

      {/* 요약 통계 */}
      <div className="grid grid-cols-5 gap-2">
        {[
          { label: '내부자 매수', count: insiderCount,   color: 'text-violet-300',  icon: '🕵️' },
          { label: '악재 소화',   count: absorbedCount,  color: 'text-amber-300',   icon: '🔄' },
          { label: '긍정 공시',   count: positiveCount,  color: 'text-emerald-300', icon: '📈' },
          { label: '부정 공시',   count: negativeCount,  color: 'text-red-300',     icon: '📉' },
          { label: '수급 이벤트', count: ownershipCount, color: 'text-cyan-300',    icon: '🏦' },
        ].map(({ label, count, color, icon }) => (
          <div key={label} className="rounded-lg bg-gray-800/40 p-2 text-center">
            <div className="text-base">{icon}</div>
            <div className={cn('text-sm font-bold', color)}>{count}</div>
            <div className="text-xs text-gray-500">{label}</div>
          </div>
        ))}
      </div>

      {/* 필터 탭 */}
      <div className="flex gap-1 flex-wrap">
        {([
          ['ALL',       '전체'],
          ['INSIDER',   '🕵️ 내부자'],
          ['ABSORBED',  '🔄 악재소화'],
          ['POSITIVE',  '📈 긍정'],
          ['NEGATIVE',  '📉 부정'],
          ['OWNERSHIP', '🏦 수급이벤트'],
        ] as const).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setFilter(key)}
            className={cn(
              'text-xs px-2.5 py-1 rounded-full border transition-colors',
              filter === key
                ? 'border-indigo-500 bg-indigo-900/40 text-indigo-300'
                : 'border-gray-700/40 text-gray-500 hover:text-gray-300'
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {/* 공시 목록 */}
      <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
        {loading && filtered.length === 0 ? (
          <div className="flex items-center gap-2 text-xs text-gray-500 py-4 justify-center">
            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            공시 데이터 로딩 중...
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-xs text-gray-600 py-4 text-center">
            해당 조건의 공시가 없습니다.
          </div>
        ) : (
          filtered.slice(0, 20).map((a) => (
            <AlertCard key={a.rcept_no} alert={a} />
          ))
        )}
      </div>

      {/* 알고리즘 설명 */}
      <div className="rounded-lg bg-gray-800/40 p-3 text-xs text-gray-500 leading-relaxed">
        <span className="text-gray-400 font-medium">역설적 활용: </span>
        부정 공시(-2/-1) 발생 후 주가가 실제로 하락하지 않는 종목은
        &quot;악재 소화 완료&quot; 신호로 자동 분류 → 진입 후보로 등록.
        <br />
        <span className="text-gray-400 font-medium">목표: </span>
        공시 수신 후 5분 이내 임팩트 분류 완료 및 Telegram 알림.
      </div>
    </div>
  );
};
