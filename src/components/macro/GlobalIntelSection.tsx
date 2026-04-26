// @responsibility macro 영역 GlobalIntelSection 컴포넌트
import React, { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import {
  GlobalCorrelationMatrix, GlobalMultiSourceData, ThemeReverseTrackResult,
  SupplyChainIntelligence, SectorOrderIntelligence, FinancialStressIndex, FomcSentimentAnalysis,
} from '../../types/quant';
import {
  getGlobalCorrelationMatrix, getGlobalMultiSourceData, trackThemeToKoreaValueChain,
  getSupplyChainIntelligence, getSectorOrderIntelligence, getFinancialStressIndex, getFomcSentimentAnalysis,
} from '../../services/stockService';

export function GlobalIntelSection() {
  const [globalMultiSource, setGlobalMultiSource] = useState<GlobalMultiSourceData | null>(null);
  const [multiSourceLoading, setMultiSourceLoading] = useState(false);

  const [globalCorrelation, setGlobalCorrelation] = useState<GlobalCorrelationMatrix | null>(null);
  const [correlationLoading, setCorrelationLoading] = useState(false);

  const [themeResults, setThemeResults] = useState<ThemeReverseTrackResult[]>([]);
  const [themeLoading, setThemeLoading] = useState(false);

  const [supplyChain, setSupplyChain] = useState<SupplyChainIntelligence | null>(null);
  const [supplyChainLoading, setSupplyChainLoading] = useState(false);
  const [sectorOrders, setSectorOrders] = useState<SectorOrderIntelligence | null>(null);
  const [sectorOrdersLoading, setSectorOrdersLoading] = useState(false);
  const [fsi, setFsi] = useState<FinancialStressIndex | null>(null);
  const [fsiLoading, setFsiLoading] = useState(false);
  const [fomcSentiment, setFomcSentiment] = useState<FomcSentimentAnalysis | null>(null);
  const [fomcLoading, setFomcLoading] = useState(false);

  const loadGlobalMultiSource = async () => {
    setMultiSourceLoading(true);
    try { setGlobalMultiSource(await getGlobalMultiSourceData()); }
    catch (err) { console.error('[ERROR] Multi Source 조회 실패:', err); }
    finally { setMultiSourceLoading(false); }
  };

  const loadGlobalCorrelation = async () => {
    setCorrelationLoading(true);
    try { setGlobalCorrelation(await getGlobalCorrelationMatrix()); }
    catch (err) { console.error('[ERROR] Global Correlation 조회 실패:', err); }
    finally { setCorrelationLoading(false); }
  };

  const loadThemeTracking = async () => {
    setThemeLoading(true);
    try { setThemeResults(await trackThemeToKoreaValueChain()); }
    catch (err) { console.error('[ERROR] Theme Tracking 조회 실패:', err); }
    finally { setThemeLoading(false); }
  };

  const loadSupplyChain = async () => {
    setSupplyChainLoading(true);
    try { setSupplyChain(await getSupplyChainIntelligence()); }
    catch (err) { console.error('[ERROR] Supply Chain 조회 실패:', err); }
    finally { setSupplyChainLoading(false); }
  };

  const loadSectorOrders = async () => {
    setSectorOrdersLoading(true);
    try { setSectorOrders(await getSectorOrderIntelligence()); }
    catch (err) { console.error('[ERROR] Sector Orders 조회 실패:', err); }
    finally { setSectorOrdersLoading(false); }
  };

  const loadFsi = async () => {
    setFsiLoading(true);
    try { setFsi(await getFinancialStressIndex()); }
    catch (err) { console.error('[ERROR] Financial Stress 조회 실패:', err); }
    finally { setFsiLoading(false); }
  };

  const loadFomcSentiment = async () => {
    setFomcLoading(true);
    try { setFomcSentiment(await getFomcSentimentAnalysis()); }
    catch (err) { console.error('[ERROR] FOMC Sentiment 조회 실패:', err); }
    finally { setFomcLoading(false); }
  };

  return (
    <>
      {/* ── 글로벌 멀티소스 인텔리전스 (D) ── */}
      <div className="p-4 sm:p-8 border border-theme-text bg-theme-card shadow-[4px_4px_0px_0px_rgba(128,128,128,0.3)]">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-[10px] font-black uppercase tracking-widest text-theme-text-muted">
            글로벌 멀티소스 인텔리전스 — Fed·China·TSMC·BOJ·ISM
          </h3>
          <button onClick={loadGlobalMultiSource} disabled={multiSourceLoading}
            className="flex items-center gap-2 px-3 py-1.5 border border-theme-text bg-theme-card hover:bg-theme-text hover:text-white transition-colors text-[10px] font-black uppercase disabled:opacity-50">
            <RefreshCw size={12} className={multiSourceLoading ? 'animate-spin' : ''} />
            {multiSourceLoading ? '수집 중...' : '글로벌 데이터 수집'}
          </button>
        </div>
        {globalMultiSource ? (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            <div className="p-3 border border-theme-border bg-theme-bg">
              <p className="text-[8px] font-black uppercase text-theme-text-muted mb-1">FED WATCH</p>
              <p className="text-lg font-bold font-mono">{globalMultiSource.fedWatch.cutProbability}%</p>
              <p className="text-[9px] text-theme-text-muted">금리인하 확률</p>
              <p className="text-[8px] text-theme-text-muted mt-1">다음 회의: {globalMultiSource.fedWatch.nextMeetingDate}</p>
            </div>
            <div className="p-3 border border-theme-border bg-theme-bg">
              <p className="text-[8px] font-black uppercase text-theme-text-muted mb-1">CHINA PMI</p>
              <p className={`text-lg font-bold font-mono ${globalMultiSource.chinaPmi.manufacturing >= 50 ? 'text-green-700' : 'text-red-700'}`}>
                {globalMultiSource.chinaPmi.manufacturing}
              </p>
              <p className="text-[9px] text-theme-text-muted">제조업 ({globalMultiSource.chinaPmi.trend})</p>
            </div>
            <div className="p-3 border border-theme-border bg-theme-bg">
              <p className="text-[8px] font-black uppercase text-theme-text-muted mb-1">TSMC REVENUE</p>
              <p className={`text-lg font-bold font-mono ${globalMultiSource.tsmcRevenue.yoyGrowth > 0 ? 'text-green-700' : 'text-red-700'}`}>
                {globalMultiSource.tsmcRevenue.yoyGrowth > 0 ? '+' : ''}{globalMultiSource.tsmcRevenue.yoyGrowth}%
              </p>
              <p className="text-[9px] text-theme-text-muted">YoY ({globalMultiSource.tsmcRevenue.trend})</p>
            </div>
            <div className="p-3 border border-theme-border bg-theme-bg">
              <p className="text-[8px] font-black uppercase text-theme-text-muted mb-1">BOJ POLICY</p>
              <p className="text-lg font-bold font-mono">{globalMultiSource.bojPolicy.currentRate}%</p>
              <p className={`text-[9px] ${globalMultiSource.bojPolicy.yenCarryRisk === 'HIGH' ? 'text-red-600 font-bold' : 'text-theme-text-muted'}`}>
                캐리리스크: {globalMultiSource.bojPolicy.yenCarryRisk}
              </p>
            </div>
            <div className="p-3 border border-theme-border bg-theme-bg">
              <p className="text-[8px] font-black uppercase text-theme-text-muted mb-1">US ISM MFG</p>
              <p className={`text-lg font-bold font-mono ${globalMultiSource.usIsm.manufacturing >= 50 ? 'text-green-700' : 'text-red-700'}`}>
                {globalMultiSource.usIsm.manufacturing}
              </p>
              <p className="text-[9px] text-theme-text-muted">{globalMultiSource.usIsm.trend}</p>
            </div>
            <div className="p-3 border border-theme-border bg-theme-bg">
              <p className="text-[8px] font-black uppercase text-theme-text-muted mb-1">US CPI / 실업률</p>
              <p className="text-lg font-bold font-mono">{globalMultiSource.fredData.usCpi}%</p>
              <p className="text-[9px] text-theme-text-muted">실업률 {globalMultiSource.fredData.usUnemployment}%</p>
            </div>
          </div>
        ) : (
          <p className="text-[10px] text-theme-text-muted italic">'글로벌 데이터 수집' 버튼으로 최신 데이터를 불러오세요.</p>
        )}
      </div>

      {/* ── 글로벌 상관관계 매트릭스 (C) ── */}
      <div className="p-4 sm:p-8 border border-theme-text bg-theme-card shadow-[4px_4px_0px_0px_rgba(128,128,128,0.3)]">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-[10px] font-black uppercase tracking-widest text-theme-text-muted">
            글로벌 상관관계 매트릭스 — Decoupling / Synchronization Detector
          </h3>
          <button onClick={loadGlobalCorrelation} disabled={correlationLoading}
            className="flex items-center gap-2 px-3 py-1.5 border border-theme-text bg-theme-card hover:bg-theme-text hover:text-white transition-colors text-[10px] font-black uppercase disabled:opacity-50">
            <RefreshCw size={12} className={correlationLoading ? 'animate-spin' : ''} />
            {correlationLoading ? '분석 중...' : '상관관계 분석'}
          </button>
        </div>
        {globalCorrelation ? (
          <div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
              {[
                { label: 'KOSPI-S&P500', value: globalCorrelation.kospiSp500, normal: '0.6~0.8' },
                { label: 'KOSPI-닛케이', value: globalCorrelation.kospiNikkei, normal: '0.5~0.7' },
                { label: 'KOSPI-상해종합', value: globalCorrelation.kospiShanghai, normal: '0.3~0.6' },
                { label: 'KOSPI-DXY', value: globalCorrelation.kospiDxy, normal: '-0.3~-0.6' },
              ].map(item => (
                <div key={item.label} className="p-3 border border-theme-border bg-theme-bg text-center">
                  <p className="text-[8px] font-black uppercase text-theme-text-muted mb-1">{item.label}</p>
                  <p className={`text-2xl font-bold font-mono ${
                    Math.abs(item.value) > 0.8 ? 'text-red-600' : Math.abs(item.value) < 0.3 ? 'text-purple-600' : 'text-theme-text'
                  }`}>
                    {item.value > 0 ? '+' : ''}{item.value.toFixed(2)}
                  </p>
                  <p className="text-[8px] text-theme-text-muted mt-1">정상: {item.normal}</p>
                </div>
              ))}
            </div>
            {(globalCorrelation.isDecoupling || globalCorrelation.isGlobalSync) && (
              <div className={`p-4 border-2 ${globalCorrelation.isDecoupling ? 'border-purple-400 bg-purple-50' : 'border-red-400 bg-red-50'}`}>
                <p className={`text-sm font-black ${globalCorrelation.isDecoupling ? 'text-purple-700' : 'text-red-700'}`}>
                  {globalCorrelation.isDecoupling
                    ? '⚠ 디커플링 감지: KOSPI-S&P500 상관관계 급락. 한국 특수 요인 발생. 27개 조건 재가중치 필요.'
                    : '⚠ 글로벌 동조화: 상관계수 0.9+. 외부 충격 전이 모드. 미국 시장이 선행지표.'}
                </p>
              </div>
            )}
          </div>
        ) : (
          <p className="text-[10px] text-theme-text-muted italic">'상관관계 분석' 버튼으로 글로벌 상관관계를 분석하세요.</p>
        )}
      </div>

      {/* ── 섹터-테마 역추적 엔진 (H) ── */}
      <div className="p-4 sm:p-8 border border-theme-text bg-theme-card shadow-[4px_4px_0px_0px_rgba(128,128,128,0.3)]">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h3 className="text-[10px] font-black uppercase tracking-widest text-theme-text-muted">
              섹터-테마 역추적 — Global Theme → Korea Hidden Gems
            </h3>
            <p className="text-[8px] text-theme-text-muted mt-1">글로벌 메가트렌드에서 아직 시장이 연결짓지 못한 한국 숨은 수혜주 발굴</p>
          </div>
          <button onClick={loadThemeTracking} disabled={themeLoading}
            className="flex items-center gap-2 px-3 py-1.5 border border-theme-text bg-theme-card hover:bg-theme-text hover:text-white transition-colors text-[10px] font-black uppercase disabled:opacity-50">
            <RefreshCw size={12} className={themeLoading ? 'animate-spin' : ''} />
            {themeLoading ? '역추적 중...' : '테마 역추적 실행'}
          </button>
        </div>
        {themeResults.length > 0 ? (
          <div className="space-y-6">
            {themeResults.map((theme, idx) => (
              <div key={idx} className="border border-theme-border p-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <span className="text-base font-black">{theme.theme}</span>
                    <span className={`text-[9px] font-black px-2 py-0.5 border ${
                      theme.investmentTiming === 'OPTIMAL' ? 'border-green-400 bg-green-50 text-green-700' :
                      theme.investmentTiming === 'TOO_EARLY' ? 'border-blue-400 bg-blue-50 text-blue-700' :
                      theme.investmentTiming === 'LATE' ? 'border-amber-400 bg-amber-50 text-amber-700' :
                      'border-red-400 bg-red-50 text-red-700'
                    }`}>
                      {theme.investmentTiming}
                    </span>
                    <span className={`text-[9px] font-bold px-2 py-0.5 border ${
                      theme.globalTrend.momentum === 'ACCELERATING' ? 'border-green-400 text-green-700' :
                      theme.globalTrend.momentum === 'EMERGING' ? 'border-blue-400 text-blue-700' :
                      'border-theme-border text-theme-text-muted'
                    }`}>
                      {theme.globalTrend.momentum}
                    </span>
                  </div>
                  {theme.globalTrend.globalMarketSize && (
                    <span className="text-[9px] font-mono text-theme-text-muted">{theme.globalTrend.globalMarketSize}</span>
                  )}
                </div>
                <p className="text-[10px] text-theme-text-secondary mb-3">{theme.globalTrend.source}</p>

                {/* Hidden Gems 강조 */}
                {theme.hiddenGems.length > 0 && (
                  <div className="mb-3 p-3 border-2 border-emerald-300 bg-emerald-50">
                    <p className="text-[9px] font-black text-emerald-700 uppercase tracking-widest mb-2">
                      HIDDEN GEMS — 시장 미인지 수혜주
                    </p>
                    <div className="space-y-2">
                      {theme.hiddenGems.map((gem, gIdx) => (
                        <div key={gIdx} className="flex items-center justify-between">
                          <div>
                            <span className="text-sm font-bold text-emerald-800">{gem.company}</span>
                            <span className="text-[9px] text-theme-text-muted ml-2">({gem.code})</span>
                            <span className="text-[9px] text-emerald-600 ml-2">— {gem.role}</span>
                          </div>
                          <div className="text-right">
                            <span className="text-[9px] font-mono text-theme-text-secondary">매출비중 {gem.revenueExposure}%</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* 전체 밸류체인 */}
                <div className="overflow-x-auto">
                  <table className="w-full text-[9px]">
                    <thead>
                      <tr className="border-b border-theme-border">
                        <th className="text-left p-1.5 font-black uppercase">기업</th>
                        <th className="text-left p-1.5 font-black uppercase">코드</th>
                        <th className="text-left p-1.5 font-black uppercase">역할</th>
                        <th className="text-right p-1.5 font-black uppercase">매출비중</th>
                        <th className="text-center p-1.5 font-black uppercase">인지도</th>
                      </tr>
                    </thead>
                    <tbody>
                      {theme.koreaValueChain.map((vc, vIdx) => (
                        <tr key={vIdx} className={`border-b border-theme-border ${vc.marketAttention === 'HIDDEN' ? 'bg-emerald-50' : ''}`}>
                          <td className="p-1.5 font-bold">{vc.company}</td>
                          <td className="p-1.5 font-mono text-theme-text-muted">{vc.code}</td>
                          <td className="p-1.5 text-theme-text-secondary">{vc.role}</td>
                          <td className="p-1.5 text-right font-mono">{vc.revenueExposure}%</td>
                          <td className="p-1.5 text-center">
                            <span className={`px-1.5 py-0.5 text-[8px] font-black ${
                              vc.marketAttention === 'HIDDEN' ? 'bg-emerald-200 text-emerald-800' :
                              vc.marketAttention === 'EMERGING' ? 'bg-blue-200 text-blue-800' :
                              'bg-theme-card text-theme-text-secondary'
                            }`}>
                              {vc.marketAttention}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-[10px] text-theme-text-muted italic">'테마 역추적 실행' 버튼으로 글로벌 테마에서 한국 숨은 수혜주를 발굴하세요.</p>
        )}
      </div>

      {/* ════════════════════════════════════════════════════════════════════
          레이어 I: 공급망 물동량 인텔리전스
         ════════════════════════════════════════════════════════════════════ */}
      <div className="border border-theme-border p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-xs font-black uppercase tracking-widest text-theme-text">
            I. 공급망 물동량 인텔리전스
          </h3>
          <button onClick={loadSupplyChain} disabled={supplyChainLoading}
            className="text-[9px] px-3 py-1 border border-blue-300 text-blue-600 hover:bg-blue-50 font-bold disabled:opacity-50">
            {supplyChainLoading ? '수집 중...' : '공급망 데이터 수집'}
          </button>
        </div>
        {supplyChain ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
            {/* BDI */}
            <div className="border border-theme-border p-3">
              <p className="text-[9px] font-black uppercase text-theme-text-muted mb-2">Baltic Dry Index</p>
              <p className="text-xl font-black">{supplyChain.bdi.current.toLocaleString()}</p>
              <div className="flex items-center gap-2 mt-1">
                <span className={`text-[9px] font-bold px-2 py-0.5 border ${
                  supplyChain.bdi.trend === 'SURGING' || supplyChain.bdi.trend === 'RISING' ? 'border-green-400 text-green-700 bg-green-50' :
                  supplyChain.bdi.trend === 'FALLING' || supplyChain.bdi.trend === 'COLLAPSING' ? 'border-red-400 text-red-700 bg-red-50' :
                  'border-theme-border text-theme-text-muted'
                }`}>{supplyChain.bdi.trend}</span>
                <span className={`text-[10px] font-mono ${supplyChain.bdi.mom3Change >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                  3M {supplyChain.bdi.mom3Change >= 0 ? '+' : ''}{supplyChain.bdi.mom3Change.toFixed(1)}%
                </span>
              </div>
              {supplyChain.bdi.mom3Change >= 20 && (
                <p className="text-[8px] mt-1 px-2 py-0.5 bg-green-100 text-green-800 font-bold">Gate 연동: 조선섹터 Gate 2 완화 -1</p>
              )}
              <p className="text-[9px] text-theme-text-muted mt-2">{supplyChain.bdi.sectorImplication}</p>
            </div>
            {/* SEMI Billings */}
            <div className="border border-theme-border p-3">
              <p className="text-[9px] font-black uppercase text-theme-text-muted mb-2">SEMI N.A. Billings</p>
              <p className="text-xl font-black">${supplyChain.semiBillings.latestBillionUSD.toFixed(1)}B</p>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-[10px] font-mono text-theme-text-secondary">YoY {supplyChain.semiBillings.yoyGrowth >= 0 ? '+' : ''}{supplyChain.semiBillings.yoyGrowth.toFixed(1)}%</span>
                <span className={`text-[9px] font-bold px-2 py-0.5 border ${
                  supplyChain.semiBillings.bookToBill >= 1.1 ? 'border-green-400 text-green-700 bg-green-50' :
                  supplyChain.semiBillings.bookToBill >= 1.0 ? 'border-blue-400 text-blue-700 bg-blue-50' :
                  'border-red-400 text-red-700 bg-red-50'
                }`}>B/B {supplyChain.semiBillings.bookToBill.toFixed(2)}</span>
              </div>
              <p className="text-[9px] text-theme-text-muted mt-2">{supplyChain.semiBillings.implication}</p>
            </div>
            {/* GCFI */}
            <div className="border border-theme-border p-3">
              <p className="text-[9px] font-black uppercase text-theme-text-muted mb-2">Container Freight</p>
              <div className="space-y-1">
                <div className="flex justify-between">
                  <span className="text-[9px] text-theme-text-muted">상하이→유럽</span>
                  <span className="text-sm font-bold">${supplyChain.gcfi.shanghaiEurope.toLocaleString()}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[9px] text-theme-text-muted">태평양 횡단</span>
                  <span className="text-sm font-bold">${supplyChain.gcfi.transPacific.toLocaleString()}</span>
                </div>
              </div>
              <span className={`text-[9px] font-bold px-2 py-0.5 border mt-2 inline-block ${
                supplyChain.gcfi.trend === 'RISING' ? 'border-red-400 text-red-700 bg-red-50' :
                supplyChain.gcfi.trend === 'FALLING' ? 'border-green-400 text-green-700 bg-green-50' :
                'border-theme-border text-theme-text-muted'
              }`}>{supplyChain.gcfi.trend}</span>
            </div>
          </div>
        ) : (
          <p className="text-[10px] text-theme-text-muted italic">BDI·SEMI·컨테이너 운임 데이터를 수집하여 조선·반도체 섹터 선행지표를 확인하세요.</p>
        )}
      </div>

      {/* ════════════════════════════════════════════════════════════════════
          레이어 J: 섹터별 글로벌 수주 인텔리전스
         ════════════════════════════════════════════════════════════════════ */}
      <div className="border border-theme-border p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-xs font-black uppercase tracking-widest text-theme-text">
            J. 섹터별 글로벌 수주 인텔리전스
          </h3>
          <button onClick={loadSectorOrders} disabled={sectorOrdersLoading}
            className="text-[9px] px-3 py-1 border border-amber-300 text-amber-600 hover:bg-amber-50 font-bold disabled:opacity-50">
            {sectorOrdersLoading ? '수집 중...' : '수주 데이터 수집'}
          </button>
        </div>
        {sectorOrders ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
            {/* 방산 */}
            <div className="border border-theme-border p-3">
              <p className="text-[9px] font-black uppercase text-theme-text-muted mb-2">글로벌 방산</p>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-sm font-black">NATO GDP {sectorOrders.globalDefense.natoGdpAvg.toFixed(1)}%</span>
                <span className={`text-[9px] font-bold px-2 py-0.5 border ${
                  sectorOrders.globalDefense.trend === 'EXPANDING' ? 'border-green-400 text-green-700 bg-green-50' :
                  sectorOrders.globalDefense.trend === 'CUTTING' ? 'border-red-400 text-red-700 bg-red-50' :
                  'border-theme-border text-theme-text-muted'
                }`}>{sectorOrders.globalDefense.trend}</span>
              </div>
              <p className="text-[10px] text-theme-text-secondary">미국 국방예산: ${sectorOrders.globalDefense.usDefenseBudget.toLocaleString()}억</p>
              <p className="text-[9px] text-theme-text-muted mt-1">{sectorOrders.globalDefense.koreaExposure}</p>
            </div>
            {/* LNG */}
            <div className="border border-theme-border p-3">
              <p className="text-[9px] font-black uppercase text-theme-text-muted mb-2">LNG 발주</p>
              <p className="text-xl font-black">{sectorOrders.lngOrders.newOrdersYTD}<span className="text-xs font-normal text-theme-text-muted ml-1">척 (YTD)</span></p>
              <p className="text-[10px] text-theme-text-secondary mt-1">수주잔고: {sectorOrders.lngOrders.orderBookMonths}개월</p>
              <p className="text-[9px] text-theme-text-muted mt-1">{sectorOrders.lngOrders.qatarEnergy}</p>
              <p className="text-[9px] text-blue-600 mt-1 font-bold">{sectorOrders.lngOrders.implication}</p>
            </div>
            {/* SMR */}
            <div className="border border-theme-border p-3">
              <p className="text-[9px] font-black uppercase text-theme-text-muted mb-2">SMR 원자력</p>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-sm font-black">{sectorOrders.smrContracts.totalGwCapacity} GW</span>
                <span className={`text-[9px] font-bold px-2 py-0.5 border ${
                  sectorOrders.smrContracts.timing === 'OPTIMAL' ? 'border-green-400 text-green-700 bg-green-50' :
                  sectorOrders.smrContracts.timing === 'TOO_EARLY' ? 'border-blue-400 text-blue-700 bg-blue-50' :
                  'border-amber-400 text-amber-700 bg-amber-50'
                }`}>{sectorOrders.smrContracts.timing}</span>
              </div>
              <p className="text-[10px] text-theme-text-secondary">NRC 승인: {sectorOrders.smrContracts.usNrcApprovals}기</p>
              <p className="text-[9px] text-theme-text-muted mt-1">{sectorOrders.smrContracts.koreaHyundai}</p>
            </div>
          </div>
        ) : (
          <p className="text-[10px] text-theme-text-muted italic">방산·LNG·SMR 글로벌 수주 데이터를 수집하여 조·방·원 주도주 사이클을 검증하세요.</p>
        )}
      </div>

      {/* ════════════════════════════════════════════════════════════════════
          레이어 K: 금융시스템 스트레스 인덱스
         ════════════════════════════════════════════════════════════════════ */}
      <div className="border border-theme-border p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-xs font-black uppercase tracking-widest text-theme-text">
            K. 금융시스템 스트레스 인덱스 (FSI)
          </h3>
          <button onClick={loadFsi} disabled={fsiLoading}
            className="text-[9px] px-3 py-1 border border-red-300 text-red-600 hover:bg-red-50 font-bold disabled:opacity-50">
            {fsiLoading ? '수집 중...' : 'FSI 수집'}
          </button>
        </div>
        {fsi ? (
          <div>
            {/* 종합 스코어 바 */}
            <div className="mb-4">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[9px] font-bold text-theme-text-muted">종합 FSI</span>
                <span className={`text-sm font-black ${
                  fsi.compositeScore >= 60 ? 'text-red-600' : fsi.compositeScore >= 40 ? 'text-amber-600' : fsi.compositeScore >= 20 ? 'text-yellow-600' : 'text-green-600'
                }`}>{fsi.compositeScore}/100</span>
              </div>
              <div className="w-full h-3 bg-theme-card overflow-hidden">
                <div className={`h-full transition-all ${
                  fsi.compositeScore >= 60 ? 'bg-red-500' : fsi.compositeScore >= 40 ? 'bg-amber-500' : fsi.compositeScore >= 20 ? 'bg-yellow-400' : 'bg-green-400'
                }`} style={{ width: `${fsi.compositeScore}%` }} />
              </div>
              <div className="flex justify-between mt-1">
                <span className="text-[8px] text-theme-text-muted">NORMAL</span>
                <span className="text-[8px] text-theme-text-muted">CAUTION</span>
                <span className="text-[8px] text-theme-text-muted">DEFENSIVE</span>
                <span className="text-[8px] text-theme-text-muted">CRISIS</span>
              </div>
            </div>
            <div className={`text-center py-2 mb-4 font-black text-xs ${
              fsi.systemAction === 'CRISIS' ? 'bg-red-100 text-red-800 border border-red-300' :
              fsi.systemAction === 'DEFENSIVE' ? 'bg-amber-100 text-amber-800 border border-amber-300' :
              fsi.systemAction === 'CAUTION' ? 'bg-yellow-100 text-yellow-800 border border-yellow-300' :
              'bg-green-100 text-green-800 border border-green-300'
            }`}>
              {fsi.systemAction === 'CRISIS' ? 'Gate 0 매수 중단 강제 발동 · Kelly 0%' :
               fsi.systemAction === 'DEFENSIVE' ? 'Gate 기준 대폭 강화 · 현금 80%' :
               fsi.systemAction === 'CAUTION' ? '주의 모드 · 신규 매수 축소' :
               '정상 · 금융시스템 안정'}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
              <div className="border border-theme-border p-3 text-center">
                <p className="text-[9px] font-black uppercase text-theme-text-muted mb-1">TED Spread</p>
                <p className="text-lg font-black">{fsi.tedSpread.bps}<span className="text-[9px] font-normal text-theme-text-muted ml-1">bp</span></p>
                <span className={`text-[9px] font-bold px-2 py-0.5 border ${
                  fsi.tedSpread.alert === 'CRISIS' ? 'border-red-400 text-red-700 bg-red-50' :
                  fsi.tedSpread.alert === 'ELEVATED' ? 'border-amber-400 text-amber-700 bg-amber-50' :
                  'border-green-400 text-green-700 bg-green-50'
                }`}>{fsi.tedSpread.alert}</span>
              </div>
              <div className="border border-theme-border p-3 text-center">
                <p className="text-[9px] font-black uppercase text-theme-text-muted mb-1">US HY Spread</p>
                <p className="text-lg font-black">{fsi.usHySpread.bps}<span className="text-[9px] font-normal text-theme-text-muted ml-1">bp</span></p>
                <span className={`text-[9px] font-bold px-2 py-0.5 border ${
                  fsi.usHySpread.trend === 'WIDENING' ? 'border-red-400 text-red-700 bg-red-50' :
                  fsi.usHySpread.trend === 'TIGHTENING' ? 'border-green-400 text-green-700 bg-green-50' :
                  'border-theme-border text-theme-text-muted'
                }`}>{fsi.usHySpread.trend}</span>
              </div>
              <div className="border border-theme-border p-3 text-center">
                <p className="text-[9px] font-black uppercase text-theme-text-muted mb-1">MOVE Index</p>
                <p className="text-lg font-black">{fsi.moveIndex.current}</p>
                <span className={`text-[9px] font-bold px-2 py-0.5 border ${
                  fsi.moveIndex.alert === 'EXTREME' ? 'border-red-400 text-red-700 bg-red-50' :
                  fsi.moveIndex.alert === 'ELEVATED' ? 'border-amber-400 text-amber-700 bg-amber-50' :
                  'border-green-400 text-green-700 bg-green-50'
                }`}>{fsi.moveIndex.alert}</span>
              </div>
            </div>
          </div>
        ) : (
          <p className="text-[10px] text-theme-text-muted italic">TED Spread·HY Spread·MOVE Index를 수집하여 금융위기 조기경보를 확인하세요.</p>
        )}
      </div>

      {/* ════════════════════════════════════════════════════════════════════
          레이어 L: FOMC 문서 감성 분석
         ════════════════════════════════════════════════════════════════════ */}
      <div className="border border-theme-border p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-xs font-black uppercase tracking-widest text-theme-text">
            L. FOMC 감성 분석
          </h3>
          <button onClick={loadFomcSentiment} disabled={fomcLoading}
            className="text-[9px] px-3 py-1 border border-indigo-300 text-indigo-600 hover:bg-indigo-50 font-bold disabled:opacity-50">
            {fomcLoading ? '분석 중...' : 'FOMC 분석 실행'}
          </button>
        </div>
        {fomcSentiment ? (
          <div>
            {/* 매파/비둘기파 게이지 */}
            <div className="mb-4">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[9px] font-bold text-blue-500">극비둘기 -10</span>
                <span className="text-[9px] font-bold text-theme-text-muted">HAWK/DOVE SCORE</span>
                <span className="text-[9px] font-bold text-red-500">극매파 +10</span>
              </div>
              <div className="relative w-full h-4 bg-gradient-to-r from-blue-200 via-gray-200 to-red-200 overflow-hidden">
                <div className="absolute top-0 h-full w-1 bg-black" style={{ left: `${(fomcSentiment.hawkDovishScore + 10) / 20 * 100}%` }} />
              </div>
              <p className="text-center text-lg font-black mt-2">
                {fomcSentiment.hawkDovishScore > 0 ? '+' : ''}{fomcSentiment.hawkDovishScore}
                <span className="text-xs font-normal text-theme-text-muted ml-2">
                  {fomcSentiment.hawkDovishScore >= 5 ? '매파적' : fomcSentiment.hawkDovishScore <= -5 ? '비둘기파적' : '중립'}
                </span>
              </p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 mb-4">
              <div className="border border-theme-border p-3 text-center">
                <p className="text-[9px] font-black uppercase text-theme-text-muted mb-1">점도표 변화</p>
                <span className={`text-xs font-bold px-3 py-1 border ${
                  fomcSentiment.dotPlotShift === 'MORE_CUTS' ? 'border-green-400 text-green-700 bg-green-50' :
                  fomcSentiment.dotPlotShift === 'FEWER_CUTS' ? 'border-red-400 text-red-700 bg-red-50' :
                  'border-theme-border text-theme-text-muted'
                }`}>{fomcSentiment.dotPlotShift}</span>
              </div>
              <div className="border border-theme-border p-3 text-center">
                <p className="text-[9px] font-black uppercase text-theme-text-muted mb-1">KOSPI 임팩트</p>
                <span className={`text-xs font-bold px-3 py-1 border ${
                  fomcSentiment.kospiImpact === 'BULLISH' ? 'border-green-400 text-green-700 bg-green-50' :
                  fomcSentiment.kospiImpact === 'BEARISH' ? 'border-red-400 text-red-700 bg-red-50' :
                  'border-theme-border text-theme-text-muted'
                }`}>{fomcSentiment.kospiImpact}</span>
              </div>
              <div className="border border-theme-border p-3">
                <p className="text-[9px] font-black uppercase text-theme-text-muted mb-1">핵심 문구</p>
                <div className="flex flex-wrap gap-1">
                  {fomcSentiment.keyPhrases.map((phrase, i) => (
                    <span key={i} className="text-[8px] px-1.5 py-0.5 bg-theme-card text-theme-text-secondary border border-theme-border">{phrase}</span>
                  ))}
                </div>
              </div>
            </div>
            <p className="text-[10px] text-theme-text-secondary italic">{fomcSentiment.rationale}</p>
          </div>
        ) : (
          <p className="text-[10px] text-theme-text-muted italic">FOMC 의사록/성명서 매파·비둘기파 분석으로 한국 증시 영향을 정량화하세요.</p>
        )}
      </div>
    </>
  );
}
