// @responsibility marginBalance.cmd 텔레그램 모듈
// @responsibility: /margin_balance — ECOS 신용공여잔액 5영업일 변화율 진단. SYS ADMIN read-only.
//
// ADR-0139 — `marginBalance5dChange` 영속 writer 처음 마련. 운영자가 실시간 ECOS
// 호출 vs macroState 영속 둘 다 비교 진단. enemyChecklist 5% 임계 안내.

import { fetchLatestMarginBalance5dChange } from '../../../clients/ecosClient.js';
import { loadMacroState } from '../../../persistence/macroStateRepo.js';
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';

/** 변화율 부호 보존 + 소수점 2자리 + null 안전. */
function formatPct(pct: number | null | undefined): string {
  if (pct === null || pct === undefined || !Number.isFinite(pct)) return 'N/A';
  const sign = pct > 0 ? '+' : '';
  return `${sign}${pct.toFixed(2)}%`;
}

/** 5% 임계 (enemyChecklist 정합) — 신용잔고 과열 분기. */
const OVERHEATING_THRESHOLD_PCT = 5;

/**
 * /margin_balance 메시지 빌더 SSOT (단위 테스트 가능).
 *
 * 단계:
 *   1. ECOS 단발성 호출 (실시간 데이터)
 *   2. macroState 영속값 로드 (직전 cron 결과)
 *   3. 두 값 비교 + 5% 임계 안내
 */
export async function buildMarginBalanceMessage(): Promise<string> {
  const live = await fetchLatestMarginBalance5dChange();
  const macro = loadMacroState();

  const lines: string[] = [];
  lines.push('💳 <b>[신용공여잔액 5영업일 변화율]</b>');
  lines.push('');

  if (live === null) {
    lines.push('❌ ECOS 실시간 조회 실패');
    lines.push('');
    lines.push('💡 <i>운영자 안내</i>:');
    lines.push('  • <code>ECOS_API_KEY</code> 미설정 또는 <code>ECOS_API_DISABLED=true</code> 가능');
    lines.push('  • 표본 < 6 (5일 변화율 산출 불가) — 비영업일 연속 가능성');
    lines.push('  • STAT_CODE 검증 — <code>ECOS_MARGIN_LOAN_STAT_CODE</code> ENV 우회');
    lines.push('  • ITEM_CODE 검증 — <code>ECOS_MARGIN_LOAN_ITEM_CODE</code> ENV 우회');
  } else {
    const overheated = live.changePct >= OVERHEATING_THRESHOLD_PCT;
    const emoji = overheated ? '🔴' : live.changePct >= 0 ? '🟢' : '🔵';
    const label = overheated
      ? `과열 ⚠️ (≥${OVERHEATING_THRESHOLD_PCT}%)`
      : live.changePct >= 0 ? '증가' : '감소';

    lines.push('📡 <b>실시간 (ECOS 직접 호출)</b>');
    lines.push(`${emoji} 5d 변화율: ${formatPct(live.changePct)} — ${label}`);
    lines.push(`📅 최신 일자: ${live.latestDate}`);
    try {
      const kst = new Date(live.fetchedAt);
      lines.push(`⏱️ 응답 시각 (KST): ${kst.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', hour12: false })}`);
    } catch {
      lines.push(`⏱️ 응답 시각: ${live.fetchedAt}`);
    }
  }

  // macroState 영속값 비교
  lines.push('');
  lines.push('💾 <b>macroState 영속 (직전 cron)</b>');
  if (macro?.marginBalanceSource === 'ECOS_API' && macro.marginBalance5dChange !== undefined) {
    lines.push(`  • 5d 변화율: ${formatPct(macro.marginBalance5dChange)}`);
    if (macro.marginBalanceFetchedAt) {
      try {
        const kst = new Date(macro.marginBalanceFetchedAt);
        lines.push(`  • 수집 시각 (KST): ${kst.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', hour12: false })}`);
      } catch {
        lines.push(`  • 수집 시각: ${macro.marginBalanceFetchedAt}`);
      }
    }
  } else if (macro?.marginBalanceSource === 'NONE') {
    lines.push('  • <i>마지막 cron 사이클 ECOS 호출 실패</i>');
  } else {
    lines.push('  • <i>미수집</i> (cron 1회 미실행 또는 ECOS 미연동)');
  }

  // 임계 안내
  lines.push('');
  lines.push(`📌 <i>임계 안내</i>: 5d 변화율 ≥ ${OVERHEATING_THRESHOLD_PCT}% → enemyChecklist 신용잔고 과열 플래그`);

  return lines.join('\n');
}

const marginBalance: TelegramCommand = {
  name: '/margin_balance',
  aliases: ['/margin', '/mb'],
  category: 'SYS',
  visibility: 'ADMIN',
  riskLevel: 0,
  description: 'ECOS 신용공여잔액 5영업일 변화율 진단 (ADR-0139)',
  usage: '/margin_balance',
  async execute({ reply }) {
    try {
      const message = await buildMarginBalanceMessage();
      await reply(message);
    } catch (err) {
      console.error('[marginBalance.cmd] failed', err);
      await reply('❌ 신용공여잔액 진단 실패 — 서버 로그 확인 필요');
    }
  },
};

commandRegistry.register(marginBalance);

export default marginBalance;
