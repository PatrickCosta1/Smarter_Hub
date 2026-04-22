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

  it('enforceVacationBusinessDays accepts weekend vacation request', async () => {
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
          { id: 'v1', dataInicio: '2026-01-03', dataFim: '2026-01-16', partialDay: 'FULL' },
          { id: 'v2', dataInicio: '2026-02-01', dataFim: '2026-02-06', partialDay: 'FULL' },
          { id: 'v3', dataInicio: '2026-03-01', dataFim: '2026-03-06', partialDay: 'FULL' },
        ]),
      },
    };

    await expect(
      __vacationTestables.validateVacationCountryPolicy({
        db: db as never,
        userId: 'u-1',
        country: 'BR',
        requestType: 'VACATION',
        dataInicio: '2026-04-01',
        dataFim: '2026-04-07',
        partialDay: 'FULL',
      }),
    ).rejects.toThrow('no máximo, 3 períodos');
  });

  it('BR policy rejects when all three periods are shorter than 14-day requirement', async () => {
    const db = {
      vacation: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'v1', dataInicio: '2026-01-01', dataFim: '2026-01-06', partialDay: 'FULL' },
          { id: 'v2', dataInicio: '2026-02-01', dataFim: '2026-02-06', partialDay: 'FULL' },
        ]),
      },
    };

    await expect(
      __vacationTestables.validateVacationCountryPolicy({
        db: db as never,
        userId: 'u-1',
        country: 'BR',
        requestType: 'VACATION',
        dataInicio: '2026-03-01',
        dataFim: '2026-03-06',
        partialDay: 'FULL',
      }),
    ).rejects.toThrow('14 dias');
  });
});
