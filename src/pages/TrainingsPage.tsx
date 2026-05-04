import { FormEvent, useEffect, useMemo, useState } from 'react';
import { usePortal } from '../portal/context';
import { apiRequest, apiRequestCached, authHeaders, clearApiCache, isAbortError } from '../portal/api';
import { formatRoleLabel, formatTrainingStatusLabel, getTrainingStatusTone } from '../portal/labels';
import Badge from '../components/ui/Badge';
import Button from '../components/ui/Button';
import Modal from '../components/ui/Modal';
import Toast from '../components/ui/Toast';

const STORAGE_TOKEN_KEY = 'smarter_hub_auth_token';

function getAuthHeaders() {
  const token = localStorage.getItem(STORAGE_TOKEN_KEY) || '';
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
  const { hasPermission, isRootAccess, refreshNotifications } = usePortal();
  const canAssignTraining = isRootAccess || hasPermission('assign_training');
  const canViewHierarchyTrainings = isRootAccess || hasPermission('view_all_trainings');
  const canViewTeamTrainings = canAssignTraining;
  const canMarkCompleted = isRootAccess || hasPermission('mark_training_completed');
  const [scope, setScope] = useState<TrainingsScope>('mine');

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
  const [isLoadingCollaborators, setIsLoadingCollaborators] = useState(false);
  const [isAssignModalOpen, setIsAssignModalOpen] = useState(false);
  const [isRecordsLoading, setIsRecordsLoading] = useState(false);
  const [recordsLoaded, setRecordsLoaded] = useState(false);
  const [completeConfirmRecordId, setCompleteConfirmRecordId] = useState<string | null>(null);
  const [recentAssigned, setRecentAssigned] = useState<RecentAssignedItem[]>([]);
  const [isExportingExcel, setIsExportingExcel] = useState(false);

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
    if (isOwnScope && canMarkCompleted) {
      count += 1;
    }
    return count;
  }, [canMarkCompleted, isOwnScope, showTeamColumn]);

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

  const availableScopes = useMemo(() => {
    const scopes: Array<{ id: TrainingsScope; label: string }> = [{ id: 'mine', label: 'Minhas' }];
    if (canViewTeamTrainings) {
      scopes.push({ id: 'team', label: 'Equipa' });
    }
    if (canViewHierarchyTrainings) {
      scopes.push({ id: 'hierarchy', label: 'Organização' });
    }
    return scopes;
  }, [canViewHierarchyTrainings, canViewTeamTrainings]);

  useEffect(() => {
    const controller = new AbortController();

    void loadTrainings(controller.signal);

    return () => controller.abort();
  }, [scope]);

  useEffect(() => {
    if (scope === 'team' && !canViewTeamTrainings) {
      setScope(canViewHierarchyTrainings ? 'hierarchy' : 'mine');
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

  async function loadTrainings(signal?: AbortSignal) {
    setIsRecordsLoading(records.length === 0);
    try {
      const path = scope === 'team'
        ? '/trainings/team'
        : scope === 'hierarchy'
          ? '/trainings/hierarchy'
          : '/trainings/me';
      const data = await apiRequestCached<TrainingRecord[]>(path, {
        headers: getAuthHeaders(),
        signal,
      }, 60000);
      setRecords(data);
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

  function selectAllVisible() {
    setSelectedUserIds((current) => {
      const toAdd = filteredCollaborators.map((c) => c.id).filter((id) => !current.includes(id));
      return [...current, ...toAdd];
    });
  }

  function clearSelection() {
    setSelectedUserIds([]);
  }

  function openAssignModal() {
    setIsAssignModalOpen(true);
    setAssignStatus('');
    setCollaboratorQuery('');
    setSelectedUserIds([]);
    setAssignDraft(EMPTY_ASSIGN_DRAFT);
    if (allCollaborators.length === 0) {
      void loadAllCollaborators();
    }
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

  async function handleCompleteRecord(id: string) {
    try {
      const updated = await apiRequest<TrainingRecord>(`/trainings/${id}/complete`, {
        method: 'POST',
        headers: getAuthHeaders(),
      });

      clearApiCache('/trainings');
      setRecords((current) => current.map((record) => (record.id === id ? updated : record)));
      void refreshNotifications();
      setStatus('Formação marcada como concluída.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Falha ao concluir formação.');
    }
  }

  function openCompleteConfirm(recordId: string) {
    setCompleteConfirmRecordId(recordId);
  }

  async function confirmCompleteRecord() {
    if (!completeConfirmRecordId) {
      return;
    }

    await handleCompleteRecord(completeConfirmRecordId);
    setCompleteConfirmRecordId(null);
  }

  return (
    <section className="trainings-shell">
      <section className="trainings-hero trainings-hero--scoped" aria-label="Resumo das formações visíveis">
        <div className="trainings-hero__intro">
          <span className="trainings-hero__eyebrow">Formações</span>
          <h2>{scopeConfig.title}</h2>
          <p>{scopeConfig.description}</p>
          <div className="trainings-scope-switch" role="tablist" aria-label="Âmbitos de visibilidade das formações">
            {availableScopes.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`trainings-scope-switch__item${scope === item.id ? ' is-active' : ''}`}
                onClick={() => setScope(item.id)}
                aria-pressed={scope === item.id}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        <div className="trainings-hours-summary trainings-hours-summary--hero">
          <article>
            <span>Âmbito</span>
            <strong>{scopeConfig.summaryLabel}</strong>
          </article>
          <article>
            <span>Ativas</span>
            <strong>{assignedCount}</strong>
          </article>
          <article>
            <span>Concluídas</span>
            <strong>{completedCount}</strong>
          </article>
          <article>
            <span>Horas</span>
            <strong>{formatHours(totalHours)} h</strong>
          </article>
        </div>
      </section>

      <section className="trainings-list-card">
        <div className="trainings-list-head trainings-list-head--filters">
          <div className="trainings-list-head__title-row">
            <div className="trainings-list-head__title">
              <h3>{scopeConfig.title}</h3>
              <small>
                {visibleRecords.length === records.length
                  ? `${records.length} formação${records.length !== 1 ? 'ões' : ''}`
                  : `${visibleRecords.length} de ${records.length} formação${records.length !== 1 ? 'ões' : ''}`}
                {activeFilterCount > 0 && <span className="trainings-filter-active-badge">{activeFilterCount} filtro{activeFilterCount !== 1 ? 's' : ''} ativo{activeFilterCount !== 1 ? 's' : ''}</span>}
              </small>
            </div>
            <div className="trainings-list-head__topbar-actions">
              <Button type="button" variant="ghost" onClick={handleExportExcel} disabled={visibleRecords.length === 0 || isExportingExcel}>
                {isExportingExcel ? 'A exportar...' : 'Exportar Excel'}
              </Button>
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
                <th className="sortable-th" onClick={() => toggleSort('nome')}>Formação {sortIcon('nome')}</th>
                {!isOwnScope && <th>Colaborador</th>}
                {showTeamColumn && <th>Equipa</th>}
                <th>Origem</th>
                <th>Link</th>
                <th className="sortable-th" onClick={() => toggleSort('horas')}>Horas {sortIcon('horas')}</th>
                <th className="sortable-th" onClick={() => toggleSort('dataInicio')}>Data de início {sortIcon('dataInicio')}</th>
                <th>Entidade</th>
                <th className="sortable-th" onClick={() => toggleSort('dataConclusao')}>Data conclusão {sortIcon('dataConclusao')}</th>
                <th className="sortable-th" onClick={() => toggleSort('status')}>Estado {sortIcon('status')}</th>
                {isOwnScope && canMarkCompleted && <th>Ações</th>}
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
                    <td>{record.nome}</td>
                    {!isOwnScope && <td>{getTrainingOwnerLabel(record)}</td>}
                    {showTeamColumn && <td>{getTrainingTeamLabel(record)}</td>}
                    <td>{getTrainingOriginLabel(record)}</td>
                    <td>{record.link ? <a href={record.link} target="_blank" rel="noreferrer">Abrir</a> : '-'}</td>
                    <td>{formatHours(record.horas)} h</td>
                    <td>{getTrainingStartDate(record) || '-'}</td>
                    <td>{record.entidade || '-'}</td>
                    <td>{record.dataConclusao || '-'}</td>
                    <td>
                      <Badge tone={getTrainingStatusTone(record.status) === 'approved' ? 'success' : getTrainingStatusTone(record.status) === 'pending' ? 'warning' : 'neutral'}>
                        {formatTrainingStatusLabel(record.status)}
                      </Badge>
                    </td>
                    {isOwnScope && canMarkCompleted && (
                      <td>
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

              {isOwnScope && canMarkCompleted && record.status === 'ASSIGNED' && (
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
              {/* ── Collaborator multi-picker ── */}
              <div className="field-span-2 rh-collaborator-picker">
                <div className="rh-picker-header">
                  <span>Colaboradores *</span>
                  {selectedUserIds.length > 0 && (
                    <span className="rh-picker-badge">{selectedUserIds.length} selecionado{selectedUserIds.length !== 1 ? 's' : ''}</span>
                  )}
                </div>

                {/* Selected chips */}
                {selectedCollaborators.length > 0 && (
                  <div className="rh-selected-chips">
                    {selectedCollaborators.map((collab) => {
                      const name = collab.profile?.nomeCompleto ?? collab.username;
                      return (
                        <span key={collab.id} className="rh-selected-chip">
                          {name}
                          <button type="button" aria-label={`Remover ${name}`} onClick={() => toggleCollaborator(collab.id)}>×</button>
                        </span>
                      );
                    })}
                  </div>
                )}

                {/* Search input */}
                <div className="rh-picker-search-row">
                  <input
                    type="search"
                    value={collaboratorQuery}
                    onChange={(event) => setCollaboratorQuery(event.target.value)}
                    placeholder="Filtrar por nome, email, cargo ou função..."
                  />
                </div>

                {/* Bulk action bar */}
                {!isLoadingCollaborators && allCollaborators.length > 0 && (
                  <div className="rh-picker-bulk-bar">
                    <button
                      type="button"
                      className="rh-picker-bulk-btn"
                      onClick={selectAllVisible}
                      disabled={filteredCollaborators.every((c) => selectedUserIds.includes(c.id))}
                    >
                      Selecionar {collaboratorQuery.trim() ? `visíveis (${filteredCollaborators.length})` : `todos (${allCollaborators.length})`}
                    </button>
                    {selectedUserIds.length > 0 && (
                      <button type="button" className="rh-picker-bulk-btn rh-picker-bulk-btn--clear" onClick={clearSelection}>
                        Limpar seleção
                      </button>
                    )}
                  </div>
                )}

                {/* Results list */}
                <div className="rh-collaborator-results rh-collaborator-results--multi" role="listbox" aria-label="Lista de colaboradores">
                  {isLoadingCollaborators && (
                    <p className="rh-picker-loading">A carregar colaboradores...</p>
                  )}
                  {!isLoadingCollaborators && allCollaborators.length === 0 && (
                    <p className="rh-picker-empty">Nenhum colaborador disponível.</p>
                  )}
                  {!isLoadingCollaborators && allCollaborators.length > 0 && filteredCollaborators.length === 0 && (
                    <p className="rh-picker-empty">Sem resultados para "{collaboratorQuery}".</p>
                  )}
                  {!isLoadingCollaborators &&
                    filteredCollaborators.map((collab) => {
                      const isSelected = selectedUserIds.includes(collab.id);
                      const displayName = collab.profile?.nomeCompleto ?? collab.username;
                      return (
                        <button
                          key={collab.id}
                          type="button"
                          role="option"
                          aria-selected={isSelected}
                          className={`rh-collaborator-result${isSelected ? ' rh-collaborator-result--selected' : ''}`}
                          onClick={() => toggleCollaborator(collab.id)}
                        >
                          <span className="rh-collab-check" aria-hidden="true">
                            {isSelected ? (
                              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                                <rect width="14" height="14" rx="3" fill="#1d6fcf" />
                                <path d="M3 7l3 3 5-5" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                              </svg>
                            ) : (
                              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                                <rect x="0.5" y="0.5" width="13" height="13" rx="2.5" stroke="#c3d5ef" />
                              </svg>
                            )}
                          </span>
                          <span className="rh-collab-info">
                            <strong>{displayName}</strong>
                            <span>{collab.email}</span>
                            <small>{collab.profile?.cargo || formatRoleLabel(collab.role)}</small>
                          </span>
                        </button>
                      );
                    })}
                </div>
              </div>

              {/* ── Training details ── */}
              <label>
                <span>Nome da formação *</span>
                <input type="text" value={assignDraft.nome} onChange={(event) => updateAssignDraft('nome', event.target.value)} />
              </label>

              <label>
                <span>Horas *</span>
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
                <input type="text" value={assignDraft.entidade} onChange={(event) => updateAssignDraft('entidade', event.target.value)} placeholder="Ex: Udemy" />
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
          <p>Esta ação vai marcar a formação como concluída.</p>
          <p className="permissions-access-warning">A alteração só é aplicada depois de confirmares.</p>
        </div>
      </Modal>
    </section>
  );
}
