/**
 * weeklyQuantInsight.ts — 주간 퀀트 인사이트 (IDEA 12)
 *
 * 매주 금요일 17:00 KST, 이번 주 시스템 데이터(MHS · 외국인 흐름 · 신고가 편입
 * 추이 · 레짐 변화) 3가지 핵심과 다음 주 시나리오를 narrative 형식으로 발송.
 *
 * 소스:
 *   - macroStateRepo — 현재 MHS, 레짐, foreignNetBuy5d, vix 등
 *   - dynamicUniverseExpander — 이번 주 52W_HIGH 편입 추이
 *   - attributionRepo — 이번 주 결산 거래 수와 평균 수익
 *   - callGemini — 3가지 핵심 + BASE/BULL/BEAR 시나리오 narrative
 */
import { loadMacroState } from '../persistence/macroStateRepo.js';
import { loadDynamicUniverse } from '../screener/dynamicUniverseExpander.js';
import { loadAttributionRecords } from '../persistence/attributionRepo.js';
import { callGemini } from '../clients/geminiClient.js';
import { sendTelegramBroadcast } from './telegramClient.js';
import { channelHeader, CHANNEL_SEPARATOR } from './channelFormatter.js';
import { getLiveRegime } from '../trading/regimeBridge.js';

// ── 주간 집계 ────────────────────────────────────────────────────────────────

interface WeeklyMetrics {
  weekLabel: string;
  mhs: number | null;
  regime: string;
  foreignNetBuy5d: number | null;
  vix: number | null;
  vkospi: number | null;
  newHighCount: number;
  tradesThisWeek: number;
  winRate: number;
}

function isoWeekLabel(d: Date = new Date()): string {
  const target = new Date(d.getTime());
  target.setUTCHours(0, 0, 0, 0);
  target.setUTCDate(target.getUTCDate() + 4 - (target.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((target.getTime() - yearStart.getTime()) / 86_400_000) + 1) / 7);
  return `W${weekNo.toString().padStart(2, '0')}`;
}

function collectMetrics(): WeeklyMetrics {
  const macro = loadMacroState();
  const regime = getLiveRegime(macro);

  const weekAgo = Date.now() - 7 * 86_400_000;
  const dynUniverse = loadDynamicUniverse();
  const newHighCount = dynUniverse.filter(
    s => s.source === '52W_HIGH' && new Date(s.addedAt).getTime() > weekAgo,
  ).length;

  const attrs = loadAttributionRecords();
  const weekAttrs = attrs.filter(a => new Date(a.closedAt).getTime() > weekAgo);
  const tradesThisWeek = weekAttrs.length;
  const wins = weekAttrs.filter(a => a.isWin).length;
  const winRate = tradesThisWeek > 0 ? (wins / tradesThisWeek) * 100 : 0;

  return {
    weekLabel: isoWeekLabel(),
    mhs: macro?.mhs ?? null,
    regime,
    foreignNetBuy5d: macro?.foreignNetBuy5d ?? null,
    vix: macro?.vix ?? null,
    vkospi: macro?.vkospi ?? null,
    newHighCount,
    tradesThisWeek,
    winRate,
  };
}

// ── Gemini narrative ────────────────────────────────────────────────────────

async function generateNarrative(m: WeeklyMetrics): Promise<string> {
  const prompt =
    `한국 주식 시장 주간 퀀트 인사이트를 한국어로 작성하라. 실제 숫자 근거를 인용해야 한다.\n\n` +
    `데이터 (이번 주):\n` +
    `- MHS: ${m.mhs ?? 'N/A'} | 레짐: ${m.regime}\n` +
    `- 외국인 5일 순매수: ${m.foreignNetBuy5d ?? 'N/A'}억원\n` +
    `- VIX: ${m.vix ?? 'N/A'} | VKOSPI: ${m.vkospi ?? 'N/A'}\n` +
    `- 52주 신고가 편입: ${m.newHighCount}개\n` +
    `- 시스템 결산: ${m.tradesThisWeek}건, 승률 ${m.winRate.toFixed(0)}%\n\n` +
    `출력 형식 (정확히 이대로, 이모지 포함):\n` +
    `① [핵심 데이터 1] — 1문장 해석\n` +
    `② [핵심 데이터 2] — 1문장 해석\n` +
    `③ [핵심 데이터 3] — 1문장 해석\n\n` +
    `다음 주 시나리오:\n` +
    `  BASE (확률): 1문장\n` +
    `  BULL (확률): 1문장\n` +
    `  BEAR (확률): 1문장\n\n` +
    `각 시나리오 확률 합은 100%가 되도록 하라. 문장은 간결하게.`;
  const res = await callGemini(prompt, 'weekly-quant-insight').catch(() => null);
  return res?.trim() ?? '(Gemini 응답 없음 — 수치만 공유합니다.)';
}

// ── 메시지 조립 + 발송 ────────────────────────────────────────────────────────

export async function sendWeeklyQuantInsight(): Promise<void> {
  try {
    const metrics = collectMetrics();
    const narrative = await generateNarrative(metrics);

    const header = channelHeader({
      icon: '📰',
      title: '주간 퀀트 인사이트',
      suffix: metrics.weekLabel,
    });

    const statsBlock =
      `이번 주 핵심 수치\n` +
      `  • MHS ${metrics.mhs ?? 'N/A'} · 레짐 ${metrics.regime}\n` +
      `  • 외국인 5일 순매수 ${metrics.foreignNetBuy5d ?? 'N/A'}억원\n` +
      `  • VIX ${metrics.vix ?? 'N/A'} · VKOSPI ${metrics.vkospi ?? 'N/A'}\n` +
      `  • 52주 신고가 편입 ${metrics.newHighCount}개\n` +
      `  • 시스템 결산 ${metrics.tradesThisWeek}건 · 승률 ${metrics.winRate.toFixed(0)}%`;

    const message = [
      header,
      statsBlock,
      '',
      narrative,
      CHANNEL_SEPARATOR,
    ].join('\n');

    const today = new Date().toISOString().slice(0, 10);

    await sendTelegramBroadcast(message, {
      priority: 'NORMAL',
      tier: 'T2_REPORT',
      category: 'weekly_quant_insight',
      dedupeKey: `weekly_insight:${today}`,
      disableChannelNotification: true,
    });

    console.log(`[WeeklyInsight] ${metrics.weekLabel} 발송 완료`);
  } catch (e) {
    console.error('[WeeklyInsight] 발송 실패:', e instanceof Error ? e.message : e);
  }
}
