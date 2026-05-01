// @responsibility fssDetail.cmd 텔레그램 모듈
// @responsibility: /fss_detail — KRX 11분류 raw 진단 (ADR-0141 Stage 1). SYS ADMIN read-only.
//
// 운영자가 일자별 11 카테고리 raw 데이터 직접 확인. Passive/Active 매핑 미적용
// (ADR-0142 별도 PR). 외부 호출 0 — 영속 시계열 read.

import { getFssDetailRecord, getLatestFssDetailRecord, loadFssDetailRecords } from '../../../persistence/fssDetailRepo.js';
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** 거래대금 억원 변환 + 부호 보존. */
function formatKrwInEokwon(amountWon: number): string {
  if (!Number.isFinite(amountWon)) return 'N/A';
  const eokwon = amountWon / 100_000_000;
  if (Math.abs(eokwon) < 0.05) return '0억원';
  const sign = eokwon > 0 ? '+' : '';
  return `${sign}${eokwon.toFixed(1)}억원`;
}

/**
 * /fss_detail 메시지 빌더 SSOT.
 *
 * 분기:
 *   1. 잘못된 일자 형식 → 사용법 안내
 *   2. 영속 부재 → 운영자 안내
 *   3. 정상 → 11 카테고리 raw 표시 (한글 키 그대로)
 */
export function buildFssDetailMessage(args: string[]): string {
  const dateArg = (args[0] ?? '').trim();
  const lines: string[] = [];
  lines.push('🏛️ <b>[FSS 11분류 raw 진단]</b>');
  lines.push('');

  if (dateArg && !DATE_PATTERN.test(dateArg)) {
    lines.push('❌ 일자 형식 오류 — YYYY-MM-DD');
    lines.push('');
    lines.push('<i>사용법</i>: <code>/fss_detail</code> (최신) 또는 <code>/fss_detail 2026-04-29</code>');
    lines.push('<i>alias</i>: <code>/fssd</code>');
    return lines.join('\n');
  }

  const record = dateArg ? getFssDetailRecord(dateArg) : getLatestFssDetailRecord();
  const totalRecords = loadFssDetailRecords().length;

  if (!record) {
    lines.push('❌ 영속 시계열 부재');
    lines.push('');
    lines.push('💡 <i>운영자 안내</i>:');
    if (dateArg) {
      lines.push(`  • 해당 일자(${dateArg}) record 부재 — 30영업일 trim 됐거나 미수집`);
      lines.push(`  • 누적 영속: ${totalRecords}일`);
    } else {
      lines.push('  • marketDataRefresh cron 1회 이상 누적 필요');
      lines.push('  • <code>FSS_DETAIL_FETCHER_DISABLED=true</code> ENV 활성화 가능');
      lines.push('  • KRX BLD ID 검증 필요 — <code>KRX_BLD_INVESTOR_DETAIL</code> ENV 우회 (default <code>MDCSTAT02301</code> 추정)');
    }
    return lines.join('\n');
  }

  lines.push(`📅 일자: <code>${record.date}</code>`);
  try {
    const kst = new Date(record.fetchedAt);
    lines.push(`⏱️ 수집 시각 (KST): ${kst.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', hour12: false })}`);
  } catch {
    lines.push(`⏱️ 수집 시각: ${record.fetchedAt}`);
  }
  lines.push(`📊 누적 영속: ${totalRecords}일`);
  lines.push('');

  if (record.rows.length === 0) {
    lines.push('<i>해당 일자 카테고리 데이터 비어있음</i>');
  } else {
    lines.push('<b>11 카테고리 순매수 (raw, 매핑 미적용)</b>:');
    // 순매수 거래대금 내림차순 정렬 (양수 우선 표시)
    const sorted = [...record.rows].sort((a, b) => b.netBuyKrw - a.netBuyKrw);
    for (const row of sorted) {
      const emoji = row.netBuyKrw > 0 ? '🟢' : row.netBuyKrw < 0 ? '🔴' : '⚪';
      lines.push(`  ${emoji} <b>${row.category}</b>: ${formatKrwInEokwon(row.netBuyKrw)}`);
    }
  }

  lines.push('');
  lines.push('📌 <i>매핑 미적용 (ADR-0141 Stage 1)</i> — Passive/Active 매핑은 ADR-0142 후속 PR (데이터 1~2주 누적 후 검증).');

  return lines.join('\n');
}

const fssDetail: TelegramCommand = {
  name: '/fss_detail',
  aliases: ['/fssd'],
  category: 'SYS',
  visibility: 'ADMIN',
  riskLevel: 0,
  description: 'KRX 11분류 raw 투자자별 매매 진단 (ADR-0141 Stage 1, 매핑 미적용)',
  usage: '/fss_detail [YYYY-MM-DD]',
  async execute({ args, reply }) {
    try {
      const message = buildFssDetailMessage(args);
      await reply(message);
    } catch (err) {
      console.error('[fssDetail.cmd] failed', err);
      await reply('❌ FSS 11분류 진단 실패 — 서버 로그 확인 필요');
    }
  },
};

commandRegistry.register(fssDetail);

export default fssDetail;
