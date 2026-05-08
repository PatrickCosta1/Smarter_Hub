import { type ChangeEvent, useEffect, useMemo, useState } from 'react';
import Button from '../components/ui/Button';
import Modal from '../components/ui/Modal';
import Toast from '../components/ui/Toast';
import { apiRequest, apiRequestCached, clearApiCache, authHeaders, getApiBase } from '../portal/api';
import { usePortal } from '../portal/context';
import { useFeedbackToast } from '../portal/useFeedbackToast';

const STORAGE_TOKEN_KEY = 'smarter_hub_auth_token';

type WorkCountry = 'PT' | 'BR';
type WellbeingResourceKind = 'pdf' | 'form';

type WellbeingFile = {
  id: string;
  label: string;
  fileName: string;
  linkPath: string;
  link: string;
};

type WellbeingResource = {
  id: string;
  kind: WellbeingResourceKind;
  title: string;
  description: string;
  buttonLabel: string;
  files: WellbeingFile[];
};

type WellbeingSection = {
  title: string;
  description: string;
  resources: WellbeingResource[];
};

type WellbeingContent = {
  sections: Record<WorkCountry, WellbeingSection>;
};

function createResourceId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function createEmptyPdfResource(country: WorkCountry): WellbeingResource {
  return {
    id: createResourceId(`${country.toLowerCase()}-pdf`),
    kind: 'pdf',
    title: 'Novo bloco PDF',
    description: 'Descrição breve do conteúdo disponível neste bloco.',
    buttonLabel: 'Abrir PDF',
    files: [],
  };
}

function createEmptyFormResource(country: WorkCountry): WellbeingResource {
  return {
    id: createResourceId(`${country.toLowerCase()}-form`),
    kind: 'form',
    title: 'Novo formulário',
    description: 'Descrição breve do objetivo deste formulário.',
    buttonLabel: 'Abrir formulário',
    files: [],
  };
}

type UploadResponse = {
  fileName: string;
  fileSize: number;
  linkPath: string;
  link: string;
};

