/**
 * safetyGatePolicy.cmd.test.ts — 관측 전용 명령 메타 + 안전 렌더 회귀.
 */
import { describe, it, expect, afterEach } from 'vitest';
import safetyGatePolicy from './safetyGatePolicy.cmd.js';

const ENV_KEY = 'SAFETY_GATE_POLICY_FEEDBACK_ENABLED';

async function run(): Promise<string> {
  const replies: string[] = [];
  await safetyGatePolicy.execute({
    args: [],
    reply: async (m: string) => { replies.push(m); },
  } as never);
  expect(replies.length).toBe(1);
  return replies[0];
}

describe('/safety_gate_policy — 관측 전용 표면', () => {
  afterEach(() => {
    delete process.env[ENV_KEY];
  });

  it('명령 메타 — LRN·read-only(riskLevel 0)', () => {
    expect(safetyGatePolicy.name).toBe('/safety_gate_policy');
    expect(safetyGatePolicy.category).toBe('LRN');
    expect(safetyGatePolicy.riskLevel).toBe(0);
  });

  it('ENV OFF(기본) → preview 표기 + 실제 미적용 명시', async () => {
    delete process.env[ENV_KEY];
    const msg = await run();
    expect(msg).toContain('SAFETY_GATE_POLICY_FEEDBACK_ENABLED: OFF');
    // 관측 전용 — 실제 사이징 적용이 없음을 반드시 밝힌다.
    expect(msg).toContain('실제 사이징 적용: NO');
    expect(msg).toContain('preview');
  });

  it('ENV ON → preview 문구 없이 적용 상태 표기 (표본 부재여도 throw 0)', async () => {
    process.env[ENV_KEY] = 'true';
    const msg = await run();
    expect(msg).toContain('SAFETY_GATE_POLICY_FEEDBACK_ENABLED: ON');
    expect(msg).not.toContain('(preview');
  });
});
