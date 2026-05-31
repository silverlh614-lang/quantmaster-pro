// @responsibility analysis 영역 CandleChart 컴포넌트
import React, { useEffect, useRef, useState } from 'react';
import { createChart, createSeriesMarkers, CandlestickSeries, LineSeries, HistogramSeries, IChartApi, CandlestickData, LineData, HistogramData, Time } from 'lightweight-charts';
import { calculateEMA, calculateRSI, calculateBollingerBands } from '../../utils/indicators';
import { fetchHistoricalData } from '../../services/stock/historicalData';
import { fetchNaverDailyChart } from '../../services/stock/naverDailyChart';
import { formatNextOpenKst, nextOpenAtFor } from '../../utils/marketTime';
import { usePriceCanon } from '../../hooks/usePriceCanon';

interface GateSignal {
  time: string;
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
type RangeOption = '3mo' | '6mo' | '1y';

interface ChartRefs {
  mainChartRef: React.MutableRefObject<IChartApi | null>;
  subChartRef: React.MutableRefObject<IChartApi | null>;
  resizeObserverRef: React.MutableRefObject<ResizeObserver | null>;
}

interface ValidChartData {
  timestamps: number[];
  opens: number[];
  highs: number[];
  lows: number[];
  closes: number[];
  volumes: number[];
  validIndices: number[];
  candleData: CandlestickData[];
  validCloses: number[];
  validTimes: Time[];
}

const RANGE_OPTIONS: RangeOption[] = ['3mo', '6mo', '1y'];
const OVERLAY_OPTIONS: Overlay[] = ['BB', 'EMA20', 'EMA60'];
const SUB_CHART_OPTIONS: SubChart[] = ['RSI', 'MACD', 'NONE'];

const PRICE_DATA_ERROR = '가격 데이터를 불러올 수 없습니다.';
const CHART_CREATE_ERROR = '차트 생성 실패';
const LOADING_LABEL = '차트 데이터 로딩 중...';
const OFF_HOURS_TITLE = '장외 시간';
const OFF_HOURS_MESSAGE = '현재 장이 닫혀 차트가 갱신되지 않습니다.';
const NEXT_OPEN_PREFIX = '다음 개장';

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

function resetChartRefs({ mainChartRef, subChartRef, resizeObserverRef }: ChartRefs) {
  if (resizeObserverRef.current) { resizeObserverRef.current.disconnect(); resizeObserverRef.current = null; }
  if (mainChartRef.current) { mainChartRef.current.remove(); mainChartRef.current = null; }
  if (subChartRef.current) { subChartRef.current.remove(); subChartRef.current = null; }
}

function extractValidChartData(data: any, canonPrice?: number | null): ValidChartData {
  const timestamps: number[] = data.timestamp;
  const quote = data.indicators.quote[0];
  let opens: number[] = quote.open;
  let highs: number[] = quote.high;
  let lows: number[] = quote.low;
  let closes: number[] = quote.close;
  const volumes: number[] = quote.volume;
  const validIndices = timestamps.map((_, i) => i).filter(i =>
    opens[i] != null && highs[i] != null && lows[i] != null && closes[i] != null
  );

  // 차트 출처(Yahoo)와 헤더 현재가 정본(usePriceCanon — Naver/KIS) 불일치 보정.
  // 마지막 유효 종가를 정본가에 맞춰 전체 시계열을 비율 스케일한다 — 모양·지표·거래량은
  // 보존하고 절대축만 헤더와 일치시킨다. Yahoo 절대값은 split/통화 왜곡으로 신뢰하지
  // 않으므로 정본가에 앵커. canonPrice 부재 시 no-op(기존 동작 유지).
  if (typeof canonPrice === 'number' && canonPrice > 0 && validIndices.length > 0) {
    const lastClose = closes[validIndices[validIndices.length - 1]];
    if (typeof lastClose === 'number' && lastClose > 0) {
      const ratio = canonPrice / lastClose;
      if (Number.isFinite(ratio) && ratio > 0 && Math.abs(ratio - 1) > 0.005) {
        opens = opens.map(v => (v != null ? v * ratio : v));
        highs = highs.map(v => (v != null ? v * ratio : v));
        lows = lows.map(v => (v != null ? v * ratio : v));
        closes = closes.map(v => (v != null ? v * ratio : v));
      }
    }
  }

  const candleData: CandlestickData[] = validIndices.map(i => ({
    time: toChartTime(timestamps[i]),
    open: opens[i],
    high: highs[i],
    low: lows[i],
    close: closes[i],
  }));

  return {
    timestamps,
    opens,
    highs,
    lows,
    closes,
    volumes,
    validIndices,
    candleData,
    validCloses: validIndices.map(i => closes[i]),
    validTimes: validIndices.map(i => toChartTime(timestamps[i])),
  };
}

function createMainChart(container: HTMLDivElement, height: number, subChart: SubChart): IChartApi {
  return createChart(container, {
    width: container.clientWidth,
    height: subChart !== 'NONE' ? height * 0.65 : height,
    layout: { background: { color: '#0a0a0a' }, textColor: '#999', fontSize: 10 },
    grid: { vertLines: { color: '#1a1a1a' }, horzLines: { color: '#1a1a1a' } },
    crosshair: { mode: 0 },
    rightPriceScale: { borderColor: '#333' },
    timeScale: { borderColor: '#333', timeVisible: false },
  });
}

function addCandleAndVolumeSeries(mainChart: IChartApi, chartData: ValidChartData) {
  const candleSeries = mainChart.addSeries(CandlestickSeries,{
    upColor: '#ef4444', downColor: '#3b82f6',
    borderUpColor: '#ef4444', borderDownColor: '#3b82f6',
    wickUpColor: '#ef4444', wickDownColor: '#3b82f6',
  });
  candleSeries.setData(chartData.candleData);

  const volumeSeries = mainChart.addSeries(HistogramSeries,{
    priceFormat: { type: 'volume' },
    priceScaleId: 'vol',
  });
  mainChart.priceScale('vol').applyOptions({
    scaleMargins: { top: 0.85, bottom: 0 },
  });
  const volData: HistogramData[] = chartData.validIndices.map(i => ({
    time: toChartTime(chartData.timestamps[i]),
    value: chartData.volumes[i] || 0,
    color: chartData.closes[i] >= chartData.opens[i] ? 'rgba(239,68,68,0.15)' : 'rgba(59,130,246,0.15)',
  }));
  volumeSeries.setData(volData);
  return candleSeries;
}

function addLineSeries(chart: IChartApi, color: string, data: LineData[], lineStyle?: number) {
  const series = chart.addSeries(LineSeries,{
    color,
    lineWidth: 1,
    lineStyle,
    priceLineVisible: false,
    lastValueVisible: false,
  });
  series.setData(data);
}

function addOverlaySeries(mainChart: IChartApi, overlays: Set<Overlay>, chartData: ValidChartData) {
  if (overlays.has('EMA20')) {
    const ema20 = calculateEMA(chartData.validCloses, 20);
    addLineSeries(mainChart, '#f59e0b', ema20.map((v, i) => ({ time: chartData.validTimes[i], value: v })) as LineData[]);
  }
  if (overlays.has('EMA60')) {
    const ema60 = calculateEMA(chartData.validCloses, 60);
    addLineSeries(mainChart, '#8b5cf6', ema60.map((v, i) => ({ time: chartData.validTimes[i], value: v })) as LineData[]);
  }
  if (overlays.has('BB')) {
    const bb = computeBBSeries(chartData.validCloses);
    addLineSeries(mainChart, 'rgba(147,51,234,0.4)', bb.upper.map((v, i) => v !== null ? { time: chartData.validTimes[i], value: v } : null).filter(Boolean) as LineData[]);
    addLineSeries(mainChart, 'rgba(147,51,234,0.4)', bb.lower.map((v, i) => v !== null ? { time: chartData.validTimes[i], value: v } : null).filter(Boolean) as LineData[]);
    addLineSeries(mainChart, 'rgba(147,51,234,0.2)', bb.middle.map((v, i) => v !== null ? { time: chartData.validTimes[i], value: v } : null).filter(Boolean) as LineData[], 2);
  }
}

function addGateSignalMarkers(candleSeries: any, gateSignals: GateSignal[]) {
  if (gateSignals.length === 0) return;
  const markers = gateSignals.map(sig => ({
    time: sig.time as Time,
    position: sig.type === 'SELL' || sig.type === 'STOP_LOSS' ? 'aboveBar' as const : 'belowBar' as const,
    color: sig.type === 'STRONG_BUY' ? '#22c55e' : sig.type === 'BUY' ? '#3b82f6' : sig.type === 'SELL' ? '#f97316' : '#ef4444',
    shape: sig.type === 'SELL' || sig.type === 'STOP_LOSS' ? 'arrowDown' as const : 'arrowUp' as const,
    text: sig.label,
  }));
  createSeriesMarkers(candleSeries, markers);
}

function fitRecentRange(mainChart: IChartApi, totalBars: number) {
  if (totalBars <= 0) return;
  // fitContent 가 모달 오픈 애니메이션 중 잘못된 폭으로 맞춰져 캔들이 우측에 몰리고 좌측에
  // 공백이 남던(=너무 축소돼 보이던) 문제 수정. 논리 범위를 명시 설정해 폭 변화에 무관하게
  // 최근 N봉을 가득 채운다(우측 정렬·확대). 데이터가 적으면 전체.
  const VISIBLE = Math.min(totalBars, 90);
  mainChart.timeScale().setVisibleLogicalRange({
    from: totalBars - VISIBLE,
    to: totalBars - 1,
  });
}

function createSubIndicatorChart(container: HTMLDivElement, height: number): IChartApi {
  return createChart(container, {
    width: container.clientWidth,
    height: height * 0.3,
    layout: { background: { color: '#0a0a0a' }, textColor: '#999', fontSize: 10 },
    grid: { vertLines: { color: '#1a1a1a' }, horzLines: { color: '#1a1a1a' } },
    crosshair: { mode: 0 },
    rightPriceScale: { borderColor: '#333' },
    timeScale: { borderColor: '#333', timeVisible: false },
  });
}

function addRsiSeries(sub: IChartApi, chartData: ValidChartData) {
  const rsiVals = computeRSISeries(chartData.validCloses);
  const rsiSeries = sub.addSeries(LineSeries,{ color: '#f59e0b', lineWidth: 2, priceLineVisible: false });
  rsiSeries.setData(rsiVals.map((v, i) => ({ time: chartData.validTimes[i], value: v })) as LineData[]);
  const line30 = sub.addSeries(LineSeries,{ color: 'rgba(34,197,94,0.3)', lineWidth: 1, lineStyle: 2, priceLineVisible: false, lastValueVisible: false });
  const line70 = sub.addSeries(LineSeries,{ color: 'rgba(239,68,68,0.3)', lineWidth: 1, lineStyle: 2, priceLineVisible: false, lastValueVisible: false });
  line30.setData(chartData.validTimes.map(t => ({ time: t, value: 30 })) as LineData[]);
  line70.setData(chartData.validTimes.map(t => ({ time: t, value: 70 })) as LineData[]);
}

function addMacdSeries(sub: IChartApi, chartData: ValidChartData) {
  const macd = computeMACDSeries(chartData.validCloses);
  const macdSeries = sub.addSeries(LineSeries,{ color: '#3b82f6', lineWidth: 2, priceLineVisible: false });
  const sigSeries = sub.addSeries(LineSeries,{ color: '#ef4444', lineWidth: 1, priceLineVisible: false });
  const histSeries = sub.addSeries(HistogramSeries,{ priceLineVisible: false });
  macdSeries.setData(macd.macdLine.map((v, i) => ({ time: chartData.validTimes[i], value: v })) as LineData[]);
  sigSeries.setData(macd.signalLine.map((v, i) => ({ time: chartData.validTimes[i], value: v })) as LineData[]);
  histSeries.setData(macd.histogram.map((v, i) => ({
    time: chartData.validTimes[i], value: v,
    color: v >= 0 ? 'rgba(239,68,68,0.5)' : 'rgba(59,130,246,0.5)',
  })) as HistogramData[]);
}

function syncChartRanges(mainChart: IChartApi, sub: IChartApi) {
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
  // 초기 정렬 — sub(RSI/MACD)를 메인의 확대된 범위(fitRecentRange)에 즉시 맞춘다.
  const initial = mainChart.timeScale().getVisibleLogicalRange();
  if (initial) sub.timeScale().setVisibleLogicalRange(initial);
}

function maybeCreateSubChart(
  mainChart: IChartApi,
  subContainer: HTMLDivElement | null,
  refs: ChartRefs,
  subChart: SubChart,
  height: number,
  chartData: ValidChartData,
) {
  if (subChart === 'NONE' || !subContainer) return;
  const sub = createSubIndicatorChart(subContainer, height);
  refs.subChartRef.current = sub;
  if (subChart === 'RSI') addRsiSeries(sub, chartData);
  if (subChart === 'MACD') addMacdSeries(sub, chartData);
  sub.timeScale().fitContent();
  syncChartRanges(mainChart, sub);
}

function installResizeObserver(refs: ChartRefs, mainContainer: HTMLDivElement, subContainer: HTMLDivElement | null) {
  if (refs.resizeObserverRef.current) refs.resizeObserverRef.current.disconnect();
  const ro = new ResizeObserver(() => {
    if (refs.mainChartRef.current) {
      refs.mainChartRef.current.applyOptions({ width: mainContainer.clientWidth });
    }
    if (subContainer && refs.subChartRef.current) {
      refs.subChartRef.current.applyOptions({ width: subContainer.clientWidth });
    }
  });
  refs.resizeObserverRef.current = ro;
  ro.observe(mainContainer);
}

function applyNoDataState(
  result: any,
  setOffHours: (value: { nextOpenAt?: string } | null) => void,
  setError: (value: string | null) => void,
) {
  if (result.meta.reason === 'OFFHOURS') {
    setOffHours({ nextOpenAt: result.meta.nextOpenAt });
    return;
  }
  setError(PRICE_DATA_ERROR);
}

async function buildCandleChart({
  stockCode,
  canonPrice,
  range,
  height,
  overlays,
  subChart,
  mainContainer,
  subContainer,
  refs,
  gateSignals,
  isCancelled,
  setError,
  setOffHours,
}: {
  stockCode: string;
  canonPrice?: number | null;
  range: RangeOption;
  height: number;
  overlays: Set<Overlay>;
  subChart: SubChart;
  mainContainer: HTMLDivElement;
  subContainer: HTMLDivElement | null;
  refs: ChartRefs;
  gateSignals: GateSignal[];
  isCancelled: () => boolean;
  setError: (value: string | null) => void;
  setOffHours: (value: { nextOpenAt?: string } | null) => void;
}) {
  // KR 차트 정본은 Naver 일봉 우선 (Yahoo 는 KR stale 심함·장외 미가용). 실패 시 Yahoo fallback.
  const naver = await fetchNaverDailyChart(stockCode, range);
  const result = naver && naver.data
    ? naver
    : await fetchHistoricalData(stockCode, range, '1d', { withMeta: true });
  if (isCancelled()) return;
  if (!result.data) {
    applyNoDataState(result, setOffHours, setError);
    return;
  }

  const chartData = extractValidChartData(result.data, canonPrice);
  const mainChart = createMainChart(mainContainer, height, subChart);
  refs.mainChartRef.current = mainChart;
  const candleSeries = addCandleAndVolumeSeries(mainChart, chartData);
  addOverlaySeries(mainChart, overlays, chartData);
  addGateSignalMarkers(candleSeries, gateSignals);
  fitRecentRange(mainChart, chartData.candleData.length);
  maybeCreateSubChart(mainChart, subContainer, refs, subChart, height, chartData);
  installResizeObserver(refs, mainContainer, subContainer);
}

function ChartControls({
  stockName,
  range,
  overlays,
  subChart,
  onRangeChange,
  onOverlayToggle,
  onSubChartChange,
}: {
  stockName: string;
  range: RangeOption;
  overlays: Set<Overlay>;
  subChart: SubChart;
  onRangeChange: (range: RangeOption) => void;
  onOverlayToggle: (overlay: Overlay) => void;
  onSubChartChange: (chart: SubChart) => void;
}) {
  return (
    <div className="flex items-center gap-2 px-4 py-2 border-b border-gray-800">
      <span className="text-xs font-black text-white/70 uppercase tracking-widest mr-2">{stockName}</span>
      <div className="flex gap-1">
        {RANGE_OPTIONS.map(r => (
          <button key={r} onClick={() => onRangeChange(r)}
            className={`text-[9px] px-2 py-0.5 font-bold uppercase ${range === r ? 'bg-white text-black' : 'text-white/30 hover:text-white/60'}`}>{r}</button>
        ))}
      </div>
      <div className="w-px h-4 bg-white/10 mx-1" />
      {OVERLAY_OPTIONS.map(o => (
        <button key={o} onClick={() => onOverlayToggle(o)}
          className={`text-[9px] px-2 py-0.5 font-bold ${overlays.has(o) ? 'bg-purple-500/30 text-purple-300 border border-purple-500/50' : 'text-white/30 hover:text-white/60 border border-transparent'}`}>{o}</button>
      ))}
      <div className="w-px h-4 bg-white/10 mx-1" />
      {SUB_CHART_OPTIONS.map(s => (
        <button key={s} onClick={() => onSubChartChange(s)}
          className={`text-[9px] px-2 py-0.5 font-bold ${subChart === s ? 'bg-amber-500/30 text-amber-300 border border-amber-500/50' : 'text-white/30 hover:text-white/60 border border-transparent'}`}>{s}</button>
      ))}
    </div>
  );
}

function OffHoursNextOpen({ stockCode, nextOpenAt }: { stockCode: string; nextOpenAt?: string }) {
  if (!nextOpenAt) return null;
  try {
    const next = new Date(nextOpenAt);
    return <span className="text-white/30 text-[10px] tracking-wide">{NEXT_OPEN_PREFIX}: {formatNextOpenKst(next)}</span>;
  } catch {
    try {
      const next = nextOpenAtFor(stockCode);
      return <span className="text-white/30 text-[10px] tracking-wide">{NEXT_OPEN_PREFIX}: {formatNextOpenKst(next)}</span>;
    } catch {
      return null;
    }
  }
}

function ChartStatus({
  loading,
  error,
  offHours,
  stockCode,
}: {
  loading: boolean;
  error: string | null;
  offHours: { nextOpenAt?: string } | null;
  stockCode: string;
}) {
  if (loading) {
    return <div className="flex items-center justify-center py-20 text-white/30 text-xs animate-pulse">{LOADING_LABEL}</div>;
  }
  if (error && !offHours) {
    return <div className="flex items-center justify-center py-20 text-red-400/60 text-xs">{error}</div>;
  }
  if (!offHours) return null;
  return (
    <div className="flex flex-col items-center justify-center py-20 text-xs gap-2">
      <span className="text-orange-400/80 font-bold uppercase tracking-widest">{OFF_HOURS_TITLE}</span>
      <span className="text-white/60">{OFF_HOURS_MESSAGE}</span>
      <OffHoursNextOpen stockCode={stockCode} nextOpenAt={offHours.nextOpenAt} />
    </div>
  );
}

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
  const [range, setRange] = useState<RangeOption>('1y');

