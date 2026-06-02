import { ChangeEvent, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { apiRequest, apiRequestCached, authHeaders, clearApiCache, getApiBase, getBackendBase, isAbortError } from '../portal/api';
import { getStoredAuthToken } from '../portal/auth-storage';
import { usePortal } from '../portal/context';
import { createAdmissionRequest, loadAdmissionFormSettings, saveAdmissionFormSettings } from '../portal/api-endpoints';
import {
  createProfileOption,
  createUserPermission,
  loadAdminTeams,
  loadProfileHistory,
  loadProfileOptions,
  loadTeams,
  loadUserPermissions,
  revokeUserPermission,
  setUserAccessTotal,
  toggleUserActive,
  updateUser,
  updateUserCredentials,
  updateUserPermission,
} from '../portal/user-api';
import { estadoCivilOptions, generoOptions, habilitacoesOptions, irsJovemOptions, parentescoOptions, regimeHorarioOptions, situacaoIrsOptions, tipoContratoOptions } from '../portal/data';
import { formatRoleLabel } from '../portal/labels';
import Badge from '../components/ui/Badge';
import DataTable from '../components/ui/DataTable';
import Button from '../components/ui/Button';
import Toast from '../components/ui/Toast';
import CollaboratorsFilterBar from '../components/collaborators/CollaboratorsFilterBar';
import CollaboratorsHeaderActions from '../components/collaborators/CollaboratorsHeaderActions';
import CollaboratorsPagination from '../components/collaborators/CollaboratorsPagination';
import CollaboratorTeamCell from '../components/collaborators/CollaboratorTeamCell';
import CollaboratorsRowActions from '../components/collaborators/CollaboratorsRowActions';
import CollaboratorExportModal from '../components/collaborators/CollaboratorExportModal';
import CollaboratorsImportModal from '../components/collaborators/CollaboratorsImportModal';
import CollaboratorCreateModal, { type CollaboratorCreateDraft } from '../components/collaborators/CollaboratorCreateModal';
import CollaboratorDetailsModal from '../components/collaborators/CollaboratorDetailsModal';
import CollaboratorProfileOptionModal from '../components/collaborators/CollaboratorProfileOptionModal';
import CollaboratorActiveConfirmModal from '../components/collaborators/CollaboratorActiveConfirmModal';
import CollaboratorCountryChangeModal from '../components/collaborators/CollaboratorCountryChangeModal';
import CollaboratorsActionsMenuPanel from '../components/collaborators/CollaboratorsActionsMenuPanel';
import AdmissionFormSettingsModal from '../components/collaborators/AdmissionFormSettingsModal';
import Modal from '../components/ui/Modal';

const PERMISSION_CATEGORIES = ['SYSTEM', 'USERS', 'TEAMS', 'VACATIONS', 'TRAININGS', 'PROFILE', 'NOTIFICATIONS'] as const;
type PermissionCategory = typeof PERMISSION_CATEGORIES[number];

const DYNAMIC_REGIME_PREFIX = 'DINAMICO::';

type DynamicRegimeDay = {
  key: string;
  label: string;
  enabled: boolean;
  start: string;
  end: string;
};

const defaultDynamicRegimeDays: DynamicRegimeDay[] = [
  { key: 'MON', label: 'Segunda', enabled: true, start: '09:00', end: '18:00' },
  { key: 'TUE', label: 'Terça', enabled: true, start: '09:00', end: '18:00' },
  { key: 'WED', label: 'Quarta', enabled: true, start: '09:00', end: '18:00' },
  { key: 'THU', label: 'Quinta', enabled: true, start: '09:00', end: '18:00' },
  { key: 'FRI', label: 'Sexta', enabled: true, start: '09:00', end: '18:00' },
  { key: 'SAT', label: 'Sábado', enabled: false, start: '09:00', end: '13:00' },
  { key: 'SUN', label: 'Domingo', enabled: false, start: '09:00', end: '13:00' },
];

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
    nomeCompleto?: string;
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
    localNascimentoPais?: string;
    localNascimentoCidade?: string;
    nomePai?: string;
    nomeMae?: string;
    cartaoCidadao?: string;
    validadeCartaoCidadao?: string;
    nif?: string;
    cpf?: string;
    pis?: string;
    ctps?: string;
    ctpsSerie?: string;
    ctpsDataExpedicao?: string;
    rg?: string;
    rgOrgaoEmissor?: string;
    rgDataExpedicao?: string;
    cnh?: string;
    cnhCategoria?: string;
    cnhDataValidade?: string;
    tituloEleitor?: string;
    zonaEleitoral?: string;
    secaoEleitoral?: string;
    certificadoReservista?: string;
    niss?: string;
    iban?: string;
    situacaoIrs?: string;
    numeroDependentes?: string;
    declaracaoIrs?: string;
    irsJovem?: string;
    anoPrimeiroDesconto?: string;
    primeiroEmprego?: boolean;
    recebeAposentadoria?: boolean;
    recebeSeguroDesemprego?: boolean;
    valeTransporte?: boolean;
    numeroCartaoContinente?: string;
    voucherNosData?: string;
    comprovativoMoradaFiscal?: string;
    comprovativoCartaoCidadao?: string;
    comprovativoIban?: string;
    comprovativoCartaoContinente?: string;
    contactoEmergenciaNome?: string;
    contactoEmergenciaParentesco?: string;
    contactoEmergenciaNumero?: string;
    categoriaProfissional?: string;
    numeroMecanografico?: string;
    dataInicioContrato?: string;
    dataFimContrato?: string;
    tipoContrato?: string;
    regimeHorario?: string;
    hourBankLimitHours?: number;
    workCountry?: 'PT' | 'BR';
    brWorkState?: 'SP' | 'RS';
    localidade?: string;
      photoUrl?: string;
      certificadoHabilitacoesUrl?: string;
      cartaConducaoUrl?: string;
      criminalRecordUrl?: string;
    } | null;
};

type CollaboratorEditDraft = {
  role: CollaboratorRow['role'];
  teamId: string;
  isActive: boolean;
  workCountry: 'PT' | 'BR';
  brWorkState: '' | 'SP' | 'RS';
  nomeCompleto: string;
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
  localNascimentoPais: string;
  localNascimentoCidade: string;
  nomePai: string;
  nomeMae: string;
  cartaoCidadao: string;
  validadeCartaoCidadao: string;
  nif: string;
  cpf: string;
  pis: string;
  ctps: string;
  ctpsSerie: string;
  ctpsDataExpedicao: string;
  rg: string;
  rgOrgaoEmissor: string;
  rgDataExpedicao: string;
  cnh: string;
  cnhCategoria: string;
  cnhDataValidade: string;
  tituloEleitor: string;
  zonaEleitoral: string;
  secaoEleitoral: string;
  certificadoReservista: string;
  niss: string;
  iban: string;
  situacaoIrs: string;
  numeroDependentes: string;
  declaracaoIrs: string;
  irsJovem: string;
  anoPrimeiroDesconto: string;
  primeiroEmprego: boolean;
  recebeAposentadoria: boolean;
  recebeSeguroDesemprego: boolean;
  valeTransporte: boolean;
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
  categoriaProfissional: string;
  numeroMecanografico: string;
  funcao: string;
  dataInicioContrato: string;
  dataFimContrato: string;
  tipoContrato: string;
  regimeHorario: string;
  horasSemanaisContrato: string;
    photoUrl: string;
    certificadoHabilitacoesUrl: string;
    cartaConducaoUrl: string;
    criminalRecordUrl: string;
  };

type EditSection = 'identificacao' | 'contactos' | 'fiscal' | 'emergencia' | 'contrato';
type DetailsFichaSection = 'conta' | EditSection;
type EditFieldConfig = { key: keyof CollaboratorEditDraft; label: string; section: EditSection };
type EditSectionMeta = {
  id: EditSection;
  title: string;
  description: string;
  sectionClassName?: string;
};

type AdmissionSettingsFieldOption = {
  key: string;
  label: string;
  defaultRequired: boolean;
};

type AdmissionFormSettingsResponse = {
  requiredFieldsByCountry: {
    PT: string[];
    BR: string[];
  };
  availableFieldsByCountry: {
    PT: AdmissionSettingsFieldOption[];
    BR: AdmissionSettingsFieldOption[];
  };
};

function resolveStatusTone(message: string): 'success' | 'error' | 'info' {
  const normalized = message.toLowerCase();
  if (normalized.includes('falha') || normalized.includes('erro') || normalized.includes('não foi possível')) {
    return 'error';
  }

  if (normalized.includes('sucesso') || normalized.includes('atualiz') || normalized.includes('adicion') || normalized.includes('removid') || normalized.includes('reativad') || normalized.includes('desativad')) {
    return 'success';
  }

  return 'info';
}

const COMMON_EDIT_PROFILE_FIELDS: EditFieldConfig[] = [
  { key: 'nomeCompleto', label: 'Nome completo', section: 'identificacao' },
  { key: 'nomeAbreviado', label: 'Nome abreviado', section: 'identificacao' },
  { key: 'dataNascimento', label: 'Data de nascimento', section: 'identificacao' },
  { key: 'genero', label: 'Género', section: 'identificacao' },
  { key: 'estadoCivil', label: 'Estado civil', section: 'identificacao' },
  { key: 'habilitacoesLiterarias', label: 'Habilitações literárias', section: 'identificacao' },
  { key: 'curso', label: 'Curso', section: 'identificacao' },
  { key: 'faculdade', label: 'Faculdade', section: 'identificacao' },
  { key: 'nacionalidade', label: 'Nacionalidade', section: 'identificacao' },
  { key: 'emailPessoal', label: 'Email pessoal', section: 'contactos' },
  { key: 'telemovel', label: 'Telemóvel / contacto telefónico', section: 'contactos' },
  { key: 'githubUser', label: 'GitHub', section: 'contactos' },
  { key: 'moradaFiscal', label: 'Morada fiscal', section: 'contactos' },
  { key: 'endereco', label: 'Morada habitual', section: 'contactos' },
  { key: 'localidade', label: 'Localidade', section: 'contactos' },
  { key: 'codigoPostal', label: 'Código postal', section: 'contactos' },
  { key: 'comprovativoMoradaFiscal', label: 'Comprovativo morada fiscal', section: 'fiscal' },
  { key: 'contactoEmergenciaNome', label: 'Nome contacto emergência', section: 'emergencia' },
  { key: 'contactoEmergenciaParentesco', label: 'Parentesco contacto emergência', section: 'emergencia' },
  { key: 'contactoEmergenciaNumero', label: 'Número contacto emergência', section: 'emergencia' },
  { key: 'numeroMecanografico', label: 'Número mecanográfico', section: 'contrato' },
    { key: 'photoUrl', label: 'Foto de utilizador', section: 'identificacao' },
    { key: 'cargo', label: 'Cargo', section: 'contrato' },
  { key: 'categoriaProfissional', label: 'Categoria profissional', section: 'contrato' },
  { key: 'funcao', label: 'Função', section: 'contrato' },
  { key: 'dataInicioContrato', label: 'Data início contrato', section: 'contrato' },
  { key: 'dataFimContrato', label: 'Data fim contrato', section: 'contrato' },
  { key: 'tipoContrato', label: 'Tipo contrato', section: 'contrato' },
  { key: 'regimeHorario', label: 'Regime contrato', section: 'contrato' },
];

const PT_EDIT_PROFILE_FIELDS: EditFieldConfig[] = [
  { key: 'matriculaCarro', label: 'Matrícula do carro', section: 'identificacao' },
    { key: 'certificadoHabilitacoesUrl', label: 'Certificado de habilitações', section: 'identificacao' },
    { key: 'cartaConducaoUrl', label: 'Carta de condução', section: 'identificacao' },
    { key: 'criminalRecordUrl', label: 'Registo criminal', section: 'identificacao' },
  { key: 'cartaoCidadao', label: 'Cartão de cidadão', section: 'fiscal' },
  { key: 'validadeCartaoCidadao', label: 'Validade cartão de cidadão', section: 'fiscal' },
  { key: 'comprovativoCartaoCidadao', label: 'Comprovativo cartão de cidadão', section: 'fiscal' },
  { key: 'nif', label: 'NIF', section: 'fiscal' },
  { key: 'niss', label: 'NISS', section: 'fiscal' },
  { key: 'iban', label: 'IBAN', section: 'fiscal' },
  { key: 'comprovativoIban', label: 'Comprovativo IBAN', section: 'fiscal' },
  { key: 'situacaoIrs', label: 'Situação IRS', section: 'fiscal' },
  { key: 'numeroDependentes', label: 'Número de dependentes', section: 'fiscal' },
  { key: 'declaracaoIrs', label: 'Declaração IRS', section: 'fiscal' },
  { key: 'irsJovem', label: 'IRS jovem', section: 'fiscal' },
  { key: 'anoPrimeiroDesconto', label: 'Ano do primeiro desconto', section: 'fiscal' },
  { key: 'numeroCartaoContinente', label: 'Cartão Continente', section: 'fiscal' },
  { key: 'voucherNosData', label: 'Voucher NOS data', section: 'fiscal' },
  { key: 'comprovativoCartaoContinente', label: 'Comprovativo cartão Continente', section: 'fiscal' },
];

const BR_EDIT_PROFILE_FIELDS: EditFieldConfig[] = [
  { key: 'brWorkState', label: 'Estado de trabalho (BR)', section: 'identificacao' },
  { key: 'localNascimentoPais', label: 'País de nascimento', section: 'identificacao' },
  { key: 'localNascimentoCidade', label: 'Cidade de nascimento', section: 'identificacao' },
  { key: 'nomePai', label: 'Nome do pai', section: 'identificacao' },
  { key: 'nomeMae', label: 'Nome da mãe', section: 'identificacao' },
  { key: 'rg', label: 'RG', section: 'fiscal' },
  { key: 'rgOrgaoEmissor', label: 'Órgão emissor (RG)', section: 'fiscal' },
  { key: 'rgDataExpedicao', label: 'Data expedição (RG)', section: 'fiscal' },
  { key: 'ctps', label: 'CTPS', section: 'fiscal' },
  { key: 'ctpsSerie', label: 'Série (CTPS)', section: 'fiscal' },
  { key: 'ctpsDataExpedicao', label: 'Data expedição (CTPS)', section: 'fiscal' },
  { key: 'cnh', label: 'CNH', section: 'fiscal' },
  { key: 'cnhCategoria', label: 'Categoria (CNH)', section: 'fiscal' },
  { key: 'cnhDataValidade', label: 'Validade (CNH)', section: 'fiscal' },
  { key: 'tituloEleitor', label: 'Título de eleitor', section: 'fiscal' },
  { key: 'zonaEleitoral', label: 'Zona eleitoral', section: 'fiscal' },
  { key: 'secaoEleitoral', label: 'Seção eleitoral', section: 'fiscal' },
  { key: 'certificadoReservista', label: 'Certificado de reservista', section: 'fiscal' },
  { key: 'comprovativoCartaoCidadao', label: 'Comprovativo documento de identificação', section: 'fiscal' },
  { key: 'cpf', label: 'CPF', section: 'fiscal' },
  { key: 'pis', label: 'PIS', section: 'fiscal' },
  { key: 'iban', label: 'IBAN', section: 'fiscal' },
  { key: 'comprovativoIban', label: 'Comprovativo IBAN', section: 'fiscal' },
  { key: 'primeiroEmprego', label: 'Primeiro emprego', section: 'fiscal' },
  { key: 'recebeAposentadoria', label: 'Recebe aposentadoria', section: 'fiscal' },
  { key: 'recebeSeguroDesemprego', label: 'Recebe seguro de desemprego', section: 'fiscal' },
  { key: 'valeTransporte', label: 'Vale transporte', section: 'fiscal' },
];

const EDIT_PROFILE_FIELDS: EditFieldConfig[] = [
  ...COMMON_EDIT_PROFILE_FIELDS,
  ...PT_EDIT_PROFILE_FIELDS,
  ...BR_EDIT_PROFILE_FIELDS,
];

const EDIT_SECTION_META: EditSectionMeta[] = [
  {
    id: 'identificacao',
    title: 'Identificação',
    description: 'Dados pessoais e académicos do colaborador.',
    sectionClassName: 'cm-section--wide',
  },
  {
    id: 'contactos',
    title: 'Contactos e moradas',
    description: 'Informação de contacto diário e moradas registadas.',
  },
  {
    id: 'fiscal',
    title: 'Fiscal e documentos',
    description: 'Documentação fiscal, bancária e comprovativos obrigatórios.',
    sectionClassName: 'cm-section--wide',
  },
  {
    id: 'emergencia',
    title: 'Emergência',
    description: 'Pessoa de contacto para situações urgentes.',
  },
  {
    id: 'contrato',
    title: 'Contrato',
    description: 'Enquadramento contratual, cargo, função e datas relevantes.',
    sectionClassName: 'cm-section--wide',
  },
];

