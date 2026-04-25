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
 *
 * ─── P3-7 인트라데이 모니터 (구현 완료) ────────────────────────────────────
 * `dxyIntradayClient.ts` 가 Yahoo Finance DX-Y.NYB 5분봉 우선 + Alpha Vantage
 * 합성 DXY (ICE 표준 가중 환율 6개 합성) 를 fallback 으로 제공한다.
 *
 * `runDxyIntradayMonitor()` 는 ±DXY_INTRADAY_THRESHOLD (기본 0.4%) /
 * windowMinutes (기본 30분) 윈도우 변화 감지 시 즉시 개인 + ANALYSIS 채널로
 * "선행 경보" 발송하고 일봉 기준 runDxyMonitor() 를 강제 트리거해 교차 검증.
 *
 * cron 등록: `dxyIntradayJobs.ts` — US 장 시간대 (KST 22:30~05:00 익일) 5분 간격.
 * 운영자 조회: `/dxy_intraday` — 현재 리딩 즉시 확인.
 * ─────────────────────────────────────────────────────────────────────────
 */

import fs from 'fs';
import { fetchCloses } from '../trading/marketDataRefresh.js';
import { sendTelegramAlert } from './telegramClient.js';
import { DXY_MONITOR_STATE_FILE, ensureDataDir } from '../persistence/paths.js';
import { logNewsSupplyEvent } from '../learning/newsSupplyLogger.js';
import { dispatchAlert } from './alertRouter.js';
import { AlertCategory } from './alertCategories.js';

// ── 임계값 ────────────────────────────────────────────────────────────────────

