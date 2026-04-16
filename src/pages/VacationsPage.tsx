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
    monthsWorked: number;
    acquisitionComplete: boolean;
    unjustifiedAbsences: number;
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
  requests: VacationRecord[];
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

type Subtab = 'overview' | 'calendar' | 'requests';

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
  const { profile, hasPermission, isRootAccess, refreshNotifications } = usePortal();

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
  const [toast, setToast] = useState<{ tone: 'success' | 'error' | 'info'; message: string; visible: boolean }>({
    tone: 'info',
    message: '',
    visible: false,
  });
  const [teamContexts, setTeamContexts] = useState<TeamContext[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
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
      entitlement: overview?.country === 'BR'
        ? overview.calculation?.entitledDays ?? 0
        : 22,
    };
  }, [overview, sortedRecords]);

  const remainingVacationDays = Math.max(overviewStats.entitlement - overviewStats.approvedVacationDays, 0);
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
      if (!cacheRef.current.recordsLoaded) {
        cacheRef.current.recordsLoaded = true;
        await loadMine(controller.signal);
      }

      await loadTeamContexts(controller.signal);
    })();

    return () => {
      controller.abort();
    };
  }, []);

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
      return data;
    } catch (error) {
      if (!isAbortError(error) && !signal?.aborted) {
        setCalendarError(error instanceof Error ? error.message : 'Falha ao carregar calendário de férias.');
      }
      throw error;
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
  }

  function handleRequestKindChange(value: RequestKind) {
    setDraft((current) => ({
      ...current,
      requestKind: value,
      absenceReason: value === 'VACATION' ? current.absenceReason : current.absenceReason,
      partialDay: value === 'VACATION' ? current.partialDay : 'FULL',
    }));
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

    const errors = buildValidationErrors(draft);
    if (Object.keys(errors).length > 0) {
      setDraftErrors(errors);
      showToast('error', 'Existem erros no formulário.');
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
      await Promise.all([loadMine(), loadOverview(), loadCalendar()]);
      void refreshNotifications();
      resetForm();
      showToast('success', editingId ? 'Pedido atualizado por versionamento com sucesso.' : 'Pedido submetido com sucesso e enviado para aprovação.');
    } catch (error) {
      showToast('error', error instanceof Error ? error.message : 'Falha ao submeter pedido.');
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
    setActiveTab('requests');
    showToast('info', 'Modo edição ativo. Ao submeter, será criada uma nova versão do pedido.');
  }

  async function handleCancelPending(id: string) {
    try {
      await apiRequest(`/vacations/${id}`, {
        method: 'DELETE',
        headers: getAuthHeaders(),
      });

      clearApiCache('/vacations');
      await Promise.all([loadMine(), loadOverview(), loadCalendar()]);
      void refreshNotifications();
      showToast('success', 'Pedido cancelado.');
    } catch (error) {
      showToast('error', error instanceof Error ? error.message : 'Falha ao cancelar pedido.');
    }
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
    if (calendarData.extraDays.includes(iso)) labels.push('Dia extra automático');
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
    return (
      <div
        key={key}
        className={`vacations-day${iso ? ` vacations-day--${getDayKind(iso)}` : ' vacations-day--blank'}`}
        title={iso ? getDayLabel(iso) : undefined}
      >
        {day ?? ''}
      </div>
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
        <button type="button" className={activeTab === 'overview' ? 'is-active' : ''} onClick={() => setActiveTab('overview')}>Resumo</button>
        <button type="button" className={activeTab === 'calendar' ? 'is-active' : ''} onClick={() => setActiveTab('calendar')}>Calendário</button>
        <button type="button" className={activeTab === 'requests' ? 'is-active' : ''} onClick={() => setActiveTab('requests')}>Os meus pedidos</button>
      </nav>

      {activeTab === 'overview' && (
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
                <span>Dias extra automáticos</span>
                <strong>{calendarData?.extraDays.length ?? 0}</strong>
                <small>Aniversário, feriados locais e outras regras.</small>
              </article>
            </div>
          )}
        </section>
      )}

      {activeTab === 'calendar' && (
        <section className="trainings-list-card">
          <div className="vacations-legend vacations-legend--sticky" aria-label="Legenda do calendário">
            <span className="vacations-legend-item"><i className="legend-swatch legend-swatch--holiday" />Feriado</span>
            <span className="vacations-legend-item"><i className="legend-swatch legend-swatch--weekend" />Fim de semana</span>
            <span className="vacations-legend-item"><i className="legend-swatch legend-swatch--absence" />Ausência pendente</span>
            <span className="vacations-legend-item"><i className="legend-swatch legend-swatch--approved-absence" />Ausência aprovada</span>
            <span className="vacations-legend-item"><i className="legend-swatch legend-swatch--pending" />Férias Pendentes</span>
            <span className="vacations-legend-item"><i className="legend-swatch legend-swatch--approved" />Férias aprovadas</span>
            <span className="vacations-legend-item"><i className="legend-swatch legend-swatch--extra" />Dia extra automático</span>
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
        </section>
      )}

      {activeTab === 'requests' && (
        <>
          <section className="trainings-form-card">
            <div className="trainings-form-head">
              <h3>{editingId ? 'Editar pedido por versionamento' : 'Novo pedido de férias/ausência'}</h3>
            </div>

            <form className="trainings-form" onSubmit={handleSubmit} noValidate>
              <label>
                <span>Tipo *</span>
                <select value={draft.requestKind} onChange={(event) => handleRequestKindChange(event.target.value as RequestKind)}>
                  <option value="VACATION">Férias</option>
                  <option value="ABSENCE">Ausência</option>
                </select>
              </label>

              {draft.requestKind === 'ABSENCE' && (
                <>
                  <label>
                    <span>Motivo *</span>
                    <select value={draft.absenceReason} onChange={(event) => handleDraftChange('absenceReason', event.target.value)}>
                      <option value="MEDICAL">Médico</option>
                      <option value="TRAINING">Formação</option>
                      <option value="OTHER">Outro</option>
                    </select>
                  </label>

                  {draft.absenceReason === 'OTHER' && (
                    <label className="field-span-2">
                      <span>Motivo manual *</span>
                      <input
                        type="text"
                        value={draft.absenceReasonText}
                        onChange={(event) => handleDraftChange('absenceReasonText', event.target.value)}
                        placeholder="Escreve o motivo da ausência"
                      />
                      {draftErrors.absenceReasonText && <small>{draftErrors.absenceReasonText}</small>}
                    </label>
                  )}
                </>
              )}

              {draft.requestKind === 'VACATION' && (
                <label>
                  <span>Duração *</span>
                  <select value={draft.partialDay} onChange={(event) => handleDraftChange('partialDay', event.target.value)}>
                    <option value="FULL">Dia completo</option>
                    <option value="AM">Meio-dia (manhã)</option>
                    <option value="PM">Meio-dia (tarde)</option>
                  </select>
                </label>
              )}

              <label>
                <span>Data de início *</span>
                <input type="date" value={draft.dataInicio} onChange={(event) => handleDraftChange('dataInicio', event.target.value)} />
                {draftErrors.dataInicio && <small>{draftErrors.dataInicio}</small>}
              </label>

              <label>
                <span>Data de fim *</span>
                <input type="date" value={draft.dataFim} onChange={(event) => handleDraftChange('dataFim', event.target.value)} />
                {draftErrors.dataFim && <small>{draftErrors.dataFim}</small>}
              </label>

              <label>
                <span>Observações</span>
                <input type="text" value={draft.observacoes} onChange={(event) => handleDraftChange('observacoes', event.target.value)} placeholder="Contexto adicional do pedido" />
              </label>

              <label>
                <span>Comprovativo (opcional)</span>
                <input type="file" accept=".pdf,.png,.jpg,.jpeg" onChange={handleAttachmentChange} />
              </label>

              <div className="trainings-form-actions field-span-2">
                <Button type="submit" variant="primary" isLoading={isSubmitting}>{editingId ? 'Guardar nova versão' : 'Enviar pedido'}</Button>
              </div>
            </form>
          </section>

          <section className="trainings-list-card">
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
        </>
      )}

      <div className="vacations-toast" aria-live="polite">
        <Toast show={toast.visible} tone={toast.tone} message={toast.message} />
      </div>
    </section>
  );
}
