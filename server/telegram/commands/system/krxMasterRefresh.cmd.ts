// @responsibility: /krx_master_refresh — KRX/Naver master 강제 갱신 + ≥1000 검증 게이트 (Tier 4 fallback 회복, ADR-0013).
//
// 9일+ 진단 여정 단일 진원지 (KRX_CSV 4/27 이후 0회 성공 → Tier 4 SEED 396건) 즉시 회복용.
// refreshMultiSourceMaster 본체 호출 — 4-tier (KRX→Naver→Shadow→Seed) 검증 게이트는 orchestrator 가
// 이미 적용 (KRX_MIN/NAVER_MIN). 본 handler 는 *추가* user-facing 게이트로 finalCount<1000 거부 안내.
//
// 안전:
// - 10분 rate-limit (KRX/Naver 외부 호출 폭주 차단)
// - 검증 게이트 우회 0건 — orchestrator 가 partial fetch 로 good master 덮어쓰기 차단
// - master 임의 수정 0건 — refreshMultiSourceMaster 단일 통로
// - AUTO_TRADE_ENABLED / emergencyStop 가드 불필요 (인프라 갱신은 비상 시에도 안전)

import { refreshMultiSourceMaster } from '../../../services/multiSourceStockMaster.js';
import { getMasterSize } from '../../../persistence/krxStockMasterRepo.js';
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';

const MIN_ACCEPTABLE_FINAL_COUNT = 1000;
const REFRESH_RATE_LIMIT_MS = 10 * 60_000; // 10분
let _lastRefreshAt = 0;

/** 테스트 전용 — rate-limit state 초기화. */
export function __resetKrxMasterRefreshRateLimitForTests(): void {
  _lastRefreshAt = 0;
}

/** 결과 메시지 빌더 SSOT — 단위 테스트 가능. */
export function formatKrxMasterRefreshMessage(input: {
  before: number;
  after: number;
  finalSource: string;
  finalCount: number;
  usedFallback: boolean;
  attempts: Array<{ source: string; ok: boolean; count: number; reason?: string }>;
  elapsedMs: number;
  acceptableMin?: number;
}): string {
  const min = input.acceptableMin ?? MIN_ACCEPTABLE_FINAL_COUNT;
  const accepted = input.finalCount >= min && input.finalSource !== 'NONE';
  const live = input.finalSource === 'KRX_CSV' || input.finalSource === 'NAVER_LIST';
  const lines: string[] = [];

  // 헤더
  if (input.finalSource === 'NONE') {
    lines.push('❌ KRX Master 강제 갱신 실패 — 모든 tier 실패');
  } else if (!accepted) {
    lines.push('❌ KRX Master 갱신 거부 — 검증 게이트 미통과');
    lines.push(`   finalCount=${input.finalCount} < ${min} (≥${min} 필수)`);
  } else if (live) {
    lines.push('✅ KRX Master 갱신 완료');
  } else {
    lines.push('🟡 KRX Master 갱신 — fallback 사용');
  }
  lines.push('');

  // 본문
  lines.push(`소스: ${input.finalSource}${input.usedFallback ? ' (fallback)' : ''}`);
  lines.push(`이전: ${input.before}개 → 현재: ${input.after}개 (${input.after - input.before >= 0 ? '+' : ''}${input.after - input.before})`);
  lines.push(`소요: ${(input.elapsedMs / 1000).toFixed(1)}s`);
  lines.push('');

  // tier 시도 내역
  lines.push('🔍 Tier 시도 내역:');
  for (const a of input.attempts) {
    const tag = a.ok ? '✅' : '❌';
    const reason = a.reason ? ` (${a.reason})` : '';
    lines.push(`   ${tag} ${a.source}: ${a.count}개${reason}`);
  }
  lines.push('');

  // 다음 단계 / 분기
  if (input.finalSource === 'NONE') {
    lines.push('🚨 모든 tier 실패 — 기존 master 보존됨');
    lines.push('   → KRX_PUBLIC_API_BASE / 네트워크 점검');
    lines.push('   → /kms 로 현재 상태 재확인');
  } else if (!accepted) {
    lines.push('🚨 partial fetch 의심 — 별도 진단 PR 필요');
  } else if (live) {
    lines.push('🎯 다음 단계:');
    lines.push('   - /kms 로 TOTAL ≥2500 확인');
    lines.push('   - /yahoo_health 재실행하여 FETCH_FAIL 감소 확인');
    lines.push('   - 다음 거래일 자동매매 정상 동작 관찰');
  } else {
    lines.push('🎯 fallback 사용 중 — 다음 단계:');
    lines.push('   - KRX/Naver 라이브 소스 결함 점검 (별도 PR)');
    lines.push('   - /kms 로 source 별 health score 확인');
  }

  return lines.join('\n');
}

const krxMasterRefresh: TelegramCommand = {
  name: '/krx_master_refresh',
  aliases: ['/kmr'],
  category: 'SYS',
  visibility: 'ADMIN',
  riskLevel: 1,
  description: 'KRX/Naver master 강제 갱신 — 4-tier fallback + ≥1000 검증 게이트 (ADR-0013, Tier 4 회복용)',
  usage: '/krx_master_refresh (alias /kmr)',
  async execute({ reply }) {
    const now = Date.now();
    if (now - _lastRefreshAt < REFRESH_RATE_LIMIT_MS) {
      const wait = Math.ceil((REFRESH_RATE_LIMIT_MS - (now - _lastRefreshAt)) / 1000);
      await reply(`⏱️ 10분 이내 재호출 차단 — ${wait}초 후 다시 시도`);
      return;
    }
    _lastRefreshAt = now;

    const t0 = Date.now();
    const before = getMasterSize();
    await reply('🔄 KRX Master 강제 갱신 시작 — KRX → Naver → Shadow → Seed 4-tier 시도 중...');

    try {
      const result = await refreshMultiSourceMaster();
      const elapsedMs = Date.now() - t0;
      const after = getMasterSize();

      await reply(
        formatKrxMasterRefreshMessage({
          before,
          after,
          finalSource: result.finalSource,
          finalCount: result.finalCount,
          usedFallback: result.usedFallback,
          attempts: result.attempts,
          elapsedMs,
        }),
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await reply(`❌ KRX Master 갱신 중 예외: ${msg}`);
    }
  },
};

commandRegistry.register(krxMasterRefresh);

export default krxMasterRefresh;
