/**
 * dxyMonitor.ts — 달러인덱스(DXY) 실시간 수급 방향 전환 예비 경보
 *
 * ┌─ 아이디어 ─────────────────────────────────────────────────────────────────┐
 * │ 외국인 수급 선행지표 중 하나: 달러인덱스(DXY).                               │
 * │ • DXY 급등  → EM(이머징) 자금이탈 → EWY 매도 → KOSPI 외국인 순매도           │
 * │ • DXY 약세  → 리스크온 전환 → EWY 유입 → KOSPI 외국인 복귀                   │
 * │                                                                              │
 * │ Yahoo Finance의 DX-Y.NYB 사용 — 추가 API 키 불필요.                          │
 * │ (기존 marketDataRefresh가 dxy5dChange 필드로 이미 소비 중 — 별도 API 미추가) │
 * └────────────────────────────────────────────────────────────────────────────┘
 *
 * 트리거:
 *   1d 변화율 |≥ 0.6%|  또는  5d 변화율 |≥ 1.5%|   → "예비 경보"
 *   양쪽 모두 초과                                   → "확정 경보" (CRITICAL)
 *
 * 교차 검증 (alert 강화):
 *   • DXY↑ & KRW=X↑ & EWY↓  →  외국인 이탈 시그널 확정
 *   • DXY↓ & KRW=X↓ & EWY↑  →  외국인 복귀 시그널 확정
 *
 * cron: 미국 장 마감 직후 KST 06:05 (UTC 21:05 일~목)
 *       + 한국 장 직전 KST 08:40 (UTC 23:40) 재확인
 */

import fs from 'fs';
import { fetchCloses } from '../trading/marketDataRefresh.js';
import { sendTelegramAlert } from './telegramClient.js';
import { DXY_MONITOR_STATE_FILE, ensureDataDir } from '../persistence/paths.js';
import { logNewsSupplyEvent } from '../learning/newsSupplyLogger.js';

// ── 임계값 ────────────────────────────────────────────────────────────────────

const DXY_1D_THRESHOLD = 0.6;   // %
const DXY_5D_THRESHOLD = 1.5;   // %

// ── 타입 ──────────────────────────────────────────────────────────────────────

export interface DxyReading {
  last:       number;      // DXY 종가
  change1d:   number;      // %
  change5d:   number;      // %
  krwChange:  number | null;  // USD/KRW 1d %
  ewyChange:  number | null;  // EWY 1d %
}

export interface DxyAlertReport {
  createdAt:   string;
  reading:     DxyReading;
  direction:   'STRENGTH' | 'WEAKNESS';
  severity:    'CONFIRMED' | 'PRELIMINARY';
  flowBias:    'FOREIGN_OUTFLOW' | 'FOREIGN_INFLOW' | 'UNCLEAR';
  alertSent:   boolean;
}

interface PersistedState {
  lastSentAt:    string;         // ISO
  lastDirection: 'STRENGTH' | 'WEAKNESS' | null;
  lastChange1d:  number;
  history:       DxyAlertReport[];  // 최근 50건
}

// ── 영속성 ────────────────────────────────────────────────────────────────────

function loadState(): PersistedState | null {
  ensureDataDir();
  if (!fs.existsSync(DXY_MONITOR_STATE_FILE)) return null;
  try { return JSON.parse(fs.readFileSync(DXY_MONITOR_STATE_FILE, 'utf-8')); } catch { return null; }
}

/** 대시보드용 — 가장 최근 DXY 경보 리포트. 없으면 null. */
export function getLatestDxyReport(): DxyAlertReport | null {
  const state = loadState();
  if (!state || !state.history || state.history.length === 0) return null;
  return state.history[state.history.length - 1];
}

function saveState(state: PersistedState): void {
  ensureDataDir();
  state.history = state.history.slice(-50);
  fs.writeFileSync(DXY_MONITOR_STATE_FILE, JSON.stringify(state, null, 2));
}

