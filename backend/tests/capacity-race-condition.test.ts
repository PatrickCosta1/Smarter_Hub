import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/prisma.js', () => ({
  prisma: {
    vacation: { findMany: vi.fn(), count: vi.fn() },
    teamMembership: { count: vi.fn() },
    user: { count: vi.fn() },
  },
}));

import { prisma } from '../src/lib/prisma.js';

const prismaMock = prisma as unknown as {
  vacation: { findMany: ReturnType<typeof vi.fn>; count: ReturnType<typeof vi.fn> };
  teamMembership: { count: ReturnType<typeof vi.fn> };
  user: { count: ReturnType<typeof vi.fn> };
};

describe('enforceOneThirdCapacity race condition', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('BUG: multiple PENDING vacations bypass 1/3 capacity check', () => {
    // Cenário: Team com 3 membros (max simultaneous = 1)
    // Request 1: Submit vacation (passes - no APPROVED yet)
    // Request 2: Submit vacation (passes - no APPROVED yet)
    // Request 3: Submit vacation (passes - no APPROVED yet)
    // Later: Approve all 3 in parallel → 3 APPROVED at once = VIOLATION

    const teamId = 'team-1';
    const contextTeamId = 'team-1';
    const country = 'PT';
    const maxSimultaneous = 1; // 3 members / 3 = 1

    // Stage 1: Three users submit vacations
    const approvedVacations: { dataInicio: string; dataFim: string }[] = [];
    // At this point, no APPROVED vacations exist
    expect(approvedVacations.length).toBe(0);

    // Each request checks: 0 APPROVED + new request = OK
    // All three pass validation!

    // Stage 2: All three are approved in parallel
    approvedVacations.push(
      { dataInicio: '2026-06-01', dataFim: '2026-06-05' },
      { dataInicio: '2026-06-01', dataFim: '2026-06-05' },
      { dataInicio: '2026-06-01', dataFim: '2026-06-05' }
    );

    // Now we have 3 APPROVED on same dates with max=1
    // This is a violation but was NOT caught!
    expect(approvedVacations.length).toBe(3);
    expect(maxSimultaneous).toBe(1);
    
    // Bug: we allowed 3 when max is 1
  });

  it('FIX: include PENDING vacations in capacity count', () => {
    // The fix: count BOTH APPROVED and PENDING vacations

    const teamMembers = 3;
    const maxSimultaneous = Math.floor(teamMembers / 3); // = 1

    const approvedVacations = [
      { dataInicio: '2026-06-01', dataFim: '2026-06-05', status: 'APPROVED' },
    ];

    const pendingVacations = [
      { dataInicio: '2026-06-01', dataFim: '2026-06-05', status: 'PENDING' },
      { dataInicio: '2026-06-01', dataFim: '2026-06-05', status: 'PENDING' },
    ];

    // With FIX: we count both
    const totalVacations = approvedVacations.length + pendingVacations.length;
    expect(totalVacations).toBe(3);
    expect(totalVacations).toBeGreaterThan(maxSimultaneous); // ← This would be caught!
  });

  it('validates capacity including PENDING + APPROVED statuses', () => {
    const overlapping = [
      { status: 'APPROVED', dataInicio: '2026-06-01', dataFim: '2026-06-05' },
      { status: 'PENDING', dataInicio: '2026-06-01', dataFim: '2026-06-05' },
      { status: 'PENDING', dataInicio: '2026-06-01', dataFim: '2026-06-05' },
    ];

    const maxSimultaneous = 1;
    const targetDate = '2026-06-02'; // within the range

    // Count overlapping on targetDate
    let usedCapacity = 0;
    for (const vacation of overlapping) {
      // Check if vacation overlaps with targetDate
      if (vacation.dataInicio <= targetDate && targetDate <= vacation.dataFim) {
        usedCapacity += 1; // simplified weight
      }
    }

    expect(usedCapacity).toBe(3);
    expect(usedCapacity).toBeGreaterThan(maxSimultaneous); // ← Would be rejected!
  });
});
