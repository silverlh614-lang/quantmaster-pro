import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

function readCommandSource(fileName: string): string {
  return fs.readFileSync(
    path.join(process.cwd(), 'server/telegram/commands/positions', fileName),
    'utf-8',
  );
}

describe('portfolio query P0 telemetry', () => {
  it('/pos emits shadow-first query and result tags', () => {
    const src = readCommandSource('pos.cmd.ts');

    expect(src).toContain('[PORTFOLIO_QUERY_SHADOW_FIRST]');
    expect(src).toContain('[PORTFOLIO_QUERY_RESULT]');
    expect(src).toContain('modePreference=SHADOW_FIRST');
    expect(src).toContain('executionImpact=NONE');
  });

  it('/pnl emits shadow-first query and result tags', () => {
    const src = readCommandSource('pnl.cmd.ts');

    expect(src).toContain('[PORTFOLIO_QUERY_SHADOW_FIRST]');
    expect(src).toContain('[PORTFOLIO_QUERY_RESULT]');
    expect(src).toContain('modePreference=SHADOW_FIRST');
    expect(src).toContain('executionImpact=NONE');
  });
});
