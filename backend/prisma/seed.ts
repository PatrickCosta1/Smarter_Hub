/// <reference types="node" />

import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function ensureUser(params: {
  username: string;
  email: string;
  password: string;
  role: 'COLABORADOR' | 'MANAGER' | 'COORDENADOR' | 'ADMIN' | 'CONVIDADO';
  fullName: string;
  workCountry?: 'PT' | 'BR';
  localidade?: string;
  cargo?: string;
  funcao?: string;
  teamId?: string | null;
}) {
  const passwordHash = await bcrypt.hash(params.password, 10);

  return prisma.user.upsert({
    where: { username: params.username },
    update: {
      email: params.email,
      passwordHash,
      role: params.role,
      teamId: params.role === 'ADMIN' ? null : params.teamId ?? null,
      profile: {
        upsert: {
          update: {
            primeiroNome: params.fullName,
            workCountry: params.workCountry ?? 'PT',
            localidade: params.localidade ?? 'Porto',
            cargo: params.cargo ?? 'Colaborador',
            funcao: params.funcao ?? '',
          },
          create: {
            primeiroNome: params.fullName,
            apelido: '',
            nomeAbreviado: params.fullName,
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
            localidade: params.localidade ?? 'Porto',
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
            cargo: params.cargo ?? 'Colaborador',
            funcao: params.funcao ?? '',
            dataInicioContrato: '',
            dataFimContrato: '',
            remuneracao: '',
            tipoContrato: '',
            regimeHorario: '',
            workCountry: params.workCountry ?? 'PT',
          },
        },
      },
    },
    create: {
      username: params.username,
      email: params.email,
      passwordHash,
      role: params.role,
      teamId: params.role === 'ADMIN' ? null : params.teamId ?? null,
      profile: {
        create: {
          primeiroNome: params.fullName,
          apelido: '',
          nomeAbreviado: params.fullName,
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
          localidade: params.localidade ?? 'Porto',
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
          cargo: params.cargo ?? 'Colaborador',
          funcao: params.funcao ?? '',
          dataInicioContrato: '',
          dataFimContrato: '',
          remuneracao: '',
          tipoContrato: '',
          regimeHorario: '',
          workCountry: params.workCountry ?? 'PT',
        },
      },
    },
    include: { profile: true },
  });
}

async function main() {
  const team = await prisma.team.upsert({
    where: { name: 'Operações Porto' },
    update: {
      country: 'PT',
    },
    create: {
      name: 'Operações Porto',
      country: 'PT',
    },
  });

  const admin = await ensureUser({
    username: 'admin',
    email: 'admin@smarterhub.pt',
    password: '1234',
    role: 'ADMIN',
    fullName: 'Admin',
    workCountry: 'PT',
    localidade: 'Porto',
    cargo: 'Admin',
    funcao: 'Gestão global',
  });

  const coordinator = await ensureUser({
    username: 'joao',
    email: 'joao@smarterhub.pt',
    password: '2222',
    role: 'COORDENADOR',
    fullName: 'João',
    workCountry: 'PT',
    localidade: 'Porto',
    cargo: 'Coordenador',
    funcao: 'Coordenação de equipas',
    teamId: team.id,
  });

  const manager = await ensureUser({
    username: 'manager',
    email: 'manager@smarterhub.pt',
    password: '1212',
    role: 'MANAGER',
    fullName: 'Manager',
    workCountry: 'PT',
    localidade: 'Porto',
    cargo: 'Manager',
    funcao: 'Gestão da equipa',
    teamId: team.id,
  });

  await ensureUser({
    username: 'patrick',
    email: 'patrick@smarterhub.pt',
    password: '1212',
    role: 'COLABORADOR',
    fullName: 'Patrick',
    workCountry: 'PT',
    localidade: 'Porto',
    cargo: 'Colaborador',
    funcao: 'Operações',
    teamId: team.id,
  });

  await prisma.team.update({
    where: { id: team.id },
    data: {
      managerId: manager.id,
      coordinatorId: coordinator.id,
    },
  });

  const notificationsCount = await prisma.notification.count({
    where: { userId: admin.id },
  });

  if (notificationsCount === 0) {
    await prisma.notification.createMany({
      data: [
        {
          userId: admin.id,
          title: 'Bem-vindo',
          message: 'Administrador pronto para gerir perfis e equipas.',
        },
        {
          userId: coordinator.id,
          title: 'Nova coordenação',
          message: 'A tua área de trabalho está configurada para revisão de equipas.',
        },
      ],
    });
  }

  console.log('Seed concluído com sucesso.');
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
