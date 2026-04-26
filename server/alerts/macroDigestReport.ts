// @responsibility CH3 REGIME 매크로 다이제스트 — 1일 2회 정기 발행 (08:30 + 16:00 KST)
/**
 * macroDigestReport.ts — CH3 REGIME 채널 매크로 다이제스트 (ADR-0040)
 *
 * 사용자 12 아이디어 중 10번 — "CH3 REGIME 전용 매크로 다이제스트, 1일 2회 정기 발행".
 * 페르소나의 "매크로 합치 검증" 일과화 — 같은 시각에 같은 형식으로 발송하여
 * 사용자가 무의식적으로 시간을 동기화하게 한다.
 *
 * 시간:
 *   - PRE_OPEN  KST 08:30 (UTC 23:30 일~목) — 장 시작 30분 전
 *   - POST_CLOSE KST 16:00 (UTC 07:00 월~금) — 한국 장 마감 30분 후
 *
 * 내용:
 *   - PRE_OPEN: 간밤 미국 (VIX/US10Y/DXY) + 환율 + 한국 사전 (VKOSPI/외국인 누적/EWY)
 *   - POST_CLOSE: 한국 결산 (KOSPI/VKOSPI/외국인) + 글로벌 (S&P500/DXY/WTI) + 매크로 헬스
 *
 * 절대 규칙:
 *   - 개별 종목 정보 절대 포함 금지 (CH3 REGIME 정체성: 시장 전체 상태만)
 *   - 잔고 키워드 누출 금지 (validate:sensitiveAlerts 가 자동 차단)
 *   - dispatchAlert(ChannelSemantic.REGIME) 단일 진입점만 사용
 */

import { loadMacroState, type MacroState } from '../persistence/macroStateRepo.js';
import { dispatchAlert, ChannelSemantic } from './alertRouter.js';
import { channelHeader, CHANNEL_SEPARATOR } from './channelFormatter.js';

export type MacroDigestMode = 'PRE_OPEN' | 'POST_CLOSE';

/** 숫자가 유효한지 (NaN/undefined/null 안전 체크) */
function isValidNum(n: number | undefined | null): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

/** 부호 포함 % 포맷 — 누락 시 N/A */
function fmtPctSigned(n: number | undefined | null, digits: number = 1): string {
  if (!isValidNum(n)) return 'N/A';
  return `${n >= 0 ? '+' : ''}${n.toFixed(digits)}%`;
}

/** 절대값 포맷 (소수점) — 누락 시 N/A */
function fmtAbs(n: number | undefined | null, digits: number = 1): string {
  if (!isValidNum(n)) return 'N/A';
  return n.toFixed(digits);
}

/** 정수 포맷 — 누락 시 N/A */
function fmtInt(n: number | undefined | null): string {
  if (!isValidNum(n)) return 'N/A';
  return Math.round(n).toLocaleString();
}

/** VKOSPI 5일 추세 화살표 */
function trendArrow(n: number | undefined | null): string {
  if (!isValidNum(n)) return '';
  if (n > 0) return '↑';
  if (n < 0) return '↓';
  return '→';
}

/** 외국인 5일 누적 — 억원 단위 그대로 (이미 macroState 가 억원 단위) */
function fmtForeignNetBuy(n: number | undefined | null): string {
  if (!isValidNum(n)) return 'N/A';
  const abs = Math.abs(n);
  if (abs >= 10000) {
    // 1조원 이상 → 조 단위로 표시
    return `${n >= 0 ? '+' : '-'}${(abs / 10000).toFixed(2)}조원`;
  }
  return `${n >= 0 ? '+' : '-'}${abs.toLocaleString()}억원`;
}

/** Regime 한글 라벨 */
function regimeLabel(regime: string | undefined): string {
  const map: Record<string, string> = {
    R1_TURBO: '🚀 R1 TURBO',
    R2_BULL: '📈 R2 BULL',
    R3_EARLY: '🌱 R3 EARLY',
    R4_NEUTRAL: '⚖️ R4 NEUTRAL',
    R5_CAUTION: '⚠️ R5 CAUTION',
    R6_DEFENSE: '🔴 R6 DEFENSE',
  };
  return regime ? (map[regime] ?? regime) : 'N/A';
}

/** MHS 추세 한글 라벨 */
function mhsTrendLabel(trend: string | undefined): string {
  const map: Record<string, string> = {
    IMPROVING: '↗ 개선',
    STABLE: '→ 안정',
    DETERIORATING: '↘ 악화',
  };
  return trend ? (map[trend] ?? trend) : '';
}

/** KST HH:MM 라벨 (now 의 KST 시각) */
function kstHm(now: Date = new Date()): string {
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const hh = kst.getUTCHours().toString().padStart(2, '0');
  const mm = kst.getUTCMinutes().toString().padStart(2, '0');
  return `${hh}:${mm}`;
}

/**
 * 메시지 본문 생성 — 순수 함수, 외부 의존성 0 (테스트 가능).
 * macroState=null 또는 비어있어도 graceful fallback.
 */
