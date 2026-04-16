import { ChangeEvent, useEffect, useMemo, useRef, useState } from 'react';
import { apiRequest, apiRequestCached, authHeaders, clearApiCache, getApiBase, getBackendBase, isAbortError } from '../portal/api';
import { usePortal } from '../portal/context';
import { estadoCivilOptions, generoOptions, habilitacoesOptions, irsJovemOptions, parentescoOptions, regimeHorarioOptions, situacaoIrsOptions, tipoContratoOptions } from '../portal/data';
import { formatRoleLabel } from '../portal/labels';
import Badge from '../components/ui/Badge';
import DataTable from '../components/ui/DataTable';
import Button from '../components/ui/Button';
import Modal from '../components/ui/Modal';
import Skeleton from '../components/ui/Skeleton';
import EmptyState from '../components/ui/EmptyState';

const STORAGE_TOKEN_KEY = 'smarter_hub_auth_token';
const PERMISSION_CATEGORIES = ['SYSTEM', 'USERS', 'TEAMS', 'VACATIONS', 'TRAININGS', 'PROFILE', 'RECEIPTS', 'NOTIFICATIONS'] as const;
type PermissionCategory = typeof PERMISSION_CATEGORIES[number];

type CollaboratorRow = {
  id: string;
  username: string;
  email: string;
  role: 'COLABORADOR' | 'MANAGER' | 'COORDENADOR' | 'ADMIN' | 'CONVIDADO';
  teamId?: string | null;
  isActive: boolean;
  deactivatedAt: string | null;
  updatedAt: string;
  team?: { id: string; name: string } | null;
  teamRole?: 'LEADER' | 'MEMBER' | null;
  managedTeams?: Array<{ id: string; name: string }>;
  teamMemberships?: Array<{
    teamId: string;
    team?: { id: string; name: string } | null;
  }>;
  profile?: {
    nomeAbreviado?: string;
    primeiroNome?: string;
    apelido?: string;
    dataNascimento?: string;
    genero?: string;
    estadoCivil?: string;
    habilitacoesLiterarias?: string;
    curso?: string;
    faculdade?: string;
    nacionalidade?: string;
    emailPessoal?: string;
    telemovel?: string;
    githubUser?: string;
    moradaFiscal?: string;
    endereco?: string;
    cargo?: string;
    funcao?: string;
    codigoPostal?: string;
    matriculaCarro?: string;
    cartaoCidadao?: string;
    validadeCartaoCidadao?: string;
    nif?: string;
    niss?: string;
    iban?: string;
    situacaoIrs?: string;
    numeroDependentes?: string;
    irsJovem?: string;
    anoPrimeiroDesconto?: string;
    numeroCartaoContinente?: string;
    voucherNosData?: string;
    comprovativoMoradaFiscal?: string;
    comprovativoCartaoCidadao?: string;
    comprovativoIban?: string;
    comprovativoCartaoContinente?: string;
    contactoEmergenciaNome?: string;
    contactoEmergenciaParentesco?: string;
    contactoEmergenciaNumero?: string;
    dataInicioContrato?: string;
    dataFimContrato?: string;
    tipoContrato?: string;
    regimeHorario?: string;
    workCountry?: 'PT' | 'BR';
    localidade?: string;
  } | null;
};

type CollaboratorEditDraft = {
  role: CollaboratorRow['role'];
  teamId: string;
  isActive: boolean;
  workCountry: 'PT' | 'BR';
  primeiroNome: string;
  apelido: string;
  nomeAbreviado: string;
  dataNascimento: string;
  genero: string;
  estadoCivil: string;
  habilitacoesLiterarias: string;
  curso: string;
  faculdade: string;
  nacionalidade: string;
  emailPessoal: string;
  telemovel: string;
  githubUser: string;
  moradaFiscal: string;
  endereco: string;
  localidade: string;
  codigoPostal: string;
  matriculaCarro: string;
  cartaoCidadao: string;
  validadeCartaoCidadao: string;
  nif: string;
  niss: string;
  iban: string;
  situacaoIrs: string;
  numeroDependentes: string;
  irsJovem: string;
  anoPrimeiroDesconto: string;
  numeroCartaoContinente: string;
  voucherNosData: string;
  comprovativoMoradaFiscal: string;
  comprovativoCartaoCidadao: string;
  comprovativoIban: string;
  comprovativoCartaoContinente: string;
  contactoEmergenciaNome: string;
  contactoEmergenciaParentesco: string;
  contactoEmergenciaNumero: string;
  cargo: string;
  funcao: string;
  dataInicioContrato: string;
  dataFimContrato: string;
  tipoContrato: string;
  regimeHorario: string;
};

const EDIT_PROFILE_FIELDS: Array<{ key: keyof CollaboratorEditDraft; label: string; section: 'identificacao' | 'contactos' | 'fiscal' | 'emergencia' | 'contrato' }> = [
  { key: 'primeiroNome', label: 'Primeiro nome', section: 'identificacao' },
  { key: 'apelido', label: 'Apelido', section: 'identificacao' },
  { key: 'nomeAbreviado', label: 'Nome abreviado', section: 'identificacao' },
  { key: 'dataNascimento', label: 'Data de nascimento', section: 'identificacao' },
  { key: 'genero', label: 'Género', section: 'identificacao' },
  { key: 'estadoCivil', label: 'Estado civil', section: 'identificacao' },
  { key: 'habilitacoesLiterarias', label: 'Habilitações literárias', section: 'identificacao' },
  { key: 'curso', label: 'Curso', section: 'identificacao' },
  { key: 'faculdade', label: 'Faculdade', section: 'identificacao' },
  { key: 'nacionalidade', label: 'Nacionalidade', section: 'identificacao' },
  { key: 'emailPessoal', label: 'Email pessoal', section: 'contactos' },
  { key: 'telemovel', label: 'Telemóvel', section: 'contactos' },
  { key: 'githubUser', label: 'GitHub', section: 'contactos' },
  { key: 'moradaFiscal', label: 'Morada fiscal', section: 'contactos' },
  { key: 'endereco', label: 'Morada habitual', section: 'contactos' },
  { key: 'localidade', label: 'Localidade', section: 'contactos' },
  { key: 'codigoPostal', label: 'Código postal', section: 'contactos' },
  { key: 'matriculaCarro', label: 'Matrícula do carro', section: 'fiscal' },
  { key: 'cartaoCidadao', label: 'Cartão de cidadão', section: 'fiscal' },
  { key: 'validadeCartaoCidadao', label: 'Validade cartão de cidadão', section: 'fiscal' },
  { key: 'nif', label: 'NIF', section: 'fiscal' },
  { key: 'niss', label: 'NISS', section: 'fiscal' },
  { key: 'iban', label: 'IBAN', section: 'fiscal' },
  { key: 'situacaoIrs', label: 'Situação IRS', section: 'fiscal' },
  { key: 'numeroDependentes', label: 'Número de dependentes', section: 'fiscal' },
  { key: 'irsJovem', label: 'IRS jovem', section: 'fiscal' },
  { key: 'anoPrimeiroDesconto', label: 'Ano do primeiro desconto', section: 'fiscal' },
  { key: 'numeroCartaoContinente', label: 'Cartão Continente', section: 'fiscal' },
  { key: 'voucherNosData', label: 'Voucher NOS data', section: 'fiscal' },
  { key: 'comprovativoMoradaFiscal', label: 'Comprovativo morada fiscal', section: 'fiscal' },
  { key: 'comprovativoCartaoCidadao', label: 'Comprovativo cartão de cidadão', section: 'fiscal' },
  { key: 'comprovativoIban', label: 'Comprovativo IBAN', section: 'fiscal' },
  { key: 'comprovativoCartaoContinente', label: 'Comprovativo cartão Continente', section: 'fiscal' },
  { key: 'contactoEmergenciaNome', label: 'Nome contacto emergência', section: 'emergencia' },
  { key: 'contactoEmergenciaParentesco', label: 'Parentesco contacto emergência', section: 'emergencia' },
  { key: 'contactoEmergenciaNumero', label: 'Número contacto emergência', section: 'emergencia' },
  { key: 'cargo', label: 'Cargo', section: 'contrato' },
  { key: 'funcao', label: 'Função', section: 'contrato' },
  { key: 'dataInicioContrato', label: 'Data início contrato', section: 'contrato' },
  { key: 'dataFimContrato', label: 'Data fim contrato', section: 'contrato' },
  { key: 'tipoContrato', label: 'Tipo contrato', section: 'contrato' },
  { key: 'regimeHorario', label: 'Regime horário', section: 'contrato' },
];

const EMPTY_EDIT_DRAFT: CollaboratorEditDraft = {
  role: 'COLABORADOR',
  teamId: '',
  isActive: true,
  workCountry: 'PT',
  primeiroNome: '',
  apelido: '',
  nomeAbreviado: '',
  dataNascimento: '',
  genero: '',
  estadoCivil: '',
  habilitacoesLiterarias: '',
  curso: '',
  faculdade: '',
  nacionalidade: '',
  emailPessoal: '',
  telemovel: '',
  githubUser: '',
  moradaFiscal: '',
  endereco: '',
  localidade: '',
  codigoPostal: '',
  matriculaCarro: '',
  cartaoCidadao: '',
  validadeCartaoCidadao: '',
  nif: '',
  niss: '',
  iban: '',
  situacaoIrs: '',
  numeroDependentes: '',
  irsJovem: '',
  anoPrimeiroDesconto: '',
  numeroCartaoContinente: '',
  voucherNosData: '',
  comprovativoMoradaFiscal: '',
  comprovativoCartaoCidadao: '',
  comprovativoIban: '',
  comprovativoCartaoContinente: '',
  contactoEmergenciaNome: '',
  contactoEmergenciaParentesco: '',
  contactoEmergenciaNumero: '',
  cargo: '',
  funcao: '',
  dataInicioContrato: '',
  dataFimContrato: '',
  tipoContrato: '',
  regimeHorario: '',
};