const DETAILS_FICHA_SECTIONS: Array<{ id: DetailsFichaSection; label: string }> = [
  { id: 'conta', label: 'Conta' },
  { id: 'identificacao', label: 'Pessoal' },
  { id: 'contactos', label: 'Contacto' },
  { id: 'fiscal', label: 'Fiscal' },
  { id: 'emergencia', label: 'Emergência' },
  { id: 'contrato', label: 'Contrato' },
];

const REQUIRED_IDENTIFICACAO_FIELDS: Array<keyof CollaboratorEditDraft> = [
  'nomeCompleto',
  'nomeAbreviado',
  'dataNascimento',
  'genero',
  'estadoCivil',
  'habilitacoesLiterarias',
  'curso',
  'faculdade',
  'nacionalidade',
  'photoUrl',
  'certificadoHabilitacoesUrl',
  'cartaConducaoUrl',
  'criminalRecordUrl',
];

const REQUIRED_CONTACTOS_FIELDS: Array<keyof CollaboratorEditDraft> = [
  'emailPessoal',
  'telemovel',
  'moradaFiscal',
  'endereco',
  'localidade',
  'codigoPostal',
];

const REQUIRED_FISCAL_PT_FIELDS: Array<keyof CollaboratorEditDraft> = [
  'cartaoCidadao',
  'validadeCartaoCidadao',
  'comprovativoCartaoCidadao',
  'nif',
  'niss',
  'iban',
  'comprovativoIban',
  'situacaoIrs',
];

const REQUIRED_FISCAL_BR_FIELDS: Array<keyof CollaboratorEditDraft> = [
  'cpf',
  'pis',
  'rg',
  'rgOrgaoEmissor',
  'ctps',
  'ctpsSerie',
  'comprovativoCartaoCidadao',
  'comprovativoIban',
];

const REQUIRED_EMERGENCIA_FIELDS: Array<keyof CollaboratorEditDraft> = [
  'contactoEmergenciaNome',
  'contactoEmergenciaParentesco',
  'contactoEmergenciaNumero',
];

const REQUIRED_CONTRATO_FIELDS: Array<keyof CollaboratorEditDraft> = [
  'categoriaProfissional',
  'cargo',
  'numeroMecanografico',
  'funcao',
  'dataInicioContrato',
  'dataFimContrato',
  'tipoContrato',
  'regimeHorario',
];

function getEditSectionMeta(section: EditSection): EditSectionMeta {
  return EDIT_SECTION_META.find((item) => item.id === section) ?? {
    id: section,
    title: section,
    description: '',
  };
}

function isMissingTextValue(value: string | undefined) {
  return !value || value.trim().length === 0;
}

function getEditFieldCardClass(fieldKey: keyof CollaboratorEditDraft) {
  const wideFields = new Set<keyof CollaboratorEditDraft>([
    'moradaFiscal',
    'endereco',
    'comprovativoMoradaFiscal',
    'comprovativoCartaoCidadao',
    'comprovativoIban',
    'comprovativoCartaoContinente',
    'declaracaoIrs',
      'photoUrl',
      'certificadoHabilitacoesUrl',
      'cartaConducaoUrl',
      'criminalRecordUrl',
    ]);

  return `cm-field-card${wideFields.has(fieldKey) ? ' is-wide' : ''}`;
}

function getVisibleEditProfileFields(workCountry: 'PT' | 'BR') {
  return [
    ...COMMON_EDIT_PROFILE_FIELDS,
    ...(workCountry === 'BR' ? BR_EDIT_PROFILE_FIELDS : PT_EDIT_PROFILE_FIELDS),
  ];
}

const EMPTY_EDIT_DRAFT: CollaboratorEditDraft = {
  role: 'COLABORADOR',
  teamId: '',
  isActive: true,
  workCountry: 'PT',
  brWorkState: '',
  nomeCompleto: '',
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
  localNascimentoPais: '',
  localNascimentoCidade: '',
  nomePai: '',
  nomeMae: '',
  cartaoCidadao: '',
  validadeCartaoCidadao: '',
  nif: '',
  cpf: '',
  pis: '',
  ctps: '',
  ctpsSerie: '',
  ctpsDataExpedicao: '',
  rg: '',
  rgOrgaoEmissor: '',
  rgDataExpedicao: '',
  cnh: '',
  cnhCategoria: '',
  cnhDataValidade: '',
  tituloEleitor: '',
  zonaEleitoral: '',
  secaoEleitoral: '',
  certificadoReservista: '',
  niss: '',
  iban: '',
  situacaoIrs: '',
  numeroDependentes: '',
  declaracaoIrs: '',
  irsJovem: '',
  anoPrimeiroDesconto: '',
  primeiroEmprego: false,
  recebeAposentadoria: false,
  recebeSeguroDesemprego: false,
  valeTransporte: false,
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
  categoriaProfissional: '',
  numeroMecanografico: '',
  funcao: '',
  dataInicioContrato: '',
  dataFimContrato: '',
  tipoContrato: '',
    regimeHorario: '',
    horasSemanaisContrato: '',
    photoUrl: '',
    certificadoHabilitacoesUrl: '',
    cartaConducaoUrl: '',
    criminalRecordUrl: '',
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
    brWorkState: profile.brWorkState || '',
    nomeCompleto: profile.nomeCompleto || '',
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
    localNascimentoPais: profile.localNascimentoPais || '',
    localNascimentoCidade: profile.localNascimentoCidade || '',
    nomePai: profile.nomePai || '',
    nomeMae: profile.nomeMae || '',
    cartaoCidadao: profile.cartaoCidadao || '',
    validadeCartaoCidadao: profile.validadeCartaoCidadao || '',
    nif: profile.nif || '',
    cpf: profile.cpf || '',
    pis: profile.pis || '',
    ctps: profile.ctps || '',
    ctpsSerie: profile.ctpsSerie || '',
    ctpsDataExpedicao: profile.ctpsDataExpedicao || '',
    rg: profile.rg || '',
    rgOrgaoEmissor: profile.rgOrgaoEmissor || '',
    rgDataExpedicao: profile.rgDataExpedicao || '',
    cnh: profile.cnh || '',
    cnhCategoria: profile.cnhCategoria || '',
    cnhDataValidade: profile.cnhDataValidade || '',
    tituloEleitor: profile.tituloEleitor || '',
    zonaEleitoral: profile.zonaEleitoral || '',
    secaoEleitoral: profile.secaoEleitoral || '',
    certificadoReservista: profile.certificadoReservista || '',
    niss: profile.niss || '',
    iban: profile.iban || '',
    situacaoIrs: profile.situacaoIrs || '',
    numeroDependentes: profile.numeroDependentes || '',
    declaracaoIrs: profile.declaracaoIrs || '',
    irsJovem: profile.irsJovem || '',
    anoPrimeiroDesconto: profile.anoPrimeiroDesconto || '',
    primeiroEmprego: Boolean(profile.primeiroEmprego),
    recebeAposentadoria: Boolean(profile.recebeAposentadoria),
    recebeSeguroDesemprego: Boolean(profile.recebeSeguroDesemprego),
    valeTransporte: Boolean(profile.valeTransporte),
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
    categoriaProfissional: profile.categoriaProfissional || '',
    numeroMecanografico: profile.numeroMecanografico || '',
    funcao: profile.funcao || '',
    dataInicioContrato: profile.dataInicioContrato || '',
    dataFimContrato: profile.dataFimContrato || '',
    tipoContrato: profile.tipoContrato || '',
    regimeHorario: profile.regimeHorario || '',
    horasSemanaisContrato: Number.isFinite(profile.hourBankLimitHours)
      ? String(profile.hourBankLimitHours)
      : '',
      photoUrl: profile.photoUrl || '',
      certificadoHabilitacoesUrl: profile.certificadoHabilitacoesUrl || '',
      cartaConducaoUrl: profile.cartaConducaoUrl || '',
      criminalRecordUrl: profile.criminalRecordUrl || '',
    };
  }

function getCollaboratorTeamInfo(item: CollaboratorRow) {
  const resolvedTeam = getCollaboratorTeams(item)[0] ?? null;

  if (!resolvedTeam) {
    return { name: '-', isLeader: false };
  }

  return { name: resolvedTeam.name, isLeader: resolvedTeam.isLeader };
}

function getCollaboratorPrimaryTeam(item: CollaboratorRow) {
  return getCollaboratorTeams(item)[0] ?? null;
}

function getCollaboratorTeams(item: CollaboratorRow) {
  const teamMap = new Map<string, { id: string; name: string; isLeader: boolean; isPrimary: boolean }>();
  const managedTeamIds = new Set((item.managedTeams || []).map((team) => team.id));

  const upsertTeam = (team: { id: string; name: string }, options?: { isLeader?: boolean; isPrimary?: boolean }) => {
    const existing = teamMap.get(team.id);
    if (!existing) {
      teamMap.set(team.id, {
        id: team.id,
        name: team.name,
        isLeader: Boolean(options?.isLeader),
        isPrimary: Boolean(options?.isPrimary),
      });
      return;
    }

    teamMap.set(team.id, {
      ...existing,
      isLeader: existing.isLeader || Boolean(options?.isLeader),
      isPrimary: existing.isPrimary || Boolean(options?.isPrimary),
    });
  };

  if (item.team?.id && item.team.name) {
    upsertTeam(item.team, {
      isPrimary: true,
      isLeader: item.teamRole === 'LEADER' || managedTeamIds.has(item.team.id),
    });
  }

  for (const membership of item.teamMemberships || []) {
    if (!membership.team?.id || !membership.team.name) {
      continue;
    }

    upsertTeam(membership.team, {
      isPrimary: item.teamId === membership.team.id,
      isLeader: managedTeamIds.has(membership.team.id),
    });
  }

  for (const managedTeam of item.managedTeams || []) {
    upsertTeam(managedTeam, {
      isPrimary: item.teamId === managedTeam.id,
      isLeader: true,
    });
  }

  return Array.from(teamMap.values()).sort((a, b) => {
    if (a.isPrimary !== b.isPrimary) {
      return a.isPrimary ? -1 : 1;
    }
    if (a.isLeader !== b.isLeader) {
      return a.isLeader ? -1 : 1;
    }
    return a.name.localeCompare(b.name, 'pt-PT');
  });
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
    nomeCompleto?: string;
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
      nomeCompleto?: string;
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
  profileHistory: ProfileHistoryEntry[];
};

type TeamOption = {
  id: string;
  name: string;
};

type CollaboratorImportProfile = Partial<Record<Exclude<keyof CollaboratorEditDraft, 'role' | 'teamId' | 'isActive' | 'workCountry' | 'nomeCompleto' | 'primeiroEmprego' | 'recebeAposentadoria' | 'recebeSeguroDesemprego' | 'valeTransporte'>, string>>;

type CollaboratorImportRow = {
  rowNumber: number;
  fullName: string;
  username: string;
  email: string;
  workCountry: 'PT' | 'BR';
  teamName: string;
  subTeamName: string;
  profile: CollaboratorImportProfile;
};

type CollaboratorImportIssue = {
  rowNumber: number;
  message: string;
};

type CollaboratorImportResultItem = {
  rowNumber: number;
  fullName: string;
  username: string;
  email: string;
  status: 'CREATED' | 'FAILED';
  message: string;
};

type CollaboratorImportResponse = {
  createdCount: number;
  failedCount: number;
  results: CollaboratorImportResultItem[];
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

type ProfileHistoryEntry = {
  id: string;
  userId: string;
  changesSummary?: string;
  reviewedAt?: string | null;
  requestedData?: Record<string, unknown>;
  reviewedBy?: {
    username?: string;
    profile?: {
      nomeAbreviado?: string;
      nomeCompleto?: string;
    } | null;
  } | null;
};

const EMPTY_PERMISSION_DRAFT: PermissionDraft = {
  enabled: false,
  restrictedToTeams: '',
  restrictedToCountries: '',
  restrictedToLevels: '',
  customRestrictions: '',
  notes: '',
};

const IMPORT_PROFILE_FIELD_KEYS = EDIT_PROFILE_FIELDS
  .filter((field) => field.key !== 'nomeCompleto'
    && field.key !== 'primeiroEmprego'
    && field.key !== 'recebeAposentadoria'
    && field.key !== 'recebeSeguroDesemprego'
    && field.key !== 'valeTransporte'
    && field.key !== 'comprovativoMoradaFiscal'
    && field.key !== 'comprovativoCartaoCidadao'
    && field.key !== 'comprovativoIban'
    && field.key !== 'declaracaoIrs'
      && field.key !== 'comprovativoCartaoContinente'
      && field.key !== 'photoUrl'
      && field.key !== 'certificadoHabilitacoesUrl'
      && field.key !== 'cartaConducaoUrl'
      && field.key !== 'criminalRecordUrl')
  .map((field) => field.key) as Array<Exclude<keyof CollaboratorEditDraft, 'role' | 'teamId' | 'isActive' | 'workCountry' | 'nomeCompleto' | 'primeiroEmprego' | 'recebeAposentadoria' | 'recebeSeguroDesemprego' | 'valeTransporte'>>;

const IMPORT_FILE_ACCEPT = '.xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel';

const IMPORT_TEMPLATE_FIELDS: Array<{ key: string; label: string; required?: boolean; example: string; aliases?: string[]; dropdownKey?: string }> = [
  { key: 'fullName', label: 'Nome completo', required: true, example: '', aliases: ['nomecompleto', 'fullname', 'nome'] },
  { key: 'username', label: 'Username', required: true, example: '', aliases: ['utilizador'] },
  { key: 'email', label: 'Email', required: true, example: '', aliases: ['emaillogin'] },
  { key: 'workCountry', label: 'País de trabalho', example: '', aliases: ['paisdetrabalho', 'workcountry', 'pais'], dropdownKey: 'workCountry' },
  { key: 'teamName', label: 'Equipa principal', example: '', aliases: ['equipa', 'team', 'teamname'], dropdownKey: 'teamName' },
  { key: 'subTeamName', label: 'Subequipa', example: '', aliases: ['subequipa', 'subteam', 'subteamname'], dropdownKey: 'subTeamName' },
  ...EDIT_PROFILE_FIELDS
    .filter((field) => field.key !== 'nomeCompleto'
      && field.key !== 'comprovativoMoradaFiscal'
      && field.key !== 'comprovativoCartaoCidadao'
      && field.key !== 'comprovativoIban'
      && field.key !== 'declaracaoIrs'
        && field.key !== 'comprovativoCartaoContinente'
        && field.key !== 'photoUrl'
        && field.key !== 'certificadoHabilitacoesUrl'
        && field.key !== 'cartaConducaoUrl'
        && field.key !== 'criminalRecordUrl')
    .map((field) => ({
      key: field.key,
      label: field.label,
      example: '',
      aliases: [field.key],
      dropdownKey:
        field.key === 'genero' ? 'genero'
        : field.key === 'estadoCivil' ? 'estadoCivil'
        : field.key === 'habilitacoesLiterarias' ? 'habilitacoesLiterarias'
        : field.key === 'situacaoIrs' ? 'situacaoIrs'
        : field.key === 'irsJovem' ? 'irsJovem'
        : field.key === 'contactoEmergenciaParentesco' ? 'contactoEmergenciaParentesco'
        : field.key === 'tipoContrato' ? 'tipoContrato'
        : field.key === 'regimeHorario' ? 'regimeHorario'
        : field.key === 'cargo' ? 'cargo'
        : field.key === 'funcao' ? 'funcao'
        : undefined,
    })),
];

const IMPORT_FIELD_TARGETS = new Map<string, string>(
  IMPORT_TEMPLATE_FIELDS.flatMap((field) => {
    const candidates = [field.label, field.key, ...(field.aliases ?? [])];
    return candidates.map((candidate) => [normalizeImportHeader(candidate), field.key] as const);
  }),
);

function getAuthHeaders() {
  const token = getStoredAuthToken();
  return authHeaders(token);
}

function normalizeImportHeader(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function normalizeImportText(value: string) {
  return value.replace(/^\uFEFF/, '').trim();
}

function toExcelColumnLetter(columnNumber: number) {
  let current = columnNumber;
  let result = '';
  while (current > 0) {
    const modulo = (current - 1) % 26;
    result = String.fromCharCode(65 + modulo) + result;
    current = Math.floor((current - modulo) / 26);
  }
  return result;
}

function toExcelDefinedName(value: string) {
  const normalized = value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');

  const fallback = normalized || 'TEAM';
  return `SUBTEAM_${fallback}`;
}

let excelJsModulePromise: Promise<any> | null = null;

async function loadExcelJsWorkbook() {
  if (!excelJsModulePromise) {
    excelJsModulePromise = (async () => {
      try {
        const browserEntry = 'exceljs/dist/exceljs.min.js';
        const browserModule = await import(/* @vite-ignore */ browserEntry);
        return browserModule.default ?? browserModule;
      } catch {
        const defaultModule = await import('exceljs');
        return defaultModule.default ?? defaultModule;
      }
    })();
  }

  return excelJsModulePromise;
}

function readSpreadsheetCellValue(value: unknown): string {
  if (value == null) {
    return '';
  }

  if (typeof value === 'string') {
    return value.trim();
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value).trim();
  }

  if (value instanceof Date) {
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
  }

  if (typeof value === 'object') {
    const cell = value as {
      text?: string;
      result?: unknown;
      richText?: Array<{ text?: string }>;
      hyperlink?: string;
    };

    if (typeof cell.text === 'string') {
      return cell.text.trim();
    }
    if (Array.isArray(cell.richText)) {
      return cell.richText.map((item) => item.text ?? '').join('').trim();
    }
    if (cell.result != null) {
      return readSpreadsheetCellValue(cell.result);
    }
    if (typeof cell.hyperlink === 'string') {
      return cell.hyperlink.trim();
    }
  }

  return String(value).trim();
}

function parseDelimitedLine(line: string, delimiter: string) {
  const values: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === delimiter && !inQuotes) {
      values.push(current);
      current = '';
      continue;
    }

    current += char;
  }

  values.push(current);
  return values.map((item) => normalizeImportText(item));
}

