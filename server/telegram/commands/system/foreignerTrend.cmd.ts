// @responsibility foreignerTrend.cmd 텔레그램 모듈
// @responsibility: /foreigner_trend — Naver 외인 보유율 5d/20d 추세 진단. SYS ADMIN read-only.
//
// ADR-0140 — 페르소나 자료 #6 외인 *구조적* 진입/이탈 시그널 진단. 당일 순매수와
// 별개의 *보유율 변화율* 신호. read-only — 영속 시계열 기반, 외부 호출 0.

import { computeForeignerRatioTrend, loadForeignerRatioSeries } from '../../../persistence/foreignerRatioRepo.js';
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';

const STOCK_CODE_PATTERN = /^[0-9]{6}$/;

/** %p 부호 보존 + 소수점 2자리 + null 안전. */
function formatPctP(pctP: number | null | undefined): string {
  if (pctP === null || pctP === undefined || !Number.isFinite(pctP)) return 'N/A';
  const sign = pctP > 0 ? '+' : '';
  return `${sign}${pctP.toFixed(2)}%p`;
}

/** 5d 변화 임계 — 외인 구조적 진입/이탈 분기. */
const STRUCTURAL_INFLOW_THRESHOLD = 1.0;   // ≥ +1.0%p
const STRUCTURAL_OUTFLOW_THRESHOLD = -1.0; // ≤ -1.0%p

/**
 * /foreigner_trend 메시지 빌더 SSOT.
 *
 * 분기:
 *   1. 잘못된 코드 → 사용법 안내
 *   2. 영속 부재 → 운영자 안내
 *   3. 표본 < 6 → 수집 중 안내 (5d 미활성)
 *   4. 표본 ≥ 6 → 5d 활성 + 양수/음수 분기
 *   5. 표본 ≥ 21 → 20d 도 활성
 */
export function buildForeignerTrendMessage(args: string[]): string {
  const code = (args[0] ?? '').trim();
  if (!STOCK_CODE_PATTERN.test(code)) {
    return [
      '🌐 <b>[외인 보유율 추세 진단]</b>',
      '',
      '❌ 종목코드 입력 필요 — 6자리 숫자',
      '',
      '<i>사용법</i>: <code>/foreigner_trend 005930</code>',
      '<i>alias</i>: <code>/ft 005930</code>, <code>/fr 005930</code>',
    ].join('\n');
  }

  const trend = computeForeignerRatioTrend(code);
  const series = loadForeignerRatioSeries(code);

  const lines: string[] = [];
  lines.push('🌐 <b>[외인 보유율 추세]</b>');
  lines.push(`🎯 종목코드: <code>${code}</code>`);
  lines.push('');

  if (trend === null) {
    lines.push('❌ 영속 시계열 부재');
    lines.push('');
    lines.push('💡 <i>운영자 안내</i>:');
    lines.push('  • 본 종목 Naver enrichment 미실행 — `aiUniverseService` cron 1회 이상 누적 필요');
    lines.push('  • 또는 Naver Finance 미연동 (negative cache 활성)');
    lines.push('  • cron 갱신 후 다음 호출 시 시계열 초기 row 영속 시작');
    return lines.join('\n');
  }

  lines.push(`📊 현재 보유율: <b>${trend.current.toFixed(2)}%</b>`);
  lines.push(`📅 최신 일자: ${trend.latestDate}`);
  lines.push(`📈 누적 표본: ${trend.sampleSize}일`);
  lines.push('');

  // 5d 추세
  if (trend.changePct5d === null) {
    lines.push(`📉 5d 변화: <i>수집 중</i> (표본 ${trend.sampleSize}/6 일)`);
  } else {
    const change = trend.changePct5d;
    const emoji = change >= STRUCTURAL_INFLOW_THRESHOLD ? '🟢'
      : change <= STRUCTURAL_OUTFLOW_THRESHOLD ? '🔴'
      : '⚪';
    const label = change >= STRUCTURAL_INFLOW_THRESHOLD ? '구조적 매수 ✅'
      : change <= STRUCTURAL_OUTFLOW_THRESHOLD ? '구조적 이탈 ⚠️'
      : '소폭 변동';
    lines.push(`${emoji} 5d 변화: ${formatPctP(change)} — ${label}`);
  }

  // 20d 추세
  if (trend.changePct20d === null) {
    lines.push(`📊 20d 변화: <i>수집 중</i> (표본 ${trend.sampleSize}/21 일)`);
  } else {
    const change = trend.changePct20d;
    const sign = change > 0 ? '+' : '';
    lines.push(`📊 20d 변화: ${sign}${change.toFixed(2)}%p`);
  }

  // 임계 안내
  lines.push('');
  lines.push(`📌 <i>임계 안내</i>: 5d ≥ +${STRUCTURAL_INFLOW_THRESHOLD}%p 구조적 매수 / ≤ ${STRUCTURAL_OUTFLOW_THRESHOLD}%p 구조적 이탈`);

  // 시계열 데이터 부재 안내 (사용자 실수 방지)
  if (series.length < trend.sampleSize) {
    // 이론적으로 도달 안 함 — 안전 fallback
    lines.push('');
    lines.push('<i>⚠ 시계열 정합성 경고 — 운영자 검토 필요</i>');
  }

  return lines.join('\n');
}

const foreignerTrend: TelegramCommand = {
  name: '/foreigner_trend',
  aliases: ['/ft', '/fr'],
  category: 'SYS',
  visibility: 'ADMIN',
  riskLevel: 0,
  description: 'Naver 외인 보유율 5d/20d 추세 진단 (ADR-0140, 페르소나 자료 #6)',
  usage: '/foreigner_trend <6자리 종목코드>',
  async execute({ args, reply }) {
    try {
      const message = buildForeignerTrendMessage(args);
      await reply(message);
    } catch (err) {
      console.error('[foreignerTrend.cmd] failed', err);
      await reply('❌ 외인 보유율 추세 진단 실패 — 서버 로그 확인 필요');
    }
  },
};

commandRegistry.register(foreignerTrend);

export default foreignerTrend;
