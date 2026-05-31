// @responsibility analysis ManualQuantInput component
import React, { useState } from 'react';
import {
  Zap,
  Calculator,
  CheckCircle2,
  XCircle,
  TrendingUp,
  ShieldCheck,
  Activity,
  BarChart3,
  Info,
  Wallet,
  Globe,
} from 'lucide-react';
import { evaluateStock } from '../../services/quant/gateEngine';
import { ConditionId, MarketRegime, SectorRotation, EvaluationResult, MacroEnvironment } from '../../types/quant';
import { cn } from '../../ui/cn';

interface ManualQuantInputProps {
  regime: MarketRegime;
  sectorRotation: SectorRotation;
}

type StockInfo = {
  name: string;
  code: string;
  currentPrice: string;
};

type ManualIndicators = {
  rsi: string;
  maAlignment: 'UP' | 'DOWN' | 'NEUTRAL';
  ichimokuCloud: 'ABOVE' | 'BELOW' | 'INSIDE';
  foreignBuying: string;
  icr: string;
  volumeSurge: boolean;
  cycleMatch: boolean;
  roeGrowth: boolean;
  marketCap: string;
};

type ManualMacroInputs = {
  bokRateDirection: 'HIKING' | 'HOLDING' | 'CUTTING';
  usdKrw: string;
  vkospi: string;
  vix: string;
  exportGrowth3mAvg: string;
  stockExportRatio: string;
};

type SelectOption = {
  value: string;
  label: string;
};

const FIELD_CLASS = 'w-full bg-white/5 border border-white/[0.07] rounded-2xl px-4 py-3 text-white font-bold focus:outline-none focus:border-indigo-500/50 transition-all';
const INITIAL_STOCK_INFO: StockInfo = { name: '', code: '', currentPrice: '' };
const INITIAL_INDICATORS: ManualIndicators = {
  rsi: '50',
  maAlignment: 'UP',
  ichimokuCloud: 'ABOVE',
  foreignBuying: '0',
  icr: '1.0',
  volumeSurge: false,
  cycleMatch: true,
  roeGrowth: true,
  marketCap: '1000',
};
const INITIAL_MACRO_INPUTS: ManualMacroInputs = {
  bokRateDirection: 'HOLDING',
  usdKrw: '1320',
  vkospi: '18',
  vix: '18',
  exportGrowth3mAvg: '0',
  stockExportRatio: '50',
};

const MA_OPTIONS: SelectOption[] = [
  { value: 'UP', label: 'Bullish alignment' },
  { value: 'NEUTRAL', label: 'Neutral alignment' },
  { value: 'DOWN', label: 'Bearish alignment' },
];
const CLOUD_OPTIONS: SelectOption[] = [
  { value: 'ABOVE', label: 'Above cloud' },
  { value: 'INSIDE', label: 'Inside cloud' },
  { value: 'BELOW', label: 'Below cloud' },
];
const RATE_OPTIONS: SelectOption[] = [
  { value: 'HIKING', label: 'Hiking / Tightening' },
  { value: 'HOLDING', label: 'Holding / Pause' },
  { value: 'CUTTING', label: 'Cutting / Easing' },
];

function buildManualStockData(indicators: ManualIndicators): Record<ConditionId, number> {
  const stockData: Record<number, number> = {};
  for (let i = 1; i <= 27; i++) stockData[i] = 5;

  stockData[1] = indicators.cycleMatch ? 9 : 3;
  stockData[3] = indicators.roeGrowth ? 8 : 4;
  stockData[5] = 7;
  stockData[7] = 10;
  stockData[9] = 8;
  stockData[4] = Number(indicators.foreignBuying) > 0 ? 8 : 4;
  stockData[6] = indicators.ichimokuCloud === 'ABOVE' ? 9 : indicators.ichimokuCloud === 'BELOW' ? 2 : 5;
  stockData[10] = indicators.maAlignment === 'UP' ? 9 : indicators.maAlignment === 'DOWN' ? 2 : 5;
  stockData[11] = indicators.volumeSurge ? 9 : 5;
  stockData[12] = Number(indicators.foreignBuying) > 10 ? 9 : 5;

  const rsiVal = Number(indicators.rsi);
  stockData[26] = rsiVal > 30 && rsiVal < 70 ? 8 : 3;
  stockData[23] = Number(indicators.icr) > 3 ? 9 : Number(indicators.icr) > 1 ? 6 : 2;

  return stockData as Record<ConditionId, number>;
}

