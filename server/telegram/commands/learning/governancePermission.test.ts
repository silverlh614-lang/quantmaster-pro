import { describe, expect, it } from 'vitest';
import { resolveGovernancePermission } from './governance.cmd.js';

describe('ADR-0525 governance permissions', () => {
  it('allows read for everyone and rejects unauthorized approval/apply actors', () => {
    expect(resolveGovernancePermission({ userId: 'guest' }, 'read')).toBe(true);
    expect(resolveGovernancePermission({ userId: 'guest' }, 'approve')).toBe(false);
    expect(resolveGovernancePermission({ userId: 'operator' }, 'approve')).toBe(true);
    expect(resolveGovernancePermission({ userId: 'operator' }, 'apply_draft')).toBe(false);
    expect(resolveGovernancePermission({ userId: 'admin' }, 'apply_draft')).toBe(true);
  });
});
