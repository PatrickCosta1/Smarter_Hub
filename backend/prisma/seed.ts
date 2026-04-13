/// <reference types="node" />

import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';
import { PERMISSION_CATALOG } from '../src/lib/permissions.js';

const prisma = new PrismaClient() as any;

async function createUser(params: {
  username: string;
  email: string;
  password: string;
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
    telemovel: string;
    moradaFiscal: string;
    endereco: string;
    codigoPostal: string;
    matriculaCarro: string;
    cartaoCidadao: string;
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
    dataInicioContrato: string;
    dataFimContrato: string;
    remuneracao: string;
    tipoContrato: string;
    regimeHorario: string;
  }>;
}) {
  const passwordHash = await bcrypt.hash(params.password, 10);
  const nameParts = params.fullName.trim().split(/\s+/).filter(Boolean);
  const firstName = nameParts[0] || params.fullName;
  const lastName = nameParts.length > 1 ? nameParts.slice(1).join(' ') : '';
  const shortName = `${firstName}${lastName ? ` ${lastName}` : ''}`.trim();

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
          primeiroNome: firstName,
          apelido: lastName,
          nomeAbreviado: shortName,
          dataNascimento: params.profileData?.dataNascimento ?? '',
          genero: params.profileData?.genero ?? '',
          estadoCivil: params.profileData?.estadoCivil ?? '',
          habilitacoesLiterarias: params.profileData?.habilitacoesLiterarias ?? '',
          curso: params.profileData?.curso ?? '',
          faculdade: params.profileData?.faculdade ?? '',
          emailPessoal: params.profileData?.emailPessoal ?? params.email,
          telemovel: params.profileData?.telemovel ?? '',
          moradaFiscal: params.profileData?.moradaFiscal ?? '',
          endereco: params.profileData?.endereco ?? '',
          localidade: params.localidade,
          codigoPostal: params.profileData?.codigoPostal ?? '',
          matriculaCarro: params.profileData?.matriculaCarro ?? '',
          cartaoCidadao: params.profileData?.cartaoCidadao ?? '',
          nif: params.profileData?.nif ?? '',
          niss: params.profileData?.niss ?? '',
          iban: params.profileData?.iban ?? '',
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
          funcao: params.funcao,
          dataInicioContrato: params.profileData?.dataInicioContrato ?? '2024-01-01',
          dataFimContrato: params.profileData?.dataFimContrato ?? '',
          remuneracao: params.profileData?.remuneracao ?? '',
          tipoContrato: params.profileData?.tipoContrato ?? '',
          regimeHorario: params.profileData?.regimeHorario ?? '',
          workCountry: params.workCountry,
        },
      },
    },
    include: { profile: true },
  });
}

async function main() {
  await prisma.$transaction([
    prisma.permissionGrant.deleteMany(),
    prisma.userPermission.deleteMany(),
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
  ]);

  await prisma.permission.createMany({
    data: PERMISSION_CATALOG.map((item) => ({
      code: item.code,
      label: item.label,
      description: item.description,
      category: item.category,
      requiresRestrictions: item.requiresRestrictions,
    })),
  });

  const permissions = await prisma.permission.findMany({ orderBy: { code: 'asc' } });

  await createUser({
    username: 't.people',
    email: 't.people@tlantic.com',
    password: 'people123',
    role: 'ADMIN',
    isRootAccess: true,
    hasAccessTotal: true,
    fullName: 'T People',
    workCountry: 'PT',
    localidade: 'Porto',
    cargo: 'People',
    funcao: 'Administração raiz do sistema',
  });

  await createUser({
    username: 'patrick.costa',
    email: 'patrick.costa@tlantic.com',
    password: 'people123',
    role: 'ADMIN',
    isRootAccess: true,
    hasAccessTotal: true,
    fullName: 'Patrick Costa',
    workCountry: 'PT',
    localidade: 'Porto',
    cargo: 'People',
    funcao: 'Administração raiz do sistema',
  });

  await createUser({
    username: 'camila.teixeira',
    email: 'camila.teixeira@tlantic.com',
    password: 'people123',
    role: 'COLABORADOR',
    isRootAccess: false,
    hasAccessTotal: false,
    fullName: 'Camila Teixeira',
    workCountry: 'PT',
    localidade: 'Porto',
    cargo: 'Consultora',
    funcao: 'Desenvolvimento de Software',
    profileData: {
      dataNascimento: '2002-06-27',
      genero: 'Feminino',
      estadoCivil: 'Solteiro(a)',
      habilitacoesLiterarias: 'Mestrado',
      curso: 'RH',
      faculdade: 'FEP',
      telemovel: '931770200',
      moradaFiscal: 'Rua Manuel Pinto de Azevedo, 626, 1 Piso, 4100-320',
      endereco: 'Rua Manuel Pinto de Azevedo, 626, 1 Piso, 4100-320',
      codigoPostal: '4100-320',
      matriculaCarro: 'AQ57OO',
      cartaoCidadao: '123123123',
      nif: '123123123',
      niss: '1231231231',
      iban: 'PT502734895023456',
      situacaoIrs: 'Solteiro(a), Separado(a) ou Divorciado(a), sem dependentes',
      numeroDependentes: '0',
      irsJovem: 'Sim',
      anoPrimeiroDesconto: '2024',
      numeroCartaoContinente: 'XPRTO',
      tipoContrato: 'Outro',
      remuneracao: '123123123',
      dataInicioContrato: '2026-04-13',
    },
  });

  console.log('Base de dados reiniciada.');
  console.log('Utilizador inicial: t.people / people123');
  console.log('Utilizador adicional: patrick.costa / people123');
  console.log('Utilizador teste: camila.teixeira / people123');
  console.log('Acesso total ativo em modo compacto (sem redundância por permissão).');
  console.log(`Permissões criadas: ${permissions.length}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
