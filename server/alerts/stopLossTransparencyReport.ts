// @responsibility stopLossTransparencyReport 알림 모듈
/**
 * stopLossTransparencyReport.ts — 손절 집행 투명성 리포트 (IDEA 11)
 *
 * HIT_STOP / 강제 청산 발생 시, 진입 당시 근거와 손절 원인을 투명하게 공개해
 * 구독자 신뢰를 구축한다. 발송은 즉시 1건 + DM+채널 동시.
 *
 * 데이터 소스:
 *   - ServerShadowTrade — preMortem, exitRuleTag, stopLossExitType, entryRegime, conditionKeys
 *   - attributionRepo   — 진입 당시 27조건 점수 스냅샷 (선택 — 있으면 Top3 조건 포함)
 *
 * 호출:
 *   exitEngine.ts 의 각 HIT_STOP 분기에서 sellOrder/channelSellSignal 직후에 호출.
 */
import type { ServerShadowTrade } from '../persistence/shadowTradeRepo.js';
import { loadAttributionRecords } from '../persistence/attributionRepo.js';
import { CONDITION_NAMES } from '../learning/attributionAnalyzer.js';
import { sendTelegramBroadcast } from './telegramClient.js';
import { CHANNEL_SEPARATOR, channelHeader } from './channelFormatter.js';

// ── 진입 근거 요약 ────────────────────────────────────────────────────────────

/**
 * 진입 시 캡처된 27조건 점수 스냅샷에서 점수 상위 3개를 사람이 읽을 수 있는 문자열로.
 * attribution 레코드가 없거나 레거시(conditionScores 비어있음)면 null 반환.
 */
function summarizeEntryConditions(tradeId: string): string | null {
  const records = loadAttributionRecords();
  const rec = records.find(r => r.tradeId === tradeId);
  if (!rec || !rec.conditionScores) return null;

  const top = Object.entries(rec.conditionScores)
    .map(([id, score]) => ({ id: Number(id), score: Number(score) }))
    .filter(e => e.score >= 6)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);

  if (top.length === 0) return null;
  return top
    .map(e => `${CONDITION_NAMES[e.id] ?? `조건 ${e.id}`} (${e.score}/10)`)
    .join(', ');
}

// ── Pre-Mortem 표시 라인 추출 (ADR-0005) ────────────────────────────────────
//
// 레거시 preMortem 에는 Gemini 페르소나 서문("QuantMaster … 분석한다") 이
// 혼입되어 원래의 3개 번호 항목이 메시지 길이 제한에서 잘리는 사례가 있었다.
// 여기서는 표시 시점에도 한 번 더 필터링해 번호/하이픈 라인을 우선 취한다.
function extractPreMortemLines(raw: string): string[] {
  const numberedRe = /^\s*(?:[①②③]|\d{1,2}[.)\]]|[-•])\s*(.+)$/;
  const metaRe = /아키텍트|시스템의 Gate|분석한다|다음과 같다/;
  const lines = raw.split(/\n+/).map(l => l.trim()).filter(Boolean);
  const numbered = lines
    .map(l => { const m = l.match(numberedRe); return m?.[1]?.trim() ?? null; })
    .filter((x): x is string => !!x)
    .slice(0, 3);
  if (numbered.length > 0) {
    return numbered.map((l, i) => `${i + 1}. ${l.length > 90 ? l.slice(0, 87) + '...' : l}`);
  }
  // 폴백: 메타 문장을 버리고 첫 3개 문장.
  const sentences = raw
    .replace(/\n+/g, ' ')
    .split(/(?<=[.!?。])\s+/)
    .map(s => s.trim())
    .filter(s => s.length >= 10 && !metaRe.test(s))
    .slice(0, 3);
  if (sentences.length === 0) return ['(복기 내용 없음)'];
  return sentences.map((l, i) => `${i + 1}. ${l.length > 90 ? l.slice(0, 87) + '...' : l}`);
}

// ── 손절 원인 라벨 ────────────────────────────────────────────────────────────

