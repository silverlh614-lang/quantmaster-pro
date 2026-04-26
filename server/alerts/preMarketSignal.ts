/**
 * preMarketSignal.ts — 홍콩 30분 선행 모델 (장전 방향 최종 교정)
 *
 * ┌─ 아이디어 ─────────────────────────────────────────────────────────────────┐
 * │ 한국 개장 전 참조할 수 있는 글로벌 선행 지표를 한 장의 "방향 카드"로 압축.  │
 * │ • ^HSI          홍콩 항셍 (전일 종가 — 아시아 심리)                          │
 * │ • ^N225         니케이 225 (한국과 1시간 내 동조)                           │
 * │ • ES=F          S&P500 선물 (미국 오버나이트)                               │
 * │ • NQ=F          나스닥 선물                                                  │
 * │ • ^VIX          VIX 종가 (변동성 체제)                                       │
 * │ • KRW=X         USD/KRW (외국인 유입 압력)                                   │
 * │                                                                              │
 * │ 5개 지표의 전일 변동률을 가중합해 Bias Score(−100~+100)를 산출하고,          │
 * │ ±40 초과 시 Telegram 선제 경보.                                              │
 * └────────────────────────────────────────────────────────────────────────────┘
 *
 * 트리거: KST 08:30 cron (개장 30분 전)
 * 보조: KST 10:45 cron (HK 개장 30분 후 — live ^HSI intraday 반영)
 *
 * 선행성 근거:
 *   • 항셍 선물/전일 종가 → 외국인 달러 자금 아시아 배분 방향
 *   • 니케이 → 동북아 위험선호 상관 0.7+
 *   • ES/NQ → 간밤 미국 심리 재조정
 */

import fs from 'fs';
import { fetchCloses } from '../trading/marketDataRefresh.js';
import { sendTelegramAlert } from './telegramClient.js';
import { PRE_MARKET_SIGNAL_FILE, ensureDataDir } from '../persistence/paths.js';
import { safePctChange } from '../utils/safePctChange.js';

// ── 타입 ──────────────────────────────────────────────────────────────────────

interface SignalSymbol {
  symbol:  string;
  label:   string;
  weight:  number;   // Bias Score 가중치 (총합 1.0)
  /** 순방향 여부 — USD/KRW 같이 "상승=위험" 지표는 invert=true */
  invert?: boolean;
}

export interface PreMarketSnapshot {
  symbol:    string;
  label:     string;
  last:      number | null;
  changePct: number | null;    // 전일 대비 %
  weight:    number;
}

export interface PreMarketSignalReport {
  createdAt:     string;
  trigger:       'OPEN_MINUS_30' | 'HK_OPEN_PLUS_30';
  snapshots:     PreMarketSnapshot[];
  biasScore:     number;                       // −100 ~ +100
  biasDirection: 'BULL' | 'BEAR' | 'NEUTRAL';
  alertSent:     boolean;
}

interface PersistedState {
  lastReports: PreMarketSignalReport[];        // 최근 50건
}

// ── 대상 지표 (가중치 합계 = 1.0) ─────────────────────────────────────────────

const SIGNAL_SYMBOLS: SignalSymbol[] = [
  { symbol: '^HSI',  label: '항셍',       weight: 0.25 },
  { symbol: '^N225', label: '니케이225',  weight: 0.20 },
  { symbol: 'ES=F',  label: 'S&P500선물', weight: 0.20 },
  { symbol: 'NQ=F',  label: '나스닥선물', weight: 0.15 },
  { symbol: 'KRW=X', label: 'USD/KRW',    weight: 0.10, invert: true },
  { symbol: '^VIX',  label: 'VIX',        weight: 0.10, invert: true },
];

// ── 임계값 ────────────────────────────────────────────────────────────────────

const BIAS_ALERT_THRESHOLD = 40;

// ── 영속성 ────────────────────────────────────────────────────────────────────

function loadState(): PersistedState {
  ensureDataDir();
  if (!fs.existsSync(PRE_MARKET_SIGNAL_FILE)) return { lastReports: [] };
  try { return JSON.parse(fs.readFileSync(PRE_MARKET_SIGNAL_FILE, 'utf-8')); } catch { return { lastReports: [] }; }
}

/** 대시보드용 — 가장 최근 Pre-Market Bias Score 리포트 반환. */
export function getLatestPreMarketReport(): PreMarketSignalReport | null {
  const state = loadState();
  return state.lastReports.length > 0 ? state.lastReports[state.lastReports.length - 1] : null;
}

function saveState(state: PersistedState): void {
  ensureDataDir();
  const kept = state.lastReports.slice(-50);
  fs.writeFileSync(PRE_MARKET_SIGNAL_FILE, JSON.stringify({ lastReports: kept }, null, 2));
}

// ── 스냅샷 조회 ───────────────────────────────────────────────────────────────

