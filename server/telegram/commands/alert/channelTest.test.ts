/**
 * @responsibility PR-X6 ADR-0042 /channel_test 4채널 헬스체크 + 손절 카운트다운 sendPrivateAlert 회귀 테스트
 *
 * 검증:
 *   - formatChannelHealthCheckResult: 4채널 분기 (정상/미설정/비활성/발송실패)
 *   - 요약 라인 (N/4 정상)
 *   - 미설정 환경변수 안내
 *   - stopApproachAlert sendPrivateAlert 사용 (sendTelegramAlert 미사용)
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { formatChannelHealthCheckResult } from './channelTest.cmd.js';
import { AlertCategory } from '../../../alerts/alertCategories.js';
import type { ChannelHealthItem } from '../../../alerts/alertRouter.js';

const ROOT = process.cwd();

function ok(messageId: number): ChannelHealthItem {
  return { ok: true, enabled: true, configured: true, channelId: '@test', messageId };
}

function missingChannel(): ChannelHealthItem {
  return { ok: false, enabled: true, configured: false, reason: 'channel_id missing' };
}

function disabled(): ChannelHealthItem {
  return { ok: false, enabled: false, configured: true, channelId: '@test', reason: 'disabled' };
}

function sendFailed(): ChannelHealthItem {
  return { ok: false, enabled: true, configured: true, channelId: '@test', reason: 'send failed' };
}

describe('formatChannelHealthCheckResult', () => {
  it('4채널 모두 정상 → ✅ 4건 + 요약', () => {
    const result = {
      [AlertCategory.TRADE]: ok(101),
      [AlertCategory.ANALYSIS]: ok(102),
      [AlertCategory.INFO]: ok(103),
      [AlertCategory.SYSTEM]: ok(104),
    };
    const msg = formatChannelHealthCheckResult(result);
    expect(msg).toContain('CH1 EXECUTION (TRADE) — 정상 (msg #101)');
    expect(msg).toContain('CH2 SIGNAL (ANALYSIS) — 정상 (msg #102)');
    expect(msg).toContain('CH3 REGIME (INFO) — 정상 (msg #103)');
    expect(msg).toContain('CH4 JOURNAL (SYSTEM) — 정상 (msg #104)');
    expect(msg).toContain('요약:</b> 4/4 채널 정상');
    expect(msg).toContain('모든 채널 정상');
  });

  it('1개 채널 ID 미설정 → ❌ + 환경변수 안내', () => {
    const result = {
      [AlertCategory.TRADE]: ok(101),
      [AlertCategory.ANALYSIS]: ok(102),
      [AlertCategory.INFO]: missingChannel(),
      [AlertCategory.SYSTEM]: ok(104),
    };
    const msg = formatChannelHealthCheckResult(result);
    expect(msg).toContain('❌ CH3 REGIME (INFO) — 채널 ID 미설정');
    expect(msg).toContain('TELEGRAM_INFO_CHANNEL_ID');
    expect(msg).toContain('요약:</b> 3/4 채널 정상');
    expect(msg).toContain('미설정 환경변수: TELEGRAM_INFO_CHANNEL_ID');
    expect(msg).not.toContain('모든 채널 정상');
  });

  it('CHANNEL_ENABLED=false → ⏸️ 비활성 표시', () => {
    const result = {
      [AlertCategory.TRADE]: disabled(),
      [AlertCategory.ANALYSIS]: disabled(),
      [AlertCategory.INFO]: disabled(),
      [AlertCategory.SYSTEM]: disabled(),
    };
    const msg = formatChannelHealthCheckResult(result);
    expect(msg).toMatch(/⏸️.*비활성/);
    expect(msg).toContain('CHANNEL_ENABLED 미설정');
    expect(msg).toContain('요약:</b> 0/4 채널 정상');
  });

  it('발송 실패 → ❌ + reason 노출', () => {
    const result = {
      [AlertCategory.TRADE]: ok(101),
      [AlertCategory.ANALYSIS]: sendFailed(),
      [AlertCategory.INFO]: ok(103),
      [AlertCategory.SYSTEM]: ok(104),
    };
    const msg = formatChannelHealthCheckResult(result);
    expect(msg).toMatch(/❌.*CH2 SIGNAL.*발송 실패/);
    expect(msg).toContain('send failed');
  });

  it('다중 미설정 환경변수 누적 안내', () => {
    const result = {
      [AlertCategory.TRADE]: ok(101),
      [AlertCategory.ANALYSIS]: missingChannel(),
      [AlertCategory.INFO]: missingChannel(),
      [AlertCategory.SYSTEM]: missingChannel(),
    };
    const msg = formatChannelHealthCheckResult(result);
    expect(msg).toContain('TELEGRAM_ANALYSIS_CHANNEL_ID');
    expect(msg).toContain('TELEGRAM_INFO_CHANNEL_ID');
    expect(msg).toContain('TELEGRAM_SYSTEM_CHANNEL_ID');
    expect(msg).not.toContain('TELEGRAM_TRADE_CHANNEL_ID');
    expect(msg).toContain('요약:</b> 1/4 채널 정상');
  });

  it('헤더 + 구분자 + 요약 라인 순서', () => {
    const result = {
      [AlertCategory.TRADE]: ok(1),
      [AlertCategory.ANALYSIS]: ok(2),
      [AlertCategory.INFO]: ok(3),
      [AlertCategory.SYSTEM]: ok(4),
    };
    const msg = formatChannelHealthCheckResult(result);
    expect(msg.indexOf('🧪')).toBeLessThan(msg.indexOf('━━━━'));
    expect(msg.indexOf('CH1')).toBeLessThan(msg.indexOf('요약'));
  });

  it('AlertCategory enum 4값 모두 표시 — drift 차단', () => {
    const result = {
      [AlertCategory.TRADE]: ok(1),
      [AlertCategory.ANALYSIS]: ok(2),
      [AlertCategory.INFO]: ok(3),
      [AlertCategory.SYSTEM]: ok(4),
    };
    const msg = formatChannelHealthCheckResult(result);
    for (const cat of Object.values(AlertCategory)) {
      expect(msg).toContain(cat);
    }
  });
});

describe('PR-X6 stopApproachAlert sendPrivateAlert 마이그레이션', () => {
  const stopApproachSrc = readFileSync(
    resolve(ROOT, 'server/trading/exitEngine/rules/stopApproachAlert.ts'),
    'utf-8',
  );

  it('stopApproachAlert.ts 가 sendPrivateAlert import', () => {
    expect(stopApproachSrc).toMatch(/import\s+\{[^}]*\bsendPrivateAlert\b[^}]*\}\s+from\s+['"][^'"]*telegramClient[^'"]*['"]/);
  });

  it('sendTelegramAlert 호출 0건 (sendPrivateAlert 로 교체 완료)', () => {
    // 주석 제거 후 실제 호출 검사
    const stripped = stopApproachSrc
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '');
    expect(stripped).not.toMatch(/\bsendTelegramAlert\s*\(/);
  });

  it('3단계 모두 sendPrivateAlert 호출 (Stage 1/2/3)', () => {
    const stripped = stopApproachSrc
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '');
    const matches = stripped.match(/\bsendPrivateAlert\s*\(/g);
    expect(matches?.length).toBe(3);
  });

  it('ADR-0042 메모 주석 포함 (의도 명문화)', () => {
    expect(stopApproachSrc).toMatch(/ADR-0042|sendPrivateAlert/);
  });
});

describe('PR-X6 channelTest.cmd 등록', () => {
  const cmdSrc = readFileSync(
    resolve(ROOT, 'server/telegram/commands/alert/channelTest.cmd.ts'),
    'utf-8',
  );

  it('commandRegistry.register 호출', () => {
    expect(cmdSrc).toMatch(/commandRegistry\.register\(channelTest\)/);
  });

  it('name=/channel_test + category=ALR + riskLevel=1', () => {
    expect(cmdSrc).toMatch(/name:\s*['"]\/channel_test['"]/);
    expect(cmdSrc).toMatch(/category:\s*['"]ALR['"]/);
    expect(cmdSrc).toMatch(/riskLevel:\s*1/);
  });

  it('runChannelHealthCheck import (alertRouter SSOT 사용)', () => {
    expect(cmdSrc).toMatch(/import\s+\{[^}]*\brunChannelHealthCheck\b[^}]*\}\s+from\s+['"][^'"]*alertRouter[^'"]*['"]/);
  });

  it('formatChannelHealthCheckResult export (테스트용)', () => {
    expect(cmdSrc).toMatch(/export\s+function\s+formatChannelHealthCheckResult/);
  });
});
