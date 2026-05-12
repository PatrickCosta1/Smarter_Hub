import { type ChangeEvent, useEffect, useMemo, useState } from 'react';
import Button from '../components/ui/Button';
import Modal from '../components/ui/Modal';
import Toast from '../components/ui/Toast';
import { apiRequest, apiRequestCached, clearApiCache, authHeaders, getApiBase } from '../portal/api';
import { usePortal } from '../portal/context';
import { useFeedbackToast } from '../portal/useFeedbackToast';

const STORAGE_TOKEN_KEY = 'smarter_hub_auth_token';

type WorkCountry = 'PT' | 'BR';
type WellbeingTab = 'GENERAL' | WorkCountry;
type WellbeingResourceKind = 'pdf' | 'form';

type WellbeingFile = {
  id: string;
  label: string;
  fileName: string;
  linkPath: string;
  link: string;
};

type WellbeingReportConfig = {
  modalTitle: string;
  introTitle: string;
  introText: string;
  subjectLabel: string;
  subjectPlaceholder: string;
  descriptionLabel: string;
  descriptionPlaceholder: string;
  preferredContactLabel: string;
  preferredContactPlaceholder: string;
  submitLabel: string;
  cancelLabel: string;
};

type WellbeingResource = {
  id: string;
  kind: WellbeingResourceKind;
  title: string;
  description: string;
  buttonLabel: string;
  files: WellbeingFile[];
  reportConfig?: WellbeingReportConfig;
};

type WellbeingSection = {
  title: string;
  description: string;
  resources: WellbeingResource[];
};

type WellbeingContent = {
  sections: Record<WorkCountry, WellbeingSection>;
};

const DEFAULT_REPORT_CONFIG: WellbeingReportConfig = {
  modalTitle: 'Reportar situação',
  introTitle: 'Canal confidencial de reporte',
  introText: 'O reporte será notificado ao RH do país respetivo e ao t.people. Usa este canal para situações que precisem de acompanhamento formal.',
  subjectLabel: 'Assunto',
  subjectPlaceholder: 'Ex.: Situação de assédio verbal',
  descriptionLabel: 'Descrição detalhada',
  descriptionPlaceholder: 'Descreve o ocorrido com contexto, datas aproximadas e pessoas envolvidas.',
  preferredContactLabel: 'Contacto preferencial',
  preferredContactPlaceholder: 'Ex.: email pessoal, Teams ou telemóvel',
  submitLabel: 'Enviar reporte',
  cancelLabel: 'Cancelar',
};

function getReportConfig(resource: WellbeingResource | null | undefined): WellbeingReportConfig {
  return {
    ...DEFAULT_REPORT_CONFIG,
    ...(resource?.reportConfig ?? {}),
  };
}

type SharedWellbeingKey = 'formulario_assedio' | 'ergonomia' | 'suporte_basico_vida';

const SHARED_WELLBEING_RESOURCE_IDS: Record<SharedWellbeingKey, string> = {
  formulario_assedio: 'common-formulario-assedio',
  ergonomia: 'common-ergonomia',
  suporte_basico_vida: 'common-suporte-basico-vida',
};

