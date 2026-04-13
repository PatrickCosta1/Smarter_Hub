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
          dataNascimento: '',
          genero: '',
          estadoCivil: '',
          habilitacoesLiterarias: '',
          curso: '',
          faculdade: '',
          emailPessoal: params.email,
          telemovel: '',
          moradaFiscal: '',
          endereco: '',
          localidade: params.localidade,
          codigoPostal: '',
          matriculaCarro: '',
          cartaoCidadao: '',
          nif: '',
          niss: '',
          iban: '',
          situacaoIrs: '',
          numeroDependentes: '',
          irsJovem: '',
          anoPrimeiroDesconto: '',
          numeroCartaoContinente: '',
          voucherNosData: '',
          comprovativoMoradaFiscal: '',
          comprovativoCartaoCidadao: '',
          comprovativoIban: '',
          comprovativoCartaoContinente: '',
          contactoEmergenciaNome: '',
          contactoEmergenciaParentesco: '',
          contactoEmergenciaNumero: '',
          cargo: params.cargo,
          funcao: params.funcao,
          dataInicioContrato: '2024-01-01',
          dataFimContrato: '',
          remuneracao: '',
          tipoContrato: '',
          regimeHorario: '',
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

  console.log('Base de dados reiniciada.');
  console.log('Utilizador inicial: t.people / people123');
  console.log('Utilizador adicional: patrick.costa / people123');
  console.log('Acesso total ativo em modo compacto (sem redundância por permissão).');
  console.log(`Permissões criadas: ${permissions.length}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