const DXY_1D_THRESHOLD = 0.6;   // %
const DXY_5D_THRESHOLD = 1.5;   // %
/** 인트라데이 윈도우 내 변화율 임계 (%) — windowMinutes 동안 ±0.4% */
const DXY_INTRADAY_THRESHOLD = parseFloat(process.env.DXY_INTRADAY_THRESHOLD ?? '0.4');
/** 인트라데이 비교 윈도우 (분) */
const DXY_INTRADAY_WINDOW_MIN = parseInt(process.env.DXY_INTRADAY_WINDOW_MIN ?? '30', 10);

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
    `━━━━━━━━━━━━━━━━\n` +
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
  const triggered = trig1d || trig5d;

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

  const state = loadState();

  // 임계 미달: 경보는 보내지 않지만, 대시보드("DXY 모니터" 카드) 표기를 위해
  // 최신 리딩은 항상 저장한다. 과거에는 skip 시 상태를 아예 쓰지 않아
  // getLatestDxyReport() 가 null 을 반환 → UI 에 "데이터 없음" 만 노출됐다.
  if (!triggered) {
    console.log(`[DxyMonitor] 임계 미달 — 1d ${change1d}% / 5d ${change5d}% (경보 스킵, 스냅샷 저장)`);
    saveState({
      lastSentAt:    state?.lastSentAt ?? report.createdAt,
      lastDirection: state?.lastDirection ?? null,
      lastChange1d:  change1d,
      history:       [...(state?.history ?? []), report],
    });
    return report;
  }

  // 방향 전환 감지 — 쿨다운 우회 판단
  const fourHoursMs = 4 * 60 * 60 * 1000;
  const sameDir     = state?.lastDirection === direction;
  const inCooldown  = state && sameDir && (Date.now() - new Date(state.lastSentAt).getTime() < fourHoursMs);

  if (inCooldown && severity !== 'CONFIRMED') {
    console.log(`[DxyMonitor] 쿨다운 중 (${direction}) — 예비 경보 억제`);
  } else {
    const alertText = formatAlert(report);
    await sendTelegramAlert(alertText, {
      priority:  severity === 'CONFIRMED' ? 'CRITICAL' : 'HIGH',
      dedupeKey: `dxy_monitor:${direction}:${severity}:${new Date().toISOString().slice(0, 10)}`,
    }).catch(console.error);
    // ANALYSIS 채널 미러링 — 외국인 수급 분석은 분석 채널의 핵심 정보
    await dispatchAlert(AlertCategory.ANALYSIS, alertText, {
      priority: severity === 'CONFIRMED' ? 'HIGH' : 'NORMAL',
      dedupeKey: `dxy_monitor_ch:${direction}:${severity}:${new Date().toISOString().slice(0, 10)}`,
    }).catch(e => console.error('[DxyMonitor] ANALYSIS 미러링 실패:', e));
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

// ── P3-7: DXY 인트라데이 모니터 ──────────────────────────────────────────────
//
// US 장 시간대 (KST 22:30~05:00 익일) 동안 5분 간격으로 호출. windowMinutes 분
// 이내 변화율이 ±DXY_INTRADAY_THRESHOLD 를 넘으면 즉시 ANALYSIS 채널 + 개인
// 채팅으로 "선행 경보" 전송. 일봉 기반 runDxyMonitor() 보다 더 빠르게 반응한다.

/** 인트라데이 알림 중복 방지 — 같은 dedup 키로 24h 내 1회만 발송 */
const _intradayLastSentByKey = new Map<string, number>();
const INTRADAY_DEDUP_WINDOW_MS = 60 * 60_000;  // 1시간 — 윈도우 내 같은 방향 중복 억제

export interface DxyIntradayAlert {
  source:    'YAHOO' | 'ALPHA_VANTAGE';
  asOf:      string;
  last:      number;
  changePct: number;
  direction: 'STRENGTH' | 'WEAKNESS';
  windowMinutes: number;
  alertSent: boolean;
}

/**
 * 인트라데이 DXY 1회 체크 + 임계 돌파 시 알림 발송.
 * cron 으로 5분 간격 호출 권장. ALPHA_VANTAGE_API_KEY 설정 시 Yahoo 실패 시 fallback.
 *
 * 2026-04-25: NYSE 정규장이 닫혀있는 동안에는 silent skip 한다 — 그렇지 않으면
 *   ① EgressGuard 가 Yahoo 호출을 차단해 `[EgressGuard] skip NYSE:DX-Y.NYB`,
 *   ② getDxyIntradayReading 이 null 을 돌려 `[DxyIntraday] Yahoo 리딩 없음`
 * 두 로그가 5분 cron 마다 반복 출력된다. 본 cron 은 US 장 시간대를 위한 것이므로
 * 시장이 닫혀있으면 호출 자체가 의미 없다. 로그 노이즈만 발생시킬 뿐.
 */
export async function runDxyIntradayMonitor(): Promise<DxyIntradayAlert | null> {
  // ─── NYSE 정규장 게이트 ─────────────────────────────────────────────────────
  // DX-Y.NYB 는 ICE 파생지수지만 Yahoo endpoint 의 신뢰 가능한 5m 봉은 NYSE
  // 정규장 시간대에만 안정적으로 채워진다. 장외 시간에 cron 이 fire 되면 외부
  // 호출 예산만 소비하고 실제 알림은 발송되지 않는다 — 진입부에서 끊는다.
  const { isOpenAt } = await import('../utils/symbolMarketRegistry.js');
  if (!isOpenAt('NYSE')) {
    return null; // silent skip — 로그 없음 (cron 정상 동작 분기)
  }

  const { getDxyIntradayReading } = await import('./dxyIntradayClient.js');
  const reading = await getDxyIntradayReading(DXY_INTRADAY_WINDOW_MIN);
  if (!reading) {
    // NYSE 장중인데 데이터 소스가 모두 실패한 케이스 — 실제 문제 가능성.
    // ALPHA_VANTAGE_API_KEY 미설정이면 fallback 자체가 없으므로 info 로 1회 안내.
    const avConfigured = Boolean(process.env.ALPHA_VANTAGE_API_KEY?.trim());
    if (avConfigured) {
      console.warn('[DxyIntraday] 데이터 소스 모두 실패 (Yahoo + Alpha Vantage) — 스킵');
    } else {
      console.log('[DxyIntraday] Yahoo 리딩 없음 & ALPHA_VANTAGE_API_KEY 미설정 — 스킵');
    }
    return null;
  }
  const abs = Math.abs(reading.changeWindowPct);
  const direction: 'STRENGTH' | 'WEAKNESS' = reading.changeWindowPct >= 0 ? 'STRENGTH' : 'WEAKNESS';

  const alert: DxyIntradayAlert = {
    source:    reading.source as 'YAHOO' | 'ALPHA_VANTAGE',
    asOf:      reading.asOf,
    last:      reading.last,
    changePct: reading.changeWindowPct,
    direction,
    windowMinutes: reading.windowMinutes,
    alertSent: false,
  };

  if (abs < DXY_INTRADAY_THRESHOLD) {
    return alert; // 임계 미달, 조용히 종료
  }
  // ALPHA_VANTAGE 단일 스냅샷은 changeWindowPct=0 이므로 여기 도달 X — Yahoo 일 때만 발송.
  if (reading.source !== 'YAHOO') {
    console.log('[DxyIntraday] Alpha Vantage 단일 스냅샷 — 변화율 비교 불가, 알림 스킵');
    return alert;
  }

  // 1시간 내 같은 방향 중복 방지
  const dedupKey = `intraday:${direction}`;
  const lastSent = _intradayLastSentByKey.get(dedupKey) ?? 0;
  if (Date.now() - lastSent < INTRADAY_DEDUP_WINDOW_MS) {
    console.log(`[DxyIntraday] dedupe — 같은 방향(${direction}) 1시간 내 알림 억제`);
    return alert;
  }

  const arrow = direction === 'STRENGTH' ? '▲' : '▼';
  const sign  = reading.changeWindowPct >= 0 ? '+' : '';
  const msg =
    `⚡ <b>[DXY 인트라데이 선행 경보]</b>\n` +
    `━━━━━━━━━━━━━━━━\n` +
    `${arrow} DXY ${reading.last.toFixed(2)} | ${reading.windowMinutes}분 ${sign}${reading.changeWindowPct.toFixed(2)}%\n` +
    `소스: ${reading.source} | 기준: ${new Date(reading.windowStartedAt).toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit' })} → ${new Date(reading.asOf).toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit' })}\n\n` +
    (direction === 'STRENGTH'
      ? '🔴 USD 강세 인트라데이 — 외국인 EWY 이탈 압력 (한국 장 개장 전 모니터)'
      : '🟢 USD 약세 인트라데이 — 외국인 복귀 신호 가능 (한국 장 개장 전 모니터)');

  await sendTelegramAlert(msg, {
    priority:  'HIGH',
    dedupeKey: `dxy_intraday:${direction}:${new Date().toISOString().slice(0, 13)}`,
  }).catch(console.error);
  await dispatchAlert(AlertCategory.ANALYSIS, msg, {
    priority: 'NORMAL',
    dedupeKey: `dxy_intraday_ch:${direction}:${new Date().toISOString().slice(0, 13)}`,
  }).catch(e => console.error('[DxyIntraday] ANALYSIS 미러링 실패:', e));

  _intradayLastSentByKey.set(dedupKey, Date.now());
  alert.alertSent = true;
  console.log(`[DxyIntraday] ✉️ ${direction} 알림 전송 — ${sign}${reading.changeWindowPct.toFixed(2)}% (${reading.windowMinutes}m)`);

  // 인트라데이 임계 돌파 시 일봉 기준 모니터도 강제 트리거 — 교차 검증 + 학습 DB 기록
  void runDxyMonitor().catch(e => console.warn('[DxyIntraday] runDxyMonitor 강제 트리거 실패:', e instanceof Error ? e.message : e));

  return alert;
}

/** 운영자 진단용 — 현재 인트라데이 리딩만 반환 (알림 없음). */
export async function getDxyIntradaySnapshot(): Promise<{
  source: string; asOf: string; last: number; changePct: number; windowMinutes: number;
} | null> {
  const { getDxyIntradayReading } = await import('./dxyIntradayClient.js');
  const r = await getDxyIntradayReading(DXY_INTRADAY_WINDOW_MIN);
  if (!r) return null;
  return {
    source:        r.source,
    asOf:          r.asOf,
    last:          r.last,
    changePct:     r.changeWindowPct,
    windowMinutes: r.windowMinutes,
  };
}
