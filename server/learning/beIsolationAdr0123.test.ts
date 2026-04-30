/**
 * @responsibility ADR-0123 학습/리포트 BE 격리 회귀 테스트
 *
 * 사용자 4/30 보고: "학습 및 보고 리포트에 본절은 손절로 기록하고 학습하지 말것,
 * 데이터 오염발생함". ADR-0112 classifyFillOutcome SSOT 를 nightlyReflectionEngine
 * + biasHeatmap 의 fill 분류에 wiring.
 *
 * 임계 (ADR-0112 정합):
 * - WIN: pnlPct ≥ +1.0%
 * - BE:  -0.5% ≤ pnlPct ≤ +0.5%
 * - LOSS: pnlPct ≤ -0.5%
 * - +0.5 < pnlPct < +1.0 → BE (보수적 fallback)
 */

import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

describe('ADR-0123 nightlyReflectionEngine — BE 격리 wiring', () => {
  const sourcePath = path.resolve(__dirname, 'nightlyReflectionEngine.ts');
  const source = fs.readFileSync(sourcePath, 'utf-8');

  it('TodaysRealizationSummary 인터페이스에 beFills? 옵셔널 필드 추가', () => {
    expect(source).toMatch(/beFills\?\s*:\s*number/);
  });

  it('ADR-0123 주석 명시 (사용자 보고 정합)', () => {
    expect(source).toMatch(/ADR-0123.*사용자.*보고/);
    expect(source).toMatch(/본절.*손절\/이익으로 분류 안 함/);
  });

  it('classifyFill 헬퍼 — pnlPct 비율 기반 분류 (ADR-0112 정합)', () => {
    expect(source).toMatch(/classifyFill/);
    // WIN ≥ +1.0
    expect(source).toMatch(/pct >= 1\.0.*WIN/);
    // BE -0.5 ~ +0.5
    expect(source).toMatch(/pct >= -0\.5.*pct <= 0\.5.*BE/);
    // LOSS ≤ -0.5
    expect(source).toMatch(/pct <= -0\.5.*LOSS/);
  });

  it('summarizeTodaysRealizationsForLearning 가 beFills 영속', () => {
    // 함수 본체에 beFills 누적 + return 반환
    expect(source).toMatch(/let beFills\s*=\s*0/);
    expect(source).toMatch(/beFills\+\+/);
    expect(source).toMatch(/beFills,?\s*\/\/.*ADR-0123/);
  });

  it('절대값 fallback 보존 (pnlPct 부재 시 후방호환)', () => {
    expect(source).toMatch(/pnlPct 부재 시.*절대값 fallback/);
    // f.pnl > 0 → WIN, f.pnl < 0 → LOSS
    expect(source).toMatch(/f\.pnl.*\?\?\s*0\)\s*>\s*0.*WIN/);
    expect(source).toMatch(/f\.pnl.*\?\?\s*0\)\s*<\s*0.*LOSS/);
  });
});

describe('ADR-0123 biasHeatmap — BE 격리 wiring (lossAversion 편향)', () => {
  const sourcePath = path.resolve(__dirname, 'reflectionModules', 'biasHeatmap.ts');
  const source = fs.readFileSync(sourcePath, 'utf-8');

  it('scoreLossAversion 가 ADR-0112 classifyFill 헬퍼 사용', () => {
    expect(source).toMatch(/ADR-0123.*사용자.*보고/);
    expect(source).toMatch(/classifyFill/);
  });

  it('BE 분기 명시 (lossAversion 편향에 미카운트)', () => {
    expect(source).toMatch(/BE.*lossAversion.*편향.*미카운트/);
  });

  it('classifyFill — pnlPct 비율 기반 분류', () => {
    expect(source).toMatch(/pct >= 1\.0.*WIN/);
    expect(source).toMatch(/pct >= -0\.5.*pct <= 0\.5.*BE/);
    expect(source).toMatch(/pct <= -0\.5.*LOSS/);
  });

  it('절대값 fallback 보존 (회귀 호환)', () => {
    expect(source).toMatch(/f\.pnl.*\?\?\s*0\)\s*>\s*0.*WIN/);
    expect(source).toMatch(/f\.pnl.*\?\?\s*0\)\s*<\s*0.*LOSS/);
  });

  it('두 fill 루프 모두 classifyFill 통과 (전량 + 부분매도)', () => {
    const matches = source.match(/const outcome = classifyFill\(f\);/g);
    expect(matches).toBeDefined();
    expect(matches!.length).toBeGreaterThanOrEqual(2);
  });
});