export function formatMacroDigest(
  state: MacroState | null,
  mode: MacroDigestMode,
  now: Date = new Date(),
): string {
  const s = state ?? ({} as MacroState);
  const timeLabel = kstHm(now);

  if (mode === 'PRE_OPEN') {
    const header = channelHeader({
      icon: '🌅',
      title: '매크로 다이제스트 (장 전)',
      suffix: `${timeLabel} KST`,
    });
    return [
      header,
      '',
      '🇺🇸 <b>간밤 미국</b>',
      `  VIX ${fmtAbs(s.vix)}${s.vixHistory && s.vixHistory.length >= 2
        ? ` (전일 대비 ${fmtPctSigned(((s.vix ?? 0) - s.vixHistory[s.vixHistory.length - 2]) / Math.max(0.01, s.vixHistory[s.vixHistory.length - 2]) * 100)})`
        : ''}`,
      `  US10Y-2Y 스프레드: ${fmtAbs(s.yieldCurve10y2y, 2)}${isValidNum(s.yieldCurve10y2y) && s.yieldCurve10y2y < 0 ? ' ⚠️ 역전' : ''}`,
      `  DXY ${s.dxyBullish ? '강세' : isValidNum(s.dxy5dChange) ? '약세' : 'N/A'} (5d ${fmtPctSigned(s.dxy5dChange)})`,
      '',
      '💱 <b>환율</b>',
      `  USD/KRW ${fmtInt(s.usdKrw)}원 (당일 ${fmtPctSigned(s.usdKrwDayChange)} · 20d ${fmtPctSigned(s.usdKrw20dChange)})`,
      '',
      '🇰🇷 <b>한국 사전</b>',
      `  VKOSPI ${fmtAbs(s.vkospi)} (5d ${trendArrow(s.vkospi5dTrend)})`,
      `  외국인 5d 누적: ${fmtForeignNetBuy(s.foreignNetBuy5d)}`,
      `  EWY ADR: ${fmtPctSigned(s.ewyDayChange)}`,
      '',
      '📊 <b>매크로 헬스</b>',
      `  MHS ${fmtInt(s.mhs)} ${mhsTrendLabel(s.mhsTrend)} | ${regimeLabel(s.regime)}`,
      CHANNEL_SEPARATOR,
    ].join('\n');
  }

  // POST_CLOSE
  const header = channelHeader({
    icon: '🌆',
    title: '매크로 다이제스트 (장 후)',
    suffix: `${timeLabel} KST`,
  });
  return [
    header,
    '',
    '🇰🇷 <b>한국 결산</b>',
    `  KOSPI 일변동 ${fmtPctSigned(s.kospiDayReturn)} | 20d ${fmtPctSigned(s.kospi20dReturn)}`,
    `  VKOSPI ${fmtAbs(s.vkospi)} (5d ${trendArrow(s.vkospi5dTrend)})`,
    `  외국인 5d 누적: ${fmtForeignNetBuy(s.foreignNetBuy5d)}`,
    `  신용잔고 5d 변화: ${fmtPctSigned(s.marginBalance5dChange)}`,
    '',
    '💱 <b>환율</b>',
    `  USD/KRW ${fmtInt(s.usdKrw)}원 (당일 ${fmtPctSigned(s.usdKrwDayChange)})`,
    '',
    '🌐 <b>글로벌 컨텍스트</b>',
    `  S&amp;P500 20d ${fmtPctSigned(s.spx20dReturn)}`,
    `  DXY 5d ${fmtPctSigned(s.dxy5dChange)}`,
    `  WTI ${fmtAbs(s.wtiCrude)} USD/배럴`,
    isValidNum(s.hySpread) ? `  HY 스프레드: ${fmtAbs(s.hySpread, 2)}%` : '',
    '',
    '📊 <b>매크로 헬스</b>',
    `  MHS ${fmtInt(s.mhs)} ${mhsTrendLabel(s.mhsTrend)} | ${regimeLabel(s.regime)}`,
    CHANNEL_SEPARATOR,
  ].filter(Boolean).join('\n');
}

/**
 * dispatchAlert(REGIME) 으로 매크로 다이제스트 발송.
 * dedupeKey 로 같은 KST 일자 + mode 중복 발송 차단.
 */
export async function runMacroDigest(mode: MacroDigestMode, now: Date = new Date()): Promise<void> {
  try {
    const state = loadMacroState();
    const message = formatMacroDigest(state, mode, now);
    const today = new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);

    // ADR-0039: CH3 REGIME — 매크로 다이제스트.
    // VIBRATION_POLICY[REGIME].NORMAL = false (진동 OFF) — 일상 매크로는 조용히.
    // PRE_OPEN/POST_CLOSE 둘 다 NORMAL 우선순위.
    await dispatchAlert(ChannelSemantic.REGIME, message, {
      priority: 'NORMAL',
      dedupeKey: `macro_digest:${mode}:${today}`,
    });

    console.log(`[MacroDigest] ${mode} 발송 완료 — ${today}`);
  } catch (e) {
    console.error('[MacroDigest] 발송 실패:', e instanceof Error ? e.message : e);
  }
}
