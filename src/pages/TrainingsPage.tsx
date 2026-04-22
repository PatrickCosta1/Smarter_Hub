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
  userId: string;
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
  userId: '',
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
  const [collaboratorQuery, setCollaboratorQuery] = useState('');
  const [collaborators, setCollaborators] = useState<Collaborator[]>([]);
  const [isSearchingCollaborators, setIsSearchingCollaborators] = useState(false);
  const [isAssignModalOpen, setIsAssignModalOpen] = useState(false);
  const [isRecordsLoading, setIsRecordsLoading] = useState(false);
  const [recordsLoaded, setRecordsLoaded] = useState(false);
  const [completeConfirmRecordId, setCompleteConfirmRecordId] = useState<string | null>(null);
  const [recentAssigned, setRecentAssigned] = useState<RecentAssignedItem[]>([]);

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

  const selectedCollaborator = useMemo(
    () => collaborators.find((item) => item.id === assignDraft.userId) ?? null,
    [collaborators, assignDraft.userId],
  );

  useEffect(() => {
    const controller = new AbortController();

    void loadTrainings(controller.signal);

    return () => controller.abort();
  }, [canManage]);

  useEffect(() => {
    if (!canManage) {
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void loadCollaborators(collaboratorQuery, controller.signal);
    }, 260);

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [canManage, collaboratorQuery]);

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

  async function loadCollaborators(searchValue: string, signal?: AbortSignal) {
    const trimmed = searchValue.trim();

    if (!trimmed) {
      setCollaborators([]);
      setIsSearchingCollaborators(false);
      return;
    }

    setIsSearchingCollaborators(true);

    try {
      const q = encodeURIComponent(trimmed);
      const path = `/users?q=${q}&limit=40`;
      const data = await apiRequestCached<Collaborator[]>(path, {
        headers: getAuthHeaders(),
        signal,
      }, 30000);
      setCollaborators(data);
    } catch (error) {
      if (isAbortError(error) || signal?.aborted) {
        return;
      }

      setAssignStatus(error instanceof Error ? error.message : 'Falha ao pesquisar colaboradores.');
    } finally {
      if (!signal?.aborted) {
        setIsSearchingCollaborators(false);
      }
    }
  }

  function updateAssignDraft(field: keyof AssignDraft, value: string) {
    setAssignDraft((current) => ({ ...current, [field]: value }));
  }

  async function handleAssignTraining(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const parsedHours = parseHours(assignDraft.horas);

    if (!assignDraft.userId || !assignDraft.nome.trim() || !Number.isFinite(parsedHours) || parsedHours < 0) {
      setAssignStatus('Seleciona o colaborador e preenche os campos obrigatórios.');
      return;
    }

    try {
      const selectedName = selectedCollaborator
        ? (selectedCollaborator?.profile?.nomeCompleto ?? selectedCollaborator.username)
        : assignDraft.userId;

      const created = await apiRequest<TrainingRecord>('/trainings/assign', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          userId: assignDraft.userId,
          nome: assignDraft.nome.trim(),
          link: assignDraft.link.trim(),
          horas: parsedHours,
          dataInicio: assignDraft.dataInicio,
          entidade: assignDraft.entidade.trim(),
        }),
      });

      clearApiCache('/trainings');
      setAssignStatus('Formação atribuída com sucesso.');
      void refreshNotifications();
      setRecentAssigned((current) => ([
        {
          id: created.id,
          nome: created.nome,
          collaborator: selectedName,
          createdAt: created.createdAt || new Date().toISOString(),
        },
        ...current,
      ].slice(0, 8)));
      setAssignDraft(EMPTY_ASSIGN_DRAFT);
      await loadTrainings();
    } catch (error) {
      setAssignStatus(error instanceof Error ? error.message : 'Falha ao atribuir formação.');
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
      <header className="trainings-hero">
        <div>
          <p className="hero-kicker">Formações</p>
          <h2>{canManage ? 'Resumo de formações' : 'Resumo das minhas formações'}</h2>
          <p>{canManage ? 'Carga horária e progresso da equipa.' : 'Horas e progresso de conclusão.'}</p>
        </div>

        <div className="trainings-hours-summary">
          <article>
            <span>{canManage ? 'Por concluir' : 'Por concluir'}</span>
            <strong>{(isRecordsLoading && !recordsLoaded) ? <span className="trainings-summary-loading">A carregar</span> : criticalCount}</strong>
          </article>
          <article>
            <span>Concluídas</span>
            <strong>{(isRecordsLoading && !recordsLoaded) ? <span className="trainings-summary-loading">A carregar</span> : completedCount}</strong>
          </article>
        </div>
      </header>

      <section className="trainings-list-card">
        <div className="trainings-list-head">
          <h3>{canManage ? 'Lista de formações' : 'Formações atribuídas a mim'}</h3>
          <label>
            <span>Pesquisar</span>
            <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Nome, entidade, colaborador..." />
          </label>
          {canManage && (
            <Button type="button" variant="primary" onClick={() => setIsAssignModalOpen(true)}>Nova formação</Button>
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
              <div className="field-span-2 rh-collaborator-picker">
                <span>Colaborador *</span>
                <input
                  type="search"
                  value={collaboratorQuery}
                  onChange={(event) => setCollaboratorQuery(event.target.value)}
                  placeholder="Pesquisar por nome, username, email, cargo ou função..."
                />

                {selectedCollaborator ? (
                  <div className="rh-selected-collaborator">
                    <strong>{selectedCollaborator?.profile?.nomeCompleto ?? selectedCollaborator.username}</strong>
                    <span>{selectedCollaborator.email}</span>
                    <button type="button" onClick={() => updateAssignDraft('userId', '')}>Trocar colaborador</button>
                  </div>
                ) : (
                  <div className="rh-collaborator-results" role="listbox" aria-label="Resultados de colaboradores">
                    {!isSearchingCollaborators && !collaboratorQuery.trim() && <p>Escreve para pesquisar colaboradores.</p>}
                    {isSearchingCollaborators && <p>A pesquisar colaboradores...</p>}
                    {!isSearchingCollaborators && collaboratorQuery.trim() && collaborators.length === 0 && <p>Sem resultados para a pesquisa.</p>}
                    {!isSearchingCollaborators &&
                      collaborators.map((collaborator) => {
                        const displayName = collaborator?.profile?.nomeCompleto ?? collaborator.username;

                        return (
                          <button
                            key={collaborator.id}
                            type="button"
                            className="rh-collaborator-result"
                            onClick={() => updateAssignDraft('userId', collaborator.id)}
                          >
                            <strong>{displayName}</strong>
                            <span>{collaborator.email}</span>
                            <small>{collaborator.profile?.cargo || formatRoleLabel(collaborator.role)}</small>
                          </button>
                        );
                      })}
                  </div>
                )}
              </div>

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
                <Button type="submit" variant="primary">Criar formação</Button>
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
