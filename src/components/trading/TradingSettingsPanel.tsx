/**
 * TradingSettingsPanel — Quantus 스타일 트레이딩 설정 패널
 * 매수 조건, 자동 손절, 포지션 한도, 운용 시간, OCO 등록 — 대형 카드 형태
 */
import React, { useState, useEffect, useCallback } from 'react';
import {
  ShieldCheck, TrendingDown, PieChart, Clock, ArrowRightLeft,
  Save, RotateCcw, Loader2,
} from 'lucide-react';
import { motion } from 'motion/react';
import { cn } from '../../ui/cn';
import { Card } from '../../ui/card';
import { Badge } from '../../ui/badge';
import { autoTradeApi } from '../../api';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface TradingSettings {
  buyCondition: {
    gatePassRequired: boolean;
    minScoreThreshold: number;
  };
  autoStopLoss: {
    enabled: boolean;
    level1: number;
    level2: number;
    level3: number;
  };
  positionLimit: {
    enabled: boolean;
    maxSingleStockPercent: number;
  };
  tradingHours: {
    enabled: boolean;
    startTime: string;
    endTime: string;
  };
  ocoAutoRegister: {
    enabled: boolean;
  };
  updatedAt: string;
}

const DEFAULT_SETTINGS: TradingSettings = {
  buyCondition: { gatePassRequired: true, minScoreThreshold: 60 },
  autoStopLoss: { enabled: true, level1: -7, level2: -15, level3: -25 },
  positionLimit: { enabled: true, maxSingleStockPercent: 15 },
  tradingHours: { enabled: true, startTime: '09:00', endTime: '15:30' },
  ocoAutoRegister: { enabled: true },
  updatedAt: '',
};

// ─── Toggle Switch ──────────────────────────────────────────────────────────

function Toggle({ enabled, onToggle, label }: { enabled: boolean; onToggle: () => void; label?: string }) {
  return (
    <button
      onClick={onToggle}
      className={cn(
        'relative inline-flex h-6 w-11 items-center rounded-full transition-colors shrink-0',
        enabled ? 'bg-green-500' : 'bg-white/15'
      )}
    >
      <span
        className={cn(
          'inline-block h-4 w-4 transform rounded-full bg-white transition-transform shadow-md',
          enabled ? 'translate-x-6' : 'translate-x-1'
        )}
      />
      {label && <span className="sr-only">{label}</span>}
    </button>
  );
}

// ─── Slider ─────────────────────────────────────────────────────────────────

