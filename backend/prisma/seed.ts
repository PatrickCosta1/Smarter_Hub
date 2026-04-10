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
  fullName: string;
  workCountry: 'PT' | 'BR';
  localidade: string;
  cargo: string;
  funcao: string;
  teamId?: string | null;
  dataInicioContrato?: string;
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
      teamId: params.role === 'ADMIN' ? null : params.teamId ?? null,
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
          dataInicioContrato: params.dataInicioContrato ?? '2024-01-01',
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
    prisma.permission.deleteMany(),
    prisma.vacationApproval.deleteMany(),
    prisma.vacation.deleteMany(),
    prisma.profileChangeRequest.deleteMany(),
    prisma.training.deleteMany(),
    prisma.notification.deleteMany(),
    prisma.teamMembership.deleteMany(),
    prisma.profile.deleteMany(),
    prisma.user.deleteMany(),
    prisma.team.deleteMany(),
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

  const permissions: Array<{ id: string; code: string }> = await prisma.permission.findMany({ orderBy: { code: 'asc' } });
  const permissionByCode = new Map(permissions.map((item: { id: string; code: string }) => [item.code, item]));

  const tPeople = await createUser({
    username: 't.people',
    email: 't.people@tlantic.com',
    password: 'people123',
    role: 'ADMIN',
    isRootAccess: true,
    fullName: 'T People',
    workCountry: 'PT',
    localidade: 'Porto',
    cargo: 'People',
    funcao: 'Administração raiz do sistema',
  });

  const sara = await createUser({
    username: 'sara.magalhaes',
    email: 'sara.magalhaes@tlantic.com',
    password: 'sara123',
    role: 'ADMIN',
    fullName: 'Sara Magalhães',
    workCountry: 'PT',
    localidade: 'Porto',
    cargo: 'CEO',
    funcao: 'Direção geral',
  });

  await prisma.userPermission.createMany({
    data: permissions.flatMap((permission: { id: string; code: string }) => ([
      {
        userId: tPeople.id,
        permissionId: permission.id,
        isEnabled: true,
        grantedById: tPeople.id,
      },
      {
        userId: sara.id,
        permissionId: permission.id,
        isEnabled: true,
        grantedById: tPeople.id,
      },
    ])),
  });

  await prisma.permissionGrant.createMany({
    data: permissions.flatMap((permission: { id: string; code: string }) => ([
      {
        actorUserId: tPeople.id,
        targetUserId: tPeople.id,
        permissionId: permission.id,
        action: 'GRANT',
        reason: 'Seed inicial do user raiz.',
      },
      {
        actorUserId: tPeople.id,
        targetUserId: sara.id,
        permissionId: permission.id,
        action: 'GRANT',
        reason: 'Seed inicial da Sara com acesso total delegado.',
      },
    ])),
  });

  console.log('Seed de permissões concluído com sucesso.');
  console.log('Utilizadores iniciais:');
  console.log('- t.people / people123');
  console.log('- sara.magalhaes / sara123');
  console.log(`Permissões criadas: ${permissionByCode.size}`);
  return;

  const opsPT = await prisma.team.create({ data: { name: 'Operações PT', country: 'PT' } });
  const opsNorte = await prisma.team.create({ data: { name: 'Operações PT - Norte', country: 'PT', parentTeamId: opsPT.id } });
  const produtoPT = await prisma.team.create({ data: { name: 'Produto PT', country: 'PT' } });
  const suporteBR = await prisma.team.create({ data: { name: 'Suporte BR', country: 'BR' } });

  const admin = await createUser({
    username: 'admin',
    email: 'admin@smarterhub.test',
    password: 'admin123',
    role: 'ADMIN',
    fullName: 'Marta Admin',
    workCountry: 'PT',
    localidade: 'Porto',
    cargo: 'Admin',
    funcao: 'Gestão global',
  });

  const coordenadora = await createUser({
    username: 'coord_rita',
    email: 'rita.coordenadora@smarterhub.test',
    password: 'coord123',
    role: 'COORDENADOR',
    fullName: 'Rita Coordenadora',
    workCountry: 'PT',
    localidade: 'Porto',
    cargo: 'Coordenadora',
    funcao: 'Coordenação de operações',
    teamId: opsPT.id,
  });

  const managerNorte = await createUser({
    username: 'mgr_nuno',
    email: 'nuno.manager@smarterhub.test',
    password: 'manager123',
    role: 'MANAGER',
    fullName: 'Nuno Manager',
    workCountry: 'PT',
    localidade: 'Porto',
    cargo: 'Manager',
    funcao: 'Gestão de equipa Norte',
    teamId: opsNorte.id,
  });

  const managerProduto = await createUser({
    username: 'mgr_ines',
    email: 'ines.manager@smarterhub.test',
    password: 'manager123',
    role: 'MANAGER',
    fullName: 'Inês Manager',
    workCountry: 'PT',
    localidade: 'Lisboa',
    cargo: 'Manager',
    funcao: 'Gestão de produto',
    teamId: produtoPT.id,
  });

  const colaboradoraAna = await createUser({
    username: 'ana',
    email: 'ana@smarterhub.test',
    password: 'user123',
    role: 'COLABORADOR',
    fullName: 'Ana Santos',
    workCountry: 'PT',
    localidade: 'Porto',
    cargo: 'Colaboradora',
    funcao: 'Operações',
    teamId: opsNorte.id,
    dataInicioContrato: '2023-02-01',
  });

  const colaboradorBruno = await createUser({
    username: 'bruno',
    email: 'bruno@smarterhub.test',
    password: 'user123',
    role: 'COLABORADOR',
    fullName: 'Bruno Costa',
    workCountry: 'PT',
    localidade: 'Porto',
    cargo: 'Colaborador',
    funcao: 'Operações',
    teamId: opsNorte.id,
    dataInicioContrato: '2022-04-15',
  });

  const colaboradoraCarla = await createUser({
    username: 'carla',
    email: 'carla@smarterhub.test',
    password: 'user123',
    role: 'COLABORADOR',
    fullName: 'Carla Silva',
    workCountry: 'PT',
    localidade: 'Lisboa',
    cargo: 'Colaboradora',
    funcao: 'Produto',
    teamId: produtoPT.id,
    dataInicioContrato: '2024-01-10',
  });

  const colaboradorDiego = await createUser({
    username: 'diego',
    email: 'diego@smarterhub.test',
    password: 'user123',
    role: 'COLABORADOR',
    fullName: 'Diego Souza',
    workCountry: 'BR',
    localidade: 'São Paulo',
    cargo: 'Analista',
    funcao: 'Suporte',
    teamId: suporteBR.id,
    dataInicioContrato: '2023-07-01',
  });

  const convidado = await createUser({
    username: 'guest_demo',
    email: 'guest@smarterhub.test',
    password: 'guest123',
    role: 'CONVIDADO',
    fullName: 'Convidado Demo',
    workCountry: 'PT',
    localidade: 'Porto',
    cargo: 'Convidado',
    funcao: 'Onboarding',
  });

  await prisma.team.update({
    where: { id: opsPT.id },
    data: { coordinatorId: coordenadora.id },
  });
  await prisma.team.update({
    where: { id: opsNorte.id },
    data: { managerId: managerNorte.id, coordinatorId: coordenadora.id },
  });
  await prisma.team.update({
    where: { id: produtoPT.id },
    data: { managerId: managerProduto.id, coordinatorId: coordenadora.id },
  });

  await prisma.teamMembership.createMany({
    data: [
      { userId: coordenadora.id, teamId: opsPT.id, membershipRole: 'COORDINATOR', isApprover: true, approvalLevel: 2, isActive: true },
      { userId: coordenadora.id, teamId: opsNorte.id, membershipRole: 'COORDINATOR', isApprover: true, approvalLevel: 2, isActive: true },
      { userId: coordenadora.id, teamId: produtoPT.id, membershipRole: 'COORDINATOR', isApprover: true, approvalLevel: 2, isActive: true },

      { userId: managerNorte.id, teamId: opsNorte.id, membershipRole: 'MANAGER', isApprover: true, approvalLevel: 1, isActive: true },
      { userId: managerProduto.id, teamId: produtoPT.id, membershipRole: 'MANAGER', isApprover: true, approvalLevel: 1, isActive: true },

      { userId: colaboradoraAna.id, teamId: opsNorte.id, membershipRole: 'PARTICIPANT', isApprover: false, isActive: true },
      { userId: colaboradoraAna.id, teamId: produtoPT.id, membershipRole: 'PARTICIPANT', isApprover: false, isActive: true },
      { userId: colaboradorBruno.id, teamId: opsNorte.id, membershipRole: 'PARTICIPANT', isApprover: false, isActive: true },
      { userId: colaboradoraCarla.id, teamId: produtoPT.id, membershipRole: 'PARTICIPANT', isApprover: false, isActive: true },
      { userId: colaboradorDiego.id, teamId: suporteBR.id, membershipRole: 'PARTICIPANT', isApprover: false, isActive: true },
    ],
  });

  await prisma.training.createMany({
    data: [
      {
        userId: colaboradoraAna.id,
        nome: 'Segurança da Informação',
        horas: 6,
        duracao: '10/03/2026-10/03/2026',
        entidade: 'Academia Interna',
        status: 'COMPLETED',
        dataConclusao: '2026-03-10',
        assignedByUserId: managerNorte.id,
      },
      {
        userId: colaboradorBruno.id,
        nome: 'Gestão de Incidentes',
        horas: 8,
        duracao: '22/03/2026-23/03/2026',
        entidade: 'Academia Interna',
        status: 'COMPLETED',
        dataConclusao: '2026-03-23',
        assignedByUserId: managerNorte.id,
      },
      {
        userId: colaboradorDiego.id,
        nome: 'Atendimento Premium',
        horas: 4,
        duracao: '05/02/2026-05/02/2026',
        entidade: 'Parceiro Externo',
        status: 'COMPLETED',
        dataConclusao: '2026-02-05',
        assignedByUserId: admin.id,
      },
      {
        userId: colaboradoraCarla.id,
        nome: 'Power BI Operacional',
        horas: 12,
        duracao: '15/04/2026-17/04/2026',
        entidade: 'RH Academy',
        status: 'ASSIGNED',
        dataConclusao: '',
        assignedByUserId: admin.id,
      },
      {
        userId: colaboradorBruno.id,
        nome: 'Comunicação com Cliente',
        horas: 3,
        duracao: '2 sessões',
        entidade: 'Autoestudo',
        status: 'CONCLUIDA',
        dataConclusao: '2026-01-14',
        assignedByUserId: null,
      },
      {
        userId: colaboradoraAna.id,
        nome: 'Excel Avançado',
        horas: 5,
        duracao: '29/04/2026-30/04/2026',
        entidade: 'Academia Interna',
        status: 'ASSIGNED',
        dataConclusao: '',
        assignedByUserId: managerNorte.id,
      },
    ],
  });

  const approvedVacationAna = await prisma.vacation.create({
    data: {
      userId: colaboradoraAna.id,
      contextTeamId: opsNorte.id,
      dataInicio: '2026-07-14',
      dataFim: '2026-07-18',
      partialDay: 'FULL',
      requestType: 'VACATION',
      observacoes: 'Férias de verão',
      status: 'APPROVED',
      reviewedById: coordenadora.id,
      reviewedAt: new Date(),
      reviewReason: 'Aprovado em cadeia completa.',
      approvedByRole: 'COORDENADOR',
    },
  });

  await prisma.vacation.create({
    data: {
      userId: colaboradorBruno.id,
      contextTeamId: opsNorte.id,
      dataInicio: '2026-04-21',
      dataFim: '2026-04-24',
      partialDay: 'FULL',
      requestType: 'VACATION',
      observacoes: 'Pausa curta no mes corrente para validar calendario.',
      status: 'APPROVED',
      reviewedById: managerNorte.id,
      reviewedAt: new Date(),
      reviewReason: 'Aprovado na linha 1.',
      approvedByRole: 'MANAGER',
    },
  });

  const pendingHalfDayBruno = await prisma.vacation.create({
    data: {
      userId: colaboradorBruno.id,
      contextTeamId: opsNorte.id,
      dataInicio: '2026-08-12',
      dataFim: '2026-08-12',
      partialDay: 'AM',
      requestType: 'VACATION',
      observacoes: 'Consulta médica de familiar à tarde.',
      status: 'PENDING',
      approvedByRole: '',
    },
  });

  await prisma.vacationApproval.createMany({
    data: [
      {
        vacationId: pendingHalfDayBruno.id,
        approverId: managerNorte.id,
        approvalLevel: 1,
        status: 'PENDING',
        reason: '',
      },
      {
        vacationId: pendingHalfDayBruno.id,
        approverId: coordenadora.id,
        approvalLevel: 2,
        status: 'WAITING',
        reason: '',
      },
    ],
  });

  const rejectedAbsenceCarla = await prisma.vacation.create({
    data: {
      userId: colaboradoraCarla.id,
      contextTeamId: produtoPT.id,
      dataInicio: '2026-09-03',
      dataFim: '2026-09-04',
      partialDay: 'FULL',
      requestType: 'ABSENCE_TRAINING',
      observacoes: 'Workshop externo sem validação prévia.',
      status: 'REJECTED',
      reviewedById: managerProduto.id,
      reviewedAt: new Date(),
      reviewReason: 'Necessário plano de cobertura da equipa.',
      approvedByRole: 'MANAGER',
    },
  });

  await prisma.vacationApproval.create({
    data: {
      vacationId: rejectedAbsenceCarla.id,
      approverId: managerProduto.id,
      approvalLevel: 1,
      status: 'REJECTED',
      decidedAt: new Date(),
      reason: 'Necessário plano de cobertura da equipa.',
    },
  });

  const rootApprovedVersion = await prisma.vacation.create({
    data: {
      userId: colaboradoraAna.id,
      contextTeamId: produtoPT.id,
      dataInicio: '2026-11-10',
      dataFim: '2026-11-12',
      partialDay: 'FULL',
      requestType: 'VACATION',
      observacoes: 'Pedido original (substituído)',
      status: 'CANCELLED',
      reviewReason: 'Pedido substituído por nova versão.',
      approvedByRole: 'MANAGER',
      versionNumber: 1,
    },
  });

  const version2Pending = await prisma.vacation.create({
    data: {
      userId: colaboradoraAna.id,
      contextTeamId: produtoPT.id,
      versionOfId: rootApprovedVersion.id,
      versionNumber: 2,
      dataInicio: '2026-11-11',
      dataFim: '2026-11-13',
      partialDay: 'FULL',
      requestType: 'VACATION',
      observacoes: 'Nova versão para ajuste de planeamento.',
      status: 'PENDING',
      approvedByRole: '',
    },
  });

  await prisma.vacationApproval.createMany({
    data: [
      {
        vacationId: version2Pending.id,
        approverId: managerProduto.id,
        approvalLevel: 1,
        status: 'PENDING',
        reason: '',
      },
      {
        vacationId: version2Pending.id,
        approverId: coordenadora.id,
        approvalLevel: 2,
        status: 'WAITING',
        reason: '',
      },
    ],
  });

  await prisma.profileChangeRequest.create({
    data: {
      userId: colaboradorBruno.id,
      requestedData: {
        telemovel: '+351910000123',
        endereco: 'Rua de Teste, Porto',
      },
      changesSummary: 'Atualização de telemóvel e morada.',
      status: 'PENDING',
    },
  });

  await prisma.profileChangeRequest.create({
    data: {
      userId: colaboradoraAna.id,
      requestedData: {
        iban: 'PT50000000000000000000001',
      },
      changesSummary: 'Atualização de IBAN para processamento salarial.',
      status: 'REJECTED',
      reviewedById: managerNorte.id,
      reviewedAt: new Date(),
      reviewReason: 'Necessário comprovativo bancário atualizado.',
    },
  });

  await prisma.notification.createMany({
    data: [
      {
        userId: admin.id,
        title: 'Seed de testes aplicado',
        message: 'A base foi populada com dados completos para validação de fluxos.',
      },
      {
        userId: managerNorte.id,
        title: 'Pedido pendente',
        message: 'Tens um pedido de férias em meio-dia para decisão na linha 1.',
      },
      {
        userId: coordenadora.id,
        title: 'Pedidos em espera',
        message: 'Existem pedidos na linha 2 a aguardar decisão após linha 1.',
      },
      {
        userId: convidado.id,
        title: 'Onboarding disponível',
        message: 'Consulta a área de onboarding para conhecer o portal.',
      },
    ],
  });

  console.log('Seed concluído com sucesso.');
  console.log('Utilizadores de teste:');
  console.log('- admin / admin123');
  console.log('- coord_rita / coord123');
  console.log('- mgr_nuno / manager123');
  console.log('- mgr_ines / manager123');
  console.log('- ana / user123');
  console.log('- bruno / user123');
  console.log('- carla / user123');
  console.log('- diego / user123');
  console.log('- guest_demo / guest123');
  console.log(`Exemplo aprovado: ${approvedVacationAna.id}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
