import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import Modal from '../components/ui/Modal';
import { apiRequest, authHeaders, clearApiCache } from '../portal/api';
import { CAREER_LEVELS, resolveCareerPlan } from '../portal/career-plan';
import { usePortal } from '../portal/context';

type CareerTab = 'nivel' | 'roadmap' | 'avaliacao';
type EditorTab = 'familias' | 'niveis' | 'avaliacao';
type FamilyEditorSection = 'geral' | 'mapeamento' | 'competencias' | 'niveis';
type EvaluationEditorSection = 'plano' | 'secoes' | 'etapas';

type CareerStep = {
  level: string;
  title: string;
  expectations: string[];
  signals: string[];
};

type CareerFamily = {
  label: string;
  summary: string;
  roles: string[];
  coreSkills: string[];
  expectedBehaviors: string[];
  nextStepFocus: string[];
};

type CareerPlanView = {
  family: CareerFamily;
  currentStep: CareerStep;
  nextSteps: CareerStep[];
  ninetyDayPlan: string[];
  evaluationSections: Array<{
    title: string;
    responsible: string;
    instructions: string[];
  }>;
  evaluationStages: Array<{
    stage: string;
    items: string[];
  }>;
};

type CareerPlanContent = {
  levels: Array<{ id: string; label: string }>;
  families: Array<{
    id: string;
    label: string;
    summary: string;
    roles: string[];
    keywords: string[];
    coreSkills: string[];
    expectedBehaviors: string[];
    nextStepFocus: string[];
    levelDetails: Record<string, { title: string; expectations: string[]; signals: string[] }>;
  }>;
  ninetyDayPlan: string[];
  evaluationSections: Array<{
    title: string;
    responsible: string;
    instructions: string[];
  }>;
  evaluationStages: Array<{
    stage: string;
    items: string[];
  }>;
};

type ListEditorProps = {
  label: string;
  items: string[];
  onChange: (items: string[]) => void;
  addLabel: string;
  emptyItemPlaceholder: string;
};

function ListEditor({ label, items, onChange, addLabel, emptyItemPlaceholder }: ListEditorProps) {
  function addItem() {
    onChange([...items, '']);
  }

  function removeItem(index: number) {
    onChange(items.filter((_, idx) => idx !== index));
  }

  function updateItem(index: number, value: string) {
    onChange(items.map((item, idx) => (idx === index ? value : item)));
  }

  function moveItem(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= items.length) {
      return;
    }

    const next = [...items];
    const [current] = next.splice(index, 1);
    next.splice(target, 0, current);
    onChange(next);
  }

  return (
    <div className="cp-editor-list-block">
      <div className="cp-editor-list-block__head">
        <span>{label}</span>
        <button type="button" className="cp-btn-secondary" onClick={addItem}>{addLabel}</button>
      </div>

      {items.length === 0 && <p className="cp-editor-list-block__empty">Sem itens.</p>}

      {items.map((item, index) => (
        <div key={`${label}-${index}`} className="cp-editor-list-block__row">
          <input
            value={item}
            placeholder={emptyItemPlaceholder}
            onChange={(event) => updateItem(index, event.target.value)}
          />
          <button type="button" className="cp-btn-secondary" onClick={() => moveItem(index, -1)} disabled={index === 0}>Subir</button>
          <button type="button" className="cp-btn-secondary" onClick={() => moveItem(index, 1)} disabled={index === items.length - 1}>Descer</button>
          <button type="button" className="cp-btn-secondary" onClick={() => removeItem(index)}>Remover</button>
        </div>
      ))}
    </div>
  );
}

function getAuthHeaders() {
  const token = window.localStorage.getItem('smarter_hub_auth_token') || '';
  return authHeaders(token);
}

function normalizeText(value: string) {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function slugify(value: string) {
  return normalizeText(value)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '') || 'item';
}

function cloneContent(content: CareerPlanContent) {
  return JSON.parse(JSON.stringify(content)) as CareerPlanContent;
}

function buildCareerPlanView(content: CareerPlanContent, cargo: string, funcao: string): { plan: CareerPlanView; levels: string[] } {
  const levels = content.levels.map((item) => item.label).filter(Boolean);
  const normalizedCargo = normalizeText(cargo || '');
  const normalizedFuncao = normalizeText(funcao || '');

  const family = content.families.find((item) => {
    const roleMatch = item.roles.some((role) => normalizeText(role).includes(normalizedFuncao) || normalizedFuncao.includes(normalizeText(role)));
    const keywordMatch = item.keywords.some((keyword) => normalizedFuncao.includes(normalizeText(keyword)) || normalizedCargo.includes(normalizeText(keyword)));
    return roleMatch || keywordMatch;
  }) ?? content.families[0];

  const fallbackLevel = levels[0] || 'Nivel';
  const resolvedCurrentLevel = levels.find((level) => {
    const normalizedLevel = normalizeText(level);
    return normalizedCargo === normalizedLevel || normalizedCargo.includes(normalizedLevel) || normalizedLevel.includes(normalizedCargo);
  }) || fallbackLevel;

  const currentIndex = Math.max(levels.findIndex((level) => level === resolvedCurrentLevel), 0);
  const nextLevels = levels.slice(currentIndex + 1, currentIndex + 3);

  const toStep = (level: string): CareerStep => {
    const details = family?.levelDetails?.[level];
    return {
      level,
      title: details?.title || '',
      expectations: details?.expectations || [],
      signals: details?.signals || [],
    };
  };

  return {
    levels,
    plan: {
      family: {
        label: family?.label || 'Plano Geral',
        summary: family?.summary || '',
        roles: family?.roles || [],
        coreSkills: family?.coreSkills || [],
        expectedBehaviors: family?.expectedBehaviors || [],
        nextStepFocus: family?.nextStepFocus || [],
      },
      currentStep: toStep(resolvedCurrentLevel),
      nextSteps: nextLevels.map((level) => toStep(level)),
      ninetyDayPlan: content.ninetyDayPlan || [],
      evaluationSections: content.evaluationSections || [],
      evaluationStages: content.evaluationStages || [],
    },
  };
}

