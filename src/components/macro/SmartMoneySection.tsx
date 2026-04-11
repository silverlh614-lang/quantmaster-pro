import React, { useState } from 'react';
import { RefreshCw, TrendingUp, TrendingDown } from 'lucide-react';
import { SmartMoneyData } from '../../types/quant';
import { getSmartMoneyFlow } from '../../services/stockService';

export function SmartMoneySection() {
  const [smartMoney, setSmartMoney] = useState<SmartMoneyData | null>(null);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try { setSmartMoney(await getSmartMoneyFlow()); }
    catch (err) { console.error('[ERROR] Smart Money 조회 실패:', err); }
    finally { setLoading(false); }
  };

  return (
    <div className="p-4 sm:p-8 border border-theme-text bg-theme-card shadow-[4px_4px_0px_0px_rgba(128,128,128,0.3)]">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h3 className="text-[10px] font-black uppercase tracking-widest text-theme-text-muted">
            Smart Money Radar — 글로벌 ETF 선행 모니터
          </h3>
          {smartMoney && (
            <p className="text-[9px] font-mono text-theme-text-muted mt-1">업데이트: {smartMoney.lastUpdated}</p>
          )}
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="flex items-center gap-2 px-3 py-1.5 border border-theme-text bg-theme-card hover:bg-theme-text hover:text-white transition-colors text-xs font-black uppercase tracking-widest disabled:opacity-50"
        >
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
          {loading ? '조회 중...' : 'Smart Money 조회'}
        </button>
      </div>

      {smartMoney ? (
        <div className="space-y-6">
          {/* Score + Signal */}
          <div className="flex items-center gap-6">
            <div className="text-center p-4 border-2 border-theme-text w-28">
              <p className="text-[9px] font-black text-theme-text-muted uppercase tracking-widest">SMF 점수</p>
              <p className="text-fluid-4xl font-black font-mono mt-1">{smartMoney.score}</p>
              <p className="text-[9px] text-theme-text-muted font-mono">/10</p>
            </div>
            <div className="flex-1 space-y-2">
              <div className={`inline-flex items-center gap-2 px-4 py-2 font-black text-sm border-2 ${
                smartMoney.signal === 'BULLISH' ? 'border-green-600 bg-green-50 text-green-700'
                : smartMoney.signal === 'BEARISH' ? 'border-red-600 bg-red-50 text-red-700'
                : 'border-gray-400 bg-theme-bg text-theme-text-secondary'
              }`}>
                {smartMoney.signal === 'BULLISH' ? <TrendingUp size={14} /> : smartMoney.signal === 'BEARISH' ? <TrendingDown size={14} /> : null}
                {smartMoney.signal} — 선행 {smartMoney.leadTimeWeeks}
              </div>
              {smartMoney.isEwyMtumBothInflow && (
                <div className="px-3 py-1.5 bg-green-700 text-white text-[10px] font-black inline-block">
                  ★ EWY + MTUM 동시 유입 → Gate 2 기준 9→8 완화 적용
                </div>
              )}
            </div>
          </div>

          {/* ETF Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
            {smartMoney.etfFlows.map(etf => (
              <div
                key={etf.ticker}
                className={`p-3 border-2 text-center ${
                  etf.flow === 'INFLOW' ? 'border-green-400 bg-green-50'
                  : etf.flow === 'OUTFLOW' ? 'border-red-400 bg-red-50'
                  : 'border-theme-border bg-theme-bg'
                }`}
              >
                <p className="text-[10px] font-black font-mono">{etf.ticker}</p>
                <p className={`text-lg font-black mt-1 font-mono ${
                  etf.weeklyAumChange >= 0 ? 'text-green-700' : 'text-red-700'
                }`}>
                  {etf.weeklyAumChange >= 0 ? '+' : ''}{etf.weeklyAumChange.toFixed(1)}%
                </p>
                <p className={`text-[8px] font-black mt-1 ${
                  etf.flow === 'INFLOW' ? 'text-green-600'
                  : etf.flow === 'OUTFLOW' ? 'text-red-600'
                  : 'text-theme-text-muted'
                }`}>{etf.flow}</p>
                <p className="text-[8px] text-theme-text-muted mt-1 leading-tight">{etf.significance}</p>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <p className="text-xs text-theme-text-muted italic text-center py-4">
          "Smart Money 조회" 버튼을 눌러 글로벌 ETF 자금 흐름을 분석합니다.
        </p>
      )}
    </div>
  );
}
