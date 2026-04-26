// @responsibility foreignFlowLeadingAlert 알림 모듈
/**
 * foreignFlowLeadingAlert.ts — 외국인 수급 선행 경보 (IDEA 9)
 *
 * macroState에 이미 축적된 3개 축(EWY 일변화 + DXY 5일 변화 + 외국인 연속 순매수일)
 * 을 교차해 "T+1~2 외국인 Active 매수 재개" 확률이 올라간 순간에만 T1 경보.
 *
 * 판정 규칙 (모두 true 여야 경보):
 *   ① EWY 전일 대비 +0.8% 이상 상승
 *   ② DXY 5일 변화 -0.3% 이하 (달러 약세 확인)
 *   ③ 외국인 연속 순매수일 ≥ 2일 (패턴 형성)
 *
 * 스케줄: 평일 07:30 KST — 한국 장 개장 1.5시간 전.
 */
import { loadMacroState } from '../persistence/macroStateRepo.js';
import { dispatchAlert, ChannelSemantic } from './alertRouter.js';
import { channelHeader, CHANNEL_SEPARATOR } from './channelFormatter.js';

// ── 판정 임계 ─────────────────────────────────────────────────────────────────
const EWY_THRESHOLD_PCT = 0.8;
const DXY_THRESHOLD_PCT = -0.3;
const MIN_FOREIGN_STREAK = 2;

interface SignalInputs {
  ewyDayChange: number;
  dxy5dChange: number;
  foreignContinuousBuyDays: number;
  foreignNetBuy5d: number;
}

function evaluateSignal(inputs: SignalInputs): {
  fire: boolean;
  confidence: number;
  reasons: string[];
} {
  const reasons: string[] = [];
  let score = 0;

  if (inputs.ewyDayChange >= EWY_THRESHOLD_PCT) {
    reasons.push(`EWY +${inputs.ewyDayChange.toFixed(2)}% (임계 ≥ +${EWY_THRESHOLD_PCT}%)`);
    score += 1;
  }
  if (inputs.dxy5dChange <= DXY_THRESHOLD_PCT) {
    reasons.push(`DXY 5일 ${inputs.dxy5dChange.toFixed(2)}% (달러 약세)`);
    score += 1;
  }
  if (inputs.foreignContinuousBuyDays >= MIN_FOREIGN_STREAK) {
    reasons.push(`외국인 연속 순매수 ${inputs.foreignContinuousBuyDays}일 (5일 누적 ${inputs.foreignNetBuy5d}억원)`);
    score += 1;
  }

  return {
    fire: score === 3,
    confidence: score,
    reasons,
  };
}

// ── 메시지 조립 ──────────────────────────────────────────────────────────────

function formatMessage(inputs: SignalInputs, reasons: string[], confidence: number): string {
  const header = channelHeader({
    icon: '🌍',
    title: '외국인 수급 선행 경보',
  });

  const signalDots = '●'.repeat(confidence) + '○'.repeat(Math.max(0, 4 - confidence));

  return [
    header,
    reasons.map(r => `• ${r}`).join('\n'),
    '',
    `→ T+1~2 국내 외국인 Active 매수 유입 예상`,
    `→ 조방원·대형 주도주 집중 가능성 높음`,
    `신뢰도: ${signalDots}`,
    CHANNEL_SEPARATOR,
  ].join('\n');
}

// ── 메인 엔트리 ──────────────────────────────────────────────────────────────

export async function checkForeignFlowLeadingAlert(): Promise<void> {
  try {
    const macro = loadMacroState();
    if (!macro) {
      console.log('[ForeignFlowAlert] macroState 없음 — 스킵');
      return;
    }

    const inputs: SignalInputs = {
      ewyDayChange: macro.ewyDayChange ?? 0,
      dxy5dChange: macro.dxy5dChange ?? 0,
      foreignContinuousBuyDays: macro.foreignContinuousBuyDays ?? 0,
      foreignNetBuy5d: macro.foreignNetBuy5d ?? 0,
    };

    const { fire, confidence, reasons } = evaluateSignal(inputs);
    if (!fire) {
      console.log(`[ForeignFlowAlert] 조건 미달 (${confidence}/3) — 스킵`);
      return;
    }

    const message = formatMessage(inputs, reasons, confidence + 1); // +1 → 4점 만점 표기
    const today = new Date().toISOString().slice(0, 10);

    // ADR-0039: CH3 REGIME — 외국인 자금 3축 합치 (HIGH → 진동 ON VIBRATION_POLICY 자동)
    await dispatchAlert(ChannelSemantic.REGIME, message, {
      priority: 'HIGH',
      dedupeKey: `foreign_flow_leading:${today}`,
    });

    console.log(`[ForeignFlowAlert] 3축 합치 발송 완료`);
  } catch (e) {
    console.error('[ForeignFlowAlert] 실패:', e instanceof Error ? e.message : e);
  }
}
