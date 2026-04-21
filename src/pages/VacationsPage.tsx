import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from 'react';
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

type AbsenceReason = 'MEDICAL' | 'TRAINING' | 'OTHER';
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

type VacationOverview = {
  country: 'PT' | 'BR';
  year: number;
  rules: Record<string, unknown>;
  approvedVacationDays?: number;
  calculation?: {
    monthsWorked?: number;
    acquisitionComplete?: boolean;
    unjustifiedAbsences?: number;
    baseEntitledDays?: number;
    extraBalanceDays?: number;
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

type CompanyExtraDay = {
  date: string;
  label: string;
};

type CompanyExtraDaysPayload = {
  country: 'PT' | 'BR';
  source?: 'configured' | 'legacy';
  days: CompanyExtraDay[];
};

type VacationDraft = {
  requestKind: RequestKind;
  absenceReason: AbsenceReason;
  absenceReasonText: string;
  dataInicio: string;
  dataFim: string;
  observacoes: string;
  attachmentLink: string;
  contextTeamId: string;
  partialDay: VacationPartialDay;
};

type DraftErrors = Partial<Record<keyof VacationDraft, string>>;

type Subtab = 'overview' | 'calendar' | 'company-days' | 'export';

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
  tone: 'success' | 'error' | 'info';
  message: string;
} | null;

const EMPTY_DRAFT: VacationDraft = {
  requestKind: 'VACATION',
  absenceReason: 'MEDICAL',
  absenceReasonText: '',
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

function calculateDuration(record: Pick<VacationRecord, 'dataInicio' | 'dataFim' | 'requestType' | 'partialDay'>) {
  if (record.requestType === 'VACATION' && record.partialDay && record.partialDay !== 'FULL') {
    return 0.5;
  }

  return calculateDays(record);
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

  if (draft.requestKind === 'ABSENCE' && draft.absenceReason === 'MEDICAL') {
    const start = toLocalDate(draft.dataInicio);
    const end = toLocalDate(draft.dataFim);
    const diffMs = end.getTime() - start.getTime();
    const days = Math.floor(diffMs / (1000 * 60 * 60 * 24)) + 1;

    if (Number.isFinite(days) && days > 3) {
      errors.dataFim = 'Ausência médica SNS24 só pode ir até 3 dias.';
    }
  }

  if (draft.requestKind === 'ABSENCE' && draft.absenceReason === 'OTHER' && !draft.absenceReasonText.trim()) {
    errors.absenceReasonText = 'Indica o motivo da ausência.';
  }

  if (draft.requestKind === 'VACATION' && draft.partialDay !== 'FULL' && draft.dataInicio !== draft.dataFim) {
    errors.dataFim = 'Pedido de meio-dia deve ter início e fim no mesmo dia.';
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

function getVacationTypeLabel(requestType: VacationRequestType) {
  if (requestType === 'VACATION') {
    return 'Férias';
  }

  if (requestType === 'ABSENCE_MEDICAL') {
    return 'Ausência médica';
  }

  return 'Ausência por formação';
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
  const [isOverviewLoading, setIsOverviewLoading] = useState(false);
  const [isCalendarLoading, setIsCalendarLoading] = useState(false);
  const [overviewError, setOverviewError] = useState('');
  const [calendarError, setCalendarError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submissionNotice, setSubmissionNotice] = useState<SubmissionNotice>(null);
  const [toast, setToast] = useState<{ tone: 'success' | 'error' | 'info'; message: string; visible: boolean }>({
    tone: 'info',
    message: '',
    visible: false,
  });
  const [teamContexts, setTeamContexts] = useState<TeamContext[]>([]);
  const [companyExtraDays, setCompanyExtraDays] = useState<CompanyExtraDay[]>([]);
  const [companyExtraDayMonth, setCompanyExtraDayMonth] = useState('12');
  const [companyExtraDayDay, setCompanyExtraDayDay] = useState('25');
  const [companyExtraDayLabel, setCompanyExtraDayLabel] = useState('Dia dado pela empresa');
  const [isLoadingCompanyExtraDays, setIsLoadingCompanyExtraDays] = useState(false);
  const [isSavingCompanyExtraDays, setIsSavingCompanyExtraDays] = useState(false);
  const [companyExtraDaysSource, setCompanyExtraDaysSource] = useState<'configured' | 'legacy'>('legacy');
  const [companyExtraDaysError, setCompanyExtraDaysError] = useState('');
  const [exportYear, setExportYear] = useState(new Date().getFullYear());
  const [exportTeamId, setExportTeamId] = useState('');
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
    calendarLoaded?: boolean;
  }>({});

  const sortedRecords = useMemo(
    () => [...records].sort((a, b) => new Date(b.dataInicio).getTime() - new Date(a.dataInicio).getTime()),
    [records],
  );

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

  const allowedTabs = useMemo<Subtab[]>(() => {
    const tabs: Subtab[] = [];
    if (!isTPeople) tabs.push('overview', 'calendar');
    if (isTPeople) tabs.push('calendar');
    if (canManageVacationRules) tabs.push('company-days');
    if (canExport) tabs.push('export');
    return tabs;
  }, [canManageVacationRules, canExport, isTPeople]);

  useEffect(() => {
    if (!allowedTabs.includes(activeTab)) {
      setActiveTab(allowedTabs[0] ?? 'calendar');
    }
  }, [activeTab, allowedTabs]);

  const overviewStats = useMemo(() => {
    const approvedVacationDays = sortedRecords
      .filter((item) => item.status === 'APPROVED' && item.requestType === 'VACATION')
      .reduce((sum, item) => sum + calculateDuration(item), 0);

    const pendingVacationDays = sortedRecords
      .filter((item) => item.status === 'PENDING' && item.requestType === 'VACATION')
      .reduce((sum, item) => sum + calculateDuration(item), 0);

    const approvedAbsenceDays = sortedRecords
      .filter((item) => item.status === 'APPROVED' && item.requestType !== 'VACATION')
      .reduce((sum, item) => sum + calculateDays(item), 0);

    const pendingAbsenceDays = sortedRecords
      .filter((item) => item.status === 'PENDING' && item.requestType !== 'VACATION')
      .reduce((sum, item) => sum + calculateDays(item), 0);

    return {
      approvedVacationDays,
      pendingVacationDays,
      approvedAbsenceDays,
      pendingAbsenceDays,
      entitlement: overview?.calculation?.entitledDays ?? (overview?.country === 'BR' ? 0 : 22),
      creditedDays: overview?.calculation?.extraBalanceDays ?? 0,
    };
  }, [overview, sortedRecords]);

  const remainingVacationDays = Math.max(overviewStats.entitlement - overviewStats.approvedVacationDays, 0);
  const selectedAssignCandidate = useMemo(
    () => assignCandidates.find((item) => item.id === assignSelectedUserId) ?? null,
    [assignCandidates, assignSelectedUserId],
  );
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
        cacheRef.current.recordsLoaded = true;
        await loadMine(controller.signal);
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

    void loadCompanyExtraDays();
  }, [activeTab, canManageVacationRules]);

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
    if (activeTab !== 'calendar' || cacheRef.current.calendarLoaded) {
      return;
    }

    const controller = new AbortController();
    let disposed = false;
    setIsCalendarLoading(true);
    setCalendarError('');

    void loadCalendar(controller.signal)
      .then(() => {
        if (!controller.signal.aborted) {
          cacheRef.current.calendarLoaded = true;
        }
      })
      .catch((error) => {
        if (isAbortError(error) || controller.signal.aborted) {
          return;
        }
        cacheRef.current.calendarLoaded = false;
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
  }, [activeTab]);

  function showToast(tone: 'success' | 'error' | 'info', message: string) {
    setToast({ tone, message, visible: true });
    window.setTimeout(() => {
      setToast((current) => ({ ...current, visible: false }));
    }, 3200);
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

  async function loadCalendar(signal?: AbortSignal) {
    try {
      const year = new Date().getFullYear();
      const data = await apiRequestCached<CalendarPayload>(`/vacations/calendar?year=${year}`, {
        headers: getAuthHeaders(),
        signal,
      }, 60000);
      setCalendarData(data);
      if (canManageVacationRules && data.extraDayDetails) {
        setCompanyExtraDays(data.extraDayDetails);
      }
      return data;
    } catch (error) {
      if (!isAbortError(error) && !signal?.aborted) {
        setCalendarError(error instanceof Error ? error.message : 'Falha ao carregar calendário de férias.');
      }
      throw error;
    }
  }

  async function loadCompanyExtraDays() {
    try {
      setIsLoadingCompanyExtraDays(true);
      setCompanyExtraDaysError('');
      const payload = await apiRequest<CompanyExtraDaysPayload>('/vacations/company-extra-days', {
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
    const mmdd = `${String(monthNum).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
    const trimmedLabel = companyExtraDayLabel.trim() || 'Dia dado pela empresa';
    if (companyExtraDays.some((item) => item.date === mmdd)) {
      showToast('info', 'Esse dia já está na lista.');
      return;
    }
    const updated = [...companyExtraDays, { date: mmdd, label: trimmedLabel }].sort((a, b) => a.date.localeCompare(b.date));
    setCompanyExtraDayMonth('12');
    setCompanyExtraDayDay('25');
    setCompanyExtraDayLabel('Dia dado pela empresa');
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

  async function triggerExportWorkbook() {
    try {
      setIsExporting(true);
      const params = new URLSearchParams({ year: String(exportYear) });
      if (exportTeamId) params.set('teamId', exportTeamId);
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
      a.download = `mapa-ferias-${exportYear}.xlsx`;
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
          days: normalizedDays,
        }),
      });

      setCompanyExtraDays(payload.days ?? []);
      setCompanyExtraDaysSource('configured');
      clearApiCache('/vacations/calendar');
      clearApiCache('/vacations/overview');
      if (activeTab === 'overview' && !isTPeople) {
        void loadOverview();
      }
      void loadCalendar();
      showToast('success', 'Dias automáticos atualizados.');
    } catch (error) {
      setCompanyExtraDaysError(error instanceof Error ? error.message : 'Falha ao guardar dias automáticos da empresa.');
      showToast('error', error instanceof Error ? error.message : 'Falha ao guardar dias automáticos da empresa.');
    } finally {
      setIsSavingCompanyExtraDays(false);
    }
  }

  async function loadTeamContexts(signal?: AbortSignal) {
    try {
      const data = await apiRequestCached<TeamContext[]>('/users/me/teams', {
        headers: getAuthHeaders(),
        signal,
      }, 120000);

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
      : draft.absenceReason === 'MEDICAL'
        ? 'ABSENCE_MEDICAL'
        : 'ABSENCE_TRAINING';

    const observacoes = [
      draft.requestKind === 'VACATION' ? 'Férias' : `Ausência: ${draft.absenceReason === 'MEDICAL' ? 'Motivo médico' : draft.absenceReason === 'TRAINING' ? 'Motivo formação' : `Outro - ${draft.absenceReasonText.trim() || 'sem detalhe'}`}`,
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
      await apiRequest(editingId ? `/vacations/${editingId}` : '/vacations', {
        method: editingId ? 'PUT' : 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify(payload),
      });

      clearApiCache('/vacations');
      void loadMine();
      if (activeTab === 'overview') {
        void loadOverview();
      }
      if (activeTab === 'calendar') {
        void loadCalendar();
      }
      void refreshNotifications();
      resetForm();
      const message = editingId
        ? 'Pedido atualizado. A nova versão já foi enviada para aprovação.'
        : 'Pedido submetido. O histórico e os painéis vão atualizar em segundo plano.';
      setSubmissionNotice({ tone: 'success', message });
      showToast('success', message);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Falha ao submeter pedido.';
      setSubmissionNotice({ tone: 'error', message });
      showToast('error', message);
    } finally {
      setIsSubmitting(false);
    }
  }

  function startEdit(record: VacationRecord) {
    const inferredKind: RequestKind = record.requestType === 'VACATION' ? 'VACATION' : 'ABSENCE';
    const inferredAbsenceReason: AbsenceReason =
      record.requestType === 'ABSENCE_MEDICAL'
        ? 'MEDICAL'
        : record.requestType === 'ABSENCE_TRAINING'
          ? 'TRAINING'
          : 'OTHER';

    setEditingId(record.id);
    setDraft({
      requestKind: inferredKind,
      absenceReason: inferredAbsenceReason,
      absenceReasonText: '',
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
    setActiveTab('calendar');
    showToast('info', 'Modo edição ativo. Ao submeter, será criada uma nova versão do pedido.');
  }

  async function handleCancelPending(id: string) {
    try {
      await apiRequest(`/vacations/${id}`, {
        method: 'DELETE',
        headers: getAuthHeaders(),
      });

      clearApiCache('/vacations');
      void loadMine();
      if (activeTab === 'overview') {
        void loadOverview();
      }
      if (activeTab === 'calendar') {
        void loadCalendar();
      }
      void refreshNotifications();
      showToast('success', 'Pedido cancelado.');
    } catch (error) {
      showToast('error', error instanceof Error ? error.message : 'Falha ao cancelar pedido.');
    }
  }

  function handleDayClick(iso: string) {
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

    const rangeClass = !isTPeople ? getDayRangeClass(iso) : '';
    const isAnchorDay = iso === selectionAnchor;

    return (
      <button
        type="button"
        key={key}
        className={`vacations-day vacations-day--${getDayKind(iso)}${rangeClass}${isAnchorDay ? ' cal-day-anchor' : ''}`}
        title={getDayLabel(iso)}
        onClick={() => !isTPeople && handleDayClick(iso)}
        onMouseEnter={() => !isTPeople && handleDayMouseEnter(iso)}
      >
        {day}
      </button>
    );
  }

  return (
    <section className="trainings-shell vacations-shell">
      <header className="trainings-hero">
        <div>
          <p className="hero-kicker">Férias</p>
          <h2>Gestão anual de férias e ausências</h2>
        </div>

        

    
      </header>

      <nav className="rh-tabs">
        {allowedTabs.includes('overview') && (
          <button type="button" className={activeTab === 'overview' ? 'is-active' : ''} onClick={() => setActiveTab('overview')}>Resumo</button>
        )}
        {allowedTabs.includes('calendar') && (
          <button type="button" className={activeTab === 'calendar' ? 'is-active' : ''} onClick={() => setActiveTab('calendar')}>Calendário</button>
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
                  <span>Dias extra creditados</span>
                  <strong>{overviewStats.creditedDays.toLocaleString('pt-PT')} dias</strong>
                  <small>Créditos adicionais aplicados ao saldo anual.</small>
                </article>
                <article>
                  <span>Já gastaste</span>
                  <strong>{overviewStats.approvedVacationDays.toLocaleString('pt-PT')} dias</strong>
                  <small>Pedidos de férias já aprovados.</small>
                </article>
                <article>
                  <span>Tem para gastar</span>
                  <strong>{remainingVacationDays.toLocaleString('pt-PT')} dias</strong>
                  <small>Saldo ainda disponível.</small>
                </article>
                <article>
                  <span>Pedidos pendentes</span>
                  <strong>{overviewStats.pendingVacationDays.toLocaleString('pt-PT')} dias</strong>
                  <small>Férias à espera de aprovação.</small>
                </article>
                <article>
                  <span>Ausências aprovadas</span>
                  <strong>{overviewStats.approvedAbsenceDays.toLocaleString('pt-PT')} dias</strong>
                  <small>Ausências já aprovadas.</small>
                </article>
                <article>
                  <span>Dias dados pela empresa</span>
                  <strong>{companyExtraDays.length}</strong>
                  <small>Configuração automática anual da empresa.</small>
                </article>
              </div>

            </>
          )}
        </section>
      )}

      {activeTab === 'calendar' && (
        <section
          className="trainings-list-card vacations-calendar-integrated"
          onMouseLeave={() => selectionAnchor !== null && setHoverDay(selectionAnchor)}
        >
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
                  cacheRef.current.calendarLoaded = false;
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
                  <div className="cal-booking-bar__range">
                    <span className="cal-booking-bar__range-icon">📅</span>
                    <div className="cal-booking-bar__range-dates">
                      <strong>
                        {draft.dataInicio === draft.dataFim
                          ? formatShortDate(draft.dataInicio)
                          : `${formatShortDate(draft.dataInicio)} → ${formatShortDate(draft.dataFim)}`}
                      </strong>
                      <small>
                        {calculateDays({ dataInicio: draft.dataInicio, dataFim: draft.dataFim })} {calculateDays({ dataInicio: draft.dataInicio, dataFim: draft.dataFim }) === 1 ? 'dia' : 'dias'}
                        {editingId ? ' · Editando pedido' : ''}
                      </small>
                    </div>
                    <button type="button" className="cal-booking-bar__reselect" title="Alterar intervalo" onClick={() => {
                      setSelectionAnchor(draft.dataInicio);
                      setHoverDay(draft.dataFim);
                    }}>
                      ✎
                    </button>
                  </div>

                  <div className="cal-booking-bar__fields">
                    <label className="cal-booking-bar__field">
                      <span>Tipo</span>
                      <select value={draft.requestKind} onChange={(e) => handleRequestKindChange(e.target.value as RequestKind)}>
                        <option value="VACATION">Férias</option>
                        <option value="ABSENCE">Ausência</option>
                      </select>
                    </label>

                    {draft.requestKind === 'ABSENCE' ? (
                      <>
                        <label className="cal-booking-bar__field">
                          <span>Motivo</span>
                          <select value={draft.absenceReason} onChange={(e) => handleDraftChange('absenceReason', e.target.value)}>
                            <option value="MEDICAL">Médico</option>
                            <option value="TRAINING">Formação</option>
                            <option value="OTHER">Outro</option>
                          </select>
                        </label>
                        {draft.absenceReason === 'OTHER' && (
                          <label className="cal-booking-bar__field cal-booking-bar__field--grow">
                            <span>Detalhe *</span>
                            <input type="text" value={draft.absenceReasonText} onChange={(e) => handleDraftChange('absenceReasonText', e.target.value)} placeholder="Motivo da ausência" />
                            {draftErrors.absenceReasonText && <small className="cal-booking-bar__err">{draftErrors.absenceReasonText}</small>}
                          </label>
                        )}
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
                  {submissionNotice && (
                    <div className={`cal-booking-bar__notice cal-booking-bar__notice--${submissionNotice.tone}`}>
                      {submissionNotice.message}
                    </div>
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
            <section className="vacations-history-card" aria-label="Histórico de pedidos">
              <div className="trainings-list-head">
                <h3>Histórico de pedidos</h3>
              </div>

              <div className="trainings-table-wrap">
                <table className="trainings-table" aria-label="Lista de pedidos">
                  <thead>
                    <tr>
                      <th>Pedido</th>
                      <th>Período</th>
                      <th>Dias</th>
                      <th>Equipa</th>
                      <th>Estado</th>
                      <th>Resumo</th>
                      <th>Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedRecords.length === 0 && (
                      <tr>
                        <td colSpan={7}>Sem pedidos submetidos.</td>
                      </tr>
                    )}
                    {sortedRecords.map((record) => (
                      <tr key={record.id} className={`vacation-history-row vacation-history-row--${record.status.toLowerCase()}`}>
                        <td>
                          <strong>{getVacationTypeLabel(record.requestType)}{getPartialDayLabel(record.partialDay)}</strong>
                        </td>
                        <td>{formatShortDate(record.dataInicio)} - {formatShortDate(record.dataFim)}</td>
                        <td>{calculateDuration(record)}</td>
                        <td>{record.contextTeam?.name || '-'}</td>
                        <td>
                          <Badge tone={getVacationStatusTone(record.status) === 'approved' ? 'success' : getVacationStatusTone(record.status) === 'pending' ? 'warning' : getVacationStatusTone(record.status) === 'rejected' ? 'danger' : 'neutral'}>
                            {formatVacationStatusLabel(record.status)}
                          </Badge>
                        </td>
                        <td>{record.observacoes || 'Sem observações'} · V{record.versionNumber || 1}</td>
                        <td>
                          {record.status === 'PENDING' || record.status === 'APPROVED' ? (
                            <div className="trainings-row-actions">
                              <button type="button" onClick={() => startEdit(record)}>Editar</button>
                              {record.status === 'PENDING' && <button type="button" onClick={() => void handleCancelPending(record.id)}>Anular</button>}
                            </div>
                          ) : (
                            '-'
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </section>
      )}

      {activeTab === 'company-days' && canManageVacationRules && (
        <section className="trainings-list-card vacations-company-days-card">
          <div className="trainings-list-head">
            <div>
              <h3>Dias automáticos da empresa</h3>
              <p className="vacations-company-days-subtitle">
                Dias extra dados pela empresa que aparecem no calendário de todos os colaboradores.
                Aplicados a todos os anos automaticamente.
              </p>
            </div>
            {companyExtraDaysSource === 'legacy' && (
              <span className="vacations-company-days-badge vacations-company-days-badge--legacy">Padrão antigo</span>
            )}
            {companyExtraDaysSource === 'configured' && (
              <span className="vacations-company-days-badge vacations-company-days-badge--custom">Configurado</span>
            )}
          </div>

          {isLoadingCompanyExtraDays ? (
            <div className="vacations-panel-state"><p>A carregar...</p></div>
          ) : (
            <>
              <div className="vacations-company-days-add-row">
                <label className="vacations-company-days-add-field">
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

                <label className="vacations-company-days-add-field vacations-company-days-add-field--narrow">
                  <span>Dia</span>
                  <select value={companyExtraDayDay} onChange={(e) => setCompanyExtraDayDay(e.target.value)}>
                    {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                      <option key={d} value={String(d).padStart(2, '0')}>{d}</option>
                    ))}
                  </select>
                </label>

                <label className="vacations-company-days-add-field vacations-company-days-add-field--grow">
                  <span>Etiqueta</span>
                  <input
                    type="text"
                    value={companyExtraDayLabel}
                    onChange={(e) => setCompanyExtraDayLabel(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void addCompanyExtraDay(); } }}
                    placeholder="Ex.: Encerramento de Natal"
                  />
                </label>

                <div className="vacations-company-days-add-btn">
                  <span className="vacations-company-days-add-btn__spacer">&#8203;</span>
                  <Button type="button" variant="primary" isLoading={isSavingCompanyExtraDays} onClick={() => void addCompanyExtraDay()}>
                    + Adicionar
                  </Button>
                </div>
              </div>

              {companyExtraDaysError && (
                <div className="vacations-panel-state vacations-panel-state--error">
                  <p>{companyExtraDaysError}</p>
                </div>
              )}

              {companyExtraDays.length === 0 ? (
                <p className="vacations-company-days-empty">Sem dias configurados. Adiciona o primeiro acima.</p>
              ) : (
                <ul className="vacations-company-days-chips">
                  {companyExtraDays.map((item) => {
                    const [mm, dd] = item.date.split('-');
                    return (
                      <li key={item.date} className="vacations-company-days-chip">
                        <span className="vacations-company-days-chip__date">{dd}/{mm}</span>
                        <span className="vacations-company-days-chip__label">{item.label}</span>
                        <button
                          type="button"
                          className="vacations-company-days-chip__remove"
                          title="Remover dia"
                          disabled={isSavingCompanyExtraDays}
                          onClick={() => void removeCompanyExtraDay(item.date)}
                        >
                          ×
                        </button>
                      </li>
                    );
                  })}
                </ul>
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
                <p className="vacations-company-days-subtitle">Exporta um Excel formatado com resumo anual por colaborador, períodos e totais.</p>
              </div>
            </div>

            <div className="vacations-export-form">
              <label className="vacations-export-form__field">
                <span>Ano</span>
                <select value={exportYear} onChange={(e) => setExportYear(Number(e.target.value))}>
                  {Array.from({ length: 6 }, (_, i) => new Date().getFullYear() - 2 + i).map((y) => (
                    <option key={y} value={y}>{y}</option>
                  ))}
                </select>
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

              <div className="vacations-export-form__action">
                <span>&#8203;</span>
                <Button type="button" variant="primary" isLoading={isExporting} onClick={() => void triggerExportWorkbook()}>
                  ↓ Exportar Excel (.xlsx)
                </Button>
              </div>
            </div>

            <div className="vacations-export-info">
              <p>Incluído no ficheiro: nome, equipa, país, dias atribuídos, dias extra creditados, dias gastos, saldo e períodos aprovados.</p>
              <p>Podes filtrar por equipa antes de exportar para arquivar histórico por contexto.</p>
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
        <Toast show={toast.visible} tone={toast.tone} message={toast.message} />
      </div>
    </section>
  );
}
