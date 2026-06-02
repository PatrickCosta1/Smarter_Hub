import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  approveAdmissionPersonal,
  completeAdmission,
  loadAdmissionDetail,
  loadAdmissionList,
  requestAdmissionCorrection,
} from '../portal/api-endpoints';
import { usePortal } from '../portal/context';
import Modal from '../components/ui/Modal';
import Button from '../components/ui/Button';

/* ── Types ────────────────────────────────────────────────────────────────── */

type AdmissionStatus =
  | 'INVITED'
  | 'SUBMITTED'
  | 'CHANGES_REQUESTED'
  | 'APPROVED_PENDING_CONTRACT'
  | 'COMPLETED'
  | 'CANCELLED';

type AdmissionUser = {
  id: string;
  username: string;
  profile?: { nomeAbreviado?: string } | null;
};

type Admission = {
  id: string;
  fullName: string;
  personalEmail: string;
  workCountry: 'PT' | 'BR';
  brWorkState?: string | null;
  status: AdmissionStatus;
  personalData: Record<string, unknown>;
  contractData: Record<string, unknown>;
  companyEmail?: string;
  companyUsername?: string;
  reviewReason?: string;
  tokenExpiresAt: string;
  lastInvitationSentAt?: string | null;
  submittedAt?: string | null;
  reviewedAt?: string | null;
  completedAt?: string | null;
  createdAt: string;
  invitedBy?: AdmissionUser | null;
  reviewedBy?: AdmissionUser | null;
  completedBy?: AdmissionUser | null;
};

type ListResponse = {
  total: number;
  page: number;
  pageSize: number;
  rows: Admission[];
};

type ContractForm = {
  companyEmail: string;
  companyUsername: string;
  cargo: string;
  categoriaProfissional: string;
  numeroMecanografico: string;
  funcao: string;
  dataInicioContrato: string;
  dataFimContrato: string;
  tipoContrato: string;
  regimeHorario: string;
  horasSemanaisContrato: string;
};

const DYNAMIC_REGIME_PREFIX = 'DINAMICO::';

type WorkDayKey = 'MON' | 'TUE' | 'WED' | 'THU' | 'FRI' | 'SAT' | 'SUN';

type WorkDaySchedule = {
  day: WorkDayKey;
  label: string;
  enabled: boolean;
  start: string;
  end: string;
};

const WORK_DAY_BASE: ReadonlyArray<Omit<WorkDaySchedule, 'enabled' | 'start' | 'end'>> = [
  { day: 'MON', label: 'Segunda' },
  { day: 'TUE', label: 'Terça' },
  { day: 'WED', label: 'Quarta' },
  { day: 'THU', label: 'Quinta' },
  { day: 'FRI', label: 'Sexta' },
  { day: 'SAT', label: 'Sábado' },
  { day: 'SUN', label: 'Domingo' },
];

const DEFAULT_WORK_DAYS: ReadonlyArray<WorkDaySchedule> = WORK_DAY_BASE.map((item) => ({
  ...item,
  enabled: item.day !== 'SAT' && item.day !== 'SUN',
  start: '09:00',
  end: '18:00',
}));

function cloneDefaultWorkDays() {
  return DEFAULT_WORK_DAYS.map((item) => ({ ...item }));
}

function parseTimeToMinutes(value: string) {
  const match = /^(\d{2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return hours * 60 + minutes;
}

function calculateWeeklyHoursFromDays(days: ReadonlyArray<WorkDaySchedule>) {
  let totalMinutes = 0;
  let hasActiveDay = false;
  for (const day of days) {
    if (!day.enabled) continue;
    hasActiveDay = true;
    const start = parseTimeToMinutes(day.start);
    const end = parseTimeToMinutes(day.end);
    if (start == null || end == null || end <= start) return null;
    const lunchDeduction = start < 13 * 60 && end > 14 * 60 ? 60 : 0;
    totalMinutes += end - start - lunchDeduction;
  }
  if (!hasActiveDay || totalMinutes <= 0) return null;
  return Math.round((totalMinutes / 60) * 100) / 100;
}

function parseDynamicRegimeDays(value: string) {
  if (!value.startsWith(DYNAMIC_REGIME_PREFIX)) return cloneDefaultWorkDays();
  let parsed: unknown;
  try {
    parsed = JSON.parse(value.slice(DYNAMIC_REGIME_PREFIX.length));
  } catch {
    return cloneDefaultWorkDays();
  }
  if (!Array.isArray(parsed)) return cloneDefaultWorkDays();
  const byDay = new Map<WorkDayKey, WorkDaySchedule>();
  for (const item of parsed) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    const key = String(record.day ?? '') as WorkDayKey;
    const defaultDay = DEFAULT_WORK_DAYS.find((e) => e.day === key);
    if (!defaultDay) continue;
    byDay.set(key, {
      day: defaultDay.day,
      label: defaultDay.label,
      enabled: record.enabled === true,
      start: typeof record.start === 'string' ? record.start : defaultDay.start,
      end: typeof record.end === 'string' ? record.end : defaultDay.end,
    });
  }
  return DEFAULT_WORK_DAYS.map((entry) => byDay.get(entry.day) ?? { ...entry });
}

function serializeDynamicRegimeDays(days: ReadonlyArray<WorkDaySchedule>) {
  return `${DYNAMIC_REGIME_PREFIX}${JSON.stringify(days.map((d) => ({ day: d.day, enabled: d.enabled, start: d.start, end: d.end })))}`;
}

function summarizeDynamicRegime(value: string) {
  if (!value.startsWith(DYNAMIC_REGIME_PREFIX)) return value || 'Não configurado';
  const days = parseDynamicRegimeDays(value);
  const active = days.filter((d) => d.enabled);
  if (active.length === 0) return 'Sem dias ativos';
  const labels = active.map((d) => d.label.slice(0, 3));
  const hourSample = active[0] ? `${active[0].start} - ${active[0].end}` : '';
  return `${labels.join(', ')}${hourSample ? ` · ${hourSample}` : ''}`;
}

function formatWeeklyHoursLabel(hours: number | null) {
  if (hours == null) return 'Não configurado';
  return `${hours.toLocaleString('pt-PT', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} h por semana`;
}

const STATUS_FILTER_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '', label: 'Todos os estados' },
  { value: 'INVITED', label: 'Convidado' },
  { value: 'SUBMITTED', label: 'Submetido' },
  { value: 'CHANGES_REQUESTED', label: 'Correção pedida' },
  { value: 'APPROVED_PENDING_CONTRACT', label: 'Aguarda contrato' },
  { value: 'COMPLETED', label: 'Concluído' },
  { value: 'CANCELLED', label: 'Cancelado' },
];

