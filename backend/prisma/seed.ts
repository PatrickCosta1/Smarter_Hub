/// <reference types="node" />

import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';
import { PERMISSION_CATALOG } from '../src/lib/permissions.js';

const prisma = new PrismaClient() as any;

const DEFAULT_PASSWORD = 'pola123';

async function createUser(params: {
  username: string;
  email: string;
  password?: string;
  role: 'COLABORADOR' | 'MANAGER' | 'COORDENADOR' | 'ADMIN' | 'CONVIDADO';
  isRootAccess?: boolean;
  hasAccessTotal?: boolean;
  fullName: string;
  workCountry: 'PT' | 'BR';
  localidade: string;
  cargo: string;
  funcao: string;
  profileData?: Partial<{
    dataNascimento: string;
    genero: string;
    estadoCivil: string;
    habilitacoesLiterarias: string;
    curso: string;
    faculdade: string;
    nacionalidade: string;
    emailPessoal: string;
    telemovel: string;
    githubUser: string;
    moradaFiscal: string;
    endereco: string;
    codigoPostal: string;
    matriculaCarro: string;
    cartaoCidadao: string;
    validadeCartaoCidadao: string;
    nif: string;
    niss: string;
    iban: string;
    situacaoIrs: string;
    numeroDependentes: string;
    irsJovem: string;
    anoPrimeiroDesconto: string;
    numeroCartaoContinente: string;
    voucherNosData: string;
    contactoEmergenciaNome: string;
    contactoEmergenciaParentesco: string;
    contactoEmergenciaNumero: string;
    categoriaProfissional: string;
    dataInicioContrato: string;
    dataFimContrato: string;
    tipoContrato: string;
    regimeHorario: string;
    cpf: string;
    pis: string;
    rg: string;
    brWorkState: string;
    localNascimentoPais: string;
    localNascimentoCidade: string;
  }>;
}) {
  const passwordHash = await bcrypt.hash(params.password ?? DEFAULT_PASSWORD, 10);
  const nameParts = params.fullName.trim().split(/\s+/).filter(Boolean);
  const firstName = nameParts[0] || params.fullName;
  const lastName = nameParts.length > 1 ? nameParts.slice(1).join(' ') : '';

  return prisma.user.create({
    data: {
      username: params.username,
      email: params.email,
      passwordHash,
      role: params.role,
      isRootAccess: params.isRootAccess ?? false,
      hasAccessTotal: params.hasAccessTotal ?? false,
      teamId: null,
      profile: {
        create: {
          nomeCompleto: `${firstName} ${lastName}`.trim(),
          nomeAbreviado: `${firstName}${lastName ? ` ${lastName.split(' ')[0]}` : ''}`.trim(),
          dataNascimento: params.profileData?.dataNascimento ?? '',
          genero: params.profileData?.genero ?? '',
          estadoCivil: params.profileData?.estadoCivil ?? '',
          habilitacoesLiterarias: params.profileData?.habilitacoesLiterarias ?? '',
          curso: params.profileData?.curso ?? '',
          faculdade: params.profileData?.faculdade ?? '',
          nacionalidade: params.profileData?.nacionalidade ?? (params.workCountry === 'BR' ? 'Brasileira' : 'Portuguesa'),
          emailPessoal: params.profileData?.emailPessoal ?? params.email,
          telemovel: params.profileData?.telemovel ?? '',
          githubUser: params.profileData?.githubUser ?? '',
          moradaFiscal: params.profileData?.moradaFiscal ?? '',
          endereco: params.profileData?.endereco ?? '',
          localidade: params.localidade,
          codigoPostal: params.profileData?.codigoPostal ?? '',
          matriculaCarro: params.profileData?.matriculaCarro ?? '',
          cartaoCidadao: params.profileData?.cartaoCidadao ?? '',
          validadeCartaoCidadao: params.profileData?.validadeCartaoCidadao ?? '',
          nif: params.profileData?.nif ?? '',
          niss: params.profileData?.niss ?? '',
          iban: params.profileData?.iban ?? '',
          cpf: params.profileData?.cpf ?? '',
          pis: params.profileData?.pis ?? '',
          rg: params.profileData?.rg ?? '',
          localNascimentoPais: params.profileData?.localNascimentoPais ?? '',
          localNascimentoCidade: params.profileData?.localNascimentoCidade ?? '',
          situacaoIrs: params.profileData?.situacaoIrs ?? '',
          numeroDependentes: params.profileData?.numeroDependentes ?? '',
          irsJovem: params.profileData?.irsJovem ?? '',
          anoPrimeiroDesconto: params.profileData?.anoPrimeiroDesconto ?? '',
          numeroCartaoContinente: params.profileData?.numeroCartaoContinente ?? '',
          voucherNosData: params.profileData?.voucherNosData ?? '',
          comprovativoMoradaFiscal: '',
          comprovativoCartaoCidadao: '',
          comprovativoIban: '',
          comprovativoCartaoContinente: '',
          contactoEmergenciaNome: params.profileData?.contactoEmergenciaNome ?? '',
          contactoEmergenciaParentesco: params.profileData?.contactoEmergenciaParentesco ?? '',
          contactoEmergenciaNumero: params.profileData?.contactoEmergenciaNumero ?? '',
          cargo: params.cargo,
          categoriaProfissional: params.profileData?.categoriaProfissional ?? '',
          funcao: params.funcao,
          dataInicioContrato: params.profileData?.dataInicioContrato ?? '2024-01-01',
          dataFimContrato: params.profileData?.dataFimContrato ?? '',
          tipoContrato: params.profileData?.tipoContrato ?? (params.workCountry === 'BR' ? 'CLT' : 'Sem Termo'),
          regimeHorario: params.profileData?.regimeHorario ?? 'Full-time',
          workCountry: params.workCountry,
          ...(params.workCountry === 'BR' && params.profileData?.brWorkState
            ? { brWorkState: params.profileData.brWorkState as any }
            : {}),
        },
      },
    },
    include: { profile: true },
  });
}

