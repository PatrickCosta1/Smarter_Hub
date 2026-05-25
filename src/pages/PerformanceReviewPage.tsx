import { useEffect, useMemo, useState } from 'react';
import Modal from '../components/ui/Modal';
import Toast from '../components/ui/Toast';
import { apiRequest, authHeaders } from '../portal/api';
import { getStoredAuthToken } from '../portal/auth-storage';
import { usePortal } from '../portal/context';
import { useFeedbackToast } from '../portal/useFeedbackToast';

type SectionType =
  | 'REFLECTION_PREVIOUS_CYCLE'
  | 'BEHAVIORAL_COMPETENCIES'
  | 'OBJECTIVES_KPIS_CURRENT_YEAR'
  | 'LEADERSHIP_REFLECTION'
  | 'NEXT_CYCLE_REFLECTION'
  | 'OBJECTIVES_KPIS_NEXT_YEAR';

type CollaboratorType = 'SELF' | 'MANAGER';
type SubmissionStatus = 'DRAFT' | 'SUBMITTED' | 'AWAITING_RESPONSE' | 'REVISED' | 'ACCEPTED' | 'CLOSED';
type ViewMode = 'mine' | 'team' | 'org';

type SubmissionItem = {
  id: string;
  userId: string;
  sectionType: SectionType;
  collaboratorType: CollaboratorType;
  status: SubmissionStatus;
  content: Record<string, unknown>;
  lastEditedAt?: string | null;
};

type HistoryItem = {
  id: string;
  sectionType: SectionType;
  previousStatus: SubmissionStatus;
  newStatus: SubmissionStatus;
  changeType: string;
  createdAt: string;
};

type LeadershipQuestion = {
  id: string;
  order: number;
  question: string;
};

type CompetencyTemplateRow = {
  organizationValue: string;
  competency: string;
  description: string;
  rating: number | null;
};

type CollaboratorRow = {
  id: string;
  nomeAbreviado?: string;
  nomeCompleto?: string;
  username?: string;
  role?: string;
  teamName?: string;
  cargo?: string;
  categoriaProfissional?: string;
};

type CollaboratorApiRow = {
  id: string;
  username?: string;
  role?: string;
  profile?: {
    nomeAbreviado?: string;
    nomeCompleto?: string;
    cargo?: string;
    categoriaProfissional?: string;
  } | null;
  team?: {
    name?: string;
  } | null;
  teamMemberships?: Array<{
    team?: {
      name?: string;
    } | null;
  }>;
};

type SectionDefinition = {
  id: SectionType;
  title: string;
  subtitle: string;
};

const SECTION_DEFINITIONS: SectionDefinition[] = [
  {
    id: 'REFLECTION_PREVIOUS_CYCLE',
    title: '1. Reflexão ciclo anterior',
    subtitle: 'Entregas, desafios e pontos de desenvolvimento',
  },
  {
    id: 'BEHAVIORAL_COMPETENCIES',
    title: '2. Competências comportamentais',
    subtitle: 'Avaliação por competência com escala de 1 a 5',
  },
  {
    id: 'OBJECTIVES_KPIS_CURRENT_YEAR',
    title: '3. Objetivos e KPIs (ano atual)',
    subtitle: 'Objetivos, pesos e resultados do ano corrente',
  },
  {
    id: 'LEADERSHIP_REFLECTION',
    title: '4. Reflexão sobre liderança',
    subtitle: 'Feedback qualitativo sobre suporte e alinhamento',
  },
  {
    id: 'NEXT_CYCLE_REFLECTION',
    title: '5. Reflexão próximo ciclo',
    subtitle: 'Interesses, backups e necessidades futuras',
  },
  {
    id: 'OBJECTIVES_KPIS_NEXT_YEAR',
    title: '6. Objetivos e KPIs (próximo ano)',
    subtitle: 'Definição inicial para o próximo período',
  },
];

// Helper functions
function getHeaders() {
  return authHeaders(getStoredAuthToken());
}