function buildMacroEnvironment(macroInputs: ManualMacroInputs, regime: MarketRegime): MacroEnvironment {
  return {
    bokRateDirection: macroInputs.bokRateDirection,
    us10yYield: 4.3,
    krUsSpread: -1.3,
    m2GrowthYoY: 6.5,
    bankLendingGrowth: 5.0,
    nominalGdpGrowth: 4.0,
    oeciCliKorea: 100,
    exportGrowth3mAvg: Number(macroInputs.exportGrowth3mAvg),
    vkospi: Number(macroInputs.vkospi),
    samsungIri: regime.samsungIri,
    vix: Number(macroInputs.vix),
    usdKrw: Number(macroInputs.usdKrw),
  };
}

function evaluateManualQuantInput(
  indicators: ManualIndicators,
  macroInputs: ManualMacroInputs,
  regime: MarketRegime,
  sectorRotation: SectorRotation,
): EvaluationResult {
  return evaluateStock({
    rawStockData: buildManualStockData(indicators),
    regime,
    profileType: 'B',
    sectorRotation,
    euphoriaSignals: 0,
    emergencyStop: false,
    rrr: 2.5,
    isPullbackVolumeLow: false,
    macroEnv: buildMacroEnvironment(macroInputs, regime),
    stockExportRatio: Number(macroInputs.stockExportRatio),
  });
}

function allMainGatesPassed(result: EvaluationResult): boolean {
  return result.gate1Passed && result.gate2Passed && result.gate3Passed;
}

function InputShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="glass-3d p-8 rounded-[2.5rem] border border-white/[0.07] shadow-xl">
      {children}
    </div>
  );
}

function ManualHeader() {
  return (
    <div className="flex items-center gap-4 mb-8">
      <div className="bg-indigo-500/20 p-3 rounded-2xl border border-indigo-500/30">
        <Calculator size={24} className="text-indigo-400" />
      </div>
      <div>
        <h2 className="text-2xl font-black text-white uppercase tracking-tighter">Manual Quant Input</h2>
        <p className="text-xs font-bold text-white/30 tracking-tight">Manual Indicator Input & Quant Engine</p>
      </div>
    </div>
  );
}

function SectionTitle({
  icon,
  label,
}: {
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <h3 className="text-sm font-black text-white/40 tracking-tight flex items-center gap-2">
      {icon} {label}
    </h3>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <label className="text-[10px] font-black text-white/20 tracking-tight ml-2">{children}</label>
  );
}

