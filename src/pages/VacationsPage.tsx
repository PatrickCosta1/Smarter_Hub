import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { apiRequest, apiRequestCached, authHeaders, clearApiCache, getApiBase } from '../portal/api';
import { usePortal } from '../portal/context';

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

type Subtab = 'overview' | 'calendar' | 'requests' | 'approvals';

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

function getPartialDayLabel(partialDay?: VacationPartialDay) {
  if (partialDay === 'AM') return ' (meio-dia manhã)';
  if (partialDay === 'PM') return ' (meio-dia tarde)';
  return '';
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
  const { userRole, profile } = usePortal();
  const canApprove = userRole === 'admin' || userRole === 'manager' || userRole === 'coordenador';

  const [activeTab, setActiveTab] = useState<Subtab>('overview');
  const [draft, setDraft] = useState<VacationDraft>(EMPTY_DRAFT);
  const [draftErrors, setDraftErrors] = useState<DraftErrors>({});
  const [records, setRecords] = useState<VacationRecord[]>([]);
  const [approvalQueue, setApprovalQueue] = useState<VacationRecord[]>([]);
  const [overview, setOverview] = useState<VacationOverview | null>(null);
  const [calendarData, setCalendarData] = useState<CalendarPayload | null>(null);
  const [status, setStatus] = useState('');
  const [teamContexts, setTeamContexts] = useState<TeamContext[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Cache keys to prevent duplicate requests
  const cacheRef = useRef<{
    recordsLoaded?: boolean;
    overviewLoaded?: boolean;
    calendarLoaded?: boolean;
    approvalQueueLoaded?: boolean;
  }>({});

  const sortedRecords = useMemo(
    () => [...records].sort((a, b) => new Date(b.dataInicio).getTime() - new Date(a.dataInicio).getTime()),
    [records],
  );

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
  const totalVacationDays = overviewStats.approvedVacationDays + overviewStats.pendingVacationDays;
  const showApprovalsTab = canApprove;
  const roleNoun = userRole === 'admin' ? 'administração' : userRole === 'coordenador' ? 'coordenação' : userRole === 'manager' ? 'gestão' : 'colaborador';

  const yearMonths = useMemo(() => {
    const year = calendarData?.year ?? new Date().getFullYear();
    return MONTHS.map((month, monthIndex) => ({
      month,
      monthIndex,
      cells: buildMonthGrid(year, monthIndex),
    }));
  }, [calendarData]);

  useEffect(() => {
    // Load overview and calendar only once
    if (!cacheRef.current.overviewLoaded) {
      cacheRef.current.overviewLoaded = true;
      void loadOverview();
    }
    if (!cacheRef.current.calendarLoaded) {
      cacheRef.current.calendarLoaded = true;
      void loadCalendar();
    }
    if (!cacheRef.current.recordsLoaded) {
      cacheRef.current.recordsLoaded = true;
      void loadMine();
    }
    if (canApprove && !cacheRef.current.approvalQueueLoaded) {
      cacheRef.current.approvalQueueLoaded = true;
      void loadApprovalQueue();
    }
    void loadTeamContexts();
  }, [canApprove]);

  async function loadMine() {
    const data = await apiRequestCached<VacationRecord[]>('/vacations/me', {
      headers: getAuthHeaders(),
    }, 10000);
    setRecords(data);
  }

  async function loadOverview() {
    const data = await apiRequestCached<VacationOverview>('/vacations/overview', {
      headers: getAuthHeaders(),
    }, 20000);
    setOverview(data);
  }

  async function loadCalendar() {
    const year = new Date().getFullYear();
    const data = await apiRequestCached<CalendarPayload>(`/vacations/calendar?year=${year}`, {
      headers: getAuthHeaders(),
    }, 20000);
    setCalendarData(data);
  }

  async function loadApprovalQueue() {
    const data = await apiRequestCached<VacationRecord[]>('/vacations/requests', {
      headers: getAuthHeaders(),
    }, 10000);
    setApprovalQueue(data);
  }

  async function loadTeamContexts() {
    const data = await apiRequestCached<TeamContext[]>('/users/me/teams', {
      headers: getAuthHeaders(),
    }, 30000);

    setTeamContexts(data);
    setDraft((current) => ({
      ...current,
      contextTeamId: current.contextTeamId || data.find((item) => item.isPrimary)?.teamId || data[0]?.teamId || '',
    }));
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

    setStatus('A carregar comprovativo...');

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
      setStatus('Comprovativo associado ao pedido.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Falha ao carregar comprovativo.');
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const errors = buildValidationErrors(draft);
    if (Object.keys(errors).length > 0) {
      setDraftErrors(errors);
      setStatus('Existem erros no formulário.');
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
      contextTeamId: draft.contextTeamId || undefined,
      partialDay: requestType === 'VACATION' ? draft.partialDay : 'FULL',
    };

    try {
      await apiRequest(editingId ? `/vacations/${editingId}` : '/vacations', {
        method: editingId ? 'PUT' : 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify(payload),
      });

      clearApiCache('/vacations');
      await Promise.all([loadMine(), loadOverview(), loadCalendar()]);
      resetForm();
      setStatus(editingId ? 'Pedido atualizado por versionamento com sucesso.' : 'Pedido submetido com sucesso.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Falha ao submeter pedido.');
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
    setStatus('Modo edição ativo. Ao submeter, será criada uma nova versão do pedido.');
  }

  async function handleCancelPending(id: string) {
    try {
      await apiRequest(`/vacations/${id}`, {
        method: 'DELETE',
        headers: getAuthHeaders(),
      });

      clearApiCache('/vacations');
      await Promise.all([loadMine(), loadOverview(), loadCalendar()]);
      setStatus('Pedido cancelado.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Falha ao cancelar pedido.');
    }
  }

  async function reviewRequest(id: string, action: 'approve' | 'reject') {
    try {
      await apiRequest(`/vacations/${id}/${action}`, {
        method: 'POST',
        headers: getAuthHeaders(),
      });
      clearApiCache('/vacations');
      await loadApprovalQueue();
      setStatus(action === 'approve' ? 'Pedido aprovado.' : 'Pedido recusado.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Falha ao rever pedido.');
    }
  }

  function getDayKind(iso: string) {
    if (!calendarData) {
      return 'normal';
    }

    if (calendarData.extraDays.includes(iso)) return 'extra';
    if (calendarData.approvedDays.includes(iso)) return 'approved';
    if (calendarData.pendingDays.includes(iso)) return 'pending';
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
    if (calendarData.approvedDays.includes(iso)) labels.push('Férias aprovadas');
    if (calendarData.pendingDays.includes(iso)) labels.push('Pedido pendente');
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
          <p>Painel preparado para perfil de {roleNoun}, com contexto por equipa/subequipa e aprovação em cadeia.</p>
        </div>

    
      </header>

      <nav className="rh-tabs">
        <button type="button" className={activeTab === 'overview' ? 'is-active' : ''} onClick={() => setActiveTab('overview')}>Resumo</button>
        <button type="button" className={activeTab === 'calendar' ? 'is-active' : ''} onClick={() => setActiveTab('calendar')}>Calendário</button>
        <button type="button" className={activeTab === 'requests' ? 'is-active' : ''} onClick={() => setActiveTab('requests')}>Os meus pedidos</button>
        {showApprovalsTab && (
          <button type="button" className={activeTab === 'approvals' ? 'is-active' : ''} onClick={() => setActiveTab('approvals')}>
            Fila de aprovação ({approvalQueue.length})
          </button>
        )}
      </nav>

      {activeTab === 'overview' && overview && (
        <section className="trainings-list-card">
          <div className="trainings-list-head">
            <h3>Resumo anual</h3>
          </div>

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
              <small>Ausências médicas, de formação ou outras já tratadas.</small>
            </article>
            <article>
              <span>Dias extra automáticos</span>
              <strong>{calendarData?.extraDays.length ?? 0}</strong>
              <small>Aniversário, feriados locais e outras regras.</small>
            </article>
          </div>
        </section>
      )}

      {activeTab === 'calendar' && calendarData && (
        <section className="trainings-list-card">
          <div className="vacations-legend" aria-label="Legenda do calendário">
            <span className="vacations-legend-item"><i className="legend-swatch legend-swatch--holiday" />Feriado</span>
            <span className="vacations-legend-item"><i className="legend-swatch legend-swatch--weekend" />Fim de semana</span>
            <span className="vacations-legend-item"><i className="legend-swatch legend-swatch--absence" />Ausência</span>
            <span className="vacations-legend-item"><i className="legend-swatch legend-swatch--pending" />Pedido pendente</span>
            <span className="vacations-legend-item"><i className="legend-swatch legend-swatch--approved" />Férias aprovadas</span>
            <span className="vacations-legend-item"><i className="legend-swatch legend-swatch--extra" />Dia extra automático</span>
          </div>

          <div className="vacations-year-grid">
            {yearMonths.map((month) => (
              <article key={month.month} className="vacations-month-card">
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

              <label>
                <span>Equipa/Subequipa *</span>
                <select value={draft.contextTeamId} onChange={(event) => handleDraftChange('contextTeamId', event.target.value)}>
                  <option value="">Selecionar equipa</option>
                  {teamContexts.map((team) => (
                    <option key={team.teamId} value={team.teamId}>
                      {team.teamName}{team.isPrimary ? ' (principal)' : ''}
                    </option>
                  ))}
                </select>
              </label>

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

              <label>
                <span>Link do comprovativo</span>
                <input type="text" value={draft.attachmentLink} onChange={(event) => handleDraftChange('attachmentLink', event.target.value)} placeholder="/uploads/... ou https://..." />
              </label>

              <div className="trainings-form-actions field-span-2">
                <button className="cta-button cta-primary" type="submit">{editingId ? 'Guardar nova versão' : 'Enviar pedido'}</button>
                <button className="cta-button cta-ghost" type="button" onClick={resetForm}>{editingId ? 'Cancelar edição' : 'Limpar'}</button>
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
                    <th>Tipo</th>
                    <th>Motivo</th>
                    <th>Início</th>
                    <th>Fim</th>
                    <th>Dias</th>
                    <th>Estado</th>
                    <th>Equipa</th>
                    <th>Versão</th>
                    <th>Observações</th>
                    <th>Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedRecords.length === 0 && (
                    <tr>
                      <td colSpan={10}>Sem pedidos submetidos.</td>
                    </tr>
                  )}
                  {sortedRecords.map((record) => (
                    <tr key={record.id}>
                      <td>{getVacationTypeLabel(record.requestType)}{getPartialDayLabel(record.partialDay)}</td>
                      <td>{record.requestType === 'VACATION' ? '-' : record.observacoes || 'Ausência'}</td>
                      <td>{record.dataInicio}</td>
                      <td>{record.dataFim}</td>
                      <td>{calculateDuration(record)}</td>
                      <td>{record.status}</td>
                      <td>{record.contextTeam?.name || '-'}</td>
                      <td>{record.versionNumber || 1}</td>
                      <td>{record.observacoes || '-'}</td>
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

      {activeTab === 'approvals' && canApprove && (
        <section className="trainings-list-card">
          <div className="trainings-list-head">
            <h3>Fila de pedidos pendentes</h3>
          </div>

          <div className="trainings-mobile-list" style={{ display: 'grid' }}>
            {approvalQueue.length === 0 && <article className="trainings-mobile-card">Sem pedidos pendentes para o teu nível de aprovação.</article>}

            {approvalQueue.map((item) => (
              <article key={item.id} className="trainings-mobile-card">
                <header>
                  <h4>{item.user?.username || '-'}</h4>
                  <strong>{item.requestType === 'VACATION' ? 'Férias' : item.requestType === 'ABSENCE_MEDICAL' ? 'Ausência médica' : 'Ausência formação'}{getPartialDayLabel(item.partialDay)}</strong>
                </header>
                <p><span>Período:</span> {item.dataInicio} até {item.dataFim}</p>
                <p><span>Equipa:</span> {item.contextTeam?.name || item.user?.team?.name || '-'}</p>
                <p><span>Linha atual:</span> {item.approvals?.find((step) => step.status === 'PENDING')?.approvalLevel ?? '-'}</p>
                <p><span>Observações:</span> {item.observacoes || '-'}</p>
                <div className="trainings-row-actions">
                  <button type="button" onClick={() => void reviewRequest(item.id, 'approve')}>Aprovar</button>
                  <button type="button" onClick={() => void reviewRequest(item.id, 'reject')}>Rejeitar</button>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      {status && <p className="trainings-status">{status}</p>}
    </section>
  );
}
