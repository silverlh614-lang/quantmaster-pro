// @responsibility fssStatus.cmd 텔레그램 모듈
// @responsibility: /fss_status — FSS 레코드 신선도 + passiveActiveBoth 의미 진단. SYS ADMIN read-only.
//
// ADR-0136 — silent degradation 차단. 운영자가 한 번에:
//   1. FSS 레코드 영속 신선도 (OK/STALE/MISSING)
//   2. 최신 레코드 일자 + 오늘과의 거리
//   3. last5 표본 카운트
//   4. passiveActiveBoth 현재 값 + 의미 분기 (true/false/null)
//   5. 결손 시 운영자 안내
//
// 외부 호출 0건 — read-only fssRepo + macroStateRepo. 부수효과 없음.

import { getFssRecordsAge, loadFssRecords } from '../../../persistence/fssRepo.js';
import { loadMacroState } from '../../../persistence/macroStateRepo.js';
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';

/**
 * /fss_status 메시지 빌더 SSOT (단위 테스트 가능).
 *
 * @param now 현재 시각 (테스트 주입용)
 */
export function formatFssStatusMessage(now: Date = new Date()): string {
  const ageInfo = getFssRecordsAge(now);
  const records = loadFssRecords();
  const last5 = [...records].sort((a, b) => a.date.localeCompare(b.date)).slice(-5);
  const macro = loadMacroState();

  const statusEmoji =
    ageInfo.status === 'OK' ? '✅' :
    ageInfo.status === 'STALE' ? '⚠️' : '❌';

  const lines: string[] = [];
  lines.push(`📊 <b>[FSS 수급 진단]</b>`);
  lines.push('');
  lines.push(`${statusEmoji} 신선도: <b>${ageInfo.status}</b>`);
  if (ageInfo.latestDate !== null) {
    lines.push(`📅 최신 레코드: ${ageInfo.latestDate} (${ageInfo.ageDays}일 전)`);
  } else {
    lines.push(`📅 최신 레코드: <i>미수집</i>`);
  }
  lines.push(`📈 영속 레코드: ${ageInfo.recordCount}건 (최근 30거래일 보관)`);
  lines.push(`🔢 last5 표본: ${last5.length}건 (passiveActiveBoth 평가 입력)`);
  lines.push('');

  // passiveActiveBoth 의미 분기 안내
  const pab = macro?.passiveActiveBoth;
  const pabLabel =
    pab === true  ? '✅ <b>true</b> — Passive+Active 5일 동시 외인 순매수' :
    pab === false ? '🟡 <b>false</b> — 외인 합치 미감지' :
    pab === null  ? '⚪ <b>null</b> — <i>평가 제외</i> (STALE/MISSING)' :
                    '? <i>미수집</i>';
  lines.push(`🎯 passiveActiveBoth: ${pabLabel}`);
  lines.push('');

  // 운영자 안내
  if (ageInfo.status === 'MISSING') {
    lines.push('💡 <i>운영자 안내</i>:');
    lines.push('  • FSS 자동 fetcher (KRX 11분류 raw, ADR-0141 Stage 1) 작동 중 — 첫 cron 사이클 후 영속 시작.');
    lines.push('  • 영속 부재 시: <code>KRX_BLD_INVESTOR_DETAIL</code> ENV 검증 또는 <code>/fss_detail</code> 진단.');
    lines.push('  • passiveActiveBoth 평가는 ADR-0142 매핑 ENV (<code>FSS_MAPPING_ENABLED</code>, default OFF) 활성화 후 작동.');
    lines.push('  • 즉시 보강: <code>POST /api/macro/fss-records</code> (수동).');
    lines.push('  • passiveActiveBoth=null → 페르소나 의사결정에서 평가 제외.');
  } else if (ageInfo.status === 'STALE') {
    lines.push('💡 <i>운영자 안내</i>:');
    lines.push(`  • 최신 레코드 ${ageInfo.ageDays}일 전 — 4영업일+ 미갱신 (STALE).`);
    lines.push('  • FSS 자동 fetcher (ADR-0141 Stage 1) cron 점검 또는 <code>KRX_BLD_INVESTOR_DETAIL</code> ENV 검증.');
    lines.push('  • <code>/fss_detail</code> 로 KRX 11분류 raw 영속 상태 확인.');
  } else if (last5.length < 3) {
    lines.push('💡 <i>운영자 안내</i>: 표본 < 3건 — passiveActiveBoth 평가 자동 제외.');
  }

  return lines.join('\n');
}

const fssStatus: TelegramCommand = {
  name: '/fss_status',
  aliases: ['/fss'],
  category: 'SYS',
  visibility: 'ADMIN',
  riskLevel: 0,
  description: 'FSS 수급 레코드 신선도 + passiveActiveBoth 의미 진단 (ADR-0136)',
  usage: '/fss_status',
  async execute({ reply }) {
    try {
      const message = formatFssStatusMessage();
      await reply(message);
    } catch (err) {
      console.error('[fssStatus.cmd] failed', err);
      await reply('❌ FSS 진단 실패 — 서버 로그 확인 필요');
    }
  },
};

commandRegistry.register(fssStatus);

export default fssStatus;