function toText(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function normalizeForMatch(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function resolveHierarchyLevel(input: string): string {
  const value = normalizeForMatch(input);

  if (!value) return 'Associate';
  if (value.includes('trainee') || value.includes('estagi')) return 'Trainee';
  if (value.includes('junior')) return 'Junior';
  if (value.includes('associate') || value.includes('pleno')) return 'Associate';
  if (value.includes('senior')) return 'Senior';
  if (value.includes('lead') || value.includes('lider') || value.includes('coordenador') || value.includes('manager')) return 'Lead';
  if (value.includes('principal') || value.includes('especialista') || value.includes('staff')) return 'Principal';

  return 'Associate';
}

function statusBadgeClass(status: SubmissionStatus | undefined): string {
  if (!status || status === 'DRAFT') return 'is-waiting';
  if (status === 'ACCEPTED') return 'is-accepted';
  if (status === 'SUBMITTED' || status === 'REVISED') return 'is-submitted';
  if (status === 'AWAITING_RESPONSE') return 'is-waiting';
  return 'is-waiting';
}

function getStatusLabel(status: SubmissionStatus | undefined): string {
  if (!status || status === 'DRAFT') return 'Pendente';
  if (status === 'ACCEPTED') return 'Aceite';
  if (status === 'SUBMITTED' || status === 'REVISED') return 'Submetido';
  if (status === 'AWAITING_RESPONSE') return 'À espera de aprovação';
  if (status === 'CLOSED') return 'Fechado';
  return 'Pendente';
}

type WorkflowAction = 'save' | 'submit' | 'accept' | 'accept-edits' | 'reject-edits';

type BatchSubmittableBlock = {
  sectionId: SectionType;
  title: string;
  submissionId: string;
  status: SubmissionStatus;
};

function getAvailableActions(status: SubmissionStatus | undefined, isOwner: boolean): WorkflowAction[] {
  const actions: WorkflowAction[] = [];

  if (!status || status === 'DRAFT' || status === 'REVISED') {
    actions.push('save');
    if (isOwner) {
      actions.push('submit');
    }
  }

  if (status === 'SUBMITTED' || status === 'AWAITING_RESPONSE') {
    if (!isOwner) {
      actions.push('accept');
      actions.push('reject-edits');
    }
  }

  if (status === 'AWAITING_RESPONSE') {
    if (isOwner) {
      actions.push('save');
      actions.push('accept-edits');
    }
  }

  return actions;
}

// Main component
export default function PerformanceReviewPage() {
  const { currentUser, profile, hasPermission, isRootAccess, isAccessTotal, isLoadingPortalData } = usePortal();
  const selectedUserStorageKey = `prv:selected-user:${currentUser?.id || 'anonymous'}`;
  const isRhRole = hasPermission('manage_performance_reviews');
  const [canViewTeam, setCanViewTeam] = useState(false);
  const canViewOrg = isRootAccess || isAccessTotal || hasPermission('manage_performance_reviews') || hasPermission('view_user_list');

  // State
  const [viewMode, setViewMode] = useState<ViewMode>('mine');
  const [collaborators, setCollaborators] = useState<CollaboratorRow[]>([]);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [submissions, setSubmissions] = useState<SubmissionItem[]>([]);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [competenciesTemplate, setCompetenciesTemplate] = useState<CompetencyTemplateRow[]>([]);
  const [leadershipQuestions, setLeadershipQuestions] = useState<LeadershipQuestion[]>([]);
  const [activeSection, setActiveSection] = useState<SectionType | null>(null);
  const [activeCollaboratorType, setActiveCollaboratorType] = useState<CollaboratorType>('SELF');
  const [isLoading, setIsLoading] = useState(false);
  const [isBatchSubmitOpen, setIsBatchSubmitOpen] = useState(false);
  const [selectedBatchSubmissionIds, setSelectedBatchSubmissionIds] = useState<string[]>([]);
  const { toast, showToast, hideToast } = useFeedbackToast(4000);

  // Reflection form with dual sections
  const [reflectionSelfForm, setReflectionSelfForm] = useState({
    mainDeliveries: '',
    mainChallenges: '',
    pointsToDevelop: '',
  });

  const [reflectionManagerForm, setReflectionManagerForm] = useState({
    mainDeliveries: '',
    mainChallenges: '',
    pointsToDevelop: '',
  });

  const [competenciesForm, setCompetenciesForm] = useState<Array<{
    organizationValue: string;
    competency: string;
    description: string;
    rating: number | null;
  }>>([]);

  const [kpiCurrentForm, setKpiCurrentForm] = useState<Array<{
    individual: string;
    weight: string;
    objectiveValue: string;
    result: string;
    comments: string;
  }>>([
    { individual: '', weight: '', objectiveValue: '', result: '', comments: '' },
    { individual: '', weight: '', objectiveValue: '', result: '', comments: '' },
    { individual: '', weight: '', objectiveValue: '', result: '', comments: '' },
  ]);

  const [leadershipForm, setLeadershipForm] = useState<Record<string, string>>({});

  const [nextCycleForm, setNextCycleForm] = useState({
    areasOfInterest: '',
    possibleNextRole: '',
    potentialBackups: '',
    identifiedNeeds: '',
    trainingOrInitiativesSuggestion: '',
    recommendedPeriod: '',
  });

  const [kpiNextForm, setKpiNextForm] = useState<Array<{
    individual: string;
    weight: string;
    objectiveValue: string;
    comments: string;
  }>>([
    { individual: '', weight: '', objectiveValue: '', comments: '' },
    { individual: '', weight: '', objectiveValue: '', comments: '' },
    { individual: '', weight: '', objectiveValue: '', comments: '' },
  ]);

  // Compute target user ID
  const targetUserId = useMemo(() => {
    if (viewMode === 'mine') {
      return currentUser?.id ?? '';
    }
    return selectedUserId;
  }, [viewMode, currentUser?.id, selectedUserId]);

  // Compute section map
  const sectionMap = useMemo(() => {
    const map = new Map<string, SubmissionItem>();
    submissions.forEach((item) => {
      map.set(`${item.sectionType}-${item.collaboratorType}`, item);
    });
    return map;
  }, [submissions]);

  const selectedSubmission = activeSection
    ? sectionMap.get(`${activeSection}-${activeCollaboratorType}`) ?? null
    : null;

  // Effects
  useEffect(() => {
    // Espera as permissões carregarem antes de verificar acesso à equipa
    if (isLoadingPortalData) {
      return;
    }

    let disposed = false;

    if (isRhRole) {
      setCanViewTeam(false);
      return () => {
        disposed = true;
      };
    }

    (async () => {
      try {
        const response = await apiRequest<{ rows: CollaboratorApiRow[] }>(
          '/users/collaborators?page=1&pageSize=1&sortBy=username&sortDirection=asc',
          { headers: getHeaders() },
        );

        if (disposed) {
          return;
        }

        setCanViewTeam((response.rows ?? []).length > 0);
      } catch {
        if (!disposed) {
          setCanViewTeam(false);
        }
      }
    })();

    return () => {
      disposed = true;
    };
  }, [currentUser?.id, isRhRole, isLoadingPortalData]);

  useEffect(() => {
    const initialView = canViewTeam ? 'team' : 'mine';
    setViewMode(initialView);
  }, [canViewTeam]);

  useEffect(() => {
    if (viewMode === 'mine') {
      setSelectedUserId('');
      return;
    }

    void loadCollaborators();
  }, [viewMode]);

  useEffect(() => {
    if (viewMode === 'mine') {
      return;
    }

    if (!selectedUserId && collaborators.length > 0) {
      const storedUserId = sessionStorage.getItem(selectedUserStorageKey);
      const hasStoredInList = storedUserId && collaborators.some((item) => item.id === storedUserId);

      if (hasStoredInList) {
        setSelectedUserId(storedUserId as string);
        return;
      }

      const preferredCollaborator = collaborators.find((item) => item.nomeAbreviado || item.nomeCompleto);
      setSelectedUserId((preferredCollaborator || collaborators[0]).id);
    }
  }, [viewMode, selectedUserId, collaborators, selectedUserStorageKey]);

  useEffect(() => {
    if (viewMode === 'mine') {
      return;
    }

    if (selectedUserId) {
      sessionStorage.setItem(selectedUserStorageKey, selectedUserId);
    }
  }, [viewMode, selectedUserId, selectedUserStorageKey]);

  useEffect(() => {
    if (!targetUserId) {
      setSubmissions([]);
      setHistory([]);
      return;
    }

    void loadDataForTarget(targetUserId);
  }, [targetUserId]);

  // API functions
  async function loadCollaborators() {
    try {
      const response = await apiRequest<{ rows: CollaboratorApiRow[] }>(
        '/users/collaborators?page=1&pageSize=200&sortBy=username&sortDirection=asc',
        { headers: getHeaders() },
      );

      const mappedRows = (response.rows ?? []).map((item) => ({
        id: item.id,
        nomeAbreviado: item.profile?.nomeAbreviado ?? '',
        nomeCompleto: item.profile?.nomeCompleto ?? '',
        username: item.username ?? '',
        role: item.role ?? '',
        teamName: item.team?.name || item.teamMemberships?.[0]?.team?.name || '',
        cargo: item.profile?.cargo ?? '',
        categoriaProfissional: item.profile?.categoriaProfissional ?? '',
      }));

      const filteredRows = mappedRows
        .filter((item) => item.username?.toLowerCase() !== 't.people')
        .sort((a, b) => {
          const aName = (a.nomeAbreviado || a.nomeCompleto || a.username || '').toLowerCase();
          const bName = (b.nomeAbreviado || b.nomeCompleto || b.username || '').toLowerCase();
          return aName.localeCompare(bName);
        });

      setCollaborators(filteredRows);
      if (filteredRows.length === 0) {
        setSelectedUserId('');
      }
    } catch (error) {
      setCollaborators([]);
      setSelectedUserId('');
      showToast('error', error instanceof Error ? error.message : 'Falha ao carregar colaboradores.');
    }
  }

  async function loadDataForTarget(userId: string) {
    setIsLoading(true);

    try {
      const selectedCollaborator = collaborators.find((item) => item.id === userId);
      const levelInput = viewMode === 'mine'
        ? (profile.categoriaProfissional || profile.cargo || 'Associate')
        : (selectedCollaborator?.categoriaProfissional || selectedCollaborator?.cargo || 'Associate');
      const hierarchyLevel = resolveHierarchyLevel(levelInput);

      const [submissionRows, historyRows, questions, competencyRows] = await Promise.all([
        apiRequest<SubmissionItem[]>(`/performance-review/submissions/${userId}`, { headers: getHeaders() }),
        apiRequest<HistoryItem[]>(`/performance-review/submissions/${userId}/history`, { headers: getHeaders() }),
        apiRequest<LeadershipQuestion[]>('/performance-review/leadership-questions', { headers: getHeaders() }),
        apiRequest<CompetencyTemplateRow[]>(
          `/performance-review/competencies/${encodeURIComponent(hierarchyLevel)}`,
          { headers: getHeaders() },
        ).catch(() => []),
      ]);

      setSubmissions(submissionRows);
      setHistory(historyRows);
      setLeadershipQuestions(questions);
      setCompetenciesTemplate(Array.isArray(competencyRows) ? competencyRows : []);
    } catch (error) {
      showToast('error', error instanceof Error ? error.message : 'Falha ao carregar avaliação.');
    } finally {
      setIsLoading(false);
    }
  }

  // Section opening with data loading
  function openSection(section: SectionType) {
    const preferredType = viewMode === 'mine' ? 'SELF' : 'MANAGER';
    setActiveCollaboratorType(preferredType);
    setActiveSection(section);

    const existingSelf = sectionMap.get(`${section}-SELF`)?.content ?? {};
    const existingManager = sectionMap.get(`${section}-MANAGER`)?.content ?? {};

    if (section === 'REFLECTION_PREVIOUS_CYCLE') {
      setReflectionSelfForm({
        mainDeliveries: toText(existingSelf.mainDeliveries),
        mainChallenges: toText(existingSelf.mainChallenges),
        pointsToDevelop: toText(existingSelf.pointsToDevelop),
      });
      setReflectionManagerForm({
        mainDeliveries: toText(existingManager.mainDeliveries),
        mainChallenges: toText(existingManager.mainChallenges),
        pointsToDevelop: toText(existingManager.pointsToDevelop),
      });
      return;
    }

    if (section === 'BEHAVIORAL_COMPETENCIES') {
      const existing = sectionMap.get(`${section}-${preferredType}`)?.content ?? {};
      const ratings = Array.isArray(existing.ratings) ? (existing.ratings as any[]) : [];
      const ratingByCompetency = new Map(
        ratings.map((entry) => [
          `${toText(entry.organizationValue)}|${toText(entry.competency)}`,
          typeof entry.rating === 'number' ? entry.rating : null,
        ]),
      );

      setCompetenciesForm(
        competenciesTemplate.map((item, index) => {
          const key = `${item.organizationValue}|${item.competency}`;
          const keyedRating = ratingByCompetency.get(key);
          const positionalRating = ratings[index]?.rating;

          return {
            organizationValue: item.organizationValue,
            competency: item.competency,
            description: item.description,
            rating: typeof keyedRating === 'number'
              ? keyedRating
              : (typeof positionalRating === 'number' ? positionalRating : null),
          };
        }),
      );
      return;
    }

    if (section === 'OBJECTIVES_KPIS_CURRENT_YEAR') {
      const existing = sectionMap.get(`${section}-${preferredType}`)?.content ?? {};
      const rows = Array.isArray(existing.kpis) ? existing.kpis : [];
      if (rows.length > 0) {
        setKpiCurrentForm(rows.slice(0, 6).map((item: any) => ({
          individual: toText(item.individual),
          weight: String(item.weight ?? ''),
          objectiveValue: String(item.objectiveValue ?? ''),
          result: String(item.result ?? ''),
          comments: toText(item.comments),
        })));
      }
      return;
    }

    if (section === 'LEADERSHIP_REFLECTION') {
      const existing = sectionMap.get(`${section}-${preferredType}`)?.content ?? {};
      const answers = Array.isArray(existing.answers) ? existing.answers : [];
      const mapped: Record<string, string> = {};
      answers.forEach((item: any) => {
        if (typeof item.questionId === 'string') {
          mapped[item.questionId] = toText(item.answer);
        }
      });
      setLeadershipForm(mapped);
      return;
    }

    if (section === 'NEXT_CYCLE_REFLECTION') {
      const existing = sectionMap.get(`${section}-${preferredType}`)?.content ?? {};
      setNextCycleForm({
        areasOfInterest: toText(existing.areasOfInterest),
        possibleNextRole: toText(existing.possibleNextRole),
        potentialBackups: Array.isArray(existing.potentialBackups)
          ? (existing.potentialBackups as unknown[]).map((value) => String(value)).join(', ')
          : toText(existing.potentialBackups),
        identifiedNeeds: toText(existing.identifiedNeeds),
        trainingOrInitiativesSuggestion: toText(existing.trainingOrInitiativesSuggestion),
        recommendedPeriod: toText(existing.recommendedPeriod),
      });
      return;
    }

    if (section === 'OBJECTIVES_KPIS_NEXT_YEAR') {
      const existing = sectionMap.get(`${section}-${preferredType}`)?.content ?? {};
      const rows = Array.isArray(existing.kpis) ? existing.kpis : [];
      if (rows.length > 0) {
        setKpiNextForm(rows.slice(0, 6).map((item: any) => ({
          individual: toText(item.individual),
          weight: String(item.weight ?? ''),
          objectiveValue: String(item.objectiveValue ?? ''),
          comments: toText(item.comments),
        })));
      }
    }
  }

  useEffect(() => {
    if (activeSection !== 'BEHAVIORAL_COMPETENCIES') {
      return;
    }

    const existing = sectionMap.get(`${activeSection}-${activeCollaboratorType}`)?.content ?? {};
    const ratings = Array.isArray(existing.ratings) ? (existing.ratings as any[]) : [];
    const ratingByCompetency = new Map(
      ratings.map((entry) => [
        `${toText(entry.organizationValue)}|${toText(entry.competency)}`,
        typeof entry.rating === 'number' ? entry.rating : null,
      ]),
    );

    setCompetenciesForm(
      competenciesTemplate.map((item, index) => {
        const key = `${item.organizationValue}|${item.competency}`;
        const keyedRating = ratingByCompetency.get(key);
        const positionalRating = ratings[index]?.rating;

        return {
          organizationValue: item.organizationValue,
          competency: item.competency,
          description: item.description,
          rating: typeof keyedRating === 'number'
            ? keyedRating
            : (typeof positionalRating === 'number' ? positionalRating : null),
        };
      }),
    );
  }, [
    activeSection,
    activeCollaboratorType,
    competenciesTemplate,
    sectionMap,
  ]);

  // Get payload for saving
  function getContentPayload(section: SectionType): Record<string, unknown> {
    if (section === 'REFLECTION_PREVIOUS_CYCLE') {
      return activeCollaboratorType === 'MANAGER' ? reflectionManagerForm : reflectionSelfForm;
    }

    if (section === 'BEHAVIORAL_COMPETENCIES') {
      return {
        ratings: competenciesForm.map((row) => ({
          organizationValue: row.organizationValue,
          competency: row.competency,
          rating: row.rating,
        })),
      };
    }

    if (section === 'OBJECTIVES_KPIS_CURRENT_YEAR') {
      return {
        year: new Date().getFullYear(),
        kpis: kpiCurrentForm.filter((row) => row.individual.trim()),
      };
    }

    if (section === 'LEADERSHIP_REFLECTION') {
      return {
        answers: leadershipQuestions.map((question) => ({
          questionId: question.id,
          answer: leadershipForm[question.id] || '',
        })),
      };
    }

    if (section === 'NEXT_CYCLE_REFLECTION') {
      return {
        ...nextCycleForm,
        potentialBackups: nextCycleForm.potentialBackups
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean),
      };
    }

    return {
      year: new Date().getFullYear() + 1,
      kpis: kpiNextForm.filter((row) => row.individual.trim()),
    };
  }

  // Save section
  async function saveSection() {
    if (!activeSection || !targetUserId) {
      showToast('error', 'Seleciona um bloco para guardar.');
      return;
    }

    setIsLoading(true);

    try {
      if (activeSection === 'REFLECTION_PREVIOUS_CYCLE') {
        const collaboratorTypeToSave: CollaboratorType = viewMode === 'mine' ? 'SELF' : 'MANAGER';
        const payloadToSave = collaboratorTypeToSave === 'SELF' ? reflectionSelfForm : reflectionManagerForm;
        const existingReflection = sectionMap.get(`${activeSection}-${collaboratorTypeToSave}`);

        if (existingReflection) {
          await apiRequest(`/performance-review/submissions/${existingReflection.id}`, {
            method: 'PATCH',
            headers: getHeaders(),
            body: JSON.stringify({ content: payloadToSave }),
          });
        } else {
          await apiRequest('/performance-review/submissions', {
            method: 'POST',
            headers: getHeaders(),
            body: JSON.stringify({
              userId: targetUserId,
              sectionType: activeSection,
              collaboratorType: collaboratorTypeToSave,
              content: payloadToSave,
            }),
          });
        }

        await loadDataForTarget(targetUserId);
        showToast('success', 'Reflexão guardada com sucesso.');
        return;
      }

      const payload = getContentPayload(activeSection);
      const existing = sectionMap.get(`${activeSection}-${activeCollaboratorType}`);

      if (existing) {
        await apiRequest(`/performance-review/submissions/${existing.id}`, {
          method: 'PATCH',
          headers: getHeaders(),
          body: JSON.stringify({ content: payload }),
        });
      } else {
        await apiRequest('/performance-review/submissions', {
          method: 'POST',
          headers: getHeaders(),
          body: JSON.stringify({
            userId: targetUserId,
            sectionType: activeSection,
            collaboratorType: activeCollaboratorType,
            content: payload,
          }),
        });
      }

      await loadDataForTarget(targetUserId);
      showToast('success', 'Bloco guardado com sucesso.');
    } catch (error) {
      showToast('error', error instanceof Error ? error.message : 'Falha ao guardar bloco.');
    } finally {
      setIsLoading(false);
    }
  }

  function getOwnerCollaboratorType(): CollaboratorType {
    return viewMode === 'mine' ? 'SELF' : 'MANAGER';
  }

  const submittableBlocks = useMemo<BatchSubmittableBlock[]>(() => {
    const ownerType = getOwnerCollaboratorType();

    return SECTION_DEFINITIONS.flatMap((section) => {
      const submission = sectionMap.get(`${section.id}-${ownerType}`);
      if (!submission) {
        return [];
      }

      if (submission.status !== 'DRAFT' && submission.status !== 'REVISED') {
        return [];
      }

      return [{
        sectionId: section.id,
        title: section.title,
        submissionId: submission.id,
        status: submission.status,
      }];
    });
  }, [sectionMap, viewMode]);

  function openBatchSubmitModal() {
    if (!targetUserId) {
      showToast('error', 'Seleciona um colaborador primeiro.');
      return;
    }

    if (submittableBlocks.length === 0) {
      showToast('error', 'Não existem blocos elegíveis para submeter.');
      return;
    }

    setSelectedBatchSubmissionIds(submittableBlocks.map((item) => item.submissionId));
    setIsBatchSubmitOpen(true);
  }

  async function submitSelectedBlocks() {
    if (!targetUserId) {
      showToast('error', 'Seleciona um colaborador primeiro.');
      return;
    }

    if (selectedBatchSubmissionIds.length === 0) {
      showToast('error', 'Seleciona pelo menos um bloco para submeter.');
      return;
    }

    setIsLoading(true);

    try {
      await apiRequest<{ updated: SubmissionItem[] }>('/performance-review/submissions/batch-submit', {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({
          userId: targetUserId,
          submissionIds: selectedBatchSubmissionIds,
        }),
      });

      await loadDataForTarget(targetUserId);
      setIsBatchSubmitOpen(false);
      setSelectedBatchSubmissionIds([]);
      showToast('success', 'Blocos submetidos para aprovação com sucesso.');
    } catch (error) {
      showToast('error', error instanceof Error ? error.message : 'Falha ao submeter blocos.');
    } finally {
      setIsLoading(false);
    }
  }

  // Get success message for workflow action
  function getWorkflowSuccessMessage(action: 'submit' | 'accept-edits' | 'reject-edits' | 'accept'): string {
    if (action === 'submit') return 'Bloco submetido com sucesso para aprovação.';
    if (action === 'accept') return 'Bloco aceite com sucesso.';
    if (action === 'accept-edits') return 'Edições aceites com sucesso.';
    if (action === 'reject-edits') return 'Bloco devolvido para revisão.';
    return 'Ação executada com sucesso.';
  }

  // Run workflow action
  async function runWorkflowAction(action: 'submit' | 'accept-edits' | 'reject-edits' | 'accept') {
    if (!selectedSubmission) {
      showToast('error', 'Guarda o bloco primeiro antes de submeter.');
      return;
    }

    setIsLoading(true);

    try {
      await apiRequest(`/performance-review/submissions/${selectedSubmission.id}/${action}`, {
        method: 'POST',
        headers: getHeaders(),
      });

      await loadDataForTarget(targetUserId);
      setActiveSection(null);
      showToast('success', getWorkflowSuccessMessage(action));
    } catch (error) {
      showToast('error', error instanceof Error ? error.message : 'Falha ao executar ação.');
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <section className="prv-page">
      <nav className="prv-submenu" aria-label="Vista da avaliação">
        <button
          type="button"
          className={`prv-submenu__btn${viewMode === 'mine' ? ' is-active' : ''}`}
          onClick={() => setViewMode('mine')}
        >
          Minha avaliação
        </button>
        {canViewTeam && (
          <button
            type="button"
            className={`prv-submenu__btn${viewMode === 'team' ? ' is-active' : ''}`}
            onClick={() => setViewMode('team')}
          >
            Equipa
          </button>
        )}
        {canViewOrg && (
          <button
            type="button"
            className={`prv-submenu__btn${viewMode === 'org' ? ' is-active' : ''}`}
            onClick={() => setViewMode('org')}
          >
            RH / Organização
          </button>
        )}
      </nav>

      {viewMode !== 'mine' && (
        <article className="prv-panel">
          <div className="prv-collaborators-picker">
            <span className="prv-collaborators-picker__label">Selecionar colaborador</span>
            {collaborators.length === 0 ? (
              <p className="prv-empty">Sem colaboradores visíveis para o teu escopo atual.</p>
            ) : (
              <div className="prv-collaborators-list" role="list">
                {collaborators.map((item) => {
                  const name = item.nomeAbreviado || item.nomeCompleto || item.username || item.id;
                  const isActive = selectedUserId === item.id;
                  const initials = name
                    .split(' ')
                    .map((part) => part.trim().charAt(0))
                    .filter(Boolean)
                    .slice(0, 2)
                    .join('')
                    .toUpperCase();

                  return (
                    <button
                      key={item.id}
                      type="button"
                      className={`prv-collaborators-list__item${isActive ? ' is-active' : ''}`}
                      onClick={() => {
                        setSelectedUserId(item.id);
                        setActiveSection(null);
                      }}
                    >
                      <span className="prv-collaborators-list__head">
                        <span className="prv-collaborators-list__avatar">{initials || '??'}</span>
                        <span className="prv-collaborators-list__identity">
                          <strong>{name}</strong>
                          {item.teamName ? <small>{item.teamName}</small> : null}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </article>
      )}



      <section className="prv-grid prv-grid--3col">
        <div className="prv-panel" style={{ gridColumn: '1 / -1' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
            <div>
              <strong>Submissão global para RH</strong>
              <p className="prv-empty" style={{ margin: '6px 0 0' }}>
                Seleciona e submete vários blocos de uma vez.
              </p>
            </div>
            <button
              type="button"
              className="prv-btn prv-btn--primary"
              onClick={openBatchSubmitModal}
              disabled={isLoading || submittableBlocks.length === 0}
              title={submittableBlocks.length === 0 ? 'Sem blocos elegíveis para submissão.' : undefined}
            >
              Submeter blocos para RH
            </button>
          </div>
        </div>

        {SECTION_DEFINITIONS.map((section) => {
          const selfSubmission = sectionMap.get(`${section.id}-SELF`);
          const managerSubmission = sectionMap.get(`${section.id}-MANAGER`);
          const primaryStatus =
            (viewMode === 'mine' ? selfSubmission?.status : managerSubmission?.status) ||
            selfSubmission?.status ||
            managerSubmission?.status;

          return (
            <button
              key={section.id}
              type="button"
              className="prv-card"
              onClick={() => openSection(section.id)}
            >
              <div className="prv-card__head">
                <h2>{section.title}</h2>
                <span className={`prv-badge ${statusBadgeClass(primaryStatus)}`}>
                  {getStatusLabel(primaryStatus)}
                </span>
              </div>
              <p>{section.subtitle}</p>
            </button>
          );
        })}
      </section>

      <Modal
        open={isBatchSubmitOpen}
        title="Submeter blocos para RH"
        onClose={() => setIsBatchSubmitOpen(false)}
        width="min(720px, 94vw)"
        footer={(
          <div className="prv-modal__actions">
            <button type="button" className="prv-btn" onClick={() => setIsBatchSubmitOpen(false)}>
              Cancelar
            </button>
            <button
              type="button"
              className="prv-btn prv-btn--primary"
              onClick={() => void submitSelectedBlocks()}
              disabled={isLoading || selectedBatchSubmissionIds.length === 0}
            >
              Submeter selecionados
            </button>
          </div>
        )}
      >
        {submittableBlocks.length === 0 ? (
          <p className="prv-empty">Não existem blocos elegíveis para submissão neste momento.</p>
        ) : (
          <div className="prv-modal-grid">
            {submittableBlocks.map((block) => {
              const checked = selectedBatchSubmissionIds.includes(block.submissionId);
              return (
                <label key={block.submissionId} className="prv-field" style={{ gap: '8px' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(event) => {
                        const isChecked = event.target.checked;
                        setSelectedBatchSubmissionIds((current) => {
                          if (isChecked) {
                            return current.includes(block.submissionId)
                              ? current
                              : [...current, block.submissionId];
                          }
                          return current.filter((id) => id !== block.submissionId);
                        });
                      }}
                    />
                    {block.title}
                  </span>
                  <small>Estado atual: {getStatusLabel(block.status)}</small>
                </label>
              );
            })}
          </div>
        )}
      </Modal>

      <Modal
        open={Boolean(activeSection)}
        title={
          activeSection ? SECTION_DEFINITIONS.find((item) => item.id === activeSection)?.title || 'Bloco' : 'Bloco'
        }
        onClose={() => setActiveSection(null)}
        width="min(1020px, 95vw)"
        footer={(() => {
          const isReflectionSection = activeSection === 'REFLECTION_PREVIOUS_CYCLE';
          const currentStatus = selectedSubmission?.status;
          const isOwner = activeCollaboratorType === getOwnerCollaboratorType();
          const availableActions = getAvailableActions(currentStatus, isOwner);

          return (
            <div className="prv-modal__footer">
              <div className="prv-modal__status">
                <span className="prv-modal__status-label">Estado:</span>
                <span className={`prv-badge ${statusBadgeClass(currentStatus)}`}>
                  {getStatusLabel(currentStatus)}
                </span>
              </div>

              <div className="prv-modal__actions">
                <button type="button" className="prv-btn" onClick={() => setActiveSection(null)}>
                  Fechar
                </button>

                {isReflectionSection && (
                  <button
                    type="button"
                    className="prv-btn prv-btn--primary"
                    onClick={() => {
                      void saveSection();
                    }}
                    disabled={isLoading}
                  >
                    Guardar
                  </button>
                )}

                {isReflectionSection && availableActions.includes('submit') && (
                  <button
                    type="button"
                    className="prv-btn prv-btn--primary"
                    onClick={() => {
                      void runWorkflowAction('submit');
                    }}
                    disabled={isLoading || !selectedSubmission}
                    title={!selectedSubmission ? 'Guarda o bloco antes de submeter' : undefined}
                  >
                    Submeter para aprovação
                  </button>
                )}

                {!isReflectionSection && availableActions.includes('save') && (
                  <button
                    type="button"
                    className="prv-btn prv-btn--primary"
                    onClick={() => {
                      void saveSection();
                    }}
                    disabled={isLoading}
                  >
                    Guardar
                  </button>
                )}

                {!isReflectionSection && availableActions.includes('submit') && (
                  <button
                    type="button"
                    className="prv-btn prv-btn--primary"
                    onClick={() => {
                      void runWorkflowAction('submit');
                    }}
                    disabled={isLoading || !selectedSubmission}
                    title={!selectedSubmission ? 'Guarda o bloco antes de submeter' : undefined}
                  >
                    Submeter para aprovação
                  </button>
                )}

                {!isReflectionSection && availableActions.includes('accept') && (
                  <button
                    type="button"
                    className="prv-btn prv-btn--primary"
                    onClick={() => {
                      void runWorkflowAction('accept');
                    }}
                    disabled={isLoading}
                  >
                    Aceitar
                  </button>
                )}

                {!isReflectionSection && availableActions.includes('accept-edits') && (
                  <button
                    type="button"
                    className="prv-btn"
                    onClick={() => {
                      void runWorkflowAction('accept-edits');
                    }}
                    disabled={isLoading}
                  >
                    Aceitar edições
                  </button>
                )}

                {!isReflectionSection && availableActions.includes('reject-edits') && (
                  <button
                    type="button"
                    className="prv-btn prv-btn--danger"
                    onClick={() => {
                      void runWorkflowAction('reject-edits');
                    }}
                    disabled={isLoading}
                  >
                    Rejeitar edições
                  </button>
                )}
              </div>
            </div>
          );
        })()}
      >
        {activeSection === 'REFLECTION_PREVIOUS_CYCLE' && (
          <div className="prv-reflection-container">
            <div className="prv-reflection-section">
              <h3 className="prv-reflection-title">📝 Minha reflexão (Colaborador)</h3>
              <p className="prv-reflection-note">
                {viewMode === 'mine' ? 'Faz a tua avaliação' : 'Apenas de leitura'}
              </p>

              <label className="prv-field">
                <span>Principais entregas</span>
                <textarea
                  value={reflectionSelfForm.mainDeliveries}
                  onChange={(event) =>
                    setReflectionSelfForm((prev) => ({ ...prev, mainDeliveries: event.target.value }))
                  }
                  rows={4}
                  disabled={viewMode !== 'mine'}
                />
              </label>
              <label className="prv-field">
                <span>Principais desafios</span>
                <textarea
                  value={reflectionSelfForm.mainChallenges}
                  onChange={(event) =>
                    setReflectionSelfForm((prev) => ({ ...prev, mainChallenges: event.target.value }))
                  }
                  rows={4}
                  disabled={viewMode !== 'mine'}
                />
              </label>
              <label className="prv-field">
                <span>Pontos a desenvolver</span>
                <textarea
                  value={reflectionSelfForm.pointsToDevelop}
                  onChange={(event) =>
                    setReflectionSelfForm((prev) => ({ ...prev, pointsToDevelop: event.target.value }))
                  }
                  rows={4}
                  disabled={viewMode !== 'mine'}
                />
              </label>
            </div>

            <div className="prv-reflection-section prv-reflection-section--manager">
              <h3 className="prv-reflection-title">👔 Reflexão do Gestor</h3>
              <p className="prv-reflection-note">
                {viewMode === 'mine' ? 'Leitura do feedback do gestor' : 'Podes editar a reflexão do gestor'}
              </p>

              <label className="prv-field">
                <span>Principais entregas</span>
                <textarea
                  value={reflectionManagerForm.mainDeliveries}
                  onChange={(event) =>
                    setReflectionManagerForm((prev) => ({ ...prev, mainDeliveries: event.target.value }))
                  }
                  rows={4}
                  disabled={viewMode === 'mine'}
                />
              </label>
              <label className="prv-field">
                <span>Principais desafios</span>
                <textarea
                  value={reflectionManagerForm.mainChallenges}
                  onChange={(event) =>
                    setReflectionManagerForm((prev) => ({ ...prev, mainChallenges: event.target.value }))
                  }
                  rows={4}
                  disabled={viewMode === 'mine'}
                />
              </label>
              <label className="prv-field">
                <span>Pontos a desenvolver</span>
                <textarea
                  value={reflectionManagerForm.pointsToDevelop}
                  onChange={(event) =>
                    setReflectionManagerForm((prev) => ({ ...prev, pointsToDevelop: event.target.value }))
                  }
                  rows={4}
                  disabled={viewMode === 'mine'}
                />
              </label>
            </div>
          </div>
        )}

        {activeSection === 'BEHAVIORAL_COMPETENCIES' && (
          <div className="prv-competencies">
            {competenciesForm.map((item, index) => (
              <div key={`${item.organizationValue}-${item.competency}`} className="prv-competency-row">
                <div>
                  <strong>{item.organizationValue}</strong>
                  <p>{item.competency}</p>
                  <small>{item.description}</small>
                </div>
                <select
                  value={item.rating ?? ''}
                  onChange={(event) => {
                    const value = event.target.value ? Number(event.target.value) : null;
                    setCompetenciesForm((prev) =>
                      prev.map((row, rowIndex) => (rowIndex === index ? { ...row, rating: value } : row)),
                    );
                  }}
                >
                  <option value="">-</option>
                  <option value="1">1</option>
                  <option value="2">2</option>
                  <option value="3">3</option>
                  <option value="4">4</option>
                  <option value="5">5</option>
                </select>
              </div>
            ))}
          </div>
        )}

        {(activeSection === 'OBJECTIVES_KPIS_CURRENT_YEAR' || activeSection === 'OBJECTIVES_KPIS_NEXT_YEAR') && (
          <div className="prv-kpi-table-wrap">
            <table className="prv-kpi-table">
              <thead>
                <tr>
                  <th>Objetivo</th>
                  <th>Peso</th>
                  <th>Meta</th>
                  {activeSection === 'OBJECTIVES_KPIS_CURRENT_YEAR' && <th>Resultado</th>}
                  <th>Comentários</th>
                </tr>
              </thead>
              <tbody>
                {(activeSection === 'OBJECTIVES_KPIS_CURRENT_YEAR' ? kpiCurrentForm : kpiNextForm).map((row, index) => (
                  <tr key={`kpi-row-${index}`}>
                    <td>
                      <input
                        value={row.individual}
                        onChange={(event) => {
                          const value = event.target.value;
                          if (activeSection === 'OBJECTIVES_KPIS_CURRENT_YEAR') {
                            setKpiCurrentForm((prev) =>
                              prev.map((item, itemIndex) =>
                                itemIndex === index ? { ...item, individual: value } : item,
                              ),
                            );
                          } else {
                            setKpiNextForm((prev) =>
                              prev.map((item, itemIndex) =>
                                itemIndex === index ? { ...item, individual: value } : item,
                              ),
                            );
                          }
                        }}
                      />
                    </td>
                    <td>
                      <input
                        value={row.weight}
                        onChange={(event) => {
                          const value = event.target.value;
                          if (activeSection === 'OBJECTIVES_KPIS_CURRENT_YEAR') {
                            setKpiCurrentForm((prev) =>
                              prev.map((item, itemIndex) =>
                                itemIndex === index ? { ...item, weight: value } : item,
                              ),
                            );
                          } else {
                            setKpiNextForm((prev) =>
                              prev.map((item, itemIndex) =>
                                itemIndex === index ? { ...item, weight: value } : item,
                              ),
                            );
                          }
                        }}
                      />
                    </td>
                    <td>
                      <input
                        value={row.objectiveValue}
                        onChange={(event) => {
                          const value = event.target.value;
                          if (activeSection === 'OBJECTIVES_KPIS_CURRENT_YEAR') {
                            setKpiCurrentForm((prev) =>
                              prev.map((item, itemIndex) =>
                                itemIndex === index ? { ...item, objectiveValue: value } : item,
                              ),
                            );
                          } else {
                            setKpiNextForm((prev) =>
                              prev.map((item, itemIndex) =>
                                itemIndex === index ? { ...item, objectiveValue: value } : item,
                              ),
                            );
                          }
                        }}
                      />
                    </td>
                    {activeSection === 'OBJECTIVES_KPIS_CURRENT_YEAR' && (
                      <td>
                        <input
                          value={(row as any).result || ''}
                          onChange={(event) => {
                            const value = event.target.value;
                            setKpiCurrentForm((prev) =>
                              prev.map((item, itemIndex) =>
                                itemIndex === index ? { ...item, result: value } : item,
                              ),
                            );
                          }}
                        />
                      </td>
                    )}
                    <td>
                      <input
                        value={row.comments}
                        onChange={(event) => {
                          const value = event.target.value;
                          if (activeSection === 'OBJECTIVES_KPIS_CURRENT_YEAR') {
                            setKpiCurrentForm((prev) =>
                              prev.map((item, itemIndex) =>
                                itemIndex === index ? { ...item, comments: value } : item,
                              ),
                            );
                          } else {
                            setKpiNextForm((prev) =>
                              prev.map((item, itemIndex) =>
                                itemIndex === index ? { ...item, comments: value } : item,
                              ),
                            );
                          }
                        }}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {activeSection === 'LEADERSHIP_REFLECTION' && (
          <div className="prv-modal-grid">
            {leadershipQuestions.map((question) => (
              <label key={question.id} className="prv-field">
                <span>
                  {question.order}. {question.question}
                </span>
                <textarea
                  value={leadershipForm[question.id] || ''}
                  onChange={(event) =>
                    setLeadershipForm((prev) => ({ ...prev, [question.id]: event.target.value }))
                  }
                  rows={3}
                />
              </label>
            ))}
          </div>
        )}

        {activeSection === 'NEXT_CYCLE_REFLECTION' && (
          <div className="prv-modal-grid">
            <label className="prv-field">
              <span>Áreas de interesse</span>
              <textarea
                value={nextCycleForm.areasOfInterest}
                onChange={(event) =>
                  setNextCycleForm((prev) => ({ ...prev, areasOfInterest: event.target.value }))
                }
                rows={3}
              />
            </label>
            <label className="prv-field">
              <span>Possível próxima função</span>
              <input
                value={nextCycleForm.possibleNextRole}
                onChange={(event) =>
                  setNextCycleForm((prev) => ({ ...prev, possibleNextRole: event.target.value }))
                }
              />
            </label>
            <label className="prv-field">
              <span>Potenciais backups (separado por vírgula)</span>
              <input
                value={nextCycleForm.potentialBackups}
                onChange={(event) =>
                  setNextCycleForm((prev) => ({ ...prev, potentialBackups: event.target.value }))
                }
              />
            </label>
            <label className="prv-field">
              <span>Necessidades identificadas</span>
              <textarea
                value={nextCycleForm.identifiedNeeds}
                onChange={(event) =>
                  setNextCycleForm((prev) => ({ ...prev, identifiedNeeds: event.target.value }))
                }
                rows={3}
              />
            </label>
            <label className="prv-field">
              <span>Sugestão de formação/iniciativas</span>
              <textarea
                value={nextCycleForm.trainingOrInitiativesSuggestion}
                onChange={(event) =>
                  setNextCycleForm((prev) => ({
                    ...prev,
                    trainingOrInitiativesSuggestion: event.target.value,
                  }))
                }
                rows={3}
              />
            </label>
            <label className="prv-field">
              <span>Período recomendado</span>
              <input
                value={nextCycleForm.recommendedPeriod}
                onChange={(event) =>
                  setNextCycleForm((prev) => ({ ...prev, recommendedPeriod: event.target.value }))
                }
              />
            </label>
          </div>
        )}
      </Modal>

      <Toast show={toast.visible} tone={toast.tone} message={toast.message} onClose={hideToast} />
    </section>
  );
}
