import React, { useState } from 'react';
import { Bell, RefreshCw, Newspaper, Clock, ChevronDown, ChevronUp } from 'lucide-react';
import { scanDartDisclosures } from '../services/stockService';
import { DartScreenerResult, DartDisclosureType, DartDisclosureSignal } from '../types/quant';

// ─── 공시 유형 레이블 ────────────────────────────────────────────────────────
const DART_TYPE_LABELS: Record<DartDisclosureType, string> = {
  LARGE_ORDER: '대규모 수주',
  CAPEX: '설비투자',
  INVESTMENT: '타법인 출자',
  CB_CHANGE: 'CB 조건변경',
  OWNERSHIP_CHANGE: '최대주주 변경',
  PATENT: '특허/기술이전',
  EARNINGS_JUMP: '실적 급증',
  BUYBACK: '자사주 매입',
  INSIDER_BUY: '임원 매수',
  TREASURY_CANCEL: '자사주 소각',
  DIVIDEND_INCREASE: '배당 증가',
};

// ─── 공시 유형 → 촉매 등급 (A/B/C) 매핑 ────────────────────────────────────
// Grade A: 구조적·지속적 재료 (수주잔고, 실적서프라이즈, 내부자 대규모 매수)
// Grade B: 중기 재료 (설비투자, 자사주, 경영권 변동)
// Grade C: 단기·불확실 재료 (CB조건, 특허, 배당)
function getDartCatalystGrade(disc: DartDisclosureSignal): 'A' | 'B' | 'C' {
  const { type, significance } = disc;
  if (significance >= 9) {
    if (type === 'LARGE_ORDER' || type === 'EARNINGS_JUMP' || type === 'INSIDER_BUY') return 'A';
    if (type === 'TREASURY_CANCEL' || type === 'OWNERSHIP_CHANGE') return 'A';
  }
  if (significance >= 7) {
    if (type === 'LARGE_ORDER' || type === 'EARNINGS_JUMP') return 'A';
    if (type === 'CAPEX' || type === 'BUYBACK' || type === 'INSIDER_BUY') return 'B';
    if (type === 'OWNERSHIP_CHANGE' || type === 'TREASURY_CANCEL') return 'B';
  }
  if (significance >= 5) {
    if (type === 'CAPEX' || type === 'BUYBACK' || type === 'DIVIDEND_INCREASE') return 'B';
  }
  return 'C';
}

// ─── Pre-News 긴급도 레이블 ──────────────────────────────────────────────────
function getUrgencyLabel(score: number): { label: string; color: string; bg: string; border: string } {
  if (score >= 8) return { label: '긴급', color: 'text-red-400', bg: 'bg-red-500/5', border: 'border-red-500/30' };
  if (score >= 5) return { label: '관심', color: 'text-amber-400', bg: 'bg-amber-500/5', border: 'border-amber-500/20' };
  return { label: '보통', color: 'text-gray-400', bg: 'bg-white/2', border: 'border-white/8' };
}