const CARGO_OPTIONS = [
  'Trainee',
  'Junior',
  'Associate',
  'Senior',
  'Lead',
  'Principal',
  'Director',
  'C Level',
];

const FUNCAO_OPTIONS = [
  'Administrative Assistant',
  'Business Analyst',
  'Business Consultant',
  'Business Controller',
  'CEO',
  'Communication Manager',
  'Communication Specialist',
  'Data Analyst',
  'Data Engineer',
  'Data Science Manager',
  'Data Scientist',
  'Delivery Director',
  'Delivery Manager',
  'DevOps Engineer',
  'DevOps Manager',
  'Estagiario',
  'Managing Director',
  'Operations & Control Director',
  'Operations & Control Manager',
  'People Director',
  'People Manager',
  'People Partner',
  'Pre-Sales Consultant',
  'Product Architect',
  'Product Director',
  'Product Manager',
  'Product Owner',
  'Project Manager',
  'Quality Analyst',
  'Quality Manager',
  'Sales Consultant',
  'Sales Director',
  'Sales Manager',
  'Scrum Master',
  'Service Analyst',
  'Service Director',
  'Service Engineer',
  'Service Manager',
  'Software Developer',
  'Software Engineer',
  'Strategic Solutions Consultant',
  'Technical Consultant',
  'UX UI Designer',
];

function buildEditDraftFromRow(item: CollaboratorRow): CollaboratorEditDraft {
  const profile = item.profile || {};
  return {
    role: item.role,
    teamId: item.teamId || '',
    isActive: item.isActive,
    workCountry: profile.workCountry || 'PT',
    primeiroNome: profile.primeiroNome || '',
    apelido: profile.apelido || '',
    nomeAbreviado: profile.nomeAbreviado || '',
    dataNascimento: profile.dataNascimento || '',
    genero: profile.genero || '',
    estadoCivil: profile.estadoCivil || '',
    habilitacoesLiterarias: profile.habilitacoesLiterarias || '',
    curso: profile.curso || '',
    faculdade: profile.faculdade || '',
    nacionalidade: profile.nacionalidade || '',
    emailPessoal: profile.emailPessoal || '',
    telemovel: profile.telemovel || '',
    githubUser: profile.githubUser || '',
    moradaFiscal: profile.moradaFiscal || '',
    endereco: profile.endereco || '',
    localidade: profile.localidade || '',
    codigoPostal: profile.codigoPostal || '',
    matriculaCarro: profile.matriculaCarro || '',
    cartaoCidadao: profile.cartaoCidadao || '',
    validadeCartaoCidadao: profile.validadeCartaoCidadao || '',
    nif: profile.nif || '',
    niss: profile.niss || '',
    iban: profile.iban || '',
    situacaoIrs: profile.situacaoIrs || '',
    numeroDependentes: profile.numeroDependentes || '',
    irsJovem: profile.irsJovem || '',
    anoPrimeiroDesconto: profile.anoPrimeiroDesconto || '',
    numeroCartaoContinente: profile.numeroCartaoContinente || '',
    voucherNosData: profile.voucherNosData || '',
    comprovativoMoradaFiscal: profile.comprovativoMoradaFiscal || '',
    comprovativoCartaoCidadao: profile.comprovativoCartaoCidadao || '',
    comprovativoIban: profile.comprovativoIban || '',
    comprovativoCartaoContinente: profile.comprovativoCartaoContinente || '',
    contactoEmergenciaNome: profile.contactoEmergenciaNome || '',
    contactoEmergenciaParentesco: profile.contactoEmergenciaParentesco || '',
    contactoEmergenciaNumero: profile.contactoEmergenciaNumero || '',
    cargo: profile.cargo || '',
    funcao: profile.funcao || '',
    dataInicioContrato: profile.dataInicioContrato || '',
    dataFimContrato: profile.dataFimContrato || '',
    tipoContrato: profile.tipoContrato || '',
    regimeHorario: profile.regimeHorario || '',
  };
}

function getCollaboratorTeamInfo(item: CollaboratorRow) {
  const resolvedTeam = getCollaboratorPrimaryTeam(item);

  if (!resolvedTeam) {
    return { name: '-', isLeader: false };
  }

  const isLeader = item.teamRole === 'LEADER'
    || Boolean(item.managedTeams?.some((team) => team.id === resolvedTeam.id));

  return { name: resolvedTeam.name, isLeader };
}

function getCollaboratorPrimaryTeam(item: CollaboratorRow) {
  if (item.team?.name) {
    return item.team;
  }

  if (item.teamMemberships?.[0]?.team?.name) {
    return item.teamMemberships[0].team;
  }

  return item.managedTeams?.[0] ?? null;
}

type CollaboratorsResponse = {
  total: number;
  page: number;
  pageSize: number;
  rows: CollaboratorRow[];
};

type PermissionGrantUser = {
  id: string;
  username: string;
  profile?: {
    nomeAbreviado?: string;
    primeiroNome?: string;
    apelido?: string;
  } | null;
};

type PermissionAssignment = {
  isEnabled: boolean;
  restrictedToTeams: string[];
  restrictedToCountries: Array<'PT' | 'BR'>;
  restrictedToLevels: string[];
  customRestrictions: unknown;
  notes: string | null;
  grantedBy?: PermissionGrantUser | null;
};

type PermissionItem = {
  id: string;
  code: string;
  label: string;
  description: string;
  category: PermissionCategory;
  assignment: PermissionAssignment | null;
};

type UserPermissionsResponse = {
  user: {
    id: string;
    username: string;
    email: string;
    isActive: boolean;
    isRootAccess: boolean;
    profile?: {
      nomeAbreviado?: string;
      primeiroNome?: string;
      apelido?: string;
    } | null;
  };
  accessTotal: boolean;
  permissions: PermissionItem[];
};

type CollaboratorDetailsCacheEntry = {
  selectedPermissions: PermissionItem[];
  selectedUserAccessTotal: boolean;
  permissionTeams: TeamOption[];
  customCargoOptions: CustomProfileOption[];
  customFuncaoOptions: CustomProfileOption[];
};

type TeamOption = {
  id: string;
  name: string;
};

type CustomProfileOption = {
  id: string;
  label: string;
  groupLabel?: string | null;
};

type PermissionDraft = {
  enabled: boolean;
  restrictedToTeams: string;
  restrictedToCountries: string;
  restrictedToLevels: string;
  customRestrictions: string;
  notes: string;
};

const EMPTY_PERMISSION_DRAFT: PermissionDraft = {
  enabled: false,
  restrictedToTeams: '',
  restrictedToCountries: '',
  restrictedToLevels: '',
  customRestrictions: '',
  notes: '',
};

function getAuthHeaders() {
  const token = localStorage.getItem(STORAGE_TOKEN_KEY) || '';
  return authHeaders(token);
}

function normalizeDropdownValues(values: string[]) {
  const unique = new Map<string, string>();
  for (const value of values) {
    const cleaned = value.trim();
    if (!cleaned) {
      continue;
    }
    const key = cleaned.toLowerCase();
    if (!unique.has(key)) {
      unique.set(key, cleaned);
    }
  }
  return Array.from(unique.values()).sort((a, b) => a.localeCompare(b, 'pt-PT'));
}

function normalizeFileUrl(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return '';
  }

  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }

  if (trimmed.startsWith('/uploads/')) {
    return `${getBackendBase()}${trimmed}`;
  }

  if (trimmed.startsWith('uploads/')) {
    return `${getBackendBase()}/${trimmed}`;
  }

  return `${getBackendBase()}/uploads/${trimmed.replace(/^\/+/, '')}`;
}

function getDisplayName(item: CollaboratorRow) {
  const shortName = item.profile?.nomeAbreviado?.trim();
  if (shortName) {
    return shortName;
  }

  const fullName = `${item.profile?.primeiroNome ?? ''} ${item.profile?.apelido ?? ''}`.trim();
  return fullName || item.username;
}

function getGrantDisplayName(user?: PermissionGrantUser | null) {
  const shortName = user?.profile?.nomeAbreviado?.trim();
  if (shortName) {
    return shortName;
  }

  const fullName = `${user?.profile?.primeiroNome ?? ''} ${user?.profile?.apelido ?? ''}`.trim();
  return fullName || user?.username || 'Sistema';
}

