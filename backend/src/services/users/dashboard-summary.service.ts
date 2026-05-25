import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';

const dashboardSummaryUserSelect = {
  id: true,
  username: true,
  email: true,
  role: true,
  isActive: true,
  team: { select: { id: true, name: true } },
  teamMemberships: {
    where: { isActive: true },
    select: {
      team: {
        select: {
          id: true,
          name: true,
        },
      },
    },
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
  createdAt: true,
} satisfies Prisma.UserSelect;

export async function loadUsersDashboardSummaryData(input: {
  collaboratorWhere: Prisma.UserWhereInput;
  requestScopeWhere: Prisma.UserWhereInput | null;
}) {
  const requestScopeWhere = input.requestScopeWhere ? { user: input.requestScopeWhere } : {};

  return Promise.allSettled([
    prisma.user.findMany({
      where: input.collaboratorWhere,
      select: dashboardSummaryUserSelect,
    }),
    prisma.profileChangeRequest.findMany({
      where: {
        status: 'PENDING',
        ...requestScopeWhere,
      },
      select: {
        userId: true,
        user: {
          select: {
            hasAccessTotal: true,
          },
        },
      },
    }),
    prisma.vacation.findMany({
      where: {
        status: 'PENDING',
        ...requestScopeWhere,
      },
      select: {
        userId: true,
        user: {
          select: {
            hasAccessTotal: true,
          },
        },
      },
    }),
    Promise.all([
      prisma.training.count({
        where: {
          status: { in: ['ASSIGNED', 'ATRIBUIDA', 'ATRIBUÍDA'] },
          ...requestScopeWhere,
        },
      }),
      prisma.training.count({
        where: {
          status: { in: ['COMPLETED', 'CONCLUIDA', 'CONCLUÍDA'] },
          ...requestScopeWhere,
        },
      }),
      prisma.training.findMany({
        where: requestScopeWhere,
        select: { horas: true },
      }),
    ]),
    prisma.profileChangeRequest.findMany({
      where: {
        status: { in: ['APPROVED', 'PARTIALLY_REJECTED', 'REJECTED'] },
        reviewedAt: { not: null },
        ...requestScopeWhere,
      },
      include: {
        user: {
          select: {
            id: true,
            username: true,
            profile: {
              select: {
                nomeAbreviado: true,
                nomeCompleto: true,
              },
            },
          },
        },
      },
      orderBy: [{ reviewedAt: 'desc' }, { createdAt: 'desc' }],
      take: 120,
    }),
  ]);
}

const dashboardCollaboratorsExportSelect = {
  id: true,
  username: true,
  email: true,
  role: true,
  isActive: true,
  team: { select: { id: true, name: true } },
  teamMemberships: {
    where: { isActive: true },
    select: {
      team: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  },
  profile: {
    select: {
      nomeAbreviado: true,
      nomeCompleto: true,
      numeroMecanografico: true,
      genero: true,
      funcao: true,
      cargo: true,
      categoriaProfissional: true,
      localidade: true,
      workCountry: true,
      dataInicioContrato: true,
      tipoContrato: true,
    },
  },
} satisfies Prisma.UserSelect;

export async function findDashboardCollaboratorsExportRows(where: Prisma.UserWhereInput) {
  return prisma.user.findMany({
    where,
    select: dashboardCollaboratorsExportSelect,
    orderBy: [{ username: 'asc' }],
  });
}

type DashboardTeamRef = { id: string; name: string };

type DashboardProfileLike = {
  nomeAbreviado?: string | null;
  nomeCompleto?: string | null;
  dataNascimento?: string | null;
  dataInicioContrato?: string | null;
  tipoContrato?: string | null;
  genero?: string | null;
  habilitacoesLiterarias?: string | null;
  cargo?: string | null;
  categoriaProfissional?: string | null;
  numeroMecanografico?: string | null;
  localidade?: string | null;
  workCountry?: string | null;
  funcao?: string | null;
  voucherNosData?: string | null;
  numeroCartaoContinente?: string | null;
};

type DashboardMembershipLike = {
  team?: DashboardTeamRef | null;
};

type DashboardCollaboratorLike = {
  id: string;
  username: string;
  email: string;
  role: string;
  isActive: boolean;
  team?: DashboardTeamRef | null;
  teamMemberships: DashboardMembershipLike[];
  profile?: DashboardProfileLike | null;
};

type DashboardPromotionHistoryLike = {
  id: string;
  createdAt: Date;
  reviewedAt: Date | null;
  status: string;
  requestedData: unknown;
  approvedFields: unknown;
  user: {
    id: string;
    username: string;
    profile: {
      nomeAbreviado: string | null;
      nomeCompleto: string | null;
    } | null;
  } | null;
};

export type DashboardFilterInput = {
  search: string;
  teamId: string;
  role: string;
  gender: string;
  function: string;
  contractTypes: string[];
  geography: string;
  level: string;
  isActive: string;
  periodStart: string;
  periodEnd: string;
};

function parseIsoDate(value?: string | null) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }

  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function yearsBetween(start: Date, end = new Date()) {
  const diff = end.getTime() - start.getTime();
  if (!Number.isFinite(diff) || diff <= 0) {
    return 0;
  }

  return diff / (365.25 * 24 * 60 * 60 * 1000);
}

function average(values: number[]) {
  if (values.length === 0) {
    return 0;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function normalizeGender(value?: string | null) {
  const normalized = (value || '').trim().toLowerCase();

  if (!normalized) {
    return 'Não informado';
  }

  if (['m', 'masculino', 'male', 'homem'].includes(normalized)) {
    return 'Masculino';
  }

  if (['f', 'feminino', 'female', 'mulher'].includes(normalized)) {
    return 'Feminino';
  }

  return 'Outro';
}

function normalizeContractType(value?: string | null) {
  return (value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function getDisplayName(user: DashboardCollaboratorLike) {
  return user.profile?.nomeAbreviado?.trim()
    || user.profile?.nomeCompleto?.trim()
    || user.username;
}

function getUserTeams(user: DashboardCollaboratorLike) {
  const map = new Map<string, DashboardTeamRef>();

  if (user.team?.id && user.team?.name) {
    map.set(user.team.id, { id: user.team.id, name: user.team.name });
  }

  for (const membership of user.teamMemberships) {
    if (membership.team?.id && membership.team?.name) {
      map.set(membership.team.id, { id: membership.team.id, name: membership.team.name });
    }
  }

  return Array.from(map.values());
}

function getHierarchyLevel(user: DashboardCollaboratorLike) {
  return user.profile?.cargo?.trim()
    || user.profile?.categoriaProfissional?.trim()
    || user.role;
}

function getGeography(user: DashboardCollaboratorLike) {
  return user.profile?.localidade?.trim()
    || user.profile?.workCountry
    || 'Não informado';
}

function getFunction(user: DashboardCollaboratorLike) {
  return user.profile?.funcao?.trim()
    || 'Não informado';
}

function buildDistribution(
  rows: DashboardCollaboratorLike[],
  getLabel: (item: DashboardCollaboratorLike) => string,
) {
  const map = new Map<string, number>();
  for (const row of rows) {
    const label = getLabel(row).trim() || 'Não informado';
    map.set(label, (map.get(label) || 0) + 1);
  }

  const total = rows.length;
  return Array.from(map.entries())
    .map(([label, count]) => ({
      label,
      count,
      share: total > 0 ? (count / total) * 100 : 0,
    }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

function buildCharacterization(rows: DashboardCollaboratorLike[]) {
  const ageValues = rows
    .map((item) => parseIsoDate(item.profile?.dataNascimento || ''))
    .filter((value): value is Date => value !== null)
    .map((birthDate) => yearsBetween(birthDate));

  const tenureValues = rows
    .map((item) => parseIsoDate(item.profile?.dataInicioContrato || ''))
    .filter((value): value is Date => value !== null)
    .map((startDate) => yearsBetween(startDate));

  const activeRows = rows.filter((item) => item.isActive !== false);
  const activeCount = activeRows.length;
  const total = rows.length;

  const eligibleNosVoucherRows = activeRows.filter((row) => {
    const isPtProfile = !row.profile?.workCountry || row.profile?.workCountry === 'PT';
    return isPtProfile && normalizeContractType(row.profile?.tipoContrato) === 'sem termo';
  });

  const requestedNosVoucherRows = eligibleNosVoucherRows.filter((row) => Boolean(row.profile?.voucherNosData?.trim()));
  const nosVoucherRate = eligibleNosVoucherRows.length > 0
    ? (requestedNosVoucherRows.length / eligibleNosVoucherRows.length) * 100
    : 0;

  const voucherRequestLeadDays = requestedNosVoucherRows
    .map((row) => {
      const contractStart = parseIsoDate(row.profile?.dataInicioContrato || '');
      const requestDate = parseIsoDate(row.profile?.voucherNosData || '');

      if (!contractStart || !requestDate) {
        return null;
      }

      const diffDays = (requestDate.getTime() - contractStart.getTime()) / (1000 * 60 * 60 * 24);
      return diffDays >= 0 ? diffDays : null;
    })
    .filter((value): value is number => typeof value === 'number');

  const voucherRequestLeadDetails = eligibleNosVoucherRows
    .map((row) => {
      const contractStart = parseIsoDate(row.profile?.dataInicioContrato || '');
      const requestDate = parseIsoDate(row.profile?.voucherNosData || '');
      const teamName = getUserTeams(row).map((team) => team.name).join(', ');
      const displayName = getDisplayName(row);

      let leadDays: number | null = null;
      let daysSinceStart: number | null = null;

      if (contractStart) {
        const referenceDate = requestDate ?? new Date();
        const diffDays = Math.floor((referenceDate.getTime() - contractStart.getTime()) / (1000 * 60 * 60 * 24));
        if (diffDays >= 0) {
          if (requestDate) {
            leadDays = diffDays;
          } else {
            daysSinceStart = diffDays;
          }
        }
      }

      return {
        id: row.id,
        name: displayName,
        teamName: teamName || 'Sem equipa',
        contractStart: row.profile?.dataInicioContrato || null,
        requestDate: row.profile?.voucherNosData?.trim() || null,
        leadDays,
        daysSinceStart,
        hasRequested: Boolean(requestDate),
      };
    })
    .sort((a, b) => {
      if (a.hasRequested !== b.hasRequested) {
        return a.hasRequested ? -1 : 1;
      }

      if (a.hasRequested) {
        return (a.leadDays ?? Number.MAX_SAFE_INTEGER) - (b.leadDays ?? Number.MAX_SAFE_INTEGER);
      }

      return a.name.localeCompare(b.name);
    });

  const continenteCardRate = activeCount > 0
    ? (activeRows.filter((r) => r.profile?.numeroCartaoContinente?.trim()).length / activeCount) * 100
    : 0;

  const functionTenureMap = new Map<string, number[]>();
  for (const row of rows) {
    const fn = getFunction(row);
    if (fn === 'Não informado') {
      continue;
    }

    const tenure = parseIsoDate(row.profile?.dataInicioContrato || '');
    if (!tenure) {
      continue;
    }

    if (!functionTenureMap.has(fn)) {
      functionTenureMap.set(fn, []);
    }

    functionTenureMap.get(fn)!.push(yearsBetween(tenure));
  }

  const avgTenureByFunction = Array.from(functionTenureMap.entries())
    .map(([label, values]) => ({ label, avgTenure: average(values), count: values.length }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  return {
    headcount: total,
    averages: {
      age: average(ageValues),
      tenure: average(tenureValues),
    },
    retentionRate: total > 0 ? (activeCount / total) * 100 : 0,
    nosVoucherRate,
    avgVoucherRequestLeadDays: voucherRequestLeadDays.length > 0 ? average(voucherRequestLeadDays) : null,
    voucherRequestLeadDetails,
    continenteCardRate,
    avgTenureByFunction,
    distributions: {
      hierarchy: buildDistribution(rows, getHierarchyLevel),
      geography: buildDistribution(rows, getGeography),
      gender: buildDistribution(rows, (item) => normalizeGender(item.profile?.genero)),
      function: buildDistribution(rows, getFunction),
    },
  };
}

function buildPromotionEvents(historyRows: DashboardPromotionHistoryLike[]) {
  return historyRows
    .filter((item) => Boolean(item.reviewedAt))
    .filter((item) => {
      const requestedData = (item.requestedData as Record<string, unknown>) || {};
      const approvedFields = (item.approvedFields as Record<string, unknown>) || {};
      const changedFields = Object.keys(requestedData);
      const approvedFieldNames = Object.keys(approvedFields);
      const requestedCargo = String(requestedData.cargo || '').trim();
      const approvedCargo = String(approvedFields.cargo || '').trim();

      const approvedWithCargo = item.status === 'APPROVED' && changedFields.includes('cargo') && requestedCargo.length > 0;
      const partialWithApprovedCargo = item.status === 'PARTIALLY_REJECTED' && approvedFieldNames.includes('cargo') && approvedCargo.length > 0;

      return approvedWithCargo || partialWithApprovedCargo;
    })
    .map((item) => ({
      id: item.id,
      userId: item.user?.id || '',
      collaborator: item.user?.profile?.nomeAbreviado?.trim()
        || String(item.user?.profile?.nomeCompleto || '').trim()
        || item.user?.username
        || 'Colaborador',
      promotedTo: String(((item.approvedFields as Record<string, unknown>)?.cargo || (item.requestedData as Record<string, unknown>)?.cargo || '')).trim() || 'Nível atualizado',
      reviewedAt: item.reviewedAt?.toISOString() || item.createdAt.toISOString(),
    }))
    .filter((item) => Boolean(item.userId))
    .sort((a, b) => new Date(b.reviewedAt).getTime() - new Date(a.reviewedAt).getTime());
}

export function filterDashboardCollaborators(
  rows: DashboardCollaboratorLike[],
  filters: DashboardFilterInput,
  periodStartDate: Date | null,
  periodEndDate: Date | null,
) {
  const periodScopedRows = rows.filter((item) => {
    if (!periodStartDate && !periodEndDate) {
      return true;
    }

    const contractStart = parseIsoDate(item.profile?.dataInicioContrato || '');
    if (!contractStart) {
      return false;
    }

    if (periodStartDate && contractStart < periodStartDate) {
      return false;
    }

    if (periodEndDate && contractStart > periodEndDate) {
      return false;
    }

    return true;
  });

  const teamOptions = Array.from(new Map(
    periodScopedRows
      .flatMap((item) => getUserTeams(item))
      .map((team) => [team.id, team]),
  ).values()).sort((a, b) => a.name.localeCompare(b.name));

  const levelOptions = Array.from(new Set(periodScopedRows.map((item) => getHierarchyLevel(item)).filter(Boolean)))
    .sort((a, b) => a.localeCompare(b));
  const geographyOptions = Array.from(new Set(periodScopedRows.map((item) => getGeography(item)).filter(Boolean)))
    .sort((a, b) => a.localeCompare(b));
  const functionOptions = Array.from(new Set(periodScopedRows.map((item) => getFunction(item)).filter(Boolean)))
    .sort((a, b) => a.localeCompare(b));
  const contractTypeOptions = Array.from(new Set(
    periodScopedRows
      .map((item) => item.profile?.tipoContrato?.trim())
      .filter((value): value is string => Boolean(value)),
  )).sort((a, b) => a.localeCompare(b));
  const genderOptions = Array.from(new Set(periodScopedRows.map((item) => normalizeGender(item.profile?.genero))))
    .sort((a, b) => a.localeCompare(b));

  const selectedRows = periodScopedRows.filter((item) => {
    const teams = getUserTeams(item);

    if (filters.teamId && !teams.some((team) => team.id === filters.teamId)) {
      return false;
    }

    if (filters.role && item.role !== filters.role) {
      return false;
    }

    if (filters.gender && normalizeGender(item.profile?.genero) !== filters.gender) {
      return false;
    }

    if (filters.function && getFunction(item) !== filters.function) {
      return false;
    }

    if (filters.contractTypes.length > 0 && !filters.contractTypes.includes(item.profile?.tipoContrato?.trim() || '')) {
      return false;
    }

    if (filters.geography && getGeography(item) !== filters.geography) {
      return false;
    }

    if (filters.level && getHierarchyLevel(item) !== filters.level) {
      return false;
    }

    if (filters.isActive === 'active' && item.isActive === false) {
      return false;
    }

    if (filters.isActive === 'inactive' && item.isActive !== false) {
      return false;
    }

    if (!filters.search) {
      return true;
    }

    const haystack = [
      getDisplayName(item),
      item.username,
      item.email,
      teams.map((team) => team.name).join(' '),
      getHierarchyLevel(item),
      getFunction(item),
      getGeography(item),
      item.profile?.numeroMecanografico || '',
    ].join(' ').toLowerCase();

    return haystack.includes(filters.search);
  });

  const selectedTeamName = filters.teamId
    ? (teamOptions.find((team) => team.id === filters.teamId)?.name || 'Equipa filtrada')
    : 'Todas as equipas';

  return {
    periodScopedRows,
    selectedRows,
    teamOptions,
    levelOptions,
    geographyOptions,
    functionOptions,
    contractTypeOptions,
    genderOptions,
    selectedTeamName,
  };
}

export function buildDashboardTeamInsights(
  periodScopedRows: DashboardCollaboratorLike[],
  selectedRows: DashboardCollaboratorLike[],
  filters: DashboardFilterInput,
  filterOptions: {
    teamOptions: DashboardTeamRef[];
    genderOptions: string[];
    functionOptions: string[];
    contractTypeOptions: string[];
    geographyOptions: string[];
    levelOptions: string[];
    selectedTeamName: string;
  },
) {
  return {
    appliedFilters: {
      search: filters.search,
      teamId: filters.teamId,
      role: filters.role,
      gender: filters.gender,
      function: filters.function,
      contractTypes: filters.contractTypes,
      geography: filters.geography,
      level: filters.level,
      isActive: filters.isActive,
      periodStart: filters.periodStart,
      periodEnd: filters.periodEnd,
    },
    selectedTeamName: filterOptions.selectedTeamName,
    availableFilters: {
      teams: filterOptions.teamOptions,
      roles: ['COLABORADOR', 'MANAGER', 'COORDENADOR', 'ADMIN'],
      genders: filterOptions.genderOptions,
      functions: filterOptions.functionOptions,
      contractTypes: filterOptions.contractTypeOptions,
      geographies: filterOptions.geographyOptions,
      levels: filterOptions.levelOptions,
      activeStates: [
        { value: 'all', label: 'Todos' },
        { value: 'active', label: 'Ativos' },
        { value: 'inactive', label: 'Inativos' },
      ],
    },
    selected: buildCharacterization(selectedRows),
    company: buildCharacterization(periodScopedRows),
  };
}

export function buildDashboardSummaryAnalytics(
  periodScopedRows: DashboardCollaboratorLike[],
  historyRows: DashboardPromotionHistoryLike[],
) {
  const activeUsers = periodScopedRows.filter((user) => user.isActive !== false).length;
  const inactiveUsers = Math.max(0, periodScopedRows.length - activeUsers);

  const ageValues = periodScopedRows
    .map((item) => parseIsoDate(item.profile?.dataNascimento || ''))
    .filter((value): value is Date => value !== null)
    .map((birthDate) => yearsBetween(birthDate));

  const tenureValues = periodScopedRows
    .map((item) => parseIsoDate(item.profile?.dataInicioContrato || ''))
    .filter((value): value is Date => value !== null)
    .map((startDate) => yearsBetween(startDate));

  const educationMap = new Map<string, number>();
  const areaGenderMap = new Map<string, { Masculino: number; Feminino: number; Outro: number; 'Não informado': number }>();
  const timeInLevelMap = new Map<string, number[]>();

  const promotionEvents = buildPromotionEvents(historyRows);
  const latestPromotionByUser = new Map<string, string>();
  for (const event of promotionEvents) {
    if (!latestPromotionByUser.has(event.userId)) {
      latestPromotionByUser.set(event.userId, event.reviewedAt);
    }
  }

  for (const collaborator of periodScopedRows) {
    const education = (collaborator.profile?.habilitacoesLiterarias || '').trim() || 'Não informado';
    educationMap.set(education, (educationMap.get(education) || 0) + 1);

    const area = (collaborator.team?.name || collaborator.profile?.funcao || 'Sem área').trim() || 'Sem área';
    if (!areaGenderMap.has(area)) {
      areaGenderMap.set(area, { Masculino: 0, Feminino: 0, Outro: 0, 'Não informado': 0 });
    }

    const genderBucket = areaGenderMap.get(area)!;
    const gender = normalizeGender(collaborator.profile?.genero);
    genderBucket[gender as keyof typeof genderBucket] += 1;

    const currentLevel = (collaborator.profile?.cargo || collaborator.profile?.funcao || 'Sem nível').trim() || 'Sem nível';
    const promotionDate = latestPromotionByUser.get(collaborator.id);
    const baseDate = promotionDate ? new Date(promotionDate) : parseIsoDate(collaborator.profile?.dataInicioContrato || '');

    if (baseDate) {
      if (!timeInLevelMap.has(currentLevel)) {
        timeInLevelMap.set(currentLevel, []);
      }

      timeInLevelMap.get(currentLevel)!.push(yearsBetween(baseDate));
    }
  }

  const educationDistribution = Array.from(educationMap.entries())
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 6);

  const genderByArea = Array.from(areaGenderMap.entries())
    .map(([area, counts]) => ({
      area,
      counts,
      total: Object.values(counts).reduce((sum, value) => sum + value, 0),
    }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 6);

  const timeInCurrentLevelByCargo = Array.from(timeInLevelMap.entries())
    .map(([cargo, durations]) => ({
      cargo,
      averageYears: average(durations),
      people: durations.length,
    }))
    .sort((a, b) => b.people - a.people)
    .slice(0, 6);

  return {
    activeUsers,
    inactiveUsers,
    averages: {
      age: average(ageValues),
      tenure: average(tenureValues),
    },
    charts: {
      educationDistribution,
      genderByArea,
      timeInCurrentLevelByCargo,
    },
    promotionEvents,
  };
}

export function mapDashboardCollaboratorsExportRows(rows: DashboardCollaboratorLike[]) {
  return rows
    .map((item) => ({
      id: item.id,
      nome: getDisplayName(item),
      username: item.username,
      email: item.email,
      numeroMecanografico: item.profile?.numeroMecanografico || '',
      role: item.role,
      estado: item.isActive === false ? 'Inativo' : 'Ativo',
      equipa: getUserTeams(item).map((team) => team.name).join(' | ') || 'Sem equipa',
      nivel: getHierarchyLevel(item),
      funcao: getFunction(item),
      genero: normalizeGender(item.profile?.genero),
      geografia: getGeography(item),
      dataInicioContrato: item.profile?.dataInicioContrato || '',
    }))
    .sort((a, b) => a.nome.localeCompare(b.nome));
}