// ─── 단일 공시 종목 카드 ──────────────────────────────────────────────────────
const DartStockCard: React.FC<{ stock: DartScreenerResult }> = ({ stock }) => {
  const [expanded, setExpanded] = useState(false);
  const urgency = getUrgencyLabel(stock.preNewsScore);
  const topGrade = stock.disclosures.length > 0
    ? stock.disclosures.reduce((best, d) => {
        const g = getDartCatalystGrade(d);
        return (g === 'A' || (g === 'B' && best !== 'A')) ? g : best;
      }, 'C' as 'A' | 'B' | 'C')
    : 'C';

  return (
    <div className={`rounded-xl border p-4 transition-colors ${urgency.border} ${urgency.bg}`}>
      {/* 헤더 */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-white font-bold">{stock.name}</span>
              <span className="text-gray-500 text-[10px] font-mono">{stock.code}</span>
              {stock.isActionable && (
                <span className="text-[9px] font-black px-1.5 py-0.5 bg-red-500/20 border border-red-500/40 text-red-400 rounded tracking-tight">
                  48H 이내
                </span>
              )}
              <span className={`text-[9px] font-black px-1.5 py-0.5 border rounded ${
                topGrade === 'A' ? 'border-emerald-500/50 text-emerald-400 bg-emerald-500/10' :
                topGrade === 'B' ? 'border-blue-500/40 text-blue-400 bg-blue-500/10' :
                'border-gray-500/40 text-gray-400 bg-gray-500/10'
              }`}>Grade {topGrade}</span>
            </div>
            <div className="flex items-center gap-3 mt-1">
              <span className="text-[10px] text-gray-500 flex items-center gap-1">
                <Clock className="w-3 h-3" /> 공시 후 {stock.daysSinceDisclosure}일
              </span>
              <span className="text-[10px] text-gray-500">공시 {stock.disclosures.length}건</span>
            </div>
          </div>
        </div>

        {/* 점수 + 긴급도 */}
        <div className="flex items-center gap-4">
          <div className="text-right">
            <p className="text-[9px] text-gray-500 uppercase tracking-widest">Pre-News</p>
            <p className={`text-2xl font-black leading-none ${urgency.color}`}>{stock.preNewsScore}<span className="text-xs">/10</span></p>
          </div>
          <div className="text-right">
            <p className="text-[9px] text-gray-500 uppercase tracking-widest">Score</p>
            <p className="text-2xl font-black text-white leading-none">{stock.totalScore}</p>
          </div>
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-gray-500 hover:text-white transition-colors"
          >
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* 공시 목록 (펼침) */}
      {expanded && (
        <div className="mt-3 pt-3 border-t border-white/8 space-y-2">
          {stock.disclosures.map((disc, i) => {
            const grade = getDartCatalystGrade(disc);
            return (
              <div key={i} className="flex items-start gap-2">
                <span className={`shrink-0 text-[8px] font-black px-1.5 py-0.5 border rounded mt-0.5 ${
                  grade === 'A' ? 'border-emerald-500/50 text-emerald-400' :
                  grade === 'B' ? 'border-blue-500/40 text-blue-400' :
                  'border-gray-600 text-gray-500'
                }`}>Grade {grade}</span>
                <span className="shrink-0 text-[9px] text-gray-400 border border-gray-700 px-1.5 py-0.5 rounded mt-0.5">
                  {DART_TYPE_LABELS[disc.type]}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-gray-300 leading-relaxed">{disc.title}</p>
                  {disc.description && (
                    <p className="text-[10px] text-gray-500 mt-0.5 leading-relaxed">{disc.description}</p>
                  )}
                  {disc.revenueImpact !== undefined && disc.revenueImpact > 0 && (
                    <span className="text-[9px] text-emerald-400 font-bold">매출 대비 {disc.revenueImpact.toFixed(1)}%</span>
                  )}
                </div>
                <span className="shrink-0 text-[9px] text-gray-600 font-mono mt-0.5">{disc.significance}/10</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

// ─── 메인 컴포넌트 ────────────────────────────────────────────────────────────
export const DartPreNewsPanel: React.FC = () => {
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<DartScreenerResult[]>([]);
  const [scannedAt, setScannedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<'preNews' | 'total'>('preNews');

  const handleScan = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await scanDartDisclosures({ daysBack: 5, minSignificance: 5, maxResults: 20 });
      setResults(data);
      setScannedAt(new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }));
    } catch {
      setError('공시 스캔 중 오류가 발생했습니다. 다시 시도해 주세요.');
    } finally {
      setLoading(false);
    }
  };

  const sorted = [...results].sort((a, b) =>
    sortBy === 'preNews' ? b.preNewsScore - a.preNewsScore : b.totalScore - a.totalScore
  );

  const urgentCount = results.filter(r => r.preNewsScore >= 8).length;
  const actionableCount = results.filter(r => r.isActionable).length;
  const gradeACount = results.filter(r =>
    r.disclosures.some(d => getDartCatalystGrade(d) === 'A')
  ).length;

  return (
    <div className="bg-[#0f1012] border border-white/10 rounded-xl p-6">
      {/* 헤더 */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-amber-500/20 flex items-center justify-center border border-amber-500/30">
            <Newspaper className="w-5 h-5 text-amber-400" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-white">DART Pre-News 스크리너</h2>
            <p className="text-sm text-gray-400">뉴스보다 먼저 — 공시에서 투자 재료 선행 포착</p>
          </div>
        </div>
        <button
          onClick={handleScan}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white text-sm font-bold rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Bell className="w-4 h-4" />}
          {loading ? '스캔 중...' : '공시 스캔'}
        </button>
      </div>

      {/* 설명 (스캔 전) */}
      {!scannedAt && !loading && (
        <div className="mb-6 grid grid-cols-1 sm:grid-cols-3 gap-3">
          {[
            { icon: '📋', title: '11가지 이벤트 탐지', desc: '수주·설비투자·자사주·임원매수·특허·CB·실적급증 등' },
            { icon: '⏱️', title: 'Pre-News 점수 (0-10)', desc: '공시 후 뉴스화되기까지의 시간 격차 — 높을수록 선행 포착' },
            { icon: '🏷️', title: 'A/B/C 촉매 등급', desc: 'A=구조적(수주/실적), B=중기(CAPEX/자사주), C=단기' },
          ].map((item, i) => (
            <div key={i} className="bg-white/3 border border-white/8 rounded-lg p-3">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-base">{item.icon}</span>
                <span className="text-xs font-bold text-white">{item.title}</span>
              </div>
              <p className="text-[10px] text-gray-500 leading-relaxed">{item.desc}</p>
            </div>
          ))}
        </div>
      )}

      {/* 에러 */}
      {error && (
        <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-sm text-red-400">{error}</div>
      )}

      {/* 로딩 */}
      {loading && (
        <div className="flex flex-col items-center justify-center py-16 space-y-4 text-center">
          <div className="w-12 h-12 rounded-full border-4 border-amber-500/20 border-t-amber-500 animate-spin" />
          <div>
            <p className="text-white font-medium">DART 공시를 스캔하고 있습니다...</p>
            <p className="text-sm text-gray-500 mt-1">최근 5일 공시 중 11가지 이벤트 유형을 탐지 중</p>
          </div>
        </div>
      )}

      {/* 결과 요약 */}
      {!loading && results.length > 0 && (
        <>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-4">
              <p className="text-xs text-gray-500">스캔 완료: {scannedAt} · {results.length}개 종목</p>
              <div className="flex gap-2">
                <span className="text-[9px] px-2 py-0.5 bg-red-500/10 border border-red-500/30 text-red-400 rounded font-bold">긴급 {urgentCount}</span>
                <span className="text-[9px] px-2 py-0.5 bg-amber-500/10 border border-amber-500/30 text-amber-400 rounded font-bold">48H이내 {actionableCount}</span>
                <span className="text-[9px] px-2 py-0.5 bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 rounded font-bold">GradeA {gradeACount}</span>
              </div>
            </div>
            <div className="flex gap-1">
              <button
                onClick={() => setSortBy('preNews')}
                className={`text-[9px] px-2 py-1 rounded font-bold border transition-colors ${
                  sortBy === 'preNews' ? 'bg-amber-500 border-amber-500 text-white' : 'border-white/10 text-gray-500 hover:text-white'
                }`}
              >Pre-News순</button>
              <button
                onClick={() => setSortBy('total')}
                className={`text-[9px] px-2 py-1 rounded font-bold border transition-colors ${
                  sortBy === 'total' ? 'bg-amber-500 border-amber-500 text-white' : 'border-white/10 text-gray-500 hover:text-white'
                }`}
              >종합점수순</button>
            </div>
          </div>

          <div className="space-y-3">
            {sorted.map(stock => (
              <DartStockCard key={stock.code} stock={stock} />
            ))}
          </div>
        </>
      )}

      {/* 결과 없음 */}
      {!loading && scannedAt && results.length === 0 && (
        <div className="text-center py-10 text-gray-500">
          <Bell className="w-8 h-8 mx-auto mb-3 opacity-30" />
          <p className="text-sm">최근 5일 내 중요도 5 이상의 주요 공시가 없습니다.</p>
        </div>
      )}
    </div>
  );
};
