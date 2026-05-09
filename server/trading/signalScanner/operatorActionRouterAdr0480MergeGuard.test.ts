import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ADR_0480_FILES = [
  'docs/adr/0480-operator-action-router-remediation-queue.md',
  'docs/adr/INDEX.md',
  'server/diagnostics/runtimePipelineAudit.ts',
  'server/telegram/commands/system/operatorActions.cmd.ts',
  'server/telegram/commands/system/scanBlockers.cmd.ts',
  'server/trading/signalScanner/operatorActionRouterAdr0480.ts',
  'server/trading/signalScanner/operatorActionRouterAdr0480.test.ts',
] as const;

const CONFLICT_MARKER_RE = /^(<<<<<<<|=======|>>>>>>>)\s/m;

describe('ADR-0480 merge conflict guard', () => {
  it.each(ADR_0480_FILES)('%s has no unresolved merge conflict markers', (file) => {
    const src = fs.readFileSync(path.resolve(file), 'utf-8');
    expect(src).not.toMatch(CONFLICT_MARKER_RE);
  });
});