function normalizeText(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function classifySharedWellbeingResource(resource: WellbeingResource): SharedWellbeingKey | null {
  const normalizedId = normalizeText(resource.id);
  if (normalizedId === SHARED_WELLBEING_RESOURCE_IDS.formulario_assedio) {
    return 'formulario_assedio';
  }
  if (normalizedId === SHARED_WELLBEING_RESOURCE_IDS.ergonomia) {
    return 'ergonomia';
  }
  if (normalizedId === SHARED_WELLBEING_RESOURCE_IDS.suporte_basico_vida) {
    return 'suporte_basico_vida';
  }

  const title = normalizeText(resource.title);
  if (resource.kind === 'form' && (title.includes('assedio') || title.includes('reportar assedio'))) {
    return 'formulario_assedio';
  }
  if (title.includes('ergonomia')) {
    return 'ergonomia';
  }
  if (title.includes('suporte basico de vida')) {
    return 'suporte_basico_vida';
  }

  return null;
}

function getSharedResources(section: WellbeingSection): WellbeingResource[] {
  const picked = new Map<SharedWellbeingKey, WellbeingResource>();
  for (const resource of section.resources) {
    const key = classifySharedWellbeingResource(resource);
    if (!key || picked.has(key)) {
      continue;
    }

    picked.set(key, { ...resource, id: SHARED_WELLBEING_RESOURCE_IDS[key] });
  }

  return [
    picked.get('formulario_assedio'),
    picked.get('ergonomia'),
    picked.get('suporte_basico_vida'),
  ].filter((resource): resource is WellbeingResource => Boolean(resource));
}

function getCountrySpecificResources(section: WellbeingSection): WellbeingResource[] {
  return section.resources.filter((resource) => !classifySharedWellbeingResource(resource));
}

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
    reportConfig: { ...DEFAULT_REPORT_CONFIG },
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
  const [activeTab, setActiveTab] = useState<WellbeingTab>('GENERAL');
  const [content, setContent] = useState<WellbeingContent | null>(null);
  const [draft, setDraft] = useState<WellbeingContent | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [uploadingKey, setUploadingKey] = useState<string | null>(null);
  const [isReportModalOpen, setIsReportModalOpen] = useState(false);
  const [isSubmittingReport, setIsSubmittingReport] = useState(false);
  const [activeReportResource, setActiveReportResource] = useState<WellbeingResource | null>(null);
  const [reportDraft, setReportDraft] = useState({
    subject: '',
    description: '',
    preferredContact: '',
  });
  const { toast, showToast, hideToast } = useFeedbackToast(3600);

  useEffect(() => {
    if (canSwitchCountry) {
      return;
    }

    if (activeTab !== 'GENERAL' && activeTab !== profileCountry) {
      setActiveTab('GENERAL');
    }
  }, [activeTab, canSwitchCountry, profileCountry]);

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
  const visibleTabs = canSwitchCountry ? (['GENERAL', 'PT', 'BR'] as WellbeingTab[]) : (['GENERAL', profileCountry] as WellbeingTab[]);
  const isGeneralTab = activeTab === 'GENERAL';
  const isCountryTab = activeTab === 'PT' || activeTab === 'BR';

  const section = useMemo(() => {
    if (!visibleContent) {
      return null;
    }

    if (activeTab === 'GENERAL') {
      const shared = getSharedResources(visibleContent.sections.PT);
      return {
        title: 'Geral',
        description: 'Tudo o que é comum às duas geografias.',
        resources: shared,
      } satisfies WellbeingSection;
    }

    const base = visibleContent.sections[activeTab];
    return {
      ...base,
      resources: getCountrySpecificResources(base),
    } satisfies WellbeingSection;
  }, [activeTab, visibleContent]);

  const hasTopbarControls = canManage;
  const activeReportConfig = getReportConfig(activeReportResource);

  function updateSharedResourceField(resourceId: string, field: 'title' | 'description' | 'buttonLabel', value: string) {
    updateDraft((current) => {
      const patchCountry = (country: WorkCountry) => ({
        ...current.sections[country],
        resources: current.sections[country].resources.map((resource) => (
          resource.id === resourceId ? { ...resource, [field]: value } : resource
        )),
      });

      return {
        ...current,
        sections: {
          ...current.sections,
          PT: patchCountry('PT'),
          BR: patchCountry('BR'),
        },
      };
    });
  }

  function updateSharedFileLabel(resourceId: string, fileId: string, value: string) {
    updateDraft((current) => {
      const patchCountry = (country: WorkCountry) => ({
        ...current.sections[country],
        resources: current.sections[country].resources.map((resource) => {
          if (resource.id !== resourceId) {
            return resource;
          }

          return {
            ...resource,
            files: resource.files.map((file) => (file.id === fileId ? { ...file, label: value } : file)),
          };
        }),
      });

      return {
        ...current,
        sections: {
          ...current.sections,
          PT: patchCountry('PT'),
          BR: patchCountry('BR'),
        },
      };
    });
  }

  function updateSharedReportConfig(resourceId: string, field: keyof WellbeingReportConfig, value: string) {
    updateDraft((current) => {
      const patchCountry = (country: WorkCountry) => ({
        ...current.sections[country],
        resources: current.sections[country].resources.map((resource) => {
          if (resource.id !== resourceId) {
            return resource;
          }

          return {
            ...resource,
            reportConfig: {
              ...getReportConfig(resource),
              [field]: value,
            },
          };
        }),
      });

      return {
        ...current,
        sections: {
          ...current.sections,
          PT: patchCountry('PT'),
          BR: patchCountry('BR'),
        },
      };
    });
  }

  function removeSharedFile(resourceId: string, fileId: string) {
    updateDraft((current) => {
      const patchCountry = (country: WorkCountry) => ({
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
      });

      return {
        ...current,
        sections: {
          ...current.sections,
          PT: patchCountry('PT'),
          BR: patchCountry('BR'),
        },
      };
    });
  }

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

  function updateResourceReportConfig(country: WorkCountry, resourceId: string, field: keyof WellbeingReportConfig, value: string) {
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
              reportConfig: {
                ...getReportConfig(resource),
                [field]: value,
              },
            };
          }),
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

  async function uploadFile(country: WorkCountry | 'GENERAL', resourceId: string, event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';

    if (!file) {
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
        throw new Error(String(payload.message || payload.error || 'Falha ao carregar ficheiro.'));
      }

      const fileResponse = payload as UploadResponse;
      updateDraft((current) => {
        const newFile = {
          id: createResourceId('file'),
          label: fileResponse.fileName,
          fileName: fileResponse.fileName,
          linkPath: fileResponse.linkPath,
          link: fileResponse.link,
        };

        if (country === 'GENERAL') {
          const patchCountry = (targetCountry: WorkCountry) => ({
            ...current.sections[targetCountry],
            resources: current.sections[targetCountry].resources.map((resource) => (
              resource.id === resourceId
                ? {
                  ...resource,
                  files: [...resource.files, newFile],
                }
                : resource
            )),
          });

          return {
            ...current,
            sections: {
              ...current.sections,
              PT: patchCountry('PT'),
              BR: patchCountry('BR'),
            },
          };
        }

        return {
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
                  files: [...resource.files, newFile],
                };
              }),
            },
          },
        };
      });
      showToast('success', 'Ficheiro carregado com sucesso.');
    } catch (error) {
      showToast('error', error instanceof Error ? error.message : 'Falha ao carregar ficheiro.');
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
      setActiveReportResource(null);
    } catch (error) {
      showToast('error', error instanceof Error ? error.message : 'Não foi possível enviar o reporte.');
    } finally {
      setIsSubmittingReport(false);
    }
  }

  return (
    <section className="trainings-shell wellbeing-shell">
      {hasTopbarControls && (
        <div className="wellbeing-shell__topbar">
          <div className="wellbeing-shell__topbar-actions">
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
      )}

      <div className="wellbeing-shell__tabs" role="tablist" aria-label="Vista de saúde e bem-estar">
        {visibleTabs.map((tab) => (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={activeTab === tab}
            className={activeTab === tab ? 'is-active' : ''}
            onClick={() => setActiveTab(tab)}
          >
            {tab === 'GENERAL' ? 'Geral' : tab === 'PT' ? 'Portugal' : 'Brasil'}
          </button>
        ))}
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
                  <input
                    value={section.title}
                    onChange={(event) => {
                      if (isCountryTab) {
                        updateSectionField(activeTab, 'title', event.target.value);
                      }
                    }}
                    disabled={!isCountryTab}
                  />
                </label>
                <label className="wellbeing-editor-card__field wellbeing-editor-card__field--full">
                  <span>Descrição da secção</span>
                  <textarea
                    rows={3}
                    value={section.description}
                    onChange={(event) => {
                      if (isCountryTab) {
                        updateSectionField(activeTab, 'description', event.target.value);
                      }
                    }}
                    disabled={!isCountryTab}
                  />
                </label>
              </div>
            ) : (
              <div className="wellbeing-country-card__head">
                <h2>{section.title || (activeTab === 'BR' ? 'Brasil' : activeTab === 'PT' ? 'Portugal' : 'Geral')}</h2>
              </div>
            )}

            <div className="wellbeing-grid">
              {section.resources.map((resource) => (
                <article key={resource.id} className={`wellbeing-card wellbeing-card--${resource.kind}`}>
                  {isEditing && (
                    <div className="wellbeing-card__actions">
                      <Button type="button" variant="ghost" size="sm" onClick={() => isCountryTab && removeResource(activeTab, resource.id)} disabled={!isCountryTab}>
                        Remover bloco
                      </Button>
                    </div>
                  )}

                  {isEditing ? (
                    <div className="wellbeing-editor-card__grid wellbeing-editor-card__grid--resource">
                      <label className="wellbeing-editor-card__field">
                        <span>Título</span>
                        <input
                          value={resource.title}
                          onChange={(event) => {
                            if (isGeneralTab) {
                              updateSharedResourceField(resource.id, 'title', event.target.value);
                              return;
                            }

                            if (isCountryTab) {
                              updateResourceField(activeTab, resource.id, 'title', event.target.value);
                            }
                          }}
                        />
                      </label>
                      <label className="wellbeing-editor-card__field wellbeing-editor-card__field--full">
                        <span>Descrição</span>
                        <textarea
                          rows={3}
                          value={resource.description}
                          onChange={(event) => {
                            if (isGeneralTab) {
                              updateSharedResourceField(resource.id, 'description', event.target.value);
                              return;
                            }

                            if (isCountryTab) {
                              updateResourceField(activeTab, resource.id, 'description', event.target.value);
                            }
                          }}
                        />
                      </label>
                      <label className="wellbeing-editor-card__field">
                        <span>Texto do botão</span>
                        <input
                          value={resource.buttonLabel}
                          onChange={(event) => {
                            if (isGeneralTab) {
                              updateSharedResourceField(resource.id, 'buttonLabel', event.target.value);
                              return;
                            }

                            if (isCountryTab) {
                              updateResourceField(activeTab, resource.id, 'buttonLabel', event.target.value);
                            }
                          }}
                        />
                      </label>

                      <div className="wellbeing-files-editor">
                        <div className="wellbeing-files-editor__header">
                          <strong>Ficheiros associados (PDF ou vídeo)</strong>
                          <label className="wellbeing-upload-btn">
                            <input type="file" accept="application/pdf,.pdf,video/*,.mp4,.mov,.avi,.webm,.mkv" onChange={(event) => void uploadFile(isGeneralTab ? 'GENERAL' : activeTab, resource.id, event)} />
                            {uploadingKey === resource.id ? 'A carregar…' : 'Adicionar ficheiro'}
                          </label>
                        </div>

                        {resource.files.length === 0 ? (
                          <p className="wellbeing-files-editor__empty">Ainda não há ficheiros neste bloco.</p>
                        ) : (
                          <div className="wellbeing-files-editor__list">
                            {resource.files.map((file) => (
                              <div key={file.id} className="wellbeing-files-editor__row">
                                <input
                                  value={file.label}
                                  onChange={(event) => {
                                    if (isGeneralTab) {
                                      updateSharedFileLabel(resource.id, file.id, event.target.value);
                                      return;
                                    }

                                    if (isCountryTab) {
                                      updateFileLabel(activeTab, resource.id, file.id, event.target.value);
                                    }
                                  }}
                                />
                                <a href={file.link} target="_blank" rel="noreferrer">Abrir</a>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => {
                                    if (isGeneralTab) {
                                      removeSharedFile(resource.id, file.id);
                                      return;
                                    }

                                    if (isCountryTab) {
                                      removeFile(activeTab, resource.id, file.id);
                                    }
                                  }}
                                >
                                  Remover
                                </Button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      {resource.kind === 'form' && (
                        <div className="wellbeing-files-editor">
                          <div className="wellbeing-files-editor__header">
                            <strong>Configuração do formulário de reporte</strong>
                          </div>
                          <div className="wellbeing-editor-card__grid wellbeing-editor-card__grid--resource">
                            <label className="wellbeing-editor-card__field">
                              <span>Título do modal</span>
                              <input
                                value={getReportConfig(resource).modalTitle}
                                onChange={(event) => {
                                  if (isGeneralTab) {
                                    updateSharedReportConfig(resource.id, 'modalTitle', event.target.value);
                                    return;
                                  }
                                  if (isCountryTab) {
                                    updateResourceReportConfig(activeTab, resource.id, 'modalTitle', event.target.value);
                                  }
                                }}
                              />
                            </label>
                            <label className="wellbeing-editor-card__field">
                              <span>Título da introdução</span>
                              <input
                                value={getReportConfig(resource).introTitle}
                                onChange={(event) => {
                                  if (isGeneralTab) {
                                    updateSharedReportConfig(resource.id, 'introTitle', event.target.value);
                                    return;
                                  }
                                  if (isCountryTab) {
                                    updateResourceReportConfig(activeTab, resource.id, 'introTitle', event.target.value);
                                  }
                                }}
                              />
                            </label>
                            <label className="wellbeing-editor-card__field wellbeing-editor-card__field--full">
                              <span>Texto da introdução</span>
                              <textarea
                                rows={3}
                                value={getReportConfig(resource).introText}
                                onChange={(event) => {
                                  if (isGeneralTab) {
                                    updateSharedReportConfig(resource.id, 'introText', event.target.value);
                                    return;
                                  }
                                  if (isCountryTab) {
                                    updateResourceReportConfig(activeTab, resource.id, 'introText', event.target.value);
                                  }
                                }}
                              />
                            </label>
                            <label className="wellbeing-editor-card__field">
                              <span>Label de assunto</span>
                              <input
                                value={getReportConfig(resource).subjectLabel}
                                onChange={(event) => {
                                  if (isGeneralTab) {
                                    updateSharedReportConfig(resource.id, 'subjectLabel', event.target.value);
                                    return;
                                  }
                                  if (isCountryTab) {
                                    updateResourceReportConfig(activeTab, resource.id, 'subjectLabel', event.target.value);
                                  }
                                }}
                              />
                            </label>
                            <label className="wellbeing-editor-card__field">
                              <span>Placeholder de assunto</span>
                              <input
                                value={getReportConfig(resource).subjectPlaceholder}
                                onChange={(event) => {
                                  if (isGeneralTab) {
                                    updateSharedReportConfig(resource.id, 'subjectPlaceholder', event.target.value);
                                    return;
                                  }
                                  if (isCountryTab) {
                                    updateResourceReportConfig(activeTab, resource.id, 'subjectPlaceholder', event.target.value);
                                  }
                                }}
                              />
                            </label>
                            <label className="wellbeing-editor-card__field">
                              <span>Label de contacto</span>
                              <input
                                value={getReportConfig(resource).preferredContactLabel}
                                onChange={(event) => {
                                  if (isGeneralTab) {
                                    updateSharedReportConfig(resource.id, 'preferredContactLabel', event.target.value);
                                    return;
                                  }
                                  if (isCountryTab) {
                                    updateResourceReportConfig(activeTab, resource.id, 'preferredContactLabel', event.target.value);
                                  }
                                }}
                              />
                            </label>
                            <label className="wellbeing-editor-card__field">
                              <span>Placeholder de contacto</span>
                              <input
                                value={getReportConfig(resource).preferredContactPlaceholder}
                                onChange={(event) => {
                                  if (isGeneralTab) {
                                    updateSharedReportConfig(resource.id, 'preferredContactPlaceholder', event.target.value);
                                    return;
                                  }
                                  if (isCountryTab) {
                                    updateResourceReportConfig(activeTab, resource.id, 'preferredContactPlaceholder', event.target.value);
                                  }
                                }}
                              />
                            </label>
                            <label className="wellbeing-editor-card__field">
                              <span>Label de descrição</span>
                              <input
                                value={getReportConfig(resource).descriptionLabel}
                                onChange={(event) => {
                                  if (isGeneralTab) {
                                    updateSharedReportConfig(resource.id, 'descriptionLabel', event.target.value);
                                    return;
                                  }
                                  if (isCountryTab) {
                                    updateResourceReportConfig(activeTab, resource.id, 'descriptionLabel', event.target.value);
                                  }
                                }}
                              />
                            </label>
                            <label className="wellbeing-editor-card__field wellbeing-editor-card__field--full">
                              <span>Placeholder de descrição</span>
                              <textarea
                                rows={2}
                                value={getReportConfig(resource).descriptionPlaceholder}
                                onChange={(event) => {
                                  if (isGeneralTab) {
                                    updateSharedReportConfig(resource.id, 'descriptionPlaceholder', event.target.value);
                                    return;
                                  }
                                  if (isCountryTab) {
                                    updateResourceReportConfig(activeTab, resource.id, 'descriptionPlaceholder', event.target.value);
                                  }
                                }}
                              />
                            </label>
                            <label className="wellbeing-editor-card__field">
                              <span>Texto botão enviar</span>
                              <input
                                value={getReportConfig(resource).submitLabel}
                                onChange={(event) => {
                                  if (isGeneralTab) {
                                    updateSharedReportConfig(resource.id, 'submitLabel', event.target.value);
                                    return;
                                  }
                                  if (isCountryTab) {
                                    updateResourceReportConfig(activeTab, resource.id, 'submitLabel', event.target.value);
                                  }
                                }}
                              />
                            </label>
                            <label className="wellbeing-editor-card__field">
                              <span>Texto botão cancelar</span>
                              <input
                                value={getReportConfig(resource).cancelLabel}
                                onChange={(event) => {
                                  if (isGeneralTab) {
                                    updateSharedReportConfig(resource.id, 'cancelLabel', event.target.value);
                                    return;
                                  }
                                  if (isCountryTab) {
                                    updateResourceReportConfig(activeTab, resource.id, 'cancelLabel', event.target.value);
                                  }
                                }}
                              />
                            </label>
                          </div>
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
                                {file.label || resource.buttonLabel || 'Abrir ficheiro'}
                              </a>
                            ))}
                          </div>
                        ) : (
                          <div className="wellbeing-card__empty">Sem ficheiros disponíveis neste momento.</div>
                        )
                      ) : (
                        <div className="wellbeing-card__actions">
                          <Button
                            type="button"
                            variant="primary"
                            onClick={() => {
                              setActiveReportResource(resource);
                              setIsReportModalOpen(true);
                            }}
                          >
                            {resource.buttonLabel || 'Reportar situação'}
                          </Button>
                          {resource.files.map((file) => (
                            <a key={file.id} className="wellbeing-card__link" href={file.link} target="_blank" rel="noreferrer">
                              {file.label || 'Abrir ficheiro'}
                            </a>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </article>
              ))}
            </div>

            {isEditing && (
              <div className="wellbeing-editor-actions">
                <Button type="button" variant="ghost" onClick={() => isCountryTab && addResource(activeTab, 'pdf')} disabled={!isCountryTab}>
                  + Bloco PDF
                </Button>
                <Button type="button" variant="ghost" onClick={() => isCountryTab && addResource(activeTab, 'form')} disabled={!isCountryTab}>
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
        title={activeReportConfig.modalTitle}
        onClose={() => {
          if (!isSubmittingReport) {
            setIsReportModalOpen(false);
            setActiveReportResource(null);
          }
        }}
        width="min(680px, calc(100vw - 32px))"
        footer={(
          <>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setIsReportModalOpen(false);
                setActiveReportResource(null);
              }}
              disabled={isSubmittingReport}
            >
              {activeReportConfig.cancelLabel}
            </Button>
            <Button type="button" variant="primary" onClick={() => void submitHarassmentReport()} isLoading={isSubmittingReport}>
              {activeReportConfig.submitLabel}
            </Button>
          </>
        )}
      >
        <div className="wellbeing-report-form">
          <div className="wellbeing-report-form__intro">
            <h3>{activeReportConfig.introTitle}</h3>
            <p>{activeReportConfig.introText}</p>
          </div>

          <div className="wellbeing-report-form__grid">
            <label className="wellbeing-editor-card__field">
              <span>{activeReportConfig.subjectLabel}</span>
              <input
                placeholder={activeReportConfig.subjectPlaceholder}
                value={reportDraft.subject}
                onChange={(event) => setReportDraft((current) => ({ ...current, subject: event.target.value }))}
              />
            </label>

            <label className="wellbeing-editor-card__field">
              <span>{activeReportConfig.preferredContactLabel}</span>
              <input
                placeholder={activeReportConfig.preferredContactPlaceholder}
                value={reportDraft.preferredContact}
                onChange={(event) => setReportDraft((current) => ({ ...current, preferredContact: event.target.value }))}
              />
            </label>

            <label className="wellbeing-editor-card__field wellbeing-editor-card__field--full">
              <span>{activeReportConfig.descriptionLabel}</span>
              <textarea
                rows={7}
                placeholder={activeReportConfig.descriptionPlaceholder}
                value={reportDraft.description}
                onChange={(event) => setReportDraft((current) => ({ ...current, description: event.target.value }))}
              />
            </label>
          </div>
        </div>
      </Modal>

      <Toast show={toast.visible} tone={toast.tone} message={toast.message} onClose={hideToast} />
    </section>
  );
}