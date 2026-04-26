// @responsibility macro 영역 CreditSpreadSection 컴포넌트
import React, { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { CreditSpreadData } from '../../types/quant';
import { getCreditSpreads } from '../../services/stockService';

export function CreditSpreadSection() {
  const [creditSpread, setCreditSpread] = useState<CreditSpreadData | null>(null);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try { setCreditSpread(await getCreditSpreads()); }
    catch (err) { console.error('[ERROR] Credit Spread 조회 실패:', err); }
    finally { setLoading(false); }
  };

  return (
    <div className="p-4 sm:p-8 border border-theme-text bg-theme-card shadow-[4px_4px_0px_0px_rgba(128,128,128,0.3)]">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h3 className="text-[10px] font-black uppercase tracking-widest text-theme-text-muted">
            Credit Spread Sentinel — 채권 시장 조기 경보
          </h3>
          {creditSpread && (
            <p className="text-[9px] font-mono text-theme-text-muted mt-1">업데이트: {creditSpread.lastUpdated}</p>
          )}
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="flex items-center gap-2 px-3 py-1.5 border border-theme-text bg-theme-card hover:bg-theme-text hover:text-white transition-colors text-xs font-black uppercase tracking-widest disabled:opacity-50"
        >
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
          {loading ? '조회 중...' : '크레딧 스프레드 조회'}
        </button>
      </div>

      {creditSpread ? (
        <div className="space-y-6">
          {/* Crisis Alert Banner */}
          {creditSpread.isCrisisAlert && (
            <div className="p-4 border-2 border-red-600 bg-red-50 text-red-700 font-black text-sm">
              🚨 신용 위기 경보 — AA- 스프레드 {creditSpread.krCorporateSpread}bp ≥ 150bp 임계치 돌파
              <p className="text-xs font-normal mt-1">Gate 1 부채비율 ≤50% 조건 자동 발동 · Kelly 전면 50% 하향</p>
            </div>
          )}
          {creditSpread.isLiquidityExpanding && (
            <div className="p-4 border-2 border-green-500 bg-green-50 text-green-700 font-black text-sm">
              ★ 유동성 확장 환경 — 스프레드 축소 추세 감지 → Gate 2 통과 조건 완화
            </div>
          )}

          {/* Trend Badge */}
          <div className="flex items-center gap-3">
            <span className={`px-4 py-1.5 text-xs font-black border-2 ${
              creditSpread.trend === 'WIDENING'  ? 'border-red-500 bg-red-50 text-red-700'
              : creditSpread.trend === 'NARROWING' ? 'border-green-500 bg-green-50 text-green-700'
              : 'border-gray-400 bg-theme-bg text-theme-text-secondary'
            }`}>
              {creditSpread.trend === 'WIDENING' ? '▲ WIDENING — 신용 스트레스'
                : creditSpread.trend === 'NARROWING' ? '▼ NARROWING — 유동성 확장'
                : '〰 STABLE — 안정 구간'}
            </span>
          </div>

          {/* 3 Spread Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
            {[
              {
                label: '한국 AA- 회사채',
                sublabel: '국채 대비 스프레드',
                val: creditSpread.krCorporateSpread,
                danger: creditSpread.krCorporateSpread >= 150,
                warn: creditSpread.krCorporateSpread >= 100,
              },
              {
                label: '미국 하이일드',
                sublabel: 'ICE BofA HY OAS',
                val: creditSpread.usHySpread,
                danger: creditSpread.usHySpread >= 600,
                warn: creditSpread.usHySpread >= 400,
              },
              {
                label: '신흥국 EMBI+',
                sublabel: 'JPMorgan EMBI+',
                val: creditSpread.embiSpread,
                danger: creditSpread.embiSpread >= 600,
                warn: creditSpread.embiSpread >= 450,
              },
            ].map(item => (
              <div
                key={item.label}
                className={`p-5 border-2 text-center ${
                  item.danger ? 'border-red-600 bg-red-50'
                  : item.warn ? 'border-amber-500 bg-amber-50'
                  : 'border-green-400 bg-green-50'
                }`}
              >
                <p className="text-[9px] font-black uppercase tracking-widest text-theme-text-muted">{item.label}</p>
                <p className="text-[8px] text-theme-text-muted mt-0.5">{item.sublabel}</p>
                <p className={`text-fluid-3xl font-black font-mono mt-3 ${
                  item.danger ? 'text-red-700' : item.warn ? 'text-amber-700' : 'text-green-700'
                }`}>{item.val}</p>
                <p className="text-[9px] text-theme-text-muted mt-1">bp</p>
                {item.danger && <p className="text-[8px] font-black text-red-600 mt-2">⚠ 위기 임계치 초과</p>}
              </div>
            ))}
          </div>
        </div>
      ) : (
        <p className="text-xs text-theme-text-muted italic text-center py-4">
          "크레딧 스프레드 조회" 버튼을 눌러 채권 시장 조기 경보 신호를 분석합니다.
        </p>
      )}
    </div>
  );
}
