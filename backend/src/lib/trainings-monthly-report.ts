import PDFDocument from 'pdfkit';
import type { PrismaClient } from '@prisma/client';

type PdfDoc = InstanceType<typeof PDFDocument>;

export type TrainingMonthlyReportHierarchyBreakdown = {
  level: string;
  upcomingCount: number;
};

export type TrainingMonthlyReportUpcomingItem = {
  trainingId: string;
  trainingName: string;
  status: string;
  startDate: string;
  hours: number;
  entity: string;
  collaboratorId: string;
  collaboratorName: string;
  hierarchyLevel: string;
  requestedByName: string;
};

export type TrainingMonthlyReportTeamSummary = {
  teamId: string;
  teamName: string;
  upcomingTrainings: number;
  upcomingHours: number;
  collaborators: number;
  completedInMonth: number;
  assignedInMonth: number;
  completionRate: number;
  hierarchyBreakdown: TrainingMonthlyReportHierarchyBreakdown[];
  upcoming: TrainingMonthlyReportUpcomingItem[];
};

export type TrainingMonthlyReport = {
  month: string;
  windowStart: string;
  windowEnd: string;
  generatedAt: string;
  totals: {
    teams: number;
    collaborators: number;
    upcomingTrainings: number;
    upcomingHours: number;
    assignedInMonth: number;
    completedInMonth: number;
    completionRate: number;
  };
  teams: TrainingMonthlyReportTeamSummary[];
};

const TRAININGS_MONTHLY_SWEEP_STATE_KEY = 'trainings_monthly_upcoming_sweep_last_month';

function normalizeMonthInput(input?: string) {
  const trimmed = String(input || '').trim();
  const match = /^(\d{4})-(\d{2})$/.exec(trimmed);
  if (!match) {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    return `${year}-${month}`;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    throw new Error('Mês inválido. Usa o formato YYYY-MM.');
  }

  return `${match[1]}-${match[2]}`;
}