async function fetchSnapshot(sym: SignalSymbol): Promise<PreMarketSnapshot> {
  const closes = await fetchCloses(sym.symbol, '5d').catch(() => null);
  if (!closes || closes.length < 2) {
    return { symbol: sym.symbol, label: sym.label, last: null, changePct: null, weight: sym.weight };
  }
  const last = closes[closes.length - 1];
  const prev = closes[closes.length - 2];
  if (!prev || prev === 0) {
    return { symbol: sym.symbol, label: sym.label, last, changePct: null, weight: sym.weight };
  }
  // ADR-0028: stale prev 시 0 fallback — 장전 신호 글로벌 시장 표기 보호.
  const changePct = safePctChange(last, prev, { label: `preMarketSignal:${sym.symbol}` }) ?? 0;
  return {
    symbol:    sym.symbol,
    label:     sym.label,
    last:      parseFloat(last.toFixed(2)),
    changePct: parseFloat(changePct.toFixed(2)),
    weight:    sym.weight,
  };
}

// ── Bias Score 계산 ──────────────────────────────────────────────────────────

/**
 * 가중 Bias Score (-100 ~ +100).
 * 각 지표의 전일 대비 변화율을 tanh 로 squash(감쇄) 후 가중합.
 * invert=true 지표는 부호 반전 (예: USD/KRW 상승 = 위험 → 음의 기여).
 */
function computeBiasScore(snapshots: PreMarketSnapshot[]): number {
  let score = 0;
  let totalWeight = 0;
  for (const s of snapshots) {
    if (s.changePct == null) continue;
    const sym    = SIGNAL_SYMBOLS.find(x => x.symbol === s.symbol);
    const signed = sym?.invert ? -s.changePct : s.changePct;
    // tanh squash — ±3% 근처에서 포화, 극단값 왜곡 방지
    const squash = Math.tanh(signed / 2) * 100;
    score       += squash * s.weight;
    totalWeight += s.weight;
  }
  if (totalWeight === 0) return 0;
  return parseFloat((score / totalWeight).toFixed(1));
}

// ── 메시지 포맷 ──────────────────────────────────────────────────────────────

function formatAlert(report: PreMarketSignalReport): string {
  const lines = report.snapshots.map(s => {
    if (s.changePct == null) return `• ${s.label}: N/A`;
    const sign = s.changePct >= 0 ? '+' : '';
    const arrow = s.changePct >= 0 ? '▲' : '▼';
    return `• ${s.label}: ${arrow} ${sign}${s.changePct}%`;
  });

  const dirIcon =
    report.biasDirection === 'BULL'    ? '🟢' :
    report.biasDirection === 'BEAR'    ? '🔴' : '⚪';

  const triggerLabel =
    report.trigger === 'OPEN_MINUS_30'   ? '개장 30분 전 (08:30 KST)' :
    '항셍 개장 30분 후 (10:45 KST)';

  const guide =
    report.biasDirection === 'BULL'
      ? '매수 후보 우선 검토 · 레짐 확정 전 제한적 신규진입'
      : report.biasDirection === 'BEAR'
      ? '현금 비중 확대 · 신규진입 홀드 · 손절선 타이트화'
      : '방향성 불명확 — 관망';

  return (
    `🧭 <b>[장전 방향 카드]</b> ${triggerLabel}\n` +
    `━━━━━━━━━━━━━━━━\n` +
    `${dirIcon} <b>Bias Score: ${report.biasScore >= 0 ? '+' : ''}${report.biasScore}</b> ` +
    `(${report.biasDirection})\n\n` +
    lines.join('\n') + `\n\n` +
    `📌 ${guide}`
  );
}

// ── 메인 엔트리 ───────────────────────────────────────────────────────────────

/**
 * 6개 글로벌 지표 스냅샷 → Bias Score → |score| ≥ 40 이면 Telegram 경보.
 *
 * @param trigger 실행 컨텍스트 — 08:30 KST(OPEN_MINUS_30) | 10:45 KST(HK_OPEN_PLUS_30)
 */
export async function runPreMarketSignal(
  trigger: PreMarketSignalReport['trigger'] = 'OPEN_MINUS_30',
): Promise<PreMarketSignalReport> {
  const snapshots = await Promise.all(SIGNAL_SYMBOLS.map(fetchSnapshot));
  const biasScore = computeBiasScore(snapshots);

  const biasDirection: PreMarketSignalReport['biasDirection'] =
    biasScore >=  BIAS_ALERT_THRESHOLD ? 'BULL' :
    biasScore <= -BIAS_ALERT_THRESHOLD ? 'BEAR' : 'NEUTRAL';

  const report: PreMarketSignalReport = {
    createdAt: new Date().toISOString(),
    trigger,
    snapshots,
    biasScore,
    biasDirection,
    alertSent: false,
  };

  const validCount = snapshots.filter(s => s.changePct != null).length;
  if (validCount < 3) {
    console.warn(`[PreMarket] 유효 지표 ${validCount}개 — 3개 미만으로 경보 스킵`);
  } else if (biasDirection !== 'NEUTRAL') {
    await sendTelegramAlert(formatAlert(report), {
      priority:  'HIGH',
      dedupeKey: `pre_market:${trigger}:${new Date().toISOString().slice(0, 10)}`,
    }).catch(console.error);
    report.alertSent = true;
  }

  console.log(
    `[PreMarket] ${trigger} Bias=${biasScore >= 0 ? '+' : ''}${biasScore} (${biasDirection}) ` +
    `— ${snapshots.map(s => `${s.label}=${s.changePct ?? 'N/A'}%`).join(', ')}`,
  );

  const state = loadState();
  state.lastReports.push(report);
  saveState(state);

  return report;
}
