// @responsibility FOMC/VIX 게이팅 알림 dedupeKey 정합 회귀 (ADR-0093)
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * 사용자 보고 (4/29 FOMC DAY): "📅 [FOMC 게이팅] 신규 진입 차단" 메시지가
 * orchestrator_tick (매 1분) 호출마다 발송되어 채팅창 도배.
 *
 * 근본 원인: signalScanner.ts + preflight.ts 의 4 알림 호출에 dedupeKey 부재.
 *
 * 본 회귀 테스트는 *정적 패턴 검증* — 미래 PR 에서 동일 결함이 재발하지 않도록
 * 코드베이스의 게이팅 알림 호출 site 가 모두 dedupeKey + cooldownMs 사용 강제.
 */

// vitest 는 process.cwd() 가 프로젝트 root.
function readFile(rel: string): string {
  return fs.readFileSync(path.join(process.cwd(), rel), 'utf-8');
}

describe('ADR-0093 — FOMC/VIX 게이팅 알림 dedupeKey 정합', () => {
  it('signalScanner.ts VIX 게이팅 알림은 vix_gating_block dedupeKey 사용', () => {
    const src = readFile('server/trading/signalScanner.ts');
    expect(src).toContain('[VIX 게이팅] 신규 진입 차단');
    // VIX 게이팅 차단 알림 인근에 dedupeKey 존재
    const vixIdx = src.indexOf('[VIX 게이팅] 신규 진입 차단');
    const block = src.slice(vixIdx, vixIdx + 600);
    expect(block).toContain('vix_gating_block:');
    expect(block).toContain('cooldownMs:');
    expect(block).toContain('12 * 60 * 60 * 1000');
  });

  it('signalScanner.ts FOMC 게이팅 알림은 fomc_gating_block dedupeKey 사용', () => {
    const src = readFile('server/trading/signalScanner.ts');
    expect(src).toContain('[FOMC 게이팅] 신규 진입 차단');
    const fomcIdx = src.indexOf('[FOMC 게이팅] 신규 진입 차단');
    const block = src.slice(fomcIdx, fomcIdx + 700);
    expect(block).toContain('fomc_gating_block:');
    expect(block).toContain('cooldownMs:');
    expect(block).toContain('12 * 60 * 60 * 1000');
    // nextFomcDate 사용 (preflight.ts:301 fomc_relaxed_ 와 동일 키 정합)
    expect(block).toContain('fomcProximity.nextFomcDate');
  });

  it('preflight.ts VIX 게이팅 알림도 동일 dedupeKey 패턴 사용', () => {
    const src = readFile('server/trading/signalScanner/preflight.ts');
    expect(src).toContain('[VIX 게이팅] 신규 진입 차단');
    const vixIdx = src.indexOf('[VIX 게이팅] 신규 진입 차단');
    const block = src.slice(vixIdx, vixIdx + 600);
    expect(block).toContain('vix_gating_block:');
    expect(block).toContain('cooldownMs:');
    expect(block).toContain('12 * 60 * 60 * 1000');
  });

  it('preflight.ts FOMC 게이팅 알림도 동일 dedupeKey 패턴 사용', () => {
    const src = readFile('server/trading/signalScanner/preflight.ts');
    expect(src).toContain('[FOMC 게이팅] 신규 진입 차단');
    const fomcIdx = src.indexOf('[FOMC 게이팅] 신규 진입 차단');
    const block = src.slice(fomcIdx, fomcIdx + 700);
    expect(block).toContain('fomc_gating_block:');
    expect(block).toContain('cooldownMs:');
    expect(block).toContain('fomcProximity.nextFomcDate');
  });

  it('회귀 차단 — 게이팅 차단 알림 4 site 모두 dedupeKey 누락 패턴 미보유', () => {
    // 본 가드는 사용자 보고 시나리오 재발을 차단 — `[VIX 게이팅] 신규 진입 차단`
    // 또는 `[FOMC 게이팅] 신규 진입 차단` 직후 600자 안에 dedupeKey 없으면 fail.
    const files = ['server/trading/signalScanner.ts', 'server/trading/signalScanner/preflight.ts'];
    const labels = ['[VIX 게이팅] 신규 진입 차단', '[FOMC 게이팅] 신규 진입 차단'];
    for (const file of files) {
      const src = readFile(file);
      for (const label of labels) {
        let idx = src.indexOf(label);
        while (idx !== -1) {
          const block = src.slice(idx, idx + 700);
          // 메시지 본문 (label + description + "포지션 모니터링만 수행합니다.") 포함
          // 그 다음 sendTelegramAlert 호출이 끝나기 전 dedupeKey 가 있어야 함.
          // sendTelegramAlert 호출 종료 marker 는 ").catch(console.error)" 또는 ").catch("
          const callEndIdx = block.indexOf('.catch(');
          const callBlock = callEndIdx > 0 ? block.slice(0, callEndIdx) : block;
          expect(callBlock, `${file} ${label} @${idx} 부근에 dedupeKey 부재`).toContain('dedupeKey');
          idx = src.indexOf(label, idx + label.length);
        }
      }
    }
  });

  it('preflight.ts 의 정합 패턴 (fomc_relaxed_) 그대로 보존', () => {
    // ADR-0093 도입 전부터 존재한 fomc_relaxed_ 패턴이 회귀 변경되지 않았는지 확인.
    const src = readFile('server/trading/signalScanner/preflight.ts');
    expect(src).toContain('fomc_relaxed_');
    expect(src).toContain('우호 환경 완화');
  });
});
