import { describe, expect, it } from 'vitest';
import { renderPlaybook } from './regimePlaybook.js';

describe('Simplification Step 8 regime playbook display text', () => {
  it('renders R6 as score/position context without legacy block or Kelly wording', () => {
    const text = renderPlaybook('R6_DEFENSE');

    expect(text).toContain('regimeAdjustment: -5');
    expect(text).toContain('executionImpact=NONE');
    expect(text).not.toContain('Kelly');
    expect(text).not.toContain('STRONG_BUY');
    expect(text).not.toContain(['신규 진입', '차단'].join(' '));
    expect(text).not.toContain('블랙스완 감지');
  });
});
