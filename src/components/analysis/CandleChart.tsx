import React, { useEffect, useRef, useState } from 'react';
import { createChart, createSeriesMarkers, CandlestickSeries, LineSeries, HistogramSeries, IChartApi, CandlestickData, LineData, HistogramData, Time } from 'lightweight-charts';
import { calculateEMA, calculateRSI, calculateBollingerBands } from '../../utils/indicators';
import { fetchHistoricalData } from '../../services/stock/historicalData';
import { formatNextOpenKst, nextOpenAtFor } from '../../utils/marketTime';

// ─── Types ───────────────────────────────────────────────────────────────────

interface GateSignal {
  time: string;      // YYYY-MM-DD
  type: 'BUY' | 'STRONG_BUY' | 'SELL' | 'STOP_LOSS';
  label: string;
}

interface Props {
  stockCode: string;
  stockName: string;
  gateSignals?: GateSignal[];
  height?: number;
}

type Overlay = 'BB' | 'EMA20' | 'EMA60';
type SubChart = 'RSI' | 'MACD' | 'NONE';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function toChartTime(ts: number): Time {
  const d = new Date(ts * 1000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` as Time;
}

function computeRSISeries(closes: number[], period = 14): number[] {
  const rsis: number[] = [];
  for (let i = 0; i < closes.length; i++) {
    if (i < period) { rsis.push(50); continue; }
    const slice = closes.slice(0, i + 1);
    rsis.push(calculateRSI(slice, period));
  }
  return rsis;
}

function computeMACDSeries(closes: number[]) {
  const ema12 = calculateEMA(closes, 12);
  const ema26 = calculateEMA(closes, 26);
  const macdLine = ema12.map((v, i) => v - ema26[i]);
  const signalLine = calculateEMA(macdLine, 9);
  const histogram = macdLine.map((v, i) => v - signalLine[i]);
  return { macdLine, signalLine, histogram };
}

function computeBBSeries(closes: number[], period = 20, stdDev = 2) {
  const upper: (number | null)[] = [];
  const middle: (number | null)[] = [];
  const lower: (number | null)[] = [];
  for (let i = 0; i < closes.length; i++) {
    if (i < period - 1) { upper.push(null); middle.push(null); lower.push(null); continue; }
    const slice = closes.slice(i - period + 1, i + 1);
    const bb = calculateBollingerBands(slice, period, stdDev);
    if (bb) { upper.push(bb.upper); middle.push(bb.middle); lower.push(bb.lower); }
    else { upper.push(null); middle.push(null); lower.push(null); }
  }
  return { upper, middle, lower };
}

// ─── Component ───────────────────────────────────────────────────────────────

export const CandleChart: React.FC<Props> = ({ stockCode, stockName, gateSignals = [] as GateSignal[], height = 500 }) => {
  const mainRef = useRef<HTMLDivElement>(null);
  const subRef = useRef<HTMLDivElement>(null);
  const mainChartRef = useRef<IChartApi | null>(null);
  const subChartRef = useRef<IChartApi | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const gateSignalsRef = useRef<GateSignal[]>(gateSignals);
  gateSignalsRef.current = gateSignals;

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [offHours, setOffHours] = useState<{ nextOpenAt?: string } | null>(null);
  const [overlays, setOverlays] = useState<Set<Overlay>>(new Set(['BB', 'EMA20']));
  const [subChart, setSubChart] = useState<SubChart>('RSI');
  const [range, setRange] = useState<'3mo' | '6mo' | '1y' | '2y'>('1y');

  const toggleOverlay = (o: Overlay) => {
    setOverlays((prev: Set<Overlay>) => {
      const next = new Set(prev);
      next.has(o) ? next.delete(o) : next.add(o);
      return next;
    });
  };

  useEffect(() => {
    let cancelled = false;

    const buildChart = async () => {
      if (!mainRef.current) return;
      setLoading(true);
      setError(null);
      setOffHours(null);

      // Clean up previous charts
      if (mainChartRef.current) { mainChartRef.current.remove(); mainChartRef.current = null; }
      if (subChartRef.current) { subChartRef.current.remove(); subChartRef.current = null; }

      try {
        const result = await fetchHistoricalData(stockCode, range, '1d', { withMeta: true });
        if (cancelled) return;
        if (!result.data) {
          if (result.meta.reason === 'OFFHOURS') {
            setOffHours({ nextOpenAt: result.meta.nextOpenAt });
          } else {
            setError('가격 데이터를 불러올 수 없습니다.');
          }
          return;
        }
        const data = result.data;

        const timestamps: number[] = data.timestamp;
        const quote = data.indicators.quote[0];
        const opens: number[] = quote.open;
        const highs: number[] = quote.high;
        const lows: number[] = quote.low;
        const closes: number[] = quote.close;
        const volumes: number[] = quote.volume;

        // Filter out null data points
        const validIndices = timestamps.map((_, i) => i).filter(i =>
          opens[i] != null && highs[i] != null && lows[i] != null && closes[i] != null
        );

        const candleData: CandlestickData[] = validIndices.map(i => ({
          time: toChartTime(timestamps[i]),
          open: opens[i],
          high: highs[i],
          low: lows[i],
          close: closes[i],
        }));

        const validCloses = validIndices.map(i => closes[i]);
        const validTimes = validIndices.map(i => toChartTime(timestamps[i]));

        // ── Main Chart ─────────────────────────────────────────────
        const mainChart = createChart(mainRef.current!, {
          width: mainRef.current!.clientWidth,
          height: subChart !== 'NONE' ? height * 0.65 : height,
          layout: { background: { color: '#0a0a0a' }, textColor: '#999', fontSize: 10 },
          grid: { vertLines: { color: '#1a1a1a' }, horzLines: { color: '#1a1a1a' } },
          crosshair: { mode: 0 },
          rightPriceScale: { borderColor: '#333' },
          timeScale: { borderColor: '#333', timeVisible: false },
        });
        mainChartRef.current = mainChart;

        const candleSeries = mainChart.addSeries(CandlestickSeries,{
          upColor: '#ef4444', downColor: '#3b82f6',
          borderUpColor: '#ef4444', borderDownColor: '#3b82f6',
          wickUpColor: '#ef4444', wickDownColor: '#3b82f6',
        });
        candleSeries.setData(candleData);

        // Volume
        const volumeSeries = mainChart.addSeries(HistogramSeries,{
          priceFormat: { type: 'volume' },
          priceScaleId: 'vol',
        });
        mainChart.priceScale('vol').applyOptions({
          scaleMargins: { top: 0.85, bottom: 0 },
        });
        const volData: HistogramData[] = validIndices.map(i => ({
          time: toChartTime(timestamps[i]),
          value: volumes[i] || 0,
          color: closes[i] >= opens[i] ? 'rgba(239,68,68,0.15)' : 'rgba(59,130,246,0.15)',
        }));
        volumeSeries.setData(volData);

        // ── Overlays ────────────────────────────────────────────────
        if (overlays.has('EMA20')) {
          const ema20 = calculateEMA(validCloses, 20);
          const ema20Series = mainChart.addSeries(LineSeries,{ color: '#f59e0b', lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
          ema20Series.setData(ema20.map((v, i) => ({ time: validTimes[i], value: v })) as LineData[]);
        }
        if (overlays.has('EMA60')) {
          const ema60 = calculateEMA(validCloses, 60);
          const ema60Series = mainChart.addSeries(LineSeries,{ color: '#8b5cf6', lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
          ema60Series.setData(ema60.map((v, i) => ({ time: validTimes[i], value: v })) as LineData[]);
        }
        if (overlays.has('BB')) {
          const bb = computeBBSeries(validCloses);
          const bbUpper = mainChart.addSeries(LineSeries,{ color: 'rgba(147,51,234,0.4)', lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
          const bbLower = mainChart.addSeries(LineSeries,{ color: 'rgba(147,51,234,0.4)', lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
          const bbMid = mainChart.addSeries(LineSeries,{ color: 'rgba(147,51,234,0.2)', lineWidth: 1, lineStyle: 2, priceLineVisible: false, lastValueVisible: false });
          bbUpper.setData(bb.upper.map((v, i) => v !== null ? { time: validTimes[i], value: v } : null).filter(Boolean) as LineData[]);
          bbLower.setData(bb.lower.map((v, i) => v !== null ? { time: validTimes[i], value: v } : null).filter(Boolean) as LineData[]);
          bbMid.setData(bb.middle.map((v, i) => v !== null ? { time: validTimes[i], value: v } : null).filter(Boolean) as LineData[]);
        }

        // ── Gate Signal Markers ─────────────────────────────────────
        if (gateSignalsRef.current.length > 0) {
          const markers = gateSignalsRef.current.map(sig => ({
            time: sig.time as Time,
            position: sig.type === 'SELL' || sig.type === 'STOP_LOSS' ? 'aboveBar' as const : 'belowBar' as const,
            color: sig.type === 'STRONG_BUY' ? '#22c55e' : sig.type === 'BUY' ? '#3b82f6' : sig.type === 'SELL' ? '#f97316' : '#ef4444',
            shape: sig.type === 'SELL' || sig.type === 'STOP_LOSS' ? 'arrowDown' as const : 'arrowUp' as const,
            text: sig.label,
          }));
          createSeriesMarkers(candleSeries, markers);
        }

        // 전체 fitContent 후 최근 120봉으로 좁혀서 가독성 향상
        mainChart.timeScale().fitContent();
        const totalBars = candleData.length;
        if (totalBars > 120) {
          mainChart.timeScale().setVisibleLogicalRange({
            from: totalBars - 120,
            to: totalBars - 1,
          });
        }

        // ── Sub Chart (RSI / MACD) ──────────────────────────────────
        if (subChart !== 'NONE' && subRef.current) {
          const sub = createChart(subRef.current!, {
            width: subRef.current!.clientWidth,
            height: height * 0.3,
            layout: { background: { color: '#0a0a0a' }, textColor: '#999', fontSize: 10 },
            grid: { vertLines: { color: '#1a1a1a' }, horzLines: { color: '#1a1a1a' } },
            crosshair: { mode: 0 },
            rightPriceScale: { borderColor: '#333' },
            timeScale: { borderColor: '#333', timeVisible: false },
          });
          subChartRef.current = sub;

          if (subChart === 'RSI') {
            const rsiVals = computeRSISeries(validCloses);
            const rsiSeries = sub.addSeries(LineSeries,{ color: '#f59e0b', lineWidth: 2, priceLineVisible: false });
            rsiSeries.setData(rsiVals.map((v, i) => ({ time: validTimes[i], value: v })) as LineData[]);
            // 30/70 lines
            const line30 = sub.addSeries(LineSeries,{ color: 'rgba(34,197,94,0.3)', lineWidth: 1, lineStyle: 2, priceLineVisible: false, lastValueVisible: false });
            const line70 = sub.addSeries(LineSeries,{ color: 'rgba(239,68,68,0.3)', lineWidth: 1, lineStyle: 2, priceLineVisible: false, lastValueVisible: false });
            line30.setData(validTimes.map(t => ({ time: t, value: 30 })) as LineData[]);
            line70.setData(validTimes.map(t => ({ time: t, value: 70 })) as LineData[]);
          }

          if (subChart === 'MACD') {
            const macd = computeMACDSeries(validCloses);
            const macdSeries = sub.addSeries(LineSeries,{ color: '#3b82f6', lineWidth: 2, priceLineVisible: false });
            const sigSeries = sub.addSeries(LineSeries,{ color: '#ef4444', lineWidth: 1, priceLineVisible: false });
            const histSeries = sub.addSeries(HistogramSeries,{ priceLineVisible: false });
            macdSeries.setData(macd.macdLine.map((v, i) => ({ time: validTimes[i], value: v })) as LineData[]);
            sigSeries.setData(macd.signalLine.map((v, i) => ({ time: validTimes[i], value: v })) as LineData[]);
            histSeries.setData(macd.histogram.map((v, i) => ({
              time: validTimes[i], value: v,
              color: v >= 0 ? 'rgba(239,68,68,0.5)' : 'rgba(59,130,246,0.5)',
            })) as HistogramData[]);
          }

          sub.timeScale().fitContent();
          // Sync crosshair (guard flag로 피드백 루프 방지)
          let syncing = false;
          mainChart.timeScale().subscribeVisibleLogicalRangeChange((r: any) => {
            if (syncing || !r) return;
            syncing = true;
            sub.timeScale().setVisibleLogicalRange(r);
            syncing = false;
          });
          sub.timeScale().subscribeVisibleLogicalRangeChange((r: any) => {
            if (syncing || !r) return;
            syncing = true;
            mainChart.timeScale().setVisibleLogicalRange(r);
            syncing = false;
          });
        }

        // Resize handler (ref로 관리하여 cleanup 시 disconnect)
        if (resizeObserverRef.current) resizeObserverRef.current.disconnect();
        const ro = new ResizeObserver(() => {
          if (mainRef.current && mainChartRef.current) {
            mainChartRef.current.applyOptions({ width: mainRef.current.clientWidth });
          }
          if (subRef.current && subChartRef.current) {
            subChartRef.current.applyOptions({ width: subRef.current.clientWidth });
          }
        });
        resizeObserverRef.current = ro;
        if (mainRef.current) ro.observe(mainRef.current);

      } catch (e: any) {
        setError(e?.message ?? '차트 생성 실패');
      } finally {
        setLoading(false);
      }
    };

    buildChart();

    return () => {
      cancelled = true;
      if (resizeObserverRef.current) { resizeObserverRef.current.disconnect(); resizeObserverRef.current = null; }
      if (mainChartRef.current) { mainChartRef.current.remove(); mainChartRef.current = null; }
      if (subChartRef.current) { subChartRef.current.remove(); subChartRef.current = null; }
    };
  }, [stockCode, range, overlays, subChart, height]);

  return (
    <div className="border border-gray-800 bg-[#0a0a0a] rounded-xl overflow-hidden">
      {/* Controls */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-gray-800">
        <span className="text-xs font-black text-white/70 uppercase tracking-widest mr-2">{stockName}</span>
        <div className="flex gap-1">
          {(['3mo', '6mo', '1y', '2y'] as const).map(r => (
            <button key={r} onClick={() => setRange(r)}
              className={`text-[9px] px-2 py-0.5 font-bold uppercase ${range === r ? 'bg-white text-black' : 'text-white/30 hover:text-white/60'}`}>{r}</button>
          ))}
        </div>
        <div className="w-px h-4 bg-white/10 mx-1" />
        {(['BB', 'EMA20', 'EMA60'] as Overlay[]).map(o => (
          <button key={o} onClick={() => toggleOverlay(o)}
            className={`text-[9px] px-2 py-0.5 font-bold ${overlays.has(o) ? 'bg-purple-500/30 text-purple-300 border border-purple-500/50' : 'text-white/30 hover:text-white/60 border border-transparent'}`}>{o}</button>
        ))}
        <div className="w-px h-4 bg-white/10 mx-1" />
        {(['RSI', 'MACD', 'NONE'] as SubChart[]).map(s => (
          <button key={s} onClick={() => setSubChart(s)}
            className={`text-[9px] px-2 py-0.5 font-bold ${subChart === s ? 'bg-amber-500/30 text-amber-300 border border-amber-500/50' : 'text-white/30 hover:text-white/60 border border-transparent'}`}>{s}</button>
        ))}
      </div>

      {/* Chart */}
      {loading && (
        <div className="flex items-center justify-center py-20 text-white/30 text-xs animate-pulse">차트 데이터 로딩 중...</div>
      )}
      {error && !offHours && (
        <div className="flex items-center justify-center py-20 text-red-400/60 text-xs">{error}</div>
      )}
      {offHours && (
        <div className="flex flex-col items-center justify-center py-20 text-xs gap-2">
          <span className="text-orange-400/80 font-bold uppercase tracking-widest">장외 시간</span>
          <span className="text-white/60">
            현재 장이 닫혀 차트가 갱신되지 않습니다.
          </span>
          {offHours.nextOpenAt && (() => {
            try {
              const next = new Date(offHours.nextOpenAt);
              return (
                <span className="text-white/30 text-[10px] tracking-wide">
                  다음 개장: {formatNextOpenKst(next)}
                </span>
              );
            } catch {
              try {
                const next = nextOpenAtFor(stockCode);
                return (
                  <span className="text-white/30 text-[10px] tracking-wide">
                    다음 개장: {formatNextOpenKst(next)}
                  </span>
                );
              } catch {
                return null;
              }
            }
          })()}
        </div>
      )}
      <div ref={mainRef} className={loading || error || offHours ? 'hidden' : ''} />
      {subChart !== 'NONE' && <div ref={subRef} className={`border-t border-gray-800 ${loading || error || offHours ? 'hidden' : ''}`} />}
    </div>
  );
};