const STATUS_META: Record<AdmissionStatus, { label: string; color: string; bg: string; dot: string }> = {
  INVITED:                   { label: 'Convidado',        color: '#1a56db', bg: '#eff6ff', dot: '#3b82f6' },
  SUBMITTED:                 { label: 'Submetido',        color: '#92400e', bg: '#fffbeb', dot: '#f59e0b' },
  CHANGES_REQUESTED:         { label: 'Correção pedida',  color: '#991b1b', bg: '#fef2f2', dot: '#ef4444' },
  APPROVED_PENDING_CONTRACT: { label: 'Aguarda contrato', color: '#5b21b6', bg: '#f5f3ff', dot: '#8b5cf6' },
  COMPLETED:                 { label: 'Concluído',        color: '#065f46', bg: '#f0fdf4', dot: '#10b981' },
  CANCELLED:                 { label: 'Cancelado',        color: '#6b7280', bg: '#f9fafb', dot: '#9ca3af' },
};

function formatDate(iso?: string | null) {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('pt-PT', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(iso));
}

function formatDateTime(iso?: string | null) {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('pt-PT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
}

function str(v: unknown): string {
  if (!v || typeof v !== 'string') return '—';
  return v.trim() || '—';
}

function bool(v: unknown): string {
  if (v === true) return 'Sim';
  if (v === false) return 'Não';
  return '—';
}

function actorName(u?: AdmissionUser | null) {
  return u?.profile?.nomeAbreviado ?? u?.username ?? '—';
}

/* ── Main component ───────────────────────────────────────────────────────── */

export default function AdmissionsPage() {
  const { isRootAccess } = usePortal();

  const [rows, setRows] = useState<Admission[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Admission | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const loadRef = useRef(false);

  const load = useCallback(async (status: string) => {
    if (loadRef.current) return;
    loadRef.current = true;
    setIsLoading(true);
    setError('');
    try {
      const data = await loadAdmissionList<ListResponse>(status);
      setRows(data.rows);
      setTotal(data.total);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao carregar admissões.');
    } finally {
      setIsLoading(false);
      loadRef.current = false;
    }
  }, []);

  useEffect(() => { void load(statusFilter); }, [load, statusFilter]);

  const openDetail = useCallback(async (id: string) => {
    setDetailLoading(true);
    try {
      const data = await loadAdmissionDetail<Admission>(id);
      setSelected(data);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const refreshList = useCallback(() => { void load(statusFilter); }, [load, statusFilter]);

  const counts: Record<string, number> = {};
  rows.forEach((r) => { counts[r.status] = (counts[r.status] ?? 0) + 1; });
  const pending = (counts['SUBMITTED'] ?? 0) + (counts['APPROVED_PENDING_CONTRACT'] ?? 0);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      r.fullName.toLowerCase().includes(q) ||
      r.personalEmail.toLowerCase().includes(q) ||
      (r.companyEmail ?? '').toLowerCase().includes(q)
    );
  }, [rows, search]);

  return (
    <div style={s.page}>
      {/* ── Header ── */}
      <div style={s.pageHeader}>
        <div>
          <h1 style={s.pageTitle}>Admissões</h1>
          <p style={s.pageSubtitle}>Gestão de processos de admissão de novos colaboradores</p>
        </div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <StatCard value={total} label="Total" color="#1a56db" />
          <StatCard value={pending} label="Pendentes" color="#f59e0b" />
          <StatCard value={counts['COMPLETED'] ?? 0} label="Concluídos" color="#10b981" />
        </div>
      </div>

      {/* ── Filters bar ── */}
      <div style={s.filtersBar}>
        <div style={s.searchWrap}>
          <span style={s.searchIcon}>🔍</span>
          <input
            style={s.searchInput}
            type="search"
            placeholder="Pesquisar por nome ou email…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <select
          style={s.filterSelect}
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value); }}
        >
          {STATUS_FILTER_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}{o.value && counts[o.value] ? ` (${counts[o.value]})` : ''}
            </option>
          ))}
        </select>
        {(search || statusFilter) && (
          <button style={s.clearBtn} onClick={() => { setSearch(''); setStatusFilter(''); }}>
            Limpar filtros
          </button>
        )}
        <span style={s.resultCount}>
          {filtered.length} resultado{filtered.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* ── Table ── */}
      <div style={s.body}>
        {isLoading ? (
          <div style={s.centeredMsg}>A carregar…</div>
        ) : error ? (
          <div style={s.errorMsg}>{error}</div>
        ) : filtered.length === 0 ? (
          <div style={s.centeredMsg}>
            <div style={{ fontSize: 40, marginBottom: 8 }}>📭</div>
            <p style={{ margin: 0, color: '#6b7280' }}>
              {rows.length === 0 ? 'Sem admissões registadas.' : 'Nenhum resultado para os filtros aplicados.'}
            </p>
          </div>
        ) : (
          <table style={s.table}>
            <thead>
              <tr>
                <th style={s.th}>Colaborador</th>
                <th style={s.th}>Email pessoal</th>
                {isRootAccess && <th style={s.th}>País</th>}
                <th style={s.th}>Criado em</th>
                <th style={s.th}>Submetido em</th>
                <th style={s.th}>Estado</th>
                <th style={{ ...s.th, width: 80 }}></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => {
                const meta = STATUS_META[row.status] ?? STATUS_META['CANCELLED'];
                const isHovered = hoveredId === row.id;
                return (
                  <tr
                    key={row.id}
                    style={{ ...s.tr, ...(isHovered ? s.trHovered : {}) }}
                    onClick={() => { void openDetail(row.id); }}
                    onMouseEnter={() => setHoveredId(row.id)}
                    onMouseLeave={() => setHoveredId(null)}
                  >
                    <td style={s.td}>
                      <div style={{ fontWeight: 600, color: '#111827', fontSize: 14 }}>{row.fullName}</div>
                      <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 2 }}>
                        Convidado por {actorName(row.invitedBy)}
                      </div>
                    </td>
                    <td style={s.td}>
                      <span style={{ fontFamily: 'monospace', fontSize: 12, color: '#4b5563' }}>{row.personalEmail}</span>
                    </td>
                    {isRootAccess && (
                      <td style={s.td}>
                        <span style={s.countryBadge}>{row.workCountry === 'PT' ? 'PT' : 'BR'}</span>
                      </td>
                    )}
                    <td style={{ ...s.td, color: '#6b7280', fontSize: 13 }}>{formatDate(row.createdAt)}</td>
                    <td style={{ ...s.td, color: '#6b7280', fontSize: 13 }}>
                      {row.submittedAt ? formatDate(row.submittedAt) : <span style={{ color: '#d1d5db' }}>—</span>}
                    </td>
                    <td style={s.td}>
                      <span style={{ ...s.badge, background: meta.bg, color: meta.color }}>
                        <span style={{ ...s.dot, background: meta.dot }} />
                        {meta.label}
                      </span>
                    </td>
                    <td style={{ ...s.td, textAlign: 'center' }}>
                      <button
                        style={isHovered ? s.verBtnActive : s.verBtn}
                        onClick={(e) => { e.stopPropagation(); void openDetail(row.id); }}
                        title="Ver ficha"
                      >
                        Ver
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Detail Modal ── */}
      <Modal
        open={!!(selected || detailLoading)}
        title={selected ? selected.fullName : 'A carregar…'}
        onClose={() => setSelected(null)}
        width="min(900px, 96vw)"
      >
        {detailLoading && !selected ? (
          <div style={{ padding: '40px 0', textAlign: 'center', color: '#6b7280' }}>A carregar detalhes…</div>
        ) : selected ? (
          <DetailPanel
            admission={selected}
            onClose={() => setSelected(null)}
            onRefresh={() => { refreshList(); void openDetail(selected.id); }}
          />
        ) : null}
      </Modal>
    </div>
  );
}