function ensureFamilyLevelDetails(
  family: CareerPlanContent['families'][number],
  levels: CareerPlanContent['levels'],
) {
  const next = { ...family.levelDetails };
  for (const level of levels) {
    if (!next[level.label]) {
      next[level.label] = {
        title: '',
        expectations: [],
        signals: [],
      };
    }
  }
  for (const key of Object.keys(next)) {
    if (!levels.some((level) => level.label === key)) {
      delete next[key];
    }
  }
  return next;
}

function moveAt<T>(items: T[], from: number, direction: -1 | 1) {
  const to = from + direction;
  if (to < 0 || to >= items.length) {
    return items;
  }

  const next = [...items];
  const [value] = next.splice(from, 1);
  next.splice(to, 0, value);
  return next;
}

const SMART_DEFAULT_SKILLS = [
  'Inovacao e adaptacao',
  'Colaboracao',
  'Adaptabilidade',
  'Etica profissional',
  'Desenvolvimento continuo',
];

const SMART_DEFAULT_FOCUS = [
  'Avaliacao de desempenho anual (merito)',
  'Potencial',
  'Oportunidade interna',
];

const SMART_LEVEL_TITLES: Record<string, string> = {
  Trainee: 'Entrada e aprendizagem estruturada',
  Junior: 'Execucao operacional com supervisao proxima',
  Associate: 'Execucao com autonomia e foco em resultados',
  Senior: 'Dominio tecnico e coordenacao de pequena equipa',
  Lead: 'Coordenacao operacional e gestao de equipa direta',
  Principal: 'Gestao ampla da unidade e orcamento',
  Director: 'Direcao de area com visao transversal',
  'C Level': 'Direcao estrategica do pelouro',
};

function splitWords(value: string) {
  return normalizeText(value)
    .split(/[^a-z0-9]+/g)
    .map((item) => item.trim())
    .filter((item) => item.length >= 3);
}

function buildSmartKeywords(label: string, roles: string[]) {
  const stopwords = new Set(['para', 'com', 'das', 'dos', 'and', 'the', 'uma', 'por', 'area']);
  const words = Array.from(new Set([
    ...splitWords(label),
    ...roles.flatMap((role) => splitWords(role)),
  ])).filter((item) => !stopwords.has(item));

  return words.slice(0, 12);
}

function buildSmartExpectations(level: string, familyLabel: string) {
  return [
    `Atua no nivel ${level} com foco na qualidade de entrega em ${familyLabel}.`,
    'Alinha prioridades com objetivos da area e do negocio.',
    'Mantem previsibilidade, colaboracao e melhoria continua.',
  ];
}

function buildSmartSignals(level: string) {
  return [
    `Demonstra maturidade consistente para o nivel ${level}.`,
    'Partilha conhecimento e influencia positivamente a equipa.',
    'Mostra autonomia e criterio na tomada de decisao.',
  ];
}

