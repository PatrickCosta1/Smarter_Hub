import { FormEvent, useEffect, useMemo, useState } from 'react';

import Button from '../components/ui/Button';
import { usePortal } from '../portal/context';
import { apiRequest, authHeaders, getBackendBase } from '../portal/api';

type HourBankEntry = {
  id: string;
  type: 'CREDIT' | 'DEBIT';
  hours: number;
  reason: string;
  source: string;
  createdAt: string;
  createdBy?: {
    id: string;
    username: string;
  } | null;
};

type MeResponse = {
  geo: 'PT' | 'BR';
  brWorkState?: 'SP' | 'RS' | null;
  closingPolicyLabel?: string | null;
  nextClosingDate?: string | null;
  creditedHours: number;
  debitedHours: number;
  totalHours: number;
  limitHours: number;
  isExceeded: boolean;
  exceededByHours: number;
  entries: HourBankEntry[];
};

type OverviewRow = {
  userId: string;
  username: string;
  brWorkState?: 'SP' | 'RS' | null;
  closingPolicyLabel?: string | null;
  fullName: string;
  email: string;
  team?: { id: string; name: string } | null;
  geo: 'PT' | 'BR';
  creditedHours: number;
  debitedHours: number;
  totalHours: number;
  limitHours: number;
  isExceeded: boolean;
  exceededByHours: number;
};

type OverviewResponse = {
  rows: OverviewRow[];
  total: number;
  page: number;
  pageSize: number;
};

type Tab = 'meu-saldo' | 'visao-rh' | 'lancamentos' | 'limites';

const STORAGE_TOKEN_KEY = 'smarter_hub_auth_token';

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function formatHours(value: number) {
  return `${(Math.round(value * 100) / 100).toFixed(2)}h`;
}

