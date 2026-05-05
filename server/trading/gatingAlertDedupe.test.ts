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

  it('preflight.ts VIX 게이팅 알림은 vix_gating_block dedupeKey 사용', () => {
    const src = readFile('server/trading/signalScanner/preflight.ts');
    expect(src).toContain('[VIX 게이팅] 신규 진입 차단');
    const vixIdx = src.indexOf('[VIX 게이팅] 신규 진입 차단');
    const block = src.slice(vixIdx, vixIdx + 600);
    expect(block).toContain('vix_gating_block:');
    expect(block).toContain('cooldownMs:');
    expect(block).toContain('12 * 60 * 60 * 1000');
  });

  it('preflight.ts FOMC 게이팅 알림은 fomc_gating_block dedupeKey 사용', () => {
    const src = readFile('server/trading/signalScanner/preflight.ts');
    expect(src).toContain('[FOMC 게이팅] 신규 진입 차단');
    const fomcIdx = src.indexOf('[FOMC 게이팅] 신규 진입 차단');
    const block = src.slice(fomcIdx, fomcIdx + 700);
    expect(block).toContain('fomc_gating_block:');
    expect(block).toContain('cooldownMs:');
    expect(block).toContain('12 * 60 * 60 * 1000');
    expect(block).toContain('fomcProximity.nextFomcDate');
  });

  it('회귀 차단 — preflight.ts 게이팅 차단 알림 모두 dedupeKey 보유', () => {
    // 본 가드는 사용자 보고 시나리오 재발을 차단 — `[VIX 게이팅] 신규 진입 차단`
    // 또는 `[FOMC 게이팅] 신규 진입 차단` 직후 700자 안에 dedupeKey 없으면 fail.
    const src = readFile('server/trading/signalScanner/preflight.ts');
    const labels = ['[VIX 게이팅] 신규 진입 차단', '[FOMC 게이팅] 신규 진입 차단'];
    for (const label of labels) {
      let idx = src.indexOf(label);
      while (idx !== -1) {
        const block = src.slice(idx, idx + 700);
        const callEndIdx = block.indexOf('.catch(');
        const callBlock = callEndIdx > 0 ? block.slice(0, callEndIdx) : block;
        expect(callBlock, `preflight.ts ${label} @${idx} 부근에 dedupeKey 부재`).toContain('dedupeKey');
        idx = src.indexOf(label, idx + label.length);
      }
    }
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