export default function CareerPlanPage() {
  const { profile, isRootAccess, isAccessTotal } = usePortal();
  const careerPdfUrl = (import.meta.env.VITE_CAREER_PLAN_PDF_URL as string | undefined)?.trim();
  const canEdit = isRootAccess || isAccessTotal;

  const [content, setContent] = useState<CareerPlanContent | null>(null);
  const [draftContent, setDraftContent] = useState<CareerPlanContent | null>(null);
  const [isLoadingContent, setIsLoadingContent] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [saveError, setSaveError] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  const [activeEditorTab, setActiveEditorTab] = useState<EditorTab>('familias');
  const [selectedFamilyId, setSelectedFamilyId] = useState('');
  const [selectedLevelLabel, setSelectedLevelLabel] = useState('');
  const [familyEditorSection, setFamilyEditorSection] = useState<FamilyEditorSection>('geral');
  const [evaluationEditorSection, setEvaluationEditorSection] = useState<EvaluationEditorSection>('plano');

  useEffect(() => {
    let isMounted = true;

    (async () => {
      try {
        const response = await apiRequest<{ content: CareerPlanContent }>('/career-plan/content', {
          headers: getAuthHeaders(),
        });

        if (!isMounted) {
          return;
        }

        setContent(response.content);
        setDraftContent(cloneContent(response.content));
        setSelectedFamilyId(response.content.families[0]?.id || '');
        setSelectedLevelLabel(response.content.levels[0]?.label || '');
        setLoadError('');
      } catch (error) {
        if (!isMounted) {
          return;
        }

        setLoadError(error instanceof Error ? error.message : 'Falha ao carregar configuracao dinamica do plano de carreira.');
      } finally {
        if (isMounted) {
          setIsLoadingContent(false);
        }
      }
    })();

    return () => {
      isMounted = false;
    };
  }, []);

  const fallbackPlan = useMemo(() => resolveCareerPlan(profile.cargo, profile.funcao), [profile.cargo, profile.funcao]);

  const { plan, levels } = useMemo(() => {
    if (content) {
      return buildCareerPlanView(content, profile.cargo, profile.funcao);
    }

    return {
      levels: [...CAREER_LEVELS],
      plan: fallbackPlan,
    };
  }, [content, profile.cargo, profile.funcao, fallbackPlan]);

  const allLevelSteps = useMemo(
    () => levels.map((lvl) => {
      const found = [plan.currentStep, ...plan.nextSteps].find((s) => s.level === lvl);
      if (found) return found;
      return { level: lvl, title: '', expectations: [], signals: [] } as CareerStep;
    }),
    [plan, levels],
  );

  const currentLevelIndex = Math.max(levels.indexOf(plan.currentStep.level), 0);

  const [activeTab, setActiveTab] = useState<CareerTab>('nivel');
  const [activeLevel, setActiveLevel] = useState(plan.currentStep.level);

  useEffect(() => {
    setActiveLevel(plan.currentStep.level);
  }, [plan.currentStep.level]);

  const activeStep = useMemo<CareerStep>(
    () => allLevelSteps.find((s) => s.level === activeLevel) ?? plan.currentStep,
    [activeLevel, allLevelSteps, plan.currentStep],
  );

  const selectedFamily = useMemo(() => {
    if (!draftContent) {
      return null;
    }
    return draftContent.families.find((family) => family.id === selectedFamilyId) ?? draftContent.families[0] ?? null;
  }, [draftContent, selectedFamilyId]);

  const hasUnsavedChanges = useMemo(() => {
    if (!content || !draftContent) {
      return false;
    }

    return JSON.stringify(content) !== JSON.stringify(draftContent);
  }, [content, draftContent]);

  function updateDraft(updater: (current: CareerPlanContent) => CareerPlanContent) {
    setDraftContent((current) => {
      if (!current) {
        return current;
      }

      return updater(current);
    });
  }

  function startEditMode() {
    if (!content) {
      return;
    }

    const cloned = cloneContent(content);
    setDraftContent(cloned);
    setSelectedFamilyId(cloned.families[0]?.id || '');
    setSelectedLevelLabel(cloned.levels[0]?.label || '');
    setSaveError('');
    setActiveEditorTab('familias');
    setFamilyEditorSection('geral');
    setEvaluationEditorSection('plano');
    setIsEditMode(true);
  }

  function closeEditMode() {
    if (hasUnsavedChanges) {
      const confirmed = window.confirm('Existem alteracoes nao guardadas. Pretendes fechar sem guardar?');
      if (!confirmed) {
        return;
      }
    }

    setIsEditMode(false);
    setSaveError('');
    setDraftContent(content ? cloneContent(content) : null);
  }

  function updateSelectedFamily(mutator: (family: CareerPlanContent['families'][number], levelsList: CareerPlanContent['levels']) => CareerPlanContent['families'][number]) {
    if (!selectedFamily) {
      return;
    }

    updateDraft((current) => ({
      ...current,
      families: current.families.map((family) => {
        if (family.id !== selectedFamily.id) {
          return family;
        }

        const updated = mutator(family, current.levels);
        return {
          ...updated,
          levelDetails: ensureFamilyLevelDetails(updated, current.levels),
        };
      }),
    }));
  }

  function addFamily() {
    if (!draftContent) {
      return;
    }

    let nextIndex = draftContent.families.length + 1;
    let nextId = `familia-${nextIndex}`;
    while (draftContent.families.some((item) => item.id === nextId)) {
      nextIndex += 1;
      nextId = `familia-${nextIndex}`;
    }

    const levelDetails = Object.fromEntries(draftContent.levels.map((level) => [
      level.label,
      {
        title: '',
        expectations: [],
        signals: [],
      },
    ]));

    const newFamily: CareerPlanContent['families'][number] = {
      id: nextId,
      label: 'Nova familia',
      summary: '',
      roles: [],
      keywords: [],
      coreSkills: [],
      expectedBehaviors: [],
      nextStepFocus: [],
      levelDetails,
    };

    updateDraft((current) => ({
      ...current,
      families: [...current.families, newFamily],
    }));

    setSelectedFamilyId(nextId);
    setFamilyEditorSection('geral');
  }

  function removeFamily() {
    if (!draftContent || !selectedFamily || draftContent.families.length <= 1) {
      return;
    }

    const nextFamilies = draftContent.families.filter((item) => item.id !== selectedFamily.id);
    updateDraft((current) => ({
      ...current,
      families: nextFamilies,
    }));
    setSelectedFamilyId(nextFamilies[0]?.id || '');
  }

  function moveSelectedFamily(direction: -1 | 1) {
    if (!draftContent || !selectedFamily) {
      return;
    }

    const index = draftContent.families.findIndex((item) => item.id === selectedFamily.id);
    if (index < 0) {
      return;
    }

    updateDraft((current) => ({
      ...current,
      families: moveAt(current.families, index, direction),
    }));
  }

  function addLevel() {
    if (!draftContent) {
      return;
    }

    let name = 'Novo nivel';
    let suffix = 2;
    while (draftContent.levels.some((level) => level.label === name)) {
      name = `Novo nivel ${suffix}`;
      suffix += 1;
    }

    updateDraft((current) => {
      const levelsList = [...current.levels, { id: slugify(name), label: name }];
      return {
        ...current,
        levels: levelsList,
        families: current.families.map((family) => ({
          ...family,
          levelDetails: ensureFamilyLevelDetails(family, levelsList),
        })),
      };
    });

    setSelectedLevelLabel(name);
  }

  function renameLevel(index: number, nextLabelRaw: string) {
    if (!draftContent) {
      return;
    }

    const nextLabel = nextLabelRaw.trim();
    if (!nextLabel) {
      return;
    }

    const oldLabel = draftContent.levels[index]?.label;
    if (!oldLabel || oldLabel === nextLabel) {
      return;
    }

    if (draftContent.levels.some((level, idx) => idx !== index && level.label === nextLabel)) {
      setSaveError('Ja existe um nivel com esse nome.');
      return;
    }

    setSaveError('');

    updateDraft((current) => {
      const levelsList = current.levels.map((level, idx) => (idx === index ? { id: slugify(nextLabel), label: nextLabel } : level));
      const families = current.families.map((family) => {
        const nextLevelDetails = { ...family.levelDetails };
        const carry = nextLevelDetails[oldLabel] || { title: '', expectations: [], signals: [] };
        delete nextLevelDetails[oldLabel];
        nextLevelDetails[nextLabel] = carry;
        return {
          ...family,
          levelDetails: ensureFamilyLevelDetails({ ...family, levelDetails: nextLevelDetails }, levelsList),
        };
      });

      return {
        ...current,
        levels: levelsList,
        families,
      };
    });

    if (selectedLevelLabel === oldLabel) {
      setSelectedLevelLabel(nextLabel);
    }
  }

  function removeLevel(levelLabel: string) {
    if (!draftContent || draftContent.levels.length <= 1) {
      return;
    }

    updateDraft((current) => {
      const levelsList = current.levels.filter((level) => level.label !== levelLabel);
      const families = current.families.map((family) => {
        const nextDetails = { ...family.levelDetails };
        delete nextDetails[levelLabel];
        return {
          ...family,
          levelDetails: ensureFamilyLevelDetails({ ...family, levelDetails: nextDetails }, levelsList),
        };
      });

      return {
        ...current,
        levels: levelsList,
        families,
      };
    });

    if (selectedLevelLabel === levelLabel) {
      const next = draftContent.levels.find((item) => item.label !== levelLabel);
      setSelectedLevelLabel(next?.label || '');
    }
  }

  function moveLevel(index: number, direction: -1 | 1) {
    updateDraft((current) => ({
      ...current,
      levels: moveAt(current.levels, index, direction),
    }));
  }

  function smartFillSelectedFamily() {
    if (!selectedFamily) {
      return;
    }

    updateSelectedFamily((family, levelsList) => {
      const nextKeywords = family.keywords.length > 0 ? family.keywords : buildSmartKeywords(family.label, family.roles);
      const nextCoreSkills = family.coreSkills.length > 0 ? family.coreSkills : [...SMART_DEFAULT_SKILLS];
      const nextFocus = family.nextStepFocus.length > 0 ? family.nextStepFocus : [...SMART_DEFAULT_FOCUS];
      const nextSummary = family.summary.trim() || `Percurso de carreira da area ${family.label}, com criterios claros de evolucao.`;

      const nextLevelDetails = { ...family.levelDetails };
      for (const level of levelsList) {
        const current = nextLevelDetails[level.label] || { title: '', expectations: [], signals: [] };
        nextLevelDetails[level.label] = {
          title: current.title || SMART_LEVEL_TITLES[level.label] || `Responsabilidades esperadas para ${level.label}`,
          expectations: current.expectations.length > 0 ? current.expectations : buildSmartExpectations(level.label, family.label),
          signals: current.signals.length > 0 ? current.signals : buildSmartSignals(level.label),
        };
      }

      return {
        ...family,
        summary: nextSummary,
        keywords: nextKeywords,
        coreSkills: nextCoreSkills,
        nextStepFocus: nextFocus,
        levelDetails: nextLevelDetails,
      };
    });
  }

  async function saveContent() {
    if (!draftContent) {
      return;
    }

    setSaveError('');
    setIsSaving(true);

    try {
      const response = await apiRequest<{ content: CareerPlanContent }>('/career-plan/content', {
        method: 'PUT',
        headers: {
          ...getAuthHeaders(),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ content: draftContent }),
      });

      setContent(response.content);
      setDraftContent(cloneContent(response.content));
      setIsEditMode(false);
      clearApiCache('/career-plan/content');
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Nao foi possivel guardar o plano de carreira.');
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="cp-shell">
      <header className="cp-hero">
        <div className="cp-hero__left">
          <span className="cp-eyebrow">{plan.family.label}</span>
          <h1 className="cp-hero__name">{profile.cargo || 'Nivel por definir'}</h1>
          <p className="cp-hero__sub">{profile.funcao} · {plan.currentStep.title}</p>
          <div className="cp-progress-track" aria-label="Progressao na hierarquia">
            <div className="cp-progress-bar" style={{ width: `${Math.round(((currentLevelIndex + 1) / Math.max(levels.length, 1)) * 100)}%` }} />
          </div>
          <p className="cp-progress-label">
            Nivel {currentLevelIndex + 1} de {levels.length} na hierarquia
            {currentLevelIndex + 1 < levels.length && (
              <> · Proximo: <strong>{levels[currentLevelIndex + 1]}</strong></>
            )}
          </p>
          <div className="cp-hero__actions">
            {canEdit && (
              <button type="button" className="cp-btn-secondary" onClick={startEditMode}>
                Editar conteudo
              </button>
            )}
          </div>
        </div>

        <div className="cp-hero__right">
          <div className="cp-stat">
            <span>Area</span>
            <strong>{plan.family.label}</strong>
          </div>
          <div className="cp-stat">
            <span>Funcoes da area</span>
            <strong>{plan.family.roles.length > 0 ? plan.family.roles.join(' · ') : '-'}</strong>
          </div>
          <div className="cp-stat">
            <span>Progressao para</span>
            <strong>{plan.family.nextStepFocus[0] ?? 'Avaliacao de desempenho anual'}</strong>
          </div>
          {careerPdfUrl && (
            <a className="cp-pdf-link" href={careerPdfUrl} target="_blank" rel="noreferrer">
              Plano de carreira PDF ↗
            </a>
          )}
          <Link className="cp-profile-link" to="/profile">A Minha Ficha →</Link>
        </div>
      </header>

      {isLoadingContent && (
        <section className="cp-card">
          <p className="cp-card__desc">A carregar configuracao dinamica do plano de carreira...</p>
        </section>
      )}

      {!isLoadingContent && loadError && (
        <section className="cp-card cp-card--accent">
          <h2 className="cp-card__title">Configuracao dinamica indisponivel</h2>
          <p className="cp-card__desc">{loadError}</p>
          <p className="cp-footnote">A pagina esta a usar o plano base enquanto o erro nao e resolvido.</p>
        </section>
      )}

      <nav className="cp-tabs" aria-label="Secoes">
        {([
          ['nivel', 'O meu nivel'],
          ['roadmap', 'Roadmap de niveis'],
          ['avaliacao', 'Processo de avaliacao'],
        ] as [CareerTab, string][]).map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={`cp-tab${activeTab === id ? ' is-active' : ''}`}
            onClick={() => setActiveTab(id)}
          >
            {label}
          </button>
        ))}
      </nav>

      {activeTab === 'nivel' && (
        <div className="cp-body">
          <div className="cp-two-col">
            <section className="cp-card">
              <h2 className="cp-card__title">O que e esperado no meu nivel</h2>
              <p className="cp-card__desc">{plan.family.summary}</p>
              <ul className="cp-list">
                {plan.currentStep.expectations.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </section>

            <section className="cp-card">
              <h2 className="cp-card__title">Sinais de prontidao para o proximo passo</h2>
              <ul className="cp-list cp-list--signals">
                {plan.currentStep.signals.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
              <div className="cp-divider" />
              <h3 className="cp-card__sub">Competencias comportamentais esperadas</h3>
              <ul className="cp-list cp-list--plain">
                {plan.family.expectedBehaviors.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </section>
          </div>

          <section className="cp-card cp-card--accent">
            <h2 className="cp-card__title">Criterios de progressao de carreira</h2>
            <div className="cp-three-col">
              {plan.family.nextStepFocus.map((item, index) => (
                <div key={item} className="cp-criterion">
                  <span className="cp-criterion__num">{index + 1}</span>
                  <p>{item}</p>
                </div>
              ))}
            </div>
            <p className="cp-footnote">A progressao e sempre baseada em merito, potencial e oportunidade interna.</p>
          </section>

          <section className="cp-card">
            <h2 className="cp-card__title">Competencias-chave da tua area</h2>
            <div className="cp-tags">
              {plan.family.coreSkills.map((item) => (
                <span key={item} className="cp-tag">{item}</span>
              ))}
            </div>
          </section>
        </div>
      )}

      {activeTab === 'roadmap' && (
        <div className="cp-body cp-body--roadmap">
          <aside className="cp-timeline">
            <p className="cp-timeline__label">Hierarquia oficial</p>
            {allLevelSteps.map((step, index) => (
              <button
                key={step.level}
                type="button"
                aria-selected={step.level === activeLevel}
                className={[
                  'cp-tl-item',
                  step.level === activeLevel ? 'is-active' : '',
                  index < currentLevelIndex ? 'is-past' : '',
                  index === currentLevelIndex ? 'is-current' : '',
                ].filter(Boolean).join(' ')}
                onClick={() => setActiveLevel(step.level)}
              >
                <span className="cp-tl-dot" />
                <span className="cp-tl-name">{step.level}</span>
              </button>
            ))}
          </aside>

          <section className="cp-card cp-card--detail" aria-live="polite">
            {activeStep.expectations.length > 0 ? (
              <>
                <div className="cp-detail-header">
                  <h2 className="cp-card__title">{activeStep.level}</h2>
                  <span className="cp-detail-sub">{activeStep.title}</span>
                  {activeStep.level === plan.currentStep.level && (
                    <span className="cp-badge cp-badge--current">Nivel atual</span>
                  )}
                </div>
                <div className="cp-two-col cp-two-col--flush">
                  <div>
                    <h3 className="cp-card__sub">Expectativas</h3>
                    <ul className="cp-list">
                      {activeStep.expectations.map((item) => <li key={item}>{item}</li>)}
                    </ul>
                  </div>
                  <div>
                    <h3 className="cp-card__sub">Comportamentos-chave</h3>
                    <ul className="cp-list cp-list--signals">
                      {activeStep.signals.map((item) => <li key={item}>{item}</li>)}
                    </ul>
                  </div>
                </div>
              </>
            ) : (
              <p className="cp-empty">Seleciona um nivel para ver os detalhes.</p>
            )}
          </section>
        </div>
      )}

      {activeTab === 'avaliacao' && (
        <div className="cp-body">
          <section className="cp-card">
            <h2 className="cp-card__title">Como funciona o processo de avaliacao</h2>
            <p className="cp-card__desc">Dois momentos distintos e complementares, alinhados com o template de avaliacao.</p>
            <div className="cp-stages">
              {plan.evaluationStages.map((stage, index) => (
                <div key={stage.stage} className="cp-stage">
                  <div className="cp-stage__num">{index + 1}</div>
                  <div className="cp-stage__body">
                    <strong>{stage.stage}</strong>
                    <ul className="cp-list cp-list--plain">
                      {stage.items.map((item) => <li key={item}>{item}</li>)}
                    </ul>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="cp-card">
            <h2 className="cp-card__title">Secoes do template oficial</h2>
            <p className="cp-card__desc">Cada secao tem um responsavel definido e orientacoes especificas.</p>
            <div className="cp-sections-grid">
              {plan.evaluationSections.map((section, index) => (
                <div key={`${section.title}-${index}`} className="cp-section-item">
                  <div className="cp-section-item__num">{index + 1}</div>
                  <div>
                    <p className="cp-section-item__title">{section.title.replace(/^Secao \d+\s[-–]\s/, '')}</p>
                    <p className="cp-section-item__owner">Responsavel: {section.responsible}</p>
                    <ul className="cp-list cp-list--plain">
                      {section.instructions.map((item) => <li key={item}>{item}</li>)}
                    </ul>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="cp-card cp-card--accent">
            <h2 className="cp-card__title">Plano 30-60-90 dias</h2>
            <div className="cp-three-col">
              {plan.ninetyDayPlan.map((item, index) => (
                <div key={item} className="cp-criterion">
                  <span className="cp-criterion__num">{index === 0 ? '30d' : index === 1 ? '60d' : '90d'}</span>
                  <p>{item}</p>
                </div>
              ))}
            </div>
          </section>
        </div>
      )}

      {isEditMode && canEdit && draftContent && selectedFamily && (
        <Modal
          open={isEditMode}
          title="Editar Plano de Carreira"
          width="min(1120px, 95vw)"
          onClose={closeEditMode}
          footer={(
            <div className="cp-editor-modal__footer">
              <span className={`cp-editor-modal__dirty${hasUnsavedChanges ? ' is-dirty' : ''}`}>
                {hasUnsavedChanges ? 'Alteracoes por guardar' : 'Sem alteracoes pendentes'}
              </span>
              <button type="button" className="cp-btn-secondary" onClick={closeEditMode}>Cancelar</button>
              <button type="button" className="cp-btn-primary" onClick={() => { void saveContent(); }} disabled={isSaving}>
                {isSaving ? 'A guardar...' : 'Guardar alteracoes'}
              </button>
            </div>
          )}
        >
          <div className="cp-editor-modal">
            <div className="cp-editor-tabs">
              {([
                ['familias', 'Familias e detalhes'],
                ['niveis', 'Niveis'],
                ['avaliacao', 'Avaliacao'],
              ] as [EditorTab, string][]).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  className={`cp-tab${activeEditorTab === id ? ' is-active' : ''}`}
                  onClick={() => setActiveEditorTab(id)}
                >
                  {label}
                </button>
              ))}
            </div>

            {activeEditorTab === 'familias' && (
              <div className="cp-editor-grid">
                <aside className="cp-editor-list">
                  <div className="cp-editor-list__head">
                    <h3>Familias</h3>
                    <button type="button" className="cp-btn-secondary" onClick={addFamily}>+ Nova</button>
                  </div>
                  <div className="cp-editor-list__items">
                    {draftContent.families.map((family) => (
                      <button
                        key={family.id}
                        type="button"
                        className={`cp-editor-list__item${selectedFamily.id === family.id ? ' is-active' : ''}`}
                        onClick={() => setSelectedFamilyId(family.id)}
                      >
                        {family.label}
                      </button>
                    ))}
                  </div>
                  <div className="cp-editor-list__actions">
                    <button type="button" className="cp-btn-secondary" onClick={() => moveSelectedFamily(-1)}>Subir</button>
                    <button type="button" className="cp-btn-secondary" onClick={() => moveSelectedFamily(1)}>Descer</button>
                    <button type="button" className="cp-btn-secondary" onClick={removeFamily} disabled={draftContent.families.length <= 1}>Remover</button>
                  </div>
                </aside>

                <div className="cp-editor-form">
                  <div className="cp-editor-toolbar">
                    <div className="cp-editor-toolbar__chips">
                      {([
                        ['geral', 'Geral'],
                        ['mapeamento', 'Mapeamento'],
                        ['competencias', 'Competencias'],
                        ['niveis', 'Niveis'],
                      ] as [FamilyEditorSection, string][]).map(([id, label]) => (
                        <button
                          key={id}
                          type="button"
                          className={`cp-chip${familyEditorSection === id ? ' is-active' : ''}`}
                          onClick={() => setFamilyEditorSection(id)}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    <button type="button" className="cp-btn-primary" onClick={smartFillSelectedFamily}>Auto-preencher familia</button>
                  </div>

                  {familyEditorSection === 'geral' && (
                    <div className="cp-editor-panel">
                      <label className="cp-editor-field">
                        <span>Nome da familia</span>
                        <input
                          value={selectedFamily.label}
                          onChange={(event) => updateSelectedFamily((family) => ({ ...family, label: event.target.value }))}
                        />
                      </label>

                      <label className="cp-editor-field">
                        <span>Resumo</span>
                        <textarea
                          value={selectedFamily.summary}
                          onChange={(event) => updateSelectedFamily((family) => ({ ...family, summary: event.target.value }))}
                        />
                      </label>

                      <ListEditor
                        label="Funcoes da area"
                        items={selectedFamily.roles}
                        onChange={(next) => updateSelectedFamily((family) => ({ ...family, roles: next }))}
                        addLabel="+ Funcao"
                        emptyItemPlaceholder="Ex: Product Manager"
                      />
                    </div>
                  )}

                  {familyEditorSection === 'mapeamento' && (
                    <div className="cp-editor-panel">
                      <ListEditor
                        label="Palavras-chave para mapeamento automatico"
                        items={selectedFamily.keywords}
                        onChange={(next) => updateSelectedFamily((family) => ({ ...family, keywords: next }))}
                        addLabel="+ Keyword"
                        emptyItemPlaceholder="Ex: product"
                      />
                    </div>
                  )}

                  {familyEditorSection === 'competencias' && (
                    <div className="cp-editor-panel">
                      <ListEditor
                        label="Competencias-chave"
                        items={selectedFamily.coreSkills}
                        onChange={(next) => updateSelectedFamily((family) => ({ ...family, coreSkills: next }))}
                        addLabel="+ Competencia"
                        emptyItemPlaceholder="Ex: Colaboracao"
                      />

                      <ListEditor
                        label="Comportamentos esperados"
                        items={selectedFamily.expectedBehaviors}
                        onChange={(next) => updateSelectedFamily((family) => ({ ...family, expectedBehaviors: next }))}
                        addLabel="+ Comportamento"
                        emptyItemPlaceholder="Ex: Transparencia"
                      />

                      <ListEditor
                        label="Focos de progressao"
                        items={selectedFamily.nextStepFocus}
                        onChange={(next) => updateSelectedFamily((family) => ({ ...family, nextStepFocus: next }))}
                        addLabel="+ Foco"
                        emptyItemPlaceholder="Ex: Potencial"
                      />
                    </div>
                  )}

                  {familyEditorSection === 'niveis' && (
                    <div className="cp-editor-panel">
                      <div className="cp-editor-subblock">
                        <h4>Detalhes por nivel</h4>
                        <label className="cp-editor-field">
                          <span>Nivel</span>
                          <select value={selectedLevelLabel} onChange={(event) => setSelectedLevelLabel(event.target.value)}>
                            {draftContent.levels.map((level) => (
                              <option key={level.id} value={level.label}>{level.label}</option>
                            ))}
                          </select>
                        </label>

                        <label className="cp-editor-field">
                          <span>Titulo do nivel</span>
                          <input
                            value={selectedFamily.levelDetails[selectedLevelLabel]?.title || ''}
                            onChange={(event) => {
                              const level = selectedLevelLabel;
                              updateSelectedFamily((family) => ({
                                ...family,
                                levelDetails: {
                                  ...family.levelDetails,
                                  [level]: {
                                    ...(family.levelDetails[level] || { title: '', expectations: [], signals: [] }),
                                    title: event.target.value,
                                  },
                                },
                              }));
                            }}
                          />
                        </label>

                        <ListEditor
                          label="Expectativas do nivel"
                          items={selectedFamily.levelDetails[selectedLevelLabel]?.expectations || []}
                          onChange={(next) => {
                            const level = selectedLevelLabel;
                            updateSelectedFamily((family) => ({
                              ...family,
                              levelDetails: {
                                ...family.levelDetails,
                                [level]: {
                                  ...(family.levelDetails[level] || { title: '', expectations: [], signals: [] }),
                                  expectations: next,
                                },
                              },
                            }));
                          }}
                          addLabel="+ Expectativa"
                          emptyItemPlaceholder="Ex: Entregar com qualidade"
                        />

                        <ListEditor
                          label="Sinais de prontidao"
                          items={selectedFamily.levelDetails[selectedLevelLabel]?.signals || []}
                          onChange={(next) => {
                            const level = selectedLevelLabel;
                            updateSelectedFamily((family) => ({
                              ...family,
                              levelDetails: {
                                ...family.levelDetails,
                                [level]: {
                                  ...(family.levelDetails[level] || { title: '', expectations: [], signals: [] }),
                                  signals: next,
                                },
                              },
                            }));
                          }}
                          addLabel="+ Sinal"
                          emptyItemPlaceholder="Ex: Lidera iniciativas"
                        />
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {activeEditorTab === 'niveis' && (
              <div className="cp-editor-form">
                <div className="cp-editor-list__head">
                  <h3>Niveis da hierarquia</h3>
                  <button type="button" className="cp-btn-secondary" onClick={addLevel}>+ Novo nivel</button>
                </div>

                {draftContent.levels.map((level, index) => (
                  <div key={level.id} className="cp-editor-row">
                    <input
                      value={level.label}
                      onBlur={(event) => renameLevel(index, event.target.value)}
                      onChange={(event) => {
                        updateDraft((current) => {
                          const next = [...current.levels];
                          next[index] = { ...next[index], label: event.target.value };
                          return { ...current, levels: next };
                        });
                      }}
                    />
                    <button type="button" className="cp-btn-secondary" onClick={() => moveLevel(index, -1)} disabled={index === 0}>Subir</button>
                    <button type="button" className="cp-btn-secondary" onClick={() => moveLevel(index, 1)} disabled={index === draftContent.levels.length - 1}>Descer</button>
                    <button type="button" className="cp-btn-secondary" onClick={() => removeLevel(level.label)} disabled={draftContent.levels.length <= 1}>Remover</button>
                  </div>
                ))}

                <p className="cp-footnote">Ao renomear ou reordenar niveis, os detalhes nas familias sao preservados automaticamente.</p>
              </div>
            )}

            {activeEditorTab === 'avaliacao' && (
              <div className="cp-editor-form">
                <div className="cp-editor-toolbar">
                  <div className="cp-editor-toolbar__chips">
                    {([
                      ['plano', 'Plano 30-60-90'],
                      ['secoes', 'Secoes'],
                      ['etapas', 'Etapas'],
                    ] as [EvaluationEditorSection, string][]).map(([id, label]) => (
                      <button
                        key={id}
                        type="button"
                        className={`cp-chip${evaluationEditorSection === id ? ' is-active' : ''}`}
                        onClick={() => setEvaluationEditorSection(id)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                {evaluationEditorSection === 'plano' && (
                  <div className="cp-editor-panel">
                    <ListEditor
                      label="Plano 30-60-90"
                      items={draftContent.ninetyDayPlan}
                      onChange={(next) => updateDraft((current) => ({ ...current, ninetyDayPlan: next }))}
                      addLabel="+ Etapa"
                      emptyItemPlaceholder="Ex: 30 dias: alinhar objetivos"
                    />
                  </div>
                )}

                {evaluationEditorSection === 'secoes' && (
                  <div className="cp-editor-panel">
                    <div className="cp-editor-subblock">
                      <div className="cp-editor-list__head">
                        <h4>Secoes de avaliacao</h4>
                        <button
                          type="button"
                          className="cp-btn-secondary"
                          onClick={() => updateDraft((current) => ({
                            ...current,
                            evaluationSections: [...current.evaluationSections, { title: 'Nova secao', responsible: 'Gestor', instructions: [] }],
                          }))}
                        >
                          + Secao
                        </button>
                      </div>

                      {draftContent.evaluationSections.map((section, index) => (
                        <div key={`${section.title}-${index}`} className="cp-editor-card">
                          <div className="cp-editor-row cp-editor-row--compact">
                            <strong>Secao {index + 1}</strong>
                            <button type="button" className="cp-btn-secondary" onClick={() => updateDraft((current) => ({ ...current, evaluationSections: moveAt(current.evaluationSections, index, -1) }))} disabled={index === 0}>Subir</button>
                            <button type="button" className="cp-btn-secondary" onClick={() => updateDraft((current) => ({ ...current, evaluationSections: moveAt(current.evaluationSections, index, 1) }))} disabled={index === draftContent.evaluationSections.length - 1}>Descer</button>
                            <button type="button" className="cp-btn-secondary" onClick={() => updateDraft((current) => ({ ...current, evaluationSections: current.evaluationSections.filter((_, idx) => idx !== index) }))}>Remover</button>
                          </div>

                          <label className="cp-editor-field">
                            <span>Titulo</span>
                            <input
                              value={section.title}
                              onChange={(event) => updateDraft((current) => ({
                                ...current,
                                evaluationSections: current.evaluationSections.map((item, idx) => (idx === index ? { ...item, title: event.target.value } : item)),
                              }))}
                            />
                          </label>

                          <label className="cp-editor-field">
                            <span>Responsavel</span>
                            <input
                              value={section.responsible}
                              onChange={(event) => updateDraft((current) => ({
                                ...current,
                                evaluationSections: current.evaluationSections.map((item, idx) => (idx === index ? { ...item, responsible: event.target.value } : item)),
                              }))}
                            />
                          </label>

                          <ListEditor
                            label="Instrucoes"
                            items={section.instructions}
                            onChange={(next) => updateDraft((current) => ({
                              ...current,
                              evaluationSections: current.evaluationSections.map((item, idx) => (idx === index ? { ...item, instructions: next } : item)),
                            }))}
                            addLabel="+ Instrucao"
                            emptyItemPlaceholder="Ex: Definir KPIs claros"
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {evaluationEditorSection === 'etapas' && (
                  <div className="cp-editor-panel">
                    <div className="cp-editor-subblock">
                      <div className="cp-editor-list__head">
                        <h4>Etapas de avaliacao</h4>
                        <button
                          type="button"
                          className="cp-btn-secondary"
                          onClick={() => updateDraft((current) => ({
                            ...current,
                            evaluationStages: [...current.evaluationStages, { stage: 'Nova etapa', items: [] }],
                          }))}
                        >
                          + Etapa
                        </button>
                      </div>

                      {draftContent.evaluationStages.map((stage, index) => (
                        <div key={`${stage.stage}-${index}`} className="cp-editor-card">
                          <div className="cp-editor-row cp-editor-row--compact">
                            <strong>Etapa {index + 1}</strong>
                            <button type="button" className="cp-btn-secondary" onClick={() => updateDraft((current) => ({ ...current, evaluationStages: moveAt(current.evaluationStages, index, -1) }))} disabled={index === 0}>Subir</button>
                            <button type="button" className="cp-btn-secondary" onClick={() => updateDraft((current) => ({ ...current, evaluationStages: moveAt(current.evaluationStages, index, 1) }))} disabled={index === draftContent.evaluationStages.length - 1}>Descer</button>
                            <button type="button" className="cp-btn-secondary" onClick={() => updateDraft((current) => ({ ...current, evaluationStages: current.evaluationStages.filter((_, idx) => idx !== index) }))}>Remover</button>
                          </div>

                          <label className="cp-editor-field">
                            <span>Nome da etapa</span>
                            <input
                              value={stage.stage}
                              onChange={(event) => updateDraft((current) => ({
                                ...current,
                                evaluationStages: current.evaluationStages.map((item, idx) => (idx === index ? { ...item, stage: event.target.value } : item)),
                              }))}
                            />
                          </label>

                          <ListEditor
                            label="Itens da etapa"
                            items={stage.items}
                            onChange={(next) => updateDraft((current) => ({
                              ...current,
                              evaluationStages: current.evaluationStages.map((item, idx) => (idx === index ? { ...item, items: next } : item)),
                            }))}
                            addLabel="+ Item"
                            emptyItemPlaceholder="Ex: Rever KPIs"
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {saveError && <p className="cp-editor__error">{saveError}</p>}
          </div>
        </Modal>
      )}
    </div>
  );
}
