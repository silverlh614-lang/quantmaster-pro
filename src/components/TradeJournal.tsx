import React, { useState, useMemo } from 'react';
import {
  TradeRecord, ConditionPerformance, SystemVsIntuitionStats, ConditionId,
} from '../types/quant';
import { ALL_CONDITIONS, CONDITION_SOURCE_MAP, getEvolutionWeightsFromPerformance } from '../services/quantEngine';

// ─── Helper: 조건별 성과 계산 ────────────────────────────────────────────────────

export function computeConditionPerformance(
  closedTrades: TradeRecord[],
): ConditionPerformance[] {
  const conditionIds = Object.keys(ALL_CONDITIONS).map(Number) as ConditionId[];

  return conditionIds.map(id => {
    const cond = ALL_CONDITIONS[id];
    // 해당 조건 점수 ≥ 5 였던 매매들
    const relevant = closedTrades.filter(t => (t.conditionScores[id] ?? 0) >= 5);
    const highScore = closedTrades.filter(t => (t.conditionScores[id] ?? 0) >= 7);
    const lowScore = closedTrades.filter(t => (t.conditionScores[id] ?? 0) < 5);
    const wins = relevant.filter(t => (t.returnPct ?? 0) > 0);
    const losses = relevant.filter(t => (t.returnPct ?? 0) <= 0);

    const avgHigh = highScore.length > 0
      ? highScore.reduce((s, t) => s + (t.returnPct ?? 0), 0) / highScore.length : 0;
    const avgLow = lowScore.length > 0
      ? lowScore.reduce((s, t) => s + (t.returnPct ?? 0), 0) / lowScore.length : 0;

    // 동적 가중치: 승률 기반 (최소 10건 이상이어야 의미 있는 업데이트)
    let evoWeight = 1.0;
    if (relevant.length >= 10) {
      const winRate = wins.length / relevant.length;
      // 승률 60% → 1.2, 40% → 0.8, 50% → 1.0
      evoWeight = parseFloat((0.4 + winRate * 1.2).toFixed(2));
      evoWeight = Math.max(0.5, Math.min(1.5, evoWeight));
    }

    return {
      conditionId: id,
      conditionName: cond?.name ?? `조건 ${id}`,
      totalTrades: relevant.length,
      winTrades: wins.length,
      lossTrades: losses.length,
      avgReturnWhenHigh: parseFloat(avgHigh.toFixed(2)),
      avgReturnWhenLow: parseFloat(avgLow.toFixed(2)),
      evolutionWeight: evoWeight,
      lastUpdated: new Date().toISOString(),
    };
  });
}

// ─── Helper: 시스템 vs 직관 통계 ─────────────────────────────────────────────────

export function computeSystemVsIntuition(
  closedTrades: TradeRecord[],
): SystemVsIntuitionStats {
  const sys = closedTrades.filter(t => t.followedSystem);
  const int_ = closedTrades.filter(t => !t.followedSystem);

  const calcStats = (trades: TradeRecord[]) => {
    const wins = trades.filter(t => (t.returnPct ?? 0) > 0);
    const avg = trades.length > 0
      ? trades.reduce((s, t) => s + (t.returnPct ?? 0), 0) / trades.length : 0;
    const mdd = trades.length > 0
      ? Math.min(0, ...trades.map(t => t.returnPct ?? 0)) : 0;
    return { count: trades.length, wins: wins.length, avg: parseFloat(avg.toFixed(2)), mdd: parseFloat(mdd.toFixed(2)) };
  };

  const s = calcStats(sys);
  const i = calcStats(int_);
  const sWinRate = s.count > 0 ? parseFloat(((s.wins / s.count) * 100).toFixed(1)) : 0;
  const iWinRate = i.count > 0 ? parseFloat(((i.wins / i.count) * 100).toFixed(1)) : 0;

  return {
    systemTrades: s.count, systemWins: s.wins, systemAvgReturn: s.avg, systemMaxDrawdown: s.mdd,
    intuitionTrades: i.count, intuitionWins: i.wins, intuitionAvgReturn: i.avg, intuitionMaxDrawdown: i.mdd,
    systemWinRate: sWinRate, intuitionWinRate: iWinRate,
    systemEdge: parseFloat((sWinRate - iWinRate).toFixed(1)),
    lastUpdated: new Date().toISOString(),
  };
}

// ─── Main Component ──────────────────────────────────────────────────────────────

type Tab = 'JOURNAL' | 'CONDITIONS' | 'SYSTEM_VS_INTUITION';

interface Props {
  trades: TradeRecord[];
  onCloseTrade: (tradeId: string, sellPrice: number, sellReason: TradeRecord['sellReason']) => void;
  onDeleteTrade: (tradeId: string) => void;
  onUpdateMemo: (tradeId: string, memo: string) => void;
  onTriggerPreMortem?: (tradeId: string, preMortemId: string) => void;
}

