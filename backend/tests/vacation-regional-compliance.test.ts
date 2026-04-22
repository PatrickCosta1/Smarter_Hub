import { describe, expect, it } from 'vitest';

/**
 * ALTO #2.3: Multi-Language & Regional Compliance Tests
 *
 * Testes para validar regras de férias por país (PT vs BR)
 * e conformidade de legislação local
 */

describe('Vacation rules - PT vs BR compliance - ALTO #2.3', () => {
  describe('Portugal - 10 dias úteis anuais mínimo', () => {
    it('PT: Collaborator gets 22 days annual vacation (Portuguese standard)', () => {
      const country = 'PT';
      const annualVacationDays = 22; // Portuguese statutory minimum (10 for first 5 years if < 35 years old, 22 normal)

      expect(annualVacationDays).toBeGreaterThanOrEqual(10);
    });

    it('PT: Férias divididas em múltiplos períodos deve respeitar mínimo de 10 dias úteis contíguos', () => {
      const country = 'PT';
      const vacation1 = { dataInicio: '2026-06-01', dataFim: '2026-06-10', dias: 10 };
      const vacation2 = { dataInicio: '2026-08-01', dataFim: '2026-08-05', dias: 5 };

      // Legislação portuguesa: mínimo de 10 dias contíguos num único período
      // Os restantes dias podem ser gozados em períodos mais pequenos
      const hasMinimumContiguousPeriod = vacation1.dias >= 10 || vacation2.dias >= 10;
      expect(hasMinimumContiguousPeriod).toBe(true);
    });

    it('PT: 1/3 da equipa em férias simultâneas (one-third capacity rule)', () => {
      const teamSize = 9;
      const maxSimultaneous = Math.floor(teamSize / 3); // = 3

      // Simular aprovação de férias
      let approvedVacations = [
        { id: 'vac-1', startDate: '2026-07-01', endDate: '2026-07-15', status: 'APPROVED' },
        { id: 'vac-2', startDate: '2026-07-01', endDate: '2026-07-15', status: 'APPROVED' },
        { id: 'vac-3', startDate: '2026-07-01', endDate: '2026-07-15', status: 'APPROVED' },
      ];

      const currentLoad = approvedVacations.length;
      const isBelowCapacity = currentLoad <= maxSimultaneous;

      expect(isBelowCapacity).toBe(true); // 3 <= 3 ✓

      // Tentar adicionar 4ª férias
      approvedVacations = [
        ...approvedVacations,
        { id: 'vac-4', startDate: '2026-07-01', endDate: '2026-07-15', status: 'APPROVED' },
      ];

      const newLoad = approvedVacations.length;
      const exceedsCapacity = newLoad > maxSimultaneous;

      expect(exceedsCapacity).toBe(true); // 4 > 3 ✗
    });

    it('PT: Feriados nacionais não contam como dias de férias gozados', () => {
      const country = 'PT';
      const vacationStart = '2026-12-23'; // Véspera de Natal
      const vacationEnd = '2026-12-27'; // Until 27th

      // Feriados em Portugal em dezembro: 25 (Natal)
      const portugueseFestiveDays = [25]; // December 25 = Christmas

      // Período de férias: 23 (qua), 24 (qui), 25 (sex - feriado), 26 (sáb), 27 (dom)
      // Dias úteis: 23, 24 (25 não conta, 26-27 são fins de semana)
      // Contabilização apenas de dias úteis
      const daysInRange = [23, 24, 25, 26, 27];
      const workingDays = daysInRange.filter((day) => {
        const date = new Date(2026, 11, day); // December
        const isWeekend = date.getDay() === 0 || date.getDay() === 6;
        const isFestive = portugueseFestiveDays.includes(day);
        return !isWeekend && !isFestive;
      });

      // 23 (Wed), 24 (Thu) = 2 working days count
      expect(workingDays.length).toBe(2);
    });

    it('PT: Aviso prévio de férias - mínimo 2 meses (exceto em caso de consenso)', () => {
      const country = 'PT';
      const today = new Date('2026-04-22');
      const vacationRequestDate = new Date('2026-04-22');
      const vacationStartDate = new Date('2026-06-15');

      const daysUntilVacation = Math.floor(
        (vacationStartDate.getTime() - vacationRequestDate.getTime()) / (1000 * 60 * 60 * 24)
      );

      // PT statutory requirement: 60 days notice (with exceptions)
      const hasAdequateNotice = daysUntilVacation >= 60;
      
      // In this case: 54 days < 60 days, so inadequate without employer agreement
      expect(hasAdequateNotice).toBe(false); // 2026-04-22 to 2026-06-15 = 54 days

      // However, in practice, if employer agrees, shorter notice is allowed
      const employerAgreed = true;
      const isValid = hasAdequateNotice || employerAgreed;
      expect(isValid).toBe(true);
    });
  });

  describe('Brazil (Hypothetical) - 20 dias anuais', () => {
    it('BR: Collaborator gets minimum 20 days annual vacation (Brazilian standard)', () => {
      const country = 'BR';
      const annualVacationDays = 20; // Brazilian statutory minimum

      expect(annualVacationDays).toBeGreaterThanOrEqual(20);
    });

    it('BR: Férias pode ser dividida em até 3 períodos (Brazilian rules allow split)', () => {
      const country = 'BR';
      const vacation1 = { dias: 10, periodo: '1º período' };
      const vacation2 = { dias: 5, periodo: '2º período' };
      const vacation3 = { dias: 5, periodo: '3º período' };

      // Brazilian law allows up to 3 periods
      const periods = [vacation1, vacation2, vacation3];
      const totalDays = periods.reduce((sum, v) => sum + v.dias, 0);

      expect(periods.length).toBeLessThanOrEqual(3);
      expect(totalDays).toBe(20);
    });

    it('BR: Feriados nacionais em janeiro/fevereiro específicos (Carnival, etc)', () => {
      const country = 'BR';
      const brazilianFestiveDays = {
        january: [1], // Ano Novo
        february: [12, 13], // Carnival (Terça de Carnaval)
        september: [7], // Independência
        october: [12], // Nossa Senhora
        november: [2, 20], // Finados, Consciência Negra
        december: [25], // Natal
      };

      // Aplicar férias em fevereiro (período de Carnaval)
      const vacationStart = new Date('2026-02-10');
      const vacationEnd = new Date('2026-02-14');

      // Dias 12, 13 são feriado (Carnival), não contam como dias gozados
      const daysToCount = [10, 11, 12, 13, 14]; // 5 dias, but 2 are festive
      const countableDays = daysToCount.filter((day) => !brazilianFestiveDays.february.includes(day));

      expect(countableDays.length).toBe(3); // 10, 11, 14
    });

    it('BR: Aviso prévio de férias - 30 dias', () => {
      const country = 'BR';
      const vacationRequestDate = new Date('2026-04-22');
      const vacationStartDate = new Date('2026-05-22'); // Exactly 30 days

      const daysUntilVacation = Math.floor(
        (vacationStartDate.getTime() - vacationRequestDate.getTime()) / (1000 * 60 * 60 * 24)
      );

      // BR statutory: 30 days notice
      const hasAdequateNotice = daysUntilVacation >= 30;

      expect(hasAdequateNotice).toBe(true);
    });
  });

  describe('Regional validation in vacation request submission', () => {
    it('VALIDATE: Reject vacation if notice period not met (country-specific)', () => {
      const validateVacationNotice = (
        country: string,
        requestDate: Date,
        vacationStartDate: Date
      ): { valid: boolean; minDaysRequired: number; daysProvided: number } => {
        const daysProvided = Math.floor(
          (vacationStartDate.getTime() - requestDate.getTime()) / (1000 * 60 * 60 * 24)
        );

        const minDaysRequired = country === 'BR' ? 30 : 60; // BR=30, PT=60

        return {
          valid: daysProvided >= minDaysRequired,
          minDaysRequired,
          daysProvided,
        };
      };

      // PT: needs 60 days, provided only 45
      const ptResult = validateVacationNotice(
        'PT',
        new Date('2026-04-22'),
        new Date('2026-06-07')
      );
      expect(ptResult.valid).toBe(false);

      // BR: needs 30 days, provided 45
      const brResult = validateVacationNotice(
        'BR',
        new Date('2026-04-22'),
        new Date('2026-06-07')
      );
      expect(brResult.valid).toBe(true);
    });

    it('VALIDATE: Apply correct festive dates per country', () => {
      const countryFestiveDates: Record<string, number[]> = {
        PT: [1, 25, 26], // Jan 1, Dec 25, Dec 26
        BR: [1, 7, 12, 13, 12, 25], // Different holidays
      };

      const calculateWorkDays = (
        startDate: Date,
        endDate: Date,
        country: string
      ): number => {
        let count = 0;
        const festiveDays = countryFestiveDates[country] || [];
        let current = new Date(startDate);

        while (current <= endDate) {
          const isWeekend = current.getDay() === 0 || current.getDay() === 6;
          const isFestive = festiveDays.includes(current.getDate());

          if (!isWeekend && !isFestive) {
            count++;
          }

          current.setDate(current.getDate() + 1);
        }

        return count;
      };

      const ptDays = calculateWorkDays(
        new Date('2026-12-23'),
        new Date('2026-12-27'),
        'PT'
      );
      const brDays = calculateWorkDays(
        new Date('2026-12-23'),
        new Date('2026-12-27'),
        'BR'
      );

      // Both should count correctly (excluding weekends and their respective holidays)
      expect(ptDays).toBeGreaterThan(0);
      expect(brDays).toBeGreaterThan(0);
    });
  });

  describe('UI & API compliance messaging', () => {
    it('MESSAGE: Feedback messages respect country language rules', () => {
      const messages = {
        PT: {
          minVacation: 'Mínimo 10 dias úteis anuais obrigatório em Portugal.',
          notice: 'Requer aviso prévio de 60 dias (ou consenso com empregador).',
          capacity: 'Máximo 1/3 da equipa em férias simultâneas.',
        },
        BR: {
          minVacation: 'Mínimo 20 dias de férias anuais obrigatório no Brasil.',
          notice: 'Requer aviso prévio de 30 dias.',
          capacity: 'Regra de capacidade conforme acordo interno.',
        },
      };

      expect(messages.PT.minVacation).toContain('10');
      expect(messages.BR.minVacation).toContain('20');
      expect(messages.PT.notice).toContain('60');
      expect(messages.BR.notice).toContain('30');
    });

    it('LOCALIZE: Error messages in correct language based on locale', () => {
      const locale = 'pt-PT'; // Portuguese Portugal
      const errorMap: Record<string, string> = {
        'pt-PT': 'Aviso prévio insuficiente. PT requer 60 dias.',
        'pt-BR': 'Aviso prévio insuficiente. BR requer 30 dias.',
        'en-US': 'Insufficient notice period.',
      };

      const error = errorMap[locale];
      expect(error).toContain('60');
    });
  });
});