function parseDelimitedText(text: string) {
  const normalizedText = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = normalizedText.split('\n').filter((line) => line.trim().length > 0);
  if (lines.length === 0) {
    return [] as string[][];
  }

  const firstLine = lines[0];
  const semicolonCount = (firstLine.match(/;/g) ?? []).length;
  const commaCount = (firstLine.match(/,/g) ?? []).length;
  const delimiter = semicolonCount > commaCount ? ';' : ',';

  return lines.map((line) => parseDelimitedLine(line, delimiter));
}

function createEmptyImportRow(rowNumber: number): CollaboratorImportRow {
  return {
    rowNumber,
    fullName: '',
    username: '',
    email: '',
    workCountry: 'PT',
    teamName: '',
    subTeamName: '',
    profile: {},
  };
}

function assignImportField(row: CollaboratorImportRow, targetKey: string, value: string) {
  if (!value) {
    return;
  }

  switch (targetKey) {
    case 'fullName':
      row.fullName = value.replace(/\s+/g, ' ').trim();
      return;
    case 'username':
      row.username = value.trim().toLowerCase();
      return;
    case 'email':
      row.email = value.trim().toLowerCase();
      return;
    case 'workCountry':
      row.workCountry = value.trim().toUpperCase() === 'BR' ? 'BR' : 'PT';
      return;
    case 'teamName':
      row.teamName = value.trim();
      return;
    case 'subTeamName':
      row.subTeamName = value.trim();
      return;
    default:
      if (IMPORT_PROFILE_FIELD_KEYS.includes(targetKey as Exclude<keyof CollaboratorEditDraft, 'role' | 'teamId' | 'isActive' | 'workCountry' | 'nomeCompleto' | 'primeiroEmprego' | 'recebeAposentadoria' | 'recebeSeguroDesemprego' | 'valeTransporte'>)) {
        row.profile[targetKey as keyof CollaboratorImportProfile] = value.trim();
      }
  }
}

function validateImportRows(rows: CollaboratorImportRow[]) {
  const issues: CollaboratorImportIssue[] = [];
  const usernameCounts = new Map<string, number>();
  const emailCounts = new Map<string, number>();

  const onlyDigits = (value: string) => value.replace(/\D/g, '');

  const isValidIsoDate = (value: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return false;
    }
    const [yearRaw, monthRaw, dayRaw] = value.split('-');
    const year = Number(yearRaw);
    const month = Number(monthRaw);
    const day = Number(dayRaw);
    if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
      return false;
    }
    if (month < 1 || month > 12 || day < 1 || day > 31) {
      return false;
    }
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year && date.getUTCMonth() + 1 === month && date.getUTCDate() === day;
  };

  const isValidNif = (value: string) => {
    const digits = onlyDigits(value);
    if (!/^\d{9}$/.test(digits)) {
      return false;
    }

    const firstDigit = Number(digits[0]);
    if (![1, 2, 3, 5, 6, 8, 9].includes(firstDigit)) {
      return false;
    }

    let total = 0;
    for (let index = 0; index < 8; index += 1) {
      total += Number(digits[index]) * (9 - index);
    }
    const modulo = total % 11;
    const checkDigit = modulo < 2 ? 0 : 11 - modulo;
    return checkDigit === Number(digits[8]);
  };

  const isValidNiss = (value: string) => {
    const digits = onlyDigits(value);
    return /^\d{11}$/.test(digits);
  };

  const normalizeIban = (value: string) => value.replace(/\s+/g, '').toUpperCase();

  const isValidIban = (value: string) => {
    const iban = normalizeIban(value);
    if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)) {
      return false;
    }

    const rearranged = `${iban.slice(4)}${iban.slice(0, 4)}`;
    let remainder = 0;

    for (const char of rearranged) {
      const expanded = /[A-Z]/.test(char) ? String(char.charCodeAt(0) - 55) : char;
      for (const digit of expanded) {
        remainder = (remainder * 10 + Number(digit)) % 97;
      }
    }

    return remainder === 1;
  };

  const isValidPhone = (value: string) => {
    const compact = value.replace(/[\s().-]/g, '');
    if (!/^\+?\d+$/.test(compact)) {
      return false;
    }
    const digits = compact.replace(/^\+/, '');
    return digits.length >= 9 && digits.length <= 15;
  };

  const isNonNegativeInteger = (value: string) => /^\d+$/.test(value);

  const isReasonableYear = (value: string) => {
    if (!/^\d{4}$/.test(value)) {
      return false;
    }
    const year = Number(value);
    const currentYear = new Date().getFullYear();
    return year >= 1900 && year <= currentYear + 1;
  };

  for (const row of rows) {
    if (row.username) {
      usernameCounts.set(row.username, (usernameCounts.get(row.username) ?? 0) + 1);
    }
    if (row.email) {
      emailCounts.set(row.email, (emailCounts.get(row.email) ?? 0) + 1);
    }
  }

  for (const row of rows) {
    if (!row.fullName) {
      issues.push({ rowNumber: row.rowNumber, message: 'Nome completo em falta.' });
    }
    if (!row.username) {
      issues.push({ rowNumber: row.rowNumber, message: 'Username em falta.' });
    }
    if (!row.email) {
      issues.push({ rowNumber: row.rowNumber, message: 'Email em falta.' });
    }
    if (row.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email)) {
      issues.push({ rowNumber: row.rowNumber, message: 'Email inválido.' });
    }
    if ((usernameCounts.get(row.username) ?? 0) > 1) {
      issues.push({ rowNumber: row.rowNumber, message: 'Username duplicado no ficheiro.' });
    }
    if ((emailCounts.get(row.email) ?? 0) > 1) {
      issues.push({ rowNumber: row.rowNumber, message: 'Email duplicado no ficheiro.' });
    }

    const profile = row.profile;

    if (profile.nif && !isValidNif(profile.nif)) {
      issues.push({ rowNumber: row.rowNumber, message: 'NIF inválido. Deve conter 9 dígitos válidos.' });
    }

    if (profile.niss && !isValidNiss(profile.niss)) {
      issues.push({ rowNumber: row.rowNumber, message: 'NISS inválido. Deve conter 11 dígitos.' });
    }

    if (profile.iban && !isValidIban(profile.iban)) {
      issues.push({ rowNumber: row.rowNumber, message: 'IBAN inválido.' });
    }

    if (profile.emailPessoal && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(profile.emailPessoal)) {
      issues.push({ rowNumber: row.rowNumber, message: 'Email pessoal inválido.' });
    }

    if (profile.contactoEmergenciaNumero && !isValidPhone(profile.contactoEmergenciaNumero)) {
      issues.push({ rowNumber: row.rowNumber, message: 'Contacto de emergência inválido.' });
    }

    if (profile.numeroDependentes && !isNonNegativeInteger(profile.numeroDependentes)) {
      issues.push({ rowNumber: row.rowNumber, message: 'Número de dependentes inválido. Usa apenas dígitos.' });
    }

    if (profile.anoPrimeiroDesconto && !isReasonableYear(profile.anoPrimeiroDesconto)) {
      issues.push({ rowNumber: row.rowNumber, message: 'Ano primeiro desconto inválido. Usa formato AAAA.' });
    }

    const dateFields: Array<[keyof CollaboratorImportProfile, string]> = [
      ['dataNascimento', 'Data de nascimento'],
      ['validadeCartaoCidadao', 'Validade do cartão de cidadão'],
      ['voucherNosData', 'Data voucher NOS'],
      ['dataInicioContrato', 'Data início contrato'],
      ['dataFimContrato', 'Data fim contrato'],
    ];

    for (const [key, label] of dateFields) {
      const rawValue = profile[key];
      if (!rawValue) {
        continue;
      }
      if (!isValidIsoDate(rawValue)) {
        issues.push({ rowNumber: row.rowNumber, message: `${label} inválida. Usa formato YYYY-MM-DD.` });
      }
    }

    if (profile.dataInicioContrato && profile.dataFimContrato
      && isValidIsoDate(profile.dataInicioContrato)
      && isValidIsoDate(profile.dataFimContrato)
      && profile.dataFimContrato < profile.dataInicioContrato) {
      issues.push({ rowNumber: row.rowNumber, message: 'Data fim contrato não pode ser anterior à data início contrato.' });
    }
  }

  if (rows.length > 200) {
    issues.push({ rowNumber: 1, message: 'Máximo suportado por importação: 200 linhas.' });
  }

  return issues;
}

function buildImportRowsFromMatrix(matrix: string[][]) {
  if (matrix.length === 0) {
    return { rows: [] as CollaboratorImportRow[], issues: [{ rowNumber: 1, message: 'O ficheiro está vazio.' }] as CollaboratorImportIssue[] };
  }

  const findHeaderRowIndex = () => {
    for (let index = 0; index < matrix.length; index += 1) {
      const recognized = matrix[index]
        .map((header) => IMPORT_FIELD_TARGETS.get(normalizeImportHeader(header)) ?? '')
        .filter(Boolean).length;
      if (recognized >= 3) {
        return index;
      }
    }
    return -1;
  };

  const headerRowIndex = findHeaderRowIndex();
  if (headerRowIndex < 0) {
    return {
      rows: [] as CollaboratorImportRow[],
      issues: [{ rowNumber: 1, message: 'Não foi possível identificar a linha de cabeçalhos no ficheiro.' }] as CollaboratorImportIssue[],
    };
  }

  const headerTargets = matrix[headerRowIndex].map((header) => IMPORT_FIELD_TARGETS.get(normalizeImportHeader(header)) ?? '');
  const rows = matrix
    .slice(headerRowIndex + 1)
    .map((cells, index) => {
      const row = createEmptyImportRow(headerRowIndex + index + 2);
      cells.forEach((cell, columnIndex) => {
        const targetKey = headerTargets[columnIndex];
        if (!targetKey) {
          return;
        }
        assignImportField(row, targetKey, normalizeImportText(cell));
      });
      return row;
    })
    .filter((row) => Boolean(row.fullName || row.username || row.email || row.teamName || row.subTeamName || Object.values(row.profile).some(Boolean)));

  const issues = validateImportRows(rows);
  return { rows, issues };
}


function normalizeUsernamePart(value: string) {
  return value
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .trim();
}

function buildAutoUsername(firstName: string, lastName: string) {
  const first = normalizeUsernamePart(firstName);
  const last = normalizeUsernamePart(lastName);
  if (!first && !last) return '';
  if (!first) return last;
  if (!last) return first;
  return `${first}.${last}`;
}

function buildAutoEmailFromName(firstName: string, lastName: string) {
  const username = buildAutoUsername(firstName, lastName);
  if (!username) return '';
  return `${username}@tlantic.com`;
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

  if (trimmed.startsWith('/api/uploads/')) {
    return `${getBackendBase()}${trimmed.replace(/^\/api/, '')}`;
  }

  if (trimmed.startsWith('uploads/')) {
    return `${getBackendBase()}/${trimmed}`;
  }

  if (trimmed.startsWith('api/uploads/')) {
    return `${getBackendBase()}/${trimmed.replace(/^api\//, '')}`;
  }

  return `${getBackendBase()}/uploads/${trimmed.replace(/^\/+/, '')}`;
}

function getDisplayName(item: CollaboratorRow) {
  const shortName = item.profile?.nomeAbreviado?.trim();
  if (shortName) {
    return shortName;
  }

  const fullName = item?.profile?.nomeCompleto ?? '';
  return fullName || item.username;
}