async function addTraining(userId: string, assignedById: string | null, params: {
  nome: string;
  horas: number;
  entidade: string;
  dataInicio: string;
  dataConclusao: string;
  status: string;
  link?: string;
}) {
  return prisma.training.create({
    data: {
      userId,
      assignedByUserId: assignedById,
      nome: params.nome,
      horas: params.horas,
      entidade: params.entidade,
      dataInicio: params.dataInicio,
      dataConclusao: params.dataConclusao,
      status: params.status,
      link: params.link ?? '',
    },
  });
}

async function main() {
  await prisma.$transaction([
    prisma.hourBankEntry.deleteMany(),
    prisma.weeklyHourBankReport.deleteMany(),
    prisma.vacationBalanceCredit.deleteMany(),
    prisma.permissionGrant.deleteMany(),
    prisma.userPermission.deleteMany(),
    prisma.profileDropdownOption.deleteMany(),
    prisma.vacationApproval.deleteMany(),
    prisma.vacation.deleteMany(),
    prisma.profileChangeRequest.deleteMany(),
    prisma.training.deleteMany(),
    prisma.notification.deleteMany(),
    prisma.teamMembership.deleteMany(),
    prisma.profile.deleteMany(),
    prisma.user.deleteMany(),
    prisma.team.deleteMany(),
    prisma.permission.deleteMany(),
    prisma.vacationCompanyExtraDay.deleteMany(),
  ]);

  // ─── Permissões ──────────────────────────────────────────────────────────────
  await prisma.permission.createMany({
    data: PERMISSION_CATALOG.map((item: any) => ({
      code: item.code,
      label: item.label,
      description: item.description,
      category: item.category,
      requiresRestrictions: item.requiresRestrictions,
    })),
  });

  // ─── t.people (root) ─────────────────────────────────────────────────────────
  const tpeople = await createUser({
    username: 't.people',
    email: 't.people@tlantic.com',
    password: 'pola123',
    role: 'ADMIN',
    isRootAccess: true,
    hasAccessTotal: true,
    fullName: 'T People',
    workCountry: 'PT',
    localidade: 'Porto',
    cargo: 'Principal',
    funcao: 'People Director',
    profileData: {
      dataInicioContrato: '2020-01-01',
      tipoContrato: 'Sem Termo',
      regimeHorario: 'Full-time',
    },
  });

  // ─── RH — sara.magalhaes (AT dado pelo t.people) ─────────────────────────────
  const sara = await createUser({
    username: 'sara.magalhaes',
    email: 'sara.magalhaes@tlantic.com',
    role: 'COORDENADOR',
    hasAccessTotal: true,
    fullName: 'Sara Magalhães',
    workCountry: 'PT',
    localidade: 'Porto',
    cargo: 'Lead',
    funcao: 'People Manager',
    profileData: {
      dataNascimento: '1988-03-15',
      genero: 'Feminino',
      estadoCivil: 'Casado(a)',
      habilitacoesLiterarias: 'Mestrado',
      curso: 'Gestão de Recursos Humanos',
      faculdade: 'Universidade do Porto',
      telemovel: '912345678',
      nif: '234567890',
      niss: '12345678901',
      iban: 'PT50002700000001234567833',
      cartaoCidadao: '12345678 9 ZX0',
      validadeCartaoCidadao: '2028-03-15',
      moradaFiscal: 'Rua de Cedofeita, 341, 4050-179 Porto',
      endereco: 'Rua de Cedofeita, 341, 4050-179 Porto',
      codigoPostal: '4050-179',
      situacaoIrs: 'Casado(a) único titular',
      numeroDependentes: '2',
      irsJovem: 'Não',
      contactoEmergenciaNome: 'António Magalhães',
      contactoEmergenciaParentesco: 'Cônjuge',
      contactoEmergenciaNumero: '914567890',
      categoriaProfissional: 'Técnico Superior',
      dataInicioContrato: '2018-09-01',
      tipoContrato: 'Sem Termo',
      regimeHorario: 'Full-time',
      localNascimentoPais: 'Portugal',
      localNascimentoCidade: 'Braga',
    },
  });

  // Marcar sara como AT concedido pelo t.people
  await prisma.user.update({
    where: { id: sara.id },
    data: {
      accessTotalGrantedById: tpeople.id,
      accessTotalGrantedAt: new Date('2024-01-15'),
    },
  });

  // ─── RH — m.matos (AT dado pela sara) ────────────────────────────────────────
  const mmatos = await createUser({
    username: 'm.matos',
    email: 'm.matos@tlantic.com',
    role: 'COORDENADOR',
    hasAccessTotal: true,
    fullName: 'Márcia Matos',
    workCountry: 'PT',
    localidade: 'Lisboa',
    cargo: 'Lead',
    funcao: 'People Manager',
    profileData: {
      dataNascimento: '1993-07-22',
      genero: 'Feminino',
      estadoCivil: 'Solteiro(a)',
      habilitacoesLiterarias: 'Licenciatura',
      curso: 'Psicologia Organizacional',
      faculdade: 'ISCTE',
      telemovel: '919876543',
      nif: '245678901',
      niss: '23456789012',
      iban: 'PT50003400000098765432101',
      cartaoCidadao: '98765432 1 XY0',
      validadeCartaoCidadao: '2027-07-22',
      moradaFiscal: 'Av. da Liberdade, 180, 1250-146 Lisboa',
      endereco: 'Av. da Liberdade, 180, 1250-146 Lisboa',
      codigoPostal: '1250-146',
      situacaoIrs: 'Solteiro(a), Separado(a) ou Divorciado(a), sem dependentes',
      numeroDependentes: '0',
      irsJovem: 'Sim',
      anoPrimeiroDesconto: '2022',
      contactoEmergenciaNome: 'Helena Matos',
      contactoEmergenciaParentesco: 'Mãe',
      contactoEmergenciaNumero: '918765432',
      categoriaProfissional: 'Técnico Superior',
      dataInicioContrato: '2022-03-01',
      tipoContrato: 'Sem Termo',
      regimeHorario: 'Full-time',
      localNascimentoPais: 'Portugal',
      localNascimentoCidade: 'Lisboa',
    },
  });
  await prisma.user.update({
    where: { id: mmatos.id },
    data: { accessTotalGrantedById: sara.id, accessTotalGrantedAt: new Date('2024-02-01') },
  });

  // ─── RH — camila.teixeira (AT dado pela sara) ────────────────────────────────
  const camila = await createUser({
    username: 'camila.teixeira',
    email: 'camila.teixeira@tlantic.com',
    role: 'COORDENADOR',
    hasAccessTotal: true,
    fullName: 'Camila Teixeira',
    workCountry: 'PT',
    localidade: 'Porto',
    cargo: 'Associate',
    funcao: 'People Partner',
    profileData: {
      dataNascimento: '1996-11-08',
      genero: 'Feminino',
      estadoCivil: 'Solteiro(a)',
      habilitacoesLiterarias: 'Mestrado',
      curso: 'Gestão de Recursos Humanos',
      faculdade: 'FEP — Faculdade de Economia do Porto',
      telemovel: '931770200',
      nif: '256789012',
      niss: '34567890123',
      iban: 'PT50002700000001234567866',
      cartaoCidadao: '25678901 2 ZX0',
      validadeCartaoCidadao: '2029-11-08',
      moradaFiscal: 'Rua Manuel Pinto de Azevedo, 626, 4100-320 Porto',
      endereco: 'Rua Manuel Pinto de Azevedo, 626, 4100-320 Porto',
      codigoPostal: '4100-320',
      matriculaCarro: 'AQ57OO',
      situacaoIrs: 'Solteiro(a), Separado(a) ou Divorciado(a), sem dependentes',
      numeroDependentes: '0',
      irsJovem: 'Sim',
      anoPrimeiroDesconto: '2024',
      numeroCartaoContinente: 'XPRTO',
      contactoEmergenciaNome: 'Rosa Teixeira',
      contactoEmergenciaParentesco: 'Mãe',
      contactoEmergenciaNumero: '939876543',
      categoriaProfissional: 'Técnico Superior',
      dataInicioContrato: '2024-04-01',
      tipoContrato: 'Sem Termo',
      regimeHorario: 'Full-time',
      localNascimentoPais: 'Portugal',
      localNascimentoCidade: 'Porto',
    },
  });
  await prisma.user.update({
    where: { id: camila.id },
    data: { accessTotalGrantedById: sara.id, accessTotalGrantedAt: new Date('2024-04-15') },
  });

  // ─── Colaboradores PT ────────────────────────────────────────────────────────
  const joao = await createUser({
    username: 'joao.ferreira',
    email: 'joao.ferreira@tlantic.com',
    role: 'MANAGER',
    fullName: 'João Ferreira',
    workCountry: 'PT',
    localidade: 'Porto',
    cargo: 'Senior',
    funcao: 'Software Engineer',
    profileData: {
      dataNascimento: '1990-05-14',
      genero: 'Masculino',
      estadoCivil: 'Casado(a)',
      habilitacoesLiterarias: 'Mestrado',
      curso: 'Engenharia Informática',
      faculdade: 'FEUP — Faculdade de Engenharia da UP',
      telemovel: '916543210',
      nif: '267890123',
      niss: '45678901234',
      iban: 'PT50004400000001234567812',
      cartaoCidadao: '26789012 3 YZ0',
      validadeCartaoCidadao: '2027-05-14',
      moradaFiscal: 'Rua Álvares Cabral, 58, 4050-040 Porto',
      endereco: 'Rua Álvares Cabral, 58, 4050-040 Porto',
      codigoPostal: '4050-040',
      matriculaCarro: 'BB44CC',
      situacaoIrs: 'Casado(a) único titular',
      numeroDependentes: '1',
      irsJovem: 'Não',
      githubUser: 'jferreira-dev',
      contactoEmergenciaNome: 'Marta Ferreira',
      contactoEmergenciaParentesco: 'Cônjuge',
      contactoEmergenciaNumero: '916543211',
      categoriaProfissional: 'Especialista',
      dataInicioContrato: '2019-06-01',
      tipoContrato: 'Sem Termo',
      regimeHorario: 'Full-time',
      localNascimentoPais: 'Portugal',
      localNascimentoCidade: 'Porto',
    },
  });

  const ana = await createUser({
    username: 'ana.santos',
    email: 'ana.santos@tlantic.com',
    role: 'COLABORADOR',
    fullName: 'Ana Santos',
    workCountry: 'PT',
    localidade: 'Lisboa',
    cargo: 'Junior',
    funcao: 'Software Developer',
    profileData: {
      dataNascimento: '1997-02-28',
      genero: 'Feminino',
      estadoCivil: 'Solteiro(a)',
      habilitacoesLiterarias: 'Licenciatura',
      curso: 'Engenharia Informática e de Computadores',
      faculdade: 'IST — Instituto Superior Técnico',
      telemovel: '923456789',
      nif: '278901234',
      niss: '56789012345',
      iban: 'PT50003400000012345678901',
      cartaoCidadao: '27890123 4 ZA0',
      validadeCartaoCidadao: '2028-02-28',
      moradaFiscal: 'Rua Augusta, 200, 1100-053 Lisboa',
      endereco: 'Rua Augusta, 200, 1100-053 Lisboa',
      codigoPostal: '1100-053',
      situacaoIrs: 'Solteiro(a), Separado(a) ou Divorciado(a), sem dependentes',
      numeroDependentes: '0',
      irsJovem: 'Sim',
      anoPrimeiroDesconto: '2023',
      githubUser: 'ana-santos-fe',
      contactoEmergenciaNome: 'Carlos Santos',
      contactoEmergenciaParentesco: 'Pai',
      contactoEmergenciaNumero: '912345679',
      categoriaProfissional: 'Técnico',
      dataInicioContrato: '2023-09-01',
      tipoContrato: 'Sem Termo',
      regimeHorario: 'Full-time',
      localNascimentoPais: 'Portugal',
      localNascimentoCidade: 'Lisboa',
    },
  });

  const miguel = await createUser({
    username: 'miguel.oliveira',
    email: 'miguel.oliveira@tlantic.com',
    role: 'COLABORADOR',
    fullName: 'Miguel Oliveira',
    workCountry: 'PT',
    localidade: 'Braga',
    cargo: 'Associate',
    funcao: 'Software Engineer',
    profileData: {
      dataNascimento: '1995-09-30',
      genero: 'Masculino',
      estadoCivil: 'Solteiro(a)',
      habilitacoesLiterarias: 'Mestrado',
      curso: 'Engenharia Informática',
      faculdade: 'Universidade do Minho',
      telemovel: '934567890',
      nif: '289012345',
      niss: '67890123456',
      iban: 'PT50002700000009876543210',
      cartaoCidadao: '28901234 5 AB0',
      validadeCartaoCidadao: '2026-09-30',
      moradaFiscal: 'Rua do Souto, 77, 4700-225 Braga',
      endereco: 'Rua do Souto, 77, 4700-225 Braga',
      codigoPostal: '4700-225',
      situacaoIrs: 'Solteiro(a), Separado(a) ou Divorciado(a), sem dependentes',
      numeroDependentes: '0',
      irsJovem: 'Não',
      githubUser: 'miguel-oliveira-be',
      contactoEmergenciaNome: 'Teresa Oliveira',
      contactoEmergenciaParentesco: 'Mãe',
      contactoEmergenciaNumero: '934567891',
      categoriaProfissional: 'Técnico',
      dataInicioContrato: '2021-02-01',
      tipoContrato: 'Sem Termo',
      regimeHorario: 'Full-time',
      localNascimentoPais: 'Portugal',
      localNascimentoCidade: 'Braga',
    },
  });

  const ines = await createUser({
    username: 'ines.rodrigues',
    email: 'ines.rodrigues@tlantic.com',
    role: 'MANAGER',
    fullName: 'Inês Rodrigues',
    workCountry: 'PT',
    localidade: 'Lisboa',
    cargo: 'Senior',
    funcao: 'Business Consultant',
    profileData: {
      dataNascimento: '1987-12-05',
      genero: 'Feminino',
      estadoCivil: 'Divorciado(a)',
      habilitacoesLiterarias: 'Mestrado',
      curso: 'Gestão de Empresas',
      faculdade: 'Nova School of Business and Economics',
      telemovel: '911234567',
      nif: '290123456',
      niss: '78901234567',
      iban: 'PT50004400000054321098765',
      cartaoCidadao: '29012345 6 BC0',
      validadeCartaoCidadao: '2025-12-05',
      moradaFiscal: 'Av. da República, 55, 1050-187 Lisboa',
      endereco: 'Av. da República, 55, 1050-187 Lisboa',
      codigoPostal: '1050-187',
      situacaoIrs: 'Solteiro(a), Separado(a) ou Divorciado(a), com dependentes',
      numeroDependentes: '1',
      irsJovem: 'Não',
      contactoEmergenciaNome: 'Paulo Rodrigues',
      contactoEmergenciaParentesco: 'Irmão',
      contactoEmergenciaNumero: '911234568',
      categoriaProfissional: 'Especialista',
      dataInicioContrato: '2017-03-15',
      tipoContrato: 'Sem Termo',
      regimeHorario: 'Full-time',
      localNascimentoPais: 'Portugal',
      localNascimentoCidade: 'Lisboa',
    },
  });

  const rita = await createUser({
    username: 'rita.alves',
    email: 'rita.alves@tlantic.com',
    role: 'COLABORADOR',
    fullName: 'Rita Alves',
    workCountry: 'PT',
    localidade: 'Lisboa',
    cargo: 'Junior',
    funcao: 'Business Consultant',
    profileData: {
      dataNascimento: '1999-04-17',
      genero: 'Feminino',
      estadoCivil: 'Solteiro(a)',
      habilitacoesLiterarias: 'Licenciatura',
      curso: 'Economia',
      faculdade: 'Universidade de Lisboa',
      telemovel: '922345678',
      nif: '301234567',
      niss: '89012345678',
      iban: 'PT50002700000067890123456',
      cartaoCidadao: '30123456 7 CD0',
      validadeCartaoCidadao: '2029-04-17',
      moradaFiscal: 'Rua Garrett, 42, 1200-204 Lisboa',
      endereco: 'Rua Garrett, 42, 1200-204 Lisboa',
      codigoPostal: '1200-204',
      situacaoIrs: 'Solteiro(a), Separado(a) ou Divorciado(a), sem dependentes',
      numeroDependentes: '0',
      irsJovem: 'Sim',
      anoPrimeiroDesconto: '2024',
      contactoEmergenciaNome: 'Luisa Alves',
      contactoEmergenciaParentesco: 'Mãe',
      contactoEmergenciaNumero: '922345679',
      categoriaProfissional: 'Técnico',
      dataInicioContrato: '2024-06-01',
      tipoContrato: 'Sem Termo',
      regimeHorario: 'Full-time',
      localNascimentoPais: 'Portugal',
      localNascimentoCidade: 'Setúbal',
    },
  });

  // ─── Colaboradores BR ────────────────────────────────────────────────────────
  const lucas = await createUser({
    username: 'lucas.mendes',
    email: 'lucas.mendes@tlantic.com',
    role: 'MANAGER',
    fullName: 'Lucas Mendes',
    workCountry: 'BR',
    localidade: 'São Paulo',
    cargo: 'Senior',
    funcao: 'Software Engineer',
    profileData: {
      dataNascimento: '1991-08-20',
      genero: 'Masculino',
      estadoCivil: 'Casado(a)',
      habilitacoesLiterarias: 'Mestrado',
      curso: 'Ciência da Computação',
      faculdade: 'USP — Universidade de São Paulo',
      telemovel: '+55 11 99123-4567',
      cpf: '123.456.789-00',
      pis: '123.45678.90-1',
      rg: '12.345.678-9',
      iban: 'BR1500000000000010932840814P2',
      moradaFiscal: 'Av. Paulista, 1578, 01310-200 São Paulo – SP',
      endereco: 'Av. Paulista, 1578, 01310-200 São Paulo – SP',
      codigoPostal: '01310-200',
      situacaoIrs: 'Casado(a)',
      numeroDependentes: '1',
      contactoEmergenciaNome: 'Fernanda Mendes',
      contactoEmergenciaParentesco: 'Cônjuge',
      contactoEmergenciaNumero: '+55 11 99234-5678',
      categoriaProfissional: 'Especialista',
      dataInicioContrato: '2020-01-06',
      tipoContrato: 'CLT',
      regimeHorario: 'Full-time',
      brWorkState: 'SP',
      localNascimentoPais: 'Brasil',
      localNascimentoCidade: 'São Paulo',
    },
  });

  const fernanda = await createUser({
    username: 'fernanda.lima',
    email: 'fernanda.lima@tlantic.com',
    role: 'COLABORADOR',
    fullName: 'Fernanda Lima',
    workCountry: 'BR',
    localidade: 'São Paulo',
    cargo: 'Junior',
    funcao: 'Software Developer',
    profileData: {
      dataNascimento: '1998-06-11',
      genero: 'Feminino',
      estadoCivil: 'Solteiro(a)',
      habilitacoesLiterarias: 'Licenciatura',
      curso: 'Sistemas de Informação',
      faculdade: 'UNIFESP',
      telemovel: '+55 11 98765-4321',
      cpf: '234.567.890-11',
      pis: '234.56789.01-2',
      rg: '23.456.789-0',
      iban: 'BR1500000000000010932840814P3',
      moradaFiscal: 'Rua da Consolação, 456, 01301-000 São Paulo – SP',
      endereco: 'Rua da Consolação, 456, 01301-000 São Paulo – SP',
      codigoPostal: '01301-000',
      situacaoIrs: 'Solteiro(a)',
      numeroDependentes: '0',
      contactoEmergenciaNome: 'Roberto Lima',
      contactoEmergenciaParentesco: 'Pai',
      contactoEmergenciaNumero: '+55 11 97654-3210',
      categoriaProfissional: 'Técnico',
      dataInicioContrato: '2023-03-01',
      tipoContrato: 'CLT',
      regimeHorario: 'Full-time',
      brWorkState: 'SP',
      localNascimentoPais: 'Brasil',
      localNascimentoCidade: 'Campinas',
    },
  });

  const carlos = await createUser({
    username: 'carlos.souza',
    email: 'carlos.souza@tlantic.com',
    role: 'COLABORADOR',
    fullName: 'Carlos Souza',
    workCountry: 'BR',
    localidade: 'Porto Alegre',
    cargo: 'Associate',
    funcao: 'Software Engineer',
    profileData: {
      dataNascimento: '1993-01-25',
      genero: 'Masculino',
      estadoCivil: 'Solteiro(a)',
      habilitacoesLiterarias: 'Licenciatura',
      curso: 'Engenharia de Software',
      faculdade: 'PUCRS',
      telemovel: '+55 51 99876-5432',
      cpf: '345.678.901-22',
      pis: '345.67890.12-3',
      rg: '34.567.890-1',
      iban: 'BR1500000000000010932840814P4',
      moradaFiscal: 'Av. Ipiranga, 6681, 90619-900 Porto Alegre – RS',
      endereco: 'Av. Ipiranga, 6681, 90619-900 Porto Alegre – RS',
      codigoPostal: '90619-900',
      situacaoIrs: 'Solteiro(a)',
      numeroDependentes: '0',
      contactoEmergenciaNome: 'Maria Souza',
      contactoEmergenciaParentesco: 'Mãe',
      contactoEmergenciaNumero: '+55 51 98765-4321',
      categoriaProfissional: 'Técnico',
      dataInicioContrato: '2022-07-04',
      tipoContrato: 'CLT',
      regimeHorario: 'Full-time',
      brWorkState: 'RS',
      localNascimentoPais: 'Brasil',
      localNascimentoCidade: 'Porto Alegre',
    },
  });

  const julia = await createUser({
    username: 'julia.costa',
    email: 'julia.costa@tlantic.com',
    role: 'COLABORADOR',
    fullName: 'Júlia Costa',
    workCountry: 'BR',
    localidade: 'São Paulo',
    cargo: 'Associate',
    funcao: 'Business Analyst',
    profileData: {
      dataNascimento: '1996-10-03',
      genero: 'Feminino',
      estadoCivil: 'Casado(a)',
      habilitacoesLiterarias: 'Licenciatura',
      curso: 'Administração de Empresas',
      faculdade: 'FGV',
      telemovel: '+55 11 97890-1234',
      cpf: '456.789.012-33',
      pis: '456.78901.23-4',
      rg: '45.678.901-2',
      iban: 'BR1500000000000010932840814P5',
      moradaFiscal: 'Rua Vergueiro, 1111, 04101-000 São Paulo – SP',
      endereco: 'Rua Vergueiro, 1111, 04101-000 São Paulo – SP',
      codigoPostal: '04101-000',
      situacaoIrs: 'Casado(a)',
      numeroDependentes: '0',
      contactoEmergenciaNome: 'Pedro Costa',
      contactoEmergenciaParentesco: 'Cônjuge',
      contactoEmergenciaNumero: '+55 11 96789-0123',
      categoriaProfissional: 'Técnico',
      dataInicioContrato: '2024-02-01',
      tipoContrato: 'CLT',
      regimeHorario: 'Full-time',
      brWorkState: 'SP',
      localNascimentoPais: 'Brasil',
      localNascimentoCidade: 'Santos',
    },
  });

  // ─── Equipas ─────────────────────────────────────────────────────────────────
  const teamDevWeb = await prisma.team.create({
    data: {
      name: 'Desenvolvimento Web',
      costCenter: 'CC-DEV-001',
      color: '#4B79F5',
      managerId: joao.id,
      coordinatorId: sara.id,
    },
  });

  const teamConsultoria = await prisma.team.create({
    data: {
      name: 'Consultoria',
      costCenter: 'CC-CON-002',
      color: '#8B5CF6',
      managerId: ines.id,
      coordinatorId: mmatos.id,
    },
  });

  const teamEngenhariaRH = await prisma.team.create({
    data: {
      name: 'Engenharia de Software BR',
      costCenter: 'CC-ENG-BR-003',
      color: '#10B981',
      managerId: lucas.id,
      coordinatorId: camila.id,
    },
  });

  const teamOperacoesBR = await prisma.team.create({
    data: {
      name: 'Operações BR',
      costCenter: 'CC-OPS-BR-004',
      color: '#F59E0B',
      managerId: lucas.id,
    },
  });

  // ─── Memberships ─────────────────────────────────────────────────────────────
  // Equipa Desenvolvimento Web (PT)
  await prisma.teamMembership.createMany({
    data: [
      { userId: joao.id,    teamId: teamDevWeb.id, membershipRole: 'LEADER',      isApprover: true,  approvalLevel: 1 },
      { userId: ana.id,     teamId: teamDevWeb.id, membershipRole: 'PARTICIPANT',  isApprover: false },
      { userId: miguel.id,  teamId: teamDevWeb.id, membershipRole: 'PARTICIPANT',  isApprover: false },
      { userId: sara.id,    teamId: teamDevWeb.id, membershipRole: 'COORDINATOR',  isApprover: true,  approvalLevel: 2 },
    ],
  });
  // Equipa Consultoria (PT)
  await prisma.teamMembership.createMany({
    data: [
      { userId: ines.id,   teamId: teamConsultoria.id, membershipRole: 'LEADER',     isApprover: true,  approvalLevel: 1 },
      { userId: rita.id,   teamId: teamConsultoria.id, membershipRole: 'PARTICIPANT', isApprover: false },
      { userId: mmatos.id, teamId: teamConsultoria.id, membershipRole: 'COORDINATOR', isApprover: true,  approvalLevel: 2 },
    ],
  });
  // Equipa Engenharia BR
  await prisma.teamMembership.createMany({
    data: [
      { userId: lucas.id,    teamId: teamEngenhariaRH.id, membershipRole: 'LEADER',      isApprover: true,  approvalLevel: 1 },
      { userId: fernanda.id, teamId: teamEngenhariaRH.id, membershipRole: 'PARTICIPANT',  isApprover: false },
      { userId: carlos.id,   teamId: teamEngenhariaRH.id, membershipRole: 'PARTICIPANT',  isApprover: false },
      { userId: camila.id,   teamId: teamEngenhariaRH.id, membershipRole: 'COORDINATOR',  isApprover: true,  approvalLevel: 2 },
    ],
  });
  // Equipa Operações BR
  await prisma.teamMembership.createMany({
    data: [
      { userId: lucas.id, teamId: teamOperacoesBR.id, membershipRole: 'LEADER',      isApprover: true,  approvalLevel: 1 },
      { userId: julia.id, teamId: teamOperacoesBR.id, membershipRole: 'PARTICIPANT',  isApprover: false },
    ],
  });

  // Atualizar teamId principal nos utilizadores
  await prisma.user.update({ where: { id: joao.id },    data: { teamId: teamDevWeb.id } });
  await prisma.user.update({ where: { id: ana.id },     data: { teamId: teamDevWeb.id } });
  await prisma.user.update({ where: { id: miguel.id },  data: { teamId: teamDevWeb.id } });
  await prisma.user.update({ where: { id: ines.id },    data: { teamId: teamConsultoria.id } });
  await prisma.user.update({ where: { id: rita.id },    data: { teamId: teamConsultoria.id } });
  await prisma.user.update({ where: { id: lucas.id },   data: { teamId: teamEngenhariaRH.id } });
  await prisma.user.update({ where: { id: fernanda.id }, data: { teamId: teamEngenhariaRH.id } });
  await prisma.user.update({ where: { id: carlos.id },  data: { teamId: teamEngenhariaRH.id } });
  await prisma.user.update({ where: { id: julia.id },   data: { teamId: teamOperacoesBR.id } });

  // ─── Formações ───────────────────────────────────────────────────────────────
  const atId = sara.id; // assignedBy default

  // João Ferreira
  await addTraining(joao.id, atId, { nome: 'React Advanced Patterns', horas: 16, entidade: 'Udemy', dataInicio: '2024-02-01', dataConclusao: '2024-02-28', status: 'CONCLUIDA', link: 'https://udemy.com' });
  await addTraining(joao.id, atId, { nome: 'AWS Solutions Architect', horas: 40, entidade: 'AWS Training', dataInicio: '2024-09-01', dataConclusao: '2024-10-15', status: 'CONCLUIDA' });
  await addTraining(joao.id, atId, { nome: 'Liderança de Equipas Técnicas', horas: 8, entidade: 'Interna', dataInicio: '2025-01-10', dataConclusao: '', status: 'EM_CURSO' });

  // Ana Santos
  await addTraining(ana.id, atId, { nome: 'TypeScript: Do Básico ao Avançado', horas: 20, entidade: 'Coursera', dataInicio: '2024-03-01', dataConclusao: '2024-03-31', status: 'CONCLUIDA' });
  await addTraining(ana.id, atId, { nome: 'Acessibilidade Web (WCAG 2.2)', horas: 6, entidade: 'W3C/Edx', dataInicio: '2024-11-01', dataConclusao: '2024-11-20', status: 'CONCLUIDA' });

  // Miguel Oliveira
  await addTraining(miguel.id, atId, { nome: 'Node.js Microservices', horas: 24, entidade: 'Pluralsight', dataInicio: '2024-04-01', dataConclusao: '2024-05-15', status: 'CONCLUIDA' });
  await addTraining(miguel.id, atId, { nome: 'PostgreSQL Performance Tuning', horas: 12, entidade: 'Interna', dataInicio: '2025-02-01', dataConclusao: '', status: 'EM_CURSO' });

  // Inês Rodrigues
  await addTraining(ines.id, atId, { nome: 'Metodologias Ágeis (Scrum Master)', horas: 16, entidade: 'Scrum Alliance', dataInicio: '2023-11-01', dataConclusao: '2023-11-30', status: 'CONCLUIDA' });
  await addTraining(ines.id, atId, { nome: 'Design Thinking Aplicado', horas: 8, entidade: 'IDEO', dataInicio: '2024-06-10', dataConclusao: '2024-06-14', status: 'CONCLUIDA' });

  // Rita Alves
  await addTraining(rita.id, atId, { nome: 'Power BI para Negócios', horas: 10, entidade: 'Microsoft Learn', dataInicio: '2024-10-01', dataConclusao: '2024-10-20', status: 'CONCLUIDA' });

  // Lucas Mendes
  await addTraining(lucas.id, atId, { nome: 'Kubernetes e Docker para Produção', horas: 30, entidade: 'Linux Foundation', dataInicio: '2024-01-15', dataConclusao: '2024-03-01', status: 'CONCLUIDA' });
  await addTraining(lucas.id, atId, { nome: 'Gestão de Incidentes e SRE', horas: 12, entidade: 'Google', dataInicio: '2025-01-20', dataConclusao: '', status: 'EM_CURSO' });

  // Fernanda Lima
  await addTraining(fernanda.id, atId, { nome: 'Vue.js 3 Completo', horas: 18, entidade: 'Udemy', dataInicio: '2024-05-01', dataConclusao: '2024-06-01', status: 'CONCLUIDA' });
  await addTraining(fernanda.id, atId, { nome: 'Figma para Desenvolvedores', horas: 6, entidade: 'Interna', dataInicio: '2025-03-01', dataConclusao: '', status: 'EM_CURSO' });

  // Carlos Souza
  await addTraining(carlos.id, atId, { nome: 'Golang para Backend', horas: 20, entidade: 'Pluralsight', dataInicio: '2024-07-01', dataConclusao: '2024-08-10', status: 'CONCLUIDA' });

  // Júlia Costa
  await addTraining(julia.id, atId, { nome: 'Gestão de Processos BPM', horas: 12, entidade: 'Interna', dataInicio: '2024-09-10', dataConclusao: '2024-09-30', status: 'CONCLUIDA' });
  await addTraining(julia.id, atId, { nome: 'Excel Avançado para Operações', horas: 8, entidade: 'Sebrae', dataInicio: '2025-04-01', dataConclusao: '', status: 'EM_CURSO' });

  // Sara Magalhães
  await addTraining(sara.id, atId, { nome: 'GDPR e Proteção de Dados em RH', horas: 8, entidade: 'CNPD', dataInicio: '2024-03-15', dataConclusao: '2024-03-22', status: 'CONCLUIDA' });
  await addTraining(sara.id, atId, { nome: 'People Analytics', horas: 20, entidade: 'Coursera', dataInicio: '2024-12-01', dataConclusao: '2024-12-31', status: 'CONCLUIDA' });

  // ─── Banco de Horas — lançamentos BR ─────────────────────────────────────────
  await prisma.hourBankEntry.createMany({
    data: [
      { userId: lucas.id,   type: 'CREDIT', hours: 8,  reason: 'Projeto entregue com antecedência — Sprint 12', source: 'MANUAL', createdById: tpeople.id, createdAt: new Date('2025-02-10') },
      { userId: fernanda.id, type: 'CREDIT', hours: 4, reason: 'Horas extra — deploy crítico', source: 'MANUAL', createdById: lucas.id, createdAt: new Date('2025-03-05') },
      { userId: carlos.id,  type: 'CREDIT', hours: 6,  reason: 'Suporte pós-lançamento', source: 'MANUAL', createdById: lucas.id, createdAt: new Date('2025-03-18') },
      { userId: carlos.id,  type: 'DEBIT',  hours: 4,  reason: 'Folga compensatória aprovada', source: 'MANUAL', createdById: lucas.id, createdAt: new Date('2025-04-02') },
      { userId: julia.id,   type: 'CREDIT', hours: 3,  reason: 'Cobertura equipa ausência', source: 'MANUAL', createdById: lucas.id, createdAt: new Date('2025-04-10') },
    ],
  });

  console.log('');
  console.log('✅ Base de dados reiniciada com dados realistas.');
  console.log('');
  console.log('━━━ Utilizadores do sistema ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  t.people            pola123   (Root / Acesso Total)');
  console.log('  sara.magalhaes      pola123   (Coordenador / AT — dado por t.people)');
  console.log('  m.matos             pola123   (Coordenador / AT — dado por sara)');
  console.log('  camila.teixeira     pola123   (Coordenador / AT — dado por sara)');
  console.log('');
  console.log('━━━ Equipas PT ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  Desenvolvimento Web  — Manager: joao.ferreira, Coord: sara.magalhaes');
  console.log('    joao.ferreira   pola123  (Manager)');
  console.log('    ana.santos      pola123  (Colaborador)');
  console.log('    miguel.oliveira pola123  (Colaborador)');
  console.log('  Consultoria          — Manager: ines.rodrigues, Coord: m.matos');
  console.log('    ines.rodrigues  pola123  (Manager)');
  console.log('    rita.alves      pola123  (Colaborador)');
  console.log('');
  console.log('━━━ Equipas BR ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  Engenharia de Software BR — Manager: lucas.mendes, Coord: camila.teixeira');
  console.log('    lucas.mendes    pola123  (Manager)');
  console.log('    fernanda.lima   pola123  (Colaborador)');
  console.log('    carlos.souza    pola123  (Colaborador)');
  console.log('  Operações BR          — Manager: lucas.mendes');
  console.log('    julia.costa     pola123  (Colaborador)');
  console.log('');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

