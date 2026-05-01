// @responsibility fssMapping.cmd 텔레그램 모듈
// @responsibility: /fss_mapping — FSS 11분류 → Passive/Active 매핑 결과 진단 (ADR-0142). SYS ADMIN read-only.
//
// 운영자가 *매핑 활성화 전* 결과 미리 확인. ENV `FSS_MAPPING_ENABLED=true` 활성화
// 후에는 자동으로 fssRepo 영속됨. 본 명령은 *영속 변경 0건* — read-only 검증.

import { getFssDetailRecord, getLatestFssDetailRecord, loadFssDetailRecords } from '../../../persistence/fssDetailRepo.js';
import { mapPassiveActive, isFssMappingEnabled } from '../../../persistence/fssMappingPolicy.js';
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** 억원 부호 보존 + 소수점 1자리. */
function formatEokwon(eokwon: number): string {
  if (!Number.isFinite(eokwon)) return 'N/A';
  if (Math.abs(eokwon) < 0.05) return '0억원';
  const sign = eokwon > 0 ? '+' : '';
  return `${sign}${eokwon.toFixed(1)}억원`;
}

/** Passive/Active 동시 양수 여부 — passiveActiveBoth 평가 prep. */
function evaluatePassiveActiveBoth(passive: number, active: number): boolean {
  return passive > 0 && active > 0;
}

export function buildFssMappingMessage(args: string[]): string {
  const dateArg = (args[0] ?? '').trim();
  const lines: string[] = [];
  lines.push('🧮 <b>[FSS 매핑 진단]</b>');
  lines.push('');

  if (dateArg && !DATE_PATTERN.test(dateArg)) {
    lines.push('❌ 일자 형식 오류 — YYYY-MM-DD');
    lines.push('');
    lines.push('<i>사용법</i>: <code>/fss_mapping</code> (최신) 또는 <code>/fss_mapping 2026-04-29</code>');
    lines.push('<i>alias</i>: <code>/fssm</code>');
    return lines.join('\n');
  }

  const record = dateArg ? getFssDetailRecord(dateArg) : getLatestFssDetailRecord();
  const totalRecords = loadFssDetailRecords().length;
  const envEnabled = isFssMappingEnabled();

  // ENV 상태 헤더 (항상 표시)
  lines.push(`⚙️ <b>ENV 상태</b>: <code>FSS_MAPPING_ENABLED=${envEnabled ? 'true' : 'false (default)'}</code>`);
  if (!envEnabled) {
    lines.push('  • 매핑 결과가 <code>fssRepo</code> 에 자동 영속되지 *않음*');
    lines.push('  • 운영자가 데이터 검증 후 명시 활성화 권장 (ADR-0142)');
  } else {
    lines.push('  • 매핑 결과가 매 cron 사이클 자동 영속됨 (passiveActiveBoth 평가 활성화)');
  }
  lines.push('');

  if (!record) {
    lines.push('❌ 영속 시계열 부재');
    lines.push('');
    lines.push('💡 <i>운영자 안내</i>:');
    if (dateArg) {
      lines.push(`  • 해당 일자(${dateArg}) record 부재 — 30영업일 trim 또는 미수집`);
      lines.push(`  • 누적 영속: ${totalRecords}일`);
    } else {
      lines.push('  • PR-B Stage 1 (ADR-0141) cron 1회 이상 누적 필요');
      lines.push('  • <code>/fss_detail</code> 명령으로 raw 영속 확인 권장');
    }
    return lines.join('\n');
  }

  // 매핑 적용 (read-only — 영속 변경 0)
  const mapped = mapPassiveActive(record.rows, record.date);
  const both = evaluatePassiveActiveBoth(mapped.passiveNetBuy, mapped.activeNetBuy);

  lines.push(`📅 일자: <code>${record.date}</code>`);
  lines.push(`📊 누적 영속: ${totalRecords}일`);
  lines.push('');

  lines.push('<b>🟢 Passive proxy (장기 자산운용)</b>');
  lines.push(`  • 카테고리: 투신 + 연기금 등 + 보험`);
  lines.push(`  • 합산: ${formatEokwon(mapped.passiveNetBuy)}`);
  lines.push('');

  lines.push('<b>🔵 Active proxy (단기 알파)</b>');
  lines.push(`  • 카테고리: 금융투자 + 사모 + 은행 + 기타금융`);
  lines.push(`  • 합산: ${formatEokwon(mapped.activeNetBuy)}`);
  lines.push('');

  lines.push('<b>🌍 Foreign 합</b>');
  lines.push(`  • 카테고리: 외국인 + 기타외국인`);
  lines.push(`  • 합산: ${formatEokwon(mapped.foreignNetBuy)}`);
  lines.push('');

  lines.push('<b>📐 passiveActiveBoth 평가</b>');
  if (both) {
    lines.push(`  • <b>true</b> ✅ — Passive 양수 + Active 양수 (R3_EARLY 트리거 조건 충족)`);
  } else {
    lines.push(`  • <b>false</b> 🟡 — 매수 합치 미감지 (Passive ${mapped.passiveNetBuy >= 0 ? '+' : '-'}, Active ${mapped.activeNetBuy >= 0 ? '+' : '-'})`);
  }
  lines.push('');

  if (mapped.unmatched.length > 0) {
    lines.push(`<b>⚠️ unmatched 카테고리</b> (${mapped.unmatched.length}건)`);
    lines.push(`  • ${mapped.unmatched.join(', ')}`);
    lines.push(`  • 매핑 외 — passiveActiveBoth 평가 제외 (개인 / 기타법인 등)`);
    lines.push('');
  }

  lines.push('📌 <i>매핑 정책</i>: ADR-0142 후보 (검증 대기). 운영자 데이터 누적 후 ENV 활성화 결정.');

  return lines.join('\n');
}

const fssMapping: TelegramCommand = {
  name: '/fss_mapping',
  aliases: ['/fssm'],
  category: 'SYS',
  visibility: 'ADMIN',
  riskLevel: 0,
  description: 'FSS 11분류 → Passive/Active/Foreign 매핑 진단 (ADR-0142, default OFF)',
  usage: '/fss_mapping [YYYY-MM-DD]',
  async execute({ args, reply }) {
    try {
      const message = buildFssMappingMessage(args);
      await reply(message);
    } catch (err) {
      console.error('[fssMapping.cmd] failed', err);
      await reply('❌ FSS 매핑 진단 실패 — 서버 로그 확인 필요');
    }
  },
};

commandRegistry.register(fssMapping);

export default fssMapping;