function TextInput({
  label,
  value,
  onChange,
  type = 'text',
  placeholder,
  step,
  min,
  max,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: 'text' | 'number';
  placeholder?: string;
  step?: string;
  min?: string;
  max?: string;
}) {
  return (
    <div className="space-y-2">
      <FieldLabel>{label}</FieldLabel>
      <input
        type={type}
        placeholder={placeholder}
        step={step}
        min={min}
        max={max}
        className={FIELD_CLASS}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

function SelectInput({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-2">
      <FieldLabel>{label}</FieldLabel>
      <select
        className={cn(FIELD_CLASS, 'appearance-none')}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map(option => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </div>
  );
}

function BasicInfoSection({
  stockInfo,
  setStockInfo,
}: {
  stockInfo: StockInfo;
  setStockInfo: React.Dispatch<React.SetStateAction<StockInfo>>;
}) {
  return (
    <div className="space-y-6">
      <SectionTitle icon={<Info size={14} />} label="Basic Info" />
      <div className="grid grid-cols-2 gap-4">
        <TextInput label="Stock Name" placeholder="e.g. HD Hyundai Heavy" value={stockInfo.name} onChange={(name) => setStockInfo(prev => ({ ...prev, name }))} />
        <TextInput label="Stock Code" placeholder="e.g. 329180" value={stockInfo.code} onChange={(code) => setStockInfo(prev => ({ ...prev, code }))} />
      </div>
      <TextInput label="Current Price" placeholder="e.g. 245000" value={stockInfo.currentPrice} onChange={(currentPrice) => setStockInfo(prev => ({ ...prev, currentPrice }))} />
    </div>
  );
}

function IndicatorSection({
  indicators,
  setIndicators,
}: {
  indicators: ManualIndicators;
  setIndicators: React.Dispatch<React.SetStateAction<ManualIndicators>>;
}) {
  return (
    <div className="space-y-6">
      <SectionTitle icon={<Activity size={14} />} label="Technical / Fundamental Inputs" />
      <div className="grid grid-cols-2 gap-4">
        <TextInput label="RSI (14)" type="number" value={indicators.rsi} onChange={(rsi) => setIndicators(prev => ({ ...prev, rsi }))} />
        <TextInput label="Interest Coverage Ratio" type="number" step="0.1" value={indicators.icr} onChange={(icr) => setIndicators(prev => ({ ...prev, icr }))} />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <SelectInput label="Moving Average Alignment" value={indicators.maAlignment} options={MA_OPTIONS} onChange={(maAlignment) => setIndicators(prev => ({ ...prev, maAlignment: maAlignment as ManualIndicators['maAlignment'] }))} />
        <SelectInput label="Ichimoku Cloud Position" value={indicators.ichimokuCloud} options={CLOUD_OPTIONS} onChange={(ichimokuCloud) => setIndicators(prev => ({ ...prev, ichimokuCloud: ichimokuCloud as ManualIndicators['ichimokuCloud'] }))} />
      </div>
      <TextInput label="Foreign Net Buying 5D (KRW bn)" type="number" value={indicators.foreignBuying} onChange={(foreignBuying) => setIndicators(prev => ({ ...prev, foreignBuying }))} />
    </div>
  );
}

function MacroEnvironmentSection({
  macroInputs,
  setMacroInputs,
}: {
  macroInputs: ManualMacroInputs;
  setMacroInputs: React.Dispatch<React.SetStateAction<ManualMacroInputs>>;
}) {
  return (
    <div className="mt-8 pt-8 border-t border-white/5 space-y-6">
      <SectionTitle icon={<Globe size={14} />} label="Macro Environment (Gate 0)" />
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <SelectInput label="BOK Rate Direction" value={macroInputs.bokRateDirection} options={RATE_OPTIONS} onChange={(bokRateDirection) => setMacroInputs(prev => ({ ...prev, bokRateDirection: bokRateDirection as ManualMacroInputs['bokRateDirection'] }))} />
        <TextInput label="USD/KRW" type="number" value={macroInputs.usdKrw} onChange={(usdKrw) => setMacroInputs(prev => ({ ...prev, usdKrw }))} />
        <TextInput label="VKOSPI" type="number" step="0.1" value={macroInputs.vkospi} onChange={(vkospi) => setMacroInputs(prev => ({ ...prev, vkospi }))} />
        <TextInput label="VIX" type="number" step="0.1" value={macroInputs.vix} onChange={(vix) => setMacroInputs(prev => ({ ...prev, vix }))} />
        <TextInput label="Export Growth 3MA (%)" type="number" step="0.1" value={macroInputs.exportGrowth3mAvg} onChange={(exportGrowth3mAvg) => setMacroInputs(prev => ({ ...prev, exportGrowth3mAvg }))} />
        <TextInput label="Stock Export Ratio (%)" type="number" min="0" max="100" value={macroInputs.stockExportRatio} onChange={(stockExportRatio) => setMacroInputs(prev => ({ ...prev, stockExportRatio }))} />
      </div>
    </div>
  );
}

function CalculateButton({ onClick }: { onClick: () => void }) {
  return (
    <div className="mt-10 flex justify-center">
      <button
        onClick={onClick}
        className="group relative px-12 py-4 bg-indigo-500 rounded-2xl overflow-hidden shadow-[0_0_40px_rgba(99,102,241,0.4)] hover:shadow-[0_0_60px_rgba(99,102,241,0.6)] transition-all duration-500"
      >
        <div className="absolute inset-0 bg-gradient-to-r from-indigo-400 to-purple-500 opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
        <div className="relative flex items-center gap-3">
          <Zap size={20} className="text-white fill-white" />
          <span className="text-lg font-black text-white uppercase tracking-tighter">Run Quant Engine</span>
        </div>
      </button>
    </div>
  );
}

function ManualInputCard({
  stockInfo,
  setStockInfo,
  indicators,
  setIndicators,
  macroInputs,
  setMacroInputs,
  onCalculate,
}: {
  stockInfo: StockInfo;
  setStockInfo: React.Dispatch<React.SetStateAction<StockInfo>>;
  indicators: ManualIndicators;
  setIndicators: React.Dispatch<React.SetStateAction<ManualIndicators>>;
  macroInputs: ManualMacroInputs;
  setMacroInputs: React.Dispatch<React.SetStateAction<ManualMacroInputs>>;
  onCalculate: () => void;
}) {
  return (
    <InputShell>
      <ManualHeader />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        <BasicInfoSection stockInfo={stockInfo} setStockInfo={setStockInfo} />
        <IndicatorSection indicators={indicators} setIndicators={setIndicators} />
      </div>
      <MacroEnvironmentSection macroInputs={macroInputs} setMacroInputs={setMacroInputs} />
      <CalculateButton onClick={onCalculate} />
    </InputShell>
  );
}

function gate0Tone(level: NonNullable<EvaluationResult['gate0Result']>['mhsLevel']) {
  return {
    HIGH: {
      shell: 'bg-emerald-500/10 border-emerald-500/30',
      text: 'text-emerald-400',
      status: 'Normal operation',
    },
    MEDIUM: {
      shell: 'bg-amber-500/10 border-amber-500/30',
      text: 'text-amber-400',
      status: 'Reduced Kelly operation',
    },
    LOW: {
      shell: 'bg-red-500/10 border-red-500/30',
      text: 'text-red-400',
      status: 'Buying halted',
    },
  }[level];
}

function rateCycleLabel(rateCycle: string): { title: string; body: string } {
  const labels: Record<string, { title: string; body: string }> = {
    TIGHTENING: { title: 'Tightening', body: 'ICR threshold tightened' },
    EASING: { title: 'Easing', body: 'Growth factor boosted' },
    NEUTRAL: { title: 'Neutral', body: 'Base mode' },
  };
  return labels[rateCycle] ?? { title: rateCycle, body: 'Base mode' };
}

function fxRegimeLabel(fxRegime: string): string {
  const labels: Record<string, string> = {
    DOLLAR_STRONG: 'Dollar strong',
    DOLLAR_WEAK: 'Dollar weak',
    NEUTRAL: 'Neutral',
  };
  return labels[fxRegime] ?? fxRegime;
}

function ResultHeader({
  result,
  stockInfo,
}: {
  result: EvaluationResult;
  stockInfo: StockInfo;
}) {
  const passed = allMainGatesPassed(result);
  return (
    <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-8 mb-12">
      <div>
        <div className="flex items-center gap-3 mb-2">
          <h3 className="text-fluid-4xl font-black text-white tracking-tighter">{stockInfo.name || 'Manual Stock'}</h3>
          <span className="text-sm font-black text-white/20 tracking-tight">{stockInfo.code}</span>
        </div>
        <p className="text-sm font-bold text-white/40 tracking-tight">Quant Engine Evaluation Result</p>
      </div>
      <div className="flex items-center gap-6">
        <div className="text-right">
          <span className="text-[10px] font-black text-white/20 tracking-tight block mb-1">Final Score</span>
          <div className="text-fluid-5xl font-black text-indigo-400 tracking-tighter">{result.finalScore.toFixed(1)}</div>
        </div>
        <div className={cn(
          'px-8 py-4 rounded-3xl border-2 flex flex-col items-center justify-center min-w-[160px]',
          passed ? 'bg-green-500/10 border-green-500/30 text-green-400' : 'bg-red-500/10 border-red-500/30 text-red-400'
        )}>
          <span className="text-[10px] font-semibold tracking-tight mb-1">Status</span>
          <span className="text-2xl font-black uppercase tracking-tighter">{passed ? 'PASS' : 'FAIL'}</span>
        </div>
      </div>
    </div>
  );
}

function Gate0Card({ result }: { result: EvaluationResult }) {
  const gate0 = result.gate0Result;
  if (!gate0) return null;

  const tone = gate0Tone(gate0.mhsLevel);
  const rate = rateCycleLabel(gate0.rateCycle);
  return (
    <div className={cn('p-6 rounded-[2rem] border mb-8', tone.shell)}>
      <div className="flex items-center gap-3 mb-4">
        <Globe size={18} className={tone.text} />
        <span className="text-[10px] font-black text-white/40 tracking-tight">Gate 0: Macro Survival Gate</span>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Gate0Metric title="MHS Score">
          <p className={cn('text-fluid-3xl font-black tracking-tighter', tone.text)}>
            {gate0.macroHealthScore}
            <span className="text-sm text-white/30 ml-1">/100</span>
          </p>
          <p className="text-xs font-bold text-white/30 mt-1">
            {gate0.mhsLevel === 'MEDIUM' ? `${tone.status} (${Math.round((1 - gate0.kellyReduction) * 100)}%)` : tone.status}
          </p>
        </Gate0Metric>
        <Gate0Metric title="Rate Cycle">
          <p className="text-lg font-black text-white tracking-tighter">{rate.title}</p>
          <p className="text-xs font-bold text-white/30 mt-1">{rate.body}</p>
        </Gate0Metric>
        <Gate0Metric title="FX Regime">
          <p className="text-lg font-black text-white tracking-tighter">{fxRegimeLabel(gate0.fxRegime)}</p>
          <p className="text-xs font-bold text-white/30 mt-1">
            FX adjustment: {result.fxAdjustmentFactor >= 0 ? '+' : ''}{result.fxAdjustmentFactor.toFixed(2)}pt
          </p>
        </Gate0Metric>
        <Gate0Metric title="Detail Scores">
          <div className="space-y-0.5 text-[10px] font-bold text-white/40">
            <p>Rates {gate0.details.interestRateScore}/25</p>
            <p>Liquidity {gate0.details.liquidityScore}/25</p>
            <p>Economy {gate0.details.economicScore}/25</p>
            <p>Risk {gate0.details.riskScore}/25</p>
          </div>
        </Gate0Metric>
      </div>
    </div>
  );
}

function Gate0Metric({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="text-[10px] font-black text-white/20 tracking-tight mb-1">{title}</p>
      {children}
    </div>
  );
}

function GateCard({
  icon,
  title,
  passed,
}: {
  icon: React.ReactNode;
  title: string;
  passed: boolean;
}) {
  return (
    <div className="bg-white/5 p-8 rounded-[2rem] border border-white/5 relative overflow-hidden group">
      <div className="absolute right-0 top-0 p-4 opacity-5 group-hover:opacity-10 transition-opacity">
        {icon}
      </div>
      <span className="text-[10px] font-black text-white/20 tracking-tight block mb-4">{title}</span>
      <div className="flex items-center gap-3">
        {passed ? <CheckCircle2 className="text-green-400" /> : <XCircle className="text-red-400" />}
        <span className="text-xl font-black text-white uppercase tracking-tighter">{passed ? 'Passed' : 'Failed'}</span>
      </div>
    </div>
  );
}

function GateGrid({ result }: { result: EvaluationResult }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-12">
      <GateCard icon={<ShieldCheck size={80} />} title="Gate 1: Survival Filter" passed={result.gate1Passed} />
      <GateCard icon={<TrendingUp size={80} />} title="Gate 2: Growth Validation" passed={result.gate2Passed} />
      <GateCard icon={<Zap size={80} />} title="Gate 3: Timing Breakout" passed={result.gate3Passed} />
    </div>
  );
}

function KellyCard({ result }: { result: EvaluationResult }) {
  const weight = allMainGatesPassed(result) ? result.positionSize.toFixed(1) : '0.0';
  return (
    <div className="bg-indigo-500/10 p-8 rounded-[2.5rem] border border-indigo-500/20">
      <div className="flex items-center gap-3 mb-6">
        <Wallet className="w-5 h-5 text-indigo-400" />
        <h4 className="text-sm font-black text-white tracking-tight">Kelly Criterion Position Sizing</h4>
      </div>
      <div className="flex items-end gap-4 mb-4">
        <div className="text-fluid-6xl font-black text-white tracking-tighter">{weight}%</div>
        <span className="text-sm font-bold text-white/40 tracking-tight mb-2">Recommended Weight</span>
      </div>
      <p className="text-xs font-medium text-white/40 leading-relaxed">
        Position size is derived from the same quant engine output, then shown as an advisory weight for this manual diagnostic view.
      </p>
    </div>
  );
}

function RiskRewardCard() {
  return (
    <div className="bg-white/5 p-8 rounded-[2.5rem] border border-white/5">
      <div className="flex items-center gap-3 mb-6">
        <BarChart3 className="w-5 h-5 text-purple-400" />
        <h4 className="text-sm font-black text-white tracking-tight">Risk/Reward Analysis</h4>
      </div>
      <div className="space-y-4">
        <RiskRewardRow label="Risk-Reward Ratio" value="2.5 : 1" className="text-white" />
        <RiskRewardRow label="Stop Loss" value="-12.0%" className="text-red-400" />
        <RiskRewardRow label="Target Profit" value="+30.0%" className="text-green-400" />
      </div>
    </div>
  );
}

function RiskRewardRow({
  label,
  value,
  className,
}: {
  label: string;
  value: string;
  className: string;
}) {
  return (
    <div className="flex items-center justify-between p-4 bg-white/5 rounded-2xl">
      <span className="text-xs font-bold text-white/40 tracking-tight">{label}</span>
      <span className={cn('text-lg font-black', className)}>{value}</span>
    </div>
  );
}

function ResultSection({
  result,
  stockInfo,
}: {
  result: EvaluationResult;
  stockInfo: StockInfo;
}) {
  return (
    <div className="glass-3d p-10 rounded-[3rem] border border-white/[0.07] shadow-xl animate-in fade-in zoom-in duration-700">
      <ResultHeader result={result} stockInfo={stockInfo} />
      <Gate0Card result={result} />
      <GateGrid result={result} />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <KellyCard result={result} />
        <RiskRewardCard />
      </div>
    </div>
  );
}

export const ManualQuantInput: React.FC<ManualQuantInputProps> = ({ regime, sectorRotation }) => {
  const [stockInfo, setStockInfo] = useState<StockInfo>(INITIAL_STOCK_INFO);
  const [indicators, setIndicators] = useState<ManualIndicators>(INITIAL_INDICATORS);
  const [macroInputs, setMacroInputs] = useState<ManualMacroInputs>(INITIAL_MACRO_INPUTS);
  const [result, setResult] = useState<EvaluationResult | null>(null);

  const handleCalculate = () => {
    setResult(evaluateManualQuantInput(indicators, macroInputs, regime, sectorRotation));
  };

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-1000">
      <ManualInputCard
        stockInfo={stockInfo}
        setStockInfo={setStockInfo}
        indicators={indicators}
        setIndicators={setIndicators}
        macroInputs={macroInputs}
        setMacroInputs={setMacroInputs}
        onCalculate={handleCalculate}
      />
      {result && <ResultSection result={result} stockInfo={stockInfo} />}
    </div>
  );
};