function labelExitCause(shadow: ServerShadowTrade): string[] {
  const causes: string[] = [];
  const tag = shadow.exitRuleTag;
  const type = shadow.stopLossExitType;

  if (tag === 'MA60_DEATH_FORCE_EXIT') {
    causes.push('MA60 역배열 5영업일 유예 만료');
  } else if (tag === 'R6_EMERGENCY_EXIT') {
    causes.push('R6 블랙스완 레짐 — 30% 긴급 청산 후 잔량 전량');
  } else if (tag === 'HARD_STOP') {
    if (type === 'PROFIT_PROTECTION') {
      causes.push('ATR 트레일링 이익 보호 손절 체결');
    } else if (type === 'INITIAL') {
      causes.push('진입 구조 훼손 — 초기 손절 체결');
    } else if (type === 'REGIME') {
      causes.push('시장 레짐 악화 — 레짐 손절 체결');
    } else if (type === 'INITIAL_AND_REGIME') {
      causes.push('초기/레짐 손절 동시 충족');
    } else {
      causes.push('하드 스톱 체결');
    }
  } else {
    causes.push(`청산 규칙: ${tag ?? '미지정'}`);
  }

  if (shadow.cascadeStep === 2) {
    causes.push('−15% 캐스케이드 반매도 이후 잔량 청산');
  }

  return causes;
}

// ── 메시지 조립 + 발송 ────────────────────────────────────────────────────────

export interface StopLossContext {
  /** 현재 체결된 청산 가격 */
  exitPrice: number;
  /** 최종 수익률 (%) */
  returnPct: number;
  /** 이 1회에 매도된 수량 */
  soldQty: number;
}

export async function sendStopLossTransparencyReport(
  shadow: ServerShadowTrade,
  ctx: StopLossContext,
): Promise<void> {
  try {
    const entryReasoning = summarizeEntryConditions(shadow.id);
    const causes = labelExitCause(shadow);
    const holdingDays = Math.floor(
      (Date.now() - new Date(shadow.signalTime).getTime()) / 86_400_000,
    );

    const header = channelHeader({
      icon: '🔴',
      title: '손절 집행 투명 리포트',
    });

    const coreLine =
      `종목: <b>${shadow.stockName}</b> (${shadow.stockCode}) | D+${holdingDays}\n` +
      `진입가 ${shadow.shadowEntryPrice.toLocaleString()}원 → 청산가 ${ctx.exitPrice.toLocaleString()}원\n` +
      `손실: <b>${ctx.returnPct >= 0 ? '+' : ''}${ctx.returnPct.toFixed(2)}%</b> · ${ctx.soldQty}주`;

    const entryBlock =
      `\n\n📋 <b>진입 당시 근거</b>\n` +
      (entryReasoning ? `  ${entryReasoning}\n` : '  (귀인 스냅샷 없음 — 레거시 포지션)\n') +
      (shadow.entryRegime ? `  진입 레짐: ${shadow.entryRegime}\n` : '') +
      (shadow.profileType ? `  프로파일: ${shadow.profileType}\n` : '');

    const exitBlock =
      `\n❌ <b>손절 원인 분석</b>\n` +
      causes.map(c => `  • ${c}`).join('\n');

    // ADR-0005: Gemini 서문이 섞인 레거시 preMortem 도 안전하게 처리.
    // 번호·하이픈 라인만 우선 취하고, 없으면 비-메타 문장 최대 3개 추출.
    const preMortemBlock = shadow.preMortem
      ? `\n\n🧠 <b>Pre-Mortem 복기</b>\n${extractPreMortemLines(shadow.preMortem).map(l => `  ${l}`).join('\n')}`
      : '';

    const learningBlock =
      `\n\n💡 <b>시스템 학습</b>\n` +
      `  이번 손절 데이터가 귀인 DB에 기록되어 조건별 가중치 재조정에 반영됩니다.\n` +
      `  signalCalibrator 가 다음 주간 캘리브레이션에서 영향도를 적용합니다.`;

    const message = [
      header,
      coreLine + entryBlock + exitBlock + preMortemBlock + learningBlock,
      CHANNEL_SEPARATOR,
    ].join('\n');

    await sendTelegramBroadcast(message, {
      priority: 'HIGH',
      tier: 'T2_REPORT',
      category: 'stop_loss_transparency',
      dedupeKey: `stop_loss_report:${shadow.id}`,
      disableChannelNotification: false,
    });

    console.log(`[StopLossReport] ${shadow.stockCode} 손절 투명성 리포트 발송`);
  } catch (e) {
    console.error('[StopLossReport] 발송 실패:', e instanceof Error ? e.message : e);
  }
}