function normalizeList(input: string) {
  return input
    .split(/[,\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function toggleCommaItem(source: string, item: string) {
  const normalized = normalizeList(source);
  return normalized.includes(item)
    ? normalized.filter((entry) => entry !== item).join(', ')
    : [...normalized, item].join(', ');
}

function parseJsonOrNull(input: string) {
  const trimmed = input.trim();
  if (!trimmed) {
    return undefined;
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

function getPermissionCategoryLabel(category: PermissionCategory) {
  switch (category) {
    case 'SYSTEM': return 'Sistema';
    case 'USERS': return 'Utilizadores';
    case 'TEAMS': return 'Equipas';
    case 'VACATIONS': return 'Férias';
    case 'TRAININGS': return 'Formações';
    case 'PROFILE': return 'Perfil';
    case 'RECEIPTS': return 'Recibos';
    case 'NOTIFICATIONS': return 'Notificações';
    default: return category;
  }
}

function buildDraftFromAssignment(item: PermissionItem, forceEnabled = false): PermissionDraft {
  return {
    enabled: forceEnabled || item.assignment?.isEnabled || false,
    restrictedToTeams: item.assignment?.restrictedToTeams?.join(', ') ?? '',
    restrictedToCountries: item.assignment?.restrictedToCountries?.join(', ') ?? '',
    restrictedToLevels: item.assignment?.restrictedToLevels?.join(', ') ?? '',
    customRestrictions: item.assignment?.customRestrictions ? JSON.stringify(item.assignment.customRestrictions, null, 2) : '',
    notes: item.assignment?.notes ?? '',
  };
}

export default function CollaboratorsPage() {
  const { hasPermission, isRootAccess, isAccessTotal, currentUser } = usePortal();
  const canView = isRootAccess || hasPermission('view_user_list');
  const canEditUser = isRootAccess || hasPermission('edit_user');
  const canManagePermissions = isRootAccess || hasPermission('manage_permissions');
  const canManageActive = isRootAccess || hasPermission('manage_user_active');

  const [rows, setRows] = useState<CollaboratorRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [query, setQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<'ALL' | CollaboratorRow['role']>('ALL');
  const [activeFilter, setActiveFilter] = useState<'ALL' | 'ACTIVE' | 'INACTIVE'>('ALL');
  const [countryFilter, setCountryFilter] = useState<'ALL' | 'PT' | 'BR'>('ALL');
  const [sortBy, setSortBy] = useState<'createdAt' | 'updatedAt' | 'username' | 'email' | 'role'>('updatedAt');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('');
  const [busyUserId, setBusyUserId] = useState<string | null>(null);
  const [activeConfirmTarget, setActiveConfirmTarget] = useState<CollaboratorRow | null>(null);
  const [selectedRow, setSelectedRow] = useState<CollaboratorRow | null>(null);
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const [detailsTab, setDetailsTab] = useState<'ficha' | 'permissoes' | 'estado'>('ficha');
  const [permissionCategory, setPermissionCategory] = useState<PermissionCategory>('USERS');
  const [isLoadingDetails, setIsLoadingDetails] = useState(false);
  const [selectedUserAccessTotal, setSelectedUserAccessTotal] = useState(false);
  const [selectedPermissions, setSelectedPermissions] = useState<PermissionItem[]>([]);
  const [permissionDrafts, setPermissionDrafts] = useState<Record<string, PermissionDraft>>({});
  const [savingPermissionId, setSavingPermissionId] = useState<string | null>(null);
  const [isTogglingAccessTotal, setIsTogglingAccessTotal] = useState(false);
  const [accessTotalModalOpen, setAccessTotalModalOpen] = useState(false);
  const [accessTotalAction, setAccessTotalAction] = useState<'grant' | 'revoke'>('grant');
  const [accessTotalReason, setAccessTotalReason] = useState('');
  const [selectedPermissionId, setSelectedPermissionId] = useState<string | null>(null);
  const [permissionSearch, setPermissionSearch] = useState('');
  const [permissionTeams, setPermissionTeams] = useState<TeamOption[]>([]);
  const [pendingTeamToAdd, setPendingTeamToAdd] = useState('');
  const [editDraft, setEditDraft] = useState<CollaboratorEditDraft>(EMPTY_EDIT_DRAFT);
  const [isSavingEditDraft, setIsSavingEditDraft] = useState(false);
  const [customCargoOptions, setCustomCargoOptions] = useState<CustomProfileOption[]>([]);
  const [customFuncaoOptions, setCustomFuncaoOptions] = useState<CustomProfileOption[]>([]);
  const [isProfileOptionModalOpen, setIsProfileOptionModalOpen] = useState(false);
  const [profileOptionType, setProfileOptionType] = useState<'CARGO' | 'FUNCAO'>('CARGO');
  const [profileOptionLabel, setProfileOptionLabel] = useState('');
  const [profileOptionGroup, setProfileOptionGroup] = useState('');
  const [isSavingProfileOption, setIsSavingProfileOption] = useState(false);
  const canManageProfileOptions = isRootAccess || isAccessTotal || hasPermission('manage_profile_dropdown_options');
  const collaboratorQueryInputRef = useRef<HTMLInputElement | null>(null);
  const collaboratorQueryRef = useRef(query);
  const detailsLoadControllerRef = useRef<AbortController | null>(null);
  const [detailsCacheByUserId, setDetailsCacheByUserId] = useState<Record<string, CollaboratorDetailsCacheEntry>>({});

  useEffect(() => {
    collaboratorQueryRef.current = query;
  }, [query]);

  const cargoDropdownOptions = useMemo(
    () => normalizeDropdownValues([
      ...CARGO_OPTIONS,
      ...rows.map((item) => item.profile?.cargo || ''),
      ...customCargoOptions.map((item) => item.label),
      editDraft.cargo,
    ]),
    [customCargoOptions, editDraft.cargo, rows],
  );

  const funcaoDropdownOptions = useMemo(
    () => normalizeDropdownValues([
      ...FUNCAO_OPTIONS,
      ...rows.map((item) => item.profile?.funcao || ''),
      ...customFuncaoOptions.map((item) => item.label),
      editDraft.funcao,
    ]),
    [customFuncaoOptions, editDraft.funcao, rows],
  );

  const hiddenFileInputId = (fieldKey: string) => `collaborator-${fieldKey}-file`;

  const totalPages = useMemo(() => Math.max(1, Math.ceil(total / pageSize)), [total, pageSize]);
  const visibleRows = useMemo(
    () => rows.filter((item) => item.id !== currentUser?.id),
    [rows, currentUser?.id],
  );
  const visibleTotal = Math.max(0, total - (rows.some((item) => item.id === currentUser?.id) ? 1 : 0));
  const categoryPermissions = useMemo(
    () => selectedPermissions.filter((item) => item.category === permissionCategory),
    [permissionCategory, selectedPermissions],
  );

  const filteredCategoryPermissions = useMemo(() => {
    const normalized = permissionSearch.trim().toLowerCase();
    if (!normalized) {
      return categoryPermissions;
    }

    return categoryPermissions.filter((item) =>
      `${item.label} ${item.description} ${item.code}`.toLowerCase().includes(normalized),
    );
  }, [categoryPermissions, permissionSearch]);

  const selectedPermission = useMemo(
    () => filteredCategoryPermissions.find((item) => item.id === selectedPermissionId) || filteredCategoryPermissions[0] || null,
    [filteredCategoryPermissions, selectedPermissionId],
  );

  const selectedPermissionDraft = selectedPermission
    ? (permissionDrafts[selectedPermission.id] ?? buildDraftFromAssignment(selectedPermission))
    : null;

  const selectedRestrictionCountries = selectedPermissionDraft ? normalizeList(selectedPermissionDraft.restrictedToCountries) : [];
  const selectedRestrictedTeamIds = selectedPermissionDraft ? normalizeList(selectedPermissionDraft.restrictedToTeams) : [];
  const selectedRowTeam = useMemo(() => {
    if (!selectedRow) {
      return null;
    }

    const resolvedTeam = getCollaboratorPrimaryTeam(selectedRow);
    return resolvedTeam ? { id: resolvedTeam.id, name: resolvedTeam.name } : null;
  }, [selectedRow]);
  const collaboratorTeamOptions = useMemo(() => {
    const options: TeamOption[] = [];

    if (selectedRowTeam) {
      options.push(selectedRowTeam);
    }

    for (const team of permissionTeams) {
      if (!options.some((item) => item.id === team.id)) {
        options.push(team);
      }
    }

    return options;
  }, [permissionTeams, selectedRowTeam]);
  const selectedRestrictedTeams = useMemo(
    () => permissionTeams.filter((team) => selectedRestrictedTeamIds.includes(team.id)),
    [permissionTeams, selectedRestrictedTeamIds],
  );
  const availableTeamsToAdd = useMemo(
    () => permissionTeams.filter((team) => !selectedRestrictedTeamIds.includes(team.id)),
    [permissionTeams, selectedRestrictedTeamIds],
  );

  useEffect(() => {
    if (filteredCategoryPermissions.length === 0) {
      setSelectedPermissionId(null);
      return;
    }

    if (!selectedPermissionId || !filteredCategoryPermissions.some((item) => item.id === selectedPermissionId)) {
      setSelectedPermissionId(filteredCategoryPermissions[0].id);
    }
  }, [filteredCategoryPermissions, selectedPermissionId]);

  useEffect(() => {
    if (!canView) {
      return;
    }

    const controller = new AbortController();
    void loadCollaborators(controller.signal);

    return () => {
      controller.abort();
    };
  }, [canView, page, pageSize, query, roleFilter, activeFilter, countryFilter, sortBy, sortDirection]);

  useEffect(() => {
    const syncQueryFromInput = () => {
      const inputValue = collaboratorQueryInputRef.current?.value ?? '';

      if (inputValue !== collaboratorQueryRef.current) {
        collaboratorQueryRef.current = inputValue;
        setPage(1);
        setQuery(inputValue);
      }
    };

    const timeoutId = window.setTimeout(syncQueryFromInput, 0);
    window.addEventListener('pageshow', syncQueryFromInput);

    return () => {
      window.clearTimeout(timeoutId);
      window.removeEventListener('pageshow', syncQueryFromInput);
    };
  }, []);

  useEffect(() => {
    return () => {
      detailsLoadControllerRef.current?.abort();
    };
  }, []);

  async function loadCollaborators(signal?: AbortSignal) {
    setLoading(rows.length === 0);
    try {
      const params = new URLSearchParams();
      params.set('page', String(page));
      params.set('pageSize', String(pageSize));
      params.set('sortBy', sortBy);
      params.set('sortDirection', sortDirection);

      if (query.trim()) {
        params.set('q', query.trim());
      }
      if (roleFilter !== 'ALL') {
        params.set('role', roleFilter);
      }
      if (activeFilter !== 'ALL') {
        params.set('active', activeFilter === 'ACTIVE' ? 'true' : 'false');
      }
      if (countryFilter !== 'ALL') {
        params.set('workCountry', countryFilter);
      }

      const data = await apiRequestCached<CollaboratorsResponse>(`/users/collaborators?${params.toString()}`, {
        headers: getAuthHeaders(),
        signal,
      }, 10000);

      setRows(data.rows);
      setTotal(data.total);
      setStatus('');
    } catch (error) {
      if (isAbortError(error) || signal?.aborted) {
        return;
      }

      setStatus(error instanceof Error ? error.message : 'Falha ao carregar colaboradores.');
    } finally {
      if (!signal?.aborted) {
        setLoading(false);
      }
    }
  }

  async function toggleActive(item: CollaboratorRow) {
    setBusyUserId(item.id);
    try {
      await apiRequest(`/users/${item.id}/active`, {
        method: 'PATCH',
        headers: getAuthHeaders(),
        body: JSON.stringify({ isActive: !item.isActive }),
      });

      clearApiCache('/users/collaborators');
      await loadCollaborators();
      setStatus(item.isActive ? 'Colaborador desativado com sucesso.' : 'Colaborador reativado com sucesso.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Falha ao alterar estado do colaborador.');
    } finally {
      setBusyUserId(null);
    }
  }

  function openActiveConfirm(item: CollaboratorRow) {
    setActiveConfirmTarget(item);
  }

  async function confirmToggleActive() {
    if (!activeConfirmTarget) {
      return;
    }

    await toggleActive(activeConfirmTarget);
    setActiveConfirmTarget(null);
  }

  async function openDetails(item: CollaboratorRow, initialTab: 'ficha' | 'permissoes' | 'estado' = 'ficha') {
    detailsLoadControllerRef.current?.abort();

    setSelectedRow(item);
    setDetailsTab(initialTab);
    setIsDetailsOpen(true);
    setEditDraft(buildEditDraftFromRow(item));
    setPermissionSearch('');
    setPendingTeamToAdd('');

    const cached = detailsCacheByUserId[item.id];
    if (cached) {
      setIsLoadingDetails(false);
      setSelectedPermissions(cached.selectedPermissions);
      setSelectedUserAccessTotal(cached.selectedUserAccessTotal);
      setPermissionTeams(cached.permissionTeams);
      setCustomCargoOptions(cached.customCargoOptions);
      setCustomFuncaoOptions(cached.customFuncaoOptions);
      setPermissionDrafts(Object.fromEntries(cached.selectedPermissions.map((permission) => [permission.id, buildDraftFromAssignment(permission, cached.selectedUserAccessTotal)])));
      setSelectedPermissionId(cached.selectedPermissions[0]?.id ?? null);
      return;
    }

    setIsLoadingDetails(true);
    setSelectedPermissions([]);
    setSelectedUserAccessTotal(false);
    setPermissionDrafts({});
    setPermissionTeams([]);
    setCustomCargoOptions([]);
    setCustomFuncaoOptions([]);
    setSelectedPermissionId(null);

    const controller = new AbortController();
    detailsLoadControllerRef.current = controller;

    try {
      const loadPermissionTeams = async () => {
        try {
          const adminTeams = await apiRequestCached<Array<{ id: string; name: string }>>('/admin/teams', {
            headers: getAuthHeaders(),
            signal: controller.signal,
          }, 8000, true);
          return (adminTeams || []).map((team) => ({ id: team.id, name: team.name }));
        } catch {
          try {
            const scopedTeams = await apiRequestCached<Array<{ id: string; name: string }>>('/teams', {
              headers: getAuthHeaders(),
              signal: controller.signal,
            }, 8000, true);
            return (scopedTeams || []).map((team) => ({ id: team.id, name: team.name }));
          } catch {
            return [];
          }
        }
      };

      const [details, permissionTeams, profileOptions] = await Promise.all([
        apiRequest<UserPermissionsResponse>(`/users/${item.id}/permissions`, {
          headers: getAuthHeaders(),
          signal: controller.signal,
        }),
        loadPermissionTeams(),
        apiRequestCached<{
          cargo?: CustomProfileOption[];
          funcao?: CustomProfileOption[];
        }>('/profile/options', {
          headers: getAuthHeaders(),
          signal: controller.signal,
        }, 8000, true),
      ]);

      if (controller.signal.aborted) {
        return;
      }

      const hasAccessTotal = Boolean(details.accessTotal);
      setSelectedPermissions(details.permissions);
      setSelectedUserAccessTotal(hasAccessTotal);
      setPermissionDrafts(Object.fromEntries(details.permissions.map((permission) => [permission.id, buildDraftFromAssignment(permission, hasAccessTotal)])));
      setSelectedPermissionId(details.permissions[0]?.id ?? null);
      setPermissionSearch('');
      setPendingTeamToAdd('');

      setPermissionTeams(permissionTeams);
      setCustomCargoOptions(profileOptions.cargo ?? []);
      setCustomFuncaoOptions(profileOptions.funcao ?? []);
      setDetailsCacheByUserId((current) => ({
        ...current,
        [item.id]: {
          selectedPermissions: details.permissions,
          selectedUserAccessTotal: hasAccessTotal,
          permissionTeams,
          customCargoOptions: profileOptions.cargo ?? [],
          customFuncaoOptions: profileOptions.funcao ?? [],
        },
      }));
    } catch (error) {
      if (!controller.signal.aborted) {
        setStatus(error instanceof Error ? error.message : 'Falha ao carregar detalhe do colaborador.');
      }
    } finally {
      if (!controller.signal.aborted) {
        setIsLoadingDetails(false);
      }
      if (detailsLoadControllerRef.current === controller) {
        detailsLoadControllerRef.current = null;
      }
    }
  }

  function closeDetails() {
    detailsLoadControllerRef.current?.abort();
    detailsLoadControllerRef.current = null;
    setIsDetailsOpen(false);
  }

  async function openProfileOptionModal(type: 'CARGO' | 'FUNCAO') {
    if (!selectedRow || !canManageProfileOptions) {
      return;
    }

    setProfileOptionType(type);
    setProfileOptionLabel('');
    setProfileOptionGroup('');
    setIsProfileOptionModalOpen(true);
  }

  async function handleCreateProfileOption() {
    const token = localStorage.getItem(STORAGE_TOKEN_KEY) || '';
    const normalizedLabel = profileOptionLabel.trim().replace(/\s+/g, ' ');
    const normalizedGroup = profileOptionGroup.trim().replace(/\s+/g, ' ');

    if (!token || !normalizedLabel) {
      setStatus('Indica um valor válido para adicionar.');
      return;
    }

    setIsSavingProfileOption(true);

    try {
      const payload = await apiRequest<{ option?: { id: string; type: 'CARGO' | 'FUNCAO'; label: string; groupLabel?: string | null } }>('/profile/options', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          type: profileOptionType,
          label: normalizedLabel,
          groupLabel: profileOptionType === 'FUNCAO' ? normalizedGroup : undefined,
        }),
      });

      const created = payload.option;
      if (!created) {
        throw new Error('Não foi possível guardar o valor.');
      }

      if (created.type === 'CARGO') {
        setCustomCargoOptions((current) => [...current, { id: created.id, label: created.label, groupLabel: created.groupLabel }]);
      } else {
        setCustomFuncaoOptions((current) => [...current, { id: created.id, label: created.label, groupLabel: created.groupLabel }]);
      }

      setIsProfileOptionModalOpen(false);
      setStatus('Valor adicionado com sucesso.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Não foi possível adicionar o valor.');
    } finally {
      setIsSavingProfileOption(false);
    }
  }

  async function saveCollaboratorDraft() {
    if (!selectedRow) {
      return;
    }

    setIsSavingEditDraft(true);
    try {
      await apiRequest(`/admin/users/${selectedRow.id}`, {
        method: 'PATCH',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          role: editDraft.role,
          teamId: editDraft.role === 'ADMIN' ? null : (editDraft.teamId || null),
          isActive: editDraft.isActive,
          workCountry: editDraft.workCountry,
          primeiroNome: editDraft.primeiroNome,
          apelido: editDraft.apelido,
          nomeAbreviado: editDraft.nomeAbreviado,
          dataNascimento: editDraft.dataNascimento,
          genero: editDraft.genero,
          estadoCivil: editDraft.estadoCivil,
          habilitacoesLiterarias: editDraft.habilitacoesLiterarias,
          curso: editDraft.curso,
          faculdade: editDraft.faculdade,
          nacionalidade: editDraft.nacionalidade,
          emailPessoal: editDraft.emailPessoal,
          telemovel: editDraft.telemovel,
          githubUser: editDraft.githubUser,
          moradaFiscal: editDraft.moradaFiscal,
          endereco: editDraft.endereco,
          localidade: editDraft.localidade,
          codigoPostal: editDraft.codigoPostal,
          matriculaCarro: editDraft.matriculaCarro,
          cartaoCidadao: editDraft.cartaoCidadao,
          validadeCartaoCidadao: editDraft.validadeCartaoCidadao,
          nif: editDraft.nif,
          niss: editDraft.niss,
          iban: editDraft.iban,
          situacaoIrs: editDraft.situacaoIrs,
          numeroDependentes: editDraft.numeroDependentes,
          irsJovem: editDraft.irsJovem,
          anoPrimeiroDesconto: editDraft.anoPrimeiroDesconto,
          numeroCartaoContinente: editDraft.numeroCartaoContinente,
          voucherNosData: editDraft.voucherNosData,
          comprovativoMoradaFiscal: editDraft.comprovativoMoradaFiscal,
          comprovativoCartaoCidadao: editDraft.comprovativoCartaoCidadao,
          comprovativoIban: editDraft.comprovativoIban,
          comprovativoCartaoContinente: editDraft.comprovativoCartaoContinente,
          contactoEmergenciaNome: editDraft.contactoEmergenciaNome,
          contactoEmergenciaParentesco: editDraft.contactoEmergenciaParentesco,
          contactoEmergenciaNumero: editDraft.contactoEmergenciaNumero,
          cargo: editDraft.cargo,
          funcao: editDraft.funcao,
          dataInicioContrato: editDraft.dataInicioContrato,
          dataFimContrato: editDraft.dataFimContrato,
          tipoContrato: editDraft.tipoContrato,
          regimeHorario: editDraft.regimeHorario,
        }),
      });

      clearApiCache('/users/collaborators');
      await loadCollaborators();
      await openDetails(selectedRow, 'ficha');
      setStatus('Ficha atualizada com sucesso.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Falha ao guardar ficha do colaborador.');
    } finally {
      setIsSavingEditDraft(false);
    }
  }

  async function savePermission(permission: PermissionItem) {
    if (!selectedRow) {
      return;
    }

    if (selectedUserAccessTotal) {
      setStatus('Revoga o acesso total para editar permissões individuais.');
      return;
    }

    const draft = permissionDrafts[permission.id] ?? EMPTY_PERMISSION_DRAFT;
    setSavingPermissionId(permission.id);

    try {
      if (!draft.enabled && permission.assignment) {
        await apiRequest(`/users/${selectedRow.id}/permissions/${permission.id}`, {
          method: 'DELETE',
          headers: getAuthHeaders(),
        });
      } else if (draft.enabled) {
        const body = {
          permissionId: permission.id,
          isEnabled: true,
          restrictedToTeams: normalizeList(draft.restrictedToTeams),
          restrictedToCountries: normalizeList(draft.restrictedToCountries)
            .map((item) => item.toUpperCase())
            .filter((item): item is 'PT' | 'BR' => item === 'PT' || item === 'BR'),
          restrictedToLevels: normalizeList(draft.restrictedToLevels),
          customRestrictions: parseJsonOrNull(draft.customRestrictions),
          notes: draft.notes,
          reason: `Atualização pela gestão de colaboradores para ${selectedRow.username}.`,
        };

        if (permission.assignment) {
          await apiRequest(`/users/${selectedRow.id}/permissions/${permission.id}`, {
            method: 'PATCH',
            headers: getAuthHeaders(),
            body: JSON.stringify(body),
          });
        } else {
          await apiRequest(`/users/${selectedRow.id}/permissions`, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify(body),
          });
        }
      }

      clearApiCache();
      await openDetails(selectedRow);
      setStatus('Permissão atualizada com sucesso.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Falha ao guardar permissão.');
    } finally {
      setSavingPermissionId(null);
    }
  }

  async function toggleAccessTotalForSelected(enable: boolean, reason?: string) {
    if (!selectedRow) {
      return false;
    }

    if (enable === selectedUserAccessTotal) {
      return false;
    }

    setIsTogglingAccessTotal(true);
    try {
      const result = await apiRequest<{ success: boolean; accessTotal: boolean }>(`/users/${selectedRow.id}/access-total`, {
        method: 'PATCH',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          isEnabled: enable,
          reason: reason?.trim() || undefined,
        }),
      });
      clearApiCache();
      setSelectedUserAccessTotal(Boolean(result.accessTotal));
      void openDetails(selectedRow, 'permissoes');
      setStatus(enable ? 'Acesso total concedido.' : 'Acesso total revogado.');
      return true;
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Falha ao atualizar acesso total.');
      return false;
    } finally {
      setIsTogglingAccessTotal(false);
    }
  }

  function addTeamRestriction(teamId: string) {
    if (!selectedPermission || !selectedPermissionDraft || !teamId) {
      return;
    }

    setPermissionDrafts((current) => ({
      ...current,
      [selectedPermission.id]: {
        ...selectedPermissionDraft,
        restrictedToTeams: toggleCommaItem(selectedPermissionDraft.restrictedToTeams, teamId),
      },
    }));
    setPendingTeamToAdd('');
  }

  function removeTeamRestriction(teamId: string) {
    if (!selectedPermission || !selectedPermissionDraft) {
      return;
    }

    setPermissionDrafts((current) => ({
      ...current,
      [selectedPermission.id]: {
        ...selectedPermissionDraft,
        restrictedToTeams: toggleCommaItem(selectedPermissionDraft.restrictedToTeams, teamId),
      },
    }));
  }

  function renderEditFieldControl(fieldKey: keyof CollaboratorEditDraft) {
    const isComprovativoField = fieldKey === 'comprovativoMoradaFiscal'
      || fieldKey === 'comprovativoCartaoCidadao'
      || fieldKey === 'comprovativoIban'
      || fieldKey === 'comprovativoCartaoContinente';

    const value = editDraft[fieldKey] as string;

    const onChangeValue = (nextValue: string) => {
      setEditDraft((current) => ({ ...current, [fieldKey]: nextValue }));
    };

    if (fieldKey === 'genero') {
      return (
        <select value={value} onChange={(event) => onChangeValue(event.target.value)} disabled={!canEditUser}>
          <option value="">Selecionar</option>
          {generoOptions.map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
      );
    }

    if (fieldKey === 'estadoCivil') {
      return (
        <select value={value} onChange={(event) => onChangeValue(event.target.value)} disabled={!canEditUser}>
          <option value="">Selecionar</option>
          {estadoCivilOptions.map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
      );
    }

    if (fieldKey === 'habilitacoesLiterarias') {
      return (
        <select value={value} onChange={(event) => onChangeValue(event.target.value)} disabled={!canEditUser}>
          <option value="">Selecionar</option>
          {habilitacoesOptions.map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
      );
    }

    if (fieldKey === 'situacaoIrs') {
      return (
        <select value={value} onChange={(event) => onChangeValue(event.target.value)} disabled={!canEditUser}>
          <option value="">Selecionar</option>
          {situacaoIrsOptions.map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
      );
    }

    if (fieldKey === 'irsJovem') {
      return (
        <select value={value} onChange={(event) => onChangeValue(event.target.value)} disabled={!canEditUser}>
          <option value="">Selecionar</option>
          {irsJovemOptions.map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
      );
    }

    if (fieldKey === 'contactoEmergenciaParentesco') {
      return (
        <select value={value} onChange={(event) => onChangeValue(event.target.value)} disabled={!canEditUser}>
          <option value="">Selecionar</option>
          {parentescoOptions.map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
      );
    }

    if (fieldKey === 'validadeCartaoCidadao') {
      return (
        <input
          type="date"
          value={value}
          onChange={(event) => onChangeValue(event.target.value)}
          disabled={!canEditUser}
        />
      );
    }

    if (fieldKey === 'tipoContrato') {
      return (
        <select value={value} onChange={(event) => onChangeValue(event.target.value)} disabled={!canEditUser}>
          <option value="">Selecionar</option>
          {tipoContratoOptions.map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
      );
    }

    if (fieldKey === 'regimeHorario') {
      return (
        <select value={value} onChange={(event) => onChangeValue(event.target.value)} disabled={!canEditUser}>
          <option value="">Selecionar</option>
          {regimeHorarioOptions.map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
      );
    }

    if (fieldKey === 'cargo') {
      return (
        <select value={value} onChange={(event) => onChangeValue(event.target.value)} disabled={!canEditUser}>
          <option value="">Selecionar</option>
          {cargoDropdownOptions.map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
      );
    }

    if (fieldKey === 'funcao') {
      return (
        <select value={value} onChange={(event) => onChangeValue(event.target.value)} disabled={!canEditUser}>
          <option value="">Selecionar</option>
          {funcaoDropdownOptions.map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
      );
    }

    if (isComprovativoField) {
      const comprovativoUrl = normalizeFileUrl(value);
      return (
        <div className="collaborator-proof-field">
          <div className="collaborator-proof-field__actions">
            {comprovativoUrl ? (
              <a href={comprovativoUrl} target="_blank" rel="noreferrer" className="collaborator-proof-link">
                Ver atual
              </a>
            ) : (
              <span className="collaborator-proof-link collaborator-proof-link--empty">Sem comprovativo</span>
            )}

            <label className="collaborator-proof-upload">
              <span>Anexar novo</span>
              <input
                id={hiddenFileInputId(fieldKey)}
                type="file"
                accept="image/*,application/pdf"
                onChange={(event) => void handleCollaboratorFileChange(fieldKey, event)}
                onClick={(event) => {
                  event.currentTarget.value = '';
                }}
                disabled={!canEditUser || isSavingEditDraft}
              />
            </label>
          </div>
        </div>
      );
    }

    return (
      <input
        type="text"
        value={value}
        onChange={(event) => onChangeValue(event.target.value)}
        disabled={!canEditUser}
      />
    );
  }

  async function handleCollaboratorFileChange(field: keyof CollaboratorEditDraft, event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    const token = localStorage.getItem(STORAGE_TOKEN_KEY) || '';
    const formData = new FormData();
    formData.append('file', file);

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

      const payload = (await response.json()) as { link?: string; linkPath?: string };
      setEditDraft((current) => ({
        ...current,
        [field]: payload.linkPath || payload.link || '',
      }));
      setStatus('Comprovativo carregado com sucesso.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Falha ao carregar comprovativo.');
    }
  }

  if (!canView) {
    return (
      <section className="trainings-shell">
        <article className="trainings-list-card">
          <h3>Acesso restrito</h3>
          <p>Esta área está disponível para Admin e RH (Coordenador).</p>
        </article>
      </section>
    );
  }

  return (
    <section className="trainings-shell">
      <header className="trainings-hero">
        <div>
          <p className="hero-kicker">Colaboradores</p>
          <h2>Gestão transversal de colaboradores</h2>
          <p>Consulta, filtra e ativa/desativa sem perder histórico de dados.</p>
        </div>
      </header>

      <section className="trainings-list-card">
        <div className="collaborators-filter-grid">
          <label>
            <span>Pesquisar</span>
            <input
              ref={collaboratorQueryInputRef}
              type="search"
              value={query}
              autoComplete="off"
              onChange={(event) => { setPage(1); setQuery(event.target.value); }}
              placeholder="Nome, username, email, cargo, função..."
            />
          </label>

          <label>
            <span>Role</span>
            <select value={roleFilter} onChange={(event) => { setPage(1); setRoleFilter(event.target.value as 'ALL' | CollaboratorRow['role']); }}>
              <option value="ALL">Todas</option>
              <option value="COLABORADOR">{formatRoleLabel('COLABORADOR')}</option>
              <option value="MANAGER">{formatRoleLabel('MANAGER')}</option>
              <option value="COORDENADOR">{formatRoleLabel('COORDENADOR')}</option>
              <option value="ADMIN">{formatRoleLabel('ADMIN')}</option>
            </select>
          </label>

          <label>
            <span>Estado</span>
            <select value={activeFilter} onChange={(event) => { setPage(1); setActiveFilter(event.target.value as 'ALL' | 'ACTIVE' | 'INACTIVE'); }}>
              <option value="ALL">Todos</option>
              <option value="ACTIVE">Ativo</option>
              <option value="INACTIVE">Inativo</option>
            </select>
          </label>

          <label>
            <span>País</span>
            <select value={countryFilter} onChange={(event) => { setPage(1); setCountryFilter(event.target.value as 'ALL' | 'PT' | 'BR'); }}>
              <option value="ALL">Todos</option>
              <option value="PT">Portugal</option>
              <option value="BR">Brasil</option>
            </select>
          </label>

          <label>
            <span>Ordenar por</span>
            <select value={sortBy} onChange={(event) => setSortBy(event.target.value as 'createdAt' | 'updatedAt' | 'username' | 'email' | 'role')}>
              <option value="updatedAt">Atualização</option>
              <option value="createdAt">Criação</option>
              <option value="username">Username</option>
              <option value="email">Email</option>
              <option value="role">Role</option>
            </select>
          </label>

          <label>
            <span>Direção</span>
            <select value={sortDirection} onChange={(event) => setSortDirection(event.target.value as 'asc' | 'desc')}>
              <option value="desc">Descendente</option>
              <option value="asc">Ascendente</option>
            </select>
          </label>

          <label>
            <span>Tamanho página</span>
            <select value={pageSize} onChange={(event) => { setPage(1); setPageSize(Number(event.target.value)); }}>
              <option value={10}>10</option>
              <option value={20}>20</option>
              <option value={50}>50</option>
            </select>
          </label>
        </div>

        <div className="collaborators-table">
          <DataTable
            columns={[
            { key: 'name', header: 'Colaborador', render: (item: CollaboratorRow) => getDisplayName(item) },
            { key: 'email', header: 'Email', render: (item: CollaboratorRow) => <span className="table-nowrap">{item.email}</span> },
            { key: 'role', header: 'Role', render: (item: CollaboratorRow) => <Badge tone="info">{formatRoleLabel(item.role)}</Badge> },
            {
              key: 'team',
              header: 'Equipa',
              render: (item: CollaboratorRow) => {
                const teamInfo = getCollaboratorTeamInfo(item);
                if (teamInfo.name === '-') {
                  return '-';
                }

                return (
                  <span className={`collaborator-team-chip${teamInfo.isLeader ? ' is-leader' : ''}`}>
                    {teamInfo.isLeader ? 'Chefe · ' : ''}{teamInfo.name}
                  </span>
                );
              },
            },
            { key: 'country', header: 'País', render: (item: CollaboratorRow) => <Badge tone="neutral">{item.profile?.workCountry || 'PT'}</Badge> },
            {
              key: 'state',
              header: 'Estado',
              render: (item: CollaboratorRow) => (
                <Badge tone={item.isActive ? 'success' : 'danger'}>{item.isActive ? 'Ativo' : 'Inativo'}</Badge>
              ),
            },
            {
              key: 'actions',
              header: 'Ações',
              render: (item: CollaboratorRow) => (
                <div className="collaborators-actions">
                  <Button type="button" size="sm" variant="primary" onClick={() => void openDetails(item)}>Editar</Button>
                  <Button type="button" size="sm" variant="secondary" onClick={() => void openDetails(item, 'permissoes')} disabled={!canManagePermissions}>Permissões</Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={item.isActive ? 'danger' : 'secondary'}
                    isLoading={busyUserId === item.id}
                    onClick={() => openActiveConfirm(item)}
                    disabled={!canManageActive}
                  >
                    {item.isActive ? 'Desativar' : 'Reativar'}
                  </Button>
                </div>
              ),
              align: 'right',
            },
            ]}
            rows={visibleRows}
            rowKey={(item) => item.id}
            emptyMessage="Sem colaboradores para os filtros aplicados."
            loading={loading}
            loadingLines={4}
            ariaLabel="Lista de colaboradores"
          />
        </div>

        <div className="trainings-form-actions trainings-form-actions--between">
          <small>Resultados: {visibleTotal}</small>
          <div className="trainings-form-actions__group">
            <Button type="button" variant="ghost" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={page <= 1}>Anterior</Button>
            <Button type="button" variant="ghost" onClick={() => setPage((value) => Math.min(totalPages, value + 1))} disabled={page >= totalPages}>Seguinte</Button>
          </div>
        </div>
      </section>

      <Modal
        open={isDetailsOpen}
        title={selectedRow ? `Gestão do colaborador · ${getDisplayName(selectedRow)}` : 'Gestão do colaborador'}
        onClose={closeDetails}
        width="min(1360px, 97vw)"
        showCloseButton={false}
        footer={
          <div className="modal-footer-split">
            <Button type="button" variant="ghost" onClick={closeDetails}>Fechar</Button>
          </div>
        }
      >
        <section className="collaborator-modal-shell">
          <nav className="collaborator-modal-tabs">
            <button type="button" className={detailsTab === 'ficha' ? 'is-active' : ''} onClick={() => setDetailsTab('ficha')}>1. Ficha</button>
            <button type="button" className={detailsTab === 'permissoes' ? 'is-active' : ''} onClick={() => setDetailsTab('permissoes')}>2. Permissões</button>
            <button type="button" className={detailsTab === 'estado' ? 'is-active' : ''} onClick={() => setDetailsTab('estado')}>3. Estado</button>
          </nav>

          {selectedRow && detailsTab === 'ficha' && (
            <section className="collaborator-modal-panel">
              <div className="collaborator-ficha-actions">
                <div>
                  <h4>Ficha editável</h4>
                  <p>Usa esta área para ajustar todos os dados do colaborador.</p>
                </div>
                {canManageProfileOptions && (
                  <div className="profile-contract__actions">
                    <Button type="button" variant="ghost" size="sm" onClick={() => void openProfileOptionModal('CARGO')}>
                      + Novo cargo
                    </Button>
                    <Button type="button" variant="ghost" size="sm" onClick={() => void openProfileOptionModal('FUNCAO')}>
                      + Nova função
                    </Button>
                  </div>
                )}
              </div>

              <div className="collaborator-kpi-grid">
                <article>
                  <span>Nome</span>
                  <strong>{getDisplayName(selectedRow)}</strong>
                </article>
                <article>
                  <span>Email</span>
                  <strong>{selectedRow.email}</strong>
                </article>
                <article>
                  <span>Role</span>
                  <strong>{formatRoleLabel(selectedRow.role)}</strong>
                </article>
                <article>
                  <span>Equipa</span>
                  <strong>{getCollaboratorTeamInfo(selectedRow).name === '-' ? 'Sem equipa' : getCollaboratorTeamInfo(selectedRow).name}</strong>
                </article>
              </div>

              <div className="collaborator-edit-workbench">
                <article className="collaborator-edit-section">
                  <h4>Dados de conta</h4>
                  <div className="collaborator-edit-grid collaborator-edit-grid--top">
                    <label>
                      <span>Username</span>
                      <input type="text" value={selectedRow.username} disabled />
                    </label>
                    <label>
                      <span>Email login</span>
                      <input type="text" value={selectedRow.email} disabled />
                    </label>
                    <label>
                      <span>Role</span>
                      <select value={editDraft.role} onChange={(event) => setEditDraft((current) => ({ ...current, role: event.target.value as CollaboratorRow['role'] }))} disabled={!canEditUser}>
                        <option value="COLABORADOR">{formatRoleLabel('COLABORADOR')}</option>
                        <option value="MANAGER">{formatRoleLabel('MANAGER')}</option>
                        <option value="COORDENADOR">{formatRoleLabel('COORDENADOR')}</option>
                        <option value="ADMIN">{formatRoleLabel('ADMIN')}</option>
                      </select>
                    </label>
                    <label>
                      <span>País de trabalho</span>
                      <select value={editDraft.workCountry} onChange={(event) => setEditDraft((current) => ({ ...current, workCountry: event.target.value as 'PT' | 'BR' }))} disabled={!canEditUser}>
                        <option value="PT">Portugal</option>
                        <option value="BR">Brasil</option>
                      </select>
                    </label>
                    <label>
                      <span>Equipa principal</span>
                      <select value={editDraft.teamId} onChange={(event) => setEditDraft((current) => ({ ...current, teamId: event.target.value }))} disabled={!canEditUser || editDraft.role === 'ADMIN'}>
                        <option value="">Sem equipa</option>
                        {collaboratorTeamOptions.map((team) => (
                          <option key={team.id} value={team.id}>{team.name}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      <span>Estado da conta</span>
                      <select value={editDraft.isActive ? 'ACTIVE' : 'INACTIVE'} onChange={(event) => setEditDraft((current) => ({ ...current, isActive: event.target.value === 'ACTIVE' }))} disabled={!canEditUser || selectedRow.username === 't.people'}>
                        <option value="ACTIVE">Ativa</option>
                        <option value="INACTIVE">Inativa</option>
                      </select>
                    </label>
                  </div>
                </article>

                {['identificacao', 'contactos', 'fiscal', 'emergencia', 'contrato'].map((section) => (
                  <article key={section} className="collaborator-edit-section">
                    <h4>{section === 'identificacao' ? 'Identificação' : section === 'contactos' ? 'Contactos e moradas' : section === 'fiscal' ? 'Fiscal e documentos' : section === 'emergencia' ? 'Emergência' : 'Contrato'}</h4>
                    <div className="collaborator-edit-grid">
                      {EDIT_PROFILE_FIELDS.filter((field) => field.section === section).map((field) => (
                        <label key={field.key}>
                          <span>{field.label}</span>
                          {renderEditFieldControl(field.key)}
                        </label>
                      ))}
                    </div>
                  </article>
                ))}

                <div className="permission-card__footer">
                  <Button type="button" variant="primary" isLoading={isSavingEditDraft} disabled={!canEditUser || isSavingEditDraft} onClick={() => void saveCollaboratorDraft()}>
                    Guardar ficha completa
                  </Button>
                  {!canEditUser && <small>Sem permissões para editar dados deste colaborador.</small>}
                </div>
              </div>
            </section>
          )}

          {selectedRow && detailsTab === 'permissoes' && (
            <section className="collaborator-modal-panel">
              {isLoadingDetails ? (
                <Skeleton lines={3} />
              ) : (
                <>
              <header className="collaborator-permissions-header">
                <div>
                  <h4>Permissões simplificadas</h4>
                  <p>Seleciona uma permissão na lista e configura em 3 passos rápidos.</p>
                  <p className="collab-help-inline">Dica: qualquer campo de restrição deixado vazio significa sem restrição nesse critério.</p>
                  <p className="collab-help-inline">Quando o acesso total estiver ativo, as permissões individuais ficam bloqueadas até revogares esse acesso.</p>
                </div>
                <div className="collaborator-permissions-actions">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    isLoading={isTogglingAccessTotal}
                    onClick={() => {
                      setAccessTotalAction('grant');
                      setAccessTotalReason('');
                      setAccessTotalModalOpen(true);
                    }}
                    disabled={!canManagePermissions || selectedRow.username === 't.people' || selectedUserAccessTotal || isTogglingAccessTotal}
                  >
                    Dar acesso total
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    isLoading={isTogglingAccessTotal}
                    onClick={() => {
                      setAccessTotalAction('revoke');
                      setAccessTotalReason('');
                      setAccessTotalModalOpen(true);
                    }}
                    disabled={!canManagePermissions || selectedRow.username === 't.people' || !selectedUserAccessTotal || isTogglingAccessTotal}
                  >
                    Revogar acesso total
                  </Button>
                </div>
              </header>

              <div className="permissions-tabs collaborator-permission-categories">
                {PERMISSION_CATEGORIES.map((item) => (
                  <button
                    key={item}
                    type="button"
                    className={item === permissionCategory ? 'is-active' : ''}
                    onClick={() => setPermissionCategory(item)}
                  >
                    {getPermissionCategoryLabel(item)}
                  </button>
                ))}
              </div>

              <div className="collab-permissions-workbench">
                <aside className="collab-permissions-list">
                  <label className="collab-permissions-search">
                    <span>Pesquisar permissão</span>
                    <input
                      type="search"
                      placeholder="Ex: aprovar férias, editar utilizador..."
                      value={permissionSearch}
                      onChange={(event) => setPermissionSearch(event.target.value)}
                    />
                  </label>

                  <div className="collab-permissions-items">
                    {filteredCategoryPermissions.length === 0 && (
                      <EmptyState
                        title="Sem permissões nesta categoria."
                        message="Escolhe outra categoria para continuar a configuração."
                      />
                    )}
                    {filteredCategoryPermissions.map((permission) => {
                      const draft = permissionDrafts[permission.id] ?? buildDraftFromAssignment(permission);
                      const effectiveEnabled = selectedUserAccessTotal || draft.enabled;
                      return (
                        <button
                          key={permission.id}
                          type="button"
                          className={`collab-permission-item${selectedPermission?.id === permission.id ? ' is-selected' : ''}${effectiveEnabled ? ' is-enabled' : ''}`}
                          onClick={() => setSelectedPermissionId(permission.id)}
                        >
                          <strong>{permission.label}</strong>
                          <span>{effectiveEnabled ? 'Ativa' : 'Inativa'}</span>
                        </button>
                      );
                    })}
                  </div>
                </aside>

                <section className="collab-permissions-editor">
                  {!selectedPermission || !selectedPermissionDraft ? (
                    <p>Seleciona uma permissão para configurar.</p>
                  ) : (
                    <article className="collab-permission-panel">
                      <header>
                        <h4>{selectedPermission.label}</h4>
                        <p>{selectedPermission.description}</p>
                        <small>Origem atual: {getGrantDisplayName(selectedPermission.assignment?.grantedBy)}</small>
                      </header>

                      <div className="collab-permission-steps">
                        <section>
                          <h5>Passo 1 · Estado</h5>
                          <div className="collab-choice-row">
                            <button
                              type="button"
                              className={selectedPermissionDraft.enabled ? 'is-active' : ''}
                              onClick={() => setPermissionDrafts((current) => ({
                                ...current,
                                [selectedPermission.id]: { ...selectedPermissionDraft, enabled: true },
                              }))}
                              disabled={!canManagePermissions || selectedUserAccessTotal}
                            >
                              Ativar
                            </button>
                            <button
                              type="button"
                              className={!selectedPermissionDraft.enabled ? 'is-active' : ''}
                              onClick={() => setPermissionDrafts((current) => ({
                                ...current,
                                [selectedPermission.id]: { ...selectedPermissionDraft, enabled: false },
                              }))}
                              disabled={!canManagePermissions || selectedUserAccessTotal}
                            >
                              Desativar
                            </button>
                          </div>
                          {selectedUserAccessTotal && <small>Acesso total ativo: todas as permissões estão efetivamente ativas.</small>}
                        </section>

                        <section>
                          <h5>Passo 2 · Restrições rápidas</h5>
                          <div className="collab-permission-form-grid">
                            <label>
                              <span>Países</span>
                              <div className="collab-token-row">
                                {['PT', 'BR'].map((country) => (
                                  <button
                                    key={country}
                                    type="button"
                                    className={selectedRestrictionCountries.includes(country) ? 'is-selected' : ''}
                                    onClick={() => setPermissionDrafts((current) => ({
                                      ...current,
                                      [selectedPermission.id]: {
                                        ...selectedPermissionDraft,
                                        restrictedToCountries: toggleCommaItem(selectedPermissionDraft.restrictedToCountries, country),
                                      },
                                    }))}
                                    disabled={!canManagePermissions || selectedUserAccessTotal}
                                  >
                                    {country}
                                  </button>
                                ))}
                              </div>
                              <small>Opcional: se não marcares nenhum país, a permissão aplica-se a todos.</small>
                            </label>

                            <label>
                              <span>Escopo adicional (opcional)</span>
                              <input
                                type="text"
                                value={selectedPermissionDraft.restrictedToLevels}
                                onChange={(event) => setPermissionDrafts((current) => ({
                                  ...current,
                                  [selectedPermission.id]: {
                                    ...selectedPermissionDraft,
                                    restrictedToLevels: event.target.value,
                                  },
                                }))}
                                placeholder="Ex: etiquetas internas separadas por vírgula"
                                disabled={!canManagePermissions || selectedUserAccessTotal}
                              />
                              <small>Opcional: usa apenas se a tua operação tiver etiquetas de escopo próprias.</small>
                            </label>

                            <label>
                              <span>Equipas</span>
                              <div className="collab-team-selector">
                                <select
                                  value={pendingTeamToAdd}
                                  onChange={(event) => setPendingTeamToAdd(event.target.value)}
                                  disabled={!canManagePermissions || selectedUserAccessTotal || availableTeamsToAdd.length === 0}
                                >
                                  <option value="">Selecionar equipa</option>
                                  {availableTeamsToAdd.map((team) => (
                                    <option key={team.id} value={team.id}>{team.name}</option>
                                  ))}
                                </select>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="secondary"
                                  onClick={() => addTeamRestriction(pendingTeamToAdd)}
                                  disabled={!canManagePermissions || selectedUserAccessTotal || !pendingTeamToAdd}
                                >
                                  Adicionar
                                </Button>
                              </div>
                              {selectedRestrictedTeams.length > 0 && (
                                <div className="collab-team-chips">
                                  {selectedRestrictedTeams.map((team) => (
                                    <button
                                      key={team.id}
                                      type="button"
                                      className="collab-team-chip"
                                      onClick={() => removeTeamRestriction(team.id)}
                                      disabled={!canManagePermissions || selectedUserAccessTotal}
                                    >
                                      {team.name} ×
                                    </button>
                                  ))}
                                </div>
                              )}
                              <small>Opcional: se não adicionares equipas, a permissão aplica-se a todas.</small>
                            </label>

                            <label>
                              <span>Notas</span>
                              <input
                                type="text"
                                value={selectedPermissionDraft.notes}
                                onChange={(event) => setPermissionDrafts((current) => ({
                                  ...current,
                                  [selectedPermission.id]: {
                                    ...selectedPermissionDraft,
                                    notes: event.target.value,
                                  },
                                }))}
                                placeholder="Contexto opcional para esta permissão"
                                disabled={!canManagePermissions || selectedUserAccessTotal}
                              />
                            </label>

                          </div>
                        </section>

                        <section>
                          <h5>Passo 3 · Confirmar</h5>
                          <div className="permission-card__footer">
                            <Button
                              type="button"
                              variant="primary"
                              size="sm"
                              isLoading={savingPermissionId === selectedPermission.id}
                              onClick={() => void savePermission(selectedPermission)}
                              disabled={!canManagePermissions || selectedUserAccessTotal}
                            >
                              Guardar configuração
                            </Button>
                          </div>
                          {selectedUserAccessTotal && <small>Para editar esta permissão individual, revoga primeiro o acesso total.</small>}
                        </section>
                      </div>
                    </article>
                  )}
                </section>
              </div>
                </>
              )}
            </section>
          )}

          {selectedRow && detailsTab === 'estado' && (
            <section className="collaborator-modal-panel">
              {isLoadingDetails ? (
                <Skeleton lines={3} />
              ) : (
                <>
                  <div className="collaborator-kpi-grid">
                    <article>
                      <span>Conta</span>
                      <strong>{selectedRow.isActive ? 'Ativa' : 'Inativa'}</strong>
                    </article>
                    <article>
                      <span>Acesso total</span>
                      <strong>{selectedUserAccessTotal ? 'Sim' : 'Não'}</strong>
                    </article>
                  </div>

                  <div className="collaborator-status-actions">
                    <Button
                      type="button"
                      variant={selectedRow.isActive ? 'danger' : 'secondary'}
                      onClick={() => openActiveConfirm(selectedRow)}
                      disabled={!canManageActive || selectedRow.username === 't.people'}
                    >
                      {selectedRow.isActive ? 'Desativar conta' : 'Reativar conta'}
                    </Button>
                  </div>
                </>
              )}
            </section>
          )}
        </section>
      </Modal>

      <Modal
        open={isProfileOptionModalOpen}
        title={profileOptionType === 'CARGO' ? 'Adicionar novo cargo' : 'Adicionar nova função'}
        onClose={() => setIsProfileOptionModalOpen(false)}
        width="520px"
        footer={(
          <div className="profile-option-modal__footer">
            <Button type="button" variant="ghost" onClick={() => setIsProfileOptionModalOpen(false)} disabled={isSavingProfileOption}>
              Cancelar
            </Button>
            <Button type="button" variant="primary" isLoading={isSavingProfileOption} onClick={() => void handleCreateProfileOption()}>
              Guardar
            </Button>
          </div>
        )}
      >
        <div className="profile-option-modal">
          <label>
            <span>Tipo</span>
            <select value={profileOptionType} onChange={(event) => setProfileOptionType(event.target.value as 'CARGO' | 'FUNCAO')} disabled={isSavingProfileOption}>
              <option value="CARGO">Cargo</option>
              <option value="FUNCAO">Função</option>
            </select>
          </label>

          <label>
            <span>Nome</span>
            <input
              type="text"
              value={profileOptionLabel}
              disabled={isSavingProfileOption}
              placeholder={profileOptionType === 'CARGO' ? 'Ex.: Staff Engineer' : 'Ex.: Data Governance Specialist'}
              onChange={(event) => setProfileOptionLabel(event.target.value)}
            />
          </label>

          {profileOptionType === 'FUNCAO' && (
            <label>
              <span>Grupo (opcional)</span>
              <input
                type="text"
                value={profileOptionGroup}
                disabled={isSavingProfileOption}
                placeholder="Ex.: Produto"
                onChange={(event) => setProfileOptionGroup(event.target.value)}
              />
            </label>
          )}
        </div>
      </Modal>

      <Modal
        open={Boolean(activeConfirmTarget)}
        title={activeConfirmTarget?.isActive ? 'Confirmar desativação' : 'Confirmar reativação'}
        onClose={() => setActiveConfirmTarget(null)}
        width="min(640px, 92vw)"
        showCloseButton={false}
        footer={
          <div className="modal-footer-split">
            <Button type="button" variant="ghost" onClick={() => setActiveConfirmTarget(null)}>Cancelar</Button>
            <Button
              type="button"
              variant={activeConfirmTarget?.isActive ? 'danger' : 'primary'}
              isLoading={Boolean(activeConfirmTarget && busyUserId === activeConfirmTarget.id)}
              disabled={Boolean(activeConfirmTarget && busyUserId === activeConfirmTarget.id)}
              onClick={() => void confirmToggleActive()}
            >
              Confirmar
            </Button>
          </div>
        }
      >
        <div className="permissions-access-modal">
          <p>
            {activeConfirmTarget?.isActive
              ? `Isto vai desativar a conta de ${getDisplayName(activeConfirmTarget)}.`
              : `Isto vai reativar a conta de ${activeConfirmTarget ? getDisplayName(activeConfirmTarget) : 'este colaborador'}.`}
          </p>
        </div>
      </Modal>

      <Modal
        open={accessTotalModalOpen}
        title={accessTotalAction === 'grant' ? 'Dar acesso total' : 'Revogar acesso total'}
        onClose={() => setAccessTotalModalOpen(false)}
        width="min(720px, 92vw)"
        showCloseButton={false}
        footer={
          <div className="modal-footer-split">
            <Button type="button" variant="ghost" onClick={() => setAccessTotalModalOpen(false)}>Cancelar</Button>
            <Button
              type="button"
              variant={accessTotalAction === 'grant' ? 'primary' : 'danger'}
              isLoading={isTogglingAccessTotal}
              disabled={isTogglingAccessTotal}
              onClick={() => {
                void (async () => {
                  const success = await toggleAccessTotalForSelected(accessTotalAction === 'grant', accessTotalReason);
                  if (success) {
                    setAccessTotalModalOpen(false);
                    setAccessTotalReason('');
                  }
                })();
              }}
            >
              Confirmar
            </Button>
          </div>
        }
      >
        <div className="permissions-access-modal">
          <p>
            {accessTotalAction === 'grant'
              ? 'Isto vai conceder acesso total a todas as permissões deste utilizador.'
              : 'Isto vai revogar o acesso total e repor as permissões padrão de funcionário.'}
          </p>
        </div>
      </Modal>

      {status && <p className="trainings-status">{status}</p>}
    </section>
  );
}
