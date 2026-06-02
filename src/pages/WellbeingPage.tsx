import { type ChangeEvent, useEffect, useMemo, useState } from 'react';
import Button from '../components/ui/Button';
import Modal from '../components/ui/Modal';
import Toast from '../components/ui/Toast';
import { apiRequest, apiRequestCached, clearApiCache, authHeaders, getApiBase } from '../portal/api';
import { getStoredAuthToken } from '../portal/auth-storage';
import { usePortal } from '../portal/context';
import { useFeedbackToast } from '../portal/useFeedbackToast';

type WorkCountry = 'PT' | 'BR';
type WellbeingTab = 'GENERAL' | WorkCountry;
type WellbeingResourceKind = 'pdf' | 'form';
type WellbeingEditorSubtab = 'section' | 'blocks' | 'report';

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
  modalTitle: 'Reclame Aqui',
  introTitle: 'Canal confidencial Reclame Aqui',
  introText: 'A tua reclamação chega diretamente a t.people com prioridade. Descreve o caso com clareza, contexto e contacto preferencial.',
  subjectLabel: 'Assunto',
  subjectPlaceholder: 'Ex.: Reclamação sobre saúde e bem-estar',
  descriptionLabel: 'Descrição detalhada',
  descriptionPlaceholder: 'Descreve o ocorrido, contexto, datas aproximadas, locais e pessoas envolvidas.',
  preferredContactLabel: 'Contacto preferencial',
  preferredContactPlaceholder: 'Ex.: email pessoal, Teams ou telemóvel',
  submitLabel: 'Enviar reclamação',
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
  const [editorSubtab, setEditorSubtab] = useState<WellbeingEditorSubtab>('section');
  const [selectedEditorResourceId, setSelectedEditorResourceId] = useState('');
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
      headers: authHeaders(getStoredAuthToken()),
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

  const editorResources = section?.resources ?? [];
  const reportResources = editorResources.filter((resource) => resource.kind === 'form');
  const selectedEditorResource = editorResources.find((resource) => resource.id === selectedEditorResourceId) ?? editorResources[0] ?? null;
  const selectedReportResource = reportResources.find((resource) => resource.id === selectedEditorResourceId) ?? reportResources[0] ?? null;

  const hasTopbarControls = canManage;
  const activeReportConfig = getReportConfig(activeReportResource);

  useEffect(() => {
    if (!isEditing) {
      return;
    }

    if (!selectedEditorResourceId && editorResources[0]?.id) {
      setSelectedEditorResourceId(editorResources[0].id);
    }
  }, [editorResources, isEditing, selectedEditorResourceId]);

  useEffect(() => {
    if (!isEditing) {
      return;
    }

    if (selectedEditorResourceId && editorResources.some((resource) => resource.id === selectedEditorResourceId)) {
      return;
    }

    setSelectedEditorResourceId(editorResources[0]?.id ?? '');
  }, [editorResources, isEditing, selectedEditorResourceId]);

  useEffect(() => {
    if (!isEditing) {
      setEditorSubtab('section');
      return;
    }

    if (editorSubtab === 'report' && reportResources.length === 0) {
      setEditorSubtab(editorResources.length > 0 ? 'blocks' : 'section');
    }
  }, [editorResources.length, editorSubtab, isEditing, reportResources.length]);

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

    const token = getStoredAuthToken();
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
        headers: authHeaders(getStoredAuthToken()),
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
      const response = await apiRequest<{ message: string }>('/wellbeing/complaint', {
        method: 'POST',
        headers: authHeaders(getStoredAuthToken()),
        body: JSON.stringify(reportDraft),
      });
      showToast('success', response.message || 'Reclamação enviada com sucesso.');
      setReportDraft({ subject: '', description: '', preferredContact: '' });
      setIsReportModalOpen(false);
      setActiveReportResource(null);
    } catch (error) {
      showToast('error', error instanceof Error ? error.message : 'Não foi possível enviar a reclamação.');
    } finally {
      setIsSubmittingReport(false);
    }
  }

  return (
    <section className={`trainings-shell wellbeing-shell${isEditing ? ' wellbeing-shell--editing' : ''}`}>
      {hasTopbarControls && (
        <div className="wellbeing-shell__topbar">
          <div className="wellbeing-shell__topbar-actions">
            {canManage && !isEditing && (
              <Button type="button" variant="secondary" onClick={() => setIsEditing(true)}>
                Editar página
              </Button>
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
          <section className={`wellbeing-country-card${isEditing ? ' wellbeing-country-card--modal' : ''}`}>
            {isEditing && (
              <div className="wellbeing-edit-modal__head">
                <div className="wellbeing-edit-modal__head-copy">
                  <p>Editor suspenso</p>
                  <strong>Editar página Saúde e bem-estar</strong>
                  <span>Guarda as alterações quando terminares de editar os blocos e o formulário.</span>
                </div>
                <div className="wellbeing-edit-modal__head-actions">
                  <Button type="button" variant="ghost" onClick={cancelEditing} disabled={isSaving}>
                    Cancelar
                  </Button>
                  <Button type="button" variant="primary" onClick={() => void saveContent()} isLoading={isSaving}>
                    Guardar alterações
                  </Button>
                </div>
              </div>
            )}
            {isEditing ? (
              <div className="wellbeing-editor-shell">
                <div className="wellbeing-editor-subtabs" role="tablist" aria-label="Áreas do editor">
                  <button type="button" role="tab" aria-selected={editorSubtab === 'section'} className={editorSubtab === 'section' ? 'is-active' : ''} onClick={() => setEditorSubtab('section')}>
                    Secção
                  </button>
                  <button type="button" role="tab" aria-selected={editorSubtab === 'blocks'} className={editorSubtab === 'blocks' ? 'is-active' : ''} onClick={() => setEditorSubtab('blocks')}>
                    Blocos
                  </button>
                  {reportResources.length > 0 && (
                    <button type="button" role="tab" aria-selected={editorSubtab === 'report'} className={editorSubtab === 'report' ? 'is-active' : ''} onClick={() => setEditorSubtab('report')}>
                      Formulário
                    </button>
                  )}
                </div>

                {editorSubtab === 'section' && (
                  <div className="wellbeing-edit-section-meta">
                    <div className="wellbeing-edit-section-meta__intro">
                      <p>Estrutura da secção</p>
                      <strong>{activeTab === 'GENERAL' ? 'Conteúdo comum às geografias' : `Secção ${activeTab === 'PT' ? 'Portugal' : 'Brasil'}`}</strong>
                      <span>Define o enquadramento visual e textual antes de editar cada bloco de conteúdo.</span>
                    </div>
                    <div className="wellbeing-editor-card__grid wellbeing-edit-section-meta__grid">
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
                  </div>
                )}

                {editorSubtab === 'blocks' && (
                  <div className="wellbeing-editor-panel">
                    <div className="wellbeing-editor-panel__toolbar">
                      <div className="wellbeing-editor-panel__picker" role="tablist" aria-label="Blocos de conteúdo">
                        {editorResources.map((resource) => (
                          <button
                            key={resource.id}
                            type="button"
                            className={selectedEditorResource?.id === resource.id ? 'is-active' : ''}
                            onClick={() => setSelectedEditorResourceId(resource.id)}
                          >
                            <span>{resource.kind === 'form' ? 'Form' : 'Doc'}</span>
                            {resource.title || 'Sem título'}
                          </button>
                        ))}
                      </div>
                      <div className="wellbeing-editor-actions">
                        <Button type="button" variant="ghost" onClick={() => isCountryTab && addResource(activeTab, 'pdf')} disabled={!isCountryTab}>
                          + Bloco PDF
                        </Button>
                        <Button type="button" variant="ghost" onClick={() => isCountryTab && addResource(activeTab, 'form')} disabled={!isCountryTab}>
                          + Bloco formulário
                        </Button>
                      </div>
                    </div>

                    {selectedEditorResource && (
                      <article className={`wellbeing-card wellbeing-card--${selectedEditorResource.kind} wellbeing-card--editor`}>
                        <div className="wellbeing-editor-resource__head">
                          <div className="wellbeing-editor-resource__title">
                            <span className={`wellbeing-editor-resource__kind wellbeing-editor-resource__kind--${selectedEditorResource.kind}`}>
                              {selectedEditorResource.kind === 'form' ? 'Formulário' : 'PDF / Vídeo'}
                            </span>
                            <strong>{selectedEditorResource.title || 'Bloco sem título'}</strong>
                            <small>{selectedEditorResource.kind === 'form' ? 'Canal editável com configuração de reporte' : 'Bloco documental com anexos e call-to-action'}</small>
                          </div>
                          <Button type="button" variant="ghost" size="sm" onClick={() => isCountryTab && removeResource(activeTab, selectedEditorResource.id)} disabled={!isCountryTab}>
                            Remover bloco
                          </Button>
                        </div>

                        <div className="wellbeing-editor-resource__body">
                          <div className="wellbeing-editor-card__grid wellbeing-editor-card__grid--resource">
                            <label className="wellbeing-editor-card__field">
                              <span>Título</span>
                              <input
                                value={selectedEditorResource.title}
                                onChange={(event) => {
                                  if (isGeneralTab) {
                                    updateSharedResourceField(selectedEditorResource.id, 'title', event.target.value);
                                    return;
                                  }
                                  if (isCountryTab) {
                                    updateResourceField(activeTab, selectedEditorResource.id, 'title', event.target.value);
                                  }
                                }}
                              />
                            </label>
                            <label className="wellbeing-editor-card__field wellbeing-editor-card__field--full">
                              <span>Descrição</span>
                              <textarea
                                rows={3}
                                value={selectedEditorResource.description}
                                onChange={(event) => {
                                  if (isGeneralTab) {
                                    updateSharedResourceField(selectedEditorResource.id, 'description', event.target.value);
                                    return;
                                  }
                                  if (isCountryTab) {
                                    updateResourceField(activeTab, selectedEditorResource.id, 'description', event.target.value);
                                  }
                                }}
                              />
                            </label>
                            <label className="wellbeing-editor-card__field">
                              <span>Texto do botão</span>
                              <input
                                value={selectedEditorResource.buttonLabel}
                                onChange={(event) => {
                                  if (isGeneralTab) {
                                    updateSharedResourceField(selectedEditorResource.id, 'buttonLabel', event.target.value);
                                    return;
                                  }
                                  if (isCountryTab) {
                                    updateResourceField(activeTab, selectedEditorResource.id, 'buttonLabel', event.target.value);
                                  }
                                }}
                              />
                            </label>
                          </div>

                          <div className="wellbeing-files-editor">
                            <div className="wellbeing-files-editor__header">
                              <strong>Ficheiros associados (PDF ou vídeo)</strong>
                              <label className="wellbeing-upload-btn">
                                <input type="file" accept="application/pdf,.pdf,video/*,.mp4,.mov,.avi,.webm,.mkv" onChange={(event) => void uploadFile(isGeneralTab ? 'GENERAL' : activeTab, selectedEditorResource.id, event)} />
                                {uploadingKey === selectedEditorResource.id ? 'A carregar…' : 'Adicionar ficheiro'}
                              </label>
                            </div>

                            {selectedEditorResource.files.length === 0 ? (
                              <p className="wellbeing-files-editor__empty">Ainda não há ficheiros neste bloco.</p>
                            ) : (
                              <div className="wellbeing-files-editor__list">
                                {selectedEditorResource.files.map((file) => (
                                  <div key={file.id} className="wellbeing-files-editor__row">
                                    <input
                                      value={file.label}
                                      onChange={(event) => {
                                        if (isGeneralTab) {
                                          updateSharedFileLabel(selectedEditorResource.id, file.id, event.target.value);
                                          return;
                                        }
                                        if (isCountryTab) {
                                          updateFileLabel(activeTab, selectedEditorResource.id, file.id, event.target.value);
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
                                          removeSharedFile(selectedEditorResource.id, file.id);
                                          return;
                                        }
                                        if (isCountryTab) {
                                          removeFile(activeTab, selectedEditorResource.id, file.id);
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
                        </div>
                      </article>
                    )}
                  </div>
                )}

                {editorSubtab === 'report' && selectedReportResource && (
                  <div className="wellbeing-editor-panel">
                    <div className="wellbeing-editor-panel__picker wellbeing-editor-panel__picker--forms" role="tablist" aria-label="Formulários configuráveis">
                      {reportResources.map((resource) => (
                        <button
                          key={resource.id}
                          type="button"
                          className={selectedReportResource.id === resource.id ? 'is-active' : ''}
                          onClick={() => setSelectedEditorResourceId(resource.id)}
                        >
                          <span>Formulário</span>
                          {resource.title || 'Sem título'}
                        </button>
                      ))}
                    </div>

                    <div className="wellbeing-report-config-editor">
                      <div className="wellbeing-report-config-editor__hero">
                        <div>
                          <p className="wellbeing-report-config-editor__eyebrow">Editor do formulário</p>
                          <strong>Configuração do formulário de reporte</strong>
                          <span>Personaliza o modal, microcopy e call-to-actions apresentados ao colaborador.</span>
                        </div>
                      </div>
                      <div className="wellbeing-editor-card__grid wellbeing-editor-card__grid--resource wellbeing-report-config-editor__grid">
                        <label className="wellbeing-editor-card__field">
                          <span>Título do modal</span>
                          <input
                            value={getReportConfig(selectedReportResource).modalTitle}
                            onChange={(event) => {
                              if (isGeneralTab) {
                                updateSharedReportConfig(selectedReportResource.id, 'modalTitle', event.target.value);
                                return;
                              }
                              if (isCountryTab) {
                                updateResourceReportConfig(activeTab, selectedReportResource.id, 'modalTitle', event.target.value);
                              }
                            }}
                          />
                        </label>
                        <label className="wellbeing-editor-card__field">
                          <span>Título da introdução</span>
                          <input
                            value={getReportConfig(selectedReportResource).introTitle}
                            onChange={(event) => {
                              if (isGeneralTab) {
                                updateSharedReportConfig(selectedReportResource.id, 'introTitle', event.target.value);
                                return;
                              }
                              if (isCountryTab) {
                                updateResourceReportConfig(activeTab, selectedReportResource.id, 'introTitle', event.target.value);
                              }
                            }}
                          />
                        </label>
                        <label className="wellbeing-editor-card__field wellbeing-editor-card__field--full">
                          <span>Texto da introdução</span>
                          <textarea
                            rows={3}
                            value={getReportConfig(selectedReportResource).introText}
                            onChange={(event) => {
                              if (isGeneralTab) {
                                updateSharedReportConfig(selectedReportResource.id, 'introText', event.target.value);
                                return;
                              }
                              if (isCountryTab) {
                                updateResourceReportConfig(activeTab, selectedReportResource.id, 'introText', event.target.value);
                              }
                            }}
                          />
                        </label>
                        <label className="wellbeing-editor-card__field">
                          <span>Label de assunto</span>
                          <input
                            value={getReportConfig(selectedReportResource).subjectLabel}
                            onChange={(event) => {
                              if (isGeneralTab) {
                                updateSharedReportConfig(selectedReportResource.id, 'subjectLabel', event.target.value);
                                return;
                              }
                              if (isCountryTab) {
                                updateResourceReportConfig(activeTab, selectedReportResource.id, 'subjectLabel', event.target.value);
                              }
                            }}
                          />
                        </label>
                        <label className="wellbeing-editor-card__field">
                          <span>Placeholder de assunto</span>
                          <input
                            value={getReportConfig(selectedReportResource).subjectPlaceholder}
                            onChange={(event) => {
                              if (isGeneralTab) {
                                updateSharedReportConfig(selectedReportResource.id, 'subjectPlaceholder', event.target.value);
                                return;
                              }
                              if (isCountryTab) {
                                updateResourceReportConfig(activeTab, selectedReportResource.id, 'subjectPlaceholder', event.target.value);
                              }
                            }}
                          />
                        </label>
                        <label className="wellbeing-editor-card__field">
                          <span>Label de contacto</span>
                          <input
                            value={getReportConfig(selectedReportResource).preferredContactLabel}
                            onChange={(event) => {
                              if (isGeneralTab) {
                                updateSharedReportConfig(selectedReportResource.id, 'preferredContactLabel', event.target.value);
                                return;
                              }
                              if (isCountryTab) {
                                updateResourceReportConfig(activeTab, selectedReportResource.id, 'preferredContactLabel', event.target.value);
                              }
                            }}
                          />
                        </label>
                        <label className="wellbeing-editor-card__field">
                          <span>Placeholder de contacto</span>
                          <input
                            value={getReportConfig(selectedReportResource).preferredContactPlaceholder}
                            onChange={(event) => {
                              if (isGeneralTab) {
                                updateSharedReportConfig(selectedReportResource.id, 'preferredContactPlaceholder', event.target.value);
                                return;
                              }
                              if (isCountryTab) {
                                updateResourceReportConfig(activeTab, selectedReportResource.id, 'preferredContactPlaceholder', event.target.value);
                              }
                            }}
                          />
                        </label>
                        <label className="wellbeing-editor-card__field">
                          <span>Label de descrição</span>
                          <input
                            value={getReportConfig(selectedReportResource).descriptionLabel}
                            onChange={(event) => {
                              if (isGeneralTab) {
                                updateSharedReportConfig(selectedReportResource.id, 'descriptionLabel', event.target.value);
                                return;
                              }
                              if (isCountryTab) {
                                updateResourceReportConfig(activeTab, selectedReportResource.id, 'descriptionLabel', event.target.value);
                              }
                            }}
                          />
                        </label>
                        <label className="wellbeing-editor-card__field wellbeing-editor-card__field--full">
                          <span>Placeholder de descrição</span>
                          <textarea
                            rows={2}
                            value={getReportConfig(selectedReportResource).descriptionPlaceholder}
                            onChange={(event) => {
                              if (isGeneralTab) {
                                updateSharedReportConfig(selectedReportResource.id, 'descriptionPlaceholder', event.target.value);
                                return;
                              }
                              if (isCountryTab) {
                                updateResourceReportConfig(activeTab, selectedReportResource.id, 'descriptionPlaceholder', event.target.value);
                              }
                            }}
                          />
                        </label>
                        <label className="wellbeing-editor-card__field">
                          <span>Texto botão enviar</span>
                          <input
                            value={getReportConfig(selectedReportResource).submitLabel}
                            onChange={(event) => {
                              if (isGeneralTab) {
                                updateSharedReportConfig(selectedReportResource.id, 'submitLabel', event.target.value);
                                return;
                              }
                              if (isCountryTab) {
                                updateResourceReportConfig(activeTab, selectedReportResource.id, 'submitLabel', event.target.value);
                              }
                            }}
                          />
                        </label>
                        <label className="wellbeing-editor-card__field">
                          <span>Texto botão cancelar</span>
                          <input
                            value={getReportConfig(selectedReportResource).cancelLabel}
                            onChange={(event) => {
                              if (isGeneralTab) {
                                updateSharedReportConfig(selectedReportResource.id, 'cancelLabel', event.target.value);
                                return;
                              }
                              if (isCountryTab) {
                                updateResourceReportConfig(activeTab, selectedReportResource.id, 'cancelLabel', event.target.value);
                              }
                            }}
                          />
                        </label>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="wellbeing-country-card__head">
                <h2>{section.title || (activeTab === 'BR' ? 'Brasil' : activeTab === 'PT' ? 'Portugal' : 'Geral')}</h2>
              </div>
            )}

            {!isEditing && (
              <div className="wellbeing-grid">
                {section.resources.map((resource) => (
                  <article key={resource.id} className={`wellbeing-card wellbeing-card--${resource.kind}`}>
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
                            {resource.buttonLabel || 'Reclamar aqui'}
                          </Button>
                          {resource.files.map((file) => (
                            <a key={file.id} className="wellbeing-card__link" href={file.link} target="_blank" rel="noreferrer">
                              {file.label || 'Abrir ficheiro'}
                            </a>
                          ))}
                        </div>
                      )}
                    </>
                  </article>
                ))}
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
            <Button type="button" variant="primary" onClick={() => void submitHarassmentReport()} isLoading={isSubmittingReport}>
              {activeReportConfig.submitLabel}
            </Button>
          </>
        )}
      >
        <div className="wellbeing-report-form">
          <div className="wellbeing-report-form__intro">
            <div className="wellbeing-report-form__intro-icon" aria-hidden="true">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                <path d="M12 2L3 7v5c0 5.25 3.75 10.15 9 11.25C17.25 22.15 21 17.25 21 12V7L12 2z" fill="rgba(255,255,255,0.92)" />
                <path d="M10 13l2 2 4-4" stroke="rgba(29,78,216,0.7)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <div className="wellbeing-report-form__intro-body">
              <h3>{activeReportConfig.introTitle}</h3>
              <p>{activeReportConfig.introText}</p>
            </div>
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
          <p className="wellbeing-report-form__privacy">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z"/></svg>
            Esta reclamação é confidencial e será tratada com discrição por t.people.
          </p>
        </div>
      </Modal>

      <Toast show={toast.visible} tone={toast.tone} message={toast.message} onClose={hideToast} />
    </section>
  );
}