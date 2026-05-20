import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiRequest, authHeaders } from '../portal/api';
import { getStoredAuthToken } from '../portal/auth-storage';
import { usePortal } from '../portal/context';

function getAuthHeaders() {
  const token = getStoredAuthToken();
  return authHeaders(token);
}
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
};

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
  INVITED:                    { label: 'Convidado',          color: '#1a56db', bg: '#eff6ff',  dot: '#3b82f6' },
  SUBMITTED:                  { label: 'Submetido',          color: '#92400e', bg: '#fffbeb',  dot: '#f59e0b' },
  CHANGES_REQUESTED:          { label: 'Correção pedida',    color: '#991b1b', bg: '#fef2f2',  dot: '#ef4444' },
  APPROVED_PENDING_CONTRACT:  { label: 'Aguarda contrato',   color: '#5b21b6', bg: '#f5f3ff',  dot: '#8b5cf6' },
  COMPLETED:                  { label: 'Concluído',          color: '#065f46', bg: '#f0fdf4',  dot: '#10b981' },
  CANCELLED:                  { label: 'Cancelado',          color: '#6b7280', bg: '#f9fafb',  dot: '#9ca3af' },
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
      const qs = status ? `?status=${encodeURIComponent(status)}` : '';
      const data = await apiRequest<ListResponse>(`/users/admissions/list${qs}`, { headers: getAuthHeaders() });
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
      const data = await apiRequest<Admission>(`/users/admissions/${id}`, { headers: getAuthHeaders() });
      setSelected(data);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const refreshList = useCallback(() => { void load(statusFilter); }, [load, statusFilter]);

  /* Stats */
  const counts: Record<string, number> = {};
  rows.forEach((r) => { counts[r.status] = (counts[r.status] ?? 0) + 1; });
  const pending = (counts['SUBMITTED'] ?? 0) + (counts['APPROVED_PENDING_CONTRACT'] ?? 0);

  /* Client-side search filter */
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
        <div style={s.statsRow}>
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
          onChange={(e) => { setStatusFilter(e.target.value); setSelected(null); }}
        >
          {STATUS_FILTER_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}{o.value && counts[o.value] ? ` (${counts[o.value]})` : ''}
            </option>
          ))}
        </select>
        {(search || statusFilter) && (
          <button style={s.clearBtn} onClick={() => { setSearch(''); setStatusFilter(''); setSelected(null); }}>
            Limpar filtros
          </button>
        )}
        <span style={s.resultCount}>
          {filtered.length} resultado{filtered.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* ── Body ── */}
      <div style={s.body}>
        {/* LEFT: list */}
        <div style={{ ...s.listPane, flexShrink: selected ? 1 : 0 }}>
          {isLoading ? (
            <div style={s.centeredMsg}>A carregar…</div>
          ) : error ? (
            <div style={s.errorMsg}>{error}</div>
          ) : filtered.length === 0 ? (
            <div style={s.centeredMsg}>
              <div style={{ fontSize: 40, marginBottom: 8 }}>📭</div>
              <p style={{ margin: 0, color: '#6b7280' }}>{rows.length === 0 ? 'Sem admissões registadas.' : 'Nenhum resultado para os filtros aplicados.'}</p>
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
                  <th style={{ ...s.th, width: 60 }}></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((row) => {
                  const meta = STATUS_META[row.status] ?? STATUS_META['CANCELLED'];
                  const isSelectedRow = selected?.id === row.id;
                  const isHovered = hoveredId === row.id;
                  const rowStyle: React.CSSProperties = {
                    ...s.tr,
                    ...(isSelectedRow ? s.trSelected : isHovered ? s.trHovered : {}),
                  };
                  return (
                    <tr
                      key={row.id}
                      style={rowStyle}
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
                      <td style={s.td}><span style={{ fontFamily: 'monospace', fontSize: 12, color: '#4b5563' }}>{row.personalEmail}</span></td>
                      {isRootAccess && (
                        <td style={s.td}>
                          <span style={s.countryBadge}>{row.workCountry === 'PT' ? '🇵🇹 PT' : '🇧🇷 BR'}</span>
                        </td>
                      )}
                      <td style={{ ...s.td, color: '#6b7280', fontSize: 13 }}>{formatDate(row.createdAt)}</td>
                      <td style={{ ...s.td, color: '#6b7280', fontSize: 13 }}>{row.submittedAt ? formatDate(row.submittedAt) : <span style={{ color: '#d1d5db' }}>—</span>}</td>
                      <td style={s.td}>
                        <span style={{ ...s.badge, background: meta.bg, color: meta.color }}>
                          <span style={{ ...s.dot, background: meta.dot }} />
                          {meta.label}
                        </span>
                      </td>
                      <td style={{ ...s.td, textAlign: 'center' as const }}>
                        <button
                          style={isHovered || isSelectedRow ? s.verBtnActive : s.verBtn}
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

        {/* RIGHT: detail panel */}
        {(selected || detailLoading) && (
          <div style={s.detailPane}>
            {detailLoading ? (
              <div style={s.centeredMsg}>A carregar detalhes…</div>
            ) : selected ? (
              <DetailPanel
                admission={selected}
                onClose={() => setSelected(null)}
                onRefresh={() => { refreshList(); void openDetail(selected.id); }}
              />
            ) : null}
          </div>
        )}
      </div>
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

/* ── Detail Panel ───────────────────────────────────────────────────────────── */

function DetailPanel({ admission, onClose, onRefresh }: {
  admission: Admission;
  onClose: () => void;
  onRefresh: () => void;
}) {
  const meta = STATUS_META[admission.status] ?? STATUS_META['CANCELLED'];
  const pd = admission.personalData;

  const [actionMsg, setActionMsg] = useState('');
  const [correctionReason, setCorrectionReason] = useState('');
  const [showCorrectionForm, setShowCorrectionForm] = useState(false);
  const [showContractForm, setShowContractForm] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

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
    regimeHorario: 'Tempo inteiro',
  });

  const handleApprove = async () => {
    if (!window.confirm(`Confirmas a aprovação dos dados pessoais de ${admission.fullName}?`)) return;
    setIsSaving(true);
    try {
      await apiRequest(`/users/admissions/${admission.id}/approve-personal`, { method: 'POST', headers: getAuthHeaders() });
      setActionMsg('✅ Dados pessoais aprovados. O processo segue para fase contratual.');
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
      await apiRequest(`/users/admissions/${admission.id}/request-correction`, {
        method: 'POST',
        headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: correctionReason }),
      });
      setActionMsg('✅ Pedido de correção enviado. Novo link de preenchimento enviado ao colaborador.');
      setShowCorrectionForm(false);
      setCorrectionReason('');
      onRefresh();
    } catch (e) {
      setActionMsg(`❌ ${e instanceof Error ? e.message : 'Erro ao enviar correção.'}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleComplete = async () => {
    if (!contract.companyEmail || !contract.companyUsername || !contract.cargo || !contract.funcao || !contract.dataInicioContrato || !contract.tipoContrato || !contract.regimeHorario) {
      setActionMsg('❌ Preenche todos os campos obrigatórios do contrato.');
      return;
    }
    if (!window.confirm(`Confirmas a criação do utilizador para ${admission.fullName}?`)) return;
    setIsSaving(true);
    try {
      await apiRequest(`/users/admissions/${admission.id}/complete`, {
        method: 'POST',
        headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify(contract),
      });
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
    <div style={s.detail}>
      {/* Header */}
      <div style={s.detailHeader}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <h2 style={s.detailName}>{admission.fullName}</h2>
            <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.75)', marginTop: 2 }}>{admission.personalEmail}</div>
          </div>
          <button onClick={onClose} style={s.closeBtn} aria-label="Fechar">✕</button>
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
          <span style={{ ...s.badge, background: 'rgba(255,255,255,0.18)', color: '#fff', border: '1px solid rgba(255,255,255,0.25)' }}>
            <span style={{ ...s.dot, background: meta.dot }} />
            {meta.label}
          </span>
          <span style={{ ...s.badge, background: 'rgba(255,255,255,0.12)', color: '#fff', border: '1px solid rgba(255,255,255,0.2)', fontSize: 12 }}>
            {admission.workCountry === 'PT' ? '🇵🇹 Portugal' : `🇧🇷 Brasil${admission.brWorkState ? ` · ${admission.brWorkState}` : ''}`}
          </span>
        </div>
      </div>

      <div style={s.detailScroll}>
        {/* Timeline */}
        <Section title="Linha de tempo" icon="🕐">
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
          {admission.completedAt && <TimelineRow icon="🎉" label="Admissão concluída" date={admission.completedAt} by={actorName(admission.completedBy)} />}
        </Section>

        {/* Review reason */}
        {admission.reviewReason && (
          <div style={s.reasonBanner}>
            <span style={{ fontWeight: 700 }}>Motivo de devolução:</span>
            <span style={{ marginLeft: 6 }}>{admission.reviewReason}</span>
          </div>
        )}

        {/* Personal data – only if submitted */}
        {admission.submittedAt ? (
          <>
            <Section title="Identificação pessoal" icon="👤">
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
            </Section>

            <Section title="Morada" icon="🏠">
              <FieldGrid>
                <DataField label="Morada habitual" value={str(pd.endereco)} span={2} />
                <DataField label="Morada fiscal" value={str(pd.moradaFiscal)} span={2} />
                <DataField label={admission.workCountry === 'BR' ? 'CEP' : 'Código postal'} value={str(pd.codigoPostal)} />
                <DataField label="Localidade" value={str(pd.localidade)} />
                <DataField label="País de nascimento" value={str(pd.localNascimentoPais)} />
                <DataField label="Cidade de nascimento" value={str(pd.localNascimentoCidade)} />
              </FieldGrid>
            </Section>

            <Section title="Dados fiscais e identificação" icon="📋">
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
            </Section>

            <Section title="Dados bancários" icon="🏦">
              <FieldGrid>
                <DataField label="IBAN" value={str(pd.iban)} span={2} />
                {pd.matriculaCarro ? <DataField label="Matrícula" value={str(pd.matriculaCarro)} /> : null}
                {pd.numeroCartaoContinente ? <DataField label="Cartão Continente" value={str(pd.numeroCartaoContinente)} /> : null}
              </FieldGrid>
            </Section>

            <Section title="Contacto de emergência" icon="🚨">
              <FieldGrid>
                <DataField label="Nome" value={str(pd.contactoEmergenciaNome)} />
                <DataField label="Parentesco" value={str(pd.contactoEmergenciaParentesco)} />
                <DataField label="Telefone" value={str(pd.contactoEmergenciaNumero)} />
              </FieldGrid>
            </Section>

            {/* Documents */}
            <Section title="Documentos" icon="📎">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <DocLink label="Comprovativo de morada" url={pd.comprovativoMoradaFiscal as string | undefined} icon="🏠" />
                <DocLink label="Cartão de Cidadão / RG" url={pd.comprovativoCartaoCidadao as string | undefined} icon="🪪" />
                <DocLink label="Comprovativo IBAN" url={pd.comprovativoIban as string | undefined} icon="🏦" />
                <DocLink label="Cartão Continente" url={pd.comprovativoCartaoContinente as string | undefined} icon="🛒" />
              </div>
            </Section>
          </>
        ) : (
          <div style={{ padding: '20px 20px 0', color: '#6b7280', fontSize: 14 }}>
            ⏳ O colaborador ainda não submeteu a ficha de admissão.
          </div>
        )}

        {/* Completed info */}
        {admission.status === 'COMPLETED' && (
          <Section title="Utilizador criado" icon="✅">
            <FieldGrid>
              <DataField label="Username" value={admission.companyUsername ?? '—'} />
              <DataField label="Email empresa" value={admission.companyEmail ?? '—'} />
            </FieldGrid>
          </Section>
        )}

        {/* ── Actions ── */}
        {actionMsg && (
          <div style={actionMsg.startsWith('✅') ? s.actionSuccess : s.actionError}>{actionMsg}</div>
        )}

        {admission.status === 'SUBMITTED' && (
          <div style={s.actionsBox}>
            <h4 style={s.actionsTitle}>Ações disponíveis</h4>
            {!showCorrectionForm ? (
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <Button variant="primary" onClick={() => { void handleApprove(); }} disabled={isSaving}>
                  ✅ Aprovar dados pessoais
                </Button>
                <Button variant="secondary" onClick={() => setShowCorrectionForm(true)} disabled={isSaving}>
                  ↩️ Pedir correção
                </Button>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <label style={s.fieldLabel}>Motivo da correção solicitada</label>
                <textarea
                  style={s.textarea}
                  rows={3}
                  placeholder="Descreve o que está incorrecto ou em falta…"
                  value={correctionReason}
                  onChange={(e) => setCorrectionReason(e.target.value)}
                  disabled={isSaving}
                />
                <div style={{ display: 'flex', gap: 8 }}>
                  <Button variant="primary" onClick={() => { void handleRequestCorrection(); }} disabled={isSaving || correctionReason.trim().length < 5}>
                    {isSaving ? 'A enviar…' : 'Enviar pedido'}
                  </Button>
                  <Button variant="secondary" onClick={() => { setShowCorrectionForm(false); setCorrectionReason(''); }} disabled={isSaving}>
                    Cancelar
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}

        {admission.status === 'APPROVED_PENDING_CONTRACT' && (
          <div style={s.actionsBox}>
            <h4 style={s.actionsTitle}>Concluir admissão · dados contratuais</h4>
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
                    <label style={s.fieldLabel}>Tipo de contrato *</label>
                    <select style={s.input} value={contract.tipoContrato} onChange={(e) => setContract((p) => ({ ...p, tipoContrato: e.target.value }))} disabled={isSaving}>
                      {['Contrato a termo certo', 'Contrato a termo incerto', 'Contrato sem termo', 'CLT', 'PJ', 'Estágio'].map((v) => <option key={v}>{v}</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={s.fieldLabel}>Regime horário *</label>
                    <select style={s.input} value={contract.regimeHorario} onChange={(e) => setContract((p) => ({ ...p, regimeHorario: e.target.value }))} disabled={isSaving}>
                      {['Tempo inteiro', 'Part-time', 'Horário flexível', 'Teletrabalho'].map((v) => <option key={v}>{v}</option>)}
                    </select>
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

        {admission.status === 'CHANGES_REQUESTED' && (
          <div style={s.infoBox}>
            ℹ️ Foi enviado um novo link de preenchimento ao colaborador. A aguardar nova submissão.
          </div>
        )}

        {admission.status === 'INVITED' && (
          <div style={s.infoBox}>
            📧 Convite enviado em {formatDateTime(admission.lastInvitationSentAt ?? admission.createdAt)}. Expira em {formatDate(admission.tokenExpiresAt)}.
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Sub-components ─────────────────────────────────────────────────────────── */

function Section({ title, icon, children }: { title: string; icon: string; children: React.ReactNode }) {
  return (
    <div style={s.section}>
      <div style={s.sectionHeader}>
        <span style={{ fontSize: 15 }}>{icon}</span>
        <h3 style={s.sectionTitle}>{title}</h3>
      </div>
      <div style={s.sectionBody}>{children}</div>
    </div>
  );
}

function FieldGrid({ children }: { children: React.ReactNode }) {
  return <div style={s.fieldGrid}>{children}</div>;
}

function DataField({ label, value, span }: { label: string; value: string; span?: number }) {
  return (
    <div style={span === 2 ? { gridColumn: 'span 2' } : undefined}>
      <div style={s.fieldLabel}>{label}</div>
      <div style={s.fieldValue}>{value}</div>
    </div>
  );
}

function TimelineRow({ icon, label, date, by }: { icon: string; label: string; date?: string | null; by?: string }) {
  return (
    <div style={s.timelineRow}>
      <span style={s.timelineIcon}>{icon}</span>
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
      <div style={{ ...s.docZone, opacity: 0.5 }}>
        <span>{icon}</span>
        <span style={{ fontSize: 12, color: '#9ca3af' }}>{label}</span>
        <span style={{ fontSize: 11, color: '#d1d5db' }}>Não submetido</span>
      </div>
    );
  }
  return (
    <a href={url} target="_blank" rel="noreferrer" style={s.docZone}>
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
      <label style={s.fieldLabel}>{label}</label>
      <input style={s.input} type={type} value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} />
    </div>
  );
}

/* ── Styles ─────────────────────────────────────────────────────────────────── */

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
  statsRow: { display: 'flex', gap: 12 },
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
  searchIcon: {
    position: 'absolute' as const, left: 9, fontSize: 13, pointerEvents: 'none' as const, color: '#9ca3af',
  },
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
  resultCount: {
    fontSize: 12, color: '#9ca3af', whiteSpace: 'nowrap' as const, marginLeft: 4,
  },

  body: {
    display: 'flex', flex: 1, overflow: 'hidden',
  },
  listPane: {
    flex: 1, overflowY: 'auto' as const, overflowX: 'auto' as const,
  },
  detailPane: {
    width: 480, borderLeft: '1px solid #e5e7eb', overflowY: 'auto' as const, background: '#fff',
    flexShrink: 0,
  },

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
  tr: {
    borderBottom: '1px solid #f3f4f6', cursor: 'pointer',
    transition: 'background 0.12s',
  } as React.CSSProperties,
  trSelected: { background: '#eff6ff' } as React.CSSProperties,
  trHovered: { background: '#f8faff' } as React.CSSProperties,
  td: { padding: '12px 16px', verticalAlign: 'middle' as const },
  verBtn: {
    padding: '4px 12px', background: 'transparent', border: '1.5px solid #e5e7eb',
    borderRadius: 6, fontSize: 12, fontWeight: 600, color: '#6b7280', cursor: 'pointer',
    whiteSpace: 'nowrap' as const, transition: 'all 0.15s',
  } as React.CSSProperties,
  verBtnActive: {
    padding: '4px 12px', background: '#1a56db', border: '1.5px solid #1a56db',
    borderRadius: 6, fontSize: 12, fontWeight: 600, color: '#fff', cursor: 'pointer',
    whiteSpace: 'nowrap' as const,
  } as React.CSSProperties,

  badge: {
    display: 'inline-flex', alignItems: 'center', gap: 5,
    borderRadius: 20, fontSize: 12, fontWeight: 600, padding: '3px 10px',
  },
  dot: { width: 6, height: 6, borderRadius: '50%', flexShrink: 0 },
  countryBadge: {
    display: 'inline-block', background: '#f3f4f6', borderRadius: 6,
    fontSize: 12, fontWeight: 600, padding: '2px 8px', color: '#374151',
  },

  /* Detail panel */
  detail: { display: 'flex', flexDirection: 'column' as const, height: '100%' },
  detailHeader: {
    background: 'linear-gradient(135deg, #1a56db 0%, #0e3f9e 100%)',
    padding: '20px 20px 16px', flexShrink: 0,
  },
  detailName: { margin: 0, fontSize: 17, fontWeight: 800, color: '#fff', letterSpacing: '-0.3px' },
  closeBtn: {
    background: 'rgba(255,255,255,0.15)', border: 'none', borderRadius: 6,
    color: '#fff', cursor: 'pointer', fontSize: 14, padding: '4px 8px', flexShrink: 0,
  },
  detailScroll: { flex: 1, overflowY: 'auto' as const, paddingBottom: 24 },

  section: { borderBottom: '1px solid #f3f4f6', paddingBottom: 4 },
  sectionHeader: { display: 'flex', alignItems: 'center', gap: 8, padding: '14px 20px 4px' },
  sectionTitle: { margin: 0, fontSize: 13, fontWeight: 700, color: '#111827', letterSpacing: '-0.2px' },
  sectionBody: { padding: '4px 20px 12px' },

  fieldGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 16px' },
  fieldLabel: {
    display: 'block', fontSize: 11, fontWeight: 700, color: '#9ca3af',
    textTransform: 'uppercase' as const, letterSpacing: '0.4px', marginBottom: 2,
  },
  fieldValue: { fontSize: 13, color: '#111827', fontWeight: 500 },

  timelineRow: { display: 'flex', gap: 10, alignItems: 'flex-start', marginBottom: 8 },
  timelineIcon: { fontSize: 16, lineHeight: 1.2, flexShrink: 0, marginTop: 1 },

  docZone: {
    display: 'flex', flexDirection: 'column' as const, alignItems: 'center', gap: 4,
    border: '1px solid #e5e7eb', borderRadius: 8, padding: '10px 8px',
    textDecoration: 'none', fontSize: 20, textAlign: 'center' as const, background: '#fafafa',
  },

  actionsBox: {
    margin: '0 20px 16px', padding: '14px 16px',
    background: '#f8fafc', border: '1px solid #e5e7eb', borderRadius: 10,
  },
  actionsTitle: { margin: '0 0 10px', fontSize: 13, fontWeight: 700, color: '#111827' },

  infoBox: {
    margin: '0 20px 16px', padding: '12px 16px',
    background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 8,
    fontSize: 13, color: '#1e40af',
  },
  reasonBanner: {
    margin: '12px 20px', padding: '10px 14px',
    background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8,
    fontSize: 13, color: '#991b1b',
  },
  actionSuccess: {
    margin: '0 20px 12px', padding: '10px 14px',
    background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8,
    fontSize: 13, color: '#065f46',
  },
  actionError: {
    margin: '0 20px 12px', padding: '10px 14px',
    background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8,
    fontSize: 13, color: '#991b1b',
  },

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
