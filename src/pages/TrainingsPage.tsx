import { FormEvent, useEffect, useMemo, useState } from 'react';
import { usePortal } from '../portal/context';
import { apiRequest, authHeaders } from '../portal/api';

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
  duracao: string;
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
};

type Collaborator = {
  id: string;
  username: string;
  email: string;
  role: string;
  profile?: {
    primeiroNome: string;
    apelido: string;
    cargo: string;
    funcao: string;
  } | null;
};

type AssignDraft = {
  userId: string;
  nome: string;
  link: string;
  horas: string;
  duracao: string;
  entidade: string;
};

const EMPTY_ASSIGN_DRAFT: AssignDraft = {
  userId: '',
  nome: '',
  link: '',
  horas: '',
  duracao: '',
  entidade: '',
};

function parseHours(value: string): number {
  const normalized = value.trim().replace(',', '.');
  return Number(normalized);
}

function formatHours(value: number): string {
  return new Intl.NumberFormat('pt-PT', { maximumFractionDigits: 2, minimumFractionDigits: 0 }).format(value);
}

export default function TrainingsPage() {
  const { userRole } = usePortal();
  const canManage = userRole === 'manager' || userRole === 'coordenador' || userRole === 'admin';

  const [query, setQuery] = useState('');
  const [records, setRecords] = useState<TrainingRecord[]>([]);
  const [status, setStatus] = useState('');

  const [assignDraft, setAssignDraft] = useState<AssignDraft>(EMPTY_ASSIGN_DRAFT);
  const [assignStatus, setAssignStatus] = useState('');
  const [collaboratorQuery, setCollaboratorQuery] = useState('');
  const [collaborators, setCollaborators] = useState<Collaborator[]>([]);
  const [isSearchingCollaborators, setIsSearchingCollaborators] = useState(false);

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
      return [record.nome, record.entidade, record.duracao, record.link, record.user?.username ?? '']
        .join(' ')
        .toLowerCase()
        .includes(normalized);
    });
  }, [query, sortedRecords]);

  const totalHours = useMemo(() => records.reduce((sum, record) => sum + record.horas, 0), [records]);
  const filteredHours = useMemo(() => visibleRecords.reduce((sum, record) => sum + record.horas, 0), [visibleRecords]);

  const selectedCollaborator = useMemo(
    () => collaborators.find((item) => item.id === assignDraft.userId) ?? null,
    [collaborators, assignDraft.userId],
  );

  useEffect(() => {
    void loadTrainings();
  }, [canManage]);

  useEffect(() => {
    if (!canManage) {
      return;
    }

    const timer = window.setTimeout(() => {
      void loadCollaborators(collaboratorQuery);
    }, 260);

    return () => window.clearTimeout(timer);
  }, [canManage, collaboratorQuery]);

  async function loadTrainings() {
    try {
      const path = canManage ? '/trainings/assigned' : '/trainings/me';
      const data = await apiRequest<TrainingRecord[]>(path, {
        headers: getAuthHeaders(),
      });
      setRecords(data);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Falha ao carregar formações.');
    }
  }

  async function loadCollaborators(searchValue: string) {
    setIsSearchingCollaborators(true);

    try {
      const q = encodeURIComponent(searchValue.trim());
      const path = q ? `/users?q=${q}&limit=40` : '/users?limit=40';
      const data = await apiRequest<Collaborator[]>(path, {
        headers: getAuthHeaders(),
      });
      setCollaborators(data);
    } catch (error) {
      setAssignStatus(error instanceof Error ? error.message : 'Falha ao pesquisar colaboradores.');
    } finally {
      setIsSearchingCollaborators(false);
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
      await apiRequest<TrainingRecord>('/trainings/assign', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          userId: assignDraft.userId,
          nome: assignDraft.nome.trim(),
          link: assignDraft.link.trim(),
          horas: parsedHours,
          duracao: assignDraft.duracao.trim(),
          entidade: assignDraft.entidade.trim(),
        }),
      });

      setAssignStatus('Formação atribuída com sucesso.');
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

      setRecords((current) => current.map((record) => (record.id === id ? updated : record)));
      setStatus('Formação marcada como concluída.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Falha ao concluir formação.');
    }
  }

  return (
    <section className="trainings-shell">
      <header className="trainings-hero">
        <div>
          <p className="hero-kicker">Formações</p>
          <h2>{canManage ? 'Atribuição e acompanhamento RH' : 'As minhas formações'}</h2>
          <p>{canManage ? 'Atribui formações por colaborador e acompanha o estado de conclusão.' : 'Consulta as formações atribuídas e marca como concluídas quando terminares.'}</p>
        </div>

        <div className="trainings-hours-summary">
          <article>
            <span>Total geral</span>
            <strong>{formatHours(totalHours)} h</strong>
          </article>
          <article>
            <span>Total filtrado</span>
            <strong>{formatHours(filteredHours)} h</strong>
          </article>
        </div>
      </header>

      {canManage && (
        <section className="trainings-form-card">
          <div className="trainings-form-head">
            <h3>Atribuir nova formação</h3>
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
                  <strong>{`${selectedCollaborator.profile?.primeiroNome ?? ''} ${selectedCollaborator.profile?.apelido ?? ''}`.trim() || selectedCollaborator.username}</strong>
                  <span>{selectedCollaborator.email}</span>
                  <button type="button" onClick={() => updateAssignDraft('userId', '')}>Trocar colaborador</button>
                </div>
              ) : (
                <div className="rh-collaborator-results" role="listbox" aria-label="Resultados de colaboradores">
                  {isSearchingCollaborators && <p>A pesquisar colaboradores...</p>}
                  {!isSearchingCollaborators && collaborators.length === 0 && <p>Sem resultados para a pesquisa.</p>}
                  {!isSearchingCollaborators &&
                    collaborators.map((collaborator) => {
                      const displayName = `${collaborator.profile?.primeiroNome ?? ''} ${collaborator.profile?.apelido ?? ''}`.trim() || collaborator.username;

                      return (
                        <button
                          key={collaborator.id}
                          type="button"
                          className="rh-collaborator-result"
                          onClick={() => updateAssignDraft('userId', collaborator.id)}
                        >
                          <strong>{displayName}</strong>
                          <span>{collaborator.email}</span>
                          <small>{collaborator.profile?.cargo || collaborator.role}</small>
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
              <span>Duração</span>
              <input type="text" value={assignDraft.duracao} onChange={(event) => updateAssignDraft('duracao', event.target.value)} placeholder="Ex: 3 dias" />
            </label>

            <label>
              <span>Entidade</span>
              <input type="text" value={assignDraft.entidade} onChange={(event) => updateAssignDraft('entidade', event.target.value)} placeholder="Ex: Udemy" />
            </label>

            <div className="trainings-form-actions field-span-2">
              <button className="cta-button cta-primary" type="submit">Atribuir formação</button>
              <button className="cta-button cta-ghost" type="button" onClick={() => setAssignDraft(EMPTY_ASSIGN_DRAFT)}>Limpar</button>
            </div>
          </form>

          {assignStatus && <p className="trainings-status">{assignStatus}</p>}
        </section>
      )}

      <section className="trainings-list-card">
        <div className="trainings-list-head">
          <h3>{canManage ? 'Formações atribuídas' : 'Formações atribuídas a mim'}</h3>
          <label>
            <span>Pesquisar</span>
            <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Nome, entidade, colaborador..." />
          </label>
        </div>

        <div className="trainings-table-wrap">
          <table className="trainings-table" aria-label="Lista de formações">
            <thead>
              <tr>
                <th>Formação</th>
                {canManage && <th>Colaborador</th>}
                <th>Link</th>
                <th>Horas</th>
                <th>Duração</th>
                <th>Entidade</th>
                <th>Data conclusão</th>
                <th>Estado</th>
                {!canManage && <th>Ações</th>}
              </tr>
            </thead>
            <tbody>
              {visibleRecords.length === 0 && (
                <tr>
                  <td colSpan={canManage ? 8 : 8}>Sem formações para apresentar.</td>
                </tr>
              )}

              {visibleRecords.map((record) => (
                <tr key={record.id}>
                  <td>{record.nome}</td>
                  {canManage && <td>{record.user?.username || '-'}</td>}
                  <td>{record.link ? <a href={record.link} target="_blank" rel="noreferrer">Abrir</a> : '-'}</td>
                  <td>{formatHours(record.horas)} h</td>
                  <td>{record.duracao || '-'}</td>
                  <td>{record.entidade || '-'}</td>
                  <td>{record.dataConclusao || '-'}</td>
                  <td>{record.status || 'CONCLUIDA'}</td>
                  {!canManage && (
                    <td>
                      {record.status === 'ASSIGNED' ? (
                        <div className="trainings-row-actions">
                          <button type="button" onClick={() => void handleCompleteRecord(record.id)}>Marcar concluída</button>
                        </div>
                      ) : (
                        '-'
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="trainings-mobile-list">
          {visibleRecords.length === 0 && <article className="trainings-mobile-card">Sem formações para apresentar.</article>}

          {visibleRecords.map((record) => (
            <article key={`mobile-${record.id}`} className="trainings-mobile-card">
              <header>
                <h4>{record.nome}</h4>
                <strong>{record.status || 'CONCLUIDA'}</strong>
              </header>
              {canManage && (
                <p>
                  <span>Colaborador:</span> {record.user?.username || '-'}
                </p>
              )}
              <p>
                <span>Horas:</span> {formatHours(record.horas)} h
              </p>
              <p>
                <span>Duração:</span> {record.duracao || '-'}
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
                  <button type="button" onClick={() => void handleCompleteRecord(record.id)}>Marcar concluída</button>
                </div>
              )}
            </article>
          ))}
        </div>

        {status && <p className="trainings-status">{status}</p>}
      </section>
    </section>
  );
}
