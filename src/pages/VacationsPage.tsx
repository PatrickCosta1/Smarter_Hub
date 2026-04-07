import { FormEvent, useEffect, useMemo, useState } from 'react';
import { apiRequest, authHeaders } from '../portal/api';

const STORAGE_TOKEN_KEY = 'smarter_hub_auth_token';

function getAuthHeaders() {
  const token = localStorage.getItem(STORAGE_TOKEN_KEY) || '';
  return authHeaders(token);
}

type VacationType = 'dia_completo' | 'meio_dia_manha' | 'meio_dia_tarde';

type VacationRecord = {
  id: string;
  dataInicio: string;
  dataFim: string;
  tipo: VacationType;
  observacoes: string;
  createdAt: string;
};

type VacationDraft = {
  dataInicio: string;
  dataFim: string;
  tipo: VacationType;
  observacoes: string;
};

type DraftErrors = Partial<Record<keyof VacationDraft, string>>;

const EMPTY_DRAFT: VacationDraft = {
  dataInicio: '',
  dataFim: '',
  tipo: 'dia_completo',
  observacoes: '',
};

function getTypeLabel(type: VacationType) {
  if (type === 'meio_dia_manha') {
    return 'Meio dia (manhã)';
  }

  if (type === 'meio_dia_tarde') {
    return 'Meio dia (tarde)';
  }

  return 'Dia completo';
}

function toLocalDate(dateText: string) {
  return new Date(`${dateText}T00:00:00`);
}

function calculateDays(record: Pick<VacationRecord, 'dataInicio' | 'dataFim' | 'tipo'>) {
  if (record.tipo !== 'dia_completo') {
    return 0.5;
  }

  const start = toLocalDate(record.dataInicio);
  const end = toLocalDate(record.dataFim);
  const diffMs = end.getTime() - start.getTime();

  if (!Number.isFinite(diffMs) || diffMs < 0) {
    return 0;
  }

  return Math.floor(diffMs / (1000 * 60 * 60 * 24)) + 1;
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

  const isHalfDay = draft.tipo === 'meio_dia_manha' || draft.tipo === 'meio_dia_tarde';
  if (isHalfDay && draft.dataInicio && draft.dataFim && draft.dataInicio !== draft.dataFim) {
    errors.tipo = 'Meio dia só pode ser usado numa única data.';
  }

  return errors;
}