export default function WellbeingPage() {
  const { currentUser, profile, hasPermission, isRootAccess, isAccessTotal } = usePortal();
  const isTPeople = (currentUser?.username ?? '').toLowerCase() === 't.people';
  const canManage = isRootAccess || isAccessTotal || isTPeople || hasPermission('approve_profile_change');
  const canSwitchCountry = isRootAccess || isAccessTotal || isTPeople;
  const profileCountry: WorkCountry = profile.workCountry === 'BR' ? 'BR' : 'PT';
  const [activeCountry, setActiveCountry] = useState<WorkCountry>(profileCountry);
  const [content, setContent] = useState<WellbeingContent | null>(null);
  const [draft, setDraft] = useState<WellbeingContent | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [uploadingKey, setUploadingKey] = useState<string | null>(null);
  const [isReportModalOpen, setIsReportModalOpen] = useState(false);
  const [isSubmittingReport, setIsSubmittingReport] = useState(false);
  const [reportDraft, setReportDraft] = useState({
    subject: '',
    description: '',
    preferredContact: '',
  });
  const { toast, showToast, hideToast } = useFeedbackToast(3600);

  useEffect(() => {
    if (!canManage || !canSwitchCountry) {
      setActiveCountry(profileCountry);
    }
  }, [canManage, canSwitchCountry, profileCountry]);

  useEffect(() => {
    let active = true;
    setIsLoading(true);

    void apiRequestCached<WellbeingContent>('/wellbeing/content', {
      headers: authHeaders(localStorage.getItem(STORAGE_TOKEN_KEY) || ''),
    }, 60000)
      .then((response) => {
        if (!active) {
          return;
        }
        setContent(response);
        setDraft(response);
      })
      .catch((error) => {
        if (!active) {
          return;
        }
        showToast('error', error instanceof Error ? error.message : 'Não foi possível carregar a página Saúde e bem-estar.');
      })
      .finally(() => {
        if (active) {
          setIsLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, []);

  const visibleContent = isEditing ? draft : content;
  const section = useMemo(() => visibleContent?.sections[activeCountry] ?? null, [activeCountry, visibleContent]);

  function updateDraft(transform: (current: WellbeingContent) => WellbeingContent) {
    setDraft((current) => (current ? transform(current) : current));
  }

  function updateSectionField(country: WorkCountry, field: 'title' | 'description', value: string) {
    updateDraft((current) => ({
      ...current,
      sections: {
        ...current.sections,
        [country]: {
          ...current.sections[country],
          [field]: value,
        },
      },
    }));
  }

  function updateResourceField(country: WorkCountry, resourceId: string, field: 'title' | 'description' | 'buttonLabel', value: string) {
    updateDraft((current) => ({
      ...current,
      sections: {
        ...current.sections,
        [country]: {
          ...current.sections[country],
          resources: current.sections[country].resources.map((resource) => (
            resource.id === resourceId ? { ...resource, [field]: value } : resource
          )),
        },
      },
    }));
  }

  function updateFileLabel(country: WorkCountry, resourceId: string, fileId: string, value: string) {
    updateDraft((current) => ({
      ...current,
      sections: {
        ...current.sections,
        [country]: {
          ...current.sections[country],
          resources: current.sections[country].resources.map((resource) => {
            if (resource.id !== resourceId) {
              return resource;
            }

            return {
              ...resource,
              files: resource.files.map((file) => (
                file.id === fileId ? { ...file, label: value } : file
              )),
            };
          }),
        },
      },
    }));
  }

  function addResource(country: WorkCountry, kind: WellbeingResourceKind) {
    updateDraft((current) => ({
      ...current,
      sections: {
        ...current.sections,
        [country]: {
          ...current.sections[country],
          resources: [
            ...current.sections[country].resources,
            kind === 'pdf' ? createEmptyPdfResource(country) : createEmptyFormResource(country),
          ],
        },
      },
    }));
  }

  function removeResource(country: WorkCountry, resourceId: string) {
    updateDraft((current) => ({
      ...current,
      sections: {
        ...current.sections,
        [country]: {
          ...current.sections[country],
          resources: current.sections[country].resources.filter((resource) => resource.id !== resourceId),
        },
      },
    }));
  }

  function removeFile(country: WorkCountry, resourceId: string, fileId: string) {
    updateDraft((current) => ({
      ...current,
      sections: {
        ...current.sections,
        [country]: {
          ...current.sections[country],
          resources: current.sections[country].resources.map((resource) => {
            if (resource.id !== resourceId) {
              return resource;
            }

            return {
              ...resource,
              files: resource.files.filter((file) => file.id !== fileId),
            };
          }),
        },
      },
    }));
  }

  async function uploadPdf(country: WorkCountry, resourceId: string, event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';

    if (!file) {
      return;
    }

    if (file.type !== 'application/pdf') {
      showToast('error', 'Só é possível carregar ficheiros PDF nesta área.');
      return;
    }

    const token = localStorage.getItem(STORAGE_TOKEN_KEY) || '';
    const formData = new FormData();
    formData.append('file', file);
    setUploadingKey(resourceId);

    try {
      const response = await fetch(`${getApiBase()}/files/upload`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
        body: formData,
      });

      const payload = await response.json().catch(() => ({} as Record<string, unknown>));
      if (!response.ok) {
        throw new Error(String(payload.message || payload.error || 'Falha ao carregar PDF.'));
      }

      const fileResponse = payload as UploadResponse;
      updateDraft((current) => ({
        ...current,
        sections: {
          ...current.sections,
          [country]: {
            ...current.sections[country],
            resources: current.sections[country].resources.map((resource) => {
              if (resource.id !== resourceId) {
                return resource;
              }

              return {
                ...resource,
                files: [
                  ...resource.files,
                  {
                    id: createResourceId('file'),
                    label: fileResponse.fileName,
                    fileName: fileResponse.fileName,
                    linkPath: fileResponse.linkPath,
                    link: fileResponse.link,
                  },
                ],
              };
            }),
          },
        },
      }));
      showToast('success', 'PDF carregado com sucesso.');
    } catch (error) {
      showToast('error', error instanceof Error ? error.message : 'Falha ao carregar PDF.');
    } finally {
      setUploadingKey(null);
    }
  }

  async function saveContent() {
    if (!draft) {
      return;
    }

    setIsSaving(true);
    try {
      clearApiCache('/wellbeing/content');
      const response = await apiRequest<WellbeingContent>('/wellbeing/content', {
        method: 'PUT',
        headers: authHeaders(localStorage.getItem(STORAGE_TOKEN_KEY) || ''),
        body: JSON.stringify(draft),
      });
      setContent(response);
      setDraft(response);
      setIsEditing(false);
      showToast('success', 'Página Saúde e bem-estar atualizada.');
    } catch (error) {
      showToast('error', error instanceof Error ? error.message : 'Não foi possível guardar a página.');
    } finally {
      setIsSaving(false);
    }
  }

  function cancelEditing() {
    setDraft(content);
    setIsEditing(false);
  }

  async function submitHarassmentReport() {
    setIsSubmittingReport(true);
    try {
      const response = await apiRequest<{ message: string }>('/wellbeing/harassment-report', {
        method: 'POST',
        headers: authHeaders(localStorage.getItem(STORAGE_TOKEN_KEY) || ''),
        body: JSON.stringify(reportDraft),
      });
      showToast('success', response.message || 'Reporte enviado com sucesso.');
      setReportDraft({ subject: '', description: '', preferredContact: '' });
      setIsReportModalOpen(false);
    } catch (error) {
      showToast('error', error instanceof Error ? error.message : 'Não foi possível enviar o reporte.');
    } finally {
      setIsSubmittingReport(false);
    }
  }

  return (
    <section className="trainings-shell wellbeing-shell">
      <div className="wellbeing-shell__topbar">
        <div className="wellbeing-shell__topbar-actions">
          {canManage && canSwitchCountry && (
            <div className="wellbeing-shell__country-switch" role="tablist" aria-label="País a visualizar">
              {(['PT', 'BR'] as WorkCountry[]).map((country) => (
                <button
                  key={country}
                  type="button"
                  className={activeCountry === country ? 'is-active' : ''}
                  onClick={() => setActiveCountry(country)}
                >
                  {country === 'PT' ? 'Portugal' : 'Brasil'}
                </button>
              ))}
            </div>
          )}

          {canManage && !canSwitchCountry && (
            <span className="wellbeing-shell__scope-tag">
              Âmbito: {profileCountry === 'PT' ? 'Portugal' : 'Brasil'}
            </span>
          )}

          {canManage && !isEditing && (
            <Button type="button" variant="secondary" onClick={() => setIsEditing(true)}>
              Editar página
            </Button>
          )}

          {canManage && isEditing && (
            <>
              <Button type="button" variant="ghost" onClick={cancelEditing} disabled={isSaving}>
                Cancelar
              </Button>
              <Button type="button" variant="primary" onClick={() => void saveContent()} isLoading={isSaving}>
                Guardar alterações
              </Button>
            </>
          )}
        </div>
      </div>

      {isLoading ? (
        <div className="wellbeing-shell__loading">A carregar página…</div>
      ) : visibleContent && section ? (
        <>
          <section className="wellbeing-country-card">
            {isEditing ? (
              <div className="wellbeing-editor-card__grid">
                <label className="wellbeing-editor-card__field">
                  <span>Título da secção</span>
                  <input value={section.title} onChange={(event) => updateSectionField(activeCountry, 'title', event.target.value)} />
                </label>
                <label className="wellbeing-editor-card__field wellbeing-editor-card__field--full">
                  <span>Descrição da secção</span>
                  <textarea rows={3} value={section.description} onChange={(event) => updateSectionField(activeCountry, 'description', event.target.value)} />
                </label>
              </div>
            ) : (
              <div className="wellbeing-country-card__head">
                <h2>{section.title || (activeCountry === 'PT' ? 'Portugal' : 'Brasil')}</h2>
              </div>
            )}

            <div className="wellbeing-grid">
              {section.resources.map((resource) => (
                <article key={resource.id} className={`wellbeing-card wellbeing-card--${resource.kind}`}>
                  {isEditing && (
                    <div className="wellbeing-card__actions">
                      <Button type="button" variant="ghost" size="sm" onClick={() => removeResource(activeCountry, resource.id)}>
                        Remover bloco
                      </Button>
                    </div>
                  )}

                  {isEditing ? (
                    <div className="wellbeing-editor-card__grid wellbeing-editor-card__grid--resource">
                      <label className="wellbeing-editor-card__field">
                        <span>Título</span>
                        <input value={resource.title} onChange={(event) => updateResourceField(activeCountry, resource.id, 'title', event.target.value)} />
                      </label>
                      <label className="wellbeing-editor-card__field wellbeing-editor-card__field--full">
                        <span>Descrição</span>
                        <textarea rows={3} value={resource.description} onChange={(event) => updateResourceField(activeCountry, resource.id, 'description', event.target.value)} />
                      </label>
                      <label className="wellbeing-editor-card__field">
                        <span>Texto do botão</span>
                        <input value={resource.buttonLabel} onChange={(event) => updateResourceField(activeCountry, resource.id, 'buttonLabel', event.target.value)} />
                      </label>

                      {resource.kind === 'pdf' && (
                        <div className="wellbeing-files-editor">
                          <div className="wellbeing-files-editor__header">
                            <strong>PDFs associados</strong>
                            <label className="wellbeing-upload-btn">
                              <input type="file" accept="application/pdf,.pdf" onChange={(event) => void uploadPdf(activeCountry, resource.id, event)} />
                              {uploadingKey === resource.id ? 'A carregar…' : 'Adicionar PDF'}
                            </label>
                          </div>

                          {resource.files.length === 0 ? (
                            <p className="wellbeing-files-editor__empty">Ainda não há PDFs neste bloco.</p>
                          ) : (
                            <div className="wellbeing-files-editor__list">
                              {resource.files.map((file) => (
                                <div key={file.id} className="wellbeing-files-editor__row">
                                  <input value={file.label} onChange={(event) => updateFileLabel(activeCountry, resource.id, file.id, event.target.value)} />
                                  <a href={file.link} target="_blank" rel="noreferrer">Ver PDF</a>
                                  <Button type="button" variant="ghost" size="sm" onClick={() => removeFile(activeCountry, resource.id, file.id)}>
                                    Remover
                                  </Button>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ) : (
                    <>
                      <h3>{resource.title}</h3>

                      {resource.kind === 'pdf' ? (
                        resource.files.length > 0 ? (
                          <div className="wellbeing-card__actions">
                            {resource.files.map((file) => (
                              <a key={file.id} className="wellbeing-card__link" href={file.link} target="_blank" rel="noreferrer">
                                {file.label || resource.buttonLabel || 'Abrir PDF'}
                              </a>
                            ))}
                          </div>
                        ) : (
                          <div className="wellbeing-card__empty">Sem PDFs disponíveis neste momento.</div>
                        )
                      ) : (
                        <div className="wellbeing-card__actions">
                          <Button type="button" variant="primary" onClick={() => setIsReportModalOpen(true)}>
                            {resource.buttonLabel || 'Reportar situação'}
                          </Button>
                        </div>
                      )}
                    </>
                  )}
                </article>
              ))}
            </div>

            {isEditing && (
              <div className="wellbeing-editor-actions">
                <Button type="button" variant="ghost" onClick={() => addResource(activeCountry, 'pdf')}>
                  + Bloco PDF
                </Button>
                <Button type="button" variant="ghost" onClick={() => addResource(activeCountry, 'form')}>
                  + Bloco formulário
                </Button>
              </div>
            )}
          </section>
        </>
      ) : (
        <div className="wellbeing-shell__loading">Não foi possível apresentar esta área.</div>
      )}

      <Modal
        open={isReportModalOpen}
        title="Reportar situação"
        onClose={() => !isSubmittingReport && setIsReportModalOpen(false)}
        width="min(680px, calc(100vw - 32px))"
        footer={(
          <>
            <Button type="button" variant="ghost" onClick={() => setIsReportModalOpen(false)} disabled={isSubmittingReport}>
              Cancelar
            </Button>
            <Button type="button" variant="primary" onClick={() => void submitHarassmentReport()} isLoading={isSubmittingReport}>
              Enviar reporte
            </Button>
          </>
        )}
      >
        <div className="wellbeing-report-form">
          <p className="wellbeing-report-form__intro">
            O reporte será notificado ao RH do país respetivo e ao t.people. Usa este canal para situações que precisem de acompanhamento formal.
          </p>
          <label className="wellbeing-editor-card__field">
            <span>Assunto</span>
            <input value={reportDraft.subject} onChange={(event) => setReportDraft((current) => ({ ...current, subject: event.target.value }))} />
          </label>
          <label className="wellbeing-editor-card__field wellbeing-editor-card__field--full">
            <span>Descrição</span>
            <textarea rows={6} value={reportDraft.description} onChange={(event) => setReportDraft((current) => ({ ...current, description: event.target.value }))} />
          </label>
          <label className="wellbeing-editor-card__field wellbeing-editor-card__field--full">
            <span>Contacto preferencial</span>
            <input
              placeholder="Ex.: email pessoal, Teams ou telemóvel"
              value={reportDraft.preferredContact}
              onChange={(event) => setReportDraft((current) => ({ ...current, preferredContact: event.target.value }))}
            />
          </label>
        </div>
      </Modal>

      <Toast show={toast.visible} tone={toast.tone} message={toast.message} onClose={hideToast} />
    </section>
  );
}