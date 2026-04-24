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

export default function TrainingsPage() {
  const { hasPermission, isRootAccess, refreshNotifications } = usePortal();
  const canManage = isRootAccess || hasPermission('assign_training') || hasPermission('view_all_trainings');

  const [query, setQuery] = useState('');
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

  const sortedRecords = useMemo(
    () => [...records].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    [records],
  );

  const visibleRecords = useMemo(() => {
    const normalized = query.trim().toLowerCase();

    if (!normalized) {
      return sortedRecords;
    }

    return sortedRecords.filter((record) => {
      return [record.nome, record.entidade, getTrainingStartDate(record), record.link, record.user?.username ?? '']
        .join(' ')
        .toLowerCase()
        .includes(normalized);
    });
  }, [query, sortedRecords]);

  const totalHours = useMemo(() => records.reduce((sum, record) => sum + record.horas, 0), [records]);
  const assignedCount = useMemo(() => records.filter((record) => record.status === 'ASSIGNED').length, [records]);
  const completedCount = useMemo(() => records.filter((record) => record.status === 'COMPLETED').length, [records]);
  const criticalCount = useMemo(() => (canManage ? assignedCount : assignedCount), [canManage, assignedCount]);

  useEffect(() => {
    const controller = new AbortController();

    void loadTrainings(controller.signal);

    return () => controller.abort();
  }, [canManage]);



  async function loadTrainings(signal?: AbortSignal) {
    setIsRecordsLoading(records.length === 0);
    try {
      const path = canManage ? '/trainings/assigned' : '/trainings/me';
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

      setStatus(error instanceof Error ? error.message : 'Falha ao carregar formações.');
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
      

      <section className="trainings-list-card">
        <div className="trainings-list-head">
          <label>
            <span>Pesquisar</span>
            <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Nome, entidade, colaborador..." />
          </label>
          {canManage && (
            <Button type="button" variant="primary" onClick={openAssignModal}>Nova formação</Button>
          )}
        </div>

        <div className="trainings-table-wrap">
          <table className="trainings-table" aria-label="Lista de formações">
            <thead>
              <tr>
                <th>Formação</th>
                {canManage && <th>Colaborador</th>}
                <th>Origem</th>
                <th>Link</th>
                <th>Horas</th>
                <th>Data de início</th>
                <th>Entidade</th>
                <th>Data conclusão</th>
                <th>Estado</th>
                {!canManage && <th>Ações</th>}
              </tr>
            </thead>
            <tbody>
              {(isRecordsLoading && !recordsLoaded) ? (
                <tr>
                  <td colSpan={canManage ? 9 : 9}>A carregar formações...</td>
                </tr>
              ) : visibleRecords.length === 0 ? (
                <tr>
                  <td colSpan={canManage ? 9 : 9}>Sem formações para apresentar.</td>
                </tr>
              ) : (
                visibleRecords.map((record) => (
                  <tr key={record.id}>
                    <td>{record.nome}</td>
                    {canManage && <td>{record.user?.username || '-'}</td>}
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
                    {!canManage && (
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
          {visibleRecords.length === 0 && !isRecordsLoading && <article className="trainings-mobile-card">Sem formações para apresentar.</article>}

          {visibleRecords.map((record) => (
            <article key={`mobile-${record.id}`} className="trainings-mobile-card">
              <header>
                <h4>{record.nome}</h4>
                <Badge tone={getTrainingStatusTone(record.status) === 'approved' ? 'success' : getTrainingStatusTone(record.status) === 'pending' ? 'warning' : 'neutral'}>
                  {formatTrainingStatusLabel(record.status)}
                </Badge>
              </header>
              {canManage && (
                <p>
                  <span>Colaborador:</span> {record.user?.username || '-'}
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

              {!canManage && record.status === 'ASSIGNED' && (
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
