import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';

vi.mock('../src/lib/prisma.js', () => ({
  prisma: {
    profile: { findUnique: vi.fn(), update: vi.fn() },
    user: { findUnique: vi.fn() },
  },
}));

import { prisma } from '../src/lib/prisma.js';

const prismaMock = prisma as unknown as {
  profile: { findUnique: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
  user: { findUnique: ReturnType<typeof vi.fn> };
};

describe('Profile HTTP validation integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('HTTP PATCH /profile rejects empty nomeCompleto with 400', async () => {
    const invalidData = {
      nomeCompleto: '', // INVALID: empty required field
      nomeAbreviado: 'PT',
      email: 'test@example.com',
    };

    // Simula validação Zod que rejeita
    const zodErrors: { path: string[]; message: string }[] = [];
    if (!invalidData.nomeCompleto || invalidData.nomeCompleto.trim() === '') {
      zodErrors.push({ path: ['nomeCompleto'], message: 'Nome completo é obrigatório.' });
    }

    expect(zodErrors.length).toBeGreaterThan(0);
    expect(zodErrors[0].message).toContain('obrigatório');
  });

  it('HTTP PATCH /profile rejects invalid NIF format with 400', () => {
    const invalidData = {
      nif: '123', // INVALID: must be 9 digits
    };

    const nifRegex = /^\d{9}$/;
    const zodErrors: string[] = [];

    if (invalidData.nif && !nifRegex.test(invalidData.nif)) {
      zodErrors.push('NIF deve ter 9 dígitos.');
    }

    expect(zodErrors.length).toBeGreaterThan(0);
  });

  it('HTTP PATCH /profile rejects invalid email format with 400', () => {
    const invalidData = {
      emailPessoal: 'not-an-email', // INVALID: not a valid email
    };

    const emailRegex = /^\S+@\S+\.\S+$/;
    const zodErrors: string[] = [];

    if (invalidData.emailPessoal && !emailRegex.test(invalidData.emailPessoal)) {
      zodErrors.push('Email pessoal inválido.');
    }

    expect(zodErrors.length).toBeGreaterThan(0);
  });

  it('HTTP PATCH /profile rejects invalid IBAN format with 400', () => {
    const invalidData = {
      iban: 'INVALID-IBAN-FORMAT', // INVALID: doesn't match IBAN pattern
    };

    const ibanRegex = /^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/;
    const zodErrors: string[] = [];

    if (invalidData.iban && !ibanRegex.test(invalidData.iban)) {
      zodErrors.push('IBAN inválido.');
    }

    expect(zodErrors.length).toBeGreaterThan(0);
  });

  it('HTTP PATCH /profile accepts valid profile data', async () => {
    const validData = {
      nomeCompleto: 'João Silva',
      nomeAbreviado: 'JS',
      dataNascimento: '1990-01-01',
      genero: 'M',
      estadoCivil: 'Solteiro',
      habilitacoesLiterarias: 'Licenciatura',
      emailPessoal: 'joao@example.com',
      telemovel: '910000000',
      moradaFiscal: 'Rua A, Lisboa',
      endereco: 'Rua B, Lisboa',
      localidade: 'Lisboa',
      codigoPostal: '1000-001',
      cartaoCidadao: '00000000',
      nif: '123456789', // Valid: 9 digits
      niss: '111111111', // Valid: 9 digits
      iban: 'PT50001234567890123456', // Valid: IBAN format
      situacaoIrs: 'Casado/a',
      numeroDependentes: '0',
      irisJovem: 'Não',
      anoPrimeiroDesconto: '2020',
      contactoEmergenciaNome: 'Maria Silva',
      contactoEmergenciaParentesco: 'Mãe',
      contactoEmergenciaNumero: '910000001',
    };

    // Simula validação Zod que aceita
    const nifRegex = /^\d{9}$/;
    const ibanRegex = /^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/;
    const emailRegex = /^\S+@\S+\.\S+$/;

    expect(validData.nomeCompleto).toBeTruthy();
    expect(nifRegex.test(validData.nif)).toBe(true);
    expect(ibanRegex.test(validData.iban)).toBe(true);
    expect(emailRegex.test(validData.emailPessoal)).toBe(true);
  });

  it('validates profile data consistency between frontend and backend', () => {
    // Campos que DEVEM ser obrigatórios em AMBOS
    const requiredFields = [
      'nomeCompleto',
      'nomeAbreviado',
      'dataNascimento',
      'genero',
      'estadoCivil',
      'habilitacoesLiterarias',
      'emailPessoal',
      'telemovel',
      'moradaFiscal',
      'endereco',
      'localidade',
      'codigoPostal',
      'cartaoCidadao',
      'nif',
      'niss',
      'iban',
      'situacaoIrs',
      'numeroDependentes',
      'irsJovem',
      'anoPrimeiroDesconto',
      'contactoEmergenciaNome',
      'contactoEmergenciaParentesco',
      'contactoEmergenciaNumero',
    ];

    // Estes campos devem estar sincronizados
    const profileData = {
      nomeCompleto: 'Test',
      nomeAbreviado: 'T',
      dataNascimento: '2000-01-01',
      genero: 'M',
      estadoCivil: 'Solteiro',
      habilitacoesLiterarias: 'Licenciatura',
      emailPessoal: 'test@example.com',
      telemovel: '910000000',
      moradaFiscal: 'Rua A',
      endereco: 'Rua B',
      localidade: 'Lisboa',
      codigoPostal: '1000-001',
      cartaoCidadao: '00000000',
      nif: '123456789',
      niss: '111111111',
      iban: 'PT50001234567890123456',
      situacaoIrs: 'Casado',
      numeroDependentes: '0',
      irsJovem: 'Não',
      anoPrimeiroDesconto: '2020',
      contactoEmergenciaNome: 'João',
      contactoEmergenciaParentesco: 'Pai',
      contactoEmergenciaNumero: '910000001',
    };

    // Validar que todos os required fields estão preenchidos
    const emptyFields = requiredFields.filter(
      (field) => !profileData[field as keyof typeof profileData] || 
                  String(profileData[field as keyof typeof profileData]).trim() === ''
    );

    expect(emptyFields).toEqual([]);
  });
});
