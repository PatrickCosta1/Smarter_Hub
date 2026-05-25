import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from 'react';
import { usePortal } from '../portal/context';
import { apiRequest, apiRequestCached, authHeaders, clearApiCache, getApiBase, isAbortError } from '../portal/api';
import { getStoredAuthToken } from '../portal/auth-storage';
import { formatRoleLabel, formatTrainingStatusLabel, getTrainingStatusTone } from '../portal/labels';
import Badge from '../components/ui/Badge';
import Button from '../components/ui/Button';
import Modal from '../components/ui/Modal';
import Toast from '../components/ui/Toast';

function getAuthHeaders() {
  const token = getStoredAuthToken();
  return authHeaders(token);
}

type TrainingRecord = {
  id: string;
  nome: string;
  link: string;
  horas: number;
  dataInicio: string;
  entidade: string;
  dataConclusao: string;
  status?: string;
  createdAt: string;
    certificateLink?: string;
  user?: {
    id: string;
    username: string;
    email: string;
    role: string;
    team?: {
      id: string;
      name: string;
    } | null;
    teamMemberships?: Array<{
      team?: {
        id: string;
        name: string;
      } | null;
    }>;
    profile?: {
      nomeAbreviado?: string;
      nomeCompleto?: string;
    } | null;
  };
  assignedBy?: {
    id: string;
    username: string;
    email: string;
    role: string;
    profile?: {
      nomeAbreviado?: string;
      nomeCompleto?: string;
    } | null;
  } | null;
};

type Collaborator = {
  id: string;
  username: string;
  email: string;
  role: string;
  profile?: {
    nomeCompleto: string;
    cargo: string;
    funcao: string;
  } | null;
};

type AssignDraft = {
  nome: string;
  link: string;
  horas: string;
  dataInicio: string;
  entidade: string;
};

type RecentAssignedItem = {
  id: string;
  nome: string;
  collaborator: string;
  createdAt: string;
};

type TrainingsScope = 'mine' | 'team' | 'hierarchy';
type SortField = 'createdAt' | 'nome' | 'horas' | 'dataInicio' | 'dataConclusao' | 'status';
type OrigemFilter = 'all' | 'propria' | 'atribuida';

type TrainingsSettings = {
  entities: string[];
  requireCertificateOnComplete: boolean;
  certificateMode: 'url' | 'file_or_url';
};

type PaginatedRows<T> = {
  total: number;
  page: number;
  pageSize: number;
  rows: T[];
};

type TrainingMonthlyReport = {
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
  teams: Array<{
    teamId: string;
    teamName: string;
    upcomingTrainings: number;
    upcomingHours: number;
    collaborators: number;
    assignedInMonth: number;
    completedInMonth: number;
    completionRate: number;
  }>;
};

const DEFAULT_TRAINING_ENTITIES = [
  'Udemy',
  'Coursera',
  'LinkedIn Learning',
  'Microsoft Learn',
  'Google / Google Skillshop',
  'Pluralsight',
  'Alura',
  'DIO',
  'IEFP',
  'Tlantic (Interna)',
  'Outra',
] as const;

const DEFAULT_TRAININGS_SETTINGS: TrainingsSettings = {
  entities: [...DEFAULT_TRAINING_ENTITIES],
  requireCertificateOnComplete: false,
  certificateMode: 'url',
};

const EMPTY_ASSIGN_DRAFT: AssignDraft = {
  nome: '',
  link: '',
  horas: '',
  dataInicio: '',
  entidade: '',
};

function parseHours(value: string): number {
  const normalized = value.trim().replace(',', '.');
  return Number(normalized);
}

function formatHours(value: number): string {
  return new Intl.NumberFormat('pt-PT', { maximumFractionDigits: 2, minimumFractionDigits: 0 }).format(value);
}

function formatMonthLabel(monthValue: string) {
  const [yearText, monthText] = String(monthValue || '').split('-');
  const year = Number(yearText);
  const monthIndex = Number(monthText) - 1;
  if (!Number.isInteger(year) || !Number.isInteger(monthIndex) || monthIndex < 0 || monthIndex > 11) {
    return monthValue;
  }

  return new Intl.DateTimeFormat('pt-PT', { month: 'long', year: 'numeric' }).format(new Date(year, monthIndex, 1));
}

function formatAbbreviatedUserName(user?: { username: string; profile?: { nomeAbreviado?: string; nomeCompleto?: string } | null } | null) {
  if (!user) {
    return 'Próprio';
  }

  const profileShort = user.profile?.nomeAbreviado?.trim() || '';
  if (profileShort) {
    return profileShort;
  }

  const fullName = user.profile?.nomeCompleto?.trim() || '';

  return fullName || user.username;
}

function resolveStatusTone(message: string): 'success' | 'error' | 'info' {
  const normalized = message.toLowerCase();
  if (normalized.includes('falha') || normalized.includes('erro') || normalized.includes('não foi possível')) {
    return 'error';
  }

  if (normalized.includes('sucesso') || normalized.includes('atribu') || normalized.includes('conclu')) {
    return 'success';
  }

  return 'info';
}

function getTrainingOriginLabel(record: TrainingRecord) {
  if (!record.assignedBy) {
    return 'Próprio';
  }

  return formatAbbreviatedUserName(record.assignedBy);
}

function getTrainingStartDate(record: TrainingRecord) {
  return record.dataInicio?.trim() || '';
}

function getTrainingOwnerLabel(record: TrainingRecord) {
  if (!record.user) {
    return '-';
  }

  return formatAbbreviatedUserName(record.user);
}

function getTrainingTeamLabel(record: TrainingRecord) {
  const primaryTeam = record.user?.team?.name?.trim() || '';
  const membershipTeams = (record.user?.teamMemberships || [])
    .map((membership) => membership.team?.name?.trim() || '')
    .filter(Boolean);

  const teamSet = new Set<string>();
  if (primaryTeam) {
    teamSet.add(primaryTeam);
  }
  for (const teamName of membershipTeams) {
    teamSet.add(teamName);
  }

  const teams = Array.from(teamSet);
  return teams.length > 0 ? teams.join(', ') : '-';
}