  // 헤더(ModalHeader)와 동일한 가격 정본 — 차트를 정본가에 앵커해 "현재가 ≠ 차트가" 불일치 제거.
  const { price: canonPrice } = usePriceCanon(stockCode);

  const toggleOverlay = (o: Overlay) => {
    setOverlays((prev: Set<Overlay>) => {
      const next = new Set(prev);
      next.has(o) ? next.delete(o) : next.add(o);
      return next;
    });
  };

  useEffect(() => {
    let cancelled = false;
    const mainContainer = mainRef.current;
    if (!mainContainer) return;

    setLoading(true);
    setError(null);
    setOffHours(null);
    const refs = { mainChartRef, subChartRef, resizeObserverRef };
    resetChartRefs(refs);

    buildCandleChart({
      stockCode,
      canonPrice,
      range,
      height,
      overlays,
      subChart,
      mainContainer,
      subContainer: subRef.current,
      refs,
      gateSignals: gateSignalsRef.current,
      isCancelled: () => cancelled,
      setError,
      setOffHours,
    }).catch((e: any) => {
      setError(e?.message ?? CHART_CREATE_ERROR);
    }).finally(() => {
      setLoading(false);
    });

    return () => {
      cancelled = true;
      resetChartRefs(refs);
    };
  }, [stockCode, canonPrice, range, overlays, subChart, height]);

  const hiddenClassName = loading || error || offHours ? 'hidden' : '';

  return (
    <div className="border border-gray-800 bg-[#0a0a0a] rounded-xl overflow-hidden">
      <ChartControls
        stockName={stockName}
        range={range}
        overlays={overlays}
        subChart={subChart}
        onRangeChange={setRange}
        onOverlayToggle={toggleOverlay}
        onSubChartChange={setSubChart}
      />
      <ChartStatus loading={loading} error={error} offHours={offHours} stockCode={stockCode} />
      <div ref={mainRef} className={hiddenClassName} />
      {subChart !== 'NONE' && <div ref={subRef} className={`border-t border-gray-800 ${hiddenClassName}`} />}
    </div>
  );
};
