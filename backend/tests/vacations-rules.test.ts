import { describe, expect, it, vi } from 'vitest';

import { __vacationTestables } from '../src/routes/vacations.js';

describe('vacations rules', () => {
  it('vacationSchema rejects partial day for medical absence', () => {
    const result = __vacationTestables.vacationSchema.safeParse({
      dataInicio: '2026-04-20',
      dataFim: '2026-04-20',
      requestType: 'ABSENCE_MEDICAL',
      partialDay: 'AM',
      observacoes: '',
      attachmentLink: '',
    });

    expect(result.success).toBe(false);
  });

  it('vacationSchema rejects end date before start date', () => {
    const result = __vacationTestables.vacationSchema.safeParse({
      dataInicio: '2026-04-21',
      dataFim: '2026-04-20',
      requestType: 'VACATION',
      partialDay: 'FULL',
      observacoes: '',
      attachmentLink: '',
    });

    expect(result.success).toBe(false);
  });

  it('hasDateOverlap detects overlap correctly', () => {
    expect(__vacationTestables.hasDateOverlap('2026-04-10', '2026-04-15', '2026-04-14', '2026-04-20')).toBe(true);
    expect(__vacationTestables.hasDateOverlap('2026-04-10', '2026-04-12', '2026-04-13', '2026-04-20')).toBe(false);
  });

  it('vacationDailyWeight returns half day for AM/PM on the selected day', () => {
    expect(__vacationTestables.vacationDailyWeight({ dataInicio: '2026-04-10', partialDay: 'AM' }, '2026-04-10')).toBe(0.5);
    expect(__vacationTestables.vacationDailyWeight({ dataInicio: '2026-04-10', partialDay: 'FULL' }, '2026-04-10')).toBe(1);
  });

  it('vacationDailyWeight ignores weekend and holiday days for vacation capacity', () => {
    const holidayDates = new Set(['2026-04-21']);

    expect(__vacationTestables.vacationDailyWeight({ dataInicio: '2026-04-20', partialDay: 'FULL' }, '2026-04-18', holidayDates)).toBe(0);
    expect(__vacationTestables.vacationDailyWeight({ dataInicio: '2026-04-20', partialDay: 'FULL' }, '2026-04-21', holidayDates)).toBe(0);
    expect(__vacationTestables.vacationDailyWeight({ dataInicio: '2026-04-20', partialDay: 'FULL' }, '2026-04-22', holidayDates)).toBe(1);
  });

  it('vacationDaysForMetrics counts only business days for vacations', () => {
    const holidayDates = new Set(['2026-04-21']);

    expect(
      __vacationTestables.vacationDaysForMetrics(
        {
          requestType: 'VACATION',
          dataInicio: '2026-04-20',
          dataFim: '2026-04-22',
          partialDay: 'FULL',
        },
        holidayDates,
      ),
    ).toBe(2);
  });

  it('vacationSchema rejects vacation starting on weekend', () => {
    const result = __vacationTestables.vacationSchema.safeParse({
      dataInicio: '2026-04-18',
      dataFim: '2026-04-22',
      requestType: 'VACATION',
      partialDay: 'FULL',
      observacoes: '',
      attachmentLink: '',
    });

    expect(result.success).toBe(false);
  });

  it('vacationSchema rejects vacation ending on weekend', () => {
    const result = __vacationTestables.vacationSchema.safeParse({
      dataInicio: '2026-04-17',
      dataFim: '2026-04-19',
      requestType: 'VACATION',
      partialDay: 'FULL',
      observacoes: '',
      attachmentLink: '',
    });

    expect(result.success).toBe(false);
  });

  it('vacationSchema allows absence starting on weekend', () => {
    const result = __vacationTestables.vacationSchema.safeParse({
      dataInicio: '2026-04-18',
      dataFim: '2026-04-20',
      requestType: 'ABSENCE_MEDICAL',
      partialDay: 'FULL',
      observacoes: '',
      attachmentLink: '',
    });

    expect(result.success).toBe(true);
  });

  it('vacationSchema allows absence ending on weekend', () => {
    const result = __vacationTestables.vacationSchema.safeParse({
      dataInicio: '2026-04-17',
      dataFim: '2026-04-19',
      requestType: 'ABSENCE_TRAINING',
      partialDay: 'FULL',
      observacoes: '',
      attachmentLink: '',
    });

    expect(result.success).toBe(true);
  });

  it('vacationSchema allows medical absence longer than 3 days', () => {
    const result = __vacationTestables.vacationSchema.safeParse({
      dataInicio: '2026-04-20',
      dataFim: '2026-04-25',
      requestType: 'ABSENCE_MEDICAL',
      partialDay: 'FULL',
      observacoes: '',
      attachmentLink: '',
    });

    expect(result.success).toBe(true);
  });

  it('buildApprovalGroups creates manager then RH levels for BR', () => {
    expect(
      __vacationTestables.buildApprovalGroups({
        country: 'BR',
        primaryApproverIds: ['manager-1', 'manager-2'],
        rhApproverIds: ['rh-1'],
      }),
    ).toEqual([
      { level: 1, approverIds: ['manager-1', 'manager-2'] },
      { level: 2, approverIds: ['rh-1'] },
    ]);
  });

  it('buildApprovalGroups keeps single-level approval for PT', () => {
    expect(
      __vacationTestables.buildApprovalGroups({
        country: 'PT',
        primaryApproverIds: ['manager-1'],
        rhApproverIds: ['rh-1'],
      }),
    ).toEqual([
      { level: 1, approverIds: ['manager-1', 'rh-1'] },
    ]);
  });

  it('getPreviousApproverIdsForRejection returns prior approved level when RH rejects', () => {
    expect(
      __vacationTestables.getPreviousApproverIdsForRejection([
        { approverId: 'manager-1', approvalLevel: 1, status: 'APPROVED' },
        { approverId: 'rh-1', approvalLevel: 2, status: 'PENDING' },
      ], 'rh-1'),
    ).toEqual(['manager-1']);
  });

  it('enforceVacationBusinessDays rejects weekend start for vacation request', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => [],
      }),
    );

    await expect(
      __vacationTestables.enforceVacationBusinessDays({
        requestType: 'VACATION',
        dataInicio: '2026-04-11',
        dataFim: '2026-04-15',
        country: 'PT',
      }),
    ).rejects.toThrow('dia útil');

    await expect(
      __vacationTestables.enforceVacationBusinessDays({
        requestType: 'ABSENCE_MEDICAL',
        dataInicio: '2026-04-11',
        dataFim: '2026-04-11',
        country: 'PT',
      }),
    ).resolves.toBeUndefined();

    vi.unstubAllGlobals();
  });

  it('PT policy returns warning for vacation request shorter than 10 days when no mandatory block exists yet', async () => {
    process.env.VACATION_PT_DEADLINE_BYPASS = 'true';
    const db = {
      vacation: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    };

    const warnings = await __vacationTestables.validateVacationCountryPolicy({
      db: db as never,
      userId: 'u-1',
      country: 'PT',
      requestType: 'VACATION',
      dataInicio: '2026-04-14',
      dataFim: '2026-04-16',
      partialDay: 'FULL',
    });

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('Política PT');
    delete process.env.VACATION_PT_DEADLINE_BYPASS;
  });

  it('PT policy accepts request when there is already a 10-day block in the year', async () => {
    process.env.VACATION_PT_DEADLINE_BYPASS = 'true';
    const db = {
      vacation: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'v1', dataInicio: '2026-06-01', dataFim: '2026-06-12', partialDay: 'FULL' },
        ]),
      },
    };

    await expect(
      __vacationTestables.validateVacationCountryPolicy({
        db: db as never,
        userId: 'u-1',
        country: 'PT',
        requestType: 'VACATION',
        dataInicio: '2026-09-01',
        dataFim: '2026-09-02',
        partialDay: 'FULL',
      }),
    ).resolves.toEqual([]);
    delete process.env.VACATION_PT_DEADLINE_BYPASS;
  });

  it('BR policy rejects when resulting split exceeds 3 periods', async () => {
    const db = {
      vacation: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'v1', dataInicio: '2026-01-05', dataFim: '2026-01-16', partialDay: 'FULL', requestType: 'VACATION' },
          { id: 'v2', dataInicio: '2026-02-02', dataFim: '2026-02-13', partialDay: 'FULL', requestType: 'VACATION' },
          { id: 'v3', dataInicio: '2026-03-02', dataFim: '2026-03-13', partialDay: 'FULL', requestType: 'VACATION' },
        ]),
      },
    };

    await expect(
      __vacationTestables.validateVacationCountryPolicy({
        db: db as never,
        userId: 'u-1',
        country: 'BR',
        requestType: 'VACATION',
        dataInicio: '2026-04-13', // Monday, not after holiday
        dataFim: '2026-04-24',
        partialDay: 'FULL',
      }),
    ).rejects.toThrow('até 3 períodos');
  });

  it('BR policy rejects when all three periods are shorter than 14-day requirement', async () => {
    const db = {
      vacation: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'v1', dataInicio: '2026-01-05', dataFim: '2026-01-09', partialDay: 'FULL', requestType: 'VACATION' },
          { id: 'v2', dataInicio: '2026-02-02', dataFim: '2026-02-06', partialDay: 'FULL', requestType: 'VACATION' },
        ]),
      },
    };

    await expect(
      __vacationTestables.validateVacationCountryPolicy({
        db: db as never,
        userId: 'u-1',
        country: 'BR',
        requestType: 'VACATION',
        dataInicio: '2026-03-02', // Monday
        dataFim: '2026-03-06',
        partialDay: 'FULL',
      }),
    ).rejects.toThrow('14 dias');
  });

  // ─── Phase 2B: PT 1st-year proportional cap ───────────────────────────────

  it('Phase 2B: PT 1st-year proportional cap - blocks if total exceeds earned days', async () => {
    process.env.VACATION_PT_DEADLINE_BYPASS = 'true';
    const contractIso = '2026-11-01';
    const db = {
      vacation: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    };

    // Contrato em novembro de 2026 => proporcional do 1.º ano = 4 dias (nov+dez)
    await expect(
      __vacationTestables.validateVacationCountryPolicy({
        db: db as never,
        userId: 'u-1',
        country: 'PT',
        requestType: 'VACATION',
        dataInicio: '2026-12-01',
        dataFim: '2026-12-12',
        partialDay: 'FULL',
        dataInicioContrato: contractIso,
      }),
    ).rejects.toThrow('2 dias por mês do 1.º ano');

    delete process.env.VACATION_PT_DEADLINE_BYPASS;
  });

  it('Phase 2B: PT 1st-year proportional cap - allows within earned days', async () => {
    process.env.VACATION_PT_DEADLINE_BYPASS = 'true';
    const now = new Date();
    const contractDate = new Date(now.getFullYear(), now.getMonth() - 3, 1); // ~3 completed months => 6 earned days
    const contractIso = `${contractDate.getFullYear()}-${String(contractDate.getMonth() + 1).padStart(2, '0')}-${String(contractDate.getDate()).padStart(2, '0')}`;
    const db = {
      vacation: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    };

    // 5 business days is within earned entitlement (~6 days)
    const result = await __vacationTestables.validateVacationCountryPolicy({
      db: db as never,
      userId: 'u-1',
      country: 'PT',
      requestType: 'VACATION',
      dataInicio: '2026-06-01',
      dataFim: '2026-06-05',
      partialDay: 'FULL',
      dataInicioContrato: contractIso,
    });

    expect(Array.isArray(result)).toBe(true);
    delete process.env.VACATION_PT_DEADLINE_BYPASS;
  });

  it('PT 30/04 blocker applies to current year after deadline', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-05-07T12:00:00.000Z'));
      delete process.env.VACATION_PT_DEADLINE_BYPASS;

      const db = {
        vacation: {
          findMany: vi.fn().mockResolvedValue([]),
        },
      };

      await expect(
        __vacationTestables.validateVacationCountryPolicy({
          db: db as never,
          userId: 'u-1',
          country: 'PT',
          requestType: 'VACATION',
          dataInicio: '2026-05-07',
          dataFim: '2026-05-07',
          partialDay: 'AM',
        }),
      ).rejects.toThrow('após 30 de abril');
    } finally {
      vi.useRealTimers();
    }
  });

  it('PT 30/04 blocker does not block next year requests', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-05-07T12:00:00.000Z'));
      delete process.env.VACATION_PT_DEADLINE_BYPASS;

      const db = {
        vacation: {
          findMany: vi.fn().mockResolvedValue([]),
        },
      };

      const result = await __vacationTestables.validateVacationCountryPolicy({
        db: db as never,
        userId: 'u-1',
        country: 'PT',
        requestType: 'VACATION',
        dataInicio: '2027-05-07',
        dataFim: '2027-05-07',
        partialDay: 'AM',
      });

      expect(Array.isArray(result)).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  // ─── Phase 2C: BR weekday blocker (quinta/sexta) ──────────────────────────

  it('Phase 2C: BR rejects vacation starting on Thursday', async () => {
    const db = { vacation: { findMany: vi.fn().mockResolvedValue([]) } };

    // 2026-06-04 is a Thursday
    await expect(
      __vacationTestables.validateVacationCountryPolicy({
        db: db as never,
        userId: 'u-1',
        country: 'BR',
        requestType: 'VACATION',
        dataInicio: '2026-06-04',
        dataFim: '2026-06-12',
        partialDay: 'FULL',
      }),
    ).rejects.toThrow('quinta-feira');
  });

  it('Phase 2C: BR allows vacation starting on Wednesday', async () => {
    const db = { vacation: { findMany: vi.fn().mockResolvedValue([]) } };

    // 2026-06-03 is a Wednesday
    const result = await __vacationTestables.validateVacationCountryPolicy({
      db: db as never,
      userId: 'u-1',
      country: 'BR',
      requestType: 'VACATION',
      dataInicio: '2026-06-03',
      dataFim: '2026-06-19',
      partialDay: 'FULL',
    });

    expect(Array.isArray(result)).toBe(true);
  });

  it('Phase 2C: BR allows vacation starting on Monday', async () => {
    const db = { vacation: { findMany: vi.fn().mockResolvedValue([]) } };

    // 2026-06-01 is a Monday - 14 business days Mon–Fri (two full weeks Mon–Fri)
    const result = await __vacationTestables.validateVacationCountryPolicy({
      db: db as never,
      userId: 'u-1',
      country: 'BR',
      requestType: 'VACATION',
      dataInicio: '2026-06-01',
      dataFim: '2026-06-19',
      partialDay: 'FULL',
    });

    expect(Array.isArray(result)).toBe(true);
  });

  it('Phase 2C: BR rejects vacation starting on Friday', async () => {
    const db = { vacation: { findMany: vi.fn().mockResolvedValue([]) } };

    // 2026-06-05 is a Friday
    await expect(
      __vacationTestables.validateVacationCountryPolicy({
        db: db as never,
        userId: 'u-1',
        country: 'BR',
        requestType: 'VACATION',
        dataInicio: '2026-06-05',
        dataFim: '2026-06-19',
        partialDay: 'FULL',
      }),
    ).rejects.toThrow('sexta-feira');

    expect(db.vacation.findMany).toHaveBeenCalledTimes(1);
  });

  it('Phase 2C: BR intern blocks vacation before completing 12 months', async () => {
    const db = { vacation: { findMany: vi.fn().mockResolvedValue([]) } };
    const now = new Date();
    const contractDate = new Date(now.getFullYear(), now.getMonth() - 6, 1);
    const contractIso = `${contractDate.getFullYear()}-${String(contractDate.getMonth() + 1).padStart(2, '0')}-${String(contractDate.getDate()).padStart(2, '0')}`;

    await expect(
      __vacationTestables.validateVacationCountryPolicy({
        db: db as never,
        userId: 'u-1',
        country: 'BR',
        requestType: 'VACATION',
        dataInicio: '2026-06-01',
        dataFim: '2026-06-19',
        partialDay: 'FULL',
        isIntern: true,
        dataInicioContrato: contractIso,
      }),
    ).rejects.toThrow('12 meses completos');
  });

  it('Phase 2C: BR concessivo blocks request with less than 30 days remaining', async () => {
    const db = { vacation: { findMany: vi.fn().mockResolvedValue([]) } };
    const now = new Date();
    const nearAnniversary = new Date(now);
    nearAnniversary.setDate(now.getDate() + 15);
    const contractIso = `2020-${String(nearAnniversary.getMonth() + 1).padStart(2, '0')}-${String(nearAnniversary.getDate()).padStart(2, '0')}`;

    await expect(
      __vacationTestables.validateVacationCountryPolicy({
        db: db as never,
        userId: 'u-1',
        country: 'BR',
        requestType: 'VACATION',
        dataInicio: '2026-06-01',
        dataFim: '2026-06-19',
        partialDay: 'FULL',
        dataInicioContrato: contractIso,
      }),
    ).rejects.toThrow('antecedência mínima de 30 dias');
  });
});
