import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';

const directoryUserSelect = {
  id: true,
  username: true,
  email: true,
  role: true,
  teamId: true,
  team: { select: { id: true, name: true } },
  teamMemberships: {
    where: { isActive: true },
    select: {
      teamId: true,
      membershipRole: true,
      isApprover: true,
      approvalLevel: true,
      team: { select: { id: true, name: true } },
    },
  },
  managedTeams: {
    select: { id: true, name: true },
  },
  profile: {
    select: {
      nomeAbreviado: true,
      nomeCompleto: true,
      dataNascimento: true,
      genero: true,
      estadoCivil: true,
      habilitacoesLiterarias: true,
      curso: true,
      faculdade: true,
      emailPessoal: true,
      telemovel: true,
      nacionalidade: true,
      githubUser: true,
      moradaFiscal: true,
      endereco: true,
      localidade: true,
      codigoPostal: true,
      matriculaCarro: true,
      localNascimentoPais: true,
      localNascimentoCidade: true,
      nomePai: true,
      nomeMae: true,
      cartaoCidadao: true,
      validadeCartaoCidadao: true,
      nif: true,
      cpf: true,
      pis: true,
      ctps: true,
      ctpsSerie: true,
      ctpsDataExpedicao: true,
      rg: true,
      rgOrgaoEmissor: true,
      rgDataExpedicao: true,
      cnh: true,
      cnhCategoria: true,
      cnhDataValidade: true,
      tituloEleitor: true,
      zonaEleitoral: true,
      secaoEleitoral: true,
      certificadoReservista: true,
      niss: true,
      iban: true,
      situacaoIrs: true,
      numeroDependentes: true,
      declaracaoIrs: true,
      irsJovem: true,
      anoPrimeiroDesconto: true,
      primeiroEmprego: true,
      recebeAposentadoria: true,
      recebeSeguroDesemprego: true,
      valeTransporte: true,
      numeroCartaoContinente: true,
      voucherNosData: true,
      comprovativoMoradaFiscal: true,
      comprovativoCartaoCidadao: true,
      comprovativoIban: true,
      comprovativoCartaoContinente: true,
      criminalRecordUrl: true,
      contactoEmergenciaNome: true,
      contactoEmergenciaParentesco: true,
      contactoEmergenciaNumero: true,
      cargo: true,
      categoriaProfissional: true,
      numeroMecanografico: true,
      funcao: true,
      dataInicioContrato: true,
      dataFimContrato: true,
      tipoContrato: true,
      regimeHorario: true,
      hourBankLimitHours: true,
      workCountry: true,
      brWorkState: true,
    },
  },
} satisfies Prisma.UserSelect;

export async function findDirectoryUsers(where: Prisma.UserWhereInput, limit: number) {
  return prisma.user.findMany({
    where,
    select: directoryUserSelect,
    take: limit,
    orderBy: {
      createdAt: 'desc',
    },
  });
}

const collaboratorsUserSelect = {
  id: true,
  username: true,
  email: true,
  role: true,
  isRootAccess: true,
  hasAccessTotal: true,
  isActive: true,
  deactivatedAt: true,
  createdAt: true,
  updatedAt: true,
  teamId: true,
  team: { select: { id: true, name: true } },
  teamMemberships: {
    where: { isActive: true },
    select: {
      teamId: true,
      membershipRole: true,
      team: { select: { id: true, name: true } },
    },
  },
  managedTeams: {
    select: { id: true, name: true },
  },
  profile: {
    select: {
      nomeAbreviado: true,
      nomeCompleto: true,
      dataNascimento: true,
      dataInicioContrato: true,
      tipoContrato: true,
      genero: true,
      habilitacoesLiterarias: true,
      cargo: true,
      categoriaProfissional: true,
      numeroMecanografico: true,
      localidade: true,
      workCountry: true,
      funcao: true,
      voucherNosData: true,
      numeroCartaoContinente: true,
    },
  },
} satisfies Prisma.UserSelect;

export async function findCollaboratorsWithPagination(input: {
  where: Prisma.UserWhereInput;
  page: number;
  pageSize: number;
  orderBy: Prisma.UserOrderByWithRelationInput;
}) {
  const { where, page, pageSize, orderBy } = input;

  const [total, rows] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      skip: (page - 1) * pageSize,
      take: pageSize,
      orderBy,
      select: collaboratorsUserSelect,
    }),
  ]);

  return { total, rows };
}