function Slider({
  value, min, max, step = 1, onChange, suffix = '', label, description,
}: {
  value: number; min: number; max: number; step?: number;
  onChange: (v: number) => void; suffix?: string; label: string; description?: string;
}) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs text-theme-text-muted">{label}</span>
        <span className="text-sm font-black text-theme-text font-num">{value}{suffix}</span>
      </div>
      <div className="relative">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="w-full h-2 rounded-full appearance-none cursor-pointer
                     [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-5 [&::-webkit-slider-thumb]:h-5
                     [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white
                     [&::-webkit-slider-thumb]:shadow-[0_0_10px_rgba(255,255,255,0.3)]
                     [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-violet-400
                     [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:relative [&::-webkit-slider-thumb]:z-10
                     [&::-moz-range-thumb]:w-5 [&::-moz-range-thumb]:h-5
                     [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-white
                     [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-violet-400"
          style={{
            background: `linear-gradient(to right, rgb(139 92 246) ${pct}%, rgba(255,255,255,0.1) ${pct}%)`,
          }}
        />
      </div>
      {description && <p className="text-[10px] text-theme-text-muted leading-relaxed">{description}</p>}
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────────

export function TradingSettingsPanel() {
  const [settings, setSettings] = useState<TradingSettings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  // 서버에서 설정 로드
  useEffect(() => {
    autoTradeApi.getTradingSettings()
      .then(data => {
        setSettings({ ...DEFAULT_SETTINGS, ...data });
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  type SectionKey = {
    [K in keyof TradingSettings]: TradingSettings[K] extends object ? K : never
  }[keyof TradingSettings];

  const update = useCallback(<K extends SectionKey>(
    section: K,
    patch: Partial<TradingSettings[K]>
  ) => {
    setSettings(prev => ({
      ...prev,
      [section]: { ...(prev[section] as object), ...patch },
    }));
    setDirty(true);
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      await autoTradeApi.saveTradingSettings(settings);
      setDirty(false);
    } catch (e) {
      console.error('[TradingSettings] 저장 실패:', e);
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    setSettings(DEFAULT_SETTINGS);
    setDirty(true);
  };

  if (loading) {
    return (
      <Card padding="md">
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-5 h-5 animate-spin text-theme-text-muted" />
          <span className="ml-2 text-sm text-theme-text-muted">설정 불러오는 중...</span>
        </div>
      </Card>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-4"
    >
      {/* Section Title + Actions */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-black text-theme-text uppercase tracking-wider">
            트레이딩 설정
          </h3>
          <p className="text-[10px] text-theme-text-muted mt-0.5">
            Quantus 스타일 자동매매 파라미터를 개별 카드에서 설정합니다
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleReset}
            className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-bold text-theme-text-muted
                       bg-white/5 hover:bg-white/10 rounded-lg border border-theme-border transition-colors"
          >
            <RotateCcw className="w-3 h-3" />
            초기화
          </button>
          <button
            onClick={handleSave}
            disabled={!dirty || saving}
            className={cn(
              'flex items-center gap-1.5 px-4 py-1.5 text-[10px] font-bold rounded-lg transition-all',
              dirty
                ? 'bg-violet-500 hover:bg-violet-400 text-white shadow-[0_0_16px_rgba(139,92,246,0.3)]'
                : 'bg-white/5 text-theme-text-muted cursor-not-allowed'
            )}
          >
            {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
            저장
          </button>
        </div>
      </div>

      {/* ─── Card 1: 매수 조건 ─────────────────────────────────────────────── */}
      <Card padding="md">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl bg-green-500/10 border border-green-500/20 flex items-center justify-center">
            <ShieldCheck className="w-5 h-5 text-green-400" />
          </div>
          <div className="flex-1 min-w-0">
            <h4 className="text-sm font-black text-theme-text">매수 조건</h4>
            <p className="text-[10px] text-theme-text-muted mt-0.5">
              Gate 통과 필수 여부와 최소 스코어 임계값을 설정합니다. Gate를 통과하지 못한 종목은 자동매매 대상에서 제외됩니다.
            </p>
          </div>
          <Toggle
            enabled={settings.buyCondition.gatePassRequired}
            onToggle={() => update('buyCondition', { gatePassRequired: !settings.buyCondition.gatePassRequired })}
            label="Gate 통과 필수"
          />
        </div>
        <div className="space-y-4 mt-4">
          <div className="flex items-center justify-between">
            <span className="text-xs text-theme-text-muted">Gate 통과 필수</span>
            <Badge variant={settings.buyCondition.gatePassRequired ? 'success' : 'default'} size="sm">
              {settings.buyCondition.gatePassRequired ? 'ON' : 'OFF'}
            </Badge>
          </div>
          <Slider
            label="최소 스코어 임계값"
            description="이 점수 이상인 종목만 매수 후보에 포함됩니다. 높을수록 보수적 (권장: 55~70)"
            value={settings.buyCondition.minScoreThreshold}
            min={0}
            max={100}
            step={5}
            suffix="점"
            onChange={(v) => update('buyCondition', { minScoreThreshold: v })}
          />
        </div>
      </Card>

      {/* ─── Card 2: 자동 손절 ─────────────────────────────────────────────── */}
      <Card padding="md">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl bg-red-500/10 border border-red-500/20 flex items-center justify-center">
            <TrendingDown className="w-5 h-5 text-red-400" />
          </div>
          <div className="flex-1 min-w-0">
            <h4 className="text-sm font-black text-theme-text">자동 손절 (3단계 강제 청산)</h4>
            <p className="text-[10px] text-theme-text-muted mt-0.5">
              매수 후 하락 시 3단계로 자동 손절합니다. 1차 손절에서 일부 청산, 2차에서 추가 청산, 3차에서 전량 강제 청산합니다.
            </p>
          </div>
          <Toggle
            enabled={settings.autoStopLoss.enabled}
            onToggle={() => update('autoStopLoss', { enabled: !settings.autoStopLoss.enabled })}
            label="자동 손절 활성화"
          />
        </div>
        {settings.autoStopLoss.enabled && (
          <div className="space-y-4 mt-4">
            {/* 3-Level Visual */}
            <div className="grid grid-cols-3 gap-3">
              {[
                { key: 'level1' as const, label: '1차 부분청산', color: 'amber', desc: '1/3 물량 청산' },
                { key: 'level2' as const, label: '2차 추가청산', color: 'orange', desc: '1/3 물량 추가 청산' },
                { key: 'level3' as const, label: '3차 전량청산', color: 'red', desc: '잔여 전량 강제 청산' },
              ].map(({ key, label, color, desc }) => (
                <div
                  key={key}
                  className={cn(
                    'rounded-xl p-3 border text-center',
                    `border-${color}-500/20 bg-${color}-500/5`
                  )}
                >
                  <span className={`text-[9px] font-black text-${color}-400 uppercase tracking-widest block mb-1`}>
                    {label}
                  </span>
                  <span className={`text-lg font-black text-${color}-400 font-num`}>
                    {settings.autoStopLoss[key]}%
                  </span>
                  <p className="text-[9px] text-theme-text-muted mt-1">{desc}</p>
                </div>
              ))}
            </div>
            <Slider
              label="1차 손절 기준"
              value={settings.autoStopLoss.level1}
              min={-20}
              max={-1}
              step={1}
              suffix="%"
              onChange={(v) => update('autoStopLoss', { level1: v })}
            />
            <Slider
              label="2차 손절 기준"
              value={settings.autoStopLoss.level2}
              min={-30}
              max={-5}
              step={1}
              suffix="%"
              onChange={(v) => update('autoStopLoss', { level2: v })}
            />
            <Slider
              label="3차 강제 청산 기준"
              value={settings.autoStopLoss.level3}
              min={-50}
              max={-10}
              step={1}
              suffix="%"
              onChange={(v) => update('autoStopLoss', { level3: v })}
            />
          </div>
        )}
      </Card>

      {/* ─── Card 3: 포지션 한도 ───────────────────────────────────────────── */}
      <Card padding="md">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center">
            <PieChart className="w-5 h-5 text-blue-400" />
          </div>
          <div className="flex-1 min-w-0">
            <h4 className="text-sm font-black text-theme-text">포지션 한도</h4>
            <p className="text-[10px] text-theme-text-muted mt-0.5">
              단일 종목에 대한 최대 포트폴리오 비중을 제한합니다. 집중 투자 리스크를 방지하여 분산 효과를 유지합니다.
            </p>
          </div>
          <Toggle
            enabled={settings.positionLimit.enabled}
            onToggle={() => update('positionLimit', { enabled: !settings.positionLimit.enabled })}
            label="포지션 한도 활성화"
          />
        </div>
        {settings.positionLimit.enabled && (
          <div className="mt-4">
            <Slider
              label="단일 종목 최대 비중"
              description="한 종목이 전체 포트폴리오에서 차지할 수 있는 최대 비중입니다. 15% 이하를 권장합니다."
              value={settings.positionLimit.maxSingleStockPercent}
              min={5}
              max={50}
              step={1}
              suffix="%"
              onChange={(v) => update('positionLimit', { maxSingleStockPercent: v })}
            />
            {/* Visual Cap Indicator */}
            <div className="mt-4 flex items-center gap-2">
              <div className="flex-1 h-3 rounded-full bg-white/5 overflow-hidden">
                <div
                  className={cn(
                    'h-full rounded-full transition-all',
                    settings.positionLimit.maxSingleStockPercent <= 15 ? 'bg-green-500' :
                    settings.positionLimit.maxSingleStockPercent <= 25 ? 'bg-amber-500' : 'bg-red-500'
                  )}
                  style={{ width: `${settings.positionLimit.maxSingleStockPercent}%` }}
                />
              </div>
              <Badge
                variant={
                  settings.positionLimit.maxSingleStockPercent <= 15 ? 'success' :
                  settings.positionLimit.maxSingleStockPercent <= 25 ? 'warning' : 'danger'
                }
                size="sm"
              >
                {settings.positionLimit.maxSingleStockPercent <= 15 ? '안전' :
                 settings.positionLimit.maxSingleStockPercent <= 25 ? '주의' : '위험'}
              </Badge>
            </div>
          </div>
        )}
      </Card>

      {/* ─── Card 4: 운용 시간 ─────────────────────────────────────────────── */}
      <Card padding="md">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center">
            <Clock className="w-5 h-5 text-cyan-400" />
          </div>
          <div className="flex-1 min-w-0">
            <h4 className="text-sm font-black text-theme-text">운용 시간</h4>
            <p className="text-[10px] text-theme-text-muted mt-0.5">
              장중 자동매매가 활성화되는 시간대를 설정합니다. 설정 시간 외에는 신규 주문이 발생하지 않습니다.
            </p>
          </div>
          <Toggle
            enabled={settings.tradingHours.enabled}
            onToggle={() => update('tradingHours', { enabled: !settings.tradingHours.enabled })}
            label="운용 시간 제한 활성화"
          />
        </div>
        {settings.tradingHours.enabled && (
          <div className="mt-4 space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-[10px] font-bold text-theme-text-muted uppercase tracking-widest block mb-2">
                  시작 시간
                </label>
                <input
                  type="time"
                  value={settings.tradingHours.startTime}
                  onChange={(e) => update('tradingHours', { startTime: e.target.value })}
                  className="w-full bg-white/5 border border-theme-border rounded-lg px-3 py-2 text-sm
                             text-theme-text font-num focus:outline-none focus:border-cyan-500/50 transition-colors"
                />
              </div>
              <div>
                <label className="text-[10px] font-bold text-theme-text-muted uppercase tracking-widest block mb-2">
                  종료 시간
                </label>
                <input
                  type="time"
                  value={settings.tradingHours.endTime}
                  onChange={(e) => update('tradingHours', { endTime: e.target.value })}
                  className="w-full bg-white/5 border border-theme-border rounded-lg px-3 py-2 text-sm
                             text-theme-text font-num focus:outline-none focus:border-cyan-500/50 transition-colors"
                />
              </div>
            </div>
            {/* Timeline Visual */}
            <div className="relative h-8 rounded-lg bg-white/5 overflow-hidden">
              {(() => {
                const [sh, sm] = settings.tradingHours.startTime.split(':').map(Number);
                const [eh, em] = settings.tradingHours.endTime.split(':').map(Number);
                const startMin = sh * 60 + sm;
                const endMin = eh * 60 + em;
                const dayStart = 8 * 60; // 08:00
                const dayEnd = 16 * 60;  // 16:00
                const range = dayEnd - dayStart;
                const left = ((startMin - dayStart) / range) * 100;
                const width = ((endMin - startMin) / range) * 100;
                return (
                  <div
                    className="absolute top-0 bottom-0 bg-cyan-500/20 border-x-2 border-cyan-400"
                    style={{ left: `${Math.max(0, left)}%`, width: `${Math.min(100, width)}%` }}
                  >
                    <span className="absolute left-1 top-1/2 -translate-y-1/2 text-[9px] font-bold text-cyan-400">
                      {settings.tradingHours.startTime}
                    </span>
                    <span className="absolute right-1 top-1/2 -translate-y-1/2 text-[9px] font-bold text-cyan-400">
                      {settings.tradingHours.endTime}
                    </span>
                  </div>
                );
              })()}
            </div>
          </div>
        )}
      </Card>

      {/* ─── Card 5: OCO 등록 ──────────────────────────────────────────────── */}
      <Card padding="md">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-violet-500/10 border border-violet-500/20 flex items-center justify-center">
            <ArrowRightLeft className="w-5 h-5 text-violet-400" />
          </div>
          <div className="flex-1 min-w-0">
            <h4 className="text-sm font-black text-theme-text">OCO 자동 등록</h4>
            <p className="text-[10px] text-theme-text-muted mt-0.5">
              진입 시 손절/익절 주문을 동시에 등록합니다 (One-Cancels-Other). 한쪽이 체결되면 반대 주문은 자동 취소됩니다.
              감정적 매매를 방지하고 기계적 실행을 보장합니다.
            </p>
          </div>
          <Toggle
            enabled={settings.ocoAutoRegister.enabled}
            onToggle={() => update('ocoAutoRegister', { enabled: !settings.ocoAutoRegister.enabled })}
            label="OCO 자동 등록"
          />
        </div>
        {settings.ocoAutoRegister.enabled && (
          <div className="mt-4 rounded-lg bg-violet-500/5 border border-violet-500/10 p-3">
            <div className="flex items-center gap-3 text-xs">
              <div className="flex-1 text-center">
                <span className="text-[9px] text-green-400 font-black uppercase block">익절</span>
                <span className="text-theme-text font-num">목표가 도달 시 자동 매도</span>
              </div>
              <ArrowRightLeft className="w-4 h-4 text-violet-400 shrink-0" />
              <div className="flex-1 text-center">
                <span className="text-[9px] text-red-400 font-black uppercase block">손절</span>
                <span className="text-theme-text font-num">손절가 도달 시 자동 매도</span>
              </div>
            </div>
          </div>
        )}
      </Card>
    </motion.div>
  );
}
