// @responsibility FOMC/VIX 게이팅 알림 dedupeKey 정합 회귀 (ADR-0093)
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * 사용자 보고 (4/29 FOMC DAY): "📅 [FOMC 게이팅] 신규 진입 차단" 메시지가
 * orchestrator_tick (매 1분) 호출마다 발송되어 채팅창 도배.
 *
 * 근본 원인: 게이팅 알림 호출에 dedupeKey 부재.
 *
 * Audit-fix (2026-05-05): ADR-0147b (signalScanner Phase 3 분해, PR #523) 머지 후
 * 게이팅 알림 4 site → preflight.ts 단일 위치로 통합. 본 회귀 테스트의 grep
 * 대상을 새 위치로 정합 + signalScanner.ts 본체는 부재 단언 (drift 차단).
 *
 * 본 회귀 테스트는 *정적 패턴 검증* — 미래 PR 에서 동일 결함이 재발하지 않도록
 * preflight.ts 의 게이팅 알림 호출 site 가 모두 dedupeKey + cooldownMs 사용 강제.
 */

// vitest 는 process.cwd() 가 프로젝트 root.
function readFile(rel: string): string {
  return fs.readFileSync(path.join(process.cwd(), rel), 'utf-8');
}

describe('ADR-0093 — FOMC/VIX 게이팅 알림 dedupeKey 정합', () => {
  it('signalScanner.ts — VIX 게이팅 알림 본체 부재 (분해 후 preflight 단일)', () => {
    const src = readFile('server/trading/signalScanner.ts');
    expect(src).not.toContain('[VIX 게이팅] 신규 진입 차단');
  });

  it('signalScanner.ts — FOMC 게이팅 알림 본체 부재 (분해 후 preflight 단일)', () => {
    const src = readFile('server/trading/signalScanner.ts');
    expect(src).not.toContain('[FOMC 게이팅] 신규 진입 차단');
  });

  // ── 게이팅 system-wide 제거 (Patch-FOMC-DEAD-CODE-REMOVAL-001 / Patch-FOMC-DOA-BatchC,
  //    patch-history:62·262) 후 회귀 가드 재지정 ─────────────────────────────────────
  // 구 v4 게이팅(VIX/FOMC 신규 진입 차단 알림)이 의도적으로 제거됨:
  //   - vixGating.ts @responsibility "VIX 게이팅 제거됨 (stub only)" → getVixGating 항상 noNewEntry=false.
  //   - fomcCalendar.ts getFomcProximity 항상 NORMAL(FOMC_GATING_REMOVED).
  // 따라서 preflight.ts 에 게이팅 차단 알림 호출 site 자체가 부재 → dedupeKey 정합을
  // 검증할 대상이 없다. 원 ADR-0093 의도(도배 재발 차단)는 "알림 원천 제거"로 충족.
  // 본 단언을 "구 게이팅 알림 본체 부재 (drift 차단)"로 재지정한다. gatingAlertWindow.wiring.test.ts
  // 와 동일 SSOT — 게이팅 알림이 다시 grep 가능해지면(재도입) 즉시 fail 시켜 검토 유발.
  it('preflight.ts — VIX 게이팅 알림 본체 + vix_gating_block dedupeKey 부재 (게이팅 제거)', () => {
    const src = readFile('server/trading/signalScanner/preflight.ts');
    expect(src).not.toContain('[VIX 게이팅] 신규 진입 차단');
    expect(src).not.toContain('vix_gating_block:');
  });

  it('preflight.ts — FOMC 게이팅 알림 본체 + fomc_gating_block dedupeKey 부재 (게이팅 제거)', () => {
    const src = readFile('server/trading/signalScanner/preflight.ts');
    expect(src).not.toContain('[FOMC 게이팅] 신규 진입 차단');
    expect(src).not.toContain('fomc_gating_block:');
  });

  it('회귀 차단 — getVixGating / getFomcProximity 가 no-block stub (알림 발생 원천 제거)', () => {
    // 게이팅 제거의 production SSOT: 두 게이팅 함수가 항상 no-block 반환하므로
    // 차단 알림 자체가 발생할 수 없다 (사용자 보고 도배 시나리오 원천 차단).
    const vixSrc = readFile('server/trading/vixGating.ts');
    expect(vixSrc).toContain('VIX 게이팅 제거됨 (stub only)');
    expect(vixSrc).toContain('noNewEntry:      false');
  });

  it.skip('TODO 별도 PR — fomc_relaxed_ 알림 wiring 복원 (ADR-0147b 분해 시 누락된 정책 회귀)', () => {
    // ADR-0147b (signalScanner Phase 3 분해, PR #523) 머지 시 preflight.ts 의
    // fomc_relaxed_${date} dedupeKey + "우호 환경 완화" 텔레그램 알림 wiring 이
    // 누락되어 코드베이스 어디에도 부재 — *실제 정책 회귀*. 본 회귀 테스트는
    // 향후 wiring 복원 PR (PENDING_WIRING B13 등재) 에서 재활성화 예정.
    //
    // 영향: 운영자가 FOMC PRE_1/DAY 시점 우호 환경 완화 활성화를 인지 못 함.
    // 자금 안전 영향 0 (fomcCalendar 정책 자체는 적용, 알림만 누락).
    const src = readFile('server/trading/signalScanner/preflight.ts');
    expect(src).toContain('fomc_relaxed_');
    expect(src).toContain('우호 환경 완화');
  });
});