export const TradeJournal: React.FC<Props> = ({
  trades,
  onCloseTrade,
  onDeleteTrade,
  onUpdateMemo,
  onTriggerPreMortem,
}) => {
  const [tab, setTab] = useState<Tab>('JOURNAL');
  const [filter, setFilter] = useState<'ALL' | 'OPEN' | 'CLOSED'>('ALL');
  const [closingTradeId, setClosingTradeId] = useState<string | null>(null);
  const [closeSellPrice, setCloseSellPrice] = useState('');
  const [closeSellReason, setCloseSellReason] = useState<TradeRecord['sellReason']>('MANUAL');
  const [editingMemoId, setEditingMemoId] = useState<string | null>(null);
  const [memoInput, setMemoInput] = useState('');
  const [sortBy, setSortBy] = useState<'date' | 'return'>('date');

  const openTrades = useMemo(() => trades.filter(t => t.status === 'OPEN'), [trades]);
  const closedTrades = useMemo(() => trades.filter(t => t.status === 'CLOSED'), [trades]);

  const filteredTrades = useMemo(() => {
    let list = filter === 'ALL' ? trades : filter === 'OPEN' ? openTrades : closedTrades;
    if (sortBy === 'date') {
      list = [...list].sort((a, b) => new Date(b.buyDate).getTime() - new Date(a.buyDate).getTime());
    } else {
      list = [...list].sort((a, b) => {
        const ra = a.status === 'CLOSED' ? (a.returnPct ?? 0) : (a.unrealizedPct ?? 0);
        const rb = b.status === 'CLOSED' ? (b.returnPct ?? 0) : (b.unrealizedPct ?? 0);
        return rb - ra;
      });
    }
    return list;
  }, [trades, openTrades, closedTrades, filter, sortBy]);

  // 전체 통계
  const totalStats = useMemo(() => {
    const total = closedTrades.length;
    const wins = closedTrades.filter(t => (t.returnPct ?? 0) > 0).length;
    const avgRet = total > 0
      ? closedTrades.reduce((s, t) => s + (t.returnPct ?? 0), 0) / total : 0;
    const totalPnl = closedTrades.reduce((s, t) => s + ((t.returnPct ?? 0) / 100 * t.buyPrice * t.quantity), 0);
    const unrealized = openTrades.reduce((s, t) => {
      if (t.currentPrice) return s + ((t.currentPrice - t.buyPrice) / t.buyPrice * 100 * t.buyPrice * t.quantity / 100);
      return s;
    }, 0);
    return {
      total, wins, winRate: total > 0 ? ((wins / total) * 100) : 0,
      avgRet, totalPnl, unrealized,
    };
  }, [closedTrades, openTrades]);

  const condPerf = useMemo(() => computeConditionPerformance(closedTrades), [closedTrades]);
  const sysVsInt = useMemo(() => computeSystemVsIntuition(closedTrades), [closedTrades]);

  const handleCloseSubmit = () => {
    if (!closingTradeId || !closeSellPrice) return;
    onCloseTrade(closingTradeId, parseFloat(closeSellPrice), closeSellReason);
    setClosingTradeId(null);
    setCloseSellPrice('');
  };

  const handleMemoSave = () => {
    if (editingMemoId) {
      onUpdateMemo(editingMemoId, memoInput);
      setEditingMemoId(null);
      setMemoInput('');
    }
  };

  return (
    <div className="space-y-6">
      {/* ── Header KPIs ──────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3">
        {[
          { label: '총 매매', value: `${closedTrades.length + openTrades.length}건`, sub: `OPEN ${openTrades.length} · CLOSED ${closedTrades.length}` },
          { label: '승률', value: `${totalStats.winRate.toFixed(1)}%`, sub: `${totalStats.wins}W / ${totalStats.total - totalStats.wins}L` },
          { label: '평균 수익률', value: `${totalStats.avgRet >= 0 ? '+' : ''}${totalStats.avgRet.toFixed(2)}%`, sub: totalStats.avgRet >= 0 ? '양호' : '개선 필요' },
          { label: '실현 손익', value: `${totalStats.totalPnl >= 0 ? '+' : ''}${Math.round(totalStats.totalPnl).toLocaleString()}원`, sub: '매도 완료 기준' },
          { label: '미실현 손익', value: `${totalStats.unrealized >= 0 ? '+' : ''}${Math.round(totalStats.unrealized).toLocaleString()}원`, sub: '보유 중 기준' },
          { label: '시스템 엣지', value: `${sysVsInt.systemEdge >= 0 ? '+' : ''}${sysVsInt.systemEdge}%p`, sub: sysVsInt.systemEdge > 0 ? '시스템 우위' : sysVsInt.systemEdge < 0 ? '직관 우위' : '동등' },
        ].map((kpi, i) => (
          <div key={i} className="border border-gray-200 p-3 text-center">
            <p className="text-[9px] font-black uppercase text-gray-400 tracking-widest">{kpi.label}</p>
            <p className={`text-lg font-black ${kpi.value.startsWith('+') ? 'text-green-600' : kpi.value.startsWith('-') ? 'text-red-600' : 'text-gray-800'}`}>{kpi.value}</p>
            <p className="text-[8px] text-gray-400">{kpi.sub}</p>
          </div>
        ))}
      </div>

      {/* ── Tab Navigation ───────────────────────────────────────── */}
      <div className="flex gap-1 border-b border-gray-200">
        {([
          { key: 'JOURNAL' as Tab, label: '매매 일지' },
          { key: 'CONDITIONS' as Tab, label: '27조건 승률' },
          { key: 'SYSTEM_VS_INTUITION' as Tab, label: '시스템 vs 직관' },
        ]).map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-xs font-bold uppercase tracking-widest border-b-2 transition-colors ${
              tab === t.key ? 'border-black text-black' : 'border-transparent text-gray-400 hover:text-gray-600'
            }`}>{t.label}</button>
        ))}
      </div>

      {/* ═══════ TAB 1: 매매 일지 ═══════ */}
      {tab === 'JOURNAL' && (
        <div>
          <div className="flex items-center gap-3 mb-4">
            {(['ALL', 'OPEN', 'CLOSED'] as const).map(f => (
              <button key={f} onClick={() => setFilter(f)}
                className={`text-[9px] px-3 py-1 font-bold uppercase border ${
                  filter === f ? 'bg-black text-white border-black' : 'border-gray-300 text-gray-500 hover:bg-gray-50'
                }`}>{f} {f === 'OPEN' ? `(${openTrades.length})` : f === 'CLOSED' ? `(${closedTrades.length})` : `(${trades.length})`}</button>
            ))}
            <div className="ml-auto flex gap-2">
              <button onClick={() => setSortBy('date')}
                className={`text-[9px] px-2 py-1 border ${sortBy === 'date' ? 'bg-gray-800 text-white border-gray-800' : 'border-gray-300 text-gray-500'}`}>날짜순</button>
              <button onClick={() => setSortBy('return')}
                className={`text-[9px] px-2 py-1 border ${sortBy === 'return' ? 'bg-gray-800 text-white border-gray-800' : 'border-gray-300 text-gray-500'}`}>수익률순</button>
            </div>
          </div>

          {filteredTrades.length === 0 ? (
            <div className="text-center py-12 text-gray-400">
              <p className="text-sm font-bold">매매 기록이 없습니다</p>
              <p className="text-[10px] mt-1">종목 상세에서 '매수 기록' 버튼을 눌러 첫 매매를 기록하세요.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {filteredTrades.map(trade => {
                const pnlPct = trade.status === 'CLOSED' ? (trade.returnPct ?? 0)
                  : trade.currentPrice ? ((trade.currentPrice - trade.buyPrice) / trade.buyPrice * 100) : 0;
                const isProfit = pnlPct > 0;
                return (
                  <div key={trade.id} className={`border p-4 ${
                    trade.status === 'CLOSED'
                      ? isProfit ? 'border-green-200 bg-green-50/30' : 'border-red-200 bg-red-50/30'
                      : 'border-gray-200'
                  }`}>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div>
                          <span className="text-sm font-black">{trade.stockName}</span>
                          <span className="text-[9px] text-gray-400 ml-2 font-mono">{trade.stockCode}</span>
                          <span className="text-[9px] text-gray-400 ml-2">{trade.sector}</span>
                        </div>
                        <span className={`text-[8px] font-bold px-2 py-0.5 border ${
                          trade.status === 'OPEN' ? 'border-blue-300 text-blue-600 bg-blue-50' :
                          isProfit ? 'border-green-300 text-green-600 bg-green-50' :
                          'border-red-300 text-red-600 bg-red-50'
                        }`}>{trade.status}</span>
                        <span className={`text-[8px] font-bold px-2 py-0.5 border ${
                          trade.followedSystem ? 'border-indigo-300 text-indigo-600 bg-indigo-50' : 'border-amber-300 text-amber-600 bg-amber-50'
                        }`}>{trade.followedSystem ? 'SYSTEM' : 'INTUITION'}</span>
                        <span className={`text-[8px] font-bold px-2 py-0.5 border ${
                          trade.systemSignal === 'STRONG_BUY' ? 'border-green-400 text-green-700' :
                          trade.systemSignal === 'BUY' ? 'border-blue-400 text-blue-700' :
                          'border-gray-300 text-gray-500'
                        }`}>{trade.systemSignal}</span>
                      </div>
                      <div className="text-right">
                        <p className={`text-lg font-black ${isProfit ? 'text-green-600' : pnlPct < 0 ? 'text-red-600' : 'text-gray-600'}`}>
                          {pnlPct >= 0 ? '+' : ''}{pnlPct.toFixed(2)}%
                        </p>
                        <p className="text-[9px] text-gray-400">
                          {trade.buyDate.split('T')[0]}{trade.sellDate ? ` → ${trade.sellDate.split('T')[0]}` : ' → 보유 중'}
                          {trade.holdingDays !== undefined && ` (${trade.holdingDays}일)`}
                        </p>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3 mt-3 text-[9px]">
                      <div>
                        <span className="text-gray-400">매수가</span>
                        <p className="font-bold">{trade.buyPrice.toLocaleString()}원</p>
                      </div>
                      <div>
                        <span className="text-gray-400">{trade.status === 'CLOSED' ? '매도가' : '현재가'}</span>
                        <p className="font-bold">{(trade.status === 'CLOSED' ? trade.sellPrice : trade.currentPrice ?? trade.buyPrice)?.toLocaleString()}원</p>
                      </div>
                      <div>
                        <span className="text-gray-400">수량</span>
                        <p className="font-bold">{trade.quantity.toLocaleString()}주</p>
                      </div>
                      <div>
                        <span className="text-gray-400">비중</span>
                        <p className="font-bold">{trade.positionSize}%</p>
                      </div>
                      <div>
                        <span className="text-gray-400">Final Score</span>
                        <p className="font-bold">{trade.finalScore.toFixed(1)}</p>
                      </div>
                    </div>

                    {/* Gate 스코어 미니바 */}
                    <div className="flex gap-2 mt-2">
                      {[
                        { label: 'G1', score: trade.gate1Score, max: 50 },
                        { label: 'G2', score: trade.gate2Score, max: 120 },
                        { label: 'G3', score: trade.gate3Score, max: 100 },
                      ].map(g => (
                        <div key={g.label} className="flex items-center gap-1 text-[8px]">
                          <span className="text-gray-400 w-5">{g.label}</span>
                          <div className="w-16 h-1.5 bg-gray-100">
                            <div className="h-full bg-gray-600" style={{ width: `${Math.min(100, (g.score / g.max) * 100)}%` }} />
                          </div>
                          <span className="text-gray-500 font-mono w-8">{g.score.toFixed(0)}</span>
                        </div>
                      ))}
                    </div>

                    {/* Pre-Mortem 무효화 조건 체크리스트 */}
                    {trade.preMortems && trade.preMortems.length > 0 && (
                      <div className="mt-3 border border-gray-200 rounded p-2">
                        <p className="text-[8px] font-black uppercase tracking-widest text-gray-400 mb-1.5">🧨 Pre-Mortem 무효화 조건</p>
                        <div className="space-y-1">
                          {trade.preMortems.map(pm => (
                            <div key={pm.id} className={`flex items-center justify-between text-[8px] px-2 py-1 rounded ${pm.triggered ? 'bg-red-50 border border-red-200' : 'bg-gray-50 border border-gray-100'}`}>
                              <div className="flex items-center gap-1.5 min-w-0">
                                <span className={pm.triggered ? 'text-red-500' : 'text-gray-300'}>
                                  {pm.triggered ? '🔴' : '⚪'}
                                </span>
                                <span className={`font-bold ${pm.triggered ? 'text-red-600' : 'text-gray-600'}`}>{pm.scenario}</span>
                                <span className={`${pm.triggered ? 'text-red-400' : 'text-gray-400'}`}>→ {pm.trigger}</span>
                              </div>
                              <div className="flex items-center gap-1.5 shrink-0 ml-2">
                                <span className={`font-black px-1 py-0.5 rounded text-[7px] ${
                                  pm.actionPct === 100 ? 'bg-red-100 text-red-600' :
                                  pm.actionPct !== undefined ? 'bg-amber-100 text-amber-600' :
                                  'bg-slate-100 text-slate-500'
                                }`}>{pm.action}</span>
                                {trade.status === 'OPEN' && !pm.triggered && onTriggerPreMortem && (
                                  <button
                                    onClick={() => onTriggerPreMortem(trade.id, pm.id)}
                                    className="text-[7px] px-1.5 py-0.5 border border-red-300 text-red-500 hover:bg-red-50 font-bold rounded"
                                  >
                                    발동
                                  </button>
                                )}
                                {pm.triggered && pm.triggeredAt && (
                                  <span className="text-[7px] text-red-400 font-mono">{pm.triggeredAt.split('T')[0]}</span>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* 매도 / 메모 / 삭제 버튼 */}
                    <div className="flex items-center gap-2 mt-3">
                      {trade.status === 'OPEN' && (
                        closingTradeId === trade.id ? (
                          <div className="flex items-center gap-2">
                            <input type="number" placeholder="매도가" value={closeSellPrice} onChange={e => setCloseSellPrice(e.target.value)}
                              className="w-28 text-xs border border-gray-300 px-2 py-1" />
                            <select value={closeSellReason} onChange={e => setCloseSellReason(e.target.value as TradeRecord['sellReason'])}
                              className="text-[9px] border border-gray-300 px-2 py-1">
                              <option value="TARGET_HIT">목표가 도달</option>
                              <option value="STOP_LOSS">손절</option>
                              <option value="TRAILING_STOP">트레일링 스탑</option>
                              <option value="SELL_SIGNAL">매도 신호</option>
                              <option value="MANUAL">수동 매도</option>
                            </select>
                            <button onClick={handleCloseSubmit} className="text-[9px] px-3 py-1 bg-red-600 text-white font-bold">확인</button>
                            <button onClick={() => setClosingTradeId(null)} className="text-[9px] px-3 py-1 border border-gray-300 text-gray-500">취소</button>
                          </div>
                        ) : (
                          <button onClick={() => setClosingTradeId(trade.id)} className="text-[9px] px-3 py-1 border border-red-300 text-red-600 hover:bg-red-50 font-bold">매도 기록</button>
                        )
                      )}
                      {trade.sellReason && (
                        <span className="text-[8px] text-gray-400 px-2 py-0.5 border border-gray-200">{trade.sellReason}</span>
                      )}
                      {editingMemoId === trade.id ? (
                        <div className="flex items-center gap-1 ml-auto">
                          <input type="text" value={memoInput} onChange={e => setMemoInput(e.target.value)} placeholder="메모 입력"
                            className="w-48 text-[9px] border border-gray-300 px-2 py-1" />
                          <button onClick={handleMemoSave} className="text-[9px] px-2 py-1 bg-gray-700 text-white font-bold">저장</button>
                          <button onClick={() => setEditingMemoId(null)} className="text-[9px] px-2 py-1 border border-gray-300 text-gray-500">취소</button>
                        </div>
                      ) : (
                        <button onClick={() => { setEditingMemoId(trade.id); setMemoInput(trade.memo ?? ''); }}
                          className="text-[9px] px-3 py-1 border border-gray-300 text-gray-500 hover:bg-gray-50">{trade.memo ? '메모 수정' : '메모 추가'}</button>
                      )}
                      <button onClick={() => onDeleteTrade(trade.id)}
                        className="text-[9px] px-2 py-1 border border-gray-200 text-gray-400 hover:text-red-500 hover:border-red-300 ml-auto">삭제</button>
                    </div>
                    {trade.memo && editingMemoId !== trade.id && (
                      <p className="text-[9px] text-gray-500 mt-2 italic border-l-2 border-gray-200 pl-2">{trade.memo}</p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ═══════ TAB 2: 27조건 실전 승률 ═══════ */}
      {tab === 'CONDITIONS' && (
        <div>
          {closedTrades.length < 5 ? (
            <div className="text-center py-12 text-gray-400">
              <p className="text-sm font-bold">최소 5건의 매매 종료 후 분석 가능</p>
              <p className="text-[10px] mt-1">현재 {closedTrades.length}건 완료. {Math.max(0, 5 - closedTrades.length)}건 더 필요합니다.</p>
            </div>
          ) : (
            <div>
              <p className="text-[9px] text-gray-500 mb-4">
                매매 {closedTrades.length}건 기반. 10건 이상 누적 시 가중치 자동 업데이트 (EVOLUTION_WEIGHTS) 적용.
                <span className="text-amber-600 font-bold ml-1">
                  {closedTrades.length >= 10 ? '동적 가중치 활성화됨' : `${10 - closedTrades.length}건 더 필요`}
                </span>
              </p>

              {/* ── 귀인 분석: 승리 패턴 Top-3 + 자기진화 현황 ── */}
              {(() => {
                // 승률 상위 조건 (최소 3건 이상)
                const topWinners = condPerf
                  .filter(c => c.totalTrades >= 3)
                  .map(c => ({ ...c, winRate: c.totalTrades > 0 ? (c.winTrades / c.totalTrades) * 100 : 0 }))
                  .sort((a, b) => b.winRate - a.winRate)
                  .slice(0, 3);

                // 자기진화 현황: 기본값(1.0)에서 변경된 조건
                const savedWeights = getEvolutionWeightsFromPerformance();
                const boosted = Object.entries(savedWeights).filter(([, w]) => w > 1.05).map(([id]) => Number(id));
                const reduced = Object.entries(savedWeights).filter(([, w]) => w < 0.95).map(([id]) => Number(id));

                // 가장 성과 좋은 실계산+AI 조건 혼합 패턴 찾기
                const winningComputedConditions = topWinners
                  .filter(c => CONDITION_SOURCE_MAP[c.conditionId as ConditionId] === 'COMPUTED')
                  .slice(0, 2)
                  .map(c => ALL_CONDITIONS[c.conditionId as ConditionId]?.name ?? `조건${c.conditionId}`);
                const winningAiConditions = topWinners
                  .filter(c => CONDITION_SOURCE_MAP[c.conditionId as ConditionId] === 'AI')
                  .slice(0, 1)
                  .map(c => ALL_CONDITIONS[c.conditionId as ConditionId]?.name ?? `조건${c.conditionId}`);
                const patternParts = [...winningComputedConditions, ...winningAiConditions];

                return (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
                    {/* 승리 패턴 Top-3 */}
                    <div className="border border-green-200 bg-green-50/50 p-4 rounded-lg">
                      <p className="text-[9px] font-black uppercase tracking-widest text-green-700 mb-3">
                        귀인 분석 — 승리 조건 Top-3
                      </p>
                      {topWinners.length > 0 ? (
                        <div className="space-y-2">
                          {topWinners.map((c, i) => (
                            <div key={c.conditionId} className="flex items-center gap-2">
                              <span className="text-[9px] font-black text-gray-400 w-4">{i + 1}</span>
                              <div className="flex-1">
                                <div className="flex items-center justify-between mb-0.5">
                                  <span className="text-[10px] font-bold text-gray-800">
                                    {ALL_CONDITIONS[c.conditionId as ConditionId]?.name ?? `조건${c.conditionId}`}
                                  </span>
                                  <span className={`text-[9px] font-black ${c.winRate >= 60 ? 'text-green-600' : 'text-amber-600'}`}>
                                    {c.winRate.toFixed(0)}%
                                  </span>
                                </div>
                                <div className="h-1 w-full bg-gray-200 rounded">
                                  <div className={`h-full rounded ${c.winRate >= 60 ? 'bg-green-500' : 'bg-amber-400'}`}
                                    style={{ width: `${c.winRate}%` }} />
                                </div>
                              </div>
                              <span className={`text-[8px] px-1 py-0.5 border rounded shrink-0 ${
                                CONDITION_SOURCE_MAP[c.conditionId as ConditionId] === 'COMPUTED'
                                  ? 'border-green-400 text-green-700' : 'border-red-300 text-red-600'
                              }`}>
                                {CONDITION_SOURCE_MAP[c.conditionId as ConditionId] === 'COMPUTED' ? '실계산' : 'AI'}
                              </span>
                            </div>
                          ))}
                          {patternParts.length >= 2 && (
                            <p className="text-[9px] text-green-700 font-bold mt-2 pt-2 border-t border-green-200">
                              현재 핵심 패턴: {patternParts.join(' + ')}
                            </p>
                          )}
                        </div>
                      ) : (
                        <p className="text-[10px] text-gray-400">3건 이상 매매된 조건이 없습니다.</p>
                      )}
                    </div>

                    {/* 자기진화 현황 */}
                    <div className="border border-gray-200 bg-gray-50/50 p-4 rounded-lg">
                      <p className="text-[9px] font-black uppercase tracking-widest text-gray-600 mb-3">
                        자기진화 현황 — Evolution Weights
                      </p>
                      {boosted.length === 0 && reduced.length === 0 ? (
                        <p className="text-[10px] text-gray-400">
                          {closedTrades.length >= 10
                            ? '10건 누적됨 — 가중치가 기본값(1.0)과 동일합니다.'
                            : `${10 - closedTrades.length}건 더 쌓이면 자동 진화 시작`}
                        </p>
                      ) : (
                        <div className="space-y-1.5">
                          {boosted.length > 0 && (
                            <div>
                              <p className="text-[8px] font-black text-green-600 uppercase mb-1">↑ 가중치 상향 ({boosted.length}개)</p>
                              <div className="flex flex-wrap gap-1">
                                {boosted.map(id => (
                                  <span key={id} className="text-[8px] px-1.5 py-0.5 bg-green-100 border border-green-300 text-green-700 rounded font-bold">
                                    {ALL_CONDITIONS[id as ConditionId]?.name ?? `#${id}`} ×{(savedWeights[id] ?? 1).toFixed(2)}
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}
                          {reduced.length > 0 && (
                            <div>
                              <p className="text-[8px] font-black text-red-500 uppercase mb-1">↓ 가중치 하향 ({reduced.length}개)</p>
                              <div className="flex flex-wrap gap-1">
                                {reduced.map(id => (
                                  <span key={id} className="text-[8px] px-1.5 py-0.5 bg-red-50 border border-red-200 text-red-600 rounded font-bold">
                                    {ALL_CONDITIONS[id as ConditionId]?.name ?? `#${id}`} ×{(savedWeights[id] ?? 1).toFixed(2)}
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })()}
              <div className="overflow-x-auto">
                <table className="w-full text-[9px]">
                  <thead>
                    <tr className="border-b-2 border-gray-300">
                      <th className="text-left p-2 font-black uppercase">#</th>
                      <th className="text-left p-2 font-black uppercase">조건명</th>
                      <th className="text-right p-2 font-black uppercase">매매수</th>
                      <th className="text-right p-2 font-black uppercase">승/패</th>
                      <th className="text-right p-2 font-black uppercase">승률</th>
                      <th className="text-right p-2 font-black uppercase">고점수 평균수익</th>
                      <th className="text-right p-2 font-black uppercase">저점수 평균수익</th>
                      <th className="text-right p-2 font-black uppercase">진화 가중치</th>
                      <th className="text-center p-2 font-black uppercase">바</th>
                    </tr>
                  </thead>
                  <tbody>
                    {condPerf
                      .filter(c => c.totalTrades > 0)
                      .sort((a, b) => b.totalTrades - a.totalTrades)
                      .map(c => {
                        const wr = c.totalTrades > 0 ? (c.winTrades / c.totalTrades * 100) : 0;
                        return (
                          <tr key={c.conditionId} className="border-b border-gray-100 hover:bg-gray-50">
                            <td className="p-2 font-mono text-gray-400">{c.conditionId}</td>
                            <td className="p-2 font-bold">{c.conditionName}</td>
                            <td className="p-2 text-right font-mono">{c.totalTrades}</td>
                            <td className="p-2 text-right font-mono">
                              <span className="text-green-600">{c.winTrades}W</span> / <span className="text-red-600">{c.lossTrades}L</span>
                            </td>
                            <td className={`p-2 text-right font-bold ${wr >= 60 ? 'text-green-600' : wr < 40 ? 'text-red-600' : 'text-gray-600'}`}>
                              {wr.toFixed(1)}%
                            </td>
                            <td className={`p-2 text-right font-mono ${c.avgReturnWhenHigh >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                              {c.avgReturnWhenHigh >= 0 ? '+' : ''}{c.avgReturnWhenHigh.toFixed(2)}%
                            </td>
                            <td className={`p-2 text-right font-mono ${c.avgReturnWhenLow >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                              {c.avgReturnWhenLow >= 0 ? '+' : ''}{c.avgReturnWhenLow.toFixed(2)}%
                            </td>
                            <td className="p-2 text-right">
                              <span className={`font-bold px-2 py-0.5 border text-[8px] ${
                                c.evolutionWeight > 1.0 ? 'border-green-300 text-green-700 bg-green-50' :
                                c.evolutionWeight < 1.0 ? 'border-red-300 text-red-700 bg-red-50' :
                                'border-gray-200 text-gray-500'
                              }`}>{c.evolutionWeight.toFixed(2)}x</span>
                            </td>
                            <td className="p-2">
                              <div className="w-20 h-2 bg-gray-100 mx-auto">
                                <div className={`h-full ${wr >= 60 ? 'bg-green-400' : wr >= 40 ? 'bg-gray-400' : 'bg-red-400'}`}
                                  style={{ width: `${wr}%` }} />
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
              {condPerf.filter(c => c.totalTrades === 0).length > 0 && (
                <p className="text-[8px] text-gray-400 mt-3">
                  미사용 조건 {condPerf.filter(c => c.totalTrades === 0).length}개 (해당 조건 ≥5 인 매매 없음)
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/* ═══════ TAB 3: 시스템 vs 직관 대결 ═══════ */}
      {tab === 'SYSTEM_VS_INTUITION' && (
        <div>
          {closedTrades.length < 3 ? (
            <div className="text-center py-12 text-gray-400">
              <p className="text-sm font-bold">최소 3건의 매매 종료 후 비교 가능</p>
            </div>
          ) : (
            <div className="space-y-6">
              {/* 대결 헤더 */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className={`border-2 p-5 text-center ${sysVsInt.systemEdge > 0 ? 'border-indigo-400 bg-indigo-50' : 'border-gray-200'}`}>
                  <p className="text-[9px] font-black uppercase text-indigo-500 tracking-widest">SYSTEM</p>
                  <p className="text-fluid-3xl font-black mt-1">{sysVsInt.systemWinRate}%</p>
                  <p className="text-[9px] text-gray-500">{sysVsInt.systemTrades}건 중 {sysVsInt.systemWins}승</p>
                  <p className={`text-sm font-bold mt-1 ${sysVsInt.systemAvgReturn >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    평균 {sysVsInt.systemAvgReturn >= 0 ? '+' : ''}{sysVsInt.systemAvgReturn}%
                  </p>
                </div>

                <div className="flex flex-col items-center justify-center">
                  <p className="text-[9px] font-black uppercase text-gray-400 tracking-widest mb-2">EDGE</p>
                  <p className={`text-fluid-4xl font-black ${
                    sysVsInt.systemEdge > 0 ? 'text-indigo-600' : sysVsInt.systemEdge < 0 ? 'text-amber-600' : 'text-gray-400'
                  }`}>
                    {sysVsInt.systemEdge > 0 ? '+' : ''}{sysVsInt.systemEdge}%p
                  </p>
                  <p className={`text-xs font-bold mt-1 ${
                    sysVsInt.systemEdge > 5 ? 'text-indigo-600' :
                    sysVsInt.systemEdge < -5 ? 'text-amber-600' : 'text-gray-500'
                  }`}>
                    {sysVsInt.systemEdge > 5 ? '시스템 명확 우위' :
                     sysVsInt.systemEdge > 0 ? '시스템 소폭 우위' :
                     sysVsInt.systemEdge < -5 ? '직관 우위 — 시스템 점검 필요' :
                     sysVsInt.systemEdge < 0 ? '직관 소폭 우위' : '동등 — 데이터 누적 필요'}
                  </p>
                </div>

                <div className={`border-2 p-5 text-center ${sysVsInt.systemEdge < 0 ? 'border-amber-400 bg-amber-50' : 'border-gray-200'}`}>
                  <p className="text-[9px] font-black uppercase text-amber-500 tracking-widest">INTUITION</p>
                  <p className="text-fluid-3xl font-black mt-1">{sysVsInt.intuitionWinRate}%</p>
                  <p className="text-[9px] text-gray-500">{sysVsInt.intuitionTrades}건 중 {sysVsInt.intuitionWins}승</p>
                  <p className={`text-sm font-bold mt-1 ${sysVsInt.intuitionAvgReturn >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    평균 {sysVsInt.intuitionAvgReturn >= 0 ? '+' : ''}{sysVsInt.intuitionAvgReturn}%
                  </p>
                </div>
              </div>

              {/* 상세 비교 테이블 */}
              <div className="overflow-x-auto">
                <table className="w-full text-[10px]">
                  <thead>
                    <tr className="border-b-2 border-gray-300">
                      <th className="p-2 text-left font-black uppercase">지표</th>
                      <th className="p-2 text-right font-black uppercase text-indigo-600">SYSTEM</th>
                      <th className="p-2 text-right font-black uppercase text-amber-600">INTUITION</th>
                      <th className="p-2 text-center font-black uppercase">우위</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      { label: '승률', sys: `${sysVsInt.systemWinRate}%`, int: `${sysVsInt.intuitionWinRate}%`, winner: sysVsInt.systemWinRate >= sysVsInt.intuitionWinRate ? 'SYS' : 'INT' },
                      { label: '평균 수익률', sys: `${sysVsInt.systemAvgReturn}%`, int: `${sysVsInt.intuitionAvgReturn}%`, winner: sysVsInt.systemAvgReturn >= sysVsInt.intuitionAvgReturn ? 'SYS' : 'INT' },
                      { label: '최대 손실', sys: `${sysVsInt.systemMaxDrawdown}%`, int: `${sysVsInt.intuitionMaxDrawdown}%`, winner: sysVsInt.systemMaxDrawdown >= sysVsInt.intuitionMaxDrawdown ? 'SYS' : 'INT' },
                      { label: '매매 수', sys: `${sysVsInt.systemTrades}건`, int: `${sysVsInt.intuitionTrades}건`, winner: '-' },
                    ].map((row, i) => (
                      <tr key={i} className="border-b border-gray-100">
                        <td className="p-2 font-bold">{row.label}</td>
                        <td className="p-2 text-right font-mono">{row.sys}</td>
                        <td className="p-2 text-right font-mono">{row.int}</td>
                        <td className="p-2 text-center">
                          {row.winner === 'SYS' ? (
                            <span className="text-[8px] font-bold px-2 py-0.5 bg-indigo-100 text-indigo-700 border border-indigo-300">SYSTEM</span>
                          ) : row.winner === 'INT' ? (
                            <span className="text-[8px] font-bold px-2 py-0.5 bg-amber-100 text-amber-700 border border-amber-300">INTUITION</span>
                          ) : <span className="text-gray-300">-</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {closedTrades.length >= 20 && (
                <div className={`p-4 border-2 ${sysVsInt.systemEdge > 5 ? 'border-indigo-400 bg-indigo-50' : sysVsInt.systemEdge < -5 ? 'border-amber-400 bg-amber-50' : 'border-gray-200'}`}>
                  <p className="text-xs font-black">
                    {sysVsInt.systemEdge > 10
                      ? '시스템 신호를 기계적으로 따르는 것이 명확히 우수합니다. 직관 매수를 줄이세요.'
                      : sysVsInt.systemEdge > 5
                      ? '시스템이 우위에 있습니다. 직관 매수 시 시스템 신호를 반드시 교차 확인하세요.'
                      : sysVsInt.systemEdge < -10
                      ? '직관이 시스템보다 우수합니다. 시스템 조건 가중치 재조정이 필요합니다.'
                      : sysVsInt.systemEdge < -5
                      ? '직관이 소폭 우위. 시스템 로직 점검을 고려하세요.'
                      : '시스템과 직관이 비슷합니다. 더 많은 데이터를 누적하세요.'}
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
