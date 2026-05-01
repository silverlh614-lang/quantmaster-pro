// @responsibility programToday.cmd 텔레그램 모듈
// @responsibility: /program_today — KIS program-trade-by-stock 종목별 진단. SYS ADMIN read-only KIS 1회.
//
// ADR-0137 — 페르소나 자료 #6 "외국인 프로그램/비프로그램" 시그널 데이터 페치 인프라.
// 운영자가 종목코드를 인자로 입력하면 KIS Open API 단발성 호출 → 결과 표기.
// 본 PR 은 *진단 명령* 만 — enrichment/signalScanner wiring 후속 PR.

import { fetchKisStockProgramTrade } from '../../../clients/kisClient/index.js';
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';

const STOCK_CODE_PATTERN = /^[0-9]{6}$/;

/** 억원 변환 — 음수 부호 보존, 소수점 1자리. 0 이면 "0억원". */
function formatKrwInEokwon(amountWon: number): string {
  if (!Number.isFinite(amountWon)) return 'N/A';
  const eokwon = amountWon / 100_000_000;
  if (Math.abs(eokwon) < 0.05) return '0억원';
  const sign = eokwon > 0 ? '+' : '';
  return `${sign}${eokwon.toFixed(1)}억원`;
}

/** 주(qty) 포맷 — 음수 부호 보존, 천단위 콤마. */
function formatQty(qty: number): string {
  if (!Number.isFinite(qty)) return 'N/A';
  const abs = Math.abs(qty).toLocaleString('ko-KR');
  if (qty === 0) return '0주';
  const sign = qty > 0 ? '+' : '-';
  return `${sign}${abs}주`;
}

/**
 * /program_today 메시지 빌더 SSOT (단위 테스트 가능).
 *
 * 단계:
 *   1. 잘못된 코드 → 사용법 안내
 *   2. KIS 응답 null → 운영자 안내 (ENV / 회로차단 / TR ID 검증)
 *   3. 정상 응답 → 양수/음수/0 분기 + 비중 null 분기
 */
export async function buildProgramTodayMessage(args: string[]): Promise<string> {
  const code = (args[0] ?? '').trim();
  if (!STOCK_CODE_PATTERN.test(code)) {
    return [
      '📊 <b>[종목별 프로그램 매매 진단]</b>',
      '',
      '❌ 종목코드 입력 필요 — 6자리 숫자',
      '',
      '<i>사용법</i>: <code>/program_today 005930</code>',
      '<i>alias</i>: <code>/prog 005930</code>',
    ].join('\n');
  }

  const data = await fetchKisStockProgramTrade(code);

  if (data === null) {
    return [
      '📊 <b>[종목별 프로그램 매매 진단]</b>',
      `🎯 종목코드: <code>${code}</code>`,
      '',
      '❌ 데이터 수집 실패',
      '',
      '💡 <i>운영자 안내</i>:',
      '  • <code>KIS_APP_KEY</code> 또는 실계좌 클라이언트 미설정 가능성',
      '  • KIS 회로차단 활성 또는 24h 블랙리스트 가능성',
      '  • TR ID 검증 — <code>KIS_STOCK_PROGRAM_TRADE_TR_ID</code> ENV 우회',
      '  • Path 검증 — <code>KIS_STOCK_PROGRAM_TRADE_PATH</code> ENV 우회',
      '  • 잘못된 종목코드 또는 비상장 종목 가능성',
    ].join('\n');
  }

  const qtyEmoji  = data.programNetBuyQty > 0 ? '🟢' : data.programNetBuyQty < 0 ? '🔴' : '⚪';
  const qtyLabel  = data.programNetBuyQty > 0
    ? '프로그램 순매수'
    : data.programNetBuyQty < 0 ? '프로그램 순매도' : '중립';

  const lines: string[] = [];
  lines.push('📊 <b>[종목별 프로그램 매매]</b>');
  lines.push(`🎯 종목코드: <code>${data.stockCode}</code>`);
  lines.push('');
  lines.push(`${qtyEmoji} ${qtyLabel}: ${formatQty(data.programNetBuyQty)}`);
  lines.push(`💰 프로그램 거래대금: ${formatKrwInEokwon(data.programNetBuyAmount)}`);

  if (data.programBuyRatio !== null) {
    lines.push(`📈 프로그램 매수 비중: ${data.programBuyRatio.toFixed(2)}%`);
  } else {
    lines.push(`📈 프로그램 매수 비중: <i>미수집</i> (KIS 응답 부재)`);
  }

  // KST 응답 시각
  try {
    const kst = new Date(data.fetchedAt);
    const kstStr = kst.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', hour12: false });
    lines.push(`⏱️ 응답 시각 (KST): ${kstStr}`);
  } catch {
    lines.push(`⏱️ 응답 시각: ${data.fetchedAt}`);
  }
  lines.push(`📡 출처: ${data.source}`);

  return lines.join('\n');
}

const programToday: TelegramCommand = {
  name: '/program_today',
  aliases: ['/prog'],
  category: 'SYS',
  visibility: 'ADMIN',
  riskLevel: 0,
  description: 'KIS 종목별 당일 프로그램 매매 진단 (ADR-0137, 페르소나 자료 #6)',
  usage: '/program_today <6자리 종목코드>',
  async execute({ args, reply }) {
    try {
      const message = await buildProgramTodayMessage(args);
      await reply(message);
    } catch (err) {
      console.error('[programToday.cmd] failed', err);
      await reply('❌ 종목별 프로그램 매매 진단 실패 — 서버 로그 확인 필요');
    }
  },
};

commandRegistry.register(programToday);

export default programToday;