// ── N일 변화율 ────────────────────────────────────────────────────────────────

function nDayPct(closes: number[], n: number): number | null {
  if (closes.length < n + 1) return null;
  const past    = closes[closes.length - 1 - n];
  const current = closes[closes.length - 1];
  if (!past || past <= 0) return null;
  return parseFloat((((current - past) / past) * 100).toFixed(2));
}

// ── 교차 검증 ─────────────────────────────────────────────────────────────────

function determineFlowBias(reading: DxyReading): DxyAlertReport['flowBias'] {
  const { change1d, krwChange, ewyChange } = reading;
  if (krwChange == null || ewyChange == null) return 'UNCLEAR';
  // DXY↑ & KRW↑ & EWY↓ → 외국인 이탈
  if (change1d > 0 && krwChange > 0 && ewyChange < 0) return 'FOREIGN_OUTFLOW';
  // DXY↓ & KRW↓ & EWY↑ → 외국인 복귀
  if (change1d < 0 && krwChange < 0 && ewyChange > 0) return 'FOREIGN_INFLOW';
  return 'UNCLEAR';
}

// ── 메시지 포맷 ──────────────────────────────────────────────────────────────

function formatAlert(report: DxyAlertReport): string {
  const { reading, direction, severity, flowBias } = report;
  const arrow  = direction === 'STRENGTH' ? '▲' : '▼';
  const icon   = severity === 'CONFIRMED' ? '🚨' : '⚠️';
  const sign1  = reading.change1d >= 0 ? '+' : '';
  const sign5  = reading.change5d >= 0 ? '+' : '';

  const biasLine =
    flowBias === 'FOREIGN_OUTFLOW'
      ? '🔴 <b>외국인 이탈 시그널</b> (DXY↑·KRW↑·EWY↓ 동시)'
      : flowBias === 'FOREIGN_INFLOW'
      ? '🟢 <b>외국인 복귀 시그널</b> (DXY↓·KRW↓·EWY↑ 동시)'
      : '⚪ 교차 검증 불일치 — DXY 단독 시그널';

  const action =
    flowBias === 'FOREIGN_OUTFLOW'
      ? '신규 진입 홀드 · 수출주(삼성·하이닉스) 비중 축소'
      : flowBias === 'FOREIGN_INFLOW'
      ? 'EWY 동조 대형주 우선 검토 · 외국인 관심 수급주 확인'
      : '단독 시그널 — 타 지표 동조 여부 관찰 후 판단';

  const krwLbl = reading.krwChange != null ? `${reading.krwChange >= 0 ? '+' : ''}${reading.krwChange.toFixed(2)}%` : 'N/A';
  const ewyLbl = reading.ewyChange != null ? `${reading.ewyChange >= 0 ? '+' : ''}${reading.ewyChange.toFixed(2)}%` : 'N/A';

  return (
    `${icon} <b>[DXY ${severity === 'CONFIRMED' ? '확정' : '예비'} 경보]</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `${arrow} DXY ${reading.last.toFixed(2)} | 1d ${sign1}${reading.change1d}% · 5d ${sign5}${reading.change5d}%\n` +
    `USD/KRW 1d ${krwLbl} | EWY 1d ${ewyLbl}\n\n` +
    `${biasLine}\n\n` +
    `📌 ${action}`
  );
}

// ── 학습 DB 연동 ──────────────────────────────────────────────────────────────

function logToNewsSupply(report: DxyAlertReport): void {
  if (report.severity !== 'CONFIRMED' || report.flowBias === 'UNCLEAR') return;
  const headline =
    report.flowBias === 'FOREIGN_OUTFLOW'
      ? `DXY 급등 ${report.reading.change1d >= 0 ? '+' : ''}${report.reading.change1d}% — 외국인 이탈 시그널`
      : `DXY 급락 ${report.reading.change1d}% — 외국인 복귀 시그널`;
  logNewsSupplyEvent({
    newsType:         'DXY경보',
    source:           'EWY_FOREIGN',
    sector:           'KOSPI 외국인 수급 전체',
    koreanStockCodes: [],
    koreanNames:      [],
    detectedAt:       report.createdAt,
    newsHeadline:     headline,
    significance:     'HIGH',
  });
}

// ── 메인 엔트리 ───────────────────────────────────────────────────────────────

/**
 * DXY 1d/5d 변화율 계산 → 임계 돌파 시 Telegram 경보.
 * USD/KRW + EWY 교차 검증으로 flowBias 강도를 판단.
 *
 * 쿨다운: 같은 방향(STRENGTH/WEAKNESS) 4시간 억제. 방향 전환 시 즉시 재발송.
 */
export async function runDxyMonitor(): Promise<DxyAlertReport | null> {
  const [dxyCloses, krwCloses, ewyCloses] = await Promise.all([
    fetchCloses('DX-Y.NYB', '10d'),
    fetchCloses('KRW=X',    '10d'),
    fetchCloses('EWY',      '10d'),
  ]);

  if (!dxyCloses || dxyCloses.length < 6) {
    console.warn('[DxyMonitor] DXY 데이터 부족 — 스킵');
    return null;
  }

  const change1d = nDayPct(dxyCloses, 1);
  const change5d = nDayPct(dxyCloses, 5);
  if (change1d == null || change5d == null) return null;

  const reading: DxyReading = {
    last:      parseFloat(dxyCloses[dxyCloses.length - 1].toFixed(2)),
    change1d,
    change5d,
    krwChange: krwCloses ? nDayPct(krwCloses, 1) : null,
    ewyChange: ewyCloses ? nDayPct(ewyCloses, 1) : null,
  };

  const abs1d   = Math.abs(change1d);
  const abs5d   = Math.abs(change5d);
  const trig1d  = abs1d >= DXY_1D_THRESHOLD;
  const trig5d  = abs5d >= DXY_5D_THRESHOLD;
  if (!trig1d && !trig5d) {
    console.log(`[DxyMonitor] 임계 미달 — 1d ${change1d}% / 5d ${change5d}% (스킵)`);
    return null;
  }

  const direction: DxyAlertReport['direction'] = change1d >= 0 ? 'STRENGTH' : 'WEAKNESS';
  const severity:  DxyAlertReport['severity']  = (trig1d && trig5d) ? 'CONFIRMED' : 'PRELIMINARY';
  const flowBias   = determineFlowBias(reading);

  const report: DxyAlertReport = {
    createdAt: new Date().toISOString(),
    reading,
    direction,
    severity,
    flowBias,
    alertSent: false,
  };

  // 방향 전환 감지 — 쿨다운 우회 판단
  const state       = loadState();
  const fourHoursMs = 4 * 60 * 60 * 1000;
  const sameDir     = state?.lastDirection === direction;
  const inCooldown  = state && sameDir && (Date.now() - new Date(state.lastSentAt).getTime() < fourHoursMs);

  if (inCooldown && severity !== 'CONFIRMED') {
    console.log(`[DxyMonitor] 쿨다운 중 (${direction}) — 예비 경보 억제`);
  } else {
    await sendTelegramAlert(formatAlert(report), {
      priority:  severity === 'CONFIRMED' ? 'CRITICAL' : 'HIGH',
      dedupeKey: `dxy_monitor:${direction}:${severity}:${new Date().toISOString().slice(0, 10)}`,
    }).catch(console.error);
    report.alertSent = true;
    logToNewsSupply(report);
  }

  console.log(
    `[DxyMonitor] ${severity} ${direction} — DXY 1d ${change1d}% / 5d ${change5d}% / flowBias=${flowBias}`,
  );

  saveState({
    lastSentAt:    report.alertSent ? report.createdAt : (state?.lastSentAt ?? report.createdAt),
    lastDirection: direction,
    lastChange1d:  change1d,
    history:       [...(state?.history ?? []), report],
  });

  return report;
}
