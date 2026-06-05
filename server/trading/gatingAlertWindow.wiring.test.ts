// @responsibility ADR-0104 게이팅 알림 윈도우 가드 wiring 회귀 (정적 패턴)
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * ADR-0104 — 게이팅 차단 알림(VIX/FOMC)은 KST 장시작/장마감 윈도우만 발송.
 * 본 회귀 테스트는 *정적 패턴 검증* — preflight.ts 의 게이팅 알림 호출 site 가
 * 모두 getGatingAlertSession() 가드를 통과하는지 확인.
 *
 * Audit-fix (2026-05-05): ADR-0147b (signalScanner Phase 3 분해, PR #523) 머지 후
 * 게이팅 알림 wiring 이 signalScanner.ts → signalScanner/preflight.ts 단일 위치로
 * 이주. 본 회귀 테스트의 grep 대상 경로를 새 위치로 정합 + signalScanner.ts 측은
 * drift 차단 (부재 단언) 으로 격하.
 *
 * 사용자 보고 시나리오 (4/29 FOMC DAY 14:30 KST = 베이징 13:30):
 *   - 14:30 KST → getGatingAlertSession() = null → 발송 차단
 *   - 09:30 KST → 'OPEN' → 발송 (open dedupeKey 1회)
 *   - 15:30 KST → 'CLOSE' → 발송 (close dedupeKey 1회)
 */
function readFile(rel: string): string {
  return fs.readFileSync(path.join(process.cwd(), rel), 'utf-8');
}

describe('ADR-0104 — 게이팅 알림 윈도우 가드 wiring', () => {
  it('signalScanner.ts — gatingAlertWindow 직접 import 부재 (분해 후 preflight 단일)', () => {
    const src = readFile('server/trading/signalScanner.ts');
    expect(src).not.toContain("from '../utils/gatingAlertWindow.js'");
  });

  // ADR-0104 게이팅 알림 윈도우 가드는 VIX/FOMC 게이팅 차단 알림을 전제로 한다.
  // 그러나 두 게이팅이 모두 system-wide 제거됨:
  //   - VIX: vixGating.ts @responsibility "VIX 게이팅 제거됨 (stub only)" — getVixGating
  //          항상 noNewEntry=false 반환.
  //   - FOMC: Patch-FOMC-DEAD-CODE-REMOVAL-001 / Patch-FOMC-DOA-BatchC (system-wide 제거).
  // → preflight.ts 에 게이팅 차단 알림 블록 자체가 없으므로 windowing 가드도 불필요.
  // 본 그룹의 "존재 + session 가드" 단언을 "removed (drift 차단)" 단언으로 재지정한다
  // (기존 signalScanner.ts 부재 단언과 동일 SRP — DOA contract 가 아닌 removal 검증).
  it('preflight.ts — VIX/FOMC 게이팅 알림 본체 부재 (게이팅 system-wide 제거)', () => {
    const src = readFile('server/trading/signalScanner/preflight.ts');
    expect(src).not.toContain('[VIX 게이팅] 신규 진입 차단');
    expect(src).not.toContain('[FOMC 게이팅] 신규 진입 차단');
    // 게이팅 알림이 없으므로 windowing import 도 불필요.
    expect(src).not.toContain('getGatingAlertSession');
  });

  it('signalScanner.ts — VIX 게이팅 차단 알림 본체 부재 (preflight 위임)', () => {
    const src = readFile('server/trading/signalScanner.ts');
    expect(src).not.toContain('[VIX 게이팅] 신규 진입 차단');
  });

  it('signalScanner.ts — FOMC 게이팅 차단 알림 본체 부재 (preflight 위임)', () => {
    const src = readFile('server/trading/signalScanner.ts');
    expect(src).not.toContain('[FOMC 게이팅] 신규 진입 차단');
  });

  it('회귀 차단 — VIX 게이팅 stub 은 noNewEntry=false (게이팅 알림 발생 원천 제거)', () => {
    // 게이팅 제거의 SSOT 근거: getVixGating 이 항상 no-block 반환 → 게이팅 차단 알림
    // 자체가 발생하지 않음. (구 ADR-0104 의 14:30 KST 도배 시나리오는 게이팅 알림이
    // 존재할 때만 의미. 게이팅 제거로 원천 차단.)
    const src = readFile('server/trading/vixGating.ts');
    expect(src).toContain('VIX 게이팅 제거됨 (stub only)');
    expect(src).toContain('noNewEntry:      false');
  });

  it('회귀 차단 — preflight.ts 에 게이팅 알림 라벨 sendTelegramAlert 호출 부재', () => {
    // 게이팅 알림이 제거되었으므로 어떤 windowing 우회 발송도 존재하면 안 된다.
    const src = readFile('server/trading/signalScanner/preflight.ts');
    expect(src).not.toContain('[VIX 게이팅] 신규 진입 차단');
    expect(src).not.toContain('[FOMC 게이팅] 신규 진입 차단');
    expect(src).not.toContain('vix_gating_block:');
    expect(src).not.toContain('fomc_gating_block:');
  });
});
