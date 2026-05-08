import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const src = fs.readFileSync(path.resolve('server/telegram/commands/system/scanBlockers.cmd.ts'), 'utf-8');

describe('ADR-461 /scan_blockers wiring', () => {
  it('/scan_blockers에 Runtime Pipeline Audit 섹션 추가', () => {
    expect(src).toContain('buildRuntimePipelineAuditSnapshot');
    expect(src).toContain('formatRuntimePipelineAuditSection');
    expect(src).toContain('runtimeAuditSection');
  });

  it('ENV disabled 시 출력 skip wiring', () => {
    expect(src).toContain('isRuntimePipelineAuditDisabled');
    expect(src).toContain('!isRuntimePipelineAuditDisabled()');
  });
});
