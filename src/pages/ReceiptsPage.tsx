import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from 'react';
import { apiRequest, authHeaders, getApiBase, getBackendBase } from '../portal/api';
import { usePortal } from '../portal/context';

const STORAGE_TOKEN_KEY = 'smarter_hub_auth_token';

function getAuthHeaders() {
  const token = localStorage.getItem(STORAGE_TOKEN_KEY) || '';
  return authHeaders(token);
}

type ReceiptRecord = {
  id: string;
  periodo: string;
  salarioLiquido: string;
  estado: 'Disponivel' | 'Pendente';
  documentoLink: string;
  createdAt: string;
};

type ReceiptDraft = {
  periodo: string;
  salarioLiquido: string;
  estado: 'Disponivel' | 'Pendente';
  documentoLink: string;
};

type DraftErrors = Partial<Record<keyof ReceiptDraft, string>>;

const EMPTY_DRAFT: ReceiptDraft = {
  periodo: '',
  salarioLiquido: '',
  estado: 'Pendente',
  documentoLink: '',
};

function isValidDocumentLink(link: string): boolean {
  if (!link.trim()) {
    return true;
  }

  if (link.startsWith('/uploads/')) {
    return true;
  }

  try {
    const parsed = new URL(link);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function buildValidationErrors(draft: ReceiptDraft): DraftErrors {
  const errors: DraftErrors = {};

  if (!draft.periodo.trim()) {
    errors.periodo = 'Indica o período.';
  }

  if (!isValidDocumentLink(draft.documentoLink)) {
    errors.documentoLink = 'O link deve começar por http://, https:// ou /uploads/.';
  }

  return errors;
}

function resolveDocumentHref(value: string): string {
  if (value.startsWith('/uploads/')) {
    return `${getBackendBase()}${value}`;
  }

  return value;
}

export default function ReceiptsPage() {
  const { userRole } = usePortal();
  const canManage = userRole === 'rh' || userRole === 'admin';

  const [records, setRecords] = useState<ReceiptRecord[]>([]);
  const [draft, setDraft] = useState<ReceiptDraft>(EMPTY_DRAFT);
  const [draftErrors, setDraftErrors] = useState<DraftErrors>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [status, setStatus] = useState('');

  const availableCount = useMemo(() => records.filter((item) => item.estado === 'Disponivel').length, [records]);

  function resetForm() {
    setDraft(EMPTY_DRAFT);
    setDraftErrors({});
    setEditingId(null);
  }

  function handleDraftChange(field: keyof ReceiptDraft, value: string) {
    setDraft((current) => ({ ...current, [field]: value as ReceiptDraft['estado'] }));
    setDraftErrors((current) => {
      if (!current[field]) {
        return current;
      }

      const next = { ...current };
      delete next[field];
      return next;
    });
  }

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    const token = localStorage.getItem(STORAGE_TOKEN_KEY) || '';
    const formData = new FormData();
    formData.append('file', file);

    setStatus('A carregar ficheiro...');

    try {
      const response = await fetch(`${getApiBase()}/files/upload`, {
        method: 'POST',
        headers: authHeaders(token),
        body: formData,
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { message?: string };
        throw new Error(payload.message || 'Falha ao carregar ficheiro.');
      }

      const payload = (await response.json()) as { linkPath?: string; link?: string };
      const nextLink = payload.linkPath || payload.link || '';
      handleDraftChange('documentoLink', nextLink);
      setStatus('Ficheiro carregado. Link associado ao recibo.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Falha ao carregar ficheiro.');
    }
  }

  useEffect(() => {
    void loadReceipts();
  }, []);

  async function loadReceipts() {
    try {
      const data = await apiRequest<ReceiptRecord[]>('/receipts/me', {
        headers: getAuthHeaders(),
      });
      setRecords(data);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Falha ao carregar recibos.');
    }
  }

  function handleEdit(record: ReceiptRecord) {
    setEditingId(record.id);
    setDraft({
      periodo: record.periodo,
      salarioLiquido: record.salarioLiquido,
      estado: record.estado,
      documentoLink: record.documentoLink,
    });
    setDraftErrors({});
    setStatus('A editar recibo.');
  }

  async function handleDeleteRecord(id: string) {
    try {
      await apiRequest(`/receipts/${id}`, {
        method: 'DELETE',
        headers: getAuthHeaders(),
      });

      setRecords((current) => current.filter((record) => record.id !== id));
      if (editingId === id) {
        resetForm();
      }

      setStatus('Recibo removido com sucesso.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Falha ao remover recibo.');
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!canManage) {
      setStatus('Sem permissão para gerir recibos.');
      return;
    }

    const errors = buildValidationErrors(draft);
    if (Object.keys(errors).length > 0) {
      setDraftErrors(errors);
      setStatus('Existem erros no formulário.');
      return;
    }

    const payload = {
      periodo: draft.periodo.trim(),
      salarioLiquido: draft.salarioLiquido.trim(),
      estado: draft.estado,
      documentoLink: draft.documentoLink.trim(),
    };

    try {
      if (editingId) {
        await apiRequest(`/receipts/${editingId}`, {
          method: 'PUT',
          headers: getAuthHeaders(),
          body: JSON.stringify(payload),
        });
        setStatus('Recibo atualizado com sucesso.');
      } else {
        await apiRequest('/receipts', {
          method: 'POST',
          headers: getAuthHeaders(),
          body: JSON.stringify(payload),
        });
        setStatus('Recibo criado com sucesso.');
      }

      await loadReceipts();
      resetForm();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Falha ao guardar recibo.');
    }
  }

  return (
    <section className="trainings-shell">
      <header className="trainings-hero">
        <div>
          <p className="hero-kicker">Recibos</p>
          <h2>Recibos de vencimento</h2>
          <p>Consulta os teus recibos mensais e acompanha o estado de publicação.</p>
        </div>

        <div className="trainings-hours-summary">
          <article>
            <span>Total</span>
            <strong>{records.length}</strong>
          </article>
          <article>
            <span>Disponíveis</span>
            <strong>{availableCount}</strong>
          </article>
        </div>
      </header>

      {canManage && (
        <section className="trainings-form-card">
          <div className="trainings-form-head">
            <h3>{editingId ? 'Editar recibo' : 'Novo recibo'}</h3>
          </div>

          <form className="trainings-form" onSubmit={handleSubmit} noValidate>
            <label>
              <span>Período *</span>
              <input
                type="text"
                value={draft.periodo}
                onChange={(event) => handleDraftChange('periodo', event.target.value)}
                placeholder="Ex: Março 2026"
              />
              {draftErrors.periodo && <small>{draftErrors.periodo}</small>}
            </label>

            <label>
              <span>Salário líquido</span>
              <input
                type="text"
                value={draft.salarioLiquido}
                onChange={(event) => handleDraftChange('salarioLiquido', event.target.value)}
                placeholder="Ex: 1 650,00 EUR"
              />
            </label>

            <label>
              <span>Estado</span>
              <select value={draft.estado} onChange={(event) => handleDraftChange('estado', event.target.value)}>
                <option value="Pendente">Pendente</option>
                <option value="Disponivel">Disponível</option>
              </select>
            </label>

            <label>
              <span>Link do documento</span>
              <input
                type="text"
                value={draft.documentoLink}
                onChange={(event) => handleDraftChange('documentoLink', event.target.value)}
                placeholder="https://..."
              />
              {draftErrors.documentoLink && <small>{draftErrors.documentoLink}</small>}
            </label>

            <label>
              <span>Upload de documento</span>
              <input type="file" accept=".pdf,.png,.jpg,.jpeg" onChange={handleFileChange} />
            </label>

            <div className="trainings-form-actions field-span-2">
              <button className="cta-button cta-primary" type="submit">
                {editingId ? 'Guardar alterações' : 'Adicionar recibo'}
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
          <h3>Histórico de recibos</h3>
        </div>

        <div className="trainings-table-wrap">
          <table className="trainings-table" aria-label="Lista de recibos">
            <thead>
              <tr>
                <th>Período</th>
                <th>Salário líquido</th>
                <th>Estado</th>
                <th>Documento</th>
                {canManage && <th>Ações</th>}
              </tr>
            </thead>
            <tbody>
              {records.length === 0 && (
                <tr>
                  <td colSpan={canManage ? 5 : 4}>Sem recibos para apresentar.</td>
                </tr>
              )}

              {records.map((record) => (
                <tr key={record.id}>
                  <td>{record.periodo}</td>
                  <td>{record.salarioLiquido || '-'}</td>
                  <td>{record.estado}</td>
                  <td>
                    {record.documentoLink ? (
                      <a href={resolveDocumentHref(record.documentoLink)} target="_blank" rel="noreferrer">
                        Abrir documento
                      </a>
                    ) : (
                      '-'
                    )}
                  </td>
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

        {!canManage && status && <p className="trainings-status">{status}</p>}
      </section>
    </section>
  );
}
