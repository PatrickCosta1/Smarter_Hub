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
    ).rejects.toThrow('não pode começar ao fim de semana');

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
  });

  it('PT policy accepts request when there is already a 10-day block in the year', async () => {
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
    ).rejects.toThrow('no máximo, 3 períodos');
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

  // ─── Phase 2B: PT 1st-year cap ────────────────────────────────────────────

  it('Phase 2B: PT 1st-year cap — blocks if total would exceed 20 days', async () => {
    process.env.VACATION_PT_DEADLINE_BYPASS = 'true';
    const contractYear = 2026;
    const db = {
      vacation: {
        // Already has ~18 business days (4 full weeks Mon-Fri)
        findMany: vi.fn().mockResolvedValue([
          { dataInicio: '2026-06-01', dataFim: '2026-06-26', partialDay: 'FULL', requestType: 'VACATION' },
        ]),
      },
    };

    // Adding 5 more days would exceed 20 total
    await expect(
      __vacationTestables.validateVacationCountryPolicy({
        db: db as never,
        userId: 'u-1',
        country: 'PT',
        requestType: 'VACATION',
        dataInicio: '2026-07-01',
        dataFim: '2026-07-07',
        partialDay: 'FULL',
        dataInicioContrato: `${contractYear}-03-01`, // hired after Jan 1 same year → first year
      }),
    ).rejects.toThrow('1.º ano de contrato');

    delete process.env.VACATION_PT_DEADLINE_BYPASS;
  });

  it('Phase 2B: PT 1st-year cap — allows if total stays within 20 days', async () => {
    process.env.VACATION_PT_DEADLINE_BYPASS = 'true';
    const contractYear = 2026;
    const db = {
      vacation: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    };

    // 10 business days (Mon-Fri 2 weeks) is within limit
    const result = await __vacationTestables.validateVacationCountryPolicy({
      db: db as never,
      userId: 'u-1',
      country: 'PT',
      requestType: 'VACATION',
      dataInicio: '2026-06-01',
      dataFim: '2026-06-12',
      partialDay: 'FULL',
      dataInicioContrato: `${contractYear}-03-01`,
    });

    expect(Array.isArray(result)).toBe(true);
    delete process.env.VACATION_PT_DEADLINE_BYPASS;
  });

  // ─── Phase 2C: BR Wednesday blocker ───────────────────────────────────────

  it('Phase 2C: BR rejects vacation starting on Wednesday', async () => {
    const db = { vacation: { findMany: vi.fn().mockResolvedValue([]) } };

    // 2026-06-03 is a Wednesday
    await expect(
      __vacationTestables.validateVacationCountryPolicy({
        db: db as never,
        userId: 'u-1',
        country: 'BR',
        requestType: 'VACATION',
        dataInicio: '2026-06-03',
        dataFim: '2026-06-12',
        partialDay: 'FULL',
      }),
    ).rejects.toThrow('quarta-feira');
  });

  it('Phase 2C: BR allows vacation starting on Monday', async () => {
    const db = { vacation: { findMany: vi.fn().mockResolvedValue([]) } };

    // 2026-06-01 is a Monday — 14 business days Mon–Fri (two full weeks Mon–Fri)
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

  // ─── Phase 2C: BR Estagiário Recesso helpers ──────────────────────────────

  it('Phase 2C: getBrRecessoPeriods returns two periods per year', () => {
    const periods = __vacationTestables.getBrRecessoPeriods(2026);
    expect(periods).toHaveLength(2);
    expect(periods[0]).toEqual({ start: '2025-12-24', end: '2026-01-01' });
    expect(periods[1]).toEqual({ start: '2026-12-24', end: '2027-01-01' });
  });

  it('Phase 2C: calcBrInternEffectiveDays excludes recesso days', () => {
    // Dec 24–31 are recesso, Jan 1 too; should be 0 effective days
    const effectiveDays = __vacationTestables.calcBrInternEffectiveDays('2026-12-24', '2026-12-31');
    expect(effectiveDays).toBe(0);
  });

  it('Phase 2C: calcBrInternEffectiveDays counts normal business days outside recesso', () => {
    // 2026-06-01 to 2026-06-05: Mon–Fri = 5 business days, no recesso
    const effectiveDays = __vacationTestables.calcBrInternEffectiveDays('2026-06-01', '2026-06-05');
    expect(effectiveDays).toBe(5);
  });
});