function toDateOnlyString(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function resolveMonthBounds(month: string) {
  const [yearText, monthText] = month.split('-');
  const year = Number(yearText);
  const monthIndex = Number(monthText) - 1;
  const monthStart = new Date(year, monthIndex, 1);
  const monthEnd = new Date(year, monthIndex + 1, 0);
  const windowStart = new Date(monthStart);
  // Próximos 3 meses = mês corrente + 2 meses seguintes.
  const windowEnd = new Date(year, monthIndex + 3, 0);

  return {
    monthStart,
    monthEnd,
    windowStart,
    windowEnd,
    monthStartText: toDateOnlyString(monthStart),
    monthEndText: toDateOnlyString(monthEnd),
    windowStartText: toDateOnlyString(windowStart),
    windowEndText: toDateOnlyString(windowEnd),
  };
}

function parseDateOnly(value: string) {
  const normalized = String(value || '').trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(normalized);
  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(year, month - 1, day);

  if (
    Number.isNaN(parsed.getTime())
    || parsed.getFullYear() !== year
    || parsed.getMonth() !== month - 1
    || parsed.getDate() !== day
  ) {
    return null;
  }

  return parsed;
}

function formatHours(value: number) {
  return Math.round(value * 100) / 100;
}

function formatTrainingStatus(status: string) {
  const normalized = String(status || '').trim().toUpperCase();
  if (normalized === 'ASSIGNED') {
    return 'Atribuida';
  }
  if (normalized === 'EM_CURSO') {
    return 'Em curso';
  }
  if (normalized === 'COMPLETED') {
    return 'Concluida';
  }
  return normalized || 'Sem estado';
}

function formatReportMonth(month: string) {
  const [yearText, monthText] = String(month || '').split('-');
  const year = Number(yearText);
  const monthIndex = Number(monthText) - 1;
  if (!Number.isInteger(year) || !Number.isInteger(monthIndex) || monthIndex < 0 || monthIndex > 11) {
    return month;
  }

  const date = new Date(year, monthIndex, 1);
  return new Intl.DateTimeFormat('pt-PT', { month: 'long', year: 'numeric' }).format(date);
}

function formatDatePt(value: string) {
  const parsed = parseDateOnly(value);
  if (!parsed) {
    return value;
  }

  const day = String(parsed.getDate()).padStart(2, '0');
  const month = String(parsed.getMonth() + 1).padStart(2, '0');
  const year = parsed.getFullYear();
  return `${day}/${month}/${year}`;
}

function safeCollaboratorName(user: {
  username: string;
  profile?: { nomeAbreviado: string; nomeCompleto: string; categoriaProfissional: string; cargo: string } | null;
}) {
  const shortName = String(user.profile?.nomeAbreviado || '').trim();
  if (shortName) {
    return shortName;
  }

  const fullName = String(user.profile?.nomeCompleto || '').trim();
  return fullName || user.username;
}

function safeAssignedByName(user?: {
  username: string;
  profile?: { nomeAbreviado?: string; nomeCompleto?: string } | null;
}) {
  if (!user) {
    return '-';
  }

  const shortName = String(user.profile?.nomeAbreviado || '').trim();
  if (shortName) {
    return shortName;
  }

  const fullName = String(user.profile?.nomeCompleto || '').trim();
  return fullName || user.username || '-';
}

function resolveHierarchyLevel(user: {
  role: string;
  profile?: { categoriaProfissional: string; cargo: string } | null;
}) {
  const categoria = String(user.profile?.categoriaProfissional || '').trim();
  if (categoria) {
    return categoria;
  }

  const cargo = String(user.profile?.cargo || '').trim();
  if (cargo) {
    return cargo;
  }

  return user.role;
}

function resolveTeamName(user: {
  team?: { id: string; name: string } | null;
  teamMemberships?: Array<{ team?: { id: string; name: string } | null }>;
}) {
  const primary = user.team;
  if (primary?.id && String(primary.name || '').trim()) {
    return { id: primary.id, name: String(primary.name).trim() };
  }

  const membership = (user.teamMemberships || []).find((item) => item.team?.id && String(item.team?.name || '').trim());
  if (membership?.team?.id && membership.team.name) {
    return { id: membership.team.id, name: membership.team.name.trim() };
  }

  return { id: 'sem-equipa', name: 'Sem equipa' };
}

export async function buildTrainingMonthlyReport(
  prisma: PrismaClient,
  options?: { month?: string; teamId?: string },
): Promise<TrainingMonthlyReport> {
  const month = normalizeMonthInput(options?.month);
  const bounds = resolveMonthBounds(month);

  const upcomingRows = await prisma.training.findMany({
    where: {
      dataInicio: {
        gte: bounds.windowStartText,
        lte: bounds.windowEndText,
      },
      user: {
        isActive: true,
      },
    },
    select: {
      id: true,
      nome: true,
      horas: true,
      entidade: true,
      dataInicio: true,
      status: true,
      user: {
        select: {
          id: true,
          username: true,
          role: true,
          team: { select: { id: true, name: true } },
          teamMemberships: {
            where: { isActive: true },
            select: {
              team: { select: { id: true, name: true } },
            },
          },
          profile: {
            select: {
              nomeAbreviado: true,
              nomeCompleto: true,
              categoriaProfissional: true,
              cargo: true,
            },
          },
        },
      },
      assignedBy: {
        select: {
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
    orderBy: [{ dataInicio: 'asc' }, { nome: 'asc' }],
  });

  const completedInMonthRows = await prisma.training.findMany({
    where: {
      completedAt: {
        gte: bounds.monthStart,
        lte: bounds.monthEnd,
      },
      user: {
        isActive: true,
      },
    },
    select: {
      id: true,
      user: {
        select: {
          id: true,
          team: { select: { id: true, name: true } },
          teamMemberships: {
            where: { isActive: true },
            select: {
              team: { select: { id: true, name: true } },
            },
          },
        },
      },
    },
  });

  const teamMap = new Map<string, TrainingMonthlyReportTeamSummary>();
  const allCollaborators = new Set<string>();
  let assignedInMonthTotal = 0;

  for (const row of upcomingRows) {
    const parsedStart = parseDateOnly(row.dataInicio);
    if (!parsedStart) {
      continue;
    }

    const team = resolveTeamName(row.user);
    if (options?.teamId && options.teamId !== team.id) {
      continue;
    }

    const hierarchyLevel = resolveHierarchyLevel(row.user);
    const collaboratorName = safeCollaboratorName(row.user);
    const requestedByName = safeAssignedByName(row.assignedBy);

    const key = team.id;
    const existing = teamMap.get(key) || {
      teamId: team.id,
      teamName: team.name,
      upcomingTrainings: 0,
      upcomingHours: 0,
      collaborators: 0,
      completedInMonth: 0,
      assignedInMonth: 0,
      completionRate: 0,
      hierarchyBreakdown: [],
      upcoming: [],
    };

    existing.upcomingTrainings += 1;
    existing.upcomingHours = formatHours(existing.upcomingHours + Number(row.horas || 0));
    existing.upcoming.push({
      trainingId: row.id,
      trainingName: row.nome,
      status: row.status,
      startDate: row.dataInicio,
      hours: formatHours(Number(row.horas || 0)),
      entity: row.entidade || '-',
      collaboratorId: row.user.id,
      collaboratorName,
      hierarchyLevel,
      requestedByName,
    });

    const breakdownMap = new Map(existing.hierarchyBreakdown.map((item) => [item.level, item.upcomingCount]));
    breakdownMap.set(hierarchyLevel, (breakdownMap.get(hierarchyLevel) || 0) + 1);
    existing.hierarchyBreakdown = Array.from(breakdownMap.entries())
      .map(([level, upcomingCount]) => ({ level, upcomingCount }))
      .sort((a, b) => b.upcomingCount - a.upcomingCount || a.level.localeCompare(b.level, 'pt-PT'));

    const collaboratorSet = new Set(existing.upcoming.map((item) => item.collaboratorId));
    existing.collaborators = collaboratorSet.size;

    if (row.dataInicio >= bounds.monthStartText && row.dataInicio <= bounds.monthEndText) {
      existing.assignedInMonth += 1;
      assignedInMonthTotal += 1;
    }

    teamMap.set(key, existing);
    allCollaborators.add(row.user.id);
  }

  for (const row of completedInMonthRows) {
    const team = resolveTeamName(row.user);
    if (options?.teamId && options.teamId !== team.id) {
      continue;
    }

    const summary = teamMap.get(team.id);
    if (!summary) {
      continue;
    }

    summary.completedInMonth += 1;
  }

  const teams = Array.from(teamMap.values())
    .map((team) => ({
      ...team,
      completionRate: team.assignedInMonth > 0
        ? Number(((team.completedInMonth / team.assignedInMonth) * 100).toFixed(2))
        : 0,
      upcoming: team.upcoming.sort((a, b) => a.startDate.localeCompare(b.startDate) || a.trainingName.localeCompare(b.trainingName, 'pt-PT')),
    }))
    .sort((a, b) => b.upcomingTrainings - a.upcomingTrainings || a.teamName.localeCompare(b.teamName, 'pt-PT'));

  const upcomingTotal = teams.reduce((acc, item) => acc + item.upcomingTrainings, 0);
  const upcomingHoursTotal = formatHours(teams.reduce((acc, item) => acc + item.upcomingHours, 0));
  const completedInMonthTotal = teams.reduce((acc, item) => acc + item.completedInMonth, 0);
  const completionRate = assignedInMonthTotal > 0
    ? Number(((completedInMonthTotal / assignedInMonthTotal) * 100).toFixed(2))
    : 0;

  return {
    month,
    windowStart: bounds.windowStartText,
    windowEnd: bounds.windowEndText,
    generatedAt: new Date().toISOString(),
    totals: {
      teams: teams.length,
      collaborators: allCollaborators.size,
      upcomingTrainings: upcomingTotal,
      upcomingHours: upcomingHoursTotal,
      assignedInMonth: assignedInMonthTotal,
      completedInMonth: completedInMonthTotal,
      completionRate,
    },
    teams,
  };
}

function escapeCsvCell(value: string | number) {
  const text = String(value ?? '');
  if (/[;"\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }

  return text;
}

export function buildTrainingMonthlyReportCsv(report: TrainingMonthlyReport) {
  const header = [
    'Mes',
    'Equipa',
    'Formacoes proximos 3 meses',
    'Horas proximos 3 meses',
    'Colaboradores com formacoes',
    'Atribuidas no mes',
    'Concluidas no mes',
    'Taxa conclusao no mes (%)',
    'Colaborador',
    'Nivel hierarquico',
    'Formacao',
    'Data inicio',
    'Estado',
    'Entidade',
    'Horas',
    'Solicitado por',
  ];

  const lines = [header.map(escapeCsvCell).join(';')];

  for (const team of report.teams) {
    if (team.upcoming.length === 0) {
      lines.push([
        report.month,
        team.teamName,
        team.upcomingTrainings,
        team.upcomingHours,
        team.collaborators,
        team.assignedInMonth,
        team.completedInMonth,
        team.completionRate,
        '-',
        '-',
        '-',
        '-',
        '-',
        '-',
        '-',
        '-',
      ].map(escapeCsvCell).join(';'));
      continue;
    }

    for (const row of team.upcoming) {
      lines.push([
        report.month,
        team.teamName,
        team.upcomingTrainings,
        team.upcomingHours,
        team.collaborators,
        team.assignedInMonth,
        team.completedInMonth,
        team.completionRate,
        row.collaboratorName,
        row.hierarchyLevel,
        row.trainingName,
        formatDatePt(row.startDate),
        formatTrainingStatus(row.status),
        row.entity,
        row.hours,
        row.requestedByName,
      ].map(escapeCsvCell).join(';'));
    }
  }

  return `${lines.join('\n')}\n`;
}

function ensurePdfSpace(pdf: PdfDoc, spaceNeeded: number) {
  const availableHeight = pdf.page.height - pdf.page.margins.bottom - pdf.y;
  if (availableHeight >= spaceNeeded) {
    return;
  }

  pdf.addPage();
  pdf.y = pdf.page.margins.top;
}

function drawHeaderBlock(pdf: PdfDoc, report: TrainingMonthlyReport) {
  const x = pdf.page.margins.left;
  const width = pdf.page.width - pdf.page.margins.left - pdf.page.margins.right;
  const blockHeight = 116;
  const top = pdf.y;

  pdf.roundedRect(x, top, width, blockHeight, 14).fill('#0f3d74');
  pdf.fillColor('#d7e8ff').font('Helvetica-Bold').fontSize(11).text('Relatorio RH', x + 18, top + 14, { lineBreak: false });
  pdf.fillColor('#ffffff').font('Helvetica-Bold').fontSize(20).text('Relatório Mensal de Formações', x + 18, top + 45, { lineBreak: false });
  pdf.fillColor('#d8e8ff').font('Helvetica').fontSize(9.5).text(
    `Mes: ${formatReportMonth(report.month)} | Janela: ${report.windowStart} ate ${report.windowEnd}`,
    x + 18,
    top + 86,
    { lineBreak: false },
  );
  pdf.fillColor('#c8dbf7').font('Helvetica').fontSize(9.5).text(
    `Gerado em ${new Date(report.generatedAt).toLocaleString('pt-PT')}`,
    x + 18,
    top + 100,
    { lineBreak: false },
  );

  pdf.y = top + blockHeight + 14;
}

function drawSummaryTiles(pdf: PdfDoc, report: TrainingMonthlyReport) {
  ensurePdfSpace(pdf, 136);

  const x = pdf.page.margins.left;
  const width = pdf.page.width - pdf.page.margins.left - pdf.page.margins.right;
  const gap = 10;
  const tileWidth = (width - gap) / 2;
  const tileHeight = 52;
  const top = pdf.y;

  const metrics = [
    { label: 'Equipas', value: String(report.totals.teams) },
    { label: 'Colaboradores', value: String(report.totals.collaborators) },
    { label: 'Horas previstas', value: `${report.totals.upcomingHours} h` },
    { label: 'Taxa de conclusão', value: `${report.totals.completionRate.toFixed(2)}%` },
  ];

  for (let i = 0; i < metrics.length; i += 1) {
    const row = Math.floor(i / 2);
    const col = i % 2;
    const tileX = x + col * (tileWidth + gap);
    const tileY = top + row * (tileHeight + 8);

    pdf.roundedRect(tileX, tileY, tileWidth, tileHeight, 10).fill('#f2f7ff');
    pdf.roundedRect(tileX, tileY, tileWidth, tileHeight, 10).stroke('#d8e6fb');
    pdf.fillColor('#4e6f9c').font('Helvetica-Bold').fontSize(8.5).text(metrics[i].label.toUpperCase(), tileX + 12, tileY + 10);
    pdf.fillColor('#103f7f').font('Helvetica-Bold').fontSize(15).text(metrics[i].value, tileX + 12, tileY + 25);
  }

  pdf.y = top + (tileHeight * 2) + 16;
}

function drawTeamSection(pdf: PdfDoc, team: TrainingMonthlyReportTeamSummary) {
  ensurePdfSpace(pdf, 190);

  const x = pdf.page.margins.left;
  const width = pdf.page.width - pdf.page.margins.left - pdf.page.margins.right;
  const sectionStartY = pdf.y;

  pdf.roundedRect(x, sectionStartY, width, 28, 9).fill('#eaf2ff');
  pdf.fillColor('#123d79').font('Helvetica-Bold').fontSize(11).text(team.teamName, x + 12, sectionStartY + 8);

  const metricsY = sectionStartY + 38;
  pdf.fillColor('#2d4f77').font('Helvetica').fontSize(9.3).text(
    `Formacoes: ${team.upcomingTrainings} | Horas: ${team.upcomingHours}h | Colaboradores: ${team.collaborators}`,
    x + 2,
    metricsY,
  );
  pdf.text(
    `Concluidas no mes: ${team.completedInMonth}/${team.assignedInMonth} (${team.completionRate.toFixed(2)}%)`,
    x + 2,
    metricsY + 13,
  );

  const levelSummary = team.hierarchyBreakdown.slice(0, 4)
    .map((item) => `${item.level}: ${item.upcomingCount}`)
    .join(' | ');
  if (levelSummary) {
    pdf.fillColor('#58759c').fontSize(8.5).text(`Níveis em destaque: ${levelSummary}`, x + 2, metricsY + 27);
  }

  const tableTop = metricsY + 44;
  pdf.roundedRect(x, tableTop, width, 20, 6).fill('#f5f9ff');
  pdf.fillColor('#4f6f95').font('Helvetica-Bold').fontSize(8)
    .text('Data', x + 8, tableTop + 6)
    .text('Colaborador', x + 72, tableTop + 6)
    .text('Nível', x + 214, tableTop + 6)
    .text('Formação', x + 290, tableTop + 6)
    .text('Estado', x + width - 82, tableTop + 6);

  const previewRows = team.upcoming.slice(0, 8);
  let currentY = tableTop + 24;
  for (const row of previewRows) {
    ensurePdfSpace(pdf, 32);
    if (currentY + 28 > pdf.page.height - pdf.page.margins.bottom) {
      pdf.addPage();
      pdf.y = pdf.page.margins.top;
      currentY = pdf.y;
    }

    pdf.fillColor('#163f77').font('Helvetica').fontSize(8.5)
      .text(formatDatePt(row.startDate), x + 8, currentY, { width: 58 })
      .text(row.collaboratorName, x + 72, currentY, { width: 132, ellipsis: true })
      .text(row.hierarchyLevel, x + 214, currentY, { width: 70, ellipsis: true })
      .text(row.trainingName, x + 290, currentY, { width: width - 384, ellipsis: true })
      .text(formatTrainingStatus(row.status), x + width - 82, currentY, { width: 72, align: 'right' });

    pdf.fillColor('#4f6f95').font('Helvetica-Oblique').fontSize(7.5)
      .text(`Entidade: ${row.entity || '-'} · Solicitado por: ${row.requestedByName}`, x + 8, currentY + 10, { width: width - 16, ellipsis: true });

    pdf.strokeColor('#e4ecfa').moveTo(x, currentY + 24).lineTo(x + width, currentY + 24).stroke();
    currentY += 28;
  }

  if (team.upcoming.length > previewRows.length) {
    pdf.fillColor('#55749c').font('Helvetica-Oblique').fontSize(8)
      .text(`+ ${team.upcoming.length - previewRows.length} formação(ões) adicionais nesta equipa.`, x + 8, currentY + 2);
    currentY += 16;
  }

  pdf.y = Math.max(pdf.y, currentY + 10);
}

export function writeTrainingMonthlyReportPdf(report: TrainingMonthlyReport, writable: NodeJS.WritableStream) {
  const pdf = new PDFDocument({ size: 'A4', margin: 40 });
  pdf.pipe(writable);

  drawHeaderBlock(pdf, report);
  drawSummaryTiles(pdf, report);

  pdf.fillColor('#103d79').font('Helvetica-Bold').fontSize(11).text('Resumo por equipa');
  pdf.moveDown(0.2);

  for (const team of report.teams) {
    ensurePdfSpace(pdf, 180);
    drawTeamSection(pdf, team);
  }

  pdf.end();
}

function monthKeyFromDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function buildTeamNotificationMessage(summary: TrainingMonthlyReportTeamSummary, month: string, windowStart: string, windowEnd: string) {
  const preview = summary.upcoming.slice(0, 8)
    .map((item) => `- ${item.startDate} | ${item.collaboratorName} | ${item.trainingName}`)
    .join('\n');

  const lines = [
    `Planeamento de formações (${month}) para os próximos 3 meses (${windowStart} a ${windowEnd}).`,
    `Equipa: ${summary.teamName}`,
    `Total de formações planeadas: ${summary.upcomingTrainings}`,
    `Horas previstas: ${summary.upcomingHours}`,
    `Colaboradores envolvidos: ${summary.collaborators}`,
    '',
    preview || '- Sem formações planeadas para a janela.',
  ];

  if (summary.upcoming.length > 8) {
    lines.push(`... e mais ${summary.upcoming.length - 8} formação(ões).`);
  }

  return lines.join('\n');
}

export async function runUpcomingTrainingsMonthlySweep(prisma: PrismaClient, todayInput = new Date()) {
  const today = new Date(todayInput.getFullYear(), todayInput.getMonth(), todayInput.getDate());
  const month = monthKeyFromDate(today);

  if (today.getDate() !== 1) {
    return { skipped: true, reason: 'not_month_start', month, notifiedUsers: 0, notifications: 0 } as const;
  }

  const state = await prisma.systemSetting.findUnique({
    where: { key: TRAININGS_MONTHLY_SWEEP_STATE_KEY },
    select: { textValue: true },
  });

  if (state?.textValue === month) {
    return { skipped: true, reason: 'already_sent', month, notifiedUsers: 0, notifications: 0 } as const;
  }

  const report = await buildTrainingMonthlyReport(prisma, { month });
  const teamIds = report.teams.map((team) => team.teamId).filter((id) => id !== 'sem-equipa');

  const [teams, accessUsers] = await Promise.all([
    teamIds.length > 0
      ? prisma.team.findMany({
        where: { id: { in: teamIds } },
        select: { id: true, managerId: true, coordinatorId: true },
      })
      : Promise.resolve([]),
    prisma.user.findMany({
      where: {
        isActive: true,
        OR: [{ hasAccessTotal: true }, { isRootAccess: true }],
      },
      select: { id: true },
    }),
  ]);

  const teamById = new Map(teams.map((team) => [team.id, team]));
  const accessIds = accessUsers.map((user) => user.id);
  const notificationPayload: Array<{ userId: string; title: string; message: string }> = [];

  for (const summary of report.teams) {
    if (summary.upcomingTrainings === 0) {
      continue;
    }

    const recipients = new Set<string>(accessIds);
    const team = teamById.get(summary.teamId);
    if (team?.managerId) {
      recipients.add(team.managerId);
    }
    if (team?.coordinatorId) {
      recipients.add(team.coordinatorId);
    }

    const title = `Formações próximas (3 meses) · ${report.month}`;
    const message = buildTeamNotificationMessage(summary, report.month, report.windowStart, report.windowEnd);

    for (const userId of recipients) {
      notificationPayload.push({ userId, title, message });
    }
  }

  if (notificationPayload.length > 0) {
    await prisma.notification.createMany({ data: notificationPayload });
  }

  await prisma.systemSetting.upsert({
    where: { key: TRAININGS_MONTHLY_SWEEP_STATE_KEY },
    update: { textValue: month, boolValue: null },
    create: { key: TRAININGS_MONTHLY_SWEEP_STATE_KEY, textValue: month, boolValue: null },
  });

  return {
    skipped: false,
    month,
    notifiedUsers: new Set(notificationPayload.map((item) => item.userId)).size,
    notifications: notificationPayload.length,
  } as const;
}