export default function VacationsPage() {
  const [draft, setDraft] = useState<VacationDraft>(EMPTY_DRAFT);
  const [draftErrors, setDraftErrors] = useState<DraftErrors>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [records, setRecords] = useState<VacationRecord[]>([]);
  const [status, setStatus] = useState('');

  const sortedRecords = useMemo(
    () => [...records].sort((a, b) => new Date(b.dataInicio).getTime() - new Date(a.dataInicio).getTime()),
    [records],
  );

  const totalDays = useMemo(() => sortedRecords.reduce((sum, item) => sum + calculateDays(item), 0), [sortedRecords]);

  function resetForm() {
    setDraft(EMPTY_DRAFT);
    setDraftErrors({});
    setEditingId(null);
  }

  function handleDraftChange(field: keyof VacationDraft, value: string) {
    setDraft((current) => {
      if (field === 'tipo') {
        return { ...current, tipo: value as VacationType };
      }

      return { ...current, [field]: value };
    });
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
    void loadVacations();
  }, []);

  async function loadVacations() {
    try {
      const data = await apiRequest<VacationRecord[]>('/vacations/me', {
        headers: getAuthHeaders(),
      });
      setRecords(data);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Falha ao carregar férias.');
    }
  }

  function handleEdit(record: VacationRecord) {
    setEditingId(record.id);
    setDraft({
      dataInicio: record.dataInicio,
      dataFim: record.dataFim,
      tipo: record.tipo,
      observacoes: record.observacoes,
    });
    setDraftErrors({});
    setStatus('A editar registo de férias.');
  }

  async function handleDeleteRecord(id: string) {
    try {
      await apiRequest(`/vacations/${id}`, {
        method: 'DELETE',
        headers: getAuthHeaders(),
      });

      setRecords((current) => current.filter((record) => record.id !== id));
      if (editingId === id) {
        resetForm();
      }

      setStatus('Registo removido com sucesso.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Falha ao remover registo.');
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

    const payload = {
      dataInicio: draft.dataInicio,
      dataFim: draft.dataFim,
      tipo: draft.tipo,
      observacoes: draft.observacoes.trim(),
    };

    try {
      if (editingId) {
        await apiRequest(`/vacations/${editingId}`, {
          method: 'PUT',
          headers: getAuthHeaders(),
          body: JSON.stringify(payload),
        });
        setStatus('Registo atualizado com sucesso.');
      } else {
        await apiRequest('/vacations', {
          method: 'POST',
          headers: getAuthHeaders(),
          body: JSON.stringify(payload),
        });
        setStatus('Registo criado com sucesso.');
      }

      await loadVacations();
      resetForm();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Falha ao guardar registo.');
    }
  }

  return (
    <section className="trainings-shell">
      <header className="trainings-hero">
        <div>
          <p className="hero-kicker">Férias</p>
          <h2>Gestão de férias pessoais</h2>
          <p>Regista períodos de férias e acompanha os dias já marcados.</p>
        </div>

        <div className="trainings-hours-summary">
          <article>
            <span>Registos</span>
            <strong>{records.length}</strong>
          </article>
          <article>
            <span>Dias marcados</span>
            <strong>{totalDays.toLocaleString('pt-PT')} d</strong>
          </article>
        </div>
      </header>

      <section className="trainings-form-card">
        <div className="trainings-form-head">
          <h3>{editingId ? 'Editar férias' : 'Novo registo de férias'}</h3>
        </div>

        <form className="trainings-form" onSubmit={handleSubmit} noValidate>
          <label>
            <span>Data de início *</span>
            <input
              type="date"
              value={draft.dataInicio}
              onChange={(event) => handleDraftChange('dataInicio', event.target.value)}
            />
            {draftErrors.dataInicio && <small>{draftErrors.dataInicio}</small>}
          </label>

          <label>
            <span>Data de fim *</span>
            <input
              type="date"
              value={draft.dataFim}
              onChange={(event) => handleDraftChange('dataFim', event.target.value)}
            />
            {draftErrors.dataFim && <small>{draftErrors.dataFim}</small>}
          </label>

          <label>
            <span>Tipo *</span>
            <select value={draft.tipo} onChange={(event) => handleDraftChange('tipo', event.target.value)}>
              <option value="dia_completo">Dia completo</option>
              <option value="meio_dia_manha">Meio dia (manhã)</option>
              <option value="meio_dia_tarde">Meio dia (tarde)</option>
            </select>
            {draftErrors.tipo && <small>{draftErrors.tipo}</small>}
          </label>

          <label>
            <span>Observações</span>
            <input
              type="text"
              value={draft.observacoes}
              onChange={(event) => handleDraftChange('observacoes', event.target.value)}
              placeholder="Opcional"
            />
          </label>

          <div className="trainings-form-actions field-span-2">
            <button className="cta-button cta-primary" type="submit">
              {editingId ? 'Guardar alterações' : 'Adicionar registo'}
            </button>

            <button className="cta-button cta-ghost" type="button" onClick={resetForm}>
              Limpar
            </button>
          </div>
        </form>

        {status && <p className="trainings-status">{status}</p>}
      </section>

      <section className="trainings-list-card">
        <div className="trainings-list-head">
          <h3>Registos de férias</h3>
        </div>

        <div className="trainings-table-wrap">
          <table className="trainings-table" aria-label="Lista de férias">
            <thead>
              <tr>
                <th>Início</th>
                <th>Fim</th>
                <th>Tipo</th>
                <th>Dias</th>
                <th>Observações</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {sortedRecords.length === 0 && (
                <tr>
                  <td colSpan={6}>Sem registos de férias.</td>
                </tr>
              )}

              {sortedRecords.map((record) => (
                <tr key={record.id}>
                  <td>{record.dataInicio}</td>
                  <td>{record.dataFim}</td>
                  <td>{getTypeLabel(record.tipo)}</td>
                  <td>{calculateDays(record).toLocaleString('pt-PT')}</td>
                  <td>{record.observacoes || '-'}</td>
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
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="trainings-mobile-list">
          {sortedRecords.length === 0 && <article className="trainings-mobile-card">Sem registos de férias.</article>}

          {sortedRecords.map((record) => (
            <article key={`mobile-${record.id}`} className="trainings-mobile-card">
              <header>
                <h4>{record.dataInicio} até {record.dataFim}</h4>
                <strong>{calculateDays(record).toLocaleString('pt-PT')} d</strong>
              </header>
              <p>
                <span>Tipo:</span> {getTypeLabel(record.tipo)}
              </p>
              <p>
                <span>Observações:</span> {record.observacoes || '-'}
              </p>

              <div className="trainings-row-actions">
                <button type="button" onClick={() => handleEdit(record)}>
                  Editar
                </button>
                <button type="button" onClick={() => void handleDeleteRecord(record.id)}>
                  Eliminar
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>
    </section>
  );
}