function SaldoProgress({ total, limit }: { total: number; limit: number }) {
  const pct = limit > 0 ? Math.min((Math.abs(total) / limit) * 100, 100) : 0;
  const exceeded = total > limit;
  return (
    <div className="hb-progress">
      <div
        className={`hb-progress__bar${exceeded ? ' hb-progress__bar--exceeded' : ''}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

export default function HourBankPage() {
  const { currentUser, hasPermission, isRootAccess, isAccessTotal, refreshNotifications } = usePortal();
  const [activeTab, setActiveTab] = useState<Tab>('meu-saldo');
  const [isLoading, setIsLoading] = useState(true);
  const [status, setStatus] = useState('');
  const [statusKind, setStatusKind] = useState<'ok' | 'err'>('ok');
  const [me, setMe] = useState<MeResponse | null>(null);
  const [overview, setOverview] = useState<OverviewRow[]>([]);
  const [search, setSearch] = useState('');
  const [searchDraft, setSearchDraft] = useState('');
  const [onlyExceeded, setOnlyExceeded] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [entryType, setEntryType] = useState<'CREDIT' | 'DEBIT'>('CREDIT');
  const [entryHours, setEntryHours] = useState('');
  const [entryReason, setEntryReason] = useState('');
  const [limitHours, setLimitHours] = useState('40');
  const [isSubmittingEntry, setIsSubmittingEntry] = useState(false);
  const [isSubmittingLimit, setIsSubmittingLimit] = useState(false);
  const [exportLoading, setExportLoading] = useState(false);

  const canManage = useMemo(
    () => isRootAccess || isAccessTotal || hasPermission('manage_hours_bank'),
    [hasPermission, isAccessTotal, isRootAccess],
  );

  const canView = useMemo(
    () => canManage || hasPermission('view_hours_bank') || currentUser?.role === 'MANAGER' || currentUser?.role === 'COORDENADOR',
    [canManage, currentUser?.role, hasPermission],
  );

  const tabs: { id: Tab; label: string; icon: string; gated?: boolean }[] = [
    { id: 'meu-saldo', label: 'Meu Saldo', icon: '💰' },
    { id: 'visao-rh', label: 'Visão RH', icon: '📊', gated: !canView },
    { id: 'lancamentos', label: 'Lançamentos', icon: '✏️', gated: !canManage },
    { id: 'limites', label: 'Limites', icon: '⚙️', gated: !canManage },
  ];

  async function loadData() {
    const token = localStorage.getItem(STORAGE_TOKEN_KEY) || '';
    if (!token) {
      setStatus('Sessão inválida.');
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setStatus('');

    try {
      const meResponse = await apiRequest<MeResponse>('/hours-bank/me', {
        headers: authHeaders(token),
      });
      setMe(meResponse);

      if (canView) {
        const params = new URLSearchParams();
        params.set('page', '1');
        params.set('pageSize', '200');
        params.set('workCountry', 'BR');
        if (search.trim()) {
          params.set('q', search.trim());
        }

        const overviewResponse = await apiRequest<OverviewResponse>(`/hours-bank/overview?${params.toString()}`, {
          headers: authHeaders(token),
        });
        setOverview(overviewResponse.rows);

        if (!selectedUserId && overviewResponse.rows[0]) {
          setSelectedUserId(overviewResponse.rows[0].userId);
          setLimitHours(String(overviewResponse.rows[0].limitHours));
        }
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Falha ao carregar banco de horas.');
      setStatusKind('err');
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      setSearch(searchDraft.trim());
    }, 280);

    return () => clearTimeout(timeoutId);
  }, [searchDraft]);

  useEffect(() => {
    void loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canView, search]);

  async function handleCreateEntry(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canManage || !selectedUserId) {
      return;
    }

    const token = localStorage.getItem(STORAGE_TOKEN_KEY) || '';
    if (!token) {
      return;
    }

    const parsedHours = Number(entryHours.replace(',', '.'));
    if (!Number.isFinite(parsedHours) || parsedHours <= 0) {
      setStatus('Horas inválidas.');
      return;
    }

    setIsSubmittingEntry(true);
    setStatus('');

    try {
      await apiRequest('/hours-bank/entries', {
        method: 'POST',
        headers: authHeaders(token),
        body: JSON.stringify({
          userId: selectedUserId,
          type: entryType,
          hours: parsedHours,
          reason: entryReason,
        }),
      });

      setEntryHours('');
      setEntryReason('');
      await Promise.all([loadData(), refreshNotifications()]);
      setStatus('Lançamento registado com sucesso.');
      setStatusKind('ok');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Falha ao lançar horas.');
      setStatusKind('err');
    } finally {
      setIsSubmittingEntry(false);
    }
  }

  async function handleUpdateLimit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canManage || !selectedUserId) {
      return;
    }

    const token = localStorage.getItem(STORAGE_TOKEN_KEY) || '';
    if (!token) {
      return;
    }

    const parsedLimit = Number(limitHours.replace(',', '.'));
    if (!Number.isFinite(parsedLimit) || parsedLimit < 0) {
      setStatus('Limite inválido.');
      return;
    }

    setIsSubmittingLimit(true);
    setStatus('');

    try {
      await apiRequest(`/hours-bank/limits/${selectedUserId}`, {
        method: 'PATCH',
        headers: authHeaders(token),
        body: JSON.stringify({ limitHours: parsedLimit }),
      });

      await loadData();
      setStatus('Limite atualizado com sucesso.');
      setStatusKind('ok');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Falha ao atualizar limite.');
      setStatusKind('err');
    } finally {
      setIsSubmittingLimit(false);
    }
  }

  async function handleExport() {
    const token = localStorage.getItem(STORAGE_TOKEN_KEY) || '';
    if (!token) return;

    const params = new URLSearchParams();
    params.set('workCountry', 'BR');
    if (search.trim()) params.set('q', search.trim());

    const url = `${getBackendBase()}/api/hours-bank/export?${params.toString()}`;
    setExportLoading(true);

    try {
      const response = await fetch(url, { headers: authHeaders(token) });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({} as Record<string, unknown>));
        throw new Error((payload.message as string) || 'Falha ao exportar banco de horas.');
      }

      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = objectUrl;
      anchor.download = `banco_horas_${new Date().toISOString().slice(0, 10)}.xlsx`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(objectUrl);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Falha ao exportar banco de horas.');
      setStatusKind('err');
    } finally {
      setExportLoading(false);
    }
  }

  const visibleOverview = useMemo(
    () => (onlyExceeded ? overview.filter((row) => row.isExceeded) : overview),
    [onlyExceeded, overview],
  );

  const overviewMetrics = useMemo(() => {
    const exceededCount = overview.filter((row) => row.isExceeded).length;
    const totalHours = overview.reduce((sum, row) => sum + row.totalHours, 0);
    const totalExceededHours = overview.reduce((sum, row) => sum + row.exceededByHours, 0);
    return {
      totalCollaborators: overview.length,
      exceededCount,
      totalHours,
      totalExceededHours,
    };
  }, [overview]);

  useEffect(() => {
    if (visibleOverview.length === 0) { setSelectedUserId(''); return; }
    const selectedStillVisible = visibleOverview.some((row) => row.userId === selectedUserId);
    if (!selectedStillVisible) {
      setSelectedUserId(visibleOverview[0].userId);
      setLimitHours(String(visibleOverview[0].limitHours));
    }
  }, [selectedUserId, visibleOverview]);

  const selectedRow = visibleOverview.find((row) => row.userId === selectedUserId)
    || overview.find((row) => row.userId === selectedUserId)
    || null;

  function selectUser(userId: string) {
    const row = overview.find((r) => r.userId === userId);
    if (row) { setSelectedUserId(userId); setLimitHours(String(row.limitHours)); }
  }

  const meUsagePercent = me && me.limitHours > 0
    ? Math.min((Math.abs(me.totalHours) / me.limitHours) * 100, 100)
    : 0;

  return (
    <section className="hb-page">

      {/* Tab bar */}
      <nav className="hb-tabs">
        {tabs.filter((t) => !t.gated).map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={`hb-tabs__btn${activeTab === tab.id ? ' hb-tabs__btn--active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
          >
            <span className="hb-tabs__icon">{tab.icon}</span>
            <span>{tab.label}</span>
          </button>
        ))}
      </nav>

      {/* Status banner */}
      {status && (
        <div className={`hb-status${statusKind === 'err' ? ' hb-status--err' : ' hb-status--ok'}`}>
          {status}
          <button type="button" className="hb-status__close" onClick={() => setStatus('')}>✕</button>
        </div>
      )}

      {/* TAB: Meu Saldo */}
      {activeTab === 'meu-saldo' && (
        <div className="hb-tab-content">
          {isLoading ? (
            <div className="hb-loading"><div className="hb-loading__spinner" /><span>A carregar saldo...</span></div>
          ) : me ? (
            <>
              <div className="hb-kpi-strip">
                <div className="hb-kpi hb-kpi--credit">
                  <span className="hb-kpi__icon">↑</span>
                  <div><p className="hb-kpi__label">Creditado</p><p className="hb-kpi__value">{formatHours(me.creditedHours)}</p></div>
                </div>
                <div className="hb-kpi hb-kpi--debit">
                  <span className="hb-kpi__icon">↓</span>
                  <div><p className="hb-kpi__label">Debitado</p><p className="hb-kpi__value">{formatHours(me.debitedHours)}</p></div>
                </div>
                <div className={`hb-kpi ${me.isExceeded ? 'hb-kpi--exceeded' : 'hb-kpi--total'}`}>
                  <span className="hb-kpi__icon">=</span>
                  <div><p className="hb-kpi__label">Saldo atual</p><p className="hb-kpi__value">{formatHours(me.totalHours)}</p></div>
                </div>
                <div className="hb-kpi hb-kpi--limit">
                  <span className="hb-kpi__icon">◎</span>
                  <div><p className="hb-kpi__label">Limite</p><p className="hb-kpi__value">{formatHours(me.limitHours)}</p></div>
                </div>
              </div>

              <div className="hb-balance-card">
                <div className="hb-balance-card__top">
                  <span className="hb-balance-card__label">Utilização do limite</span>
                  <span className="hb-balance-card__pct">{meUsagePercent.toFixed(0)}%</span>
                </div>
                <SaldoProgress total={me.totalHours} limit={me.limitHours} />
                {me.isExceeded && (
                  <div className="hb-alert">
                    <span className="hb-alert__icon">⚠</span>
                    <div>
                      <strong>Limite excedido</strong>
                      <p>O seu saldo ultrapassa o limite em <strong>{formatHours(me.exceededByHours)}</strong>. Contacte o RH para regularização.</p>
                    </div>
                  </div>
                )}
                {(me.brWorkState || me.closingPolicyLabel || me.nextClosingDate) && (
                  <div className="hb-policy-info">
                    {me.brWorkState && <span className="hb-chip hb-chip--state">{me.brWorkState}</span>}
                    {me.closingPolicyLabel && <span className="hb-chip hb-chip--policy">{me.closingPolicyLabel}</span>}
                    {me.nextClosingDate && <span className="hb-chip hb-chip--date">Próximo fecho: {me.nextClosingDate}</span>}
                  </div>
                )}
              </div>

              <div className="hb-section hb-section--card">
                <div className="hb-section__head">
                  <h3 className="hb-section__title">Últimos lançamentos</h3>
                  <span className="hb-section__count">{me.entries.length} entradas</span>
                </div>
                {me.entries.length === 0 ? (
                  <div className="hb-empty"><p>Sem lançamentos registados ainda.</p></div>
                ) : (
                  <ul className="hb-history">
                    {me.entries.slice(0, 20).map((entry) => (
                      <li key={entry.id} className="hb-history__item">
                        <span className={`hb-history__badge${entry.type === 'CREDIT' ? ' hb-history__badge--credit' : ' hb-history__badge--debit'}`}>
                          {entry.type === 'CREDIT' ? '+' : '−'}{formatHours(entry.hours)}
                        </span>
                        <div className="hb-history__info">
                          <strong>{entry.reason || '—'}</strong>
                          <span>{formatDateTime(entry.createdAt)}</span>
                        </div>
                        {entry.source && <span className="hb-history__source">{entry.source}</span>}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          ) : (
            <div className="hb-empty"><p>Sem dados de banco de horas para apresentar.</p></div>
          )}
        </div>
      )}

      {/* TAB: Visão RH */}
      {activeTab === 'visao-rh' && canView && (
        <div className="hb-tab-content">
          <div className="hb-aggregate-kpis">
            <div className="hb-agg-kpi hb-agg-kpi--indigo">
              <p className="hb-agg-kpi__label">Colaboradores</p>
              <p className="hb-agg-kpi__value">{overviewMetrics.totalCollaborators}</p>
            </div>
            <div className={`hb-agg-kpi ${overviewMetrics.exceededCount > 0 ? 'hb-agg-kpi--amber' : 'hb-agg-kpi--green'}`}>
              <p className="hb-agg-kpi__label">Com excedente</p>
              <p className="hb-agg-kpi__value">{overviewMetrics.exceededCount}</p>
            </div>
            <div className="hb-agg-kpi hb-agg-kpi--blue">
              <p className="hb-agg-kpi__label">Saldo agregado</p>
              <p className="hb-agg-kpi__value">{formatHours(overviewMetrics.totalHours)}</p>
            </div>
            <div className={`hb-agg-kpi ${overviewMetrics.totalExceededHours > 0 ? 'hb-agg-kpi--red' : 'hb-agg-kpi--green'}`}>
              <p className="hb-agg-kpi__label">Excedente total</p>
              <p className="hb-agg-kpi__value">{formatHours(overviewMetrics.totalExceededHours)}</p>
            </div>
          </div>

          <div className="hb-toolbar">
            <div className="hb-toolbar__search">
              <span className="hb-toolbar__search-icon">🔍</span>
              <input
                type="search"
                value={searchDraft}
                placeholder="Pesquisar colaborador..."
                className="hb-toolbar__input"
                onChange={(e) => setSearchDraft(e.target.value)}
              />
            </div>
            <div className="hb-toolbar__actions">
              <button
                type="button"
                className={`hb-filter-btn${onlyExceeded ? ' hb-filter-btn--active' : ''}`}
                onClick={() => setOnlyExceeded((p) => !p)}
              >
                {onlyExceeded ? '⚠ Só excedentes' : '⚠ Filtrar excedentes'}
              </button>
              <Button type="button" variant="secondary" onClick={() => void loadData()}>↺ Atualizar</Button>
              <Button type="button" variant="primary" isLoading={exportLoading} onClick={() => void handleExport()}>↓ Exportar XLSX</Button>
            </div>
          </div>

          {isLoading ? (
            <div className="hb-loading"><div className="hb-loading__spinner" /><span>A carregar colaboradores...</span></div>
          ) : (
            <div className="hb-table-card">
              <div className="hb-table-card__header">
                <span className="hb-table-card__count">{visibleOverview.length} colaboradores</span>
              </div>
              <div className="hb-table-wrap">
              <table className="hb-table">
                <thead>
                  <tr>
                    <th>Colaborador</th>
                    <th>Equipa</th>
                    <th>Est. BR</th>
                    <th className="hb-table__th--num">Crédito</th>
                    <th className="hb-table__th--num">Débito</th>
                    <th className="hb-table__th--num">Saldo</th>
                    <th className="hb-table__th--num">Limite</th>
                    <th>Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleOverview.map((row) => (
                    <tr
                      key={row.userId}
                      className={[
                        selectedUserId === row.userId ? 'is-selected' : '',
                        row.isExceeded ? 'is-exceeded' : '',
                      ].filter(Boolean).join(' ')}
                      onClick={() => selectUser(row.userId)}
                    >
                      <td>
                        <div className="hb-table__user">
                          <strong>{row.fullName}</strong>
                          <span>{row.username}</span>
                        </div>
                      </td>
                      <td className="hb-muted-cell">{row.team?.name || <span className="hb-muted">Sem equipa</span>}</td>
                      <td>{row.brWorkState ? <span className="hb-chip hb-chip--state">{row.brWorkState}</span> : <span className="hb-muted">—</span>}</td>
                      <td className="hb-table__credit hb-table__td--num">{row.creditedHours > 0 ? '+' : ''}{formatHours(row.creditedHours)}</td>
                      <td className="hb-table__debit hb-table__td--num">{row.debitedHours > 0 ? '−' : ''}{formatHours(row.debitedHours)}</td>
                      <td className="hb-table__td--num hb-table__saldo">
                        <strong className={row.isExceeded ? 'hb-table__saldo--exceeded' : ''}>{formatHours(row.totalHours)}</strong>
                      </td>
                      <td className="hb-table__td--num hb-muted-cell">{formatHours(row.limitHours)}</td>
                      <td>
                        {row.isExceeded
                          ? <span className="hb-badge hb-badge--warn">⚠ +{formatHours(row.exceededByHours)}</span>
                          : <span className="hb-badge hb-badge--ok">✓ OK</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
              {visibleOverview.length === 0 && (
                <div className="hb-empty hb-empty--table">
                  <strong>Nenhum colaborador encontrado.</strong>
                  <p>Ajusta a pesquisa ou desativa o filtro de excedentes.</p>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* TAB: Lançamentos */}
      {activeTab === 'lancamentos' && canManage && (
        <div className="hb-tab-content hb-tab-content--form">
          <div className="hb-form-panel">
            <div className="hb-form-panel__header">
              <h2>Novo Lançamento</h2>
              <p>Regista um crédito ou débito de horas para um colaborador.</p>
            </div>

            <form onSubmit={handleCreateEntry} className="hb-form">
              <div className="hb-form__field">
                <label className="hb-form__label">Colaborador</label>
                <select
                  className="hb-form__select"
                  value={selectedUserId}
                  onChange={(e) => selectUser(e.target.value)}
                  required
                >
                  <option value="">Selecionar colaborador...</option>
                  {overview.map((row) => (
                    <option key={row.userId} value={row.userId}>
                      {row.fullName} ({row.username}){row.isExceeded ? ' ⚠' : ''}
                    </option>
                  ))}
                </select>
              </div>

              {selectedRow && (
                <div className="hb-form__user-card">
                  <div className="hb-form__user-info">
                    <strong>{selectedRow.fullName}</strong>
                    <span>{selectedRow.team?.name || 'Sem equipa'}</span>
                  </div>
                  <div className="hb-form__user-balance">
                    <span>Saldo atual</span>
                    <strong className={selectedRow.isExceeded ? 'is-exceeded-text' : ''}>{formatHours(selectedRow.totalHours)}</strong>
                  </div>
                  <div className="hb-form__user-balance">
                    <span>Limite</span>
                    <strong>{formatHours(selectedRow.limitHours)}</strong>
                  </div>
                </div>
              )}

              <div className="hb-form__field">
                <label className="hb-form__label">Tipo de lançamento</label>
                <div className="hb-type-toggle">
                  <button
                    type="button"
                    className={`hb-type-toggle__btn hb-type-toggle__btn--credit${entryType === 'CREDIT' ? ' is-active' : ''}`}
                    onClick={() => setEntryType('CREDIT')}
                  >
                    ↑ Crédito
                  </button>
                  <button
                    type="button"
                    className={`hb-type-toggle__btn hb-type-toggle__btn--debit${entryType === 'DEBIT' ? ' is-active' : ''}`}
                    onClick={() => setEntryType('DEBIT')}
                  >
                    ↓ Débito
                  </button>
                </div>
              </div>

              <div className="hb-form__field">
                <label className="hb-form__label" htmlFor="entry-hours">Horas</label>
                <input
                  id="entry-hours"
                  className="hb-form__input"
                  type="number"
                  step="0.25"
                  min="0.25"
                  value={entryHours}
                  onChange={(e) => setEntryHours(e.target.value)}
                  placeholder="Ex: 8"
                  required
                />
              </div>

              <div className="hb-form__field">
                <label className="hb-form__label" htmlFor="entry-reason">Motivo</label>
                <input
                  id="entry-reason"
                  className="hb-form__input"
                  type="text"
                  value={entryReason}
                  onChange={(e) => setEntryReason(e.target.value)}
                  placeholder="Descrição do lançamento"
                />
              </div>

              <Button type="submit" variant="primary" isLoading={isSubmittingEntry}>
                {entryType === 'CREDIT' ? '↑ Registar crédito' : '↓ Registar débito'}
              </Button>
            </form>
          </div>
        </div>
      )}

      {/* TAB: Limites */}
      {activeTab === 'limites' && canManage && (
        <div className="hb-tab-content">
          <div className="hb-form-panel">
            <div className="hb-form-panel__header">
              <h2>Limites de Banco de Horas</h2>
              <p>Define o limite máximo de saldo acumulado por colaborador. O padrão BR é 100h.</p>
            </div>

            <div className="hb-limits-list">
              {overview.map((row) => (
                <button
                  key={row.userId}
                  type="button"
                  className={`hb-limits-item${selectedUserId === row.userId ? ' is-selected' : ''}`}
                  onClick={() => selectUser(row.userId)}
                >
                  <div className="hb-limits-item__info">
                    <strong>{row.fullName}</strong>
                    <span>{row.team?.name || 'Sem equipa'}</span>
                  </div>
                  <div className="hb-limits-item__values">
                    <span>Saldo: <strong>{formatHours(row.totalHours)}</strong></span>
                    <span>Limite: <strong>{formatHours(row.limitHours)}</strong></span>
                    {row.isExceeded && <span className="hb-badge hb-badge--warn">⚠</span>}
                  </div>
                </button>
              ))}
              {overview.length === 0 && (
                <div className="hb-empty"><p>Sem colaboradores para gerir.</p></div>
              )}
            </div>

            {selectedRow && (
              <form onSubmit={handleUpdateLimit} className="hb-form hb-form--inline">
                <div className="hb-form__user-card">
                  <div className="hb-form__user-info">
                    <strong>{selectedRow.fullName}</strong>
                    <span>{selectedRow.username}</span>
                  </div>
                  <div className="hb-form__user-balance">
                    <span>Saldo atual</span>
                    <strong>{formatHours(selectedRow.totalHours)}</strong>
                  </div>
                </div>
                <div className="hb-form__row">
                  <div className="hb-form__field hb-form__field--grow">
                    <label className="hb-form__label" htmlFor="limit-hours">Novo limite (horas)</label>
                    <input
                      id="limit-hours"
                      className="hb-form__input"
                      type="number"
                      step="0.5"
                      min="0"
                      value={limitHours}
                      onChange={(e) => setLimitHours(e.target.value)}
                    />
                  </div>
                  <Button type="submit" variant="secondary" isLoading={isSubmittingLimit}>Guardar</Button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
