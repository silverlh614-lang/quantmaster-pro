/**
 * @responsibility ADR-0122 SELL_ONLY 시간 조정 (14:55 → 15:00 KST) 회귀 테스트
 *
 * 사용자 보고 4/30: "SELL_ONLY 는 15시부터" — 14:55 부터 SELL_ONLY 적용은
 * 5분 일찍 시작하는 결함. KRX 정규 매매 14:30~15:20, 동시호가 15:20~15:30.
 * 15:00 부터 SELL_ONLY 적용으로 마감 30분 전 신규 진입 차단 의도 정합.
 */

import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

describe('ADR-0122 SELL_ONLY 시간 조정 — 14:55 → 15:00 KST', () => {
  const sourcePath = path.resolve(__dirname, 'adaptiveScanScheduler.ts');
  const source = fs.readFileSync(sourcePath, 'utf-8');

  it('14:55 마감동시호가 분기 → 15:00 분기로 변경 (소스 검증)', () => {
    // 1455 임계값 회귀 차단 — 사용자 보고 정합
    expect(source).not.toMatch(/t < 1455.*마감전.*급변/);
    expect(source).toMatch(/t < 1500.*마감전.*급변/);
  });

  it('SELL_ONLY 시작 임계 1500 (15:00 KST) 사용', () => {
    // else 분기 (마감 SELL_ONLY) 전에 t < 1500 이 있어야 함
    expect(source).toMatch(/else if \(t < 1500\)/);
  });

  it('SELL_ONLY phase 라벨 — "마감(SELL_ONLY)" 정합', () => {
    expect(source).toMatch(/마감\(SELL_ONLY\)/);
  });

  it('ADR-0122 주석 — legacy 분기 정합 보존 (ADR-0192 갱신 후)', () => {
    // ADR-0192 (2026-05-06) 가 phase 분기를 useLegacy 분기 안으로 이동.
    // ADR-0122 정책 자체는 보존 (legacy 분기 = 14:55→15:00 의도 그대로).
    expect(source).toMatch(/ADR-0122/);
  });

  it('점심 SELL_ONLY 11:30~13:00 보존 (legacy 분기, ADR-0192 호환)', () => {
    // ADR-0192 (2026-05-06): 신규 정책은 12:00~13:00 점심, legacy 분기는 11:30~13:00 보존.
    expect(source).toMatch(/t < 1130/);
    expect(source).toMatch(/t < 1300/);
    expect(source).toMatch(/점심\(SELL_ONLY\)/);
  });

  it('forceSellOnly 토글 분기 — legacy 2 (점심+마감) + ADR-0192 신규 3 (시초가+점심+마감) = 5', () => {
    // ADR-0122 (2026-04-30): 점심 + 마감 SELL_ONLY = 2개
    // ADR-0192 (2026-05-06): 신규 시초가(09:00~09:30) + 점심(12:00~13:00) + 마감(15:00~) = 3개 추가
    // legacy 분기 보존 (TRADE_WINDOW_LEGACY_HOURS=true 시 ADR-0122 동작 복원).
    const matches = source.match(/forceSellOnly = true/g);
    expect(matches).toBeDefined();
    expect(matches!.length).toBe(5);
  });
});
