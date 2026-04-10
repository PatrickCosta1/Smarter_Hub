import { describe, expect, it } from 'vitest';

import { __permissionsTestables } from '../src/routes/permissions.js';

describe('permissions route schemas', () => {
  it('permissionAssignmentSchema requires permissionId or permissionCode', () => {
    const result = __permissionsTestables.permissionAssignmentSchema.safeParse({
      notes: 'x',
    });

    expect(result.success).toBe(false);
  });

  it('permissionAssignmentSchema accepts permissionCode and defaults isEnabled=true', () => {
    const result = __permissionsTestables.permissionAssignmentSchema.safeParse({
      permissionCode: 'view_profile',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.isEnabled).toBe(true);
    }
  });

  it('accessTotalSchema enforces boolean isEnabled', () => {
    const ok = __permissionsTestables.accessTotalSchema.safeParse({ isEnabled: true });
    const fail = __permissionsTestables.accessTotalSchema.safeParse({});

    expect(ok.success).toBe(true);
    expect(fail.success).toBe(false);
  });
});