function getGrantDisplayName(user?: PermissionGrantUser | null) {
  const shortName = user?.profile?.nomeAbreviado?.trim();
  if (shortName) {
    return shortName;
  }

  const fullName = user?.profile?.nomeCompleto ?? '';
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

function formatDateForExport(value?: string | null) {
  if (!value) {
    return '-';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat('pt-PT', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date);
}

function sanitizeFileName(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase() || 'colaborador';
}

function formatDateForTemplate(value?: string | null) {
  if (!value) {
    return '';
  }

  const formatted = formatDateForExport(value);
  return formatted === '-' ? '' : formatted;
}

function formatTemplateValue(value?: string | null) {
  return value?.trim() || '';
}

function parseDynamicRegimeDays(value: string): DynamicRegimeDay[] {
  if (!value.startsWith(DYNAMIC_REGIME_PREFIX)) {
    return defaultDynamicRegimeDays.map((item) => ({ ...item }));
  }

  const rawPayload = value.slice(DYNAMIC_REGIME_PREFIX.length);
  try {
    const parsed = JSON.parse(rawPayload) as Array<Partial<DynamicRegimeDay>>;
    const byKey = new Map(parsed.map((item) => [String(item.key || ''), item]));

    return defaultDynamicRegimeDays.map((item) => {
      const source = byKey.get(item.key);
      if (!source) {
        return { ...item };
      }

      const start = typeof source.start === 'string' && /^\d{2}:\d{2}$/.test(source.start) ? source.start : item.start;
      const end = typeof source.end === 'string' && /^\d{2}:\d{2}$/.test(source.end) ? source.end : item.end;

      return {
        ...item,
        enabled: source.enabled === true,
        start,
        end,
      };
    });
  } catch {
    return defaultDynamicRegimeDays.map((item) => ({ ...item }));
  }
}

function serializeDynamicRegimeDays(days: DynamicRegimeDay[]) {
  const compact = days.map(({ key, label, enabled, start, end }) => ({ key, label, enabled, start, end }));
  return `${DYNAMIC_REGIME_PREFIX}${JSON.stringify(compact)}`;
}

function parseTimeToMinutes(value: string) {
  const match = /^(\d{2}):(\d{2})$/.exec(value.trim());
  if (!match) {
    return null;
  }

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    return null;
  }

  return (hours * 60) + minutes;
}

function calculateWeeklyHoursFromDays(days: DynamicRegimeDay[]) {
  let totalMinutes = 0;

  for (const day of days) {
    if (!day.enabled) {
      continue;
    }

    const start = parseTimeToMinutes(day.start);
    const end = parseTimeToMinutes(day.end);
    if (start == null || end == null || end <= start) {
      return null;
    }

    const lunchDeduction = start < 13 * 60 && end > 14 * 60 ? 60 : 0;
    totalMinutes += (end - start - lunchDeduction);
  }

  if (totalMinutes <= 0) {
    return null;
  }

  return Math.round((totalMinutes / 60) * 100) / 100;
}

function formatWeeklyHoursLabel(value: number) {
  return `${new Intl.NumberFormat('pt-PT', { maximumFractionDigits: 2 }).format(value)} h por semana`;
}

function summarizeDynamicRegime(value: string) {
  if (!value.startsWith(DYNAMIC_REGIME_PREFIX)) {
    return '';
  }

  const days = parseDynamicRegimeDays(value);
  const weeklyHours = calculateWeeklyHoursFromDays(days);
  const activeDays = days.filter((item) => item.enabled);
  if (activeDays.length === 0) {
    return 'Sem dias ativos';
  }

  const weeklyHoursLabel = weeklyHours == null ? 'horário inválido' : formatWeeklyHoursLabel(weeklyHours);
  return `${weeklyHoursLabel} • ${activeDays.length} dia(s): ${activeDays.map((item) => `${item.label} ${item.start}-${item.end}`).join(', ')}`;
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
  const [activeFilter, setActiveFilter] = useState<'ALL' | 'ACTIVE' | 'INACTIVE'>('ACTIVE');
  const [countryFilter, setCountryFilter] = useState<'ALL' | 'PT' | 'BR'>('ALL');
  const [sortBy, setSortBy] = useState<'createdAt' | 'updatedAt' | 'username' | 'email'>('updatedAt');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('');
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [isLoadingExportCandidates, setIsLoadingExportCandidates] = useState(false);
  const [isExportingWorkbook, setIsExportingWorkbook] = useState(false);
  const [exportCandidates, setExportCandidates] = useState<CollaboratorRow[]>([]);
  const [exportSearch, setExportSearch] = useState('');
  const [selectedExportUserId, setSelectedExportUserId] = useState('');
  const [busyUserId, setBusyUserId] = useState<string | null>(null);
  const [actionsMenuState, setActionsMenuState] = useState<{ id: string; top: number; right: number; item: CollaboratorRow } | null>(null);
  const [activeConfirmTarget, setActiveConfirmTarget] = useState<CollaboratorRow | null>(null);
  const [selectedRow, setSelectedRow] = useState<CollaboratorRow | null>(null);
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const [detailsTab, setDetailsTab] = useState<'ficha' | 'permissoes' | 'estado'>('ficha');
  const [detailsFichaSection, setDetailsFichaSection] = useState<DetailsFichaSection>('conta');
  const [permissionCategory, setPermissionCategory] = useState<PermissionCategory>('USERS');
  const [isLoadingDetails, setIsLoadingDetails] = useState(false);
  const [selectedUserAccessTotal, setSelectedUserAccessTotal] = useState(false);
  const [selectedPermissions, setSelectedPermissions] = useState<PermissionItem[]>([]);
  const [profileHistory, setProfileHistory] = useState<ProfileHistoryEntry[]>([]);
  const [permissionDrafts, setPermissionDrafts] = useState<Record<string, PermissionDraft>>({});
  const [savingPermissionId, setSavingPermissionId] = useState<string | null>(null);
  const [isTogglingAccessTotal, setIsTogglingAccessTotal] = useState(false);
  const [selectedPermissionId, setSelectedPermissionId] = useState<string | null>(null);
  const [permissionSearch, setPermissionSearch] = useState('');
  const [permissionTeams, setPermissionTeams] = useState<TeamOption[]>([]);
  const [pendingTeamToAdd, setPendingTeamToAdd] = useState('');
  const [editDraft, setEditDraft] = useState<CollaboratorEditDraft>(EMPTY_EDIT_DRAFT);
  const [isWorkHoursModalOpen, setIsWorkHoursModalOpen] = useState(false);
  const [workHoursDraft, setWorkHoursDraft] = useState<DynamicRegimeDay[]>(() => defaultDynamicRegimeDays.map((item) => ({ ...item })));
  const [isSavingEditDraft, setIsSavingEditDraft] = useState(false);
  const [isCountryChangeModalOpen, setIsCountryChangeModalOpen] = useState(false);
  const [pendingCountryChange, setPendingCountryChange] = useState<{ from: 'PT' | 'BR'; to: 'PT' | 'BR' } | null>(null);
  const [customCargoOptions, setCustomCargoOptions] = useState<CustomProfileOption[]>([]);
  const [customFuncaoOptions, setCustomFuncaoOptions] = useState<CustomProfileOption[]>([]);
  const [isProfileOptionModalOpen, setIsProfileOptionModalOpen] = useState(false);
  const [profileOptionType, setProfileOptionType] = useState<'CARGO' | 'FUNCAO'>('CARGO');
  const [profileOptionLabel, setProfileOptionLabel] = useState('');
  const [profileOptionGroup, setProfileOptionGroup] = useState('');
  const [isSavingProfileOption, setIsSavingProfileOption] = useState(false);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isCreatingUser, setIsCreatingUser] = useState(false);
  const [newUserDraft, setNewUserDraft] = useState<CollaboratorCreateDraft>({ fullName: '', personalEmail: '', workCountry: 'PT', brWorkState: '' });
  const [admissionSettings, setAdmissionSettings] = useState<AdmissionFormSettingsResponse | null>(null);
  const [settingsCountry, setSettingsCountry] = useState<'PT' | 'BR'>('PT');
  const [settingsDraftRequiredFields, setSettingsDraftRequiredFields] = useState<string[]>([]);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [isSettingsLoading, setIsSettingsLoading] = useState(false);
  const [isSettingsSaving, setIsSettingsSaving] = useState(false);
  const [settingsStatus, setSettingsStatus] = useState('');
  const [isSaveAdmissionSettingsConfirmationOpen, setIsSaveAdmissionSettingsConfirmationOpen] = useState(false);
  const [isSettingsFlowFromCreateModal, setIsSettingsFlowFromCreateModal] = useState(false);
  const [selectedCollaboratorPhotoUrl, setSelectedCollaboratorPhotoUrl] = useState('');

  const admissionSettingsPresetFieldKeys: Record<'PT' | 'BR', string[]> = {
    PT: ['iban', 'numeroCartaoContinente', 'comprovativoIban', 'comprovativoCartaoContinente'],
    BR: ['comprovativoIban'],
  };

  const hasAdmissionSettingsChanges = useMemo(() => {
    if (!admissionSettings) {
      return false;
    }

    const currentRequired = admissionSettings.requiredFieldsByCountry[settingsCountry];
    if (currentRequired.length !== settingsDraftRequiredFields.length) {
      return true;
    }

    return currentRequired.some((fieldKey) => !settingsDraftRequiredFields.includes(fieldKey));
  }, [admissionSettings, settingsCountry, settingsDraftRequiredFields]);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [isParsingImportFile, setIsParsingImportFile] = useState(false);
  const [isImportingUsers, setIsImportingUsers] = useState(false);
  const [importFileName, setImportFileName] = useState('');
  const [importRows, setImportRows] = useState<CollaboratorImportRow[]>([]);
  const [importIssues, setImportIssues] = useState<CollaboratorImportIssue[]>([]);
  const [importResults, setImportResults] = useState<CollaboratorImportResultItem[]>([]);
  const [credentialsDraft, setCredentialsDraft] = useState({ username: '', email: '' });
  const [isSavingCredentials, setIsSavingCredentials] = useState(false);
  const canManageProfileOptions = isRootAccess || isAccessTotal || hasPermission('manage_profile_dropdown_options');
  const canEditCredentials = Boolean(currentUser?.isRootAccess) || currentUser?.username === 't.people';
  const canCreateUser = Boolean(isAccessTotal);
  const collaboratorQueryInputRef = useRef<HTMLInputElement | null>(null);
  const collaboratorQueryRef = useRef(query);
  const detailsLoadControllerRef = useRef<AbortController | null>(null);
  const [detailsCacheByUserId, setDetailsCacheByUserId] = useState<Record<string, CollaboratorDetailsCacheEntry>>({});

  useEffect(() => {
    collaboratorQueryRef.current = query;
  }, [query]);

  useEffect(() => {
    if (!editDraft.regimeHorario.startsWith(DYNAMIC_REGIME_PREFIX)) {
      return;
    }

    if (editDraft.horasSemanaisContrato.trim()) {
      return;
    }

    const calculated = calculateWeeklyHoursFromDays(parseDynamicRegimeDays(editDraft.regimeHorario));
    if (calculated == null) {
      return;
    }

    setEditDraft((current) => ({
      ...current,
      horasSemanaisContrato: String(calculated),
    }));
  }, [editDraft.horasSemanaisContrato, editDraft.regimeHorario]);

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
  const isDynamicRegime = editDraft.regimeHorario.startsWith(DYNAMIC_REGIME_PREFIX);
  const dynamicRegimeSummary = useMemo(() => summarizeDynamicRegime(editDraft.regimeHorario), [editDraft.regimeHorario]);
  const regimeContractValue = useMemo(() => {
    const direct = Number(editDraft.horasSemanaisContrato.replace(',', '.'));
    if (Number.isFinite(direct) && direct > 0) {
      return formatWeeklyHoursLabel(direct);
    }

    if (isDynamicRegime) {
      const calculated = calculateWeeklyHoursFromDays(parseDynamicRegimeDays(editDraft.regimeHorario));
      if (calculated != null) {
        return formatWeeklyHoursLabel(calculated);
      }
    }

    return '';
  }, [editDraft.horasSemanaisContrato, editDraft.regimeHorario, isDynamicRegime]);
  const workHoursDraftTotal = useMemo(() => calculateWeeklyHoursFromDays(workHoursDraft), [workHoursDraft]);

  const totalPages = useMemo(() => Math.max(1, Math.ceil(total / pageSize)), [total, pageSize]);
  const visibleRows = useMemo(
    () => rows.filter((item) => item.id !== currentUser?.id),
    [rows, currentUser?.id],
  );
  const visibleTotal = Math.max(0, total - (rows.some((item) => item.id === currentUser?.id) ? 1 : 0));
  const hasCustomFilters = query.trim().length > 0 || activeFilter !== 'ACTIVE' || countryFilter !== 'ALL';
  const activeFilterTags = [
    query.trim() ? `Pesquisa: ${query.trim()}` : null,
    activeFilter === 'ACTIVE' ? null : `Estado: ${activeFilter === 'INACTIVE' ? 'Inativo' : 'Todos'}`,
    countryFilter === 'ALL' ? null : `País: ${countryFilter === 'PT' ? 'Portugal' : 'Brasil'}`,
  ].filter(Boolean) as string[];
  const importPreviewRows = useMemo(() => importRows.slice(0, 8), [importRows]);
  const importCreatedCount = useMemo(() => importResults.filter((item) => item.status === 'CREATED').length, [importResults]);
  const importFailedCount = useMemo(() => importResults.filter((item) => item.status === 'FAILED').length, [importResults]);
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
  const selectedCollaboratorName = useMemo(
    () => (selectedRow ? getDisplayName(selectedRow) : 'Colaborador'),
    [selectedRow],
  );
  const selectedCollaboratorInitials = useMemo(() => {
    const parts = selectedCollaboratorName
      .split(' ')
      .map((part) => part.trim())
      .filter(Boolean);

    if (parts.length === 0) {
      return 'SH';
    }

    if (parts.length === 1) {
      return parts[0].slice(0, 2).toUpperCase();
    }

    return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
  }, [selectedCollaboratorName]);

  useEffect(() => {
    const normalizedPhotoUrl = normalizeFileUrl(editDraft.photoUrl);
    if (!normalizedPhotoUrl) {
      setSelectedCollaboratorPhotoUrl('');
      return;
    }

    let revoked = false;
    let objectUrl = '';

    const loadPhoto = async () => {
      try {
        const response = await fetch(normalizedPhotoUrl, {
          headers: getAuthHeaders(),
        });

        if (!response.ok) {
          throw new Error('Falha ao carregar foto protegida.');
        }

        const blob = await response.blob();
        objectUrl = window.URL.createObjectURL(blob);

        if (revoked) {
          window.URL.revokeObjectURL(objectUrl);
          return;
        }

        setSelectedCollaboratorPhotoUrl(objectUrl);
      } catch {
        if (!revoked) {
          setSelectedCollaboratorPhotoUrl(normalizedPhotoUrl);
        }
      }
    };

    void loadPhoto();

    return () => {
      revoked = true;
      if (objectUrl) {
        window.URL.revokeObjectURL(objectUrl);
      }
    };
  }, [editDraft.photoUrl]);

  const selectedCollaboratorTeamName = useMemo(() => {
    const draftTeamName = collaboratorTeamOptions.find((team) => team.id === editDraft.teamId)?.name?.trim();
    return draftTeamName || selectedRowTeam?.name || 'Sem equipa';
  }, [collaboratorTeamOptions, editDraft.teamId, selectedRowTeam]);
  const collaboratorRoleLine = useMemo(() => {
    const cargo = editDraft.cargo.trim() || 'Cargo por preencher';
    const funcao = editDraft.funcao.trim() || 'Função por preencher';
    return `${cargo} · ${funcao}`;
  }, [editDraft.cargo, editDraft.funcao]);
  const collaboratorRequiredFieldTotal = useMemo(() => {
    return 3
      + REQUIRED_IDENTIFICACAO_FIELDS.length
      + (editDraft.workCountry === 'BR' ? 1 : 0)
      + REQUIRED_CONTACTOS_FIELDS.length
      + (editDraft.workCountry === 'BR' ? REQUIRED_FISCAL_BR_FIELDS.length : REQUIRED_FISCAL_PT_FIELDS.length)
      + REQUIRED_EMERGENCIA_FIELDS.length
      + REQUIRED_CONTRATO_FIELDS.length;
  }, [editDraft.workCountry]);
  const selectedRestrictedTeams = useMemo(
    () => permissionTeams.filter((team) => selectedRestrictedTeamIds.includes(team.id)),
    [permissionTeams, selectedRestrictedTeamIds],
  );
  const availableTeamsToAdd = useMemo(
    () => permissionTeams.filter((team) => !selectedRestrictedTeamIds.includes(team.id)),
    [permissionTeams, selectedRestrictedTeamIds],
  );
  const permissionCategoryItems = useMemo(
    () => PERMISSION_CATEGORIES.map((item) => ({ id: item, label: getPermissionCategoryLabel(item) })),
    [],
  );
  const filteredPermissionListItems = useMemo(
    () => filteredCategoryPermissions.map((permission) => {
      const draft = permissionDrafts[permission.id] ?? buildDraftFromAssignment(permission);
      return {
        id: permission.id,
        label: permission.label,
        isSelected: selectedPermission?.id === permission.id,
        isEnabled: selectedUserAccessTotal || draft.enabled,
      };
    }),
    [filteredCategoryPermissions, permissionDrafts, selectedPermission?.id, selectedUserAccessTotal],
  );
  const activeProfileSectionView = useMemo(() => {
    if (detailsFichaSection === 'conta') {
      return null;
    }

    const sectionMeta = getEditSectionMeta(detailsFichaSection);
    const fields = getVisibleEditProfileFields(editDraft.workCountry)
      .filter((field) => field.section === detailsFichaSection && field.key !== 'photoUrl')
      .map((field) => ({
        key: String(field.key),
        label: field.label,
        className: getEditFieldCardClass(field.key),
        control: renderEditFieldControl(field.key),
      }));

    return {
      key: detailsFichaSection,
      title: sectionMeta.title,
      description: sectionMeta.description,
      sectionClassName: sectionMeta.sectionClassName,
      fields,
    };
  }, [detailsFichaSection, editDraft.workCountry]);
  const exportCandidatesFiltered = useMemo(() => {
    const normalized = exportSearch.trim().toLowerCase();
    const source = exportCandidates.filter((item) => item.id !== currentUser?.id);
    if (!normalized) {
      return source;
    }

    return source.filter((item) => {
      const teamInfo = getCollaboratorTeamInfo(item);
      return `${getDisplayName(item)} ${item.username} ${item.email} ${item.profile?.cargo || ''} ${item.profile?.funcao || ''} ${teamInfo.name}`
        .toLowerCase()
        .includes(normalized);
    });
  }, [currentUser?.id, exportCandidates, exportSearch]);
  const selectedExportCandidate = useMemo(
    () => exportCandidatesFiltered.find((item) => item.id === selectedExportUserId) || null,
    [exportCandidatesFiltered, selectedExportUserId],
  );
  const cargoHistoryEntries = useMemo(
    () => [...profileHistory].sort((a, b) => new Date(b.reviewedAt || 0).getTime() - new Date(a.reviewedAt || 0).getTime()),
    [profileHistory],
  );

  const detailsFichaMissingCounts = useMemo<Record<DetailsFichaSection, number>>(() => {
    if (!selectedRow) {
      return {
        conta: 0,
        identificacao: 0,
        contactos: 0,
        fiscal: 0,
        emergencia: 0,
        contrato: 0,
      };
    }

    const countMissing = (fields: Array<keyof CollaboratorEditDraft>) =>
      fields.reduce((count, fieldKey) => count + (isMissingTextValue(editDraft[fieldKey] as string) ? 1 : 0), 0);

    return {
      conta: [
        credentialsDraft.username.trim(),
        credentialsDraft.email.trim(),
        editDraft.workCountry,
      ].reduce((count, value) => count + (isMissingTextValue(value) ? 1 : 0), 0),
      identificacao: countMissing([
        ...REQUIRED_IDENTIFICACAO_FIELDS,
        ...(editDraft.workCountry === 'BR' ? (['brWorkState'] as Array<keyof CollaboratorEditDraft>) : []),
      ]),
      contactos: countMissing(REQUIRED_CONTACTOS_FIELDS),
      fiscal: countMissing(editDraft.workCountry === 'BR' ? REQUIRED_FISCAL_BR_FIELDS : REQUIRED_FISCAL_PT_FIELDS),
      emergencia: countMissing(REQUIRED_EMERGENCIA_FIELDS),
      contrato: countMissing(REQUIRED_CONTRATO_FIELDS),
    };
  }, [credentialsDraft.email, credentialsDraft.username, editDraft, selectedRow]);
  const collaboratorMissingFieldTotal = useMemo(
    () => Object.values(detailsFichaMissingCounts).reduce((totalCount, count) => totalCount + count, 0),
    [detailsFichaMissingCounts],
  );
  const collaboratorCompletion = useMemo(
    () => Math.max(0, Math.round(((collaboratorRequiredFieldTotal - collaboratorMissingFieldTotal) / Math.max(1, collaboratorRequiredFieldTotal)) * 100)),
    [collaboratorMissingFieldTotal, collaboratorRequiredFieldTotal],
  );

  useEffect(() => {
    if (!isExportModalOpen) {
      return;
    }

    if (selectedExportUserId && exportCandidatesFiltered.some((item) => item.id === selectedExportUserId)) {
      return;
    }

    setSelectedExportUserId(exportCandidatesFiltered[0]?.id || '');
  }, [exportCandidatesFiltered, isExportModalOpen, selectedExportUserId]);

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
  }, [canView, page, pageSize, query, activeFilter, countryFilter, sortBy, sortDirection]);

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

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target?.closest('.collaborators-actions-menu') ||
        target?.closest('.collaborators-actions-menu__panel')
      ) {
        return;
      }
      setActionsMenuState(null);
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setActionsMenuState(null);
    };

    const handleScroll = () => setActionsMenuState(null);

    document.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('keydown', handleEscape);
    window.addEventListener('scroll', handleScroll, true);

    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('keydown', handleEscape);
      window.removeEventListener('scroll', handleScroll, true);
    };
  }, []);

  useEffect(() => {
    if (newUserDraft.workCountry !== 'BR' && newUserDraft.brWorkState) {
      setNewUserDraft((current) => ({
        ...current,
        brWorkState: '',
      }));
    }
  }, [newUserDraft.brWorkState, newUserDraft.workCountry]);

  useEffect(() => {
    if (!selectedRow) {
      setCredentialsDraft({ username: '', email: '' });
      return;
    }
    setCredentialsDraft({ username: selectedRow.username, email: selectedRow.email });
  }, [selectedRow]);

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

  function buildCollaboratorsParams(targetPage: number, targetPageSize: number, targetSortBy = sortBy, targetSortDirection = sortDirection) {
    const params = new URLSearchParams();
    params.set('page', String(targetPage));
    params.set('pageSize', String(targetPageSize));
    params.set('sortBy', targetSortBy);
    params.set('sortDirection', targetSortDirection);

    if (query.trim()) {
      params.set('q', query.trim());
    }
    if (activeFilter !== 'ALL') {
      params.set('active', activeFilter === 'ACTIVE' ? 'true' : 'false');
    }
    if (countryFilter !== 'ALL') {
      params.set('workCountry', countryFilter);
    }

    return params;
  }

  function clearCollaboratorFilters() {
    setPage(1);
    setQuery('');
    setActiveFilter('ACTIVE');
    setCountryFilter('ALL');
    setSortBy('updatedAt');
    setSortDirection('desc');
  }

  async function loadExportCandidates() {
    setIsLoadingExportCandidates(true);

    try {
      const collected: CollaboratorRow[] = [];
      let currentPage = 1;
      const chunkSize = 100;
      let totalRows = 0;

      do {
        const params = buildCollaboratorsParams(currentPage, chunkSize, 'username', 'asc');
        const data = await apiRequestCached<CollaboratorsResponse>(`/users/collaborators?${params.toString()}`, {
          headers: getAuthHeaders(),
        }, 5000, true);

        totalRows = data.total;
        collected.push(...data.rows);
        currentPage += 1;
      } while (collected.length < totalRows && currentPage <= 10);

      setExportCandidates(collected);
      setStatus('');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Falha ao carregar colaboradores para exportação.');
    } finally {
      setIsLoadingExportCandidates(false);
    }
  }

  function openExportModal() {
    setIsExportModalOpen(true);
    setExportSearch('');
    setSelectedExportUserId('');
    void loadExportCandidates();
  }

  async function exportSelectedCollaboratorWorkbook() {
    if (!selectedExportCandidate) {
      setStatus('Seleciona um colaborador para exportar.');
      return;
    }

    setIsExportingWorkbook(true);

    try {
      const ExcelJS = await import('exceljs');
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Ficha colaborador', {
        views: [{ state: 'frozen', ySplit: 7 }],
      });

      workbook.creator = 'Smarter Hub';
      workbook.created = new Date();

      worksheet.columns = [
        { key: 'labelA', width: 29 },
        { key: 'valueA', width: 37 },
        { key: 'labelB', width: 29 },
        { key: 'valueB', width: 37 },
      ];

      const collaboratorName = getDisplayName(selectedExportCandidate);
      const profile = selectedExportCandidate.profile || {};
      const teamInfo = getCollaboratorTeamInfo(selectedExportCandidate);

      const nowFormatted = new Intl.DateTimeFormat('pt-PT', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }).format(new Date());

      worksheet.mergeCells('A1:D1');
      worksheet.mergeCells('A2:D2');
      worksheet.mergeCells('A3:D3');

      worksheet.getCell('A1').value = 'TLANTIC';
      worksheet.getCell('A1').font = { name: 'Calibri', size: 12, bold: true, color: { argb: 'FF0F3B78' } };
      worksheet.getCell('A1').alignment = { horizontal: 'left', vertical: 'middle' };

      worksheet.getCell('A2').value = 'Ficha de colaborador';
      worksheet.getCell('A2').font = { name: 'Calibri', size: 18, bold: true, color: { argb: 'FF0B2548' } };
      worksheet.getCell('A2').alignment = { horizontal: 'left', vertical: 'middle' };

      worksheet.getCell('A3').value = `Gerado em ${nowFormatted}`;
      worksheet.getCell('A3').font = { name: 'Calibri', size: 10, color: { argb: 'FF395169' } };
      worksheet.getCell('A3').alignment = { horizontal: 'left', vertical: 'middle' };

      worksheet.addRow([]);

      const tableBorderColor = 'FFD7E2EE';
      const tableHeaderFill = 'FFE8F0FA';
      const sectionFill = 'FF0F3B78';

      const applyRowGrid = (rowNumber: number) => {
        for (let col = 1; col <= 4; col += 1) {
          const cell = worksheet.getCell(rowNumber, col);
          cell.border = {
            top: { style: 'thin', color: { argb: tableBorderColor } },
            left: { style: 'thin', color: { argb: tableBorderColor } },
            right: { style: 'thin', color: { argb: tableBorderColor } },
            bottom: { style: 'thin', color: { argb: tableBorderColor } },
          };
        }
      };

      const addSectionTitle = (title: string) => {
        const sectionRow = worksheet.addRow([title, '', '', '']);
        sectionRow.height = 22;
        worksheet.mergeCells(`A${sectionRow.number}:D${sectionRow.number}`);

        const sectionCell = worksheet.getCell(sectionRow.number, 1);
        sectionCell.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
        sectionCell.alignment = { horizontal: 'left', vertical: 'middle' };
        sectionCell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: sectionFill },
        };
        applyRowGrid(sectionRow.number);
      };

      const addSectionHeaders = () => {
        const headerRow = worksheet.addRow(['Campo', 'Valor', 'Campo', 'Valor']);
        headerRow.height = 20;
        headerRow.eachCell((cell) => {
          cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FF0F3B78' } };
          cell.alignment = { horizontal: 'left', vertical: 'middle' };
          cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: tableHeaderFill },
          };
        });
        applyRowGrid(headerRow.number);
      };

      const addDataRow = (labelA: string, valueA: string, labelB: string, valueB: string) => {
        const row = worksheet.addRow([labelA, valueA, labelB, valueB]);
        row.height = 22;

        row.eachCell((cell, colNumber) => {
          const isLabel = colNumber === 1 || colNumber === 3;
          cell.font = {
            name: 'Calibri',
            size: 10,
            bold: isLabel,
            color: { argb: isLabel ? 'FF1F3347' : 'FF101F33' },
          };
          cell.alignment = {
            horizontal: 'left',
            vertical: 'middle',
            wrapText: true,
          };
          cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: isLabel ? 'FFF6F9FE' : 'FFFFFFFF' },
          };
        });

        applyRowGrid(row.number);
      };

      addSectionTitle('Identificação do colaborador');
      addSectionHeaders();
      addDataRow('Nome completo', formatTemplateValue(profile.nomeCompleto) || collaboratorName, 'Nome abreviado', formatTemplateValue(profile.nomeAbreviado));
      addDataRow('Username', formatTemplateValue(selectedExportCandidate.username), 'Email de login', formatTemplateValue(selectedExportCandidate.email));
      addDataRow('Data de nascimento', formatDateForTemplate(profile.dataNascimento), 'Género', formatTemplateValue(profile.genero));
      addDataRow('Estado civil', formatTemplateValue(profile.estadoCivil), 'Nacionalidade', formatTemplateValue(profile.nacionalidade));
      addDataRow('Equipa principal', teamInfo.name === '-' ? '' : teamInfo.name, 'País de trabalho', formatTemplateValue(profile.workCountry || 'PT'));

      worksheet.addRow([]);

      addSectionTitle('Habilitações literárias');
      addSectionHeaders();
      addDataRow('Nível de escolaridade', formatTemplateValue(profile.habilitacoesLiterarias), 'Curso', formatTemplateValue(profile.curso));
      addDataRow('Instituição de ensino', formatTemplateValue(profile.faculdade), 'GitHub', formatTemplateValue(profile.githubUser));

      worksheet.addRow([]);

      addSectionTitle('Contacto de emergência');
      addSectionHeaders();
      addDataRow('Nome', formatTemplateValue(profile.contactoEmergenciaNome), 'Parentesco', formatTemplateValue(profile.contactoEmergenciaParentesco));
      addDataRow('Contacto telefónico', formatTemplateValue(profile.contactoEmergenciaNumero), 'Observações', '');

      worksheet.addRow([]);

      addSectionTitle('Dados de contrato e remuneração');
      addSectionHeaders();
      addDataRow('Cargo', formatTemplateValue(profile.cargo), 'Função', formatTemplateValue(profile.funcao));
      addDataRow('Tipo de contrato', formatTemplateValue(profile.tipoContrato), 'Regime horário', formatTemplateValue(profile.regimeHorario));
      addDataRow('Data de início', formatDateForTemplate(profile.dataInicioContrato), 'Data de fim', formatDateForTemplate(profile.dataFimContrato));
      addDataRow('NIF', formatTemplateValue(profile.nif), 'NISS', formatTemplateValue(profile.niss));
      addDataRow('IBAN', formatTemplateValue(profile.iban), 'Situação IRS', formatTemplateValue(profile.situacaoIrs));
      addDataRow('N.º dependentes', formatTemplateValue(profile.numeroDependentes), 'Declaração IRS', formatTemplateValue(profile.declaracaoIrs));
      addDataRow('IRS Jovem', formatTemplateValue(profile.irsJovem), 'Ano 1.º desconto', formatTemplateValue(profile.anoPrimeiroDesconto));

      worksheet.addRow([]);

      addSectionTitle('Outras informações');
      addSectionHeaders();
      addDataRow('Email pessoal', formatTemplateValue(profile.emailPessoal), 'Telemóvel', formatTemplateValue(profile.telemovel));
      addDataRow('Morada fiscal', formatTemplateValue(profile.moradaFiscal), 'Morada habitual', formatTemplateValue(profile.endereco));
      addDataRow('Localidade', formatTemplateValue(profile.localidade), 'Código postal', formatTemplateValue(profile.codigoPostal));
      addDataRow('Cartão de cidadão', formatTemplateValue(profile.cartaoCidadao), 'Validade CC', formatDateForTemplate(profile.validadeCartaoCidadao));
      addDataRow('Matrícula viatura', formatTemplateValue(profile.matriculaCarro), 'Categoria profissional', formatTemplateValue(profile.categoriaProfissional));
      addDataRow('Cartão Continente', formatTemplateValue(profile.numeroCartaoContinente), 'Data voucher NOS', formatTemplateValue(profile.voucherNosData));

      worksheet.eachRow((row) => {
        row.eachCell((cell) => {
          if (!cell.alignment) {
            cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
          }
        });
      });

      try {
        const logoResponse = await fetch('/logo.png');
        if (logoResponse.ok) {
          const logoBlob = await logoResponse.blob();
          const logoBase64 = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result || ''));
            reader.onerror = () => reject(new Error('Falha a ler logo para exportação.'));
            reader.readAsDataURL(logoBlob);
          });

          const logoId = workbook.addImage({
            base64: logoBase64,
            extension: 'png',
          });

          worksheet.addImage(logoId, {
            tl: { col: 0.15, row: 0.15 },
            ext: { width: 260, height: 86 },
          });
        }
      } catch {
        // Se o logo não estiver disponível, mantém exportação sem bloquear o download.
      }

      const rawBuffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([rawBuffer as ArrayBuffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const fileName = `ficha_colaborador_${sanitizeFileName(collaboratorName)}_${new Date().toISOString().slice(0, 10)}.xlsx`;

      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);

      setIsExportModalOpen(false);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Falha ao exportar ficheiro Excel.');
    } finally {
      setIsExportingWorkbook(false);
    }
  }

  async function toggleActive(item: CollaboratorRow) {
    setBusyUserId(item.id);
    try {
      await toggleUserActive(item.id, !item.isActive);

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
    setDetailsFichaSection('conta');
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
      setProfileHistory(cached.profileHistory);
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
    setProfileHistory([]);
    setSelectedPermissionId(null);

    const controller = new AbortController();
    detailsLoadControllerRef.current = controller;

    try {
      const loadPermissionTeams = async () => {
        try {
          const adminTeams = await loadAdminTeams<Array<{ id: string; name: string }>>(controller.signal);
          return (adminTeams || []).map((team) => ({ id: team.id, name: team.name }));
        } catch {
          try {
            const scopedTeams = await loadTeams<Array<{ id: string; name: string }>>(controller.signal);
            return (scopedTeams || []).map((team) => ({ id: team.id, name: team.name }));
          } catch {
            return [];
          }
        }
      };

      const [details, permissionTeams, profileOptions, profileHistoryResponse] = await Promise.all([
        loadUserPermissions<UserPermissionsResponse>(item.id),
        loadPermissionTeams(),
        loadProfileOptions<{
          cargo?: CustomProfileOption[];
          funcao?: CustomProfileOption[];
        }>(controller.signal),
        loadProfileHistory<ProfileHistoryEntry[]>(500, controller.signal),
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
      const cargoHistory = (profileHistoryResponse || []).filter((entry) => {
        if (entry.userId !== item.id) {
          return false;
        }

        const payload = entry.requestedData || {};
        return Object.prototype.hasOwnProperty.call(payload, 'cargo');
      });
      setProfileHistory(cargoHistory);
      setDetailsCacheByUserId((current) => ({
        ...current,
        [item.id]: {
          selectedPermissions: details.permissions,
          selectedUserAccessTotal: hasAccessTotal,
          permissionTeams,
          customCargoOptions: profileOptions.cargo ?? [],
          customFuncaoOptions: profileOptions.funcao ?? [],
          profileHistory: cargoHistory,
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
    setDetailsFichaSection('conta');
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
    const token = getStoredAuthToken();
    const normalizedLabel = profileOptionLabel.trim().replace(/\s+/g, ' ');
    const normalizedGroup = profileOptionGroup.trim().replace(/\s+/g, ' ');

    if (!token || !normalizedLabel) {
      setStatus('Indica um valor válido para adicionar.');
      return;
    }

    setIsSavingProfileOption(true);

    try {
      const payload = await createProfileOption<{ option?: { id: string; type: 'CARGO' | 'FUNCAO'; label: string; groupLabel?: string | null } }>({
        type: profileOptionType,
        label: normalizedLabel,
        groupLabel: profileOptionType === 'FUNCAO' ? normalizedGroup : undefined,
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

  async function saveCollaboratorDraft(confirmed = false) {
    if (!selectedRow) {
      return;
    }

    // Detect country change and ask for confirmation first
    const currentCountry = (selectedRow.profile?.workCountry || 'PT') as 'PT' | 'BR';
    if (!confirmed && editDraft.workCountry !== currentCountry) {
      setPendingCountryChange({ from: currentCountry, to: editDraft.workCountry });
      setIsCountryChangeModalOpen(true);
      return;
    }

    setIsCountryChangeModalOpen(false);
    setPendingCountryChange(null);
    setIsSavingEditDraft(true);
    try {
      const result = await updateUser<{ cancelledVacations?: number; removedCountrySpecificFields?: number; countryChanged?: boolean }>(selectedRow.id, {
        teamId: editDraft.teamId || null,
        isActive: editDraft.isActive,
        workCountry: editDraft.workCountry,
        brWorkState: editDraft.workCountry === 'BR' ? (editDraft.brWorkState || undefined) : undefined,
        nomeCompleto: editDraft.nomeCompleto,
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
        localNascimentoPais: editDraft.localNascimentoPais,
        localNascimentoCidade: editDraft.localNascimentoCidade,
        nomePai: editDraft.nomePai,
        nomeMae: editDraft.nomeMae,
        cartaoCidadao: editDraft.cartaoCidadao,
        validadeCartaoCidadao: editDraft.validadeCartaoCidadao,
        nif: editDraft.nif,
        cpf: editDraft.cpf,
        pis: editDraft.pis,
        ctps: editDraft.ctps,
        ctpsSerie: editDraft.ctpsSerie,
        ctpsDataExpedicao: editDraft.ctpsDataExpedicao,
        rg: editDraft.rg,
        rgOrgaoEmissor: editDraft.rgOrgaoEmissor,
        rgDataExpedicao: editDraft.rgDataExpedicao,
        cnh: editDraft.cnh,
        cnhCategoria: editDraft.cnhCategoria,
        cnhDataValidade: editDraft.cnhDataValidade,
        tituloEleitor: editDraft.tituloEleitor,
        zonaEleitoral: editDraft.zonaEleitoral,
        secaoEleitoral: editDraft.secaoEleitoral,
        certificadoReservista: editDraft.certificadoReservista,
        niss: editDraft.niss,
        iban: editDraft.iban,
        situacaoIrs: editDraft.situacaoIrs,
        numeroDependentes: editDraft.numeroDependentes,
        declaracaoIrs: editDraft.declaracaoIrs,
        irsJovem: editDraft.irsJovem,
        anoPrimeiroDesconto: editDraft.anoPrimeiroDesconto,
        primeiroEmprego: editDraft.primeiroEmprego,
        recebeAposentadoria: editDraft.recebeAposentadoria,
        recebeSeguroDesemprego: editDraft.recebeSeguroDesemprego,
        valeTransporte: editDraft.valeTransporte,
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
        categoriaProfissional: editDraft.categoriaProfissional,
        numeroMecanografico: editDraft.numeroMecanografico,
        funcao: editDraft.funcao,
        dataInicioContrato: editDraft.dataInicioContrato,
        dataFimContrato: editDraft.dataFimContrato,
        tipoContrato: editDraft.tipoContrato,
        regimeHorario: editDraft.regimeHorario,
        horasSemanaisContrato: editDraft.horasSemanaisContrato,
      });

      clearApiCache('/users/collaborators');
      await loadCollaborators();
      await openDetails(selectedRow, 'ficha');

      if (result?.countryChanged) {
        const countryLabel = (c: string) => (c === 'BR' ? 'Brasil' : 'Portugal');
        const from = (selectedRow.profile?.workCountry || 'PT') as string;
        const to = editDraft.workCountry as string;
        const cancelled = result.cancelledVacations ?? 0;
        const removedFields = result.removedCountrySpecificFields ?? 0;
        const lines = [
          `País de trabalho alterado de ${countryLabel(from)} para ${countryLabel(to)}.`,
          cancelled > 0
            ? `${cancelled} pedido(s) de férias/ausências pendente(s) foram cancelados automaticamente.`
            : 'Sem pedidos pendentes para cancelar.',
          `${removedFields} campo(s) específicos do país anterior foram limpos automaticamente.`,
          'Campos exclusivos do novo país foram inicializados e os campos comuns foram mantidos.',
          'As equipas foram removidas - reatribui o colaborador à equipa correta.',
        ];
        setStatus(lines.join(' '));
      } else {
        setStatus('Ficha atualizada com sucesso.');
      }
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
        await revokeUserPermission(selectedRow.id, permission.id);
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
          await updateUserPermission(selectedRow.id, permission.id, body);
        } else {
          await createUserPermission(selectedRow.id, body);
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

    const targetUser = selectedRow;

    if (enable === selectedUserAccessTotal) {
      return false;
    }

    setIsTogglingAccessTotal(true);
    try {
      const result = await setUserAccessTotal(targetUser.id, enable, reason);

      const refreshedDetails = await loadUserPermissions<UserPermissionsResponse>(targetUser.id);

      const refreshedAccessTotal = Boolean(refreshedDetails.accessTotal ?? result.accessTotal);
      const refreshedPermissions = refreshedDetails.permissions;

      clearApiCache();
      setSelectedUserAccessTotal(refreshedAccessTotal);
      setSelectedPermissions(refreshedPermissions);
      setPermissionDrafts(Object.fromEntries(refreshedPermissions.map((permission) => [permission.id, buildDraftFromAssignment(permission, refreshedAccessTotal)])));
      setSelectedPermissionId((current) => {
        if (current && refreshedPermissions.some((permission) => permission.id === current)) {
          return current;
        }
        return refreshedPermissions[0]?.id ?? null;
      });
      setDetailsCacheByUserId((current) => {
        const cached = current[targetUser.id];
        return {
          ...current,
          [targetUser.id]: {
            selectedPermissions: refreshedPermissions,
            selectedUserAccessTotal: refreshedAccessTotal,
            permissionTeams: cached?.permissionTeams ?? permissionTeams,
            customCargoOptions: cached?.customCargoOptions ?? customCargoOptions,
            customFuncaoOptions: cached?.customFuncaoOptions ?? customFuncaoOptions,
            profileHistory: cached?.profileHistory ?? profileHistory,
          },
        };
      });
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

  function setSelectedPermissionEnabled(enabled: boolean) {
    if (!selectedPermission || !selectedPermissionDraft) {
      return;
    }

    setPermissionDrafts((current) => ({
      ...current,
      [selectedPermission.id]: { ...selectedPermissionDraft, enabled },
    }));
  }

  function toggleSelectedPermissionCountry(country: string) {
    if (!selectedPermission || !selectedPermissionDraft) {
      return;
    }

    setPermissionDrafts((current) => ({
      ...current,
      [selectedPermission.id]: {
        ...selectedPermissionDraft,
        restrictedToCountries: toggleCommaItem(selectedPermissionDraft.restrictedToCountries, country),
      },
    }));
  }

  function setSelectedPermissionNotes(notes: string) {
    if (!selectedPermission || !selectedPermissionDraft) {
      return;
    }

    setPermissionDrafts((current) => ({
      ...current,
      [selectedPermission.id]: { ...selectedPermissionDraft, notes },
    }));
  }

  function openWorkHoursModal() {
    const nextDraft = isDynamicRegime
      ? parseDynamicRegimeDays(editDraft.regimeHorario)
      : defaultDynamicRegimeDays.map((item) => ({ ...item }));

    setWorkHoursDraft(nextDraft);
    setIsWorkHoursModalOpen(true);
  }

  function applyWorkHoursModal() {
    const weeklyHours = calculateWeeklyHoursFromDays(workHoursDraft);
    if (weeklyHours == null) {
      setStatus('Define pelo menos um dia ativo com hora de fim superior à hora de início.');
      return;
    }

    const serialized = serializeDynamicRegimeDays(workHoursDraft);
    setEditDraft((current) => ({
      ...current,
      regimeHorario: serialized,
      horasSemanaisContrato: String(weeklyHours),
    }));
    setIsWorkHoursModalOpen(false);
  }

  function handleWorkHoursDayToggle(dayKey: string, enabled: boolean) {
    setWorkHoursDraft((current) => current.map((item) => {
      if (item.key !== dayKey) {
        return item;
      }

      return {
        ...item,
        enabled,
      };
    }));
  }

  function handleWorkHoursTimeChange(dayKey: string, field: 'start' | 'end', value: string) {
    setWorkHoursDraft((current) => current.map((item) => {
      if (item.key !== dayKey) {
        return item;
      }

      return {
        ...item,
        [field]: value,
      };
    }));
  }

  function renderEditFieldControl(fieldKey: keyof CollaboratorEditDraft) {
    const isComprovativoField = fieldKey === 'comprovativoMoradaFiscal'
      || fieldKey === 'comprovativoCartaoCidadao'
      || fieldKey === 'comprovativoIban'
      || fieldKey === 'comprovativoCartaoContinente'
        || fieldKey === 'declaracaoIrs'
        || fieldKey === 'certificadoHabilitacoesUrl'
        || fieldKey === 'cartaConducaoUrl'
        || fieldKey === 'criminalRecordUrl';

      const isPhotoField = fieldKey === 'photoUrl';

    const value = editDraft[fieldKey];

    const onChangeValue = (nextValue: string) => {
      setEditDraft((current) => ({ ...current, [fieldKey]: nextValue }));
    };

    const onChangeBooleanValue = (nextValue: boolean) => {
      setEditDraft((current) => ({ ...current, [fieldKey]: nextValue }));
    };

    if (
      fieldKey === 'primeiroEmprego'
      || fieldKey === 'recebeAposentadoria'
      || fieldKey === 'recebeSeguroDesemprego'
      || fieldKey === 'valeTransporte'
    ) {
      return (
        <select value={value ? 'SIM' : 'NAO'} onChange={(event) => onChangeBooleanValue(event.target.value === 'SIM')} disabled={!canEditUser}>
          <option value="SIM">Sim</option>
          <option value="NAO">Não</option>
        </select>
      );
    }

    if (fieldKey === 'genero') {
      return (
        <select value={String(value || '')} onChange={(event) => onChangeValue(event.target.value)} disabled={!canEditUser}>
          <option value="">Selecionar</option>
          {generoOptions.map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
      );
    }

    if (fieldKey === 'brWorkState') {
      return (
        <select value={String(value || '')} onChange={(event) => onChangeValue(event.target.value)} disabled={!canEditUser}>
          <option value="">Selecionar</option>
          <option value="SP">São Paulo (SP)</option>
          <option value="RS">Rio Grande do Sul (RS)</option>
        </select>
      );
    }

    if (fieldKey === 'estadoCivil') {
      return (
        <select value={String(value || '')} onChange={(event) => onChangeValue(event.target.value)} disabled={!canEditUser}>
          <option value="">Selecionar</option>
          {estadoCivilOptions.map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
      );
    }

    if (fieldKey === 'habilitacoesLiterarias') {
      return (
        <select value={String(value || '')} onChange={(event) => onChangeValue(event.target.value)} disabled={!canEditUser}>
          <option value="">Selecionar</option>
          {habilitacoesOptions.map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
      );
    }

    if (fieldKey === 'situacaoIrs') {
      return (
        <select value={String(value || '')} onChange={(event) => onChangeValue(event.target.value)} disabled={!canEditUser}>
          <option value="">Selecionar</option>
          {situacaoIrsOptions.map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
      );
    }

    if (fieldKey === 'irsJovem') {
      return (
        <select value={String(value || '')} onChange={(event) => onChangeValue(event.target.value)} disabled={!canEditUser}>
          <option value="">Selecionar</option>
          {irsJovemOptions.map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
      );
    }

    if (fieldKey === 'contactoEmergenciaParentesco') {
      return (
        <select value={String(value || '')} onChange={(event) => onChangeValue(event.target.value)} disabled={!canEditUser}>
          <option value="">Selecionar</option>
          {parentescoOptions.map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
      );
    }

    if (
      fieldKey === 'dataNascimento'
      || fieldKey === 'validadeCartaoCidadao'
      || fieldKey === 'ctpsDataExpedicao'
      || fieldKey === 'rgDataExpedicao'
      || fieldKey === 'cnhDataValidade'
      || fieldKey === 'dataInicioContrato'
      || fieldKey === 'dataFimContrato'
      || fieldKey === 'voucherNosData'
    ) {
      return (
        <input
          type="date"
          value={String(value || '')}
          onChange={(event) => onChangeValue(event.target.value)}
          disabled={!canEditUser}
        />
      );
    }

    if (fieldKey === 'tipoContrato') {
      return (
        <select value={String(value || '')} onChange={(event) => onChangeValue(event.target.value)} disabled={!canEditUser}>
          <option value="">Selecionar</option>
          {tipoContratoOptions.map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
      );
    }

    if (fieldKey === 'regimeHorario') {
      return (
        <div className="profile-contract-dynamic">
          <div className="profile-contract-dynamic__actions">
            <Button type="button" size="sm" variant="secondary" disabled={!canEditUser} onClick={openWorkHoursModal}>
              Configurar horas
            </Button>
          </div>
        </div>
      );
    }

    if (fieldKey === 'cargo') {
      return (
        <select value={String(value || '')} onChange={(event) => onChangeValue(event.target.value)} disabled={!canEditUser}>
          <option value="">Selecionar</option>
          {cargoDropdownOptions.map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
      );
    }

    if (fieldKey === 'funcao') {
      return (
        <select value={String(value || '')} onChange={(event) => onChangeValue(event.target.value)} disabled={!canEditUser}>
          <option value="">Selecionar</option>
          {funcaoDropdownOptions.map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
      );
    }

    if (isPhotoField) {
      const rawPhotoUrl = String(value || '');
      const photoUrl = rawPhotoUrl.trim() === editDraft.photoUrl.trim()
        ? selectedCollaboratorPhotoUrl
        : normalizeFileUrl(rawPhotoUrl);
      return (
        <div className="collaborator-proof-field">
          {photoUrl && (
            <img src={photoUrl} alt="Foto de utilizador" className="collaborator-photo-preview" />
          )}
          <div className="collaborator-proof-field__actions">
            {photoUrl ? (
              <a href={photoUrl} target="_blank" rel="noreferrer" className="collaborator-proof-link">
                Ver foto
              </a>
            ) : (
              <span className="collaborator-proof-link collaborator-proof-link--empty">Sem foto</span>
            )}

            <label className="collaborator-proof-upload">
              <span>Carregar foto</span>
              <input
                id={hiddenFileInputId(fieldKey)}
                type="file"
                accept="image/*"
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

    if (isComprovativoField) {
      const comprovativoUrl = normalizeFileUrl(String(value || ''));
        return (
        <div className="collaborator-proof-field">
          {fieldKey === 'declaracaoIrs' && (
            <a
              href="/mod99-template.pdf"
              target="_blank"
              rel="noreferrer"
              className="collaborator-proof-link collaborator-proof-link--template"
              title="Descarregar modelo em branco da Declaração de Remunerações Mod. 99"
            >
              Template Mod. 99
            </a>
          )}
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
        value={String(value || '')}
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

    const token = getStoredAuthToken();
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
      setStatus(field === 'photoUrl' ? 'Foto de utilizador carregada com sucesso.' : 'Comprovativo carregado com sucesso.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : field === 'photoUrl' ? 'Falha ao carregar foto de utilizador.' : 'Falha ao carregar comprovativo.');
    }
  }

  function openImportModal() {
    setIsImportModalOpen(true);
    setImportFileName('');
    setImportRows([]);
    setImportIssues([]);
    setImportResults([]);
  }

  function closeImportModal() {
    setIsImportModalOpen(false);
    setImportFileName('');
    setImportRows([]);
    setImportIssues([]);
    setImportResults([]);
  }

  async function parseImportFile(file: File) {
    const lowerName = file.name.toLowerCase();

    if (lowerName.endsWith('.csv')) {
      const text = await file.text();
      return buildImportRowsFromMatrix(parseDelimitedText(text));
    }

    const ExcelJS = await loadExcelJsWorkbook();
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await file.arrayBuffer());
    const worksheet = workbook.getWorksheet('Importacao')
      ?? workbook.worksheets.find((sheet: any) => /^importa[cç][aã]o$/i.test(sheet.name))
      ?? workbook.worksheets.find((sheet: any) => !/^instrucoes$/i.test(sheet.name) && !/^listas$/i.test(sheet.name) && sheet.actualRowCount > 0)
      ?? workbook.worksheets.find((sheet: any) => sheet.actualRowCount > 0);

    if (!worksheet) {
      return {
        rows: [] as CollaboratorImportRow[],
        issues: [{ rowNumber: 1, message: 'O ficheiro Excel não contém folhas com dados.' }] as CollaboratorImportIssue[],
      };
    }

    const matrix: string[][] = [];
    worksheet.eachRow({ includeEmpty: true }, (row: any) => {
      const values: string[] = [];
      const totalCells = Math.max(row.cellCount, Array.isArray(row.values) ? row.values.length - 1 : 0);
      for (let columnIndex = 1; columnIndex <= totalCells; columnIndex += 1) {
        values.push(readSpreadsheetCellValue(row.getCell(columnIndex).value));
      }
      if (values.some((item) => item.trim().length > 0)) {
        matrix.push(values);
      }
    });

    return buildImportRowsFromMatrix(matrix);
  }

  async function handleImportFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    setIsParsingImportFile(true);
    setImportResults([]);

    try {
      const parsed = await parseImportFile(file);
      setImportFileName(file.name);
      setImportRows(parsed.rows);
      setImportIssues(parsed.issues);

      if (parsed.rows.length === 0) {
        setStatus('O ficheiro não contém linhas válidas para importação.');
      } else if (parsed.issues.length > 0) {
        setStatus('Foram detetados problemas no ficheiro. Corrige-os antes de importar.');
      } else {
        setStatus('Ficheiro preparado para importação.');
      }
    } catch (error) {
      setImportFileName('');
      setImportRows([]);
      setImportIssues([]);
      setStatus(error instanceof Error ? error.message : 'Falha ao ler ficheiro de importação.');
    } finally {
      setIsParsingImportFile(false);
      event.target.value = '';
    }
  }

  async function downloadImportTemplate() {
    try {
      const ExcelJS = await loadExcelJsWorkbook();
      const workbook = new ExcelJS.Workbook();
      const [teamData, profileOptionsData] = await Promise.allSettled([
        apiRequestCached<Array<{ id: string; name: string; parentTeamId?: string | null }>>('/admin/teams', { headers: getAuthHeaders() }, 8000, true),
        apiRequestCached<{ cargo?: CustomProfileOption[]; funcao?: CustomProfileOption[] }>('/profile/options', { headers: getAuthHeaders() }, 8000, true),
      ]);

      const teams = teamData.status === 'fulfilled' ? teamData.value : [];
      const profileOptions = profileOptionsData.status === 'fulfilled' ? profileOptionsData.value : {};
      const cargoValues = normalizeDropdownValues([
        ...CARGO_OPTIONS,
        ...((profileOptions.cargo ?? []).map((item) => item.label)),
      ]);
      const funcaoValues = normalizeDropdownValues([
        ...FUNCAO_OPTIONS,
        ...((profileOptions.funcao ?? []).map((item) => item.label)),
      ]);

      const instructionsSheet = workbook.addWorksheet('Instrucoes');
      instructionsSheet.columns = [
        { header: 'Tema', key: 'topic', width: 30 },
        { header: 'Detalhe', key: 'detail', width: 95 },
      ];
      instructionsSheet.addRows([
        { topic: 'Objetivo', detail: 'Preencher novos colaboradores para criação em massa no SMARTER HUB.' },
        { topic: 'Folha de preenchimento', detail: 'Usa apenas a folha "Importacao" para inserir dados.' },
        { topic: 'Campos obrigatórios', detail: 'Nome completo, Username e Email.' },
        { topic: 'Dropdowns', detail: 'Campos com lista têm validação automática (país, equipa e campos de domínio).' },
        { topic: 'Equipa', detail: 'Seleciona Equipa principal. Se existir subequipa, preencher também o campo Subequipa com valor da lista.' },
        { topic: 'Comprovativos', detail: 'Campos de comprovativos não fazem parte da importação. Devem ser anexados depois na ficha de cada colaborador.' },
        { topic: 'Limite', detail: 'Máximo de 200 linhas por importação.' },
      ]);
      instructionsSheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
      instructionsSheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF123D75' } };

      const worksheet = workbook.addWorksheet('Importacao');
      worksheet.columns = IMPORT_TEMPLATE_FIELDS.map((field) => ({
        header: field.label,
        key: field.key,
        width: Math.max(18, field.label.length + 6),
      }));

      const requirementRow = worksheet.getRow(1);
      requirementRow.values = IMPORT_TEMPLATE_FIELDS.map((field) => (field.required ? 'Obrigatório' : 'Opcional'));
      requirementRow.font = { bold: true, color: { argb: 'FF123D75' } };
      requirementRow.alignment = { vertical: 'middle', horizontal: 'center' };
      requirementRow.eachCell((cell: any, columnNumber: number) => {
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: IMPORT_TEMPLATE_FIELDS[columnNumber - 1]?.required ? 'FFE6F4EA' : 'FFF4F7FB' },
        };
      });

      const headerRow = worksheet.getRow(2);
      headerRow.values = IMPORT_TEMPLATE_FIELDS.map((field) => (field.required ? `${field.label} *` : field.label));
      headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF123D75' } };

      worksheet.addRow(Object.fromEntries(IMPORT_TEMPLATE_FIELDS.map((field) => [field.key, field.example])));
      worksheet.views = [{ state: 'frozen', ySplit: 2 }];

      const listsSheet = workbook.addWorksheet('Listas');
      const listDefinitions: Array<{ key: string; title: string; values: string[] }> = [
        { key: 'workCountry', title: 'País de trabalho', values: ['PT', 'BR'] },
        { key: 'teamName', title: 'Equipa principal', values: teams.filter((team) => !team.parentTeamId).map((team) => team.name).sort((a, b) => a.localeCompare(b, 'pt-PT')) },
        { key: 'subTeamName', title: 'Subequipa', values: teams.filter((team) => Boolean(team.parentTeamId)).map((team) => team.name).sort((a, b) => a.localeCompare(b, 'pt-PT')) },
        { key: 'genero', title: 'Género', values: [...generoOptions] },
        { key: 'estadoCivil', title: 'Estado civil', values: [...estadoCivilOptions] },
        { key: 'habilitacoesLiterarias', title: 'Habilitações literárias', values: [...habilitacoesOptions] },
        { key: 'situacaoIrs', title: 'Situação IRS', values: [...situacaoIrsOptions] },
        { key: 'irsJovem', title: 'IRS Jovem', values: [...irsJovemOptions] },
        { key: 'contactoEmergenciaParentesco', title: 'Parentesco', values: [...parentescoOptions] },
        { key: 'tipoContrato', title: 'Tipo de contrato', values: [...tipoContratoOptions] },
        { key: 'regimeHorario', title: 'Regime horário', values: [...regimeHorarioOptions] },
        { key: 'cargo', title: 'Cargo', values: cargoValues },
        { key: 'funcao', title: 'Função', values: funcaoValues },
      ];

      const listRanges = new Map<string, string>();
      listDefinitions.forEach((definition, listIndex) => {
        const column = listIndex + 1;
        const columnLetter = toExcelColumnLetter(column);
        listsSheet.getCell(1, column).value = definition.title;
        listsSheet.getCell(1, column).font = { bold: true };

        const values = definition.values.length > 0 ? definition.values : [''];
        values.forEach((value, valueIndex) => {
          listsSheet.getCell(valueIndex + 2, column).value = value;
        });

        listRanges.set(definition.key, `=Listas!$${columnLetter}$2:$${columnLetter}$${values.length + 1}`);
      });

      const teamToSubTeams = new Map<string, string[]>();
      for (const team of teams) {
        if (!team.parentTeamId) {
          continue;
        }
        const parent = teams.find((candidate) => candidate.id === team.parentTeamId);
        if (!parent) {
          continue;
        }
        const current = teamToSubTeams.get(parent.name) ?? [];
        current.push(team.name);
        teamToSubTeams.set(parent.name, current);
      }

      const placeholderColumn = toExcelColumnLetter(listDefinitions.length + 1);
      listsSheet.getCell(`${placeholderColumn}1`).value = 'placeholder';
      listsSheet.getCell(`${placeholderColumn}2`).value = '';

      let namedRangeColumn = listDefinitions.length + 2;
      for (const [parentTeamName, subTeams] of teamToSubTeams.entries()) {
        const sortedSubTeams = [...subTeams].sort((a, b) => a.localeCompare(b, 'pt-PT'));
        const colLetter = toExcelColumnLetter(namedRangeColumn);
        listsSheet.getCell(`${colLetter}1`).value = parentTeamName;
        sortedSubTeams.forEach((subTeamName, index) => {
          listsSheet.getCell(`${colLetter}${index + 2}`).value = subTeamName;
        });
        workbook.definedNames.add(`Listas!$${colLetter}$2:$${colLetter}$${sortedSubTeams.length + 1}`, toExcelDefinedName(parentTeamName));
        namedRangeColumn += 1;
      }

      listsSheet.state = 'veryHidden';

      const teamColumnIndex = IMPORT_TEMPLATE_FIELDS.findIndex((field) => field.key === 'teamName') + 1;
      const subTeamColumnIndex = IMPORT_TEMPLATE_FIELDS.findIndex((field) => field.key === 'subTeamName') + 1;
      const teamColumnLetter = toExcelColumnLetter(teamColumnIndex);
      const subTeamColumnLetter = toExcelColumnLetter(subTeamColumnIndex);

      IMPORT_TEMPLATE_FIELDS.forEach((field, index) => {
        if (!field.dropdownKey) {
          return;
        }
        const formula = listRanges.get(field.dropdownKey);
        if (!formula) {
          return;
        }
        const columnLetter = toExcelColumnLetter(index + 1);
        for (let rowIndex = 3; rowIndex <= 2002; rowIndex += 1) {
          const isSubTeamColumn = columnLetter === subTeamColumnLetter;
          worksheet.getCell(`${columnLetter}${rowIndex}`).dataValidation = isSubTeamColumn
            ? {
                type: 'list',
                allowBlank: true,
                formulae: [
                  `=IF($${teamColumnLetter}${rowIndex}="",Listas!$${placeholderColumn}$2:$${placeholderColumn}$2,INDIRECT("SUBTEAM_"&UPPER(SUBSTITUTE(SUBSTITUTE(SUBSTITUTE(SUBSTITUTE($${teamColumnLetter}${rowIndex}," ","_"),"-","_"),".","_"),"/","_"))))`,
                ],
                showErrorMessage: true,
                errorTitle: 'Subequipa inválida',
                error: 'Escolhe uma subequipa pertencente à equipa principal selecionada.',
              }
            : {
                type: 'list',
                allowBlank: true,
                formulae: [formula],
                showErrorMessage: true,
                errorTitle: 'Valor inválido',
                error: 'Escolhe um valor da lista disponível.',
              };
        }
      });

      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer as ArrayBuffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'modelo_importacao_colaboradores.xlsx';
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Falha ao gerar modelo de importacao XLSX', error);
      setStatus(error instanceof Error ? error.message : 'Falha ao gerar modelo de importação.');
    }
  }

  async function importUsersFromFile() {
    if (importRows.length === 0) {
      setStatus('Escolhe um ficheiro com linhas válidas para importar.');
      return;
    }

    if (importIssues.length > 0) {
      setStatus('Corrige os problemas do ficheiro antes de iniciar a importação.');
      return;
    }

    setIsImportingUsers(true);

    try {
      const response = await apiRequest<CollaboratorImportResponse>('/users/import', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          rows: importRows.map((row) => ({
            fullName: row.fullName,
            username: row.username,
            email: row.email,
            workCountry: row.workCountry,
            teamName: row.teamName || undefined,
            subTeamName: row.subTeamName || undefined,
            profile: row.profile,
          })),
        }),
      });

      setImportResults(response.results);
      clearApiCache('/users/collaborators');
      await loadCollaborators();

      if (response.failedCount === 0) {
        setStatus(`${response.createdCount} colaborador(es) criado(s) com sucesso.`);
        closeImportModal();
      } else {
        setStatus(`${response.createdCount} criado(s) e ${response.failedCount} falhado(s). Revê o resultado abaixo.`);
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Falha ao importar colaboradores.');
    } finally {
      setIsImportingUsers(false);
    }
  }

  function openCreateModal() {
    setNewUserDraft({ fullName: '', personalEmail: '', workCountry: 'PT', brWorkState: '' });
    setIsCreateModalOpen(true);
  }

  async function loadAdmissionSettings() {
    setIsSettingsLoading(true);
    setSettingsStatus('');
    try {
      const data = await loadAdmissionFormSettings<AdmissionFormSettingsResponse>();
      setAdmissionSettings(data);
      setSettingsDraftRequiredFields(data.requiredFieldsByCountry[settingsCountry]);
    } catch (error) {
      setSettingsStatus(error instanceof Error ? error.message : 'Falha ao carregar configurações da admissão.');
    } finally {
      setIsSettingsLoading(false);
    }
  }

  async function openAdmissionFormSettingsFromCreateModal() {
    setIsSettingsFlowFromCreateModal(true);
    setIsCreateModalOpen(false);
    if (!admissionSettings) {
      await loadAdmissionSettings();
    }
    setIsSettingsModalOpen(true);
  }

  function changeAdmissionSettingsCountry(country: 'PT' | 'BR') {
    if (!admissionSettings) {
      return;
    }
    setSettingsCountry(country);
    setSettingsDraftRequiredFields(admissionSettings.requiredFieldsByCountry[country]);
    setSettingsStatus('');
  }

  function toggleAdmissionRequiredField(fieldKey: string) {
    setSettingsDraftRequiredFields((current) => (
      current.includes(fieldKey)
        ? current.filter((item) => item !== fieldKey)
        : [...current, fieldKey]
    ));
  }

  function toggleAdmissionInternshipPreset(enabled: boolean) {
    const presetFields = admissionSettingsPresetFieldKeys[settingsCountry];
    if (enabled) {
      setSettingsDraftRequiredFields((current) => current.filter((field) => !presetFields.includes(field)));
      return;
    }

    setSettingsDraftRequiredFields((current) => [
      ...current,
      ...presetFields.filter((field) => !current.includes(field)),
    ]);
  }

  function requestSaveAdmissionSettings() {
    if (hasAdmissionSettingsChanges) {
      setIsSaveAdmissionSettingsConfirmationOpen(true);
      return;
    }

    void saveAdmissionSettingsFromCollaborators(false);
  }

  async function saveAdmissionSettingsFromCollaborators(asDefault = false) {
    if (settingsDraftRequiredFields.length === 0) {
      setSettingsStatus('Seleciona pelo menos um campo obrigatório.');
      return;
    }

    setIsSettingsSaving(true);
    setSettingsStatus('');
    setIsSaveAdmissionSettingsConfirmationOpen(false);
    try {
      const saved = await saveAdmissionFormSettings<AdmissionFormSettingsResponse>(settingsCountry, settingsDraftRequiredFields);
      setAdmissionSettings(saved);
      setSettingsDraftRequiredFields(saved.requiredFieldsByCountry[settingsCountry]);
      const message = asDefault
        ? 'Configuração guardada como padrão com sucesso.'
        : 'Configuração guardada com sucesso.';
      if (isSettingsFlowFromCreateModal) {
        setIsSettingsModalOpen(false);
        setIsCreateModalOpen(true);
        setIsSettingsFlowFromCreateModal(false);
        setStatus(message);
      } else {
        setSettingsStatus(message);
      }
    } catch (error) {
      setSettingsStatus(error instanceof Error ? error.message : 'Falha ao guardar configurações da admissão.');
    } finally {
      setIsSettingsSaving(false);
    }
  }

  function closeCreateModal() {
    setIsCreateModalOpen(false);
    setNewUserDraft({ fullName: '', personalEmail: '', workCountry: 'PT', brWorkState: '' });
  }

  function updateNewUserDraft(patch: Partial<CollaboratorCreateDraft>) {
    setNewUserDraft((current) => ({ ...current, ...patch }));
  }

  async function createUser() {
    const fullName = newUserDraft.fullName.trim().replace(/\s+/g, ' ');
    const personalEmail = newUserDraft.personalEmail.trim().toLowerCase();
    const workCountry = newUserDraft.workCountry;
    const brWorkState = workCountry === 'BR' ? newUserDraft.brWorkState : undefined;

    if (!fullName || !personalEmail) {
      setStatus('Preenche nome completo e email pessoal.');
      return;
    }

    if (workCountry === 'BR' && !brWorkState) {
      setStatus('Seleciona o estado de trabalho para admissões no Brasil.');
      return;
    }

    setIsCreatingUser(true);
    try {
      await createAdmissionRequest<{ id: string; fullName: string; personalEmail: string }>({
        fullName,
        personalEmail,
        workCountry,
        brWorkState,
      });
      closeCreateModal();
      setStatus('Pedido de admissão criado. O convite foi enviado para o email pessoal do colaborador.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Falha ao iniciar o pedido de admissão.');
    } finally {
      setIsCreatingUser(false);
    }
  }

  async function saveCredentials() {
    if (!selectedRow) return;
    const username = credentialsDraft.username.trim().toLowerCase();
    const email = credentialsDraft.email.trim().toLowerCase();

    if (!username || !email) {
      setStatus('Username e email são obrigatórios.');
      return;
    }

    const payload: { username?: string; email?: string } = {};
    if (username !== selectedRow.username) payload.username = username;
    if (email !== selectedRow.email) payload.email = email;

    if (Object.keys(payload).length === 0) {
      setStatus('Sem alterações para guardar.');
      return;
    }

    setIsSavingCredentials(true);
    try {
      await apiRequest(`/admin/users/${selectedRow.id}/credentials`, {
        method: 'PATCH',
        headers: getAuthHeaders(),
        body: JSON.stringify(payload),
      });
      clearApiCache('/users/collaborators');
      void loadCollaborators();
      setStatus('Credenciais atualizadas com sucesso.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Falha ao atualizar credenciais.');
    } finally {
      setIsSavingCredentials(false);
    }
  }

  if (!canView) {
    return (
      <section className="trainings-shell">
        <article className="trainings-list-card">
          <h3>Acesso restrito</h3>
          <p>Esta área está disponível para perfis com acesso de gestão de pessoas.</p>
        </article>
      </section>
    );
  }

  return (
    <section className="trainings-shell">

      <section className="trainings-list-card">
        <CollaboratorsHeaderActions
          canCreateUser={canCreateUser}
          onCreateUser={openCreateModal}
          onImportUsers={openImportModal}
          onExportUsers={openExportModal}
        />

        <CollaboratorsFilterBar
          collaboratorQueryInputRef={collaboratorQueryInputRef}
          query={query}
          activeFilter={activeFilter}
          countryFilter={countryFilter}
          sortBy={sortBy}
          sortDirection={sortDirection}
          pageSize={pageSize}
          hasCustomFilters={hasCustomFilters}
          activeFilterTags={activeFilterTags}
          onQueryChange={(value) => {
            setPage(1);
            setQuery(value);
          }}
          onActiveFilterChange={(value) => {
            setPage(1);
            setActiveFilter(value);
          }}
          onCountryFilterChange={(value) => {
            setPage(1);
            setCountryFilter(value);
          }}
          onSortByChange={setSortBy}
          onSortDirectionChange={setSortDirection}
          onPageSizeChange={(value) => {
            setPage(1);
            setPageSize(value);
          }}
          onClearFilters={clearCollaboratorFilters}
        />

        <div className="collaborators-table">
          <DataTable
            columns={[
            { key: 'name', header: 'Colaborador', render: (item: CollaboratorRow) => <span className="collaborator-cell-text" title={getDisplayName(item)}>{getDisplayName(item)}</span> },
            { key: 'email', header: 'Email', render: (item: CollaboratorRow) => <span className="table-nowrap">{item.email}</span> },
            {
              key: 'team',
              header: 'Equipa',
              render: (item: CollaboratorRow) => {
                const teams = getCollaboratorTeams(item);

                return <CollaboratorTeamCell teams={teams} />;
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
              render: (item: CollaboratorRow) => {
                const displayName = getDisplayName(item);

                return (
                  <CollaboratorsRowActions
                    displayName={displayName}
                    isMenuOpen={actionsMenuState?.id === item.id}
                    onEdit={() => {
                      setActionsMenuState(null);
                      void openDetails(item);
                    }}
                    onToggleMore={(triggerElement) => {
                      if (actionsMenuState?.id === item.id) {
                        setActionsMenuState(null);
                        return;
                      }

                      const rect = triggerElement.getBoundingClientRect();
                      setActionsMenuState({
                        id: item.id,
                        top: rect.bottom + 4,
                        right: window.innerWidth - rect.right,
                        item,
                      });
                    }}
                  />
                );
              },
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

        <CollaboratorsPagination
          visibleTotal={visibleTotal}
          page={page}
          totalPages={totalPages}
          onPreviousPage={() => setPage((value) => Math.max(1, value - 1))}
          onNextPage={() => setPage((value) => Math.min(totalPages, value + 1))}
        />
      </section>

      <CollaboratorDetailsModal
        open={isDetailsOpen}
        title={selectedRow ? getDisplayName(selectedRow) : 'Colaborador'}
        selectedRow={selectedRow
          ? {
            username: selectedRow.username,
            email: selectedRow.email,
            isActive: selectedRow.isActive,
            updatedAt: selectedRow.updatedAt,
          }
          : null}
        detailsTab={detailsTab}
        onTabChange={setDetailsTab}
        canEditUser={canEditUser}
        isSavingEditDraft={isSavingEditDraft}
        onClose={closeDetails}
        onSaveDraft={() => void saveCollaboratorDraft()}
        selectedCollaboratorPhotoUrl={selectedCollaboratorPhotoUrl}
        selectedCollaboratorInitials={selectedCollaboratorInitials}
        selectedCollaboratorName={selectedCollaboratorName}
        collaboratorRoleLine={collaboratorRoleLine}
        selectedCollaboratorTeamName={selectedCollaboratorTeamName}
        collaboratorCompletion={collaboratorCompletion}
        collaboratorMissingFieldTotal={collaboratorMissingFieldTotal}
        detailsFichaSections={DETAILS_FICHA_SECTIONS}
        detailsFichaSection={detailsFichaSection}
        detailsFichaMissingCounts={detailsFichaMissingCounts}
        canEditCredentials={canEditCredentials}
        canManageProfileOptions={canManageProfileOptions}
        isSavingCredentials={isSavingCredentials}
        credentialsDraft={credentialsDraft}
        accountEditDraft={editDraft}
        collaboratorTeamOptions={collaboratorTeamOptions}
        activeProfileSectionView={activeProfileSectionView}
        onSelectFichaSection={setDetailsFichaSection}
        onPhotoChange={(event) => void handleCollaboratorFileChange('photoUrl', event)}
        onOpenProfileOption={(optionType) => void openProfileOptionModal(optionType)}
        onCredentialsDraftChange={(patch) => setCredentialsDraft((current) => ({ ...current, ...patch }))}
        onWorkCountryChange={(country) => setEditDraft((current) => ({
          ...current,
          workCountry: country,
          brWorkState: country === 'BR' ? current.brWorkState : '',
        }))}
        onTeamChange={(teamId) => setEditDraft((current) => ({ ...current, teamId }))}
        onActiveChange={(isActive) => setEditDraft((current) => ({ ...current, isActive }))}
        onSaveCredentials={() => void saveCredentials()}
        isLoadingDetails={isLoadingDetails}
        selectedUserAccessTotal={selectedUserAccessTotal}
        canManagePermissions={canManagePermissions}
        canToggleAccessTotal={Boolean(selectedRow && canManagePermissions && selectedRow.username !== 't.people')}
        isTogglingAccessTotal={isTogglingAccessTotal}
        onGrantAccessTotal={() => { void toggleAccessTotalForSelected(true); }}
        onRevokeAccessTotal={() => { void toggleAccessTotalForSelected(false); }}
        permissionCategories={permissionCategoryItems}
        activePermissionCategoryId={permissionCategory}
        onSelectPermissionCategory={(categoryId) => setPermissionCategory(categoryId as PermissionCategory)}
        permissionSearch={permissionSearch}
        onPermissionSearchChange={setPermissionSearch}
        permissionItems={filteredPermissionListItems}
        onSelectPermission={setSelectedPermissionId}
        selectedPermission={selectedPermission
          ? {
            id: selectedPermission.id,
            label: selectedPermission.label,
            description: selectedPermission.description,
            grantedByLabel: getGrantDisplayName(selectedPermission.assignment?.grantedBy),
          }
          : null}
        selectedPermissionEnabled={Boolean(selectedPermissionDraft?.enabled)}
        onSetSelectedPermissionEnabled={setSelectedPermissionEnabled}
        selectedRestrictionCountries={selectedRestrictionCountries}
        onToggleCountry={toggleSelectedPermissionCountry}
        pendingTeamToAdd={pendingTeamToAdd}
        onPendingTeamToAddChange={setPendingTeamToAdd}
        availableTeamsToAdd={availableTeamsToAdd}
        onAddTeamRestriction={() => addTeamRestriction(pendingTeamToAdd)}
        selectedRestrictedTeams={selectedRestrictedTeams}
        onRemoveTeamRestriction={removeTeamRestriction}
        selectedNotes={selectedPermissionDraft?.notes || ''}
        onNotesChange={setSelectedPermissionNotes}
        isSavingSelectedPermission={Boolean(selectedPermission && savingPermissionId === selectedPermission.id)}
        onSaveSelectedPermission={() => { if (selectedPermission) { void savePermission(selectedPermission); } }}
        canManageActive={canManageActive}
        cargoHistoryEntries={cargoHistoryEntries}
        onToggleActive={() => { if (selectedRow) { openActiveConfirm(selectedRow); } }}
      />

      <CollaboratorExportModal
        open={isExportModalOpen}
        isExportingWorkbook={isExportingWorkbook}
        isLoadingExportCandidates={isLoadingExportCandidates}
        exportSearch={exportSearch}
        exportCandidatesFiltered={exportCandidatesFiltered}
        selectedExportUserId={selectedExportUserId}
        selectedExportCandidate={selectedExportCandidate}
        onClose={() => setIsExportModalOpen(false)}
        onExport={() => {
          void exportSelectedCollaboratorWorkbook();
        }}
        onExportSearchChange={setExportSearch}
        onSelectExportUser={setSelectedExportUserId}
        getDisplayName={(candidate) => getDisplayName(candidate as CollaboratorRow)}
        getTeamName={(candidate) => getCollaboratorTeamInfo(candidate as CollaboratorRow).name}
      />

      {canCreateUser && (
        <CollaboratorsImportModal
          open={isImportModalOpen}
          isImportingUsers={isImportingUsers}
          isParsingImportFile={isParsingImportFile}
          importFileName={importFileName}
          importRows={importRows}
          importIssues={importIssues}
          importPreviewRows={importPreviewRows}
          importResults={importResults}
          importCreatedCount={importCreatedCount}
          importFailedCount={importFailedCount}
          importFileAccept={IMPORT_FILE_ACCEPT}
          onClose={closeImportModal}
          onImport={() => {
            void importUsersFromFile();
          }}
          onDownloadTemplate={() => {
            void downloadImportTemplate();
          }}
          onImportFileChange={(event) => {
            void handleImportFileChange(event);
          }}
        />
      )}

      <CollaboratorProfileOptionModal
        open={isProfileOptionModalOpen}
        profileOptionType={profileOptionType}
        profileOptionLabel={profileOptionLabel}
        profileOptionGroup={profileOptionGroup}
        isSavingProfileOption={isSavingProfileOption}
        onClose={() => setIsProfileOptionModalOpen(false)}
        onSave={() => void handleCreateProfileOption()}
        onTypeChange={setProfileOptionType}
        onLabelChange={setProfileOptionLabel}
        onGroupChange={setProfileOptionGroup}
      />

      <CollaboratorActiveConfirmModal
        target={activeConfirmTarget
          ? {
            id: activeConfirmTarget.id,
            isActive: activeConfirmTarget.isActive,
            displayName: getDisplayName(activeConfirmTarget),
          }
          : null}
        isBusy={Boolean(activeConfirmTarget && busyUserId === activeConfirmTarget.id)}
        onCancel={() => setActiveConfirmTarget(null)}
        onConfirm={() => {
          void confirmToggleActive();
        }}
      />

      <CollaboratorCountryChangeModal
        open={isCountryChangeModalOpen}
        pendingCountryChange={pendingCountryChange}
        onCancel={() => {
          setIsCountryChangeModalOpen(false);
          setPendingCountryChange(null);
        }}
        onConfirm={() => {
          void saveCollaboratorDraft(true);
        }}
      />

      {canCreateUser && (
        <CollaboratorCreateModal
          open={isCreateModalOpen}
          isCreatingUser={isCreatingUser}
          draft={newUserDraft}
          onClose={closeCreateModal}
          onSubmit={() => void createUser()}
          onDraftChange={updateNewUserDraft}
          canConfigureFormSettings={isRootAccess || isAccessTotal}
          onOpenFormSettings={() => { void openAdmissionFormSettingsFromCreateModal(); }}
        />
      )}

      <AdmissionFormSettingsModal
        open={isSettingsModalOpen}
        settingsCountry={settingsCountry}
        settingsDraftRequiredFields={settingsDraftRequiredFields}
        admissionSettings={admissionSettings}
        isSettingsSaving={isSettingsSaving || isSettingsLoading}
        settingsStatus={settingsStatus}
        onClose={() => {
          setIsSettingsModalOpen(false);
          setIsSettingsFlowFromCreateModal(false);
          setIsSaveAdmissionSettingsConfirmationOpen(false);
        }}
        onCountryChange={changeAdmissionSettingsCountry}
        onToggleField={toggleAdmissionRequiredField}
        onToggleInternshipPreset={toggleAdmissionInternshipPreset}
        onSave={requestSaveAdmissionSettings}
      />

      <Modal
        open={isSaveAdmissionSettingsConfirmationOpen}
        title="Guardar como padrão?"
        onClose={() => setIsSaveAdmissionSettingsConfirmationOpen(false)}
        width="min(520px, 92vw)"
        footer={(
          <div className="modal-footer-split">
            <Button type="button" variant="ghost" onClick={() => setIsSaveAdmissionSettingsConfirmationOpen(false)}>
              Não, só para agora
            </Button>
            <Button type="button" variant="primary" onClick={() => { void saveAdmissionSettingsFromCollaborators(true); }}>
              Sim, guardar como padrão
            </Button>
          </div>
        )}
      >
        <div style={{ display: 'grid', gap: 14 }}>
          <p style={{ margin: 0 }}>
            Quer guardar esta seleção de campos como padrão para futuros pedidos de admissão?
          </p>
          <p style={{ margin: 0, color: '#475569', fontSize: 13 }}>
            Se não, a configuração será guardada apenas para esta sessão.
          </p>
        </div>
      </Modal>

      <Modal
        open={isWorkHoursModalOpen}
        title="Configuração de horas de trabalho"
        onClose={() => setIsWorkHoursModalOpen(false)}
        width="760px"
        footer={(
          <div className="profile-dynamic-regime__footer">
            <Button type="button" variant="secondary" onClick={() => setIsWorkHoursModalOpen(false)}>
              Cancelar
            </Button>
            <Button type="button" variant="primary" onClick={applyWorkHoursModal}>
              Aplicar regime
            </Button>
          </div>
        )}
      >
        <div className="profile-dynamic-regime">
          <div className="profile-dynamic-regime__hero">
            <p>Define os dias ativos e os intervalos horários. O regime de contrato é calculado automaticamente.</p>
            <strong>{workHoursDraftTotal == null ? 'Configuração incompleta' : formatWeeklyHoursLabel(workHoursDraftTotal)}</strong>
          </div>
          <div className="profile-dynamic-regime__grid">
            {workHoursDraft.map((day) => (
              <article key={day.key} className={`profile-dynamic-regime__day${day.enabled ? ' is-enabled' : ''}`}>
                <label className="profile-dynamic-regime__toggle">
                  <input
                    type="checkbox"
                    checked={day.enabled}
                    onChange={(event) => handleWorkHoursDayToggle(day.key, event.target.checked)}
                  />
                  <span>{day.label}</span>
                </label>

                <div className="profile-dynamic-regime__times">
                  <input
                    type="time"
                    value={day.start}
                    disabled={!day.enabled}
                    onChange={(event) => handleWorkHoursTimeChange(day.key, 'start', event.target.value)}
                  />
                  <span>até</span>
                  <input
                    type="time"
                    value={day.end}
                    disabled={!day.enabled}
                    onChange={(event) => handleWorkHoursTimeChange(day.key, 'end', event.target.value)}
                  />
                </div>
              </article>
            ))}
          </div>
        </div>
      </Modal>

      <Toast show={Boolean(status)} tone={resolveStatusTone(status)} message={status} />

      {actionsMenuState && createPortal(
        <CollaboratorsActionsMenuPanel
          displayName={getDisplayName(actionsMenuState.item)}
          isActive={actionsMenuState.item.isActive}
          isBusy={busyUserId === actionsMenuState.item.id}
          canManagePermissions={canManagePermissions}
          canManageActive={canManageActive}
          top={actionsMenuState.top}
          right={actionsMenuState.right}
          onOpenPermissions={() => {
            setActionsMenuState(null);
            void openDetails(actionsMenuState.item, 'permissoes');
          }}
          onToggleActive={() => {
            const target = actionsMenuState.item;
            setActionsMenuState(null);
            openActiveConfirm(target);
          }}
        />,
        document.body,
      )}
    </section>
  );
}
