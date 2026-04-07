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
  createdAt: string;
};

type TrainingDraft = {
  nome: string;
  link: string;
  horas: string;
  duracao: string;
  entidade: string;
  dataConclusao: string;
};

type DraftErrors = Partial<Record<keyof TrainingDraft, string>>;

const EMPTY_DRAFT: TrainingDraft = {
  nome: '',
  link: '',
  horas: '',
  duracao: '',
  entidade: '',
  dataConclusao: '',
};

function parseHours(value: string): number {
  const normalized = value.trim().replace(',', '.');
  return Number(normalized);
}

function formatHours(value: number): string {
  return new Intl.NumberFormat('pt-PT', { maximumFractionDigits: 2, minimumFractionDigits: 0 }).format(value);
}

function isValidHttpLink(link: string): boolean {
  if (!link.trim()) {
    return true;
  }

  try {
    const parsed = new URL(link);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function buildValidationErrors(draft: TrainingDraft): DraftErrors {
  const nextErrors: DraftErrors = {};

  if (!draft.nome.trim()) {
    nextErrors.nome = 'Indica o nome da formação.';
  }

  if (!draft.horas.trim()) {
    nextErrors.horas = 'Indica o número de horas.';
  }

  const parsedHours = parseHours(draft.horas);

  if (draft.horas.trim() && (!Number.isFinite(parsedHours) || parsedHours < 0)) {
    nextErrors.horas = 'As horas devem ser um número positivo.';
  }

  if (!isValidHttpLink(draft.link)) {
    nextErrors.link = 'O link deve começar por http:// ou https://.';
  }

  return nextErrors;
}

export default function TrainingsPage() {
  const { userRole } = usePortal();
  const canManage = userRole === 'rh' || userRole === 'admin';

  const [draft, setDraft] = useState<TrainingDraft>(EMPTY_DRAFT);
  const [draftErrors, setDraftErrors] = useState<DraftErrors>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [records, setRecords] = useState<TrainingRecord[]>([]);
  const [status, setStatus] = useState('');

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
      return [record.nome, record.entidade, record.duracao, record.link]
        .join(' ')
        .toLowerCase()
        .includes(normalized);
    });
  }, [query, sortedRecords]);

  const totalHours = useMemo(() => records.reduce((sum, record) => sum + record.horas, 0), [records]);
  const filteredHours = useMemo(() => visibleRecords.reduce((sum, record) => sum + record.horas, 0), [visibleRecords]);

  function resetForm() {
    setDraft(EMPTY_DRAFT);
    setDraftErrors({});
    setEditingId(null);
  }

  function handleDraftChange(field: keyof TrainingDraft, value: string) {
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

  useEffect(() => {
    loadTrainings();
  }, []);

  async function loadTrainings() {
    try {
      const data = await apiRequest<TrainingRecord[]>('/trainings/me', {
        headers: getAuthHeaders(),
      });
      setRecords(data);
    } catch (error) {
      console.error('Falha ao carregar formações:', error);
    }
  }

  async function handleDeleteRecord(id: string) {
    try {
      await apiRequest(`/trainings/${id}`, {
        method: 'DELETE',
        headers: getAuthHeaders(),
      });
      
      setRecords((current) => current.filter((record) => record.id !== id));

      if (editingId === id) {
        resetForm();
      }

      setStatus('Formação removida com sucesso.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Falha ao eliminar formação.');
    }
  }

  function handleEdit(record: TrainingRecord) {
    setEditingId(record.id);
    setDraft({
      nome: record.nome,
      link: record.link,
      horas: String(record.horas).replace('.', ','),
      duracao: record.duracao,
      entidade: record.entidade,
      dataConclusao: record.dataConclusao,
    });
    setDraftErrors({});
    setStatus('A editar registo. Atualiza os campos e guarda.');
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!canManage) {
      setStatus('Sem permissão para alterar formações.');
      return;
    }

    const errors = buildValidationErrors(draft);

    if (Object.keys(errors).length > 0) {
      setDraftErrors(errors);
      setStatus('Existem erros no formulário.');
      return;
    }

    const parsedHours = parseHours(draft.horas);
    const payload = {
      nome: draft.nome.trim(),
      link: draft.link.trim(),
      horas: parsedHours,
      duracao: draft.duracao.trim(),
      entidade: draft.entidade.trim(),
      dataConclusao: draft.dataConclusao,
    };

    try {
      if (editingId) {
        await apiRequest<TrainingRecord>(`/trainings/${editingId}`, {
          method: 'PUT',
          headers: getAuthHeaders(),
          body: JSON.stringify(payload),
        });
        setStatus('Formação atualizada com sucesso.');
      } else {
        await apiRequest<TrainingRecord>('/trainings', {
          method: 'POST',
          headers: getAuthHeaders(),
          body: JSON.stringify(payload),
        });
        setStatus('Formação adicionada com sucesso.');
      }
      
      await loadTrainings();
      resetForm();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Falha ao guardar formação.');
    }
  }

  return (
    <section className="trainings-shell">
      <header className="trainings-hero">
        <div>
          <p className="hero-kicker">Formações</p>
          <h2>Gestão de formação contínua</h2>
          <p>
            Gere o teu aprendizado
          </p>
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
            <h3>{editingId ? 'Editar formação' : 'Nova formação'}</h3>
          </div>

          <form className="trainings-form" onSubmit={handleSubmit} noValidate>
            <label>
              <span>Nome da formação *</span>
              <input
                type="text"
                value={draft.nome}
                onChange={(event) => handleDraftChange('nome', event.target.value)}
                placeholder="Ex: React Avançado"
              />
              {draftErrors.nome && <small>{draftErrors.nome}</small>}
            </label>

            <label>
              <span>Link (opcional)</span>
              <input
                type="url"
                value={draft.link}
                onChange={(event) => handleDraftChange('link', event.target.value)}
                placeholder="https://..."
              />
              {draftErrors.link && <small>{draftErrors.link}</small>}
            </label>

            <label>
              <span>Horas / duração *</span>
              <input
                type="text"
                inputMode="decimal"
                value={draft.horas}
                onChange={(event) => handleDraftChange('horas', event.target.value)}
                placeholder="Ex: 7,5"
              />
              {draftErrors.horas && <small>{draftErrors.horas}</small>}
            </label>

            <label>
              <span>Duração (texto)</span>
              <input
                type="text"
                value={draft.duracao}
                onChange={(event) => handleDraftChange('duracao', event.target.value)}
                placeholder="Ex: 3 dias"
              />
            </label>

            <label>
              <span>Entidade / plataforma</span>
              <input
                type="text"
                value={draft.entidade}
                onChange={(event) => handleDraftChange('entidade', event.target.value)}
                placeholder="Ex: Udemy"
              />
            </label>

            <label>
              <span>Data de conclusão</span>
              <input
                type="date"
                value={draft.dataConclusao}
                onChange={(event) => handleDraftChange('dataConclusao', event.target.value)}
              />
            </label>

            <div className="trainings-form-actions field-span-2">
              <button className="cta-button cta-primary" type="submit">
                {editingId ? 'Guardar alterações' : 'Adicionar formação'}
              </button>

              <button className="cta-button cta-ghost" type="button" onClick={resetForm}>
                Limpar
              </button>
            </div>
          </form>

          {status && <p className="trainings-status">{status}</p>}
        </section>
      )}

      <section className="trainings-list-card">
        <div className="trainings-list-head">
          <h3>Registos</h3>
          <label>
            <span>Pesquisar</span>
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Nome, entidade, duração..."
            />
          </label>
        </div>

        <div className="trainings-table-wrap">
          <table className="trainings-table" aria-label="Lista de formações">
            <thead>
              <tr>
                <th>Formação</th>
                <th>Link</th>
                <th>Horas</th>
                <th>Duração</th>
                <th>Entidade</th>
                <th>Data</th>
                {canManage && <th>Ações</th>}
              </tr>
            </thead>
            <tbody>
              {visibleRecords.length === 0 && (
                <tr>
                  <td colSpan={canManage ? 7 : 6}>Sem formações para apresentar.</td>
                </tr>
              )}

              {visibleRecords.map((record) => (
                <tr key={record.id}>
                  <td>{record.nome}</td>
                  <td>
                    {record.link ? (
                      <a href={record.link} target="_blank" rel="noreferrer">
                        Abrir
                      </a>
                    ) : (
                      '-'
                    )}
                  </td>
                  <td>{formatHours(record.horas)} h</td>
                  <td>{record.duracao || '-'}</td>
                  <td>{record.entidade || '-'}</td>
                  <td>{record.dataConclusao || '-'}</td>
                  {canManage && (
                    <td>
                      <div className="trainings-row-actions">
                        <button type="button" onClick={() => handleEdit(record)}>
                          Editar
                        </button>
                        <button type="button" onClick={() => void handleDeleteRecord(record.id)}>
                          Eliminar
                        </button>
                      </div>
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
                <strong>{formatHours(record.horas)} h</strong>
              </header>
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
                  <a href={record.link} target="_blank" rel="noreferrer">
                    Abrir link
                  </a>
                )}
              </div>

              {canManage && (
                <div className="trainings-row-actions">
                  <button type="button" onClick={() => handleEdit(record)}>
                    Editar
                  </button>
                  <button type="button" onClick={() => void handleDeleteRecord(record.id)}>
                    Eliminar
                  </button>
                </div>
              )}
            </article>
          ))}
        </div>
      </section>
    </section>
  );
}
