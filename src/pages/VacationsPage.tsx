import { ChangeEvent, FormEvent, Fragment, type CSSProperties, useEffect, useMemo, useRef, useState } from 'react';
import { apiRequest, apiRequestCached, authHeaders, clearApiCache, getApiBase, isAbortError } from '../portal/api';
import { usePortal } from '../portal/context';
import { formatVacationStatusLabel, getVacationStatusTone } from '../portal/labels';
import Badge from '../components/ui/Badge';
import Button from '../components/ui/Button';
import Toast from '../components/ui/Toast';

const STORAGE_TOKEN_KEY = 'smarter_hub_auth_token';

function getAuthHeaders() {
  const token = localStorage.getItem(STORAGE_TOKEN_KEY) || '';
  return authHeaders(token);
}

type VacationRequestType = 'VACATION' | 'ABSENCE_MEDICAL' | 'ABSENCE_TRAINING';

type RequestKind = 'VACATION' | 'ABSENCE';

const ABSENCE_MOTIVOS = [
  'Não Justificada',
  'Justificada - Greve',
  'Justificada - Atividades empresa',
  'Justificada - Assistência à família',
  'Justificada - Assuntos escolares',
  'Justificada - Licença casamento',
  'Justificada - Consultas médicas',
  'Justificada - Doença',
  'Justificada - Formação',
  'Justificada - Licença parental',
  'Justificada - Morte de familiar',
  'Justificada - Trabalho remoto',
  'Justificada - Feriado local',
  'Justificada - Compensação de horas',
  'Justificada - Obrigações legais',
  'Justificada - Isolamento profilático',
  'Justificada - Dia aniversário',
  'Justificada - Tolerância dada pela empresa',
  'Justificada - Folga',
] as const;
type AbsenceMotivo = typeof ABSENCE_MOTIVOS[number];
type VacationPartialDay = 'FULL' | 'AM' | 'PM';

type VacationRecord = {
  id: string;
  contextTeamId?: string | null;
  contextTeam?: { id: string; name: string } | null;
  versionOfId?: string | null;
  versionNumber?: number;
  dataInicio: string;
  dataFim: string;
  observacoes: string;
  requestType: VacationRequestType;
  partialDay?: VacationPartialDay;
  attachmentLink: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
  createdAt: string;
  reviewReason?: string;
  user?: {
    id: string;
    username: string;
    role: string;
    team?: { id: string; name: string } | null;
    profile?: {
      nomeAbreviado?: string;
      primeiroNome?: string;
      apelido?: string;
    } | null;
  };
  approvals?: Array<{
    approverId: string;
    approvalLevel: number;
    status: string;
  }>;
};

type TeamContext = {
  teamId: string;
  teamName: string;
  membershipRole: string;
  isApprover: boolean;
  approvalLevel: number | null;
  isPrimary: boolean;
};

type TeamScopeEntry = {
  id: string;
  name: string;
};

type VacationOverview = {
  country: 'PT' | 'BR';
  year: number;
  rules: Record<string, unknown>;
  approvedVacationDays?: number;
  pendingVacationDays?: number;
  approvedAbsenceDays?: number;
  pendingAbsenceDays?: number;
  calculation?: {
    monthsWorked?: number;
    acquisitionComplete?: boolean;
    unjustifiedAbsences?: number;
    baseEntitledDays?: number;
    extraBalanceDays?: number;
    availableEntitledDays?: number;
    soldVacationDays?: number;
    maxSellableDays?: number;
    entitledDays: number;
  };
};

type CalendarPayload = {
  year: number;
  country: 'PT' | 'BR';
  holidays: string[];
  weekendDays: string[];
  approvedDays: string[];
  approvedAbsenceDays: string[];
  pendingDays: string[];
  absencesDays: string[];
  extraDays: string[];
  extraDayDetails?: Array<{ date: string; label: string }>;
  requests: VacationRecord[];
};

type TeamVacation = {
  id: string;
  dataInicio: string;
  dataFim: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
  requestType: VacationRequestType;
  partialDay?: VacationPartialDay;
  contextTeam?: { id: string; name: string } | null;
};

type TeamVacationMember = {
  id: string;
  username: string;
  email: string;
  role: 'COLABORADOR' | 'MANAGER' | 'COORDENADOR' | 'ADMIN' | 'CONVIDADO';
  teamId: string | null;
  membershipRole: string;
  isApprover: boolean;
  approvalLevel: number | null;
  profile?: {
    nomeAbreviado?: string;
    nomeCompleto?: string;
    dataNascimento?: string;
  } | null;
  vacations: TeamVacation[];
};

type TeamVacationDetail = {
  id: string;
  name: string;
  leaderId?: string | null;
  manager?: {
    id: string;
    username: string;
    profile?: {
      nomeAbreviado?: string;
      nomeCompleto?: string;
    } | null;
  } | null;
  coordinator?: {
    id: string;
    username: string;
    profile?: {
      nomeAbreviado?: string;
      nomeCompleto?: string;
    } | null;
  } | null;
  members: TeamVacationMember[];
};

type TeamSpecialCalendarPayload = {
  year: number;
  country: 'PT' | 'BR';
  holidays: string[];
  weekendDays: string[];
  extraDays: string[];
  extraDayDetails?: Array<{ date: string; label: string }>;
};

type TeamCalendarPerson = TeamVacationMember & { isTeamLeader?: boolean };

type CompanyExtraDay = {
  date: string;
  label: string;
};

type CompanyExtraDaysPayload = {
  country: 'PT' | 'BR';
  year?: number;
  source?: 'configured' | 'legacy';
  days: CompanyExtraDay[];
};

type ConflictRange = {
  start: string;
  end: string;
};

type VacationDraft = {
  requestKind: RequestKind;
  absenceReason: AbsenceMotivo | string;
  dataInicio: string;
  dataFim: string;
  observacoes: string;
  attachmentLink: string;
  contextTeamId: string;
  partialDay: VacationPartialDay;
};

type DraftErrors = Partial<Record<keyof VacationDraft, string>>;

type Subtab = 'overview' | 'calendar' | 'team-vacations' | 'company-days' | 'export';

type ExportTeam = {
  id: string;
  name: string;
};

type ExportCollaborator = {
  id: string;
  username: string;
  role: 'COLABORADOR' | 'MANAGER' | 'COORDENADOR' | 'ADMIN' | 'CONVIDADO';
  isRootAccess?: boolean;
  hasAccessTotal?: boolean;
  team?: { id: string; name: string } | null;
  profile?: {
    nomeAbreviado?: string;
    nomeCompleto?: string;
  } | null;
};

type ExportCollaboratorsResponse = {
  rows: ExportCollaborator[];
  total: number;
};

type SubmissionNotice = {
  tone: 'success' | 'error' | 'info' | 'warning';
  message: string;
} | null;

type VacationToastState = {
  tone: 'success' | 'error' | 'info' | 'warning';
  title?: string;
  message: string;
  details?: string[];
  highlight?: {
    tone?: 'success' | 'error' | 'info' | 'warning';
    label: string;
    message: string;
  };
  visible: boolean;
};

const EMPTY_DRAFT: VacationDraft = {
  requestKind: 'VACATION',
  absenceReason: ABSENCE_MOTIVOS[0],
  dataInicio: '',
  dataFim: '',
  observacoes: '',
  attachmentLink: '',
  contextTeamId: '',
  partialDay: 'FULL',
};

const MONTHS = [
  'Janeiro',
  'Fevereiro',
  'Março',
  'Abril',
  'Maio',
  'Junho',
  'Julho',
  'Agosto',
  'Setembro',
  'Outubro',
  'Novembro',
  'Dezembro',
];

const TEAM_COLORS = [
  '#4B79F5', '#8B5CF6', '#EC4899', '#EF4444', '#F97316',
  '#EAB308', '#22C55E', '#06B6D4', '#14B8A6', '#6B7280',
  '#1E40AF', '#7C3AED',
];

function toLocalDate(dateText: string) {
  return new Date(`${dateText}T00:00:00`);
}

function calculateDays(record: Pick<VacationRecord, 'dataInicio' | 'dataFim'>) {
  const start = toLocalDate(record.dataInicio);
  const end = toLocalDate(record.dataFim);
  const diffMs = end.getTime() - start.getTime();

  if (!Number.isFinite(diffMs) || diffMs < 0) {
    return 0;
  }

  return Math.floor(diffMs / (1000 * 60 * 60 * 24)) + 1;
}

function isWeekendIso(iso: string) {
  const day = toLocalDate(iso).getDay();
  return day === 0 || day === 6;
}

function calculateBusinessDays(startIso: string, endIso: string) {
  const days = enumerateDates(startIso, endIso);
  return days.filter((iso) => !isWeekendIso(iso)).length;
}

function hasWeekendInRange(startIso: string, endIso: string) {
  const days = enumerateDates(startIso, endIso);
  return days.some((iso) => isWeekendIso(iso));
}

function calculateDuration(record: Pick<VacationRecord, 'dataInicio' | 'dataFim' | 'requestType' | 'partialDay'>) {
  if (record.requestType === 'VACATION' && record.partialDay && record.partialDay !== 'FULL') {
    return 0.5;
  }

  if (record.requestType === 'VACATION') {
    return calculateBusinessDays(record.dataInicio, record.dataFim);
  }

  return calculateDays(record);
}

function toIsoDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function buildValidationErrors(draft: VacationDraft): DraftErrors {
  const errors: DraftErrors = {};

  if (!draft.dataInicio) {
    errors.dataInicio = 'Indica a data de início.';
  }

  if (!draft.dataFim) {
    errors.dataFim = 'Indica a data de fim.';
  }

  if (draft.dataInicio && draft.dataFim && draft.dataInicio > draft.dataFim) {
    errors.dataFim = 'A data de fim deve ser igual ou posterior à data de início.';
  }

  if (draft.requestKind === 'VACATION') {
    if (draft.dataInicio && isWeekendIso(draft.dataInicio)) {
      errors.dataInicio = 'Pedido de férias não pode começar ao fim de semana.';
    }

    if (draft.dataFim && isWeekendIso(draft.dataFim)) {
      errors.dataFim = 'Pedido de férias não pode terminar ao fim de semana.';
    }
  }

  if (draft.requestKind === 'ABSENCE' && draft.absenceReason === 'Justificada - Doença') {
    const start = toLocalDate(draft.dataInicio);
    const end = toLocalDate(draft.dataFim);
    const diffMs = end.getTime() - start.getTime();
    const days = Math.floor(diffMs / (1000 * 60 * 60 * 24)) + 1;

    if (Number.isFinite(days) && days > 3) {
      errors.dataFim = 'Ausência por doença SNS24 só pode ir até 3 dias.';
    }
  }

  if (draft.requestKind === 'VACATION' && draft.partialDay !== 'FULL' && draft.dataInicio !== draft.dataFim) {
    errors.dataFim = 'Pedido de meio-dia deve ter início e fim no mesmo dia.';
  }

  if (draft.dataInicio) {
    const today = new Date();
    const todayISO = dayISO(today.getFullYear(), today.getMonth(), today.getDate());
    if (draft.dataInicio < todayISO) {
      errors.dataInicio = 'Não é possível fazer pedidos para datas passadas.';
    }
  }

  return errors;
}

function dayISO(year: number, monthIndex: number, day: number) {
  const month = String(monthIndex + 1).padStart(2, '0');
  const dayText = String(day).padStart(2, '0');
  return `${year}-${month}-${dayText}`;
}

function enumerateDates(startText: string, endText: string) {
  const start = toLocalDate(startText);
  const end = toLocalDate(endText);
  const days: string[] = [];

  for (let current = new Date(start); current <= end; current.setDate(current.getDate() + 1)) {
    days.push(dayISO(current.getFullYear(), current.getMonth(), current.getDate()));
  }

  return days;
}

function getVacationTypeLabel(requestType: VacationRequestType, observacoes?: string) {
  if (requestType === 'VACATION') {
    return 'Férias';
  }

  if (observacoes) {
    const match = observacoes.match(/^Aus\u00eancia: ([^|]+)/);
    if (match) return match[1].trim();
  }

  if (requestType === 'ABSENCE_MEDICAL') {
    return 'Aus\u00eancia m\u00e9dica';
  }

  return 'Aus\u00eancia por forma\u00e7\u00e3o';
}

function getVacationTypeTag(requestType: VacationRequestType) {
  if (requestType === 'VACATION') {
    return 'vacation';
  }

  if (requestType === 'ABSENCE_MEDICAL') {
    return 'medical';
  }

  return 'training';
}

function getVacationRequestKind(requestType: VacationRequestType) {
  return requestType === 'VACATION' ? 'Férias' : 'Ausência';
}

function getPartialDayLabel(partialDay?: VacationPartialDay) {
  if (partialDay === 'AM') return ' (meio-dia manhã)';
  if (partialDay === 'PM') return ' (meio-dia tarde)';
  return '';
}