export default function TrainingsPage() {
  const { hasPermission, isRootAccess, isAccessTotal, refreshNotifications } = usePortal();
  const canAssignTraining = isRootAccess || hasPermission('assign_training');
  const canViewHierarchyTrainings = isRootAccess || hasPermission('view_all_trainings');
  const canUseMonthlyRhReport = isRootAccess || isAccessTotal;
  const canViewTeamTrainings = canAssignTraining && !canViewHierarchyTrainings;
  const canMarkCompleted = isRootAccess || hasPermission('mark_training_completed');
  const canCompleteForOthers = canAssignTraining || canViewHierarchyTrainings;
  const [scope, setScope] = useState<TrainingsScope>(() => (canViewHierarchyTrainings ? 'hierarchy' : 'mine'));

  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [recordsCollaboratorFilter, setRecordsCollaboratorFilter] = useState('');
  const [records, setRecords] = useState<TrainingRecord[]>([]);
  const [status, setStatus] = useState('');

  const [assignDraft, setAssignDraft] = useState<AssignDraft>(EMPTY_ASSIGN_DRAFT);
  const [assignStatus, setAssignStatus] = useState('');
  const [assignBusy, setAssignBusy] = useState(false);
  const [collaboratorQuery, setCollaboratorQuery] = useState('');
  const [allCollaborators, setAllCollaborators] = useState<Collaborator[]>([]);
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
  const [draftSelectedUserIds, setDraftSelectedUserIds] = useState<string[]>([]);
  const [isLoadingCollaborators, setIsLoadingCollaborators] = useState(false);
  const [isAssignModalOpen, setIsAssignModalOpen] = useState(false);
  const [isCollaboratorPickerOpen, setIsCollaboratorPickerOpen] = useState(false);
  const [isRecordsLoading, setIsRecordsLoading] = useState(false);
  const [recordsLoaded, setRecordsLoaded] = useState(false);
  const [completeConfirmRecordId, setCompleteConfirmRecordId] = useState<string | null>(null);
  const [completeCertLink, setCompleteCertLink] = useState('');
  const [isUploadingCertificate, setIsUploadingCertificate] = useState(false);
  const [recentAssigned, setRecentAssigned] = useState<RecentAssignedItem[]>([]);
  const [isExportingExcel, setIsExportingExcel] = useState(false);
  const [isMonthlyReportModalOpen, setIsMonthlyReportModalOpen] = useState(false);
  const [monthlyReportMonth, setMonthlyReportMonth] = useState(() => {
    const now = new Date();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    return `${now.getFullYear()}-${month}`;
  });
  const [monthlyReportTeamId, setMonthlyReportTeamId] = useState('');
  const [monthlyReportPreview, setMonthlyReportPreview] = useState<TrainingMonthlyReport | null>(null);
  const [isLoadingMonthlyReport, setIsLoadingMonthlyReport] = useState(false);
  const [isExportingMonthlyReport, setIsExportingMonthlyReport] = useState(false);
  const [trainingsSettings, setTrainingsSettings] = useState<TrainingsSettings>(DEFAULT_TRAININGS_SETTINGS);
  const [trainingsSettingsDraft, setTrainingsSettingsDraft] = useState<TrainingsSettings>(DEFAULT_TRAININGS_SETTINGS);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [settingsStatus, setSettingsStatus] = useState('');
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [newEntityInput, setNewEntityInput] = useState('');

  // ── Advanced filters
  const [entidadeFilter, setEntidadeFilter] = useState('');
  const [dataInicioFrom, setDataInicioFrom] = useState('');
  const [dataInicioTo, setDataInicioTo] = useState('');
  const [horasMin, setHorasMin] = useState('');
  const [horasMax, setHorasMax] = useState('');
  const [origemFilter, setOrigemFilter] = useState<OrigemFilter>('all');
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);

  // ── Sort
  const [sortField, setSortField] = useState<SortField>('createdAt');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const filteredCollaborators = useMemo(() => {
    const q = collaboratorQuery.trim().toLowerCase();
    if (!q) return allCollaborators;
    return allCollaborators.filter((c) =>
      [c.username, c.email, c.profile?.nomeCompleto ?? '', c.profile?.cargo ?? '', c.profile?.funcao ?? '']
        .join(' ')
        .toLowerCase()
        .includes(q),
    );
  }, [allCollaborators, collaboratorQuery]);

  const selectedCollaborators = useMemo(
    () => allCollaborators.filter((c) => selectedUserIds.includes(c.id)),
    [allCollaborators, selectedUserIds],
  );

  const draftSelectedCollaborators = useMemo(
    () => allCollaborators.filter((c) => draftSelectedUserIds.includes(c.id)),
    [allCollaborators, draftSelectedUserIds],
  );

  const isOwnScope = scope === 'mine';
  const showTeamColumn = scope === 'hierarchy';

  const tableColumnCount = useMemo(() => {
    let count = 8;
    if (!isOwnScope) {
      count += 1;
    }
    if (showTeamColumn) {
      count += 1;
    }
    if ((isOwnScope && canMarkCompleted) || (!isOwnScope && canCompleteForOthers)) {
      count += 1;
    }
    return count;
  }, [canMarkCompleted, canCompleteForOthers, isOwnScope, showTeamColumn]);

  const sortedRecords = useMemo(() => {
    return [...records].sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case 'nome': cmp = a.nome.localeCompare(b.nome, 'pt'); break;
        case 'horas': cmp = a.horas - b.horas; break;
        case 'dataInicio': cmp = (a.dataInicio || '').localeCompare(b.dataInicio || ''); break;
        case 'dataConclusao': cmp = (a.dataConclusao || '').localeCompare(b.dataConclusao || ''); break;
        case 'status': cmp = (a.status || '').localeCompare(b.status || ''); break;
        default: cmp = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [records, sortField, sortDir]);

  const visibleRecords = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const normalizedCollaborator = recordsCollaboratorFilter.trim().toLowerCase();
    const horasMinVal = horasMin ? parseFloat(horasMin.replace(',', '.')) : null;
    const horasMaxVal = horasMax ? parseFloat(horasMax.replace(',', '.')) : null;

    return sortedRecords.filter((record) => {
      if (statusFilter !== 'all' && (record.status || '') !== statusFilter) return false;

      if (!isOwnScope && normalizedCollaborator) {
        const collabHaystack = [
          record.user?.username ?? '',
          record.user?.email ?? '',
          record.user?.profile?.nomeCompleto ?? '',
          record.user?.profile?.nomeAbreviado ?? '',
        ].join(' ').toLowerCase();
        if (!collabHaystack.includes(normalizedCollaborator)) return false;
      }

      if (entidadeFilter && record.entidade !== entidadeFilter) return false;

      if (dataInicioFrom && (record.dataInicio || '') < dataInicioFrom) return false;
      if (dataInicioTo && (record.dataInicio || '') > dataInicioTo) return false;

      if (horasMinVal !== null && !Number.isNaN(horasMinVal) && record.horas < horasMinVal) return false;
      if (horasMaxVal !== null && !Number.isNaN(horasMaxVal) && record.horas > horasMaxVal) return false;

      if (origemFilter === 'propria' && record.assignedBy) return false;
      if (origemFilter === 'atribuida' && !record.assignedBy) return false;

      if (normalized) {
        const textHaystack = [
          record.nome,
          record.entidade,
          getTrainingStartDate(record),
          record.link,
          record.user?.username ?? '',
          record.user?.profile?.nomeCompleto ?? '',
          record.user?.profile?.nomeAbreviado ?? '',
          getTrainingTeamLabel(record),
        ].join(' ').toLowerCase();
        if (!textHaystack.includes(normalized)) return false;
      }

      return true;
    });
  }, [query, recordsCollaboratorFilter, scope, sortedRecords, statusFilter, entidadeFilter, dataInicioFrom, dataInicioTo, horasMin, horasMax, origemFilter, isOwnScope]);

  const totalHours = useMemo(() => records.reduce((sum, record) => sum + record.horas, 0), [records]);
  const assignedCount = useMemo(() => records.filter((record) => record.status === 'ASSIGNED').length, [records]);
  const completedCount = useMemo(() => records.filter((record) => record.status === 'COMPLETED').length, [records]);

  const uniqueEntidades = useMemo(() => {
    const set = new Set(records.map((r) => r.entidade).filter(Boolean));
    return [...set].sort((a, b) => a.localeCompare(b, 'pt'));
  }, [records]);

  const trainingEntityOptions = useMemo(() => {
    const configured = trainingsSettings.entities.filter((item) => item.trim());
    if (configured.length > 0) {
      return configured;
    }
    return [...DEFAULT_TRAINING_ENTITIES];
  }, [trainingsSettings.entities]);

  const monthlyReportTeamOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const record of records) {
      const primaryTeam = record.user?.team;
      if (primaryTeam?.id && primaryTeam.name?.trim()) {
        map.set(primaryTeam.id, primaryTeam.name.trim());
      }
      for (const membership of record.user?.teamMemberships || []) {
        const team = membership.team;
        if (team?.id && team.name?.trim()) {
          map.set(team.id, team.name.trim());
        }
      }
    }

    return Array.from(map.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name, 'pt-PT'));
  }, [records]);

  const activeFilterCount = useMemo(() => {
    let n = 0;
    if (query) n++;
    if (statusFilter !== 'all') n++;
    if (recordsCollaboratorFilter) n++;
    if (entidadeFilter) n++;
    if (dataInicioFrom) n++;
    if (dataInicioTo) n++;
    if (horasMin) n++;
    if (horasMax) n++;
    if (origemFilter !== 'all') n++;
    return n;
  }, [query, statusFilter, recordsCollaboratorFilter, entidadeFilter, dataInicioFrom, dataInicioTo, horasMin, horasMax, origemFilter]);
  const scopeConfig = useMemo(() => {
    switch (scope) {
      case 'team':
        return {
          title: 'Formações da equipa',
          description: 'Consulta todas as formações das pessoas da tua equipa e filtra rapidamente por colaborador ou estado.',
          summaryLabel: 'Equipa',
          emptyMessage: 'Sem formações registadas para os colaboradores da tua equipa.',
        };
      case 'hierarchy':
        return {
          title: 'Vista global de formações',
          description: 'Acompanha o percurso formativo de toda a organização. Filtra por colaborador ou estado para analisar rapidamente o envolvimento formativo.',
          summaryLabel: 'Organização',
          emptyMessage: 'Não existem formações registadas na organização.',
        };
      default:
        return {
          title: 'Minhas formações',
          description: 'Consulta apenas as tuas formações ativas e concluídas num espaço mais claro e focado.',
          summaryLabel: 'Pessoais',
          emptyMessage: 'Sem formações para apresentar.',
        };
    }
  }, [scope]);

  const monthlyReportDisplayMonth = useMemo(() => {
    const sourceMonth = monthlyReportPreview?.month || monthlyReportMonth;
    return formatMonthLabel(sourceMonth);
  }, [monthlyReportPreview?.month, monthlyReportMonth]);

  const monthlyReportTopTeams = useMemo(() => {
    if (!monthlyReportPreview) {
      return [] as TrainingMonthlyReport['teams'];
    }

    return [...monthlyReportPreview.teams]
      .sort((a, b) => b.upcomingTrainings - a.upcomingTrainings || b.upcomingHours - a.upcomingHours)
      .slice(0, 3);
  }, [monthlyReportPreview]);

  const availableScopes = useMemo<Array<{ id: TrainingsScope; label: string }>>(() => {
    if (canViewHierarchyTrainings) {
      return [{ id: 'hierarchy', label: 'Organização' }];
    }

    const scopes: Array<{ id: TrainingsScope; label: string }> = [{ id: 'mine', label: 'Minhas' }];
    if (canViewTeamTrainings) {
      scopes.push({ id: 'team', label: 'Equipa' });
    }
    return scopes;
  }, [canViewHierarchyTrainings, canViewTeamTrainings]);

  useEffect(() => {
    const controller = new AbortController();

    void loadTrainings(controller.signal);
    void loadTrainingsSettings(controller.signal);

    return () => controller.abort();
  }, [scope]);

  useEffect(() => {
    if (canViewHierarchyTrainings && scope !== 'hierarchy') {
      setScope('hierarchy');
      return;
    }

    if (scope === 'team' && !canViewTeamTrainings) {
      setScope('mine');
      return;
    }

    if (scope === 'hierarchy' && !canViewHierarchyTrainings) {
      setScope('mine');
    }
  }, [canViewHierarchyTrainings, canViewTeamTrainings, scope]);

  useEffect(() => {
    if (isOwnScope) {
      setRecordsCollaboratorFilter('');
    }
    // Reset advanced filters whenever scope changes
    setEntidadeFilter('');
    setDataInicioFrom('');
    setDataInicioTo('');
    setHorasMin('');
    setHorasMax('');
    setOrigemFilter('all');
    setQuery('');
    setStatusFilter('all');
  }, [isOwnScope, scope]);


  function clearAllFilters() {
    setQuery('');
    setStatusFilter('all');
    setRecordsCollaboratorFilter('');
    setEntidadeFilter('');
    setDataInicioFrom('');
    setDataInicioTo('');
    setHorasMin('');
    setHorasMax('');
    setOrigemFilter('all');
  }

  function toggleSort(field: SortField) {
    if (sortField === field) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  }

  function sortIcon(field: SortField) {
    if (sortField !== field) return <span className="sort-icon sort-icon--idle" aria-hidden="true">⇕</span>;
    return <span className="sort-icon sort-icon--active" aria-hidden="true">{sortDir === 'asc' ? '↑' : '↓'}</span>;
  }

  async function handleExportExcel() {
    if (visibleRecords.length === 0 || isExportingExcel) {
      return;
    }

    try {
      setIsExportingExcel(true);
      const ExcelJS = await import('exceljs');
      const workbook = new ExcelJS.Workbook();
      workbook.creator = 'Smarter Hub';
      workbook.created = new Date();
      workbook.modified = new Date();

      const scopeLabel = scope === 'mine' ? 'Minhas' : scope === 'team' ? 'Equipa' : 'Organização';
      const sheet = workbook.addWorksheet('Formações', {
        views: [{ state: 'frozen', ySplit: 3 }],
        properties: { defaultColWidth: 18 },
      });

      const headerColumns: Array<{ header: string; key: string; width: number }> = [
        { header: 'Formação', key: 'nome', width: 30 },
      ];
      if (!isOwnScope) {
        headerColumns.push({ header: 'Colaborador', key: 'colaborador', width: 24 });
      }
      if (showTeamColumn) {
        headerColumns.push({ header: 'Equipa', key: 'equipa', width: 24 });
      }
      headerColumns.push(
        { header: 'Origem', key: 'origem', width: 20 },
        { header: 'Estado', key: 'estado', width: 14 },
        { header: 'Horas', key: 'horas', width: 10 },
        { header: 'Data de início', key: 'dataInicio', width: 14 },
        { header: 'Data conclusão', key: 'dataConclusao', width: 16 },
        { header: 'Entidade', key: 'entidade', width: 24 },
        { header: 'Link', key: 'link', width: 42 },
      );

      const lastColumnLetter = String.fromCharCode(64 + headerColumns.length);
      sheet.mergeCells(`A1:${lastColumnLetter}1`);
      const titleCell = sheet.getCell('A1');
      titleCell.value = `Exportação de Formações | ${scopeLabel}`;
      titleCell.font = { name: 'Calibri', size: 16, bold: true, color: { argb: 'FFFFFFFF' } };
      titleCell.alignment = { vertical: 'middle', horizontal: 'left' };
      titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E78' } };

      sheet.mergeCells(`A2:${lastColumnLetter}2`);
      const metaCell = sheet.getCell('A2');
      metaCell.value = `Gerado em ${new Date().toLocaleString('pt-PT')} | ${visibleRecords.length} registo(s) | Filtros ativos: ${activeFilterCount}`;
      metaCell.font = { name: 'Calibri', size: 10, color: { argb: 'FF31537C' } };
      metaCell.alignment = { vertical: 'middle', horizontal: 'left' };
      metaCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEAF2FB' } };

      const headerRow = sheet.getRow(3);
      headerRow.values = headerColumns.map((column) => column.header);
      headerRow.font = { name: 'Calibri', bold: true, color: { argb: 'FFFFFFFF' } };
      headerRow.alignment = { vertical: 'middle', horizontal: 'center' };
      headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2E75B6' } };
      headerRow.height = 22;

      for (const record of visibleRecords) {
        const rowData: Array<string | number> = [record.nome];
        if (!isOwnScope) {
          rowData.push(getTrainingOwnerLabel(record));
        }
        if (showTeamColumn) {
          rowData.push(getTrainingTeamLabel(record));
        }
        rowData.push(
          getTrainingOriginLabel(record),
          formatTrainingStatusLabel(record.status),
          record.horas,
          getTrainingStartDate(record) || '-',
          record.dataConclusao || '-',
          record.entidade || '-',
          record.link || '-',
        );
        sheet.addRow(rowData);
      }

      sheet.columns = headerColumns.map((column) => ({ width: column.width }));

      for (let rowIndex = 4; rowIndex <= visibleRecords.length + 3; rowIndex += 1) {
        const row = sheet.getRow(rowIndex);
        const isEven = rowIndex % 2 === 0;
        row.eachCell((cell, colNumber) => {
          cell.border = {
            top: { style: 'thin', color: { argb: 'FFD9E2F3' } },
            left: { style: 'thin', color: { argb: 'FFD9E2F3' } },
            bottom: { style: 'thin', color: { argb: 'FFD9E2F3' } },
            right: { style: 'thin', color: { argb: 'FFD9E2F3' } },
          };
          cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: isEven ? 'FFF9FCFF' : 'FFFFFFFF' },
          };
          if (colNumber === 1 || colNumber === headerColumns.length) {
            cell.alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };
          } else {
            cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
          }
        });
      }

      sheet.autoFilter = {
        from: { row: 3, column: 1 },
        to: { row: 3, column: headerColumns.length },
      };

      const filtersSheet = workbook.addWorksheet('Parâmetros', {
        properties: { defaultColWidth: 36 },
      });
      filtersSheet.getRow(1).values = ['Parâmetro', 'Valor'];
      filtersSheet.getRow(1).font = { name: 'Calibri', bold: true, color: { argb: 'FFFFFFFF' } };
      filtersSheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2E75B6' } };

      filtersSheet.addRows([
        ['Âmbito', scopeConfig.summaryLabel],
        ['Pesquisa', query || '-'],
        ['Estado', statusFilter === 'all' ? 'Todos' : statusFilter],
        ['Colaborador', recordsCollaboratorFilter || '-'],
        ['Entidade', entidadeFilter || '-'],
        ['Data início de', dataInicioFrom || '-'],
        ['Data início até', dataInicioTo || '-'],
        ['Horas mínimas', horasMin || '-'],
        ['Horas máximas', horasMax || '-'],
        ['Origem', origemFilter],
        ['Ordenação', `${sortField} (${sortDir})`],
        ['Total exportado', String(visibleRecords.length)],
      ]);

      for (let rowIndex = 2; rowIndex <= 13; rowIndex += 1) {
        const row = filtersSheet.getRow(rowIndex);
        row.eachCell((cell) => {
          cell.border = {
            top: { style: 'thin', color: { argb: 'FFD9E2F3' } },
            left: { style: 'thin', color: { argb: 'FFD9E2F3' } },
            bottom: { style: 'thin', color: { argb: 'FFD9E2F3' } },
            right: { style: 'thin', color: { argb: 'FFD9E2F3' } },
          };
        });
      }

      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const today = new Date().toISOString().slice(0, 10);
      a.href = url;
      a.download = `formacoes-${scopeLabel.toLowerCase()}-${today}.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setStatus('Exportação Excel gerada com sucesso.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Falha ao exportar formações para Excel.');
    } finally {
      setIsExportingExcel(false);
    }
  }

  async function loadMonthlyReportPreview() {
    if (!canUseMonthlyRhReport || isLoadingMonthlyReport) {
      return;
    }

    setIsLoadingMonthlyReport(true);
    try {
      const params = new URLSearchParams();
      if (monthlyReportMonth) {
        params.set('month', monthlyReportMonth);
      }
      if (monthlyReportTeamId) {
        params.set('teamId', monthlyReportTeamId);
      }

      const data = await apiRequest<TrainingMonthlyReport>(`/trainings/reports/monthly?${params.toString()}`, {
        headers: getAuthHeaders(),
      });
      setMonthlyReportPreview(data);
      setStatus('Relatório mensal carregado com sucesso.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Falha ao carregar relatório mensal de formações.');
    } finally {
      setIsLoadingMonthlyReport(false);
    }
  }

  function openMonthlyReportModal() {
    setMonthlyReportPreview(null);
    setMonthlyReportTeamId('');
    setIsMonthlyReportModalOpen(true);
  }

  async function exportMonthlyReport(format: 'csv' | 'pdf') {
    if (!canUseMonthlyRhReport || isExportingMonthlyReport) {
      return;
    }

    setIsExportingMonthlyReport(true);
    try {
      const params = new URLSearchParams();
      params.set('format', format);
      if (monthlyReportMonth) {
        params.set('month', monthlyReportMonth);
      }
      if (monthlyReportTeamId) {
        params.set('teamId', monthlyReportTeamId);
      }

      const response = await fetch(`${getApiBase()}/trainings/reports/monthly/export?${params.toString()}`, {
        method: 'GET',
        headers: getAuthHeaders(),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { message?: string };
        throw new Error(payload.message || 'Falha ao exportar relatório mensal de formações.');
      }

      const blob = await response.blob();
      const contentDisposition = response.headers.get('content-disposition') || '';
      const matchedFileName = /filename=\"?([^\";]+)\"?/.exec(contentDisposition)?.[1] || '';
      const defaultName = `relatorio-formacoes-${monthlyReportMonth || 'mensal'}.${format}`;
      const fileName = matchedFileName || defaultName;

      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Falha ao exportar relatório mensal de formações.');
    } finally {
      setIsExportingMonthlyReport(false);
    }
  }

  async function loadTrainings(signal?: AbortSignal) {
    setIsRecordsLoading(records.length === 0);
    try {
      const path = scope === 'team'
        ? '/trainings/team?page=1&pageSize=500'
        : scope === 'hierarchy'
          ? '/trainings/hierarchy?page=1&pageSize=500'
          : '/trainings/me?page=1&pageSize=500';
      const data = await apiRequestCached<PaginatedRows<TrainingRecord>>(path, {
        headers: getAuthHeaders(),
        signal,
      }, 60000);
      setRecords(Array.isArray(data.rows) ? data.rows : []);
      setRecordsLoaded(true);
    } catch (error) {
      if (isAbortError(error) || signal?.aborted) {
        return;
      }

      setStatus(error instanceof Error ? error.message : `Falha ao carregar ${scope === 'team' ? 'formações da equipa' : 'as tuas formações'}.`);
    } finally {
      if (!signal?.aborted) {
        setIsRecordsLoading(false);
      }
    }
  }

  async function loadTrainingsSettings(signal?: AbortSignal) {
    if (!canViewHierarchyTrainings) {
      return;
    }

    try {
      const data = await apiRequestCached<TrainingsSettings>('/trainings/settings', {
        headers: getAuthHeaders(),
        signal,
      }, 60000, true);

      setTrainingsSettings(data);
      setTrainingsSettingsDraft(data);
    } catch (error) {
      if (isAbortError(error) || signal?.aborted) {
        return;
      }
      setStatus(error instanceof Error ? error.message : 'Falha ao carregar configurações de formações.');
    }
  }

  async function loadAllCollaborators(signal?: AbortSignal) {
    setIsLoadingCollaborators(true);
    try {
      const data = await apiRequestCached<Collaborator[]>('/users?limit=100', {
        headers: getAuthHeaders(),
        signal,
      }, 60000);
      setAllCollaborators(data);
    } catch (error) {
      if (isAbortError(error) || signal?.aborted) return;
      setAssignStatus(error instanceof Error ? error.message : 'Falha ao carregar colaboradores.');
    } finally {
      if (!signal?.aborted) setIsLoadingCollaborators(false);
    }
  }

  function updateAssignDraft(field: keyof AssignDraft, value: string) {
    setAssignDraft((current) => ({ ...current, [field]: value }));
  }

  function toggleCollaborator(id: string) {
    setSelectedUserIds((current) =>
      current.includes(id) ? current.filter((uid) => uid !== id) : [...current, id],
    );
  }

  function toggleDraftCollaborator(id: string) {
    setDraftSelectedUserIds((current) =>
      current.includes(id) ? current.filter((uid) => uid !== id) : [...current, id],
    );
  }

  function selectAllVisible() {
    setSelectedUserIds((current) => {
      const toAdd = filteredCollaborators.map((c) => c.id).filter((id) => !current.includes(id));
      return [...current, ...toAdd];
    });
  }

  function selectAllVisibleDraft() {
    setDraftSelectedUserIds((current) => {
      const toAdd = filteredCollaborators.map((c) => c.id).filter((id) => !current.includes(id));
      return [...current, ...toAdd];
    });
  }

  function clearSelection() {
    setSelectedUserIds([]);
  }

  function clearDraftSelection() {
    setDraftSelectedUserIds([]);
  }

  function openCollaboratorPicker() {
    setCollaboratorQuery('');
    setDraftSelectedUserIds(selectedUserIds);
    setIsCollaboratorPickerOpen(true);
    if (allCollaborators.length === 0) {
      void loadAllCollaborators();
    }
  }

  function closeCollaboratorPicker() {
    setIsCollaboratorPickerOpen(false);
    setCollaboratorQuery('');
  }

  function confirmCollaboratorPicker() {
    setSelectedUserIds(draftSelectedUserIds);
    setIsCollaboratorPickerOpen(false);
    setCollaboratorQuery('');
  }

  function openAssignModal() {
    setIsAssignModalOpen(true);
    setAssignStatus('');
    setCollaboratorQuery('');
    setSelectedUserIds([]);
    setDraftSelectedUserIds([]);
    setAssignDraft(EMPTY_ASSIGN_DRAFT);
    if (allCollaborators.length === 0) {
      void loadAllCollaborators();
    }
  }

  function openSettingsModal() {
    setTrainingsSettingsDraft(trainingsSettings);
    setNewEntityInput('');
    setSettingsStatus('');
    setIsSettingsModalOpen(true);
  }

  function addEntityToDraft(rawValue: string) {
    const value = rawValue.trim();
    if (!value) {
      return;
    }

    setTrainingsSettingsDraft((current) => {
      const exists = current.entities.some((entity) => entity.toLowerCase() === value.toLowerCase());
      if (exists) {
        return current;
      }

      return {
        ...current,
        entities: [...current.entities, value],
      };
    });
    setNewEntityInput('');
  }

  function removeEntityFromDraft(entityToRemove: string) {
    setTrainingsSettingsDraft((current) => ({
      ...current,
      entities: current.entities.filter((entity) => entity !== entityToRemove),
    }));
  }

  async function saveTrainingsSettings() {
    const normalizedEntities = trainingsSettingsDraft.entities.map((item) => item.trim()).filter(Boolean);
    if (normalizedEntities.length === 0) {
      setSettingsStatus('Define pelo menos uma entidade de formação.');
      return;
    }

    setIsSavingSettings(true);
    try {
      const saved = await apiRequest<TrainingsSettings>('/trainings/settings', {
        method: 'PUT',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          entities: Array.from(new Set(normalizedEntities)),
          requireCertificateOnComplete: trainingsSettingsDraft.requireCertificateOnComplete,
          certificateMode: trainingsSettingsDraft.certificateMode,
        }),
      });

      clearApiCache('/trainings/settings');
      setTrainingsSettings(saved);
      setTrainingsSettingsDraft(saved);
      setSettingsStatus('Configurações guardadas com sucesso.');
    } catch (error) {
      setSettingsStatus(error instanceof Error ? error.message : 'Falha ao guardar configurações.');
    } finally {
      setIsSavingSettings(false);
    }
  }

  async function uploadTrainingCertificate(file: File) {
    const token = getStoredAuthToken();
    const formData = new FormData();
    formData.append('file', file);

    const response = await fetch(`${getApiBase()}/files/upload`, {
      method: 'POST',
      headers: authHeaders(token),
      body: formData,
    });

    if (!response.ok) {
      const payload = (await response.json().catch(() => ({}))) as { message?: string };
      throw new Error(payload.message || 'Falha ao carregar certificado.');
    }

    const payload = (await response.json()) as { link?: string; linkPath?: string };
    return payload.linkPath || payload.link || '';
  }

  async function handleAssignTraining(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const parsedHours = parseHours(assignDraft.horas);

    if (selectedUserIds.length === 0 || !assignDraft.nome.trim() || !Number.isFinite(parsedHours) || parsedHours < 0) {
      setAssignStatus('Seleciona pelo menos um colaborador e preenche os campos obrigatórios.');
      return;
    }

    try {
      setAssignBusy(true);

      const selectedNames = selectedCollaborators.map((collaborator) => collaborator.profile?.nomeCompleto ?? collaborator.username);
      const createdRecords = await Promise.all(
        selectedUserIds.map((userId) => apiRequest<TrainingRecord>('/trainings/assign', {
          method: 'POST',
          headers: getAuthHeaders(),
          body: JSON.stringify({
            userId,
            nome: assignDraft.nome.trim(),
            link: assignDraft.link.trim(),
            horas: parsedHours,
            dataInicio: assignDraft.dataInicio,
            entidade: assignDraft.entidade.trim(),
          }),
        })),
      );

      clearApiCache('/trainings');
      setAssignStatus(
        selectedUserIds.length > 1
          ? `Formação atribuída com sucesso a ${selectedUserIds.length} colaboradores.`
          : 'Formação atribuída com sucesso.',
      );
      void refreshNotifications();
      setRecentAssigned((current) => ([
        ...createdRecords.map((created, index) => ({
          id: created.id,
          nome: created.nome,
          collaborator: selectedNames[index] || created.user?.username || 'Colaborador',
          createdAt: created.createdAt || new Date().toISOString(),
        })),
        ...current,
      ].slice(0, 8)));
      setAssignDraft(EMPTY_ASSIGN_DRAFT);
      setSelectedUserIds([]);
      await loadTrainings();
    } catch (error) {
      setAssignStatus(error instanceof Error ? error.message : 'Falha ao atribuir formação.');
    } finally {
      setAssignBusy(false);
    }
  }

  async function handleCompleteRecord(id: string, certLink = '') {
    try {
      const updated = await apiRequest<TrainingRecord>(`/trainings/${id}/complete`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ certificateLink: certLink }),
      });

      clearApiCache('/trainings');
      setRecords((current) => current.map((record) => (record.id === id ? updated : record)));
      void refreshNotifications();
      setStatus('Formação marcada como concluída.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Falha ao concluir formação.');
    }
  }

  async function handleCertificateFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    setIsUploadingCertificate(true);
    try {
      const uploadedLink = await uploadTrainingCertificate(file);
      if (!uploadedLink) {
        throw new Error('Não foi possível obter o link do certificado carregado.');
      }
      setCompleteCertLink(uploadedLink);
      setStatus('Certificado carregado com sucesso.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Falha ao carregar certificado.');
    } finally {
      setIsUploadingCertificate(false);
      event.target.value = '';
    }
  }

  function openCompleteConfirm(recordId: string) {
    setCompleteConfirmRecordId(recordId);
    setCompleteCertLink('');
  }

  async function confirmCompleteRecord() {
    if (!completeConfirmRecordId) {
      return;
    }

    if (trainingsSettings.requireCertificateOnComplete && !completeCertLink.trim()) {
      setStatus(
        trainingsSettings.certificateMode === 'file_or_url'
          ? 'Certificado obrigatório: anexa ficheiro ou URL antes de confirmar.'
          : 'Certificado (URL) obrigatório para concluir a formação.',
      );
      return;
    }

    await handleCompleteRecord(completeConfirmRecordId, completeCertLink);
    setCompleteConfirmRecordId(null);
    setCompleteCertLink('');
  }

  return (
    <section className="trainings-shell">

      {availableScopes.length > 1 && (
        <nav className="trainings-scope-nav" aria-label="Âmbito das formações">
          {availableScopes.map(({ id: scopeId, label }) => (
            <button
              key={scopeId}
              type="button"
              className={`trainings-scope-nav__btn${scope === scopeId ? ' is-active' : ''}`}
              onClick={() => setScope(scopeId as TrainingsScope)}
              aria-current={scope === scopeId ? 'page' : undefined}
            >
              {scopeId === 'mine' ? (
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.58-7 8-7s8 3 8 7"/></svg>
              ) : scopeId === 'team' ? (
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="9" cy="8" r="3"/><path d="M2 20c0-3 2.5-5.5 6-5.5"/><circle cx="17" cy="8" r="3"/><path d="M22 20c0-3-2.5-5.5-6-5.5"/><path d="M9 20c0-2.5 1.5-4.5 3-5 1.5.5 3 2.5 3 5"/></svg>
              ) : (
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 3a7 7 0 0 1 0 18M12 3a7 7 0 0 0 0 18M3 12h18"/></svg>
              )}
              {label}
            </button>
          ))}
        </nav>
      )}

      <section className="trainings-list-card">
        <div className="trainings-list-head trainings-list-head--filters">
          <div className="trainings-list-head__title-row">
            <div className="trainings-list-head__title">
              <h3>{scopeConfig.title}</h3>
              <small>
                {visibleRecords.length === records.length
                  ? `${records.length} formação${records.length !== 1 ? '(ões)' : ''}`
                  : `${visibleRecords.length} de ${records.length} formação${records.length !== 1 ? '(ões)' : ''}`}
                {activeFilterCount > 0 && <span className="trainings-filter-active-badge">{activeFilterCount} filtro{activeFilterCount !== 1 ? 's' : ''} ativo{activeFilterCount !== 1 ? 's' : ''}</span>}
              </small>
            </div>
            <div className="trainings-list-head__topbar-actions">
              {canUseMonthlyRhReport ? (
                <Button type="button" variant="ghost" onClick={openMonthlyReportModal}>
                  Exportar relatório
                </Button>
              ) : (
                <Button type="button" variant="ghost" onClick={handleExportExcel} disabled={visibleRecords.length === 0 || isExportingExcel}>
                  {isExportingExcel ? 'A exportar...' : 'Exportar Excel'}
                </Button>
              )}
              {canViewHierarchyTrainings && (
                <Button type="button" variant="ghost" onClick={openSettingsModal}>Configurar formações</Button>
              )}
              {canAssignTraining && (
                <Button type="button" variant="primary" onClick={openAssignModal}>Nova formação</Button>
              )}
            </div>
          </div>

          {/* ── Basic filters ── */}
          <div className="trainings-filter-grid trainings-filter-grid--basic">
            <label>
              <span>Pesquisar</span>
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Nome, entidade, link, colaborador..."
              />
            </label>

            <label>
              <span>Estado</span>
              <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
                <option value="all">Todos os estados</option>
                <option value="ASSIGNED">Ativa</option>
                <option value="EM_CURSO">Em curso</option>
                <option value="COMPLETED">Concluída</option>
              </select>
            </label>

            {!isOwnScope && (
              <label>
                <span>Colaborador</span>
                <input
                  type="search"
                  value={recordsCollaboratorFilter}
                  onChange={(event) => setRecordsCollaboratorFilter(event.target.value)}
                  placeholder="Nome, username ou email..."
                />
              </label>
            )}

            <div className="trainings-filter-grid__actions trainings-filter-grid__actions--inline">
              <button
                type="button"
                className={`trainings-adv-toggle${showAdvancedFilters ? ' is-open' : ''}`}
                onClick={() => setShowAdvancedFilters((v) => !v)}
                aria-expanded={showAdvancedFilters}
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <path d="M2 4h12M4 8h8M6 12h4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
                </svg>
                Filtros avançados
                {activeFilterCount > 0 && (
                  <span className="trainings-adv-toggle__badge">{activeFilterCount}</span>
                )}
              </button>
              {activeFilterCount > 0 && (
                <Button type="button" variant="ghost" onClick={clearAllFilters}>Limpar tudo</Button>
              )}
            </div>
          </div>

          {/* ── Advanced filters panel ── */}
          {showAdvancedFilters && (
            <div className="trainings-filter-advanced">
              <div className="trainings-filter-advanced__grid">
                {uniqueEntidades.length > 0 && (
                  <label>
                    <span>Entidade</span>
                    <select value={entidadeFilter} onChange={(e) => setEntidadeFilter(e.target.value)}>
                      <option value="">Todas as entidades</option>
                      {uniqueEntidades.map((e) => (
                        <option key={e} value={e}>{e}</option>
                      ))}
                    </select>
                  </label>
                )}

                <label>
                  <span>Data início - de</span>
                  <input type="date" value={dataInicioFrom} onChange={(e) => setDataInicioFrom(e.target.value)} />
                </label>

                <label>
                  <span>Data início - até</span>
                  <input type="date" value={dataInicioTo} onChange={(e) => setDataInicioTo(e.target.value)} />
                </label>

                <label>
                  <span>Horas mínimas</span>
                  <input
                    type="number"
                    min="0"
                    step="0.5"
                    value={horasMin}
                    onChange={(e) => setHorasMin(e.target.value)}
                    placeholder="Ex: 4"
                  />
                </label>

                <label>
                  <span>Horas máximas</span>
                  <input
                    type="number"
                    min="0"
                    step="0.5"
                    value={horasMax}
                    onChange={(e) => setHorasMax(e.target.value)}
                    placeholder="Ex: 40"
                  />
                </label>

                <label>
                  <span>Origem</span>
                  <select value={origemFilter} onChange={(e) => setOrigemFilter(e.target.value as OrigemFilter)}>
                    <option value="all">Todas as origens</option>
                    <option value="propria">Própria (auto-registo)</option>
                    <option value="atribuida">Atribuída por gestor</option>
                  </select>
                </label>

                <label>
                  <span>Ordenar por</span>
                  <select value={sortField} onChange={(e) => setSortField(e.target.value as SortField)}>
                    <option value="createdAt">Data de registo</option>
                    <option value="nome">Nome da formação</option>
                    <option value="horas">Horas</option>
                    <option value="dataInicio">Data de início</option>
                    <option value="dataConclusao">Data de conclusão</option>
                    <option value="status">Estado</option>
                  </select>
                </label>

                <label>
                  <span>Direção</span>
                  <select value={sortDir} onChange={(e) => setSortDir(e.target.value as 'asc' | 'desc')}>
                    <option value="desc">Mais recente primeiro</option>
                    <option value="asc">Mais antigo primeiro</option>
                  </select>
                </label>
              </div>
            </div>
          )}
        </div>

        <div className="trainings-table-wrap">
          <table className="trainings-table" aria-label="Lista de formações">
            <thead>
              <tr>
                <th className="sortable-th trainings-col trainings-col--training" onClick={() => toggleSort('nome')}>Formação {sortIcon('nome')}</th>
                {!isOwnScope && <th className="trainings-col trainings-col--collaborator">Colaborador</th>}
                {showTeamColumn && <th className="trainings-col trainings-col--team">Equipa</th>}
                <th className="trainings-col trainings-col--origin">Origem</th>
                <th className="trainings-col trainings-col--link">Link</th>
                <th className="sortable-th trainings-col trainings-col--hours" onClick={() => toggleSort('horas')}>Horas {sortIcon('horas')}</th>
                <th className="sortable-th trainings-col trainings-col--start" onClick={() => toggleSort('dataInicio')}>Data de início {sortIcon('dataInicio')}</th>
                <th className="trainings-col trainings-col--entity">Entidade</th>
                <th className="sortable-th trainings-col trainings-col--completion" onClick={() => toggleSort('dataConclusao')}>Data conclusão {sortIcon('dataConclusao')}</th>
                <th className="sortable-th trainings-col trainings-col--status" onClick={() => toggleSort('status')}>Estado {sortIcon('status')}</th>
                {((isOwnScope && canMarkCompleted) || (!isOwnScope && canCompleteForOthers)) && <th className="trainings-col trainings-col--actions">Ações</th>}
              </tr>
            </thead>
            <tbody>
              {(isRecordsLoading && !recordsLoaded) ? (
                <tr>
                  <td colSpan={tableColumnCount}>A carregar formações...</td>
                </tr>
              ) : visibleRecords.length === 0 ? (
                <tr>
                  <td colSpan={tableColumnCount}>
                    {scopeConfig.emptyMessage}
                  </td>
                </tr>
              ) : (
                visibleRecords.map((record) => (
                  <tr key={record.id}>
                    <td className="trainings-col trainings-col--training">{record.nome}</td>
                    {!isOwnScope && <td className="trainings-col trainings-col--collaborator">{getTrainingOwnerLabel(record)}</td>}
                    {showTeamColumn && <td className="trainings-col trainings-col--team">{getTrainingTeamLabel(record)}</td>}
                    <td className="trainings-col trainings-col--origin">{getTrainingOriginLabel(record)}</td>
                    <td className="trainings-col trainings-col--link">{record.link ? <a href={record.link} target="_blank" rel="noreferrer">Abrir</a> : '-'}</td>
                    <td className="trainings-col trainings-col--hours">{formatHours(record.horas)} h</td>
                    <td className="trainings-col trainings-col--start">{getTrainingStartDate(record) || '-'}</td>
                    <td className="trainings-col trainings-col--entity">{record.entidade || '-'}</td>
                    <td className="trainings-col trainings-col--completion">{record.dataConclusao || '-'}</td>
                    <td className="trainings-col trainings-col--status">
                      <span className="trainings-status-badge">
                      <Badge tone={getTrainingStatusTone(record.status) === 'approved' ? 'success' : getTrainingStatusTone(record.status) === 'pending' ? 'warning' : 'neutral'}>
                        {formatTrainingStatusLabel(record.status)}
                      </Badge>
                      </span>
                    </td>
                    {((isOwnScope && canMarkCompleted) || (!isOwnScope && canCompleteForOthers)) && (
                      <td className="trainings-col trainings-col--actions">
                        {record.status === 'ASSIGNED' ? (
                          <div className="trainings-row-actions">
                            <Button type="button" size="sm" variant="secondary" onClick={() => openCompleteConfirm(record.id)}>Concluir</Button>
                          </div>
                        ) : (
                          '-'
                        )}
                      </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="trainings-mobile-list">
          {visibleRecords.length === 0 && !isRecordsLoading && <article className="trainings-mobile-card">{scopeConfig.emptyMessage}</article>}

          {visibleRecords.map((record) => (
            <article key={`mobile-${record.id}`} className="trainings-mobile-card">
              <header>
                <h4>{record.nome}</h4>
                <Badge tone={getTrainingStatusTone(record.status) === 'approved' ? 'success' : getTrainingStatusTone(record.status) === 'pending' ? 'warning' : 'neutral'}>
                  {formatTrainingStatusLabel(record.status)}
                </Badge>
              </header>
              {!isOwnScope && (
                <p>
                  <span>Colaborador:</span> {getTrainingOwnerLabel(record)}
                </p>
              )}
              {showTeamColumn && (
                <p>
                  <span>Equipa:</span> {getTrainingTeamLabel(record)}
                </p>
              )}
              <p>
                <span>Origem:</span> {getTrainingOriginLabel(record)}
              </p>
              <p>
                <span>Horas:</span> {formatHours(record.horas)} h
              </p>
              <p>
                <span>Data de início:</span> {getTrainingStartDate(record) || '-'}
              </p>
              <p>
                <span>Entidade:</span> {record.entidade || '-'}
              </p>
              <p>
                <span>Data:</span> {record.dataConclusao || '-'}
              </p>

              <div className="trainings-mobile-links">
                {record.link && (
                  <a href={record.link} target="_blank" rel="noreferrer">Abrir link</a>
                )}
              </div>

              {((isOwnScope && canMarkCompleted) || (!isOwnScope && canCompleteForOthers)) && record.status === 'ASSIGNED' && (
                <div className="trainings-row-actions">
                  <Button type="button" size="sm" variant="secondary" onClick={() => openCompleteConfirm(record.id)}>Concluir</Button>
                </div>
              )}
            </article>
          ))}
        </div>

        <Toast show={Boolean(status)} tone={resolveStatusTone(status)} message={status} />
      </section>

      {isAssignModalOpen && (
        <div className="quick-overlay" onClick={() => setIsAssignModalOpen(false)}>
          <section className="quick-modal trainings-modal" onClick={(event) => event.stopPropagation()} aria-modal="true" role="dialog" aria-label="Atribuir nova formação">
            <div className="quick-modal__head">
              <h3>Nova formação</h3>
              <Button type="button" variant="ghost" onClick={() => setIsAssignModalOpen(false)}>Fechar</Button>
            </div>

            <form className="trainings-form" onSubmit={handleAssignTraining} noValidate>
              <div className="field-span-2 vacations-operation-panel">
                <div className="vacations-operation-panel__head">
                  <div>
                    <span className="vacations-operation-panel__eyebrow">Colaboradores</span>
                    <strong>Seleciona um ou mais colaboradores</strong>
                  </div>
                  <button type="button" className="vacations-operation-panel__trigger" onClick={openCollaboratorPicker}>
                    Escolher colaboradores
                  </button>
                </div>

                {selectedCollaborators.length > 0 ? (
                  <div className="rh-selected-chips">
                    {selectedCollaborators.map((collab) => {
                      const name = collab.profile?.nomeCompleto ?? collab.username;
                      return (
                        <span key={collab.id} className="rh-selected-chip">
                          {name}
                        </span>
                      );
                    })}
                  </div>
                ) : (
                  <div className="vacations-operation-panel__empty">Nenhum colaborador selecionado.</div>
                )}
              </div>

              {/* ── Training details ── */}
              <label>
                <span>Nome da formação *</span>
                <input type="text" value={assignDraft.nome} onChange={(event) => updateAssignDraft('nome', event.target.value)} />
              </label>

              <label>
                <span>
                  Horas *
                  <span
                    className="field-hint"
                    data-hint="Insere um número decimal. Usa ponto ou vírgula como separador (ex: 1.5 ou 1,5). Exemplos: 8 = 8h · 1.5 = 1h30 · 0.5 = 30min. Valor mínimo: 0."
                    tabIndex={0}
                    role="note"
                    aria-label="Ajuda: campo Horas"
                  >?</span>
                </span>
                <input type="text" inputMode="decimal" value={assignDraft.horas} onChange={(event) => updateAssignDraft('horas', event.target.value)} />
              </label>

              <label>
                <span>Link</span>
                <input type="url" value={assignDraft.link} onChange={(event) => updateAssignDraft('link', event.target.value)} placeholder="https://..." />
              </label>

              <label>
                <span>Data de início</span>
                <input type="date" value={assignDraft.dataInicio} onChange={(event) => updateAssignDraft('dataInicio', event.target.value)} />
              </label>

              <label>
                <span>Entidade</span>
                <select value={assignDraft.entidade} onChange={(event) => updateAssignDraft('entidade', event.target.value)}>
                  <option value="">Selecionar entidade...</option>
                  {trainingEntityOptions.map((e) => (
                    <option key={e} value={e}>{e}</option>
                  ))}
                </select>
              </label>

              <div className="trainings-form-actions field-span-2">
                <Button type="submit" variant="primary" disabled={assignBusy}>
                  {assignBusy
                    ? `A atribuir... (${selectedUserIds.length})`
                    : selectedUserIds.length > 1
                    ? `Atribuir a ${selectedUserIds.length} colaboradores`
                    : 'Atribuir formação'}
                </Button>
              </div>
            </form>

            <Toast show={Boolean(assignStatus)} tone={resolveStatusTone(assignStatus)} message={assignStatus} />

            {isCollaboratorPickerOpen && (
              <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="trainings-collaborator-picker-title" onClick={(event) => { if (event.target === event.currentTarget) closeCollaboratorPicker(); }}>
                <div className="pending-modal pending-modal--vacations vacations-picker-modal">
                  <div className="pending-modal__header vacations-picker-modal__header">
                    <div>
                      <p className="pending-modal__kicker">Seleção</p>
                      <h2 id="trainings-collaborator-picker-title">Escolher colaboradores</h2>
                      <p className="vacations-company-days-subtitle">Filtra a lista, seleciona os colaboradores pretendidos e confirma para voltar ao formulário.</p>
                    </div>
                    <button type="button" className="pending-modal__close" onClick={closeCollaboratorPicker} aria-label="Fechar">×</button>
                  </div>

                  <div className="vacations-picker-modal__body">
                    <div className="vacations-picker-modal__toolbar">
                      <label className="vacations-export-form__field vacations-picker-modal__search">
                        <span>Pesquisar</span>
                        <input
                          type="search"
                          value={collaboratorQuery}
                          onChange={(event) => setCollaboratorQuery(event.target.value)}
                          placeholder="Nome, email, cargo ou função"
                          autoComplete="off"
                        />
                      </label>
                    </div>

                    <div className="rh-picker-bulk-bar">
                      <button
                        type="button"
                        className="rh-picker-bulk-btn"
                        onClick={selectAllVisibleDraft}
                        disabled={filteredCollaborators.length === 0 || filteredCollaborators.every((c) => draftSelectedUserIds.includes(c.id))}
                      >
                        Selecionar {collaboratorQuery.trim() ? `visíveis (${filteredCollaborators.length})` : `todos (${allCollaborators.length})`}
                      </button>
                      <button
                        type="button"
                        className="rh-picker-bulk-btn rh-picker-bulk-btn--clear"
                        onClick={clearDraftSelection}
                        disabled={draftSelectedUserIds.length === 0}
                      >
                        Limpar seleção
                      </button>
                      <span className="vacations-picker-modal__count">{draftSelectedUserIds.length} selecionado(s)</span>
                    </div>

                    <div className="rh-collaborator-results rh-collaborator-results--multi vacations-picker-modal__results" role="listbox" aria-label="Lista de colaboradores para formações">
                      {isLoadingCollaborators ? (
                        <p className="rh-picker-loading">A carregar colaboradores...</p>
                      ) : allCollaborators.length === 0 ? (
                        <p className="rh-picker-empty">Nenhum colaborador disponível.</p>
                      ) : filteredCollaborators.length === 0 ? (
                        <p className="rh-picker-empty">Sem resultados para "{collaboratorQuery}".</p>
                      ) : (
                        filteredCollaborators.map((collab) => {
                          const isSelected = draftSelectedUserIds.includes(collab.id);
                          const displayName = collab.profile?.nomeCompleto ?? collab.username;
                          return (
                            <button
                              key={collab.id}
                              type="button"
                              role="option"
                              aria-selected={isSelected}
                              className={`rh-collaborator-result${isSelected ? ' rh-collaborator-result--selected' : ''}`}
                              onClick={() => toggleDraftCollaborator(collab.id)}
                            >
                              <span className="rh-collab-check" aria-hidden="true">{isSelected ? '✓' : '○'}</span>
                              <span className="rh-collab-info">
                                <strong>{displayName}</strong>
                                <span>{collab.email}</span>
                                <small>{collab.profile?.cargo || formatRoleLabel(collab.role)}</small>
                              </span>
                            </button>
                          );
                        })
                      )}
                    </div>
                  </div>

                  <div className="vacations-picker-modal__footer">
                    <button type="button" className="vacations-picker-modal__secondary" onClick={closeCollaboratorPicker}>Cancelar</button>
                    <Button type="button" variant="primary" onClick={confirmCollaboratorPicker} disabled={draftSelectedUserIds.length === 0}>
                      Confirmar seleção
                    </Button>
                  </div>
                </div>
              </div>
            )}

            {recentAssigned.length > 0 && (
              <section className="trainings-recent-created" aria-label="Últimas formações criadas">
                <h4>Últimas formações criadas</h4>
                <ul>
                  {recentAssigned.map((item) => (
                    <li key={item.id}>
                      <strong>{item.nome}</strong>
                      <span>{item.collaborator}</span>
                      <small>{new Intl.DateTimeFormat('pt-PT', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' }).format(new Date(item.createdAt))}</small>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </section>
        </div>
      )}

      <Modal
        open={isMonthlyReportModalOpen}
        title="Relatório mensal de formações (RH)"
        onClose={() => setIsMonthlyReportModalOpen(false)}
        width="min(860px, 96vw)"
        footer={
          <div className="modal-footer-split trainings-monthly-modal__footer">
            <Button type="button" variant="ghost" onClick={() => setIsMonthlyReportModalOpen(false)}>Fechar</Button>
            <div className="trainings-monthly-modal__footer-actions">
              <Button type="button" variant="secondary" onClick={() => void exportMonthlyReport('csv')} disabled={isExportingMonthlyReport || !monthlyReportPreview}>
                {isExportingMonthlyReport ? 'A exportar...' : 'Exportar CSV'}
              </Button>
              <Button type="button" variant="primary" onClick={() => void exportMonthlyReport('pdf')} disabled={isExportingMonthlyReport || !monthlyReportPreview}>
                {isExportingMonthlyReport ? 'A exportar...' : 'Exportar PDF'}
              </Button>
            </div>
          </div>
        }
      >
        <div className="trainings-monthly-modal">
          <section className="trainings-monthly-modal__hero">
            <div>
              <p className="trainings-monthly-modal__kicker">Painel RH</p>
              <h4>{monthlyReportDisplayMonth || 'Relatório mensal'}</h4>
            </div>
            <div className="trainings-monthly-modal__quick-metrics" aria-live="polite">
              <article>
                <span>Equipas</span>
                <strong>{monthlyReportPreview?.totals.teams ?? '-'}</strong>
              </article>
              <article>
                <span>Formações</span>
                <strong>{monthlyReportPreview?.totals.upcomingTrainings ?? '-'}</strong>
              </article>
              <article>
                <span>Conclusão</span>
                <strong>{monthlyReportPreview ? `${monthlyReportPreview.totals.completionRate.toFixed(2)}%` : '-'}</strong>
              </article>
            </div>
          </section>

          <section className="trainings-monthly-modal__filters">
            <label>
              <span>Mês</span>
              <input type="month" value={monthlyReportMonth} onChange={(event) => setMonthlyReportMonth(event.target.value)} />
            </label>
            <label>
              <span>Equipa</span>
              <select value={monthlyReportTeamId} onChange={(event) => setMonthlyReportTeamId(event.target.value)}>
                <option value="">Todas as equipas</option>
                {monthlyReportTeamOptions.map((team) => (
                  <option key={team.id} value={team.id}>{team.name}</option>
                ))}
              </select>
            </label>
            <div className="trainings-monthly-modal__filters-action">
              <Button type="button" variant="secondary" onClick={() => void loadMonthlyReportPreview()} disabled={isLoadingMonthlyReport}>
                {isLoadingMonthlyReport ? 'A consultar...' : 'Consultar relatório'}
              </Button>
            </div>
          </section>

          {!monthlyReportPreview ? (
            <div className="trainings-monthly-modal__empty">
              <strong>Sem pré-visualização ainda</strong>
              <p>Seleciona mês e equipa para carregar um resumo inteligente com os principais indicadores.</p>
            </div>
          ) : (
            <>
              <section className="trainings-monthly-modal__table-wrap">
                <table className="trainings-table" aria-label="Resumo mensal por equipa">
                  <thead>
                    <tr>
                      <th>Equipa</th>
                      <th>Formações (3 meses)</th>
                      <th>Horas</th>
                      <th>Colaboradores</th>
                      <th>Atribuídas no mês</th>
                      <th>Concluídas no mês</th>
                      <th>Taxa conclusão</th>
                    </tr>
                  </thead>
                  <tbody>
                    {monthlyReportPreview.teams.length === 0 ? (
                      <tr><td colSpan={7}>Sem dados para os filtros selecionados.</td></tr>
                    ) : monthlyReportPreview.teams.map((team) => (
                      <tr key={`report-${team.teamId}`}>
                        <td>{team.teamName}</td>
                        <td>{team.upcomingTrainings}</td>
                        <td>{team.upcomingHours}</td>
                        <td>{team.collaborators}</td>
                        <td>{team.assignedInMonth}</td>
                        <td>{team.completedInMonth}</td>
                        <td>{team.completionRate.toFixed(2)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            </>
          )}
        </div>
      </Modal>

      <Modal
        open={isSettingsModalOpen}
        title="Configurações de formações"
        onClose={() => setIsSettingsModalOpen(false)}
        width="min(760px, 94vw)"
        footer={
          <div className="modal-footer-split">
            <Button type="button" variant="ghost" onClick={() => setIsSettingsModalOpen(false)}>Fechar</Button>
            <Button type="button" variant="primary" onClick={() => void saveTrainingsSettings()} disabled={isSavingSettings}>
              {isSavingSettings ? 'A guardar...' : 'Guardar configurações'}
            </Button>
          </div>
        }
      >
        <div className="permissions-access-modal">
          <label>
            <span>Entidades de formação</span>
            <div className="trainings-entity-editor">
              <input
                type="text"
                value={newEntityInput}
                onChange={(event) => setNewEntityInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    addEntityToDraft(newEntityInput);
                  }
                }}
                placeholder="Ex.: Udemy"
              />
              <Button type="button" variant="secondary" onClick={() => addEntityToDraft(newEntityInput)}>
                Adicionar
              </Button>
            </div>
          </label>

          <div className="trainings-entity-chip-grid" role="list" aria-label="Entidades configuradas">
            {trainingsSettingsDraft.entities.length === 0 ? (
              <p className="trainings-entity-empty">Sem entidades configuradas.</p>
            ) : (
              trainingsSettingsDraft.entities.map((entity) => (
                <span key={entity} className="trainings-entity-chip" role="listitem">
                  <span>{entity}</span>
                  <button type="button" onClick={() => removeEntityFromDraft(entity)} aria-label={`Remover ${entity}`}>
                    ×
                  </button>
                </span>
              ))
            )}
          </div>

          <div className="trainings-entity-suggestions">
            <span>Sugestões rápidas</span>
            <div>
              {DEFAULT_TRAINING_ENTITIES.filter((entity) => !trainingsSettingsDraft.entities.some((draft) => draft.toLowerCase() === entity.toLowerCase())).slice(0, 10).map((entity) => (
                <button key={`suggestion-${entity}`} type="button" onClick={() => addEntityToDraft(entity)}>
                  + {entity}
                </button>
              ))}
            </div>
          </div>

          <label>
            <span>Submissão de certificado ao concluir</span>
            <select
              value={trainingsSettingsDraft.requireCertificateOnComplete ? 'required' : 'optional'}
              onChange={(event) => setTrainingsSettingsDraft((current) => ({
                ...current,
                requireCertificateOnComplete: event.target.value === 'required',
              }))}
            >
              <option value="optional">Opcional</option>
              <option value="required">Obrigatório</option>
            </select>
          </label>

          <label>
            <span>Modo de certificado</span>
            <select
              value={trainingsSettingsDraft.certificateMode}
              onChange={(event) => setTrainingsSettingsDraft((current) => ({
                ...current,
                certificateMode: event.target.value as TrainingsSettings['certificateMode'],
              }))}
            >
              <option value="url">Apenas URL</option>
              <option value="file_or_url">Ficheiro ou URL</option>
            </select>
          </label>

          <Toast show={Boolean(settingsStatus)} tone={resolveStatusTone(settingsStatus)} message={settingsStatus} />
        </div>
      </Modal>

      <Modal
        open={Boolean(completeConfirmRecordId)}
        title="Confirmar conclusão"
        onClose={() => setCompleteConfirmRecordId(null)}
        width="min(640px, 92vw)"
        showCloseButton={false}
        footer={
          <div className="modal-footer-split">
            <Button type="button" variant="ghost" onClick={() => setCompleteConfirmRecordId(null)}>Cancelar</Button>
            <Button type="button" variant="primary" onClick={() => void confirmCompleteRecord()}>Confirmar</Button>
          </div>
        }
      >
        <div className="permissions-access-modal">
          <p>Adicione um certificado {trainingsSettings.requireCertificateOnComplete ? '(obrigatório)' : ' (opcional)'}, URL ou ficheiro, para concluir a formação.</p>
          <label className="trainings-cert-label">
            <span>URL</span>
            <input
              type="url"
              className="trainings-cert-input"
              placeholder={trainingsSettings.certificateMode === 'file_or_url' ? 'https://... (ou anexa ficheiro abaixo)' : 'https://... link do certificado ou evidência'}
              value={completeCertLink}
              onChange={(e) => setCompleteCertLink(e.target.value)}
            />
          </label>
          {trainingsSettings.certificateMode === 'file_or_url' && (
            <label className="trainings-cert-label">
              <span>Carregar ficheiro do certificado</span>
              <input
                type="file"
                accept=".pdf,.png,.jpg,.jpeg,.webp,.doc,.docx"
                onChange={(event) => void handleCertificateFileChange(event)}
                disabled={isUploadingCertificate}
              />
              {isUploadingCertificate && <small>A carregar certificado...</small>}
            </label>
          )}
          <p className="permissions-access-warning">A alteração só é aplicada depois de confirmares.</p>
        </div>
      </Modal>
    </section>
  );
}