/* ── Stat Card ─────────────────────────────────────────────────────────────── */

function StatCard({ value, label, color }: { value: number; label: string; color: string }) {
  return (
    <div style={s.statCard}>
      <div style={{ ...s.statValue, color }}>{value}</div>
      <div style={s.statLabel}>{label}</div>
    </div>
  );
}

/* ── Detail Panel (rendered inside Modal) ──────────────────────────────────── */

function DetailPanel({ admission, onClose, onRefresh }: {
  admission: Admission;
  onClose: () => void;
  onRefresh: () => void;
}) {
  const meta = STATUS_META[admission.status] ?? STATUS_META['CANCELLED'];
  const pd = admission.personalData;

  const [actionMsg, setActionMsg] = useState('');
  const [correctionReason, setCorrectionReason] = useState('');
  const [isCorrectionModalOpen, setIsCorrectionModalOpen] = useState(false);
  const [isApproveConfirmOpen, setIsApproveConfirmOpen] = useState(false);
  const [showContractForm, setShowContractForm] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isWorkHoursModalOpen, setIsWorkHoursModalOpen] = useState(false);
  const [workHoursDraft, setWorkHoursDraft] = useState<WorkDaySchedule[]>(() => cloneDefaultWorkDays());

  const [contract, setContract] = useState<ContractForm>({
    companyEmail: '',
    companyUsername: '',
    cargo: '',
    categoriaProfissional: '',
    numeroMecanografico: '',
    funcao: '',
    dataInicioContrato: '',
    dataFimContrato: '',
    tipoContrato: 'Contrato a termo certo',
    regimeHorario: '',
    horasSemanaisContrato: '',
  });

  const weeklyHours = useMemo(() => {
    if (contract.regimeHorario.startsWith(DYNAMIC_REGIME_PREFIX)) {
      return calculateWeeklyHoursFromDays(parseDynamicRegimeDays(contract.regimeHorario));
    }
    const raw = Number(contract.horasSemanaisContrato.replace(',', '.'));
    if (!Number.isFinite(raw) || raw <= 0) return null;
    return Math.round(raw * 100) / 100;
  }, [contract.horasSemanaisContrato, contract.regimeHorario]);

  const regimeSummary = useMemo(() => summarizeDynamicRegime(contract.regimeHorario), [contract.regimeHorario]);

  useEffect(() => {
    if (!contract.regimeHorario.startsWith(DYNAMIC_REGIME_PREFIX)) return;
    if (contract.horasSemanaisContrato.trim()) return;
    const calculated = calculateWeeklyHoursFromDays(parseDynamicRegimeDays(contract.regimeHorario));
    if (calculated == null) return;
    setContract((c) => ({ ...c, horasSemanaisContrato: String(calculated) }));
  }, [contract.horasSemanaisContrato, contract.regimeHorario]);

  function applyDynamicRegime() {
    const calculated = calculateWeeklyHoursFromDays(workHoursDraft);
    if (calculated == null) {
      setActionMsg('❌ Configuração de horas inválida. Confirma os dias ativos e os horários.');
      return;
    }
    setContract((c) => ({
      ...c,
      regimeHorario: serializeDynamicRegimeDays(workHoursDraft),
      horasSemanaisContrato: String(calculated),
    }));
    setIsWorkHoursModalOpen(false);
  }

  const handleApprove = async () => {
    setIsSaving(true);
    try {
      await approveAdmissionPersonal(admission.id);
      setActionMsg('✅ Dados pessoais aprovados. O processo segue para fase contratual.');
      setIsApproveConfirmOpen(false);
      onRefresh();
    } catch (e) {
      setActionMsg(`❌ ${e instanceof Error ? e.message : 'Erro ao aprovar.'}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleRequestCorrection = async () => {
    if (correctionReason.trim().length < 5) {
      setActionMsg('❌ Escreve uma descrição com pelo menos 5 caracteres.');
      return;
    }
    setIsSaving(true);
    try {
      await requestAdmissionCorrection(admission.id, correctionReason);
      setActionMsg('✅ Pedido de correção enviado. Novo link enviado ao colaborador.');
      setIsCorrectionModalOpen(false);
      setCorrectionReason('');
      onRefresh();
    } catch (e) {
      setActionMsg(`❌ ${e instanceof Error ? e.message : 'Erro ao enviar correção.'}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleComplete = async () => {
    if (!contract.companyEmail || !contract.companyUsername || !contract.cargo || !contract.funcao || !contract.dataInicioContrato || !contract.tipoContrato) {
      setActionMsg('❌ Preenche todos os campos obrigatórios do contrato.');
      return;
    }
    if (weeklyHours == null) {
      setActionMsg('❌ Configura as horas de trabalho antes de concluir a admissão.');
      return;
    }
    if (!window.confirm(`Confirmas a criação do utilizador para ${admission.fullName}?`)) return;
    setIsSaving(true);
    try {
      await completeAdmission(admission.id, { ...contract });
      setActionMsg(`✅ Admissão concluída! Utilizador criado com username @${contract.companyUsername}.`);
      setShowContractForm(false);
      onRefresh();
    } catch (e) {
      setActionMsg(`❌ ${e instanceof Error ? e.message : 'Erro ao concluir admissão.'}`);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div style={dp.root}>
      {/* ── Identity strip ── */}
      <div style={dp.identityStrip}>
        <div style={dp.identityLeft}>
          <h2 style={dp.name}>{admission.fullName}</h2>
          <div style={dp.email}>{admission.personalEmail}</div>
        </div>
        <div style={dp.identityRight}>
          <span style={{ ...dp.badge, background: meta.bg, color: meta.color, border: `1px solid ${meta.dot}33` }}>
            <span style={{ ...dp.dot, background: meta.dot }} />
            {meta.label}
          </span>
          <span style={dp.countryChip}>
            {admission.workCountry === 'PT' ? '🇵🇹 Portugal' : `🇧🇷 Brasil${admission.brWorkState ? ` · ${admission.brWorkState}` : ''}`}
          </span>
        </div>
      </div>

      {/* ── Scrollable content ── */}
      <div style={dp.scroll}>

        {/* Timeline */}
        <DpSection title="Linha de tempo" icon="🕐">
          <TimelineRow icon="📧" label="Convite enviado" date={admission.createdAt} by={actorName(admission.invitedBy)} />
          {admission.submittedAt && <TimelineRow icon="📋" label="Ficha submetida" date={admission.submittedAt} />}
          {admission.reviewedAt && (
            <TimelineRow
              icon={admission.status === 'CHANGES_REQUESTED' ? '↩️' : '✅'}
              label={admission.status === 'CHANGES_REQUESTED' ? 'Devolvido para correção' : 'Dados pessoais aprovados'}
              date={admission.reviewedAt}
              by={actorName(admission.reviewedBy)}
            />
          )}
          {admission.completedAt && (
            <TimelineRow icon="🎉" label="Admissão concluída" date={admission.completedAt} by={actorName(admission.completedBy)} />
          )}
        </DpSection>

        {/* Review reason */}
        {admission.reviewReason && (
          <div style={dp.reasonBanner}>
            <span style={{ fontWeight: 700 }}>Motivo de devolução:</span>
            <span style={{ marginLeft: 6 }}>{admission.reviewReason}</span>
          </div>
        )}

        {/* Personal data */}
        {admission.submittedAt ? (
          <>
            <DpSection title="Identificação pessoal" icon="👤">
              <FieldGrid>
                <DataField label="Nome completo" value={str(pd.nomeCompleto)} span={2} />
                <DataField label="Nome abreviado" value={str(pd.nomeAbreviado)} />
                <DataField label="Email pessoal" value={str(pd.emailPessoal)} />
                <DataField label="Data de nascimento" value={str(pd.dataNascimento)} />
                <DataField label="Género" value={str(pd.genero)} />
                <DataField label="Estado civil" value={str(pd.estadoCivil)} />
                <DataField label="Habilitações" value={str(pd.habilitacoesLiterarias)} />
                <DataField label="Curso" value={str(pd.curso)} />
                <DataField label="Nacionalidade" value={str(pd.nacionalidade)} />
                <DataField label="N.º dependentes" value={str(pd.numeroDependentes)} />
                <DataField label="Telemóvel" value={str(pd.telemovel)} />
                {pd.githubUser ? <DataField label="GitHub" value={str(pd.githubUser)} /> : null}
              </FieldGrid>
            </DpSection>

            <DpSection title="Morada" icon="🏠">
              <FieldGrid>
                <DataField label="Morada habitual" value={str(pd.endereco)} span={2} />
                <DataField label="Morada fiscal" value={str(pd.moradaFiscal)} span={2} />
                <DataField label={admission.workCountry === 'BR' ? 'CEP' : 'Código postal'} value={str(pd.codigoPostal)} />
                <DataField label="Localidade" value={str(pd.localidade)} />
                <DataField label="País de nascimento" value={str(pd.localNascimentoPais)} />
                <DataField label="Cidade de nascimento" value={str(pd.localNascimentoCidade)} />
              </FieldGrid>
            </DpSection>

            <DpSection title="Dados fiscais e identificação" icon="📋">
              <FieldGrid>
                {admission.workCountry === 'BR' ? (
                  <>
                    <DataField label="CPF" value={str(pd.cpf)} />
                    <DataField label="RG" value={str(pd.rg)} />
                    <DataField label="Órgão emissor RG" value={str(pd.rgOrgaoEmissor)} />
                    <DataField label="Data emissão RG" value={str(pd.rgDataExpedicao)} />
                    <DataField label="CNH" value={str(pd.cnh)} />
                    <DataField label="Categoria CNH" value={str(pd.cnhCategoria)} />
                    <DataField label="Validade CNH" value={str(pd.cnhDataValidade)} />
                    <DataField label="NIT / PIS" value={str(pd.pis)} />
                    <DataField label="CTPS" value={str(pd.ctps)} />
                    <DataField label="Série CTPS" value={str(pd.ctpsSerie)} />
                    <DataField label="Título de eleitor" value={str(pd.tituloEleitor)} />
                    <DataField label="Zona eleitoral" value={str(pd.zonaEleitoral)} />
                    <DataField label="Secção eleitoral" value={str(pd.secaoEleitoral)} />
                    <DataField label="Certif. reservista" value={str(pd.certificadoReservista)} />
                    <DataField label="Nome do pai" value={str(pd.nomePai)} />
                    <DataField label="Nome da mãe" value={str(pd.nomeMae)} />
                  </>
                ) : (
                  <>
                    <DataField label="NIF" value={str(pd.nif)} />
                    <DataField label="Cartão de Cidadão" value={str(pd.cartaoCidadao)} />
                    <DataField label="Validade CC" value={str(pd.validadeCartaoCidadao)} />
                    <DataField label="NISS" value={str(pd.niss)} />
                    <DataField label="Situação IRS" value={str(pd.situacaoIrs)} />
                    <DataField label="Declaração IRS" value={str(pd.declaracaoIrs)} />
                    <DataField label="IRS Jovem" value={bool(pd.irsJovem)} />
                    <DataField label="Nome do pai" value={str(pd.nomePai)} />
                    <DataField label="Nome da mãe" value={str(pd.nomeMae)} />
                  </>
                )}
              </FieldGrid>
            </DpSection>

            <DpSection title="Dados bancários" icon="🏦">
              <FieldGrid>
                <DataField label="IBAN" value={str(pd.iban)} span={2} />
                {pd.matriculaCarro ? <DataField label="Matrícula" value={str(pd.matriculaCarro)} /> : null}
                {pd.numeroCartaoContinente ? <DataField label="Cartão Continente" value={str(pd.numeroCartaoContinente)} /> : null}
              </FieldGrid>
            </DpSection>

            <DpSection title="Contacto de emergência" icon="🚨">
              <FieldGrid>
                <DataField label="Nome" value={str(pd.contactoEmergenciaNome)} />
                <DataField label="Parentesco" value={str(pd.contactoEmergenciaParentesco)} />
                <DataField label="Telefone" value={str(pd.contactoEmergenciaNumero)} />
              </FieldGrid>
            </DpSection>

            <DpSection title="Documentos" icon="📎">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <DocLink label="Comprovativo de morada" url={pd.comprovativoMoradaFiscal as string | undefined} icon="🏠" />
                <DocLink label="Cartão de Cidadão / RG" url={pd.comprovativoCartaoCidadao as string | undefined} icon="🪪" />
                <DocLink label="Comprovativo IBAN" url={pd.comprovativoIban as string | undefined} icon="🏦" />
                <DocLink label="Cartão Continente" url={pd.comprovativoCartaoContinente as string | undefined} icon="🛒" />
              </div>
            </DpSection>
          </>
        ) : (
          <div style={{ padding: '20px 0', color: '#6b7280', fontSize: 14 }}>
            ⏳ O colaborador ainda não submeteu a ficha de admissão.
          </div>
        )}

        {/* Completed info */}
        {admission.status === 'COMPLETED' && (
          <DpSection title="Utilizador criado" icon="✅">
            <FieldGrid>
              <DataField label="Username" value={admission.companyUsername ?? '—'} />
              <DataField label="Email empresa" value={admission.companyEmail ?? '—'} />
            </FieldGrid>
          </DpSection>
        )}

        {/* Action feedback */}
        {actionMsg && (
          <div style={actionMsg.startsWith('✅') ? dp.actionSuccess : dp.actionError}>
            {actionMsg}
          </div>
        )}

        {/* Actions: SUBMITTED */}
        {admission.status === 'SUBMITTED' && (
          <div style={dp.actionsBox}>
            <h4 style={dp.actionsTitle}>Ações disponíveis</h4>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <Button variant="primary" onClick={() => setIsApproveConfirmOpen(true)} disabled={isSaving}>
                ✅ Aprovar dados pessoais
              </Button>
              <Button variant="secondary" onClick={() => setIsCorrectionModalOpen(true)} disabled={isSaving}>
                ↩️ Pedir correção
              </Button>
            </div>
          </div>
        )}

        {/* Actions: APPROVED_PENDING_CONTRACT */}
        {admission.status === 'APPROVED_PENDING_CONTRACT' && (
          <div style={dp.actionsBox}>
            <h4 style={dp.actionsTitle}>Concluir admissão · dados contratuais</h4>
            {!showContractForm ? (
              <Button variant="primary" onClick={() => setShowContractForm(true)}>
                📝 Preencher dados de contrato
              </Button>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 16px' }}>
                  <ContractField label="Email da empresa *" value={contract.companyEmail} type="email"
                    onChange={(v) => setContract((p) => ({ ...p, companyEmail: v }))} disabled={isSaving} />
                  <ContractField label="Username *" value={contract.companyUsername}
                    onChange={(v) => setContract((p) => ({ ...p, companyUsername: v }))} disabled={isSaving} />
                  <ContractField label="Cargo *" value={contract.cargo}
                    onChange={(v) => setContract((p) => ({ ...p, cargo: v }))} disabled={isSaving} />
                  <ContractField label="Função *" value={contract.funcao}
                    onChange={(v) => setContract((p) => ({ ...p, funcao: v }))} disabled={isSaving} />
                  <ContractField label="Categoria profissional" value={contract.categoriaProfissional}
                    onChange={(v) => setContract((p) => ({ ...p, categoriaProfissional: v }))} disabled={isSaving} />
                  <ContractField label="N.º mecanográfico" value={contract.numeroMecanografico}
                    onChange={(v) => setContract((p) => ({ ...p, numeroMecanografico: v }))} disabled={isSaving} />
                  <ContractField label="Data início contrato *" value={contract.dataInicioContrato} type="date"
                    onChange={(v) => setContract((p) => ({ ...p, dataInicioContrato: v }))} disabled={isSaving} />
                  <ContractField label="Data fim contrato" value={contract.dataFimContrato} type="date"
                    onChange={(v) => setContract((p) => ({ ...p, dataFimContrato: v }))} disabled={isSaving} />
                  <div>
                    <label style={dp.fieldLabel}>Tipo de contrato *</label>
                    <select style={dp.input} value={contract.tipoContrato}
                      onChange={(e) => setContract((p) => ({ ...p, tipoContrato: e.target.value }))} disabled={isSaving}>
                      {['Contrato a termo certo', 'Contrato a termo incerto', 'Contrato sem termo', 'CLT', 'PJ', 'Estágio'].map((v) => (
                        <option key={v}>{v}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label style={dp.fieldLabel}>Regime de contrato (calculado)</label>
                    <input style={dp.input} value={formatWeeklyHoursLabel(weeklyHours)} readOnly disabled />
                  </div>
                  <div style={{ gridColumn: 'span 2', display: 'grid', gap: 8 }}>
                    <label style={dp.fieldLabel}>Horas de trabalho</label>
                    <Button variant="secondary" onClick={() => { setWorkHoursDraft(parseDynamicRegimeDays(contract.regimeHorario)); setIsWorkHoursModalOpen(true); }} disabled={isSaving}>
                      Configurar horas de trabalho
                    </Button>
                    <div style={{ fontSize: 12, color: '#6b7280' }}>{regimeSummary}</div>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                  <Button variant="primary" onClick={() => { void handleComplete(); }} disabled={isSaving}>
                    {isSaving ? 'A criar utilizador…' : '🎉 Criar utilizador e concluir'}
                  </Button>
                  <Button variant="secondary" onClick={() => setShowContractForm(false)} disabled={isSaving}>
                    Cancelar
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Status banners */}
        {admission.status === 'CHANGES_REQUESTED' && (
          <div style={dp.infoBox}>
            ℹ️ Foi enviado um novo link de preenchimento ao colaborador. A aguardar nova submissão.
          </div>
        )}
        {admission.status === 'INVITED' && (
          <div style={dp.infoBox}>
            📧 Convite enviado em {formatDateTime(admission.lastInvitationSentAt ?? admission.createdAt)}. Expira em {formatDate(admission.tokenExpiresAt)}.
          </div>
        )}
      </div>

      {/* ── Nested modals ── */}
      <Modal
        open={isWorkHoursModalOpen}
        title="Configuração de horas de trabalho"
        onClose={() => setIsWorkHoursModalOpen(false)}
        width="min(760px, 96vw)"
        footer={(
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, width: '100%' }}>
            <Button variant="ghost" onClick={() => setIsWorkHoursModalOpen(false)}>Cancelar</Button>
            <Button variant="primary" onClick={applyDynamicRegime}>Aplicar configuração</Button>
          </div>
        )}
      >
        <div style={{ display: 'grid', gap: 10 }}>
          <p style={{ margin: 0, color: '#6b7280', fontSize: 13 }}>
            Define os dias ativos e os intervalos horários. O regime é calculado automaticamente.
          </p>
          {workHoursDraft.map((day) => (
            <div key={day.day} style={{ display: 'grid', gridTemplateColumns: '120px 1fr 1fr', gap: 10, alignItems: 'center' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                <input type="checkbox" checked={day.enabled}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    setWorkHoursDraft((cur) => cur.map((d) => d.day === day.day ? { ...d, enabled: checked } : d));
                  }} />
                {day.label}
              </label>
              <input style={dp.input} type="time" value={day.start} disabled={!day.enabled}
                onChange={(e) => { const v = e.target.value; setWorkHoursDraft((cur) => cur.map((d) => d.day === day.day ? { ...d, start: v } : d)); }} />
              <input style={dp.input} type="time" value={day.end} disabled={!day.enabled}
                onChange={(e) => { const v = e.target.value; setWorkHoursDraft((cur) => cur.map((d) => d.day === day.day ? { ...d, end: v } : d)); }} />
            </div>
          ))}
        </div>
      </Modal>

      <Modal
        open={isApproveConfirmOpen}
        title="Aprovar dados pessoais"
        onClose={() => setIsApproveConfirmOpen(false)}
        width="min(520px, 92vw)"
        footer={(
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, width: '100%' }}>
            <Button variant="ghost" onClick={() => setIsApproveConfirmOpen(false)}>Cancelar</Button>
            <Button variant="primary" onClick={() => { void handleApprove(); }} disabled={isSaving}>
              {isSaving ? 'A aprovar…' : 'Confirmar aprovação'}
            </Button>
          </div>
        )}
      >
        <div style={{ display: 'grid', gap: 12 }}>
          <p style={{ margin: 0, color: '#6b7280', fontSize: 13 }}>
            Confirmas a aprovação dos dados pessoais de <strong>{admission.fullName}</strong>?
          </p>
          <p style={{ margin: 0, color: '#6b7280', fontSize: 13 }}>
            Após aprovação, o pedido seguirá para fase contratual e o colaborador será avisado.
          </p>
        </div>
      </Modal>

      <Modal
        open={isCorrectionModalOpen}
        title="Pedir correção"
        onClose={() => setIsCorrectionModalOpen(false)}
        width="min(620px, 92vw)"
        footer={(
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, width: '100%' }}>
            <Button variant="ghost" onClick={() => { setIsCorrectionModalOpen(false); setCorrectionReason(''); }}>Cancelar</Button>
            <Button variant="primary" onClick={() => { void handleRequestCorrection(); }} disabled={isSaving || correctionReason.trim().length < 5}>
              {isSaving ? 'A enviar…' : 'Enviar pedido'}
            </Button>
          </div>
        )}
      >
        <div style={{ display: 'grid', gap: 10 }}>
          <p style={{ margin: 0, color: '#6b7280', fontSize: 13 }}>
            Descreve o que precisa de ser corrigido. O colaborador receberá o pedido e poderá atualizar os dados.
          </p>
          <textarea
            style={{ ...dp.textarea, minHeight: 160 }}
            rows={6}
            placeholder="Ex.: falta comprovativo válido / documento ilegível / campo obrigatório em falta"
            value={correctionReason}
            onChange={(e) => setCorrectionReason(e.target.value)}
            disabled={isSaving}
          />
        </div>
      </Modal>
    </div>
  );
}

/* ── Sub-components ─────────────────────────────────────────────────────────── */

function DpSection({ title, icon, children }: { title: string; icon: string; children: React.ReactNode }) {
  return (
    <div style={dp.section}>
      <div style={dp.sectionHeader}>
        <span style={{ fontSize: 15 }}>{icon}</span>
        <h3 style={dp.sectionTitle}>{title}</h3>
      </div>
      <div>{children}</div>
    </div>
  );
}

function FieldGrid({ children }: { children: React.ReactNode }) {
  return <div style={dp.fieldGrid}>{children}</div>;
}

function DataField({ label, value, span }: { label: string; value: string; span?: number }) {
  return (
    <div style={span === 2 ? { gridColumn: 'span 2' } : undefined}>
      <div style={dp.fieldLabel}>{label}</div>
      <div style={dp.fieldValue}>{value}</div>
    </div>
  );
}

function TimelineRow({ icon, label, date, by }: { icon: string; label: string; date?: string | null; by?: string }) {
  return (
    <div style={dp.timelineRow}>
      <span style={{ fontSize: 16, lineHeight: 1.2, flexShrink: 0, marginTop: 1 }}>{icon}</span>
      <div>
        <div style={{ fontSize: 13, fontWeight: 600, color: '#111827' }}>{label}</div>
        <div style={{ fontSize: 12, color: '#6b7280' }}>
          {formatDateTime(date)}{by ? ` · ${by}` : ''}
        </div>
      </div>
    </div>
  );
}

function DocLink({ label, url, icon }: { label: string; url?: string; icon: string }) {
  if (!url) {
    return (
      <div style={{ ...dp.docZone, opacity: 0.5 }}>
        <span>{icon}</span>
        <span style={{ fontSize: 12, color: '#9ca3af' }}>{label}</span>
        <span style={{ fontSize: 11, color: '#d1d5db' }}>Não submetido</span>
      </div>
    );
  }
  return (
    <a href={url} target="_blank" rel="noreferrer" style={dp.docZone}>
      <span>{icon}</span>
      <span style={{ fontSize: 12, fontWeight: 600, color: '#374151' }}>{label}</span>
      <span style={{ fontSize: 11, color: '#1a56db' }}>Ver ficheiro →</span>
    </a>
  );
}

function ContractField({ label, value, onChange, disabled, type = 'text' }: {
  label: string; value: string; onChange: (v: string) => void; disabled: boolean; type?: string;
}) {
  return (
    <div>
      <label style={dp.fieldLabel}>{label}</label>
      <input style={dp.input} type={type} value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} />
    </div>
  );
}

/* ── Page styles ─────────────────────────────────────────────────────────────── */

const s = {
  page: {
    display: 'flex', flexDirection: 'column' as const, height: '100%', background: '#f8fafc', overflow: 'hidden',
  },
  pageHeader: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' as const,
    gap: 16, padding: '20px 28px 16px', background: '#fff', borderBottom: '1px solid #e5e7eb',
    boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
  },
  pageTitle: { margin: 0, fontSize: 22, fontWeight: 800, color: '#111827', letterSpacing: '-0.5px' },
  pageSubtitle: { margin: '2px 0 0', fontSize: 13, color: '#6b7280' },
  statCard: {
    background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 10,
    padding: '10px 18px', textAlign: 'center' as const, minWidth: 72,
  },
  statValue: { fontSize: 22, fontWeight: 800, lineHeight: 1.1 },
  statLabel: { fontSize: 11, color: '#9ca3af', fontWeight: 500, textTransform: 'uppercase' as const, letterSpacing: '0.4px', marginTop: 2 },
  filtersBar: {
    display: 'flex', alignItems: 'center', gap: 10, padding: '10px 24px',
    background: '#fff', borderBottom: '1px solid #e5e7eb', flexShrink: 0, flexWrap: 'wrap' as const,
  },
  searchWrap: {
    position: 'relative' as const, display: 'flex', alignItems: 'center', flex: '1 1 220px', minWidth: 180, maxWidth: 340,
  },
  searchIcon: { position: 'absolute' as const, left: 9, fontSize: 13, pointerEvents: 'none' as const, color: '#9ca3af' },
  searchInput: {
    width: '100%', padding: '7px 10px 7px 30px', border: '1.5px solid #e5e7eb', borderRadius: 8,
    fontSize: 13, color: '#111827', background: '#fff', fontFamily: 'inherit', outline: 'none',
    boxSizing: 'border-box' as const,
  },
  filterSelect: {
    padding: '7px 10px', border: '1.5px solid #e5e7eb', borderRadius: 8,
    fontSize: 13, color: '#374151', background: '#fff', cursor: 'pointer', fontFamily: 'inherit', outline: 'none',
  },
  clearBtn: {
    padding: '6px 12px', background: '#f3f4f6', border: '1px solid #e5e7eb', borderRadius: 7,
    fontSize: 12, color: '#374151', cursor: 'pointer', fontWeight: 500, whiteSpace: 'nowrap' as const,
  },
  resultCount: { fontSize: 12, color: '#9ca3af', whiteSpace: 'nowrap' as const, marginLeft: 4 },
  body: { flex: 1, overflowY: 'auto' as const, overflowX: 'auto' as const },
  centeredMsg: {
    display: 'flex', flexDirection: 'column' as const, alignItems: 'center', justifyContent: 'center',
    height: '100%', minHeight: 200, color: '#6b7280', fontSize: 14,
  },
  errorMsg: {
    margin: 24, padding: '12px 16px', background: '#fef2f2', border: '1px solid #fecaca',
    borderRadius: 8, color: '#991b1b', fontSize: 14,
  },
  table: { width: '100%', borderCollapse: 'collapse' as const, fontSize: 14 },
  th: {
    padding: '11px 16px', textAlign: 'left' as const, fontSize: 11, fontWeight: 700,
    color: '#9ca3af', textTransform: 'uppercase' as const, letterSpacing: '0.5px',
    background: '#f9fafb', borderBottom: '2px solid #e5e7eb', whiteSpace: 'nowrap' as const,
    position: 'sticky' as const, top: 0, zIndex: 1,
  },
  tr: { borderBottom: '1px solid #f3f4f6', cursor: 'pointer', transition: 'background 0.12s' } as React.CSSProperties,
  trHovered: { background: '#f8faff' } as React.CSSProperties,
  td: { padding: '12px 16px', verticalAlign: 'middle' as const },
  verBtn: {
    padding: '4px 12px', background: 'transparent', border: '1.5px solid #e5e7eb',
    borderRadius: 6, fontSize: 12, fontWeight: 600, color: '#6b7280', cursor: 'pointer', whiteSpace: 'nowrap' as const,
  } as React.CSSProperties,
  verBtnActive: {
    padding: '4px 12px', background: '#1a56db', border: '1.5px solid #1a56db',
    borderRadius: 6, fontSize: 12, fontWeight: 600, color: '#fff', cursor: 'pointer', whiteSpace: 'nowrap' as const,
  } as React.CSSProperties,
  badge: { display: 'inline-flex', alignItems: 'center', gap: 5, borderRadius: 20, fontSize: 12, fontWeight: 600, padding: '3px 10px' },
  dot: { width: 6, height: 6, borderRadius: '50%', flexShrink: 0 },
  countryBadge: {
    display: 'inline-block', background: '#f3f4f6', borderRadius: 6,
    fontSize: 12, fontWeight: 600, padding: '2px 8px', color: '#374151',
  },
} satisfies Record<string, React.CSSProperties | object>;

/* ── Detail panel styles ─────────────────────────────────────────────────────── */

const dp = {
  root: {
    display: 'flex', flexDirection: 'column' as const, gap: 0, minHeight: 0,
  },

  /* Identity strip at top of modal body */
  identityStrip: {
    display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16,
    padding: '16px 24px', background: 'linear-gradient(135deg, #1a56db 0%, #0e3f9e 100%)',
    borderRadius: 12, marginBottom: 20, flexWrap: 'wrap' as const,
  },
  identityLeft: { display: 'grid', gap: 4 },
  identityRight: { display: 'flex', gap: 8, flexWrap: 'wrap' as const, alignItems: 'center' },
  name: { margin: 0, fontSize: 20, fontWeight: 800, color: '#fff', letterSpacing: '-0.3px' },
  email: { fontSize: 13, color: 'rgba(255,255,255,0.75)' },
  badge: { display: 'inline-flex', alignItems: 'center', gap: 5, borderRadius: 20, fontSize: 12, fontWeight: 600, padding: '4px 12px' },
  dot: { width: 6, height: 6, borderRadius: '50%', flexShrink: 0 },
  countryChip: {
    display: 'inline-flex', alignItems: 'center', padding: '4px 12px', borderRadius: 20,
    background: 'rgba(255,255,255,0.15)', color: '#fff', fontSize: 12, fontWeight: 600,
    border: '1px solid rgba(255,255,255,0.25)',
  },

  /* Scrollable area */
  scroll: { display: 'flex', flexDirection: 'column' as const, gap: 0 },

  /* Sections */
  section: { borderBottom: '1px solid #f3f4f6', paddingBottom: 4, marginBottom: 4 },
  sectionHeader: { display: 'flex', alignItems: 'center', gap: 8, padding: '10px 0 4px' },
  sectionTitle: { margin: 0, fontSize: 13, fontWeight: 700, color: '#111827', letterSpacing: '-0.2px' },

  /* Fields */
  fieldGrid: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px 20px', padding: '4px 0 10px' },
  fieldLabel: {
    display: 'block', fontSize: 11, fontWeight: 700, color: '#9ca3af',
    textTransform: 'uppercase' as const, letterSpacing: '0.4px', marginBottom: 2,
  },
  fieldValue: { fontSize: 13, color: '#111827', fontWeight: 500 },

  /* Timeline */
  timelineRow: { display: 'flex', gap: 10, alignItems: 'flex-start', marginBottom: 8 },

  /* Docs */
  docZone: {
    display: 'flex', flexDirection: 'column' as const, alignItems: 'center', gap: 4,
    border: '1px solid #e5e7eb', borderRadius: 8, padding: '10px 8px',
    textDecoration: 'none', fontSize: 20, textAlign: 'center' as const, background: '#fafafa',
  },

  /* Actions */
  actionsBox: {
    marginTop: 12, marginBottom: 4, padding: '14px 16px',
    background: '#f8fafc', border: '1px solid #e5e7eb', borderRadius: 10,
  },
  actionsTitle: { margin: '0 0 10px', fontSize: 13, fontWeight: 700, color: '#111827' },
  infoBox: {
    marginTop: 12, padding: '12px 16px',
    background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 8,
    fontSize: 13, color: '#1e40af',
  },
  reasonBanner: {
    marginBottom: 12, padding: '10px 14px',
    background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8,
    fontSize: 13, color: '#991b1b',
  },
  actionSuccess: {
    marginTop: 8, padding: '10px 14px',
    background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8,
    fontSize: 13, color: '#065f46',
  },
  actionError: {
    marginTop: 8, padding: '10px 14px',
    background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8,
    fontSize: 13, color: '#991b1b',
  },

  /* Form inputs */
  input: {
    display: 'block', width: '100%', boxSizing: 'border-box' as const,
    padding: '7px 10px', border: '1.5px solid #e5e7eb', borderRadius: 7,
    fontSize: 13, color: '#111827', background: '#fff', fontFamily: 'inherit', outline: 'none',
  },
  textarea: {
    display: 'block', width: '100%', boxSizing: 'border-box' as const,
    padding: '8px 10px', border: '1.5px solid #e5e7eb', borderRadius: 7,
    fontSize: 13, color: '#111827', background: '#fff', fontFamily: 'inherit', resize: 'vertical' as const, outline: 'none',
  },
} satisfies Record<string, React.CSSProperties | object>;