function formatShortDate(value: string) {
  return new Intl.DateTimeFormat('pt-PT', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(toLocalDate(value));
}

function formatDateTime(value: string) {
  const parsedDate = new Date(value);
  if (Number.isNaN(parsedDate.getTime())) {
    return '-';
  }

  return new Intl.DateTimeFormat('pt-PT', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(parsedDate);
}

function hasDateRangeOverlap(firstStart: string, firstEnd: string, secondStart: string, secondEnd: string) {
  return firstStart <= secondEnd && secondStart <= firstEnd;
}

function buildMonthGrid(year: number, monthIndex: number) {
  const first = new Date(year, monthIndex, 1);
  const last = new Date(year, monthIndex + 1, 0);
  const firstWeekDay = (first.getDay() + 6) % 7;
  const totalDaysInMonth = last.getDate();

  const cells: Array<{ iso: string | null; day: number | null }> = [];

  for (let i = 0; i < firstWeekDay; i += 1) {
    cells.push({ iso: null, day: null });
  }

  for (let day = 1; day <= totalDaysInMonth; day += 1) {
    cells.push({ iso: dayISO(year, monthIndex, day), day });
  }

  while (cells.length % 7 !== 0) {
    cells.push({ iso: null, day: null });
  }

  return cells;
}

function getIsoDate(date: Date) {
  return dayISO(date.getFullYear(), date.getMonth(), date.getDate());
}

function clipRangeToMonth(startIso: string, endIso: string, monthStartIso: string, monthEndIso: string) {
  const start = startIso > monthStartIso ? startIso : monthStartIso;
  const end = endIso < monthEndIso ? endIso : monthEndIso;

  if (start > end) {
    return null;
  }

  return { start, end };
}

function enumerateIsoDates(startIso: string, endIso: string) {
  const days: string[] = [];
  const start = new Date(`${startIso}T00:00:00`);
  const end = new Date(`${endIso}T00:00:00`);

  for (let current = new Date(start); current <= end; current.setDate(current.getDate() + 1)) {
    days.push(getIsoDate(current));
  }

  return days;
}

function getProfileDisplayName(input: {
  username: string;
  profile?: { nomeAbreviado?: string; nomeCompleto?: string } | null;
}) {
  const short = input.profile?.nomeAbreviado?.trim() || '';
  if (short) {
    return short;
  }

  const fullName = input.profile?.nomeCompleto?.trim() || '';
  return fullName || input.username;
}

function formatTeamPerson(member: TeamVacationMember) {
  return getProfileDisplayName({ username: member.username, profile: member.profile });
}

export default function VacationsPage() {
  const { profile, hasPermission, isRootAccess, isAccessTotal, refreshNotifications, currentUser } = usePortal();
  const isTPeople = currentUser?.username === 't.people';
  const canExport = isAccessTotal || isRootAccess;

  const [activeTab, setActiveTab] = useState<Subtab>('overview');
  const [draft, setDraft] = useState<VacationDraft>(EMPTY_DRAFT);
  const [draftErrors, setDraftErrors] = useState<DraftErrors>({});
  const [records, setRecords] = useState<VacationRecord[]>([]);
  const [overview, setOverview] = useState<VacationOverview | null>(null);
  const [calendarData, setCalendarData] = useState<CalendarPayload | null>(null);
  const [calendarYear, setCalendarYear] = useState(new Date().getFullYear());
  const [isOverviewLoading, setIsOverviewLoading] = useState(false);
  const [isCalendarLoading, setIsCalendarLoading] = useState(false);
  const [overviewError, setOverviewError] = useState('');
  const [calendarError, setCalendarError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submissionNotice, setSubmissionNotice] = useState<SubmissionNotice>(null);
  const [isPendingVacationDetailOpen, setIsPendingVacationDetailOpen] = useState(false);
  const [isApprovedVacationDetailOpen, setIsApprovedVacationDetailOpen] = useState(false);
  const [pendingActionKey, setPendingActionKey] = useState<string | null>(null);
  const [sellVacationDaysInput, setSellVacationDaysInput] = useState('0');
  const [isSellingVacationDays, setIsSellingVacationDays] = useState(false);
  const [toast, setToast] = useState<VacationToastState>({
    tone: 'info',
    message: '',
    visible: false,
  });
  const lastToastRef = useRef<{ tone: 'success' | 'error' | 'info' | 'warning'; message: string; at: number } | null>(null);
  const toastTimeoutRef = useRef<number | null>(null);
  const [teamContexts, setTeamContexts] = useState<TeamContext[]>([]);
  const [selectedTeamVacationId, setSelectedTeamVacationId] = useState('');
  const [teamVacationDetailsByKey, setTeamVacationDetailsByKey] = useState<Record<string, TeamVacationDetail>>({});
  const [loadingTeamVacationDetailKey, setLoadingTeamVacationDetailKey] = useState<string | null>(null);
  const [teamVacationsMonthCursor, setTeamVacationsMonthCursor] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [teamVacationSearchQuery, setTeamVacationSearchQuery] = useState('');
  const [teamSpecialCalendar, setTeamSpecialCalendar] = useState<TeamSpecialCalendarPayload | null>(null);
  const [isLoadingTeamSpecialCalendar, setIsLoadingTeamSpecialCalendar] = useState(false);
  const [companyExtraDays, setCompanyExtraDays] = useState<CompanyExtraDay[]>([]);
  const [companyExtraDayMonth, setCompanyExtraDayMonth] = useState('12');
  const [companyExtraDayDay, setCompanyExtraDayDay] = useState('25');
  const [companyExtraDayLabel, setCompanyExtraDayLabel] = useState('Dia dado pela empresa');
  const [companyExtraYear, setCompanyExtraYear] = useState(new Date().getFullYear());
  const [isLoadingCompanyExtraDays, setIsLoadingCompanyExtraDays] = useState(false);
  const [isSavingCompanyExtraDays, setIsSavingCompanyExtraDays] = useState(false);
  const [companyExtraDaysSource, setCompanyExtraDaysSource] = useState<'configured' | 'legacy'>('legacy');
  const [companyExtraDaysError, setCompanyExtraDaysError] = useState('');
  // Modal state para selecionar "este ano ou próximo ano?" ao adicionar dias automáticos
  const [isAddCompanyExtraDayModalOpen, setIsAddCompanyExtraDayModalOpen] = useState(false);
  const [companyExtraDayModalYear, setCompanyExtraDayModalYear] = useState<number | null>(null);
  const [exportYear, setExportYear] = useState(new Date().getFullYear());
  const [exportRangeMode, setExportRangeMode] = useState<'year' | 'custom'>('year');
  const [exportStartDate, setExportStartDate] = useState(`${new Date().getFullYear()}-01-01`);
  const [exportEndDate, setExportEndDate] = useState(`${new Date().getFullYear()}-12-31`);
  const [exportTeamId, setExportTeamId] = useState('');
  const [exportCollaboratorSearch, setExportCollaboratorSearch] = useState('');
  const [exportCandidates, setExportCandidates] = useState<ExportCollaborator[]>([]);
  const [exportSelectedCollaborators, setExportSelectedCollaborators] = useState<ExportCollaborator[]>([]);
  const [isLoadingExportCandidates, setIsLoadingExportCandidates] = useState(false);
  const [isExportAdvancedOpen, setIsExportAdvancedOpen] = useState(false);
  const [isExportCollaboratorsOpen, setIsExportCollaboratorsOpen] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [exportTeams, setExportTeams] = useState<ExportTeam[]>([]);
  const [exportTeamsLoaded, setExportTeamsLoaded] = useState(false);
  const [assignFilterTeamId, setAssignFilterTeamId] = useState('');
  const [assignSearch, setAssignSearch] = useState('');
  const [assignCandidates, setAssignCandidates] = useState<ExportCollaborator[]>([]);
  const [assignSelectedUserId, setAssignSelectedUserId] = useState('');
  const [assignCreditDays, setAssignCreditDays] = useState('1');
  const [assignCreditYear, setAssignCreditYear] = useState(String(new Date().getFullYear()));
  const [assignCreditReason, setAssignCreditReason] = useState('');
  const [isLoadingAssignCandidates, setIsLoadingAssignCandidates] = useState(false);
  const [isCreditingVacationBalance, setIsCreditingVacationBalance] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [conflictRange, setConflictRange] = useState<ConflictRange | null>(null);
  // Calendar range selection:
  // selectionAnchor = first clicked day (waiting for second click)
  // hoverDay = day being hovered while anchor is set (live range preview)
  const [selectionAnchor, setSelectionAnchor] = useState<string | null>(null);
  const [hoverDay, setHoverDay] = useState<string | null>(null);
  const currentMonthRef = useRef<HTMLElement | null>(null);
  const calendarAutoScrolledRef = useRef<string>('');

  // Cache keys to prevent duplicate requests
  const cacheRef = useRef<{
    recordsLoaded?: boolean;
    overviewLoaded?: boolean;
    calendarLoadedYear?: number;
  }>({});

  const sortedRecords = useMemo(
    () => [...records].sort((a, b) => new Date(b.dataInicio).getTime() - new Date(a.dataInicio).getTime()),
    [records],
  );

  const pendingVacationRequests = useMemo(
    () => sortedRecords.filter((record) => record.status === 'PENDING'),
    [sortedRecords],
  );

  const pendingVacationDaysTotal = useMemo(
    () => pendingVacationRequests.reduce((sum, record) => sum + calculateDuration(record), 0),
    [pendingVacationRequests],
  );

  const approvedVacationRequests = useMemo(
    () => sortedRecords.filter((record) => record.status === 'APPROVED'),
    [sortedRecords],
  );

  const approvedVacationsReadyForRealization = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return approvedVacationRequests.filter((record) => {
      const dataFimDate = new Date(record.dataFim);
      dataFimDate.setHours(0, 0, 0, 0);
      return dataFimDate < today; // Only show completed vacations
    });
  }, [approvedVacationRequests]);

  const conflictRecordIds = useMemo(() => {
    if (!conflictRange) {
      return new Set<string>();
    }

    return new Set(
      sortedRecords
        .filter((record) => record.status !== 'CANCELLED' && record.status !== 'REJECTED')
        .filter((record) => hasDateRangeOverlap(record.dataInicio, record.dataFim, conflictRange.start, conflictRange.end))
        .map((record) => record.id),
    );
  }, [conflictRange, sortedRecords]);

  const calendarRequestDays = useMemo(() => {
    if (!calendarData) {
      return {
        approvedVacationDays: new Set<string>(),
        approvedAbsenceDays: new Set<string>(),
        pendingVacationDays: new Set<string>(),
        pendingAbsenceDays: new Set<string>(),
        absenceDays: new Set<string>(),
      };
    }

    const approvedVacationDays = new Set<string>();
    const approvedAbsenceDays = new Set<string>();
    const pendingVacationDays = new Set<string>();
    const pendingAbsenceDays = new Set<string>();
    const absenceDays = new Set<string>();

    for (const request of calendarData.requests) {
      const days = enumerateDates(request.dataInicio, request.dataFim);

      if (request.status !== 'CANCELLED' && request.requestType !== 'VACATION') {
        days.forEach((day: string) => absenceDays.add(day));
      }

      if (request.status === 'APPROVED' && request.requestType === 'VACATION') {
        days.forEach((day: string) => approvedVacationDays.add(day));
      }

      if (request.status === 'APPROVED' && request.requestType !== 'VACATION') {
        days.forEach((day: string) => approvedAbsenceDays.add(day));
      }

      if (request.status === 'PENDING' && request.requestType === 'VACATION') {
        days.forEach((day: string) => pendingVacationDays.add(day));
      }

      if (request.status === 'PENDING' && request.requestType !== 'VACATION') {
        days.forEach((day: string) => pendingAbsenceDays.add(day));
      }
    }

    return {
      approvedVacationDays,
      approvedAbsenceDays,
      pendingVacationDays,
      pendingAbsenceDays,
      absenceDays,
    };
  }, [calendarData]);

  const extraDayLabelByDate = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of calendarData?.extraDayDetails ?? []) {
      map.set(item.date, item.label || 'Dia dado pela empresa');
    }
    return map;
  }, [calendarData]);

  const canManageVacationRules = isRootAccess || hasPermission('manage_vacation_rules');
  const canAccessTeamVacationTab = !isTPeople && (currentUser?.role ?? '') !== 'CONVIDADO';

  const teamVacationYear = teamVacationsMonthCursor.getFullYear();
  const teamVacationMonthIndex = teamVacationsMonthCursor.getMonth();
  const teamVacationMonthStartDate = useMemo(() => new Date(teamVacationYear, teamVacationMonthIndex, 1), [teamVacationMonthIndex, teamVacationYear]);
  const teamVacationMonthEndDate = useMemo(() => new Date(teamVacationYear, teamVacationMonthIndex + 1, 0), [teamVacationMonthIndex, teamVacationYear]);
  const teamVacationMonthStartIso = useMemo(() => getIsoDate(teamVacationMonthStartDate), [teamVacationMonthStartDate]);
  const teamVacationMonthEndIso = useMemo(() => getIsoDate(teamVacationMonthEndDate), [teamVacationMonthEndDate]);
  const teamVacationMonthLabel = `${MONTHS[teamVacationMonthIndex]} ${teamVacationYear}`;
  const teamVacationDetailsKey = selectedTeamVacationId ? `${selectedTeamVacationId}-${teamVacationYear}` : '';
  const selectedTeamVacationDetail = teamVacationDetailsKey ? teamVacationDetailsByKey[teamVacationDetailsKey] ?? null : null;

  const selectedTeamVacationContext = useMemo(
    () => teamContexts.find((item) => item.teamId === selectedTeamVacationId) ?? null,
    [teamContexts, selectedTeamVacationId],
  );

  const teamVacationMonthDays = useMemo(() => {
    const days = [] as Array<{ iso: string; day: number; weekDayLabel: string; isWeekend: boolean }>;

    for (let day = 1; day <= teamVacationMonthEndDate.getDate(); day += 1) {
      const date = new Date(teamVacationYear, teamVacationMonthIndex, day);
      const iso = getIsoDate(date);
      const weekDay = date.getDay();
      const weekDayLabel = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'][weekDay] || '';
      days.push({ iso, day, weekDayLabel, isWeekend: weekDay === 0 || weekDay === 6 });
    }

    return days;
  }, [teamVacationMonthEndDate, teamVacationMonthIndex, teamVacationYear]);

  const teamHolidaySet = useMemo(() => new Set(teamSpecialCalendar?.holidays ?? []), [teamSpecialCalendar]);
  const teamExtraDayLabelByDate = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of teamSpecialCalendar?.extraDayDetails ?? []) {
      map.set(item.date, item.label || 'Dia automático');
    }
    return map;
  }, [teamSpecialCalendar]);
  const teamExtraDaySet = useMemo(() => new Set(teamSpecialCalendar?.extraDays ?? []), [teamSpecialCalendar]);
  const teamWeekendSet = useMemo(() => new Set(teamSpecialCalendar?.weekendDays ?? []), [teamSpecialCalendar]);

  const approvedMonthEntries = useMemo(() => {
    if (!selectedTeamVacationDetail) {
      return [] as Array<{
        member: TeamVacationMember;
        vacation: TeamVacation;
        clippedStartIso: string;
        clippedEndIso: string;
      }>;
    }

    return selectedTeamVacationDetail.members
      .flatMap((member) => (
        member.vacations
          .filter((vacation) => vacation.status === 'APPROVED')
          .map((vacation) => {
            const clipped = clipRangeToMonth(vacation.dataInicio, vacation.dataFim, teamVacationMonthStartIso, teamVacationMonthEndIso);
            if (!clipped) {
              return null;
            }

            return {
              member,
              vacation,
              clippedStartIso: clipped.start,
              clippedEndIso: clipped.end,
            };
          })
          .filter((item): item is {
            member: TeamVacationMember;
            vacation: TeamVacation;
            clippedStartIso: string;
            clippedEndIso: string;
          } => item !== null)
      ))
      .sort((a, b) => {
        const byStart = a.clippedStartIso.localeCompare(b.clippedStartIso);
        if (byStart !== 0) {
          return byStart;
        }
        return formatTeamPerson(a.member).localeCompare(formatTeamPerson(b.member));
      });
  }, [selectedTeamVacationDetail, teamVacationMonthEndIso, teamVacationMonthStartIso]);

  const teamLeaderId = selectedTeamVacationDetail?.leaderId
    ?? selectedTeamVacationDetail?.manager?.id
    ?? selectedTeamVacationDetail?.coordinator?.id
    ?? null;

  const teamCalendarMembers = useMemo(() => {
    if (!selectedTeamVacationDetail) {
      return [] as TeamCalendarPerson[];
    }

    const base = [...selectedTeamVacationDetail.members].map((member) => ({
      ...member,
      isTeamLeader: teamLeaderId !== null && member.id === teamLeaderId,
    }));

    return base.sort((a, b) => {
      const leaderBoost = Number(Boolean(b.isTeamLeader)) - Number(Boolean(a.isTeamLeader));
      if (leaderBoost !== 0) {
        return leaderBoost;
      }
      return formatTeamPerson(a).localeCompare(formatTeamPerson(b));
    });
  }, [selectedTeamVacationDetail, teamLeaderId]);

  const filteredTeamCalendarMembers = useMemo(() => {
    const normalizedQuery = teamVacationSearchQuery.trim().toLowerCase();
    if (!normalizedQuery) {
      return teamCalendarMembers;
    }

    return teamCalendarMembers.filter((member) => [
      formatTeamPerson(member),
      member.username,
      member.email,
    ].join(' ').toLowerCase().includes(normalizedQuery));
  }, [teamCalendarMembers, teamVacationSearchQuery]);

  const memberColorMap = useMemo(() => {
    const map = new Map<string, string>();
    for (let index = 0; index < filteredTeamCalendarMembers.length; index += 1) {
      const member = filteredTeamCalendarMembers[index];
      map.set(member.id, TEAM_COLORS[index % TEAM_COLORS.length] || '#4B79F5');
    }
    return map;
  }, [filteredTeamCalendarMembers]);

  const approvedMonthByMemberByDay = useMemo(() => {
    const map = new Map<string, Map<string, TeamVacation>>();

    for (const entry of approvedMonthEntries) {
      const memberDays = map.get(entry.member.id) ?? new Map<string, TeamVacation>();
      const days = enumerateIsoDates(entry.clippedStartIso, entry.clippedEndIso);
      for (const day of days) {
        memberDays.set(day, entry.vacation);
      }
      map.set(entry.member.id, memberDays);
    }

    return map;
  }, [approvedMonthEntries]);

  const allowedTabs = useMemo<Subtab[]>(() => {
    const tabs: Subtab[] = [];
    if (!isTPeople) tabs.push('overview', 'calendar');
    if (isTPeople) tabs.push('calendar');
    if (canAccessTeamVacationTab && teamContexts.length > 0) tabs.push('team-vacations');
    if (canManageVacationRules) tabs.push('company-days');
    if (canExport) tabs.push('export');
    return tabs;
  }, [canAccessTeamVacationTab, canManageVacationRules, canExport, isTPeople, teamContexts.length]);

  useEffect(() => {
    if (!allowedTabs.includes(activeTab)) {
      setActiveTab(allowedTabs[0] ?? 'calendar');
    }
  }, [activeTab, allowedTabs]);

  const overviewStats = useMemo(() => {
    const approvedVacationDaysFromRecords = sortedRecords
      .filter((item) => item.status === 'APPROVED' && item.requestType === 'VACATION')
      .reduce((sum, item) => sum + calculateDuration(item), 0);

    const pendingVacationDaysFromRecords = sortedRecords
      .filter((item) => item.status === 'PENDING' && item.requestType === 'VACATION')
      .reduce((sum, item) => sum + calculateDuration(item), 0);

    const approvedAbsenceDaysFromRecords = sortedRecords
      .filter((item) => item.status === 'APPROVED' && item.requestType !== 'VACATION')
      .reduce((sum, item) => sum + calculateDays(item), 0);

    const pendingAbsenceDaysFromRecords = sortedRecords
      .filter((item) => item.status === 'PENDING' && item.requestType !== 'VACATION')
      .reduce((sum, item) => sum + calculateDays(item), 0);

    const approvedVacationDays = overview?.approvedVacationDays ?? approvedVacationDaysFromRecords;
    const pendingVacationDays = overview?.pendingVacationDays ?? pendingVacationDaysFromRecords;
    const approvedAbsenceDays = overview?.approvedAbsenceDays ?? approvedAbsenceDaysFromRecords;
    const pendingAbsenceDays = overview?.pendingAbsenceDays ?? pendingAbsenceDaysFromRecords;
    const rawEntitlement = overview?.calculation?.entitledDays ?? (overview?.country === 'BR' ? 0 : 22);
    const soldVacationDays = overview?.country === 'BR' ? (overview?.calculation?.soldVacationDays ?? 0) : 0;
    const availableEntitlement = overview?.country === 'BR'
      ? (overview?.calculation?.availableEntitledDays ?? Math.max(rawEntitlement - soldVacationDays, 0))
      : rawEntitlement;

    return {
      approvedVacationDays,
      pendingVacationDays,
      approvedAbsenceDays,
      pendingAbsenceDays,
      entitlement: availableEntitlement,
      creditedDays: overview?.calculation?.extraBalanceDays ?? 0,
    };
  }, [overview, sortedRecords]);

  const remainingVacationDays = Math.max(
    overviewStats.entitlement - overviewStats.approvedVacationDays - overviewStats.pendingVacationDays,
    0,
  );
  const selectedAssignCandidate = useMemo(
    () => assignCandidates.find((item) => item.id === assignSelectedUserId) ?? null,
    [assignCandidates, assignSelectedUserId],
  );
  const exportResolvedStart = exportRangeMode === 'custom' ? exportStartDate : `${exportYear}-01-01`;
  const exportResolvedEnd = exportRangeMode === 'custom' ? exportEndDate : `${exportYear}-12-31`;
  const exportPeriodSummary = exportResolvedStart && exportResolvedEnd ? `${exportResolvedStart} -> ${exportResolvedEnd}` : 'Período por definir';
  const yearMonths = useMemo(() => {
    const year = calendarData?.year ?? new Date().getFullYear();
    return MONTHS.map((month, monthIndex) => ({
      month,
      monthIndex,
      cells: buildMonthGrid(year, monthIndex),
    }));
  }, [calendarData]);

  const calendarMonthIndexToFocus = useMemo(() => {
    if (!calendarData) {
      return -1;
    }

    const now = new Date();
    if (calendarData.year === now.getFullYear()) {
      return now.getMonth();
    }

    return 0;
  }, [calendarData]);

  useEffect(() => {
    if (activeTab !== 'calendar' || !calendarData || !currentMonthRef.current) {
      return;
    }

    const key = `${calendarData.year}-${calendarMonthIndexToFocus}`;
    if (calendarAutoScrolledRef.current === key) {
      return;
    }

    calendarAutoScrolledRef.current = key;
    currentMonthRef.current.scrollIntoView({ block: 'start', inline: 'nearest', behavior: 'smooth' });
  }, [activeTab, calendarData, calendarMonthIndexToFocus]);

  useEffect(() => {
    const controller = new AbortController();

    void (async () => {
      if (!isTPeople && !cacheRef.current.recordsLoaded) {
        await loadMine(controller.signal);
        if (!controller.signal.aborted) {
          cacheRef.current.recordsLoaded = true;
        }
      }

      if (!isTPeople) {
        await loadTeamContexts(controller.signal);
      }
    })();

    return () => {
      controller.abort();
    };
  }, [isTPeople]);

  useEffect(() => {
    if (activeTab !== 'overview' || cacheRef.current.overviewLoaded) {
      return;
    }

    const controller = new AbortController();
    let disposed = false;
    setIsOverviewLoading(true);
    setOverviewError('');

    void loadOverview(controller.signal)
      .then(() => {
        if (!controller.signal.aborted) {
          cacheRef.current.overviewLoaded = true;
        }
      })
      .catch((error) => {
        if (isAbortError(error) || controller.signal.aborted) {
          return;
        }
        cacheRef.current.overviewLoaded = false;
      })
      .finally(() => {
        if (!disposed) {
          setIsOverviewLoading(false);
        }
      });

    return () => {
      disposed = true;
      controller.abort();
    };
  }, [activeTab]);

  useEffect(() => {
    if ((activeTab !== 'overview' && activeTab !== 'company-days') || !canManageVacationRules) {
      return;
    }

    const requestedYear = activeTab === 'overview' ? new Date().getFullYear() : companyExtraYear;
    void loadCompanyExtraDays(requestedYear);
  }, [activeTab, canManageVacationRules, companyExtraYear]);

  useEffect(() => {
    if (activeTab !== 'export' || !canExport) return;
    void loadExportTeams();
  }, [activeTab, canExport]);

  useEffect(() => {
    if (activeTab !== 'export' || !canExport) {
      return;
    }

    const timeout = window.setTimeout(() => {
      void loadAssignCandidates();
    }, 220);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [activeTab, canExport, assignFilterTeamId, assignSearch]);

  useEffect(() => {
    if (activeTab !== 'export' || !canExport) {
      return;
    }

    const timeout = window.setTimeout(() => {
      void loadExportCandidates();
    }, 200);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [activeTab, canExport, exportTeamId, exportCollaboratorSearch]);

  useEffect(() => {
    if (activeTab !== 'calendar' || cacheRef.current.calendarLoadedYear === calendarYear) {
      return;
    }

    const controller = new AbortController();
    let disposed = false;
    setIsCalendarLoading(true);
    setCalendarError('');

    void loadCalendar(calendarYear, controller.signal)
      .then(() => {
        if (!controller.signal.aborted) {
          cacheRef.current.calendarLoadedYear = calendarYear;
        }
      })
      .catch((error) => {
        if (isAbortError(error) || controller.signal.aborted) {
          return;
        }
        cacheRef.current.calendarLoadedYear = undefined;
      })
      .finally(() => {
        if (!disposed) {
          setIsCalendarLoading(false);
        }
      });

    return () => {
      disposed = true;
      controller.abort();
    };
  }, [activeTab, calendarYear]);

  useEffect(() => {
    if (overview?.country !== 'BR') {
      return;
    }
    setSellVacationDaysInput(String(overview.calculation?.soldVacationDays ?? 0));
  }, [overview]);

  useEffect(() => {
    if (!canAccessTeamVacationTab) {
      return;
    }

    if (selectedTeamVacationId && teamContexts.some((item) => item.teamId === selectedTeamVacationId)) {
      return;
    }

    const fallback = teamContexts.find((item) => item.isPrimary)?.teamId || teamContexts[0]?.teamId || '';
    setSelectedTeamVacationId(fallback);
  }, [canAccessTeamVacationTab, selectedTeamVacationId, teamContexts]);

  useEffect(() => {
    if (activeTab !== 'team-vacations' || !selectedTeamVacationId) {
      return;
    }

    const controller = new AbortController();
    void loadTeamVacationDetail(selectedTeamVacationId, teamVacationYear, controller.signal);
    void loadTeamSpecialCalendar(teamVacationYear, controller.signal);

    return () => {
      controller.abort();
    };
  }, [activeTab, selectedTeamVacationId, teamVacationYear]);

  function showToast(
    tone: 'success' | 'error' | 'info' | 'warning',
    message: string,
    options?: {
      persist?: boolean;
      autoHideMs?: number;
      title?: string;
      details?: string[];
      highlight?: {
        tone?: 'success' | 'error' | 'info' | 'warning';
        label: string;
        message: string;
      };
    },
  ) {
    const now = Date.now();
    if (
      lastToastRef.current
      && lastToastRef.current.tone === tone
      && lastToastRef.current.message === message
      && now - lastToastRef.current.at < 1500
    ) {
      return;
    }

    lastToastRef.current = { tone, message, at: now };

    if (toastTimeoutRef.current !== null) {
      window.clearTimeout(toastTimeoutRef.current);
      toastTimeoutRef.current = null;
    }

    setToast({
      tone,
      title: options?.title,
      message,
      details: options?.details,
      highlight: options?.highlight,
      visible: true,
    });

    const shouldPersist = options?.persist === true;
    if (!shouldPersist) {
      const timeoutMs = options?.autoHideMs ?? 3200;
      toastTimeoutRef.current = window.setTimeout(() => {
        setToast((current) => ({ ...current, visible: false }));
        toastTimeoutRef.current = null;
      }, timeoutMs);
    }
  }

  async function loadMine(signal?: AbortSignal) {
    try {
      const data = await apiRequestCached<VacationRecord[]>('/vacations/me', {
        headers: getAuthHeaders(),
        signal,
      }, 60000);
      if (!signal?.aborted) {
        setRecords(data);
      }
    } catch (error) {
      if (!isAbortError(error) && !signal?.aborted) {
        console.error('Falha ao carregar férias:', error);
      }
    }
  }

  async function loadOverview(signal?: AbortSignal) {
    try {
      const data = await apiRequestCached<VacationOverview>('/vacations/overview', {
        headers: getAuthHeaders(),
        signal,
      }, 60000);
      setOverview(data);
      return data;
    } catch (error) {
      if (!isAbortError(error) && !signal?.aborted) {
        setOverviewError(error instanceof Error ? error.message : 'Falha ao carregar resumo de férias.');
      }
      throw error;
    }
  }

  async function loadCalendar(year: number = calendarYear, signal?: AbortSignal) {
    try {
      const data = await apiRequestCached<CalendarPayload>(`/vacations/calendar?year=${year}`, {
        headers: getAuthHeaders(),
        signal,
      }, 60000);
      setCalendarData(data);
      return data;
    } catch (error) {
      if (!isAbortError(error) && !signal?.aborted) {
        setCalendarError(error instanceof Error ? error.message : 'Falha ao carregar calendário de férias.');
      }
      throw error;
    }
  }

  async function loadTeamSpecialCalendar(year: number, signal?: AbortSignal) {
    setIsLoadingTeamSpecialCalendar(true);

    try {
      const data = await apiRequestCached<TeamSpecialCalendarPayload>(`/vacations/calendar?year=${year}`, {
        headers: getAuthHeaders(),
        signal,
      }, 60000);

      if (!signal?.aborted) {
        setTeamSpecialCalendar(data);
      }
    } catch (error) {
      if (!isAbortError(error) && !signal?.aborted) {
        showToast('error', error instanceof Error ? error.message : 'Falha ao carregar dias especiais da equipa.');
      }
    } finally {
      if (!signal?.aborted) {
        setIsLoadingTeamSpecialCalendar(false);
      }
    }
  }

  async function loadCompanyExtraDays(year: number = companyExtraYear) {
    try {
      setIsLoadingCompanyExtraDays(true);
      setCompanyExtraDaysError('');
      const payload = await apiRequest<CompanyExtraDaysPayload>(`/vacations/company-extra-days?year=${year}`, {
        headers: getAuthHeaders(),
      });
      setCompanyExtraDays(payload.days ?? []);
      setCompanyExtraDaysSource(payload.source ?? 'legacy');
    } catch (error) {
      setCompanyExtraDaysError(error instanceof Error ? error.message : 'Falha ao carregar dias automáticos da empresa.');
    } finally {
      setIsLoadingCompanyExtraDays(false);
    }
  }

  async function addCompanyExtraDay() {
    const monthNum = parseInt(companyExtraDayMonth, 10);
    const dayNum = parseInt(companyExtraDayDay, 10);
    if (!monthNum || !dayNum) {
      showToast('error', 'Seleciona um mês e um dia para adicionar.');
      return;
    }
    // Abrir modal em vez de adicionar diretamente
    setCompanyExtraDayModalYear(null);
    setIsAddCompanyExtraDayModalOpen(true);
  }

  async function confirmAddCompanyExtraDay(selectedYear: number) {
    const monthNum = parseInt(companyExtraDayMonth, 10);
    const dayNum = parseInt(companyExtraDayDay, 10);
    const mmdd = `${String(monthNum).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
    const trimmedLabel = companyExtraDayLabel.trim() || 'Dia dado pela empresa';
    if (companyExtraDays.some((item) => item.date === mmdd)) {
      showToast('info', 'Esse dia já está na lista.');
      setIsAddCompanyExtraDayModalOpen(false);
      return;
    }
    const updated = [...companyExtraDays, { date: mmdd, label: trimmedLabel }].sort((a, b) => a.date.localeCompare(b.date));
    setCompanyExtraDayMonth('12');
    setCompanyExtraDayDay('25');
    setCompanyExtraDayLabel('Dia dado pela empresa');
    setIsAddCompanyExtraDayModalOpen(false);
    setCompanyExtraYear(selectedYear);
    await saveCompanyExtraDays(updated);
  }

  async function removeCompanyExtraDay(date: string) {
    const updated = companyExtraDays.filter((item) => item.date !== date);
    await saveCompanyExtraDays(updated);
  }

  async function loadExportTeams() {
    if (exportTeamsLoaded) return;
    try {
      const data = await apiRequest<ExportTeam[]>('/teams', { headers: getAuthHeaders() });
      setExportTeams(data);
      setExportTeamsLoaded(true);
    } catch {
      // non-critical
    }
  }

  async function loadAssignCandidates() {
    try {
      setIsLoadingAssignCandidates(true);
      const params = new URLSearchParams({
        page: '1',
        pageSize: '100',
        sortBy: 'username',
        sortDirection: 'asc',
        active: 'true',
      });

      if (assignFilterTeamId) {
        params.set('teamId', assignFilterTeamId);
      }
      if (assignSearch.trim()) {
        params.set('q', assignSearch.trim());
      }

      const data = await apiRequest<ExportCollaboratorsResponse>(`/users/collaborators?${params.toString()}`, {
        headers: getAuthHeaders(),
      });

      const filtered = (data.rows ?? []).filter((item) => {
        if (item.username === 't.people') return false;
        if (item.isRootAccess || item.hasAccessTotal) return false;
        return true;
      });

      setAssignCandidates(filtered);
      if (filtered.length === 0) {
        setAssignSelectedUserId('');
      } else if (!filtered.some((item) => item.id === assignSelectedUserId)) {
        setAssignSelectedUserId(filtered[0].id);
      }
    } catch (error) {
      showToast('error', error instanceof Error ? error.message : 'Falha ao carregar colaboradores elegíveis para crédito de saldo.');
    } finally {
      setIsLoadingAssignCandidates(false);
    }
  }

  async function loadExportCandidates() {
    try {
      setIsLoadingExportCandidates(true);
      const params = new URLSearchParams({
        page: '1',
        pageSize: '80',
        sortBy: 'username',
        sortDirection: 'asc',
        active: 'true',
      });

      if (exportTeamId) {
        params.set('teamId', exportTeamId);
      }
      if (exportCollaboratorSearch.trim()) {
        params.set('q', exportCollaboratorSearch.trim());
      }

      const data = await apiRequest<ExportCollaboratorsResponse>(`/users/collaborators?${params.toString()}`, {
        headers: getAuthHeaders(),
      });

      const filtered = (data.rows ?? []).filter((item) => item.username !== 't.people');
      setExportCandidates(filtered);
    } catch (error) {
      showToast('error', error instanceof Error ? error.message : 'Falha ao carregar lista de colaboradores para exportação.');
    } finally {
      setIsLoadingExportCandidates(false);
    }
  }

  function toggleExportCollaborator(collaborator: ExportCollaborator) {
    setExportSelectedCollaborators((prev) => {
      const exists = prev.some((item) => item.id === collaborator.id);
      if (exists) {
        return prev.filter((item) => item.id !== collaborator.id);
      }

      return [...prev, collaborator];
    });
  }

  function removeExportCollaborator(collaboratorId: string) {
    setExportSelectedCollaborators((prev) => prev.filter((item) => item.id !== collaboratorId));
  }

  async function triggerExportWorkbook() {
    const resolvedStart = exportResolvedStart;
    const resolvedEnd = exportResolvedEnd;

    if (!resolvedStart || !resolvedEnd) {
      showToast('error', 'Define o período inicial e final da exportação.');
      return;
    }

    if (resolvedStart > resolvedEnd) {
      showToast('error', 'A data final deve ser igual ou posterior à data inicial.');
      return;
    }

    try {
      setIsExporting(true);
      const params = new URLSearchParams({ year: String(exportYear) });
      params.set('startDate', resolvedStart);
      params.set('endDate', resolvedEnd);
      if (exportTeamId) params.set('teamId', exportTeamId);
      if (exportSelectedCollaborators.length > 0) {
        params.set('userIds', exportSelectedCollaborators.map((item) => item.id).join(','));
      }
      const token = localStorage.getItem(STORAGE_TOKEN_KEY) || '';
      const response = await fetch(`${getApiBase()}/vacations/export?${params.toString()}`, {
        headers: authHeaders(token),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { message?: string; error?: string };
        throw new Error(payload.message || payload.error || 'Erro ao gerar exportação.');
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const contentDisposition = response.headers.get('Content-Disposition') || response.headers.get('content-disposition') || '';
      const match = contentDisposition.match(/filename="?([^";]+)"?/i);
      a.download = match?.[1] || `mapa-ferias-${resolvedStart}-a-${resolvedEnd}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      showToast('error', error instanceof Error ? error.message : 'Falha ao exportar mapa de férias.');
    } finally {
      setIsExporting(false);
    }
  }

  async function creditVacationBalance() {
    if (!assignSelectedUserId) {
      showToast('error', 'Seleciona um colaborador.');
      return;
    }
    const days = Number(assignCreditDays);
    if (!Number.isFinite(days) || days < 1 || !Number.isInteger(days)) {
      showToast('error', 'Indica um número inteiro de dias a creditar (mínimo 1).');
      return;
    }
    const year = Number(assignCreditYear);
    if (!Number.isFinite(year) || year < 2000 || year > 2100 || !Number.isInteger(year)) {
      showToast('error', 'Indica um ano válido.');
      return;
    }
    if (!assignCreditReason.trim()) {
      showToast('error', 'Indica o motivo do crédito de saldo.');
      return;
    }

    try {
      setIsCreditingVacationBalance(true);
      await apiRequest('/vacations/assign-balance-days', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          userId: assignSelectedUserId,
          year,
          days,
          reason: assignCreditReason.trim(),
        }),
      });

      clearApiCache('/vacations/calendar');
      clearApiCache('/vacations/overview');
      setAssignCreditDays('1');
      setAssignCreditReason('');
      showToast('success', 'Dias adicionais creditados no saldo de férias do colaborador.');
      if (activeTab === 'overview' && !isTPeople) {
        void loadOverview();
      }
    } catch (error) {
      showToast('error', error instanceof Error ? error.message : 'Falha ao creditar saldo de férias.');
    } finally {
      setIsCreditingVacationBalance(false);
    }
  }

  async function saveCompanyExtraDays(days: CompanyExtraDay[]) {
    try {
      setIsSavingCompanyExtraDays(true);
      setCompanyExtraDaysError('');
      const normalizedDays = days
        .map((item) => ({ date: item.date, label: item.label.trim() || 'Dia dado pela empresa' }));

      const payload = await apiRequest<CompanyExtraDaysPayload>('/vacations/company-extra-days', {
        method: 'PUT',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          country: profile.workCountry,
          year: companyExtraYear,
          days: normalizedDays,
        }),
      });

      setCompanyExtraDays(payload.days ?? []);
      setCompanyExtraDaysSource(payload.source ?? 'configured');
      clearApiCache('/vacations/calendar');
      clearApiCache('/vacations/overview');
      if (activeTab === 'overview' && !isTPeople) {
        void loadOverview();
      }
      if (activeTab === 'calendar' && calendarYear === companyExtraYear) {
        cacheRef.current.calendarLoadedYear = undefined;
        void loadCalendar(calendarYear);
      }
      showToast('success', 'Dias automáticos atualizados.');
    } catch (error) {
      setCompanyExtraDaysError(error instanceof Error ? error.message : 'Falha ao guardar dias automáticos da empresa.');
      showToast('error', error instanceof Error ? error.message : 'Falha ao guardar dias automáticos da empresa.');
    } finally {
      setIsSavingCompanyExtraDays(false);
    }
  }

  async function submitSellVacationDays() {
    if (overview?.country !== 'BR') {
      showToast('error', 'A venda de férias está disponível apenas para colaboradores BR.');
      return;
    }

    const days = Number(sellVacationDaysInput);
    if (!Number.isFinite(days) || !Number.isInteger(days) || days < 0) {
      showToast('error', 'Indica um número inteiro válido de dias para vender.');
      return;
    }

    try {
      setIsSellingVacationDays(true);
      await apiRequest('/vacations/sell-days', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ days }),
      });

      clearApiCache('/vacations/overview');
      const refreshed = await loadOverview();
      setSellVacationDaysInput(String(refreshed?.calculation?.soldVacationDays ?? days));
      showToast('success', 'Venda de dias de férias atualizada com sucesso.');
    } catch (error) {
      showToast('error', error instanceof Error ? error.message : 'Falha ao atualizar venda de férias.');
    } finally {
      setIsSellingVacationDays(false);
    }
  }

  async function loadTeamContexts(signal?: AbortSignal) {
    try {
      const [ownTeamContexts, scopedTeams] = await Promise.all([
        apiRequestCached<TeamContext[]>('/users/me/teams', {
          headers: getAuthHeaders(),
          signal,
        }, 120000),
        apiRequestCached<TeamScopeEntry[]>('/teams/me?details=none', {
          headers: getAuthHeaders(),
          signal,
        }, 120000).catch(() => []),
      ]);

      const merged = new Map<string, TeamContext>();
      for (const item of ownTeamContexts) {
        merged.set(item.teamId, item);
      }

      for (const team of scopedTeams) {
        if (merged.has(team.id)) {
          continue;
        }

        merged.set(team.id, {
          teamId: team.id,
          teamName: team.name,
          membershipRole: 'PARTICIPANT',
          isApprover: false,
          approvalLevel: null,
          isPrimary: false,
        });
      }

      const data = Array.from(merged.values()).sort((a, b) => a.teamName.localeCompare(b.teamName, 'pt-PT'));

      if (!signal?.aborted) {
        setTeamContexts(data);
        setDraft((current) => ({
          ...current,
          contextTeamId: current.contextTeamId || data.find((item) => item.isPrimary)?.teamId || data[0]?.teamId || '',
        }));
      }
    } catch (error) {
      if (!isAbortError(error) && !signal?.aborted) {
        console.error('Falha ao carregar contextos de equipa:', error);
      }
    }
  }

  async function loadTeamVacationDetail(teamId: string, year: number, signal?: AbortSignal) {
    const key = `${teamId}-${year}`;
    if (teamVacationDetailsByKey[key]) {
      return;
    }

    setLoadingTeamVacationDetailKey(key);
    try {
      const data = await apiRequestCached<TeamVacationDetail>(`/teams/me/${teamId}?year=${year}`, {
        headers: getAuthHeaders(),
        signal,
      }, 45000);

      if (!signal?.aborted) {
        setTeamVacationDetailsByKey((current) => ({
          ...current,
          [key]: data,
        }));
      }
    } catch (error) {
      if (!isAbortError(error) && !signal?.aborted) {
        showToast('error', error instanceof Error ? error.message : 'Falha ao carregar férias da equipa.');
      }
    } finally {
      if (!signal?.aborted) {
        setLoadingTeamVacationDetailKey((current) => (current === key ? null : current));
      }
    }
  }

  function resetForm() {
    setDraft({
      ...EMPTY_DRAFT,
      contextTeamId: teamContexts.find((item) => item.isPrimary)?.teamId || teamContexts[0]?.teamId || '',
    });
    setEditingId(null);
    setDraftErrors({});
    setSelectionAnchor(null);
    setHoverDay(null);
  }

  function handleDraftChange(field: keyof VacationDraft, value: string) {
    setDraft((current) => ({ ...current, [field]: value }));
    setDraftErrors((current) => {
      if (!current[field]) {
        return current;
      }

      const next = { ...current };
      delete next[field];
      return next;
    });
    setSubmissionNotice(null);
  }

  function handleRequestKindChange(value: RequestKind) {
    if (value === 'VACATION' && hasWeekendInRange(draft.dataInicio, draft.dataFim)) {
      showToast('info', 'Intervalos com fim de semana só podem ser submetidos como ausência.');
      return;
    }

    setDraft((current) => ({
      ...current,
      requestKind: value,
      absenceReason: value === 'VACATION' ? current.absenceReason : current.absenceReason,
      partialDay: value === 'VACATION' ? current.partialDay : 'FULL',
    }));
    setSubmissionNotice(null);
  }

  async function handleAttachmentChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    const token = localStorage.getItem(STORAGE_TOKEN_KEY) || '';
    const formData = new FormData();
    formData.append('file', file);

    showToast('info', 'A carregar comprovativo...');

    try {
      const response = await fetch(`${getApiBase()}/files/upload`, {
        method: 'POST',
        headers: authHeaders(token),
        body: formData,
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { message?: string };
        throw new Error(payload.message || 'Falha ao carregar comprovativo.');
      }

      const payload = (await response.json()) as { linkPath?: string; link?: string };
      handleDraftChange('attachmentLink', payload.linkPath || payload.link || '');
      showToast('success', 'Comprovativo associado ao pedido.');
    } catch (error) {
      showToast('error', error instanceof Error ? error.message : 'Falha ao carregar comprovativo.');
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmissionNotice(null);

    const errors = buildValidationErrors(draft);
    if (Object.keys(errors).length > 0) {
      setDraftErrors(errors);
      const message = 'Existem erros no formulário. Corrige os campos assinalados antes de enviar.';
      setSubmissionNotice({ tone: 'error', message });
      showToast('error', message);
      return;
    }

    const requestType: VacationRequestType = draft.requestKind === 'VACATION'
      ? 'VACATION'
      : draft.absenceReason === 'Justificada - Doença'
        ? 'ABSENCE_MEDICAL'
        : 'ABSENCE_TRAINING';

    const observacoes = [
      draft.requestKind === 'VACATION' ? 'F\u00e9rias' : `Aus\u00eancia: ${draft.absenceReason}`,
      draft.observacoes.trim(),
    ].filter(Boolean).join(' | ');

    const payload = {
      dataInicio: draft.dataInicio,
      dataFim: draft.dataFim,
      observacoes,
      requestType,
      attachmentLink: draft.attachmentLink,
      contextTeamId: draft.contextTeamId || teamContexts.find((item) => item.isPrimary)?.teamId || teamContexts[0]?.teamId || undefined,
      partialDay: requestType === 'VACATION' ? draft.partialDay : 'FULL',
    };

    try {
      setIsSubmitting(true);
      const result = await apiRequest<{ warnings?: string[] }>(editingId ? `/vacations/${editingId}` : '/vacations', {
        method: editingId ? 'PUT' : 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify(payload),
      });

      clearApiCache('/vacations');
      clearApiCache('/vacations/me');
      clearApiCache('/users/dashboard-summary');
      void loadMine();
      if (activeTab === 'overview') {
        void loadOverview();
      }
      if (activeTab === 'calendar') {
        cacheRef.current.calendarLoadedYear = undefined;
        void loadCalendar(calendarYear);
      }
      void refreshNotifications();
      resetForm();
      setConflictRange(null);
      const actionLabel = editingId ? 'Pedido atualizado com sucesso.' : 'Pedido submetido com sucesso.';
      const typeLabel = requestType === 'VACATION'
        ? `Férias${payload.partialDay !== 'FULL' ? ` (${payload.partialDay === 'AM' ? 'meio-dia manhã' : 'meio-dia tarde'})` : ''}`
        : `Aus\u00eancia: ${draft.absenceReason}`;
      const periodLabel = `${formatShortDate(payload.dataInicio)} - ${formatShortDate(payload.dataFim)}`;
      const teamLabel = teamContexts.find((item) => item.teamId === payload.contextTeamId)?.teamName || 'Contexto principal automático';
      const detailLines = [
        `Tipo do pedido: ${typeLabel}`,
        `Período selecionado: ${periodLabel}`,
        `Equipa de contexto: ${teamLabel}`,
        editingId
          ? 'Estado do fluxo: a nova versão foi reenviada para aprovação.'
          : 'Estado do fluxo: o pedido foi enviado para aprovação.',
      ];
      const warnings = Array.isArray(result?.warnings) ? result.warnings.filter(Boolean) : [];
      if (warnings.length > 0) {
        setSubmissionNotice({ tone: 'warning', message: warnings[0] });
        showToast('warning', actionLabel, {
          title: 'Pedido registado com aviso',
          details: detailLines,
          highlight: {
            tone: 'warning',
            label: 'Aviso de conformidade PT',
            message: warnings[0],
          },
          persist: true,
        });
      } else {
        setSubmissionNotice({ tone: 'success', message: actionLabel });
        showToast('success', actionLabel, {
          title: editingId ? 'Versão reenviada para aprovação' : 'Pedido enviado para aprovação',
          details: detailLines,
          highlight: {
            tone: 'info',
            label: 'Próximo passo',
            message: 'Os aprovadores da cadeia da equipa vão receber o pedido nas aprovações e nas notificações.',
          },
          persist: true,
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Falha ao submeter pedido.';
      const isConflict = message.toLowerCase().includes('conflito de período');
      if (isConflict) {
        setConflictRange({ start: payload.dataInicio, end: payload.dataFim });
      }
      setSubmissionNotice({ tone: 'error', message });
      showToast('error', message, {
        title: 'Não foi possível submeter o pedido',
        details: [
          `Tipo em edição: ${requestType === 'VACATION' ? 'Férias' : 'Ausência'}`,
          `Período tentado: ${formatShortDate(payload.dataInicio)} - ${formatShortDate(payload.dataFim)}`,
        ],
        highlight: isConflict
          ? {
              tone: 'warning',
              label: 'Conflito detetado no histórico',
              message: 'As linhas sobrepostas ficaram assinaladas para revisão rápida.',
            }
          : undefined,
        persist: true,
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  function startEdit(record: VacationRecord) {
    const inferredKind: RequestKind = record.requestType === 'VACATION' ? 'VACATION' : 'ABSENCE';
    // Try to extract the stored motivo from observacoes (format: "Ausência: <motivo> | ...")
    const storedMotivoMatch = record.observacoes?.match(/^Aus\u00eancia: ([^|]+)/);
    const inferredAbsenceReason: string = storedMotivoMatch
      ? storedMotivoMatch[1].trim()
      : record.requestType === 'ABSENCE_TRAINING'
        ? 'Justificada - Formação'
        : ABSENCE_MOTIVOS[0];

    setEditingId(record.id);
    setDraft({
      requestKind: inferredKind,
      absenceReason: inferredAbsenceReason,
      dataInicio: record.dataInicio,
      dataFim: record.dataFim,
      observacoes: record.observacoes || '',
      attachmentLink: record.attachmentLink || '',
      contextTeamId: record.contextTeamId || teamContexts.find((item) => item.isPrimary)?.teamId || teamContexts[0]?.teamId || '',
      partialDay: record.partialDay || 'FULL',
    });
    setSelectionAnchor(null);
    setHoverDay(null);
    setSubmissionNotice(null);
    setConflictRange(null);
    setActiveTab('calendar');
    showToast('info', 'Modo edição ativo. Ao submeter, será criada uma nova versão do pedido.');
  }

  async function confirmVacationRealizado(id: string) {
    try {
      setPendingActionKey(`confirm-realizado-${id}`);
      await apiRequest(`/vacations/${id}/mark-realizado`, {
        method: 'POST',
        headers: getAuthHeaders(),
      });

      clearApiCache('/vacations');
      clearApiCache('/vacations/me');
      void loadMine();
      if (activeTab === 'overview') {
        void loadOverview();
      }
      void refreshNotifications();
      showToast('success', 'Férias confirmadas como realizadas. Aguardando validação da RH.');
    } catch (error) {
      showToast('error', error instanceof Error ? error.message : 'Falha ao confirmar realização.');
    } finally {
      setPendingActionKey(null);
    }
  }

  async function handleCancelPending(id: string) {
    try {
      await apiRequest(`/vacations/${id}`, {
        method: 'DELETE',
        headers: getAuthHeaders(),
      });

      clearApiCache('/vacations');
      clearApiCache('/vacations/me');
      clearApiCache('/users/dashboard-summary');
      void loadMine();
      if (activeTab === 'overview') {
        void loadOverview();
      }
      if (activeTab === 'calendar') {
        cacheRef.current.calendarLoadedYear = undefined;
        void loadCalendar(calendarYear);
      }
      void refreshNotifications();
      showToast('success', 'Pedido cancelado.');
    } catch (error) {
      showToast('error', error instanceof Error ? error.message : 'Falha ao cancelar pedido.');
    }
  }

  function handleDayClick(iso: string) {
    const today = new Date();
    const todayISO = dayISO(today.getFullYear(), today.getMonth(), today.getDate());
    if (iso < todayISO) return; // block past dates silently

    if (draft.requestKind === 'VACATION' && isWeekendIso(iso)) {
      setDraft((current) => ({
        ...current,
        requestKind: 'ABSENCE',
        partialDay: 'FULL',
      }));
      showToast('info', 'Dia de fim de semana: o pedido foi ajustado para ausência.');
    }

    if (selectionAnchor === null) {
      // First click — set anchor and pre-fill single day
      setSelectionAnchor(iso);
      setHoverDay(iso);
      setDraft((current) => ({ ...current, dataInicio: iso, dataFim: iso }));
      setDraftErrors((current) => {
        const next = { ...current };
        delete next.dataInicio;
        delete next.dataFim;
        return next;
      });
    } else {
      // Second click — confirm the range
      const start = selectionAnchor <= iso ? selectionAnchor : iso;
      const end = selectionAnchor <= iso ? iso : selectionAnchor;
      setDraft((current) => ({ ...current, dataInicio: start, dataFim: end }));
      setDraftErrors((current) => {
        const next = { ...current };
        delete next.dataInicio;
        delete next.dataFim;
        return next;
      });
      setSelectionAnchor(null);
      setHoverDay(null);
      setSubmissionNotice(null);
    }
  }

  function handleDayMouseEnter(iso: string) {
    if (selectionAnchor !== null) {
      setHoverDay(iso);
    }
  }

  function cancelSelection() {
    setSelectionAnchor(null);
    setHoverDay(null);
    setDraft(EMPTY_DRAFT);
    setDraftErrors({});
    setSubmissionNotice(null);
    setEditingId(null);
    setConflictRange(null);
  }

  function getDayRangeClass(iso: string): string {
    const anchor = selectionAnchor;
    const hover = hoverDay ?? anchor;

    // Live preview while anchor is set
    if (anchor !== null && hover !== null) {
      const previewStart = anchor <= hover ? anchor : hover;
      const previewEnd = anchor <= hover ? hover : anchor;
      if (iso === previewStart && iso === previewEnd) return ' cal-range-sole';
      if (iso === previewStart) return ' cal-range-start';
      if (iso === previewEnd) return ' cal-range-end';
      if (iso > previewStart && iso < previewEnd) return ' cal-range-mid';
      return '';
    }

    // Confirmed range (no anchor)
    const { dataInicio, dataFim } = draft;
    if (!dataInicio || !dataFim) return '';
    if (iso === dataInicio && iso === dataFim) return ' cal-range-sole cal-range-confirmed';
    if (iso === dataInicio) return ' cal-range-start cal-range-confirmed';
    if (iso === dataFim) return ' cal-range-end cal-range-confirmed';
    if (iso > dataInicio && iso < dataFim) return ' cal-range-mid cal-range-confirmed';
    return '';
  }


  function getDayKind(iso: string) {
    if (!calendarData) {
      return 'normal';
    }

    if (calendarData.extraDays.includes(iso)) return 'extra';
    if (calendarRequestDays.approvedAbsenceDays.has(iso)) return 'approved-absence';
    if (calendarRequestDays.approvedVacationDays.has(iso)) return 'approved';
    if (calendarRequestDays.pendingAbsenceDays.has(iso)) return 'pending-absence';
    if (calendarRequestDays.pendingVacationDays.has(iso)) return 'pending';
    if (calendarData.absencesDays.includes(iso)) return 'absence';
    if (calendarData.holidays.includes(iso)) return 'holiday';
    if (calendarData.weekendDays.includes(iso)) return 'weekend';
    return 'normal';
  }

  function getObservedBirthdayIso(year: number) {
    if (!profile.dataNascimento) {
      return '';
    }

    const [, month, day] = profile.dataNascimento.split('-');
    if (!month || !day) {
      return '';
    }

    const birthdayDate = new Date(`${year}-${month}-${day}T00:00:00`);
    const birthdayIso = dayISO(year, Number(month) - 1, Number(day));

    if (birthdayDate.getDay() !== 0 && birthdayDate.getDay() !== 6) {
      return birthdayIso;
    }

    if (!calendarData) {
      return birthdayIso;
    }

    const blockedDays = new Set(calendarData.holidays);
    const candidate = new Date(birthdayDate);

    while (true) {
      candidate.setDate(candidate.getDate() + 1);
      const dayOfWeek = candidate.getDay();
      const iso = dayISO(candidate.getFullYear(), candidate.getMonth(), candidate.getDate());

      if (dayOfWeek !== 0 && dayOfWeek !== 6 && !blockedDays.has(iso)) {
        return iso;
      }
    }
  }

  function getDayLabel(iso: string) {
    if (!calendarData) {
      return '';
    }

    const labels: string[] = [];
    const observedBirthdayIso = getObservedBirthdayIso(calendarData.year);

    if (calendarData.holidays.includes(iso)) labels.push('Feriado');
    if (calendarData.extraDays.includes(iso)) labels.push(extraDayLabelByDate.get(iso) || 'Dia dado pela empresa');
    if (observedBirthdayIso && iso === observedBirthdayIso) labels.push('Aniversário');
    if (calendarRequestDays.approvedVacationDays.has(iso)) labels.push('Férias aprovadas');
    if (calendarRequestDays.approvedAbsenceDays.has(iso)) labels.push('Ausência aprovada');
    if (calendarRequestDays.pendingVacationDays.has(iso)) labels.push('Pedido de férias pendente');
    if (calendarRequestDays.pendingAbsenceDays.has(iso)) labels.push('Pedido de ausência pendente');
    if (calendarData.absencesDays.includes(iso)) labels.push('Ausência');
    if (calendarData.weekendDays.includes(iso)) labels.push('Fim de semana');

    return labels.join(' • ');
  }

  function renderDayCell(iso: string | null, day: number | null, key: string) {
    if (!iso) {
      return <div key={key} className="vacations-day vacations-day--blank" />;
    }

    const today = new Date();
    const todayISO = dayISO(today.getFullYear(), today.getMonth(), today.getDate());
    const isPastDay = iso < todayISO;
    const rangeClass = !isTPeople ? getDayRangeClass(iso) : '';
    const isAnchorDay = iso === selectionAnchor;
    const isVacationWeekend = !isTPeople && draft.requestKind === 'VACATION' && isWeekendIso(iso);
    const canClickDay = !isTPeople && !isPastDay;
    const dayTitle = isPastDay
      ? 'Data passada'
      : isVacationWeekend
        ? 'Fim de semana: ao clicar, o pedido muda para ausência.'
        : getDayLabel(iso);

    return (
      <button
        type="button"
        key={key}
        className={`vacations-day vacations-day--${getDayKind(iso)}${rangeClass}${isAnchorDay ? ' cal-day-anchor' : ''}${isPastDay ? ' vacations-day--past' : ''}`}
        title={dayTitle}
        onClick={() => canClickDay && handleDayClick(iso)}
        onMouseEnter={() => !isTPeople && handleDayMouseEnter(iso)}
      >
        {day}
      </button>
    );
  }

  function shiftTeamVacationsMonth(direction: -1 | 1) {
    setTeamVacationsMonthCursor((current) => new Date(current.getFullYear(), current.getMonth() + direction, 1));
  }

  function renderTeamVacationCalendar(members: TeamCalendarPerson[]) {
    if (members.length === 0) {
      return null;
    }

    return (
      <div className="team-vac-calendar-wrap">
        <div className="team-vac-calendar-legend" aria-label="Legenda de dias especiais">
          <span className="team-vac-calendar-legend__item"><i className="is-vacation" />Férias aprovadas</span>
          <span className="team-vac-calendar-legend__item"><i className="is-absence" />Ausência aprovada</span>
          <span className="team-vac-calendar-legend__item"><i className="is-holiday" />Feriado</span>
          <span className="team-vac-calendar-legend__item"><i className="is-extra" />Dia automático</span>
          <span className="team-vac-calendar-legend__item"><i className="is-weekend" />Fim de semana</span>
        </div>

        <div
          className="team-vac-calendar-grid"
          style={{ gridTemplateColumns: `220px repeat(${teamVacationMonthDays.length}, minmax(28px, 1fr))` }}
        >
          <div className="team-vac-calendar-grid__member-head">Colaborador</div>
          {teamVacationMonthDays.map((day) => (
            <div
              key={`head-${day.iso}`}
              className={`team-vac-calendar-grid__day-head${day.isWeekend ? ' is-weekend' : ''}`}
              title={day.iso}
            >
              <small>{day.weekDayLabel}</small>
              <strong>{day.day}</strong>
            </div>
          ))}

          {members.map((member) => {
            const memberColor = memberColorMap.get(member.id) || '#4B79F5';
            const dayMap = approvedMonthByMemberByDay.get(member.id) ?? new Map<string, TeamVacation>();

            return (
              <Fragment key={`team-vac-row-${member.id}`}>
                <div key={`team-vac-member-${member.id}`} className="team-vac-calendar-grid__member-cell">
                  <span className="team-vac-calendar-grid__member-dot" style={{ background: memberColor }} />
                  <div>
                    <strong>{formatTeamPerson(member)}</strong>
                    {member.email ? <small>{member.email}</small> : <small>Sem email disponível</small>}
                    {member.isTeamLeader && <small className="team-vac-calendar-grid__member-role">Chefe da equipa</small>}
                  </div>
                </div>

                {teamVacationMonthDays.map((day) => {
                  const event = dayMap.get(day.iso);
                  const isAbsence = event && event.requestType !== 'VACATION';
                  const isHoliday = teamHolidaySet.has(day.iso);
                  const isExtraDay = teamExtraDaySet.has(day.iso);

                  const specialLabels: string[] = [];
                  if (isHoliday) specialLabels.push('Feriado');
                  if (isExtraDay) specialLabels.push(teamExtraDayLabelByDate.get(day.iso) || 'Dia automático');
                  if (day.isWeekend || teamWeekendSet.has(day.iso)) specialLabels.push('Fim de semana');

                  const titleParts = [
                    event ? `${getVacationTypeLabel(event.requestType)} aprovada · ${formatShortDate(event.dataInicio)} até ${formatShortDate(event.dataFim)}` : null,
                    specialLabels.length > 0 ? specialLabels.join(' · ') : null,
                    day.iso,
                  ].filter(Boolean);
                  const title = titleParts.join(' | ');

                  return (
                    <div
                      key={`${member.id}-${day.iso}`}
                      className={`team-vac-calendar-grid__day-cell${day.isWeekend ? ' is-weekend' : ''}${event ? ' has-event' : ''}${isAbsence ? ' is-absence' : ''}${isHoliday ? ' is-holiday' : ''}${isExtraDay ? ' is-extra-day' : ''}`}
                      style={event ? ({ '--member-color': memberColor } as CSSProperties) : undefined}
                      title={title}
                    >
                      {event && <span className="team-vac-calendar-grid__event-pill" />}
                      {!event && isHoliday && <span className="team-vac-calendar-grid__special-pill">F</span>}
                      {!event && !isHoliday && isExtraDay && <span className="team-vac-calendar-grid__special-pill">A</span>}
                    </div>
                  );
                })}
              </Fragment>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <section className="trainings-shell vacations-shell">
      {!isTPeople && pendingVacationRequests.length > 0 && (
        <section className="profile-request-banner profile-request-banner--vacations" role="status" aria-live="polite">
          <div className="profile-request-banner__inner">
            <div className="profile-request-banner__content">
              <span className="profile-request-banner__chip">Em análise</span>
              <strong>Pedido de férias/ausência em análise</strong>
              <span>
                {pendingVacationRequests.length} pedido(s) pendente(s) · {pendingVacationDaysTotal} {pendingVacationDaysTotal === 1 ? 'dia' : 'dias'} em validação
              </span>
            </div>
            <button
              type="button"
              className="profile-request-banner__btn"
              onClick={() => setIsPendingVacationDetailOpen(true)}
            >
              Ver pedido
            </button>
          </div>
        </section>
      )}

      {!isTPeople && approvedVacationsReadyForRealization.length > 0 && (
        <section className="profile-request-banner profile-request-banner--vacations" role="status" aria-live="polite">
          <div className="profile-request-banner__inner">
            <div className="profile-request-banner__content">
              <span className="profile-request-banner__chip">Realização</span>
              <strong>Férias realizadas — confirmar realização</strong>
              <span>
                {approvedVacationsReadyForRealization.length} período(s) de férias já findos à espera de confirmação
              </span>
            </div>
            <button
              type="button"
              className="profile-request-banner__btn"
              onClick={() => setIsApprovedVacationDetailOpen(true)}
            >
              Confirmar
            </button>
          </div>
        </section>
      )}

      {isPendingVacationDetailOpen && !isTPeople && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="pending-vacation-modal-title" onClick={(e) => { if (e.target === e.currentTarget) setIsPendingVacationDetailOpen(false); }}>
          <div className="pending-modal pending-modal--vacations">
            <div className="pending-modal__header">
              <div>
                <p className="pending-modal__kicker">Férias e ausências</p>
                <h2 id="pending-vacation-modal-title">Pedidos em análise</h2>
              </div>
              <button type="button" className="pending-modal__close" onClick={() => setIsPendingVacationDetailOpen(false)} aria-label="Fechar">×</button>
            </div>
            <p className="pending-modal__sub">Estes pedidos já foram submetidos e aguardam validação da cadeia de aprovação.</p>
            <div className="pending-modal__summary" aria-live="polite">
              <span className="pending-modal__summary-item">{pendingVacationRequests.length} pedido(s)</span>
              <span className="pending-modal__summary-item">{pendingVacationDaysTotal} {pendingVacationDaysTotal === 1 ? 'dia' : 'dias'} pendente(s)</span>
            </div>
            {pendingVacationRequests.length > 0 ? (
              <div className="pending-modal__table-wrap">
                <table className="pending-modal__table">
                  <thead>
                    <tr>
                      <th>Pedido</th>
                      <th>Período</th>
                      <th>Duração</th>
                      <th>Equipa</th>
                      <th>Submetido em</th>
                      <th>Observações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pendingVacationRequests.map((record) => (
                      <tr key={record.id}>
                        <td className="pending-modal__field">{getVacationTypeLabel(record.requestType, record.observacoes)}{getPartialDayLabel(record.partialDay)}</td>
                        <td>{formatShortDate(record.dataInicio)} - {formatShortDate(record.dataFim)}</td>
                        <td>{calculateDuration(record)}</td>
                        <td>{record.contextTeam?.name || 'Contexto principal'}</td>
                        <td>{formatDateTime(record.createdAt)}</td>
                        <td>{record.observacoes?.trim() || 'Sem observações'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="pending-modal__empty">Sem pedidos pendentes de momento.</p>
            )}
            <div className="pending-modal__footer">
              <button type="button" className="pending-modal__dismiss" onClick={() => setIsPendingVacationDetailOpen(false)}>Fechar</button>
            </div>
          </div>
        </div>
      )}

      {isApprovedVacationDetailOpen && !isTPeople && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="approved-vacation-modal-title" onClick={(e) => { if (e.target === e.currentTarget) setIsApprovedVacationDetailOpen(false); }}>
          <div className="pending-modal pending-modal--vacations">
            <div className="pending-modal__header">
              <div>
                <p className="pending-modal__kicker">Férias e ausências</p>
                <h2 id="approved-vacation-modal-title">Confirmar realização</h2>
              </div>
              <button type="button" className="pending-modal__close" onClick={() => setIsApprovedVacationDetailOpen(false)} aria-label="Fechar">×</button>
            </div>
            <p className="pending-modal__sub">Confirma a realização das férias já findas. A RH necessita de validação posterior.</p>
            <div className="pending-modal__summary" aria-live="polite">
              <span className="pending-modal__summary-item">{approvedVacationsReadyForRealization.length} período(s)</span>
            </div>
            {approvedVacationsReadyForRealization.length > 0 ? (
              <div className="pending-modal__table-wrap">
                <table className="pending-modal__table">
                  <thead>
                    <tr>
                      <th>Pedido</th>
                      <th>Período</th>
                      <th>Duração</th>
                      <th>Equipa</th>
                      <th>Ação</th>
                    </tr>
                  </thead>
                  <tbody>
                    {approvedVacationsReadyForRealization.map((record) => (
                      <tr key={record.id}>
                        <td className="pending-modal__field">{getVacationTypeLabel(record.requestType, record.observacoes)}{getPartialDayLabel(record.partialDay)}</td>
                        <td>{formatShortDate(record.dataInicio)} - {formatShortDate(record.dataFim)}</td>
                        <td>{calculateDuration(record)}</td>
                        <td>{record.contextTeam?.name || 'Contexto principal'}</td>
                        <td>
                          <Button
                            type="button"
                            size="sm"
                            variant="primary"
                            isLoading={pendingActionKey === `confirm-realizado-${record.id}`}
                            disabled={Boolean(pendingActionKey)}
                            onClick={() => void confirmVacationRealizado(record.id)}
                          >
                            Confirmar
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="pending-modal__empty">Sem férias prontas para realização de momento.</p>
            )}
            <div className="pending-modal__footer">
              <button type="button" className="pending-modal__dismiss" onClick={() => setIsApprovedVacationDetailOpen(false)}>Fechar</button>
            </div>
          </div>
        </div>
      )}

      {isAddCompanyExtraDayModalOpen && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="add-company-extra-day-modal-title" onClick={(e) => { if (e.target === e.currentTarget) setIsAddCompanyExtraDayModalOpen(false); }}>
          <div className="add-company-extra-day-modal">
            <div className="add-company-extra-day-modal__header">
              <h2 id="add-company-extra-day-modal-title">Quando aplicar este dia?</h2>
              <button type="button" className="add-company-extra-day-modal__close" onClick={() => setIsAddCompanyExtraDayModalOpen(false)} aria-label="Fechar">×</button>
            </div>
            <p className="add-company-extra-day-modal__description">
              Escolhe se este dia deve ser aplicado já no ano atual ou apenas no próximo ano.
            </p>
            <div className="add-company-extra-day-modal__options">
              <button
                type="button"
                className="add-company-extra-day-modal__option"
                onClick={() => void confirmAddCompanyExtraDay(new Date().getFullYear())}
              >
                <span className="add-company-extra-day-modal__option-label">Já neste ano</span>
                <span className="add-company-extra-day-modal__option-year">{new Date().getFullYear()}</span>
              </button>
              <button
                type="button"
                className="add-company-extra-day-modal__option"
                onClick={() => void confirmAddCompanyExtraDay(new Date().getFullYear() + 1)}
              >
                <span className="add-company-extra-day-modal__option-label">Próximo ano</span>
                <span className="add-company-extra-day-modal__option-year">{new Date().getFullYear() + 1}</span>
              </button>
            </div>
            <div className="add-company-extra-day-modal__footer">
              <button type="button" className="add-company-extra-day-modal__cancel" onClick={() => setIsAddCompanyExtraDayModalOpen(false)}>Cancelar</button>
            </div>
          </div>
        </div>
      )}

      <nav className="rh-tabs">
        {allowedTabs.includes('overview') && (
          <button type="button" className={activeTab === 'overview' ? 'is-active' : ''} onClick={() => setActiveTab('overview')}>Resumo</button>
        )}
        {allowedTabs.includes('calendar') && (
          <button type="button" className={activeTab === 'calendar' ? 'is-active' : ''} onClick={() => setActiveTab('calendar')}>Calendário</button>
        )}
        {allowedTabs.includes('team-vacations') && (
          <button type="button" className={activeTab === 'team-vacations' ? 'is-active' : ''} onClick={() => setActiveTab('team-vacations')}>Férias da equipa</button>
        )}
        {allowedTabs.includes('company-days') && (
          <button type="button" className={activeTab === 'company-days' ? 'is-active' : ''} onClick={() => setActiveTab('company-days')}>Dias automáticos</button>
        )}
        {allowedTabs.includes('export') && (
          <button type="button" className={activeTab === 'export' ? 'is-active' : ''} onClick={() => setActiveTab('export')}>Mapa de Férias</button>
        )}
      </nav>

      {activeTab === 'overview' && !isTPeople && (
        <section className="trainings-list-card">
          <div className="trainings-list-head">
            <h3>Resumo anual</h3>
          </div>

          {overviewError ? (
            <div className="vacations-panel-state">
              <p>{overviewError}</p>
              <button
                type="button"
                className="vacations-panel-state__action"
                onClick={() => {
                  cacheRef.current.overviewLoaded = false;
                  setOverviewError('');
                  setIsOverviewLoading(false);
                  setActiveTab('overview');
                }}
              >
                Tentar novamente
              </button>
            </div>
          ) : isOverviewLoading || !overview ? (
            <div className="vacations-overview-grid vacations-overview-grid--loading">
              {Array.from({ length: 6 }).map((_, index) => (
                <article key={index} className="home-card home-card--loading">
                  <span className="loading-line loading-line--card-title" />
                  <span className="loading-line loading-line--card-body" />
                  <span className="loading-line loading-line--button" />
                </article>
              ))}
            </div>
          ) : (
            <>
              <div className="vacations-overview-grid">
                <article>
                  <span>Saldo anual</span>
                  <strong>{overviewStats.entitlement.toLocaleString('pt-PT')} dias</strong>
                  <small>Base disponível para o ano em curso.</small>
                </article>
                <article>
                  <span>Já gastaste</span>
                  <strong>{overviewStats.approvedVacationDays.toLocaleString('pt-PT')} dias</strong>
                  <small>Pedidos de férias já aprovados.</small>
                </article>
                <article>
                  <span>Tem para gastar</span>
                  <strong>{remainingVacationDays.toLocaleString('pt-PT')} dias</strong>
                  <small>Saldo livre (desconta aprovados e pendentes).</small>
                </article>
                <article>
                  <span>Pedidos pendentes</span>
                  <strong>{pendingVacationRequests.length} {pendingVacationRequests.length === 1 ? 'pedido' : 'pedidos'}</strong>
                  <small>Férias à espera de aprovação.</small>
                </article>
                <article>
                  <span>Dias dados pela empresa</span>
                  <strong>{companyExtraDays.length}</strong>
                  <small></small>
                </article>
              </div>

              {overview.country === 'BR' && (
                <div className="vacations-sell-card">
                  <div className="vacations-sell-card__head">
                    <h4>Venda de férias (abono)</h4>
                    <p>Defina quantos dias quer vender no período atual.</p>
                  </div>

                  <div className="vacations-sell-card__meta" aria-label="Resumo de venda de férias">
                    <span>Máx. vendável: <strong>{overview.calculation?.maxSellableDays ?? 0}</strong></span>
                    <span>Já vendido: <strong>{overview.calculation?.soldVacationDays ?? 0}</strong></span>
                  </div>

                  <div className="vacations-sell-card__actions">
                    <label className="vacations-sell-card__input-wrap" htmlFor="sell-vacation-days-input">
                      <span>Dias a vender</span>
                      <input
                        id="sell-vacation-days-input"
                        type="number"
                        min={0}
                        max={overview.calculation?.maxSellableDays ?? 0}
                        value={sellVacationDaysInput}
                        onChange={(event) => setSellVacationDaysInput(event.target.value)}
                      />
                    </label>
                    <button type="button" className="btn-primary" onClick={() => void submitSellVacationDays()} disabled={isSellingVacationDays}>
                      {isSellingVacationDays ? 'A guardar...' : 'Guardar venda'}
                    </button>
                  </div>
                </div>
              )}

            </>
          )}
        </section>
      )}

      {activeTab === 'calendar' && (
        <section
          className="trainings-list-card vacations-calendar-integrated"
          onMouseLeave={() => selectionAnchor !== null && setHoverDay(selectionAnchor)}
        >
          <div className="vacations-calendar-toolbar" aria-label="Navegação de ano do calendário">
            <div className="vacations-calendar-toolbar__title">
              <h3>Calendário {calendarYear}</h3>
              <p>Podes consultar anos anteriores e futuros sem perder o histórico.</p>
            </div>
            <div className="vacations-calendar-toolbar__actions">
              <button type="button" className="vacations-calendar-toolbar__btn" onClick={() => setCalendarYear((year) => year - 1)}>
                Ano anterior
              </button>
              <select
                className="vacations-calendar-toolbar__year-select"
                value={calendarYear}
                onChange={(event) => setCalendarYear(Number(event.target.value))}
              >
                {Array.from({ length: 9 }, (_, index) => new Date().getFullYear() - 4 + index).map((year) => (
                  <option key={year} value={year}>{year}</option>
                ))}
              </select>
              <button type="button" className="vacations-calendar-toolbar__btn" onClick={() => setCalendarYear((year) => year + 1)}>
                Próximo ano
              </button>
              <button type="button" className="vacations-calendar-toolbar__btn vacations-calendar-toolbar__btn--ghost" onClick={() => setCalendarYear(new Date().getFullYear())}>
                Ano atual
              </button>
            </div>
          </div>

          <div className="vacations-legend vacations-legend--sticky" aria-label="Legenda do calendário">
            <span className="vacations-legend-item"><i className="legend-swatch legend-swatch--holiday" />Feriado</span>
            <span className="vacations-legend-item"><i className="legend-swatch legend-swatch--weekend" />Fim de semana</span>
            <span className="vacations-legend-item"><i className="legend-swatch legend-swatch--absence" />Ausência pendente</span>
            <span className="vacations-legend-item"><i className="legend-swatch legend-swatch--approved-absence" />Ausência aprovada</span>
            <span className="vacations-legend-item"><i className="legend-swatch legend-swatch--pending" />Férias Pendentes</span>
            <span className="vacations-legend-item"><i className="legend-swatch legend-swatch--approved" />Férias aprovadas</span>
            <span className="vacations-legend-item"><i className="legend-swatch legend-swatch--extra" />Dia dado pela empresa</span>
            {!isTPeople && (
              <span className="vacations-legend-item vacations-legend-item--hint">
                {selectionAnchor
                  ? `📅 ${formatShortDate(selectionAnchor)} — clica no dia de fim`
                  : draft.dataInicio && draft.dataFim && !selectionAnchor
                    ? `Selecionado: ${formatShortDate(draft.dataInicio)}${draft.dataInicio !== draft.dataFim ? ' → ' + formatShortDate(draft.dataFim) : ''}`
                    : 'Clica num dia para iniciar seleção'}
                {draft.requestKind === 'VACATION'
                  ? ' · Férias: início/fim apenas em dias úteis.'
                  : ' · Ausências: pode começar/terminar ao fim de semana.'}
              </span>
            )}
          </div>

          {calendarError ? (
            <div className="vacations-panel-state">
              <p>{calendarError}</p>
              <button
                type="button"
                className="vacations-panel-state__action"
                onClick={() => {
                  cacheRef.current.calendarLoadedYear = undefined;
                  setCalendarError('');
                  setIsCalendarLoading(false);
                  setActiveTab('calendar');
                }}
              >
                Tentar novamente
              </button>
            </div>
          ) : isCalendarLoading || !calendarData ? (
            <div className="vacations-year-grid vacations-year-grid--loading">
              {Array.from({ length: 4 }).map((_, index) => (
                <article key={index} className="vacations-month-card home-card--loading">
                  <span className="loading-line loading-line--card-title" />
                  <span className="loading-line loading-line--card-body" />
                  <span className="loading-line loading-line--card-body" />
                </article>
              ))}
            </div>
          ) : (
            <div className="vacations-year-grid">
              {yearMonths.map((month) => (
                <article
                  key={month.month}
                  className="vacations-month-card"
                  ref={month.monthIndex === calendarMonthIndexToFocus ? (node) => {
                    currentMonthRef.current = node;
                  } : undefined}
                >
                  <header>
                    <h4>{month.month}</h4>
                  </header>

                  <div className="vacations-month-grid">
                    {['S', 'T', 'Q', 'Q', 'S', 'S', 'D'].map((label, index) => (
                      <strong key={`${month.month}-${label}-${index}`}>{label}</strong>
                    ))}

                    {month.cells.map((cell, idx) => renderDayCell(cell.iso, cell.day, `${month.month}-${cell.iso || 'blank'}-${idx}`))}
                  </div>
                </article>
              ))}
            </div>
          )}

          {/* ── Floating booking bar ── */}
          {!isTPeople && (selectionAnchor !== null || (draft.dataInicio && draft.dataFim && !selectionAnchor)) && (
            <div className={`cal-booking-bar${selectionAnchor !== null ? ' cal-booking-bar--picking' : ' cal-booking-bar--ready'}`} role="region" aria-label="Painel de pedido">
              {selectionAnchor !== null ? (
                <div className="cal-booking-bar__hint">
                  <span className="cal-booking-bar__hint-icon">📅</span>
                  <div>
                    <strong>Início: {formatShortDate(selectionAnchor)}</strong>
                    <p>Clica no dia de fim para definir o intervalo</p>
                  </div>
                  <button type="button" className="cal-booking-bar__cancel" onClick={cancelSelection} aria-label="Cancelar seleção">✕</button>
                </div>
              ) : (
                <form className="cal-booking-bar__form" onSubmit={handleSubmit} noValidate>
                  {(() => {
                    const selectedDays = draft.requestKind === 'VACATION'
                      ? calculateDuration({
                          dataInicio: draft.dataInicio,
                          dataFim: draft.dataFim,
                          requestType: 'VACATION',
                          partialDay: draft.partialDay,
                        })
                      : calculateDays({ dataInicio: draft.dataInicio, dataFim: draft.dataFim });
                    const includesWeekend = hasWeekendInRange(draft.dataInicio, draft.dataFim);

                    return (
                  <div className="cal-booking-bar__range">
                    <span className="cal-booking-bar__range-icon">📅</span>
                    <div className="cal-booking-bar__range-dates">
                      <strong>
                        {draft.dataInicio === draft.dataFim
                          ? formatShortDate(draft.dataInicio)
                          : `${formatShortDate(draft.dataInicio)} → ${formatShortDate(draft.dataFim)}`}
                      </strong>
                      <small>
                        {selectedDays} {selectedDays === 1 ? 'dia' : 'dias'}
                        {draft.requestKind === 'VACATION' ? ' úteis' : ''}
                        {editingId ? ' · Editando pedido' : ''}
                      </small>
                      {draft.requestKind === 'ABSENCE' && includesWeekend && (
                        <small> - Inclui fim de semana: permitido para ausências.</small>
                      )}
                    </div>
                    <button type="button" className="cal-booking-bar__reselect" title="Alterar intervalo" onClick={() => {
                      setSelectionAnchor(draft.dataInicio);
                      setHoverDay(draft.dataFim);
                    }}>
                      ✎
                    </button>
                  </div>
                    );
                  })()}

                  <div className="cal-booking-bar__fields">
                    <label className="cal-booking-bar__field">
                      <span>Tipo</span>
                      <select value={draft.requestKind} onChange={(e) => handleRequestKindChange(e.target.value as RequestKind)}>
                        <option value="VACATION" disabled={hasWeekendInRange(draft.dataInicio, draft.dataFim)}>Férias</option>
                        <option value="ABSENCE">Ausência</option>
                      </select>
                    </label>

                    {draft.requestKind === 'ABSENCE' ? (
                      <>
                        <label className="cal-booking-bar__field">
                          <span>Motivo</span>
                          <select value={draft.absenceReason} onChange={(e) => handleDraftChange('absenceReason', e.target.value)}>
                            {ABSENCE_MOTIVOS.map((m) => <option key={m} value={m}>{m}</option>)}
                          </select>
                        </label>
                      </>
                    ) : (
                      <label className="cal-booking-bar__field">
                        <span>Duração</span>
                        <select value={draft.partialDay} onChange={(e) => handleDraftChange('partialDay', e.target.value)}>
                          <option value="FULL">Dia completo</option>
                          <option value="AM">Meio-dia manhã</option>
                          <option value="PM">Meio-dia tarde</option>
                        </select>
                      </label>
                    )}

                    <label className="cal-booking-bar__field cal-booking-bar__field--grow">
                      <span>Observações</span>
                      <input type="text" value={draft.observacoes} onChange={(e) => handleDraftChange('observacoes', e.target.value)} placeholder="Opcional" />
                    </label>

                    <label className="cal-booking-bar__field cal-booking-bar__field--file">
                      <span>Comprovativo</span>
                      <input type="file" accept=".pdf,.png,.jpg,.jpeg" onChange={handleAttachmentChange} />
                    </label>
                  </div>

                  {(draftErrors.dataInicio || draftErrors.dataFim) && (
                    <small className="cal-booking-bar__err">{draftErrors.dataInicio || draftErrors.dataFim}</small>
                  )}

                  <div className="cal-booking-bar__actions">
                    <Button type="submit" variant="primary" isLoading={isSubmitting}>
                      {editingId ? 'Guardar versão' : 'Enviar pedido'}
                    </Button>
                    <button type="button" className="cal-booking-bar__cancel" onClick={cancelSelection} disabled={isSubmitting}>Cancelar</button>
                  </div>
                </form>
              )}
            </div>
          )}

          {!isTPeople && (
            <section className="vhist" aria-label="Histórico de pedidos">
              <div className="vhist__header">
                <div className="vhist__title-block">
                  <h3 className="vhist__title">Pedidos</h3>
                  <p className="vhist__sub">Férias e ausências submetidas</p>
                </div>
                <div className="vhist__stats" aria-label="Indicadores">
                  <span className="vhist__stat">{sortedRecords.length}<em>total</em></span>
                  <span className="vhist__stat vhist__stat--warn">{sortedRecords.filter((r) => r.status === 'PENDING').length}<em>pendentes</em></span>
                  <span className="vhist__stat vhist__stat--ok">{sortedRecords.filter((r) => r.status === 'APPROVED').length}<em>aprovados</em></span>
                </div>
              </div>

              {conflictRange && conflictRecordIds.size > 0 && (
                <div className="vhist__conflict-notice" role="alert">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                  Conflito detetado: {formatShortDate(conflictRange.start)} — {formatShortDate(conflictRange.end)}
                </div>
              )}

              {sortedRecords.length === 0 ? (
                <div className="vhist__empty">Nenhum pedido submetido ainda.</div>
              ) : (
                <>
                  <div className="vhist__table-wrap">
                    <table className="vhist__table">
                      <thead>
                        <tr>
                          <th>Tipo</th>
                          <th>Período</th>
                          <th>Dur.</th>
                          <th>Equipa</th>
                          <th>Estado</th>
                          <th>Nota</th>
                          <th></th>
                        </tr>
                      </thead>
                      <tbody>
                        {sortedRecords.map((record) => (
                          <tr key={record.id} className={conflictRecordIds.has(record.id) ? 'vhist__row--conflict' : ''}>
                            <td>
                              <span className={`vhist__type vhist__type--${getVacationTypeTag(record.requestType)}`}>{getVacationTypeLabel(record.requestType, record.observacoes)}{getPartialDayLabel(record.partialDay)}</span>
                              <span className="vhist__meta">{formatDateTime(record.createdAt)}</span>
                            </td>
                            <td className="vhist__period">
                              {formatShortDate(record.dataInicio)} – {formatShortDate(record.dataFim)}
                              <span className="vhist__meta">V{record.versionNumber || 1}</span>
                            </td>
                            <td className="vhist__days">
                              <strong>{calculateDuration(record)}</strong>
                              <span className="vhist__meta">{record.requestType === 'VACATION' ? 'úteis' : 'corridos'}</span>
                            </td>
                            <td className="vhist__meta">{record.contextTeam?.name || 'Principal'}</td>
                            <td>
                              <span className={`vhist__badge vhist__badge--${record.status.toLowerCase()}`}>{formatVacationStatusLabel(record.status)}</span>
                            </td>
                            <td className="vhist__note">{record.observacoes?.trim() || <span className="vhist__meta">—</span>}</td>
                            <td className="vhist__actions">
                              {record.status === 'PENDING' || record.status === 'APPROVED' ? (
                                <>
                                  <button type="button" className="vhist__action-btn" onClick={() => startEdit(record)}>Editar</button>
                                  {record.status === 'PENDING' && <button type="button" className="vhist__action-btn vhist__action-btn--danger" onClick={() => void handleCancelPending(record.id)}>Anular</button>}
                                </>
                              ) : <span className="vhist__meta">—</span>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="vhist__cards" aria-label="Lista de pedidos (mobile)">
                    {sortedRecords.map((record) => (
                      <article key={`m-${record.id}`} className={`vhist__card${conflictRecordIds.has(record.id) ? ' vhist__card--conflict' : ''}`}>
                        <div className="vhist__card-top">
                          <span className={`vhist__type vhist__type--${getVacationTypeTag(record.requestType)}`}>{getVacationTypeLabel(record.requestType, record.observacoes)}</span>
                          <span className={`vhist__badge vhist__badge--${record.status.toLowerCase()}`}>{formatVacationStatusLabel(record.status)}</span>
                        </div>
                        <div className="vhist__card-row">
                          <div className="vhist__card-field"><span>Período</span><strong>{formatShortDate(record.dataInicio)} – {formatShortDate(record.dataFim)}</strong></div>
                          <div className="vhist__card-field"><span>Duração</span><strong>{calculateDuration(record)} {record.requestType === 'VACATION' ? 'úteis' : 'dias'}</strong></div>
                          <div className="vhist__card-field"><span>Equipa</span><strong>{record.contextTeam?.name || 'Principal'}</strong></div>
                        </div>
                        {record.observacoes?.trim() && <p className="vhist__card-note">{record.observacoes.trim()}</p>}
                        <span className="vhist__meta">Submetido em {formatDateTime(record.createdAt)}</span>
                        {(record.status === 'PENDING' || record.status === 'APPROVED') && (
                          <div className="vhist__card-actions">
                            <button type="button" className="vhist__action-btn" onClick={() => startEdit(record)}>Editar</button>
                            {record.status === 'PENDING' && <button type="button" className="vhist__action-btn vhist__action-btn--danger" onClick={() => void handleCancelPending(record.id)}>Anular</button>}
                          </div>
                        )}
                      </article>
                    ))}
                  </div>
                </>
              )}
            </section>
          )}
        </section>
      )}

      {activeTab === 'team-vacations' && (
        <section className="trainings-list-card manager-team-vacations-board">
          <div className="team-vac-calendar-toolbar">
            <div className="team-vac-calendar-toolbar__month-nav">
              <Button type="button" variant="ghost" size="sm" onClick={() => shiftTeamVacationsMonth(-1)} aria-label="Mês anterior">←</Button>
              <strong>{teamVacationMonthLabel}</strong>
              <Button type="button" variant="ghost" size="sm" onClick={() => shiftTeamVacationsMonth(1)} aria-label="Mês seguinte">→</Button>
            </div>

            <div className="team-vac-calendar-toolbar__filters">
              <label className="team-vac-calendar-toolbar__field">
                <span className="team-vac-calendar-toolbar__field-label">Equipa</span>
                <select
                  className="team-vac-calendar-toolbar__select"
                  value={selectedTeamVacationId}
                  onChange={(event) => setSelectedTeamVacationId(event.target.value)}
                >
                  {teamContexts.map((team) => (
                    <option key={team.teamId} value={team.teamId}>{team.teamName}</option>
                  ))}
                </select>
              </label>
              <label className="team-vac-calendar-toolbar__field team-vac-calendar-toolbar__field--search">
                <span className="team-vac-calendar-toolbar__field-label">Colaborador</span>
                <input
                  className="team-vac-calendar-toolbar__search"
                  type="search"
                  value={teamVacationSearchQuery}
                  onChange={(event) => setTeamVacationSearchQuery(event.target.value)}
                  placeholder="Filtrar colaborador..."
                />
              </label>
            </div>
          </div>

          {selectedTeamVacationContext && (
            <p className="team-vac-calendar-info">
              Equipa selecionada: <strong>{selectedTeamVacationContext.teamName}</strong>
            </p>
          )}

          {isLoadingTeamSpecialCalendar && (
            <div className="team-vac-calendar-info">A carregar feriados e dias automáticos...</div>
          )}

          {loadingTeamVacationDetailKey === teamVacationDetailsKey && filteredTeamCalendarMembers.length === 0 && (
            <article className="trainings-mobile-card">
              <span className="loading-line loading-line--card-title" />
              <span className="loading-line loading-line--card-body" />
            </article>
          )}

          {!selectedTeamVacationId && (
            <div className="vacations-panel-state">
              <p>Sem equipa disponível para mostrar férias da equipa.</p>
            </div>
          )}

          {selectedTeamVacationId && loadingTeamVacationDetailKey !== teamVacationDetailsKey && filteredTeamCalendarMembers.length === 0 && (
            <div className="vacations-panel-state">
              <p>Sem colaboradores para o filtro atual.</p>
            </div>
          )}

          {filteredTeamCalendarMembers.length > 0 && renderTeamVacationCalendar(filteredTeamCalendarMembers)}
        </section>
      )}

      {activeTab === 'company-days' && canManageVacationRules && (
        <section className="vauto trainings-list-card">
          <div className="vauto__header">
            <div>
              <h3 className="vauto__title">Dias automáticos</h3>
              <p className="vauto__sub">Dias extra dados pela empresa · visíveis no calendário de todos</p>
            </div>
            <div className="vauto__header-right">
              <div className="vauto__year-nav" aria-label="Ano">
                <button type="button" className="vauto__year-btn" onClick={() => { setCompanyExtraYear((y) => y - 1); }} aria-label="Ano anterior">‹</button>
                <span className="vauto__year-label">{companyExtraYear}</span>
                <button type="button" className="vauto__year-btn" onClick={() => { setCompanyExtraYear((y) => y + 1); }} aria-label="Próximo ano">›</button>
              </div>
              {companyExtraDaysSource === 'legacy' && <span className="vauto__src-tag vauto__src-tag--legacy">Padrão antigo</span>}
              {companyExtraDaysSource === 'configured' && <span className="vauto__src-tag vauto__src-tag--ok">Configurado</span>}
            </div>
          </div>

          {isLoadingCompanyExtraDays ? (
            <div className="vauto__loading">A carregar…</div>
          ) : (
            <>
              <div className="vauto__form">
                <label className="vauto__field">
                  <span>Mês</span>
                  <select value={companyExtraDayMonth} onChange={(e) => setCompanyExtraDayMonth(e.target.value)}>
                    <option value="01">Janeiro</option>
                    <option value="02">Fevereiro</option>
                    <option value="03">Março</option>
                    <option value="04">Abril</option>
                    <option value="05">Maio</option>
                    <option value="06">Junho</option>
                    <option value="07">Julho</option>
                    <option value="08">Agosto</option>
                    <option value="09">Setembro</option>
                    <option value="10">Outubro</option>
                    <option value="11">Novembro</option>
                    <option value="12">Dezembro</option>
                  </select>
                </label>
                <label className="vauto__field vauto__field--sm">
                  <span>Dia</span>
                  <select value={companyExtraDayDay} onChange={(e) => setCompanyExtraDayDay(e.target.value)}>
                    {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                      <option key={d} value={String(d).padStart(2, '0')}>{d}</option>
                    ))}
                  </select>
                </label>
                <label className="vauto__field vauto__field--grow">
                  <span>Descrição</span>
                  <input
                    type="text"
                    value={companyExtraDayLabel}
                    onChange={(e) => setCompanyExtraDayLabel(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void addCompanyExtraDay(); } }}
                    placeholder="Ex.: Encerramento de Natal"
                  />
                </label>
                <button
                  type="button"
                  className="vauto__add-btn"
                  disabled={isSavingCompanyExtraDays}
                  onClick={() => void addCompanyExtraDay()}
                >
                  {isSavingCompanyExtraDays ? '…' : '+ Adicionar'}
                </button>
              </div>

              {companyExtraDaysError && (
                <div className="vauto__error">{companyExtraDaysError}</div>
              )}

              {companyExtraDays.length === 0 ? (
                <div className="vauto__empty">
                  <p>Nenhum dia configurado para {companyExtraYear}.</p>
                  <span>Usa o formulário acima para adicionar o primeiro.</span>
                </div>
              ) : (
                <table className="vauto__list">
                  <thead>
                    <tr>
                      <th>Data</th>
                      <th>Descrição</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {companyExtraDays.map((item) => {
                      const [mm, dd] = item.date.split('-');
                      const monthName = MONTHS[parseInt(mm, 10) - 1] || mm;
                      return (
                        <tr key={item.date}>
                          <td className="vauto__list-date">{dd} {monthName}</td>
                          <td className="vauto__list-label">{item.label}</td>
                          <td className="vauto__list-action">
                            <button
                              type="button"
                              className="vauto__remove-btn"
                              disabled={isSavingCompanyExtraDays}
                              onClick={() => void removeCompanyExtraDay(item.date)}
                              aria-label={`Remover ${item.label}`}
                            >
                              Remover
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </>
          )}
        </section>
      )}

      {activeTab === 'export' && canExport && (
        <>
          <section className="trainings-list-card vacations-export-card">
            <div className="trainings-list-head">
              <div>
                <h3>Mapa de Férias</h3>
                <p className="vacations-company-days-subtitle">Exportação executiva com filtros rápidos, configuração avançada e seleção por colaborador.</p>
              </div>
            </div>

            <div className="vacations-export-compact-bar">
              <div className="vacations-export-compact-bar__summary">
                <Badge tone="info">Período: {exportPeriodSummary}</Badge>
                <Badge tone={exportSelectedCollaborators.length > 0 ? 'success' : 'neutral'}>
                  {exportSelectedCollaborators.length > 0 ? `${exportSelectedCollaborators.length} colaborador(es)` : 'Todos os colaboradores'}
                </Badge>
                <Badge tone={exportTeamId ? 'warning' : 'neutral'}>
                  {exportTeamId ? 'Equipa filtrada' : 'Sem filtro de equipa'}
                </Badge>
              </div>
              <div className="vacations-export-compact-bar__actions">
                <Button type="button" variant="ghost" size="sm" onClick={() => setIsExportAdvancedOpen((value) => !value)}>
                  {isExportAdvancedOpen ? 'Ocultar filtros' : 'Filtros avançados'}
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={() => setIsExportCollaboratorsOpen((value) => !value)}>
                  {isExportCollaboratorsOpen ? 'Ocultar colaboradores' : 'Selecionar colaboradores'}
                </Button>
                <Button type="button" variant="primary" isLoading={isExporting} onClick={() => void triggerExportWorkbook()}>
                  Exportar Excel
                </Button>
              </div>
            </div>

            {isExportAdvancedOpen && (
              <div className="vacations-export-form">
              <label className="vacations-export-form__field">
                <span>Tipo de período</span>
                <select value={exportRangeMode} onChange={(e) => setExportRangeMode(e.target.value as 'year' | 'custom')}>
                  <option value="year">Ano completo</option>
                  <option value="custom">Período personalizado</option>
                </select>
              </label>

              <label className="vacations-export-form__field">
                <span>Ano</span>
                <select value={exportYear} onChange={(e) => setExportYear(Number(e.target.value))} disabled={exportRangeMode === 'custom'}>
                  {Array.from({ length: 6 }, (_, i) => new Date().getFullYear() - 2 + i).map((y) => (
                    <option key={y} value={y}>{y}</option>
                  ))}
                </select>
              </label>

              <label className="vacations-export-form__field">
                <span>Data início</span>
                <input
                  type="date"
                  value={exportStartDate}
                  onChange={(e) => {
                    setExportRangeMode('custom');
                    setExportStartDate(e.target.value);
                  }}
                />
              </label>

              <label className="vacations-export-form__field">
                <span>Data fim</span>
                <input
                  type="date"
                  value={exportEndDate}
                  onChange={(e) => {
                    setExportRangeMode('custom');
                    setExportEndDate(e.target.value);
                  }}
                />
              </label>

              <label className="vacations-export-form__field">
                <span>Filtrar por equipa</span>
                <select value={exportTeamId} onChange={(e) => setExportTeamId(e.target.value)}>
                  <option value="">Todas as equipas</option>
                  {exportTeams.map((t) => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
              </label>

              <div className="vacations-export-form__presets" role="group" aria-label="Presets de período">
                <button
                  type="button"
                  className="vacations-export-preset-btn"
                  onClick={() => {
                    const currentYear = new Date().getFullYear();
                    setExportRangeMode('custom');
                    setExportStartDate(`${currentYear}-01-01`);
                    setExportEndDate(`${currentYear}-12-31`);
                  }}
                >
                  Ano atual
                </button>
                <button
                  type="button"
                  className="vacations-export-preset-btn"
                  onClick={() => {
                    const today = new Date();
                    const quarter = Math.floor(today.getMonth() / 3);
                    const quarterStart = new Date(today.getFullYear(), quarter * 3, 1);
                    const quarterEnd = new Date(today.getFullYear(), quarter * 3 + 3, 0);
                    setExportRangeMode('custom');
                    setExportStartDate(toIsoDate(quarterStart));
                    setExportEndDate(toIsoDate(quarterEnd));
                  }}
                >
                  Trimestre atual
                </button>
                <button
                  type="button"
                  className="vacations-export-preset-btn"
                  onClick={() => {
                    const today = new Date();
                    const start = new Date(today);
                    start.setDate(today.getDate() - 89);
                    setExportRangeMode('custom');
                    setExportStartDate(toIsoDate(start));
                    setExportEndDate(toIsoDate(today));
                  }}
                >
                  Últimos 90 dias
                </button>
              </div>

              <div className="vacations-export-form__action">
                <span>&#8203;</span>
                <Button type="button" variant="primary" isLoading={isExporting} onClick={() => void triggerExportWorkbook()}>
                  ↓ Exportar Excel (.xlsx)
                </Button>
              </div>
              </div>
            )}

            {isExportCollaboratorsOpen && (
              <div className="vacations-export-collaborators">
              <div className="vacations-export-collaborators__head">
                <div>
                  <h4>Exportar por colaborador</h4>
                  <p>Seleciona um ou vários colaboradores. Se não selecionares ninguém, o ficheiro inclui todos dentro do filtro atual.</p>
                </div>
                <Badge tone={exportSelectedCollaborators.length > 0 ? 'info' : 'neutral'}>
                  {exportSelectedCollaborators.length > 0 ? `${exportSelectedCollaborators.length} selecionado(s)` : 'Todos os colaboradores'}
                </Badge>
              </div>

              <div className="vacations-export-collaborators__controls">
                <label className="vacations-export-form__field vacations-export-collaborators__search">
                  <span>Pesquisar colaborador</span>
                  <input
                    type="text"
                    value={exportCollaboratorSearch}
                    onChange={(e) => setExportCollaboratorSearch(e.target.value)}
                    placeholder="Nome, username ou email..."
                  />
                </label>
                <div className="vacations-export-collaborators__actions">
                  <Button type="button" variant="ghost" size="sm" onClick={() => setExportSelectedCollaborators([])}>
                    Limpar seleção
                  </Button>
                </div>
              </div>

              {exportSelectedCollaborators.length > 0 && (
                <div className="vacations-export-selected-chips">
                  {exportSelectedCollaborators.map((item) => {
                    const label = item.profile?.nomeAbreviado || item.profile?.nomeCompleto || item.username;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        className="vacations-export-selected-chip"
                        onClick={() => removeExportCollaborator(item.id)}
                        title="Remover da exportação"
                      >
                        <span>{label}</span>
                        <small>{item.username}</small>
                        <strong>×</strong>
                      </button>
                    );
                  })}
                </div>
              )}

              <div className="vacations-export-collaborators__results rh-collaborator-results">
                {isLoadingExportCandidates ? (
                  <p>A carregar colaboradores...</p>
                ) : exportCandidates.length === 0 ? (
                  <p>Sem colaboradores para os filtros atuais.</p>
                ) : (
                  exportCandidates.map((item) => {
                    const isSelected = exportSelectedCollaborators.some((selected) => selected.id === item.id);
                    const label = item.profile?.nomeAbreviado || item.profile?.nomeCompleto || item.username;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        className={`rh-collaborator-result ${isSelected ? 'vacations-export-collaborator-result--selected' : ''}`}
                        onClick={() => toggleExportCollaborator(item)}
                      >
                        <strong>{label}</strong>
                        <span>{item.username}</span>
                        <small>{item.team?.name || 'Sem equipa'}</small>
                      </button>
                    );
                  })
                )}
              </div>
              </div>
            )}

            <div className="vacations-export-info">
              <p>Configura o período livremente por data inicial/final, equipa e seleção de colaboradores para gerar uma visão totalmente contextual.</p>
              <p>O ficheiro inclui aba de visão executiva, resumo detalhado, detalhe de pedidos e parâmetros para rastreabilidade.</p>
            </div>
          </section>

          <section className="trainings-list-card vacations-direct-card">
            <div className="trainings-list-head">
              <div>
                <h3>Crédito de Saldo de Férias</h3>
                <p className="vacations-company-days-subtitle">Acesso total pode creditar dias adicionais no saldo anual de colaboradores elegíveis, com motivo obrigatório.</p>
              </div>
            </div>

            <div className="vacations-direct-grid">
              <label className="vacations-export-form__field">
                <span>Equipa</span>
                <select value={assignFilterTeamId} onChange={(e) => setAssignFilterTeamId(e.target.value)}>
                  <option value="">Todas as equipas</option>
                  {exportTeams.map((t) => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
              </label>

              <label className="vacations-export-form__field vacations-direct-field--grow">
                <span>Pesquisar colaborador</span>
                <input
                  type="text"
                  value={assignSearch}
                  onChange={(e) => setAssignSearch(e.target.value)}
                  placeholder="Escreve nome, username ou email..."
                />
              </label>

              <div className="vacations-direct-field--full rh-collaborator-picker">
                <span>Resultados</span>
                <div className="rh-collaborator-results">
                  {isLoadingAssignCandidates ? (
                    <p>A carregar colaboradores...</p>
                  ) : assignCandidates.length === 0 ? (
                    <p>Sem colaboradores elegíveis para crédito de saldo com os filtros atuais.</p>
                  ) : (
                    assignCandidates.map((item) => {
                      const isSelected = item.id === assignSelectedUserId;
                      return (
                        <button
                          key={item.id}
                          type="button"
                          className="rh-collaborator-result"
                          onClick={() => setAssignSelectedUserId(item.id)}
                          style={isSelected ? { borderColor: '#6da5f1', background: '#eef5ff' } : undefined}
                        >
                          <strong>{item.profile?.nomeAbreviado || item.profile?.nomeCompleto || item.username}</strong>
                          <span>{item.username}</span>
                          <small>
                            {item.team?.name ? `${item.team.name} • ` : ''}
                            {item.profile?.nomeCompleto || 'Sem nome completo'}
                          </small>
                        </button>
                      );
                    })
                  )}
                </div>
              </div>

              {selectedAssignCandidate && (
                <div className="vacations-direct-field--full rh-selected-collaborator">
                  <strong>Selecionado: {selectedAssignCandidate.profile?.nomeAbreviado || selectedAssignCandidate.profile?.nomeCompleto || selectedAssignCandidate.username}</strong>
                  <span>
                    {selectedAssignCandidate.username}
                    {selectedAssignCandidate.team?.name ? ` • ${selectedAssignCandidate.team.name}` : ''}
                  </span>
                </div>
              )}

              <label className="vacations-export-form__field">
                <span>Dias a creditar</span>
                <input type="number" min={1} step={1} value={assignCreditDays} onChange={(e) => setAssignCreditDays(e.target.value)} />
              </label>

              <label className="vacations-export-form__field">
                <span>Ano de referência</span>
                <input type="number" min={2000} max={2100} step={1} value={assignCreditYear} onChange={(e) => setAssignCreditYear(e.target.value)} />
              </label>

              <label className="vacations-export-form__field vacations-direct-field--full">
                <span>Motivo *</span>
                <input
                  type="text"
                  value={assignCreditReason}
                  onChange={(e) => setAssignCreditReason(e.target.value)}
                  placeholder="Ex.: Crédito extraordinário aprovado pela direção"
                />
              </label>

              <div className="vacations-direct-action-row">
                <Button type="button" variant="primary" isLoading={isCreditingVacationBalance} onClick={() => void creditVacationBalance()}>
                  Creditar dias no saldo
                </Button>
              </div>
            </div>
          </section>
        </>
      )}

      <div className="vacations-toast" aria-live="polite">
        <Toast
          show={toast.visible}
          tone={toast.tone}
          title={toast.title}
          message={toast.message}
          details={toast.details}
          highlight={toast.highlight}
          onClose={() => {
            if (toastTimeoutRef.current !== null) {
              window.clearTimeout(toastTimeoutRef.current);
              toastTimeoutRef.current = null;
            }
            setToast((current) => ({ ...current, visible: false }));
          }}
        />
      </div>
    </section>
  );
}
