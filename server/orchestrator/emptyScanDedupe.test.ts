/**
 * @responsibility 빈스캔 포스트모템 dedupeKey 정합 회귀 (ADR-0094 옵션 A)
 *
 * 사용자 보고 (4/29 09:35): "🔬 [빈스캔 포스트모템] PATHOLOGICAL_BLOCK" 알림이
 * 매 3회 빈 스캔마다 도배. PR-Z6 (FOMC/VIX 게이팅) 와 동일 결함 — dedupeKey 부재.
 *
 * 본 회귀 테스트는 *정적 패턴 검증* — 미래 PR 에서 동일 결함 재발 차단.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

function readFile(rel: string): string {
  return fs.readFileSync(path.join(process.cwd(), rel), 'utf-8');
}

describe('ADR-0094 옵션 A — 빈스캔 포스트모템 dedupeKey 정합', () => {
  it('adaptiveScanScheduler.ts 빈스캔 포스트모템 알림은 dedupeKey + 4h cooldown 사용', () => {
    const src = readFile('server/orchestrator/adaptiveScanScheduler.ts');
    expect(src).toContain('[빈스캔 포스트모템] PATHOLOGICAL_BLOCK');

    const idx = src.indexOf('[빈스캔 포스트모템] PATHOLOGICAL_BLOCK');
    const block = src.slice(idx, idx + 1200);
    expect(block).toContain('empty_scan_pathological:');
    expect(block).toContain('cooldownMs:');
    expect(block).toContain('4 * 60 * 60 * 1000');
    // KST 일자 + 레짐 기반 dedupeKey — 레짐 전환 시 즉시 재알림 가능
    expect(block).toContain('postmortem.regime');
  });

  it('회귀 차단 — 빈스캔 포스트모템 알림 본문 + .catch 사이 dedupeKey 의무', () => {
    const src = readFile('server/orchestrator/adaptiveScanScheduler.ts');
    const idx = src.indexOf('[빈스캔 포스트모템] PATHOLOGICAL_BLOCK');
    expect(idx).toBeGreaterThan(0);
    const block = src.slice(idx, idx + 1500);
    const catchIdx = block.indexOf('.catch(');
    const callBlock = catchIdx > 0 ? block.slice(0, catchIdx) : block;
    expect(callBlock).toContain('dedupeKey');
  });
});

describe('ADR-0094 옵션 B — Watchlist 포화 알림 게이팅 정합', () => {
  it('watchlistRepo.ts 포화 알림은 momentumCount > soft.MOMENTUM 시에만 발송', () => {
    const src = readFile('server/persistence/watchlistRepo.ts');
    // 새 게이트 — alert<count<=softCap 침묵 분기 차단
    expect(src).toContain('momentumCount > soft.MOMENTUM');
    // ADR-0094 주석으로 의도 명문화
    expect(src).toContain('ADR-0094');
    // 회귀 차단 — 기존 단순 임계 비교 패턴 부재 확인
    expect(src).not.toMatch(/if\s*\(\s*momentumCount\s*>\s*MOMENTUM_ALERT_THRESHOLD\s*\)\s*{$/m);
  });

  it('buildWatchlistOverflowAlert 빌더 자체는 후방호환 (3 분기 모두 보존)', () => {
    const src = readFile('server/persistence/watchlistRepo.ts');
    // 빌더는 호출자가 어떤 count 든 받을 수 있어야 함 (테스트 / 진단 명령용)
    expect(src).toContain('soft cap 능동 정리');
    expect(src).toContain('hard cap 강제 정리');
    expect(src).toContain('능동 정리 미발동');
  });
});
