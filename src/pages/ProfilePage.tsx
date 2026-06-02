import { ChangeEvent, MouseEvent, CSSProperties, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import {
  estadoCivilOptions,
  generoOptions,
  habilitacoesOptions,
  irsJovemOptions,
  parentescoOptions,
  situacaoIrsOptions,
  tipoContratoOptions,
} from '../portal/data';
import { apiRequest, apiRequestCached, getApiBase, getBackendBase, authHeaders, isAbortError } from '../portal/api';
import { getStoredAuthToken } from '../portal/auth-storage';
import { usePortal } from '../portal/context';
import { useFeedbackToast } from '../portal/useFeedbackToast';
import { formatTrainingStatusLabel, getTrainingStatusTone } from '../portal/labels';
import { ProfileData, ProfileFieldError } from '../portal/types';
import Badge from '../components/ui/Badge';
import Button from '../components/ui/Button';
import Modal from '../components/ui/Modal';
import Toast from '../components/ui/Toast';

type SectionKey = 'personal' | 'contacts' | 'documents' | 'tax' | 'emergency' | 'contract' | 'trainings' | 'benefits';

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

function timeToMinutes(value: string) {
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

    const start = timeToMinutes(day.start);
    const end = timeToMinutes(day.end);
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

const profileSections: Array<{ key: SectionKey; label: string }> = [
  { key: 'personal', label: 'Dados Pessoais' },
  { key: 'contacts', label: 'Dados de Contacto' },
  { key: 'documents', label: 'Documentos de Identificação' },
  { key: 'tax', label: 'Dados Fiscais e Bancários' },
  { key: 'emergency', label: 'Contacto de Emergência' },
  { key: 'contract', label: 'Dados Contratuais' },
  { key: 'trainings', label: 'Dados de Formação' },
  { key: 'benefits', label: 'Pedido de Benefícios' },
];

const profileSectionFields: Record<SectionKey, Array<keyof ProfileData>> = {
  personal: [
    'nomeCompleto',
    'nomeAbreviado',
    'dataNascimento',
    'genero',
    'estadoCivil',
    'habilitacoesLiterarias',
    'curso',
    'faculdade',
    'nacionalidade',
    'localNascimentoPais',
    'localNascimentoCidade',
    'nomePai',
    'nomeMae',
    'matriculaCarro',
      'photoUrl',
  ],
  contacts: [
    'emailPessoal',
    'telemovel',
    'githubUser',
    'moradaFiscal',
    'endereco',
    'localidade',
    'codigoPostal',
  ],
  documents: [
    'cartaoCidadao',
    'validadeCartaoCidadao',
    'comprovativoCartaoCidadao',
      'certificadoHabilitacoesUrl',
      'cartaConducaoUrl',
    'criminalRecordUrl',
    'cpf',
    'rg',
    'rgOrgaoEmissor',
    'rgDataExpedicao',
    'ctps',
    'ctpsSerie',
    'ctpsDataExpedicao',
    'cnh',
    'cnhCategoria',
    'cnhDataValidade',
    'tituloEleitor',
    'zonaEleitoral',
    'secaoEleitoral',
    'certificadoReservista',
  ],
  tax: [
    'nif',
    'niss',
    'iban',
    'comprovativoIban',
    'situacaoIrs',
    'numeroDependentes',
    'declaracaoIrs',
    'irsJovem',
    'anoPrimeiroDesconto',
    'pis',
    'primeiroEmprego',
    'recebeAposentadoria',
    'recebeSeguroDesemprego',
    'valeTransporte',
    'comprovativoMoradaFiscal',
  ],
  emergency: [
    'contactoEmergenciaNome',
    'contactoEmergenciaParentesco',
    'contactoEmergenciaNumero',
  ],
  contract: [
    'workCountry',
    'brWorkState',
    'categoriaProfissional',
    'cargo',
    'numeroMecanografico',
    'funcao',
    'dataInicioContrato',
    'dataFimContrato',
    'tipoContrato',
    'regimeHorario',
    'horasSemanaisContrato',
  ],
  trainings: [],
  benefits: ['numeroCartaoContinente', 'voucherNosData', 'comprovativoCartaoContinente'],
};

type ProfileTrainingRecord = {
  id: string;
  nome: string;
  link: string;
  horas: number;
  dataInicio: string;
  entidade: string;
  dataConclusao: string;
  status?: string;
  createdAt: string;
  assignedBy?: {
    username: string;
    profile?: {
      nomeAbreviado?: string;
      nomeCompleto?: string;
    } | null;
  } | null;
};

type PaginatedRows<T> = {
  rows?: T[];
};

const profileFieldLabels: Partial<Record<keyof ProfileData, string>> = {
  nomeCompleto: 'Nome completo',
  nomeAbreviado: 'Nome abreviado',
  dataNascimento: 'Data de nascimento',
  genero: 'Género',
  estadoCivil: 'Estado civil',
  habilitacoesLiterarias: 'Habilitações literárias',
  curso: 'Curso',
  faculdade: 'Faculdade',
  nacionalidade: 'Nacionalidade',
  emailPessoal: 'Email pessoal',
  telemovel: 'Telemóvel',
  githubUser: 'Utilizador GitHub',
  moradaFiscal: 'Morada normal',
  endereco: 'Morada normal',
  localidade: 'Localidade',
  codigoPostal: 'Código postal',
  matriculaCarro: 'Matrícula do carro',
  localNascimentoPais: 'País de nascimento',
  localNascimentoCidade: 'Cidade de nascimento',
  nomePai: 'Nome do pai',
  nomeMae: 'Nome da mãe',
  cartaoCidadao: 'Cartão de cidadão',
  validadeCartaoCidadao: 'Validade do cartão de cidadão',
  nif: 'NIF',
  cpf: 'CPF',
  pis: 'PIS',
  ctps: 'CTPS',
  ctpsSerie: 'Série da CTPS',
  ctpsDataExpedicao: 'Data de expedição da CTPS',
  rg: 'RG',
  rgOrgaoEmissor: 'Órgão emissor do RG',
  rgDataExpedicao: 'Data de expedição do RG',
  cnh: 'CNH',
  cnhCategoria: 'Categoria da CNH',
  cnhDataValidade: 'Data de validade da CNH',
  tituloEleitor: 'Título de eleitor',
  zonaEleitoral: 'Zona eleitoral',
  secaoEleitoral: 'Seção eleitoral',
  certificadoReservista: 'Certificado de reservista',
  niss: 'NISS',
  iban: 'IBAN',
  situacaoIrs: 'Situação IRS',
  numeroDependentes: 'Número de dependentes',
  declaracaoIrs: 'Declaração IRS',
  irsJovem: 'IRS Jovem',
  anoPrimeiroDesconto: 'Ano do primeiro desconto',
  primeiroEmprego: 'Primeiro emprego',
  recebeAposentadoria: 'Recebe aposentadoria',
  recebeSeguroDesemprego: 'Recebe seguro de desemprego',
  valeTransporte: 'Vale transporte',
  numeroCartaoContinente: 'Número cartão continente',
  voucherNosData: 'Data último pedido voucher NOS',
  comprovativoMoradaFiscal: 'Comprovativo morada fiscal',
  comprovativoCartaoCidadao: 'Comprovativo cartão cidadão',
  comprovativoIban: 'Comprovativo IBAN',
  comprovativoCartaoContinente: 'Comprovativo cartão continente',
  contactoEmergenciaNome: 'Contacto de emergência - nome',
  contactoEmergenciaParentesco: 'Contacto de emergência - parentesco',
  contactoEmergenciaNumero: 'Contacto de emergência - número',
  cargo: 'Cargo',
  categoriaProfissional: 'Categoria profissional',
  numeroMecanografico: 'Número mecanográfico',
  funcao: 'Função',
  dataInicioContrato: 'Data de início do contrato',
  dataFimContrato: 'Data de fim do contrato',
  tipoContrato: 'Tipo de contrato',
  regimeHorario: 'Regime horário',
  horasSemanaisContrato: 'Horas semanais de contrato',
  workCountry: 'País de trabalho',
  brWorkState: 'Estado de trabalho (BR)',
    photoUrl: 'Foto de utilizador',
    certificadoHabilitacoesUrl: 'Certificado de habilitações',
    cartaConducaoUrl: 'Carta de condução',
    criminalRecordUrl: 'Registo criminal',
};

const consolidatedAddressFields: Array<keyof ProfileData> = ['moradaFiscal', 'endereco'];

type DropdownEntry = {
  label: string;
  group?: string;
};

type ProfileOptionType = 'CARGO' | 'FUNCAO';

type CustomProfileOption = {
  id: string;
  label: string;
  groupLabel?: string | null;
};

const defaultCargoOptions: DropdownEntry[] = [
  { label: 'Trainee' },
  { label: 'Junior' },
  { label: 'Associate' },
  { label: 'Senior' },
  { label: 'Lead' },
  { label: 'Principal' },
  { label: 'Director' },
  { label: 'C Level' },
];

const defaultFuncaoOptions: DropdownEntry[] = [
  { label: 'Administrative Assistant', group: 'Gestão e suporte' },
  { label: 'Business Analyst', group: 'Negócio e análise' },
  { label: 'Business Consultant', group: 'Negócio e análise' },
  { label: 'Business Controller', group: 'Negócio e análise' },
  { label: 'CEO', group: 'Direção' },
  { label: 'Communication Manager', group: 'Comunicação' },
  { label: 'Communication Specialist', group: 'Comunicação' },
  { label: 'Data Analyst', group: 'Dados e engenharia' },
  { label: 'Data Engineer', group: 'Dados e engenharia' },
  { label: 'Data Science Manager', group: 'Dados e engenharia' },
  { label: 'Data Scientist', group: 'Dados e engenharia' },
  { label: 'Delivery Director', group: 'Direção' },
  { label: 'Delivery Manager', group: 'Operações e delivery' },
  { label: 'DevOps Engineer', group: 'Dados e engenharia' },
  { label: 'DevOps Manager', group: 'Operações e delivery' },
  { label: 'Estagiario', group: 'Estágio' },
  { label: 'Managing Director', group: 'Direção' },
  { label: 'Operations & Control Director', group: 'Operações e control' },
  { label: 'Operations & Control Manager', group: 'Operações e control' },
  { label: 'People Director', group: 'Pessoas e cultura' },
  { label: 'People Manager', group: 'Pessoas e cultura' },
  { label: 'People Partner', group: 'Pessoas e cultura' },
  { label: 'Pre-Sales Consultant', group: 'Pré-venda e consultoria' },
  { label: 'Product Architect', group: 'Produto' },
  { label: 'Product Director', group: 'Produto' },
  { label: 'Product Manager', group: 'Produto' },
  { label: 'Product Owner', group: 'Produto' },
  { label: 'Project Manager', group: 'Gestão de projeto' },
  { label: 'Quality Analyst', group: 'Qualidade' },
  { label: 'Quality Manager', group: 'Qualidade' },
  { label: 'Sales Consultant', group: 'Comercial' },
  { label: 'Sales Director', group: 'Comercial' },
  { label: 'Sales Manager', group: 'Comercial' },
  { label: 'Scrum Master', group: 'Gestão de projeto' },
  { label: 'Service Analyst', group: 'Serviço' },
  { label: 'Service Director', group: 'Serviço' },
  { label: 'Service Engineer', group: 'Serviço' },
  { label: 'Service Manager', group: 'Serviço' },
  { label: 'Software Developer', group: 'Tecnologia' },
  { label: 'Software Engineer', group: 'Tecnologia' },
  { label: 'Strategic Solutions Consultant', group: 'Pré-venda e consultoria' },
  { label: 'Technical Consultant', group: 'Pré-venda e consultoria' },
  { label: 'UX UI Designer', group: 'Produto' },
];

function mergeDropdownOptions(baseOptions: DropdownEntry[], customOptions: CustomProfileOption[]) {
  const merged = new Map<string, DropdownEntry>();

  baseOptions.forEach((option) => {
    merged.set(option.label.trim().toLowerCase(), option);
  });

  customOptions.forEach((option) => {
    const normalized = option.label.trim().toLowerCase();
    if (!normalized || merged.has(normalized)) {
      return;
    }

    merged.set(normalized, {
      label: option.label,
      group: option.groupLabel || undefined,
    });
  });

  return Array.from(merged.values()).sort((a, b) => a.label.localeCompare(b.label, 'pt-PT'));
}

function renderFileLink(value: string) {
  if (!value) {
    return <em>Nenhum ficheiro selecionado</em>;
  }

  const isHttp = value.startsWith('http://') || value.startsWith('https://');
  const isRelativeUpload = value.startsWith('/uploads/');
  const href = isRelativeUpload ? `${getBackendBase()}${value}` : value;

  if (!isHttp && !isRelativeUpload) {
    return <em>{value}</em>;
  }

  return (
    <em>
      <a href={href} target="_blank" rel="noreferrer">
        Abrir comprovativo
      </a>
    </em>
  );
}

function normalizeProfileFileUrl(value: string) {
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

type SearchableDropdownProps = {
  label: string;
  value: string;
  placeholder: string;
  options: DropdownEntry[];
  columns?: 1 | 2;
  disabled?: boolean;
  onChange: (value: string) => void;
};

function SearchableDropdown({ label, value, placeholder, options, columns = 1, disabled = false, onChange }: SearchableDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [opensUpward, setOpensUpward] = useState(false);
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({});
  const containerRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const inputId = `${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-dropdown`;

  const selectedLabel = useMemo(() => {
    const found = options.find((option) => option.label === value);
    return found?.label || value || placeholder;
  }, [options, placeholder, value]);

  const filteredOptions = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) {
      return options;
    }

    return options.filter((option) => option.label.toLowerCase().includes(normalizedQuery) || option.group?.toLowerCase().includes(normalizedQuery));
  }, [options, query]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const updateMenuPosition = () => {
      const anchor = buttonRef.current;
      if (!anchor) {
        return;
      }

      const rect = anchor.getBoundingClientRect();
      const preferredWidth = Math.max(rect.width, columns === 2 ? 620 : 320);
      const maxWidth = Math.min(preferredWidth, window.innerWidth - 16);
      const availableBelow = window.innerHeight - rect.bottom - 20;
      const availableAbove = rect.top - 20;
      const estimatedMenuHeight = 420;
      const openAbove = availableBelow < estimatedMenuHeight && availableAbove > availableBelow;
      const availableSide = openAbove ? availableAbove : availableBelow;
      const panelHeight = Math.max(180, Math.min(430, availableSide));
      const top = openAbove ? Math.max(8, rect.top - panelHeight - 8) : rect.bottom + 8;
      const left = Math.min(rect.left, window.innerWidth - maxWidth - 8);

      setOpensUpward(openAbove);
      setMenuStyle({
        position: 'fixed',
        top,
        left: Math.max(8, left),
        width: maxWidth,
        height: panelHeight,
        maxHeight: panelHeight,
        overflow: 'hidden',
      });
    };

    updateMenuPosition();

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      const isInsideTrigger = Boolean(containerRef.current && target && containerRef.current.contains(target));
      const isInsideMenu = Boolean(menuRef.current && target && menuRef.current.contains(target));
      if (!isInsideTrigger && !isInsideMenu) {
        setIsOpen(false);
      }
    };

    const handleResizeOrScroll = () => updateMenuPosition();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('resize', handleResizeOrScroll);
    window.addEventListener('scroll', handleResizeOrScroll, true);
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('resize', handleResizeOrScroll);
      window.removeEventListener('scroll', handleResizeOrScroll, true);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [columns, isOpen]);

  const groupedOptions = useMemo(() => {
    const groups = new Map<string, DropdownEntry[]>();

    filteredOptions.forEach((option) => {
      const groupName = option.group || 'Opções';
      const entries = groups.get(groupName) || [];
      entries.push(option);
      groups.set(groupName, entries);
    });

    return Array.from(groups.entries()).map(([groupName, entries]) => ({ groupName, entries }));
  }, [filteredOptions]);

  return (
    <div className="profile-combobox" ref={containerRef}>
      <button
        ref={buttonRef}
        type="button"
        className={`profile-combobox__trigger${isOpen ? ' is-open' : ''}`}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls={inputId}
        onClick={() => {
          if (!disabled) {
            setIsOpen((current) => !current);
            setQuery('');
          }
        }}
      >
        <span className={`profile-combobox__value${!value ? ' is-placeholder' : ''}`}>{selectedLabel}</span>
        <span className="profile-combobox__chevron" aria-hidden="true">▾</span>
      </button>

      {isOpen && !disabled && createPortal(
        <div ref={menuRef} className={`profile-combobox__menu${opensUpward ? ' is-upward' : ''}`} style={menuStyle} role="listbox" id={inputId}>
          <div className="profile-combobox__search-wrap">
            <input
              className="profile-combobox__search"
              type="search"
              value={query}
              placeholder={`Procurar ${label.toLowerCase()}`}
              autoFocus
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>

          <div className={`profile-combobox__options${columns === 2 ? ' profile-combobox__options--two-cols' : ''}`}>
            {groupedOptions.length > 0 ? groupedOptions.map((group) => (
              <div key={group.groupName} className="profile-combobox__group">
                {group.groupName !== 'Opções' && <p>{group.groupName}</p>}
                <div className={`profile-combobox__group-items${columns === 2 ? ' profile-combobox__group-items--two-cols' : ''}`}>
                  {group.entries.map((option) => {
                    const isSelected = option.label === value;
                    return (
                      <button
                        key={`${group.groupName}-${option.label}`}
                        type="button"
                        className={`profile-combobox__option${isSelected ? ' is-selected' : ''}`}
                        onClick={() => {
                          onChange(option.label);
                          setIsOpen(false);
                          setQuery('');
                        }}
                      >
                        <span>{option.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )) : (
              <div className="profile-combobox__empty">Sem resultados para esta pesquisa.</div>
            )}
          </div>

          <div className="profile-combobox__footer">
            <button type="button" className="profile-combobox__close" onClick={() => setIsOpen(false)}>
              Fechar
            </button>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}

function validateProfile(profile: ProfileData, canEditContract: boolean = true): ProfileFieldError {
  const errors: ProfileFieldError = {};
  const isBrProfile = profile.workCountry === 'BR';

  const contractFields: Array<keyof ProfileData> = [
    'cargo',
    'categoriaProfissional',
    'funcao',
    'dataInicioContrato',
    'tipoContrato',
    'regimeHorario',
    'horasSemanaisContrato',
  ];

  const commonRequiredKeys: Array<keyof ProfileData> = [
    'nomeCompleto',
    'nomeAbreviado',
    'dataNascimento',
    'genero',
    'estadoCivil',
    'habilitacoesLiterarias',
    'emailPessoal',
    'telemovel',
    'moradaFiscal',
    'endereco',
    'localidade',
    'codigoPostal',
    'contactoEmergenciaNome',
    'contactoEmergenciaParentesco',
    'contactoEmergenciaNumero',
    'comprovativoMoradaFiscal',
    'comprovativoCartaoCidadao',
    'comprovativoIban',
    'comprovativoCartaoContinente',
    'photoUrl',
    'certificadoHabilitacoesUrl',
    'cartaConducaoUrl',
    'criminalRecordUrl',
    ...(canEditContract ? contractFields : []),
  ];

  const ptRequiredKeys: Array<keyof ProfileData> = [
    'cartaoCidadao',
    'nif',
    'niss',
    'iban',
    'situacaoIrs',
    'numeroDependentes',
    'declaracaoIrs',
    'irsJovem',
    'anoPrimeiroDesconto',
  ];

  const brRequiredKeys: Array<keyof ProfileData> = [
    'brWorkState',
    'localNascimentoPais',
    'localNascimentoCidade',
    'cpf',
    'pis',
    'ctps',
    'ctpsSerie',
    'ctpsDataExpedicao',
    'rg',
    'rgOrgaoEmissor',
    'rgDataExpedicao',
    'nomePai',
    'nomeMae',
  ];

  [...commonRequiredKeys, ...(isBrProfile ? brRequiredKeys : ptRequiredKeys)].forEach((key) => {
    if (!String(profile[key] ?? '').trim()) {
      errors[key] = 'Campo obrigatório.';
    }
  });

  if (profile.emailPessoal && !/^\S+@\S+\.\S+$/.test(profile.emailPessoal)) {
    errors.emailPessoal = 'Email inválido.';
  }

  if (!isBrProfile && profile.nif && !/^\d{9}$/.test(profile.nif)) {
    errors.nif = 'O NIF deve ter 9 dígitos.';
  }

  if (isBrProfile && profile.cpf && !/^\d{11}$/.test(profile.cpf)) {
    errors.cpf = 'CPF deve ter 11 dígitos.';
  }

  if (isBrProfile && profile.pis && !/^\d{11}$/.test(profile.pis)) {
    errors.pis = 'PIS deve ter 11 dígitos.';
  }

  if (isBrProfile && profile.codigoPostal && !/^\d{5}-?\d{3}$/.test(profile.codigoPostal)) {
    errors.codigoPostal = 'CEP inválido. Use 00000-000.';
  }

  if (!isBrProfile && profile.numeroDependentes && !/^\d+$/.test(profile.numeroDependentes)) {
    errors.numeroDependentes = 'Use apenas números inteiros.';
  }

  if (!isBrProfile && profile.anoPrimeiroDesconto && !/^\d{4}$/.test(profile.anoPrimeiroDesconto)) {
    errors.anoPrimeiroDesconto = 'Indique o ano com 4 dígitos.';
  }

  if (profile.horasSemanaisContrato) {
    const parsed = Number(profile.horasSemanaisContrato.replace(',', '.'));
    if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 80) {
      errors.horasSemanaisContrato = 'Indique um valor entre 1 e 80 horas.';
    }
  }

  return errors;
}

function formatPtDate(value: string) {
  if (!value) {
    return '-';
  }

  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (dateOnly) {
    return `${dateOnly[3]}/${dateOnly[2]}/${dateOnly[1]}`;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat('pt-PT', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(parsed);
}

function formatLocalDateOnly(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatTrainingHours(value: number) {
  return new Intl.NumberFormat('pt-PT', { maximumFractionDigits: 2, minimumFractionDigits: 0 }).format(value);
}

function resolveTrainingStartDate(record: ProfileTrainingRecord) {
  return record.dataInicio?.trim() || '';
}

function resolveTrainingOrigin(record: ProfileTrainingRecord) {
  const shortName = record.assignedBy?.profile?.nomeAbreviado?.trim() || '';
  if (shortName) {
    return shortName;
  }

  const fullName = record.assignedBy?.profile?.nomeCompleto?.trim() || '';

  return fullName || record.assignedBy?.username || 'Próprio';
}

export default function ProfilePage() {
  const { profile, saveProfile, setProfile, hasPermission, isRootAccess, isAccessTotal, currentUser } = usePortal();
  const navigate = useNavigate();

  const [draftProfile, setDraftProfile] = useState<ProfileData>(profile);
  const [editingSections, setEditingSections] = useState<Record<SectionKey, boolean>>({
    personal: false,
    contacts: false,
    documents: false,
    tax: false,
    emergency: false,
    contract: false,
    trainings: false,
    benefits: false,
  });
  const [profileErrors, setProfileErrors] = useState<ProfileFieldError>({});
  const { toast, showToast } = useFeedbackToast(3400);
  const [isSaving, setIsSaving] = useState(false);
  const [isAvatarLoadError, setIsAvatarLoadError] = useState(false);
  const [heroPhotoPreviewUrl, setHeroPhotoPreviewUrl] = useState('');
  const [currentSection, setCurrentSection] = useState<SectionKey>('personal');
  type PendingChangeDetail = { fieldKey: string; field: string; oldValue: string; newValue: string };
  const [hasPendingRequest, setHasPendingRequest] = useState(false);
  const [pendingRequestLabel, setPendingRequestLabel] = useState('');
  const [pendingRequestCreatedAt, setPendingRequestCreatedAt] = useState('');
  const [pendingChanges, setPendingChanges] = useState<string[]>([]);
  const [pendingChangeDetails, setPendingChangeDetails] = useState<PendingChangeDetail[]>([]);
  const [isPendingRequestSyncing, setIsPendingRequestSyncing] = useState(false);
  const [isPendingDetailOpen, setIsPendingDetailOpen] = useState(false);
  const [isRequestFeedbackOpen, setIsRequestFeedbackOpen] = useState(false);
  const [showSeparateAddresses, setShowSeparateAddresses] = useState(false);
  const [isCompletionHelpOpen, setIsCompletionHelpOpen] = useState(false);
  const [customCargoOptions, setCustomCargoOptions] = useState<CustomProfileOption[]>([]);
  const [customFuncaoOptions, setCustomFuncaoOptions] = useState<CustomProfileOption[]>([]);
  const [isProfileOptionModalOpen, setIsProfileOptionModalOpen] = useState(false);
  const [profileOptionType, setProfileOptionType] = useState<ProfileOptionType>('CARGO');
  const [profileOptionLabel, setProfileOptionLabel] = useState('');
  const [profileOptionGroup, setProfileOptionGroup] = useState('');
  const [isSavingProfileOption, setIsSavingProfileOption] = useState(false);
  const [isDynamicRegimeModalOpen, setIsDynamicRegimeModalOpen] = useState(false);
  const [dynamicRegimeDraft, setDynamicRegimeDraft] = useState<DynamicRegimeDay[]>(() => defaultDynamicRegimeDays.map((item) => ({ ...item })));
  const dynamicRegimeDraftWeeklyHours = useMemo(() => calculateWeeklyHoursFromDays(dynamicRegimeDraft), [dynamicRegimeDraft]);
  const [ownTrainings, setOwnTrainings] = useState<ProfileTrainingRecord[]>([]);
  const [isLoadingOwnTrainings, setIsLoadingOwnTrainings] = useState(false);
  const [ownTrainingsLoaded, setOwnTrainingsLoaded] = useState(false);
  const [ownTrainingsStatus, setOwnTrainingsStatus] = useState('');
  const [isRequestingVoucherNos, setIsRequestingVoucherNos] = useState(false);
  const localPhotoPreviewRef = useRef('');

  const canEdit =
    isRootAccess
    || hasPermission('edit_profile')
    || hasPermission('request_profile_change')
    || hasPermission('edit_other_profile');
  const canEditContract = isRootAccess || hasPermission('edit_other_profile');
  const requestMode = !isRootAccess && (isAccessTotal || hasPermission('request_profile_change') || !canEditContract);
  const canManageProfileOptions = isRootAccess || isAccessTotal || hasPermission('manage_profile_dropdown_options');
  const teamName = currentUser?.team?.name?.trim() || 'Sem equipa';

  const cargoOptions = useMemo(
    () => mergeDropdownOptions(defaultCargoOptions, customCargoOptions),
    [customCargoOptions],
  );

  const funcaoOptions = useMemo(
    () => mergeDropdownOptions(defaultFuncaoOptions, customFuncaoOptions),
    [customFuncaoOptions],
  );

  const profileCompletion = useMemo(() => {
    const fields = Object.values(draftProfile);
    const filled = fields.filter((item) => {
      if (typeof item === 'boolean') {
        return true;
      }

      return String(item ?? '').trim().length > 0;
    }).length;

    return Math.round((filled / fields.length) * 100);
  }, [draftProfile]);

  const completionIssues = useMemo(() => validateProfile(draftProfile, canEditContract), [canEditContract, draftProfile]);
  const completionIssueEntries = useMemo(
    () => Object.entries(completionIssues).map(([field, message]) => ({
      field: field as keyof ProfileData,
      label: profileFieldLabels[field as keyof ProfileData] ?? field,
      message,
    })),
    [completionIssues],
  );
  const completionIssueCount = completionIssueEntries.length;
  const completionIssueCountBySection = useMemo<Record<SectionKey, number>>(() => {
    const result = profileSections.reduce((acc, section) => {
      acc[section.key] = 0;
      return acc;
    }, {} as Record<SectionKey, number>);

    for (const issue of completionIssueEntries) {
      for (const section of profileSections) {
        if (profileSectionFields[section.key].includes(issue.field)) {
          result[section.key] += 1;
          break;
        }
      }
    }

    return result;
  }, [completionIssueEntries]);

  const collaboratorName = useMemo(() => `${draftProfile.nomeCompleto} ${draftProfile.nomeAbreviado}`.trim(), [draftProfile.nomeAbreviado, draftProfile.nomeCompleto]);
  const heroName = useMemo(
    () => draftProfile.nomeCompleto.trim() || draftProfile.nomeAbreviado.trim() || collaboratorName || 'Colaborador',
    [collaboratorName, draftProfile.nomeAbreviado, draftProfile.nomeCompleto],
  );
  const heroRoleLine = useMemo(() => {
    const cargo = draftProfile.cargo.trim() || 'Nível por definir';
    const funcao = draftProfile.funcao.trim() || 'Função por definir';
    return `${cargo} • ${funcao}`;
  }, [draftProfile.cargo, draftProfile.funcao]);
  const heroInitials = useMemo(() => {
    const parts = heroName
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
  }, [heroName]);
  const heroPhotoUrl = useMemo(() => normalizeProfileFileUrl(String(draftProfile.photoUrl || '')), [draftProfile.photoUrl]);

  useEffect(() => {
    setIsAvatarLoadError(false);
  }, [heroPhotoUrl]);

  useEffect(() => {
    const normalizedPhotoUrl = heroPhotoUrl.trim();
    if (!normalizedPhotoUrl) {
      setHeroPhotoPreviewUrl('');
      return;
    }

    let isCancelled = false;
    let objectUrl = '';

    const loadPhoto = async () => {
      try {
        const token = getStoredAuthToken();
        const response = await fetch(normalizedPhotoUrl, {
          headers: token ? authHeaders(token) : undefined,
        });

        if (!response.ok) {
          throw new Error('Falha ao carregar foto protegida.');
        }

        const blob = await response.blob();
        objectUrl = URL.createObjectURL(blob);

        if (isCancelled) {
          URL.revokeObjectURL(objectUrl);
          return;
        }

        setHeroPhotoPreviewUrl(objectUrl);
      } catch {
        if (!isCancelled) {
          setHeroPhotoPreviewUrl(normalizedPhotoUrl);
        }
      }
    };

    void loadPhoto();

    return () => {
      isCancelled = true;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [heroPhotoUrl]);

  useEffect(() => {
    return () => {
      if (localPhotoPreviewRef.current) {
        URL.revokeObjectURL(localPhotoPreviewRef.current);
        localPhotoPreviewRef.current = '';
      }
    };
  }, []);

  const contractCostCenter = useMemo(() => {
    return currentUser?.team?.costCenter?.trim() || '';
  }, [currentUser?.team?.costCenter]);
  const isBrProfile = draftProfile.workCountry === 'BR';
  const isSemTermoContract = useMemo(() => {
    const normalized = draftProfile.tipoContrato
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');

    return normalized === 'sem termo';
  }, [draftProfile.tipoContrato]);
  const voucherLastRequestDate = useMemo(() => {
    const normalized = draftProfile.voucherNosData.trim();
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(normalized);
    if (!match) {
      return null;
    }

    const parsed = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    if (Number.isNaN(parsed.getTime())) {
      return null;
    }

    return parsed;
  }, [draftProfile.voucherNosData]);
  const voucherNextEligibleDate = useMemo(() => {
    if (!voucherLastRequestDate) {
      return null;
    }

    const nextDate = new Date(voucherLastRequestDate);
    nextDate.setFullYear(nextDate.getFullYear() + 2);
    return nextDate;
  }, [voucherLastRequestDate]);
  const voucherIsInCooldown = useMemo(() => {
    if (!voucherNextEligibleDate) {
      return false;
    }

    const today = new Date();
    const todayDate = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    return todayDate < voucherNextEligibleDate;
  }, [voucherNextEligibleDate]);
  const isDynamicRegime = draftProfile.regimeHorario.startsWith(DYNAMIC_REGIME_PREFIX);
  const dynamicRegimeSummary = useMemo(() => summarizeDynamicRegime(draftProfile.regimeHorario), [draftProfile.regimeHorario]);
  const regimeContractValue = useMemo(() => {
    const direct = Number(draftProfile.horasSemanaisContrato.replace(',', '.'));
    if (Number.isFinite(direct) && direct > 0) {
      return formatWeeklyHoursLabel(direct);
    }

    if (isDynamicRegime) {
      const calculated = calculateWeeklyHoursFromDays(parseDynamicRegimeDays(draftProfile.regimeHorario));
      if (calculated != null) {
        return formatWeeklyHoursLabel(calculated);
      }
    }

    return '';
  }, [draftProfile.horasSemanaisContrato, draftProfile.regimeHorario, isDynamicRegime]);
  const hasUnsavedChanges = useMemo(() => JSON.stringify(draftProfile) !== JSON.stringify(profile), [draftProfile, profile]);
  const hasNonPhotoUnsavedChanges = useMemo(() => {
    const keys = Object.keys(draftProfile) as Array<keyof ProfileData>;

    return keys.some((key) => {
      if (key === 'photoUrl') {
        return false;
      }

      return String(draftProfile[key] ?? '').trim() !== String(profile[key] ?? '').trim();
    });
  }, [draftProfile, profile]);
  const effectiveRequestMode = requestMode && hasNonPhotoUnsavedChanges;
  const pendingRequestCreatedLabel = useMemo(() => {
    if (!pendingRequestCreatedAt) {
      return '';
    }

    const parsedDate = new Date(pendingRequestCreatedAt);
    if (Number.isNaN(parsedDate.getTime())) {
      return '';
    }

    return new Intl.DateTimeFormat('pt-PT', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(parsedDate);
  }, [pendingRequestCreatedAt]);
  const sortedOwnTrainings = useMemo(
    () => [...ownTrainings].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    [ownTrainings],
  );

  function buildPendingChangeDetailsFromProfileDiff(currentProfile: ProfileData, nextProfile: ProfileData): PendingChangeDetail[] {
    const keys = Object.keys(nextProfile) as Array<keyof ProfileData>;

    return keys
      .filter((key) => String(currentProfile[key] || '').trim() !== String(nextProfile[key] || '').trim())
      .map((key) => ({
        fieldKey: key,
        field: profileFieldLabels[key] ?? key,
        oldValue: String(currentProfile[key] || '').trim() || '(vazio)',
        newValue: String(nextProfile[key] || '').trim() || '(vazio)',
      }));
  }

  function applyPendingRequestPayload(payload: {
    pending?: boolean;
    request?: {
      changesSummary?: string;
      createdAt?: string;
      changeDetails?: Array<{ fieldKey: string; field: string; oldValue: string; newValue: string }>;
    } | null;
  }) {
    const pending = Boolean(payload.pending);
    setHasPendingRequest(pending);
    setPendingRequestLabel(pending ? payload.request?.changesSummary || 'Pedido de alteração em análise pela equipa RH.' : '');
    setPendingRequestCreatedAt(pending ? payload.request?.createdAt || '' : '');
    const details = payload.request?.changeDetails ?? [];
    setPendingChangeDetails(details);
    setPendingChanges(details.map((item) => item.field));
  }

  async function syncPendingRequestState(options?: { signal?: AbortSignal; forceRefresh?: boolean }) {
    const token = getStoredAuthToken();
    if (!token) {
      return;
    }

    setIsPendingRequestSyncing(true);
    try {
      const payload = await apiRequestCached<{
        pending?: boolean;
        request?: {
          changesSummary?: string;
          createdAt?: string;
          changeDetails?: Array<{ fieldKey: string; field: string; oldValue: string; newValue: string }>;
        } | null;
      }>('/profile/requests/me', {
        headers: authHeaders(token),
        signal: options?.signal,
      }, 15000, options?.forceRefresh === true);

      applyPendingRequestPayload(payload);
    } catch (error) {
      if (isAbortError(error) || options?.signal?.aborted) {
        return;
      }

      // Silencioso para não bloquear a edição da ficha se este fetch falhar.
    } finally {
      if (!options?.signal?.aborted) {
        setIsPendingRequestSyncing(false);
      }
    }
  }

  useEffect(() => {
    setDraftProfile(profile);
  }, [profile]);

  useEffect(() => {
    if (!draftProfile.regimeHorario.startsWith(DYNAMIC_REGIME_PREFIX)) {
      return;
    }

    setDynamicRegimeDraft(parseDynamicRegimeDays(draftProfile.regimeHorario));
  }, [draftProfile.regimeHorario]);

  useEffect(() => {
    if (!draftProfile.regimeHorario.startsWith(DYNAMIC_REGIME_PREFIX)) {
      return;
    }

    if (draftProfile.horasSemanaisContrato.trim()) {
      return;
    }

    const calculated = calculateWeeklyHoursFromDays(parseDynamicRegimeDays(draftProfile.regimeHorario));
    if (calculated == null) {
      return;
    }

    setDraftProfile((current) => ({
      ...current,
      horasSemanaisContrato: String(calculated),
    }));
  }, [draftProfile.horasSemanaisContrato, draftProfile.regimeHorario]);

  useEffect(() => {
    const hasDifferentAddress = profile.moradaFiscal.trim().length > 0
      && profile.endereco.trim().length > 0
      && profile.moradaFiscal.trim() !== profile.endereco.trim();
    setShowSeparateAddresses(hasDifferentAddress);
  }, [profile.endereco, profile.moradaFiscal]);

  useEffect(() => {
    const controller = new AbortController();
    void syncPendingRequestState({ signal: controller.signal });

    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!isPendingDetailOpen) {
      return;
    }

    if (pendingChangeDetails.length > 0) {
      return;
    }

    void syncPendingRequestState({ forceRefresh: true });
  }, [isPendingDetailOpen, pendingChangeDetails.length]);

  useEffect(() => {
    const token = getStoredAuthToken();
    if (!token) {
      return;
    }

    const controller = new AbortController();

    (async () => {
      try {
        const payload = await apiRequestCached<{
          cargo?: CustomProfileOption[];
          funcao?: CustomProfileOption[];
        }>('/profile/options', {
          headers: authHeaders(token),
          signal: controller.signal,
        }, 60000);

        setCustomCargoOptions(payload.cargo ?? []);
        setCustomFuncaoOptions(payload.funcao ?? []);
      } catch (error) {
        if (isAbortError(error) || controller.signal.aborted) {
          return;
        }

        setCustomCargoOptions([]);
        setCustomFuncaoOptions([]);
      }
    })();

    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (currentSection !== 'trainings' || ownTrainingsLoaded) {
      return;
    }

    const token = getStoredAuthToken();
    if (!token) {
      return;
    }

    const controller = new AbortController();
    let isActive = true;
    setIsLoadingOwnTrainings(true);
    setOwnTrainingsStatus('');

    (async () => {
      try {
        const data = await apiRequest<PaginatedRows<ProfileTrainingRecord>>('/trainings/me?page=1&pageSize=500', {
          headers: authHeaders(token),
          signal: controller.signal,
        });

        if (!isActive || controller.signal.aborted) {
          return;
        }

        setOwnTrainings(Array.isArray(data.rows) ? data.rows : []);
        setOwnTrainingsLoaded(true);
      } catch (error) {
        if (!isActive || isAbortError(error) || controller.signal.aborted) {
          return;
        }

        setOwnTrainingsStatus(error instanceof Error ? error.message : 'Falha ao carregar formações.');
      } finally {
        if (isActive) {
          setIsLoadingOwnTrainings(false);
        }
      }
    })();

    return () => {
      isActive = false;
      controller.abort();
    };
  }, [currentSection, ownTrainingsLoaded]);

  function closeAllEditingSections() {
    setEditingSections({
      personal: false,
      contacts: false,
      documents: false,
      tax: false,
      emergency: false,
      contract: false,
      trainings: false,
      benefits: false,
    });
  }

  function handleProfileChange(field: keyof ProfileData, value: string) {
    setDraftProfile((current) => {
      if (field === 'moradaFiscal' || field === 'endereco') {
        if (!showSeparateAddresses) {
          return { ...current, moradaFiscal: value, endereco: value };
        }

        if (field === 'moradaFiscal') {
          return { ...current, moradaFiscal: value };
        }

        return { ...current, endereco: value };
      }

      if (field === 'workCountry' && value !== 'BR') {
        return { ...current, workCountry: value as 'PT' | 'BR', brWorkState: '' };
      }

      return { ...current, [field]: value };
    });

    setProfileErrors((current) => {
      const updated = { ...current };
      if (!value.trim()) {
        updated[field] = 'Campo obrigatório.';
        return updated;
      }

      if (field === 'emailPessoal' && !/^\S+@\S+\.\S+$/.test(value)) {
        updated[field] = 'Email inválido.';
        return updated;
      }

      if (field === 'nif' && !/^\d{9}$/.test(value)) {
        updated[field] = 'O NIF deve ter 9 dígitos.';
        return updated;
      }

      if (field === 'numeroDependentes' && !/^\d+$/.test(value)) {
        updated[field] = 'Use apenas números inteiros.';
        return updated;
      }

      if (field === 'anoPrimeiroDesconto' && !/^\d{4}$/.test(value)) {
        updated[field] = 'Indique o ano com 4 dígitos.';
        return updated;
      }

      if (field === 'horasSemanaisContrato') {
        const parsed = Number(value.replace(',', '.'));
        if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 80) {
          updated[field] = 'Indique um valor entre 1 e 80 horas.';
          return updated;
        }
      }

      if ((field === 'moradaFiscal' || field === 'endereco') && !showSeparateAddresses) {
        delete updated.moradaFiscal;
        delete updated.endereco;
        return updated;
      }

      delete updated[field];
      return updated;
    });

    if ((field === 'moradaFiscal' || field === 'endereco') && !showSeparateAddresses) {
      setDraftProfile((current) => ({ ...current, moradaFiscal: value, endereco: value }));
    }

  }

  function handleProfileBooleanChange(
    field: 'primeiroEmprego' | 'recebeAposentadoria' | 'recebeSeguroDesemprego' | 'valeTransporte',
    value: boolean,
  ) {
    setDraftProfile((current) => ({ ...current, [field]: value }));

    setProfileErrors((current) => {
      const updated = { ...current };
      delete updated[field];
      return updated;
    });
  }

  function openDynamicRegimeModal() {
    const nextDraft = isDynamicRegime
      ? parseDynamicRegimeDays(draftProfile.regimeHorario)
      : defaultDynamicRegimeDays.map((item) => ({ ...item }));

    setDynamicRegimeDraft(nextDraft);
    setIsDynamicRegimeModalOpen(true);
  }

  function applyDynamicRegime() {
    const weeklyHours = calculateWeeklyHoursFromDays(dynamicRegimeDraft);
    if (weeklyHours == null) {
      showToast('error', 'Define pelo menos um dia ativo com hora de fim superior à hora de início.');
      return;
    }

    const serialized = serializeDynamicRegimeDays(dynamicRegimeDraft);
    handleProfileChange('regimeHorario', serialized);
    handleProfileChange('horasSemanaisContrato', String(weeklyHours));
    setIsDynamicRegimeModalOpen(false);
  }

  function handleDynamicRegimeDayToggle(dayKey: string, enabled: boolean) {
    setDynamicRegimeDraft((current) => current.map((item) => {
      if (item.key !== dayKey) {
        return item;
      }

      return {
        ...item,
        enabled,
      };
    }));
  }

  function handleDynamicRegimeTimeChange(dayKey: string, field: 'start' | 'end', value: string) {
    setDynamicRegimeDraft((current) => current.map((item) => {
      if (item.key !== dayKey) {
        return item;
      }

      return {
        ...item,
        [field]: value,
      };
    }));
  }

  function toggleAddressMode(separate: boolean) {
    setShowSeparateAddresses(separate);
    if (!separate) {
      setDraftProfile((current) => {
        const sharedValue = current.moradaFiscal.trim() || current.endereco.trim();
        return {
          ...current,
          moradaFiscal: sharedValue,
          endereco: sharedValue,
        };
      });
    }
  }

  function openProfileOptionModal(type: ProfileOptionType) {
    if (!canManageProfileOptions) {
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
      showToast('error', 'Indica um valor válido para adicionar.');
      return;
    }

    setIsSavingProfileOption(true);

    try {
      const payload = await apiRequest<{ option?: { id: string; type: ProfileOptionType; label: string; groupLabel?: string | null } }>('/profile/options', {
        method: 'POST',
        headers: authHeaders(token),
        body: JSON.stringify({
          type: profileOptionType,
          label: normalizedLabel,
          groupLabel: profileOptionType === 'FUNCAO' ? normalizedGroup : undefined,
        }),
      });

      const created = payload.option;
      if (!created) {
        showToast('error', 'Não foi possível guardar o valor.');
        return;
      }

      if (created.type === 'CARGO') {
        setCustomCargoOptions((current) => {
          if (current.some((item) => item.id === created.id)) {
            return current;
          }
          return [...current, { id: created.id, label: created.label, groupLabel: created.groupLabel }];
        });
        handleProfileChange('cargo', created.label);
      } else {
        setCustomFuncaoOptions((current) => {
          if (current.some((item) => item.id === created.id)) {
            return current;
          }
          return [...current, { id: created.id, label: created.label, groupLabel: created.groupLabel }];
        });
        handleProfileChange('funcao', created.label);
      }

      setIsProfileOptionModalOpen(false);
      showToast('success', 'Valor adicionado com sucesso.');
    } catch (error) {
      showToast('error', error instanceof Error ? error.message : 'Não foi possível adicionar o valor.');
    } finally {
      setIsSavingProfileOption(false);
    }
  }

  function goToPreviousSection() {
    const currentIndex = profileSections.findIndex((item) => item.key === currentSection);
    if (currentIndex > 0) {
      setCurrentSection(profileSections[currentIndex - 1].key);
    }
  }

  function goToNextSection() {
    const currentIndex = profileSections.findIndex((item) => item.key === currentSection);
    if (currentIndex < profileSections.length - 1) {
      setCurrentSection(profileSections[currentIndex + 1].key);
    }
  }

  async function handleFileChange(field: keyof ProfileData, event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) {
      handleProfileChange(field, '');
      return;
    }

    const token = getStoredAuthToken();
    if (!token) {
      showToast('error', 'Sessão inválida. Faz login novamente.');
      return;
    }

    const formData = new FormData();
    formData.append('file', file);

    if (field === 'photoUrl') {
      if (localPhotoPreviewRef.current) {
        URL.revokeObjectURL(localPhotoPreviewRef.current);
      }
      localPhotoPreviewRef.current = URL.createObjectURL(file);
      setHeroPhotoPreviewUrl(localPhotoPreviewRef.current);
      setIsAvatarLoadError(false);
    }

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
      const uploadedPath = payload.linkPath || payload.link || '';

      if (field === 'photoUrl') {
        const saveResponse = await apiRequest<ProfileData>('/profile/me/photo', {
          method: 'PUT',
          headers: authHeaders(token),
          body: JSON.stringify({ photoUrl: uploadedPath }),
        });

        setProfile(saveResponse);
        setDraftProfile((current) => ({
          ...current,
          photoUrl: String(saveResponse.photoUrl || uploadedPath),
        }));
        showToast('success', 'Foto de utilizador atualizada com sucesso.');
      } else {
        handleProfileChange(field, uploadedPath);
        showToast('success', 'Ficheiro carregado com sucesso.');
      }
    } catch (error) {
      showToast('error', error instanceof Error ? error.message : 'Falha ao carregar ficheiro.');
    }
  }

  function handleFileInputClick(event: MouseEvent<HTMLInputElement>) {
    // Clear current browser-level selection so the same file can be chosen again.
    event.currentTarget.value = '';
  }

  function toggleSectionEdit(section: SectionKey) {
    if (!canEdit) {
      return;
    }

    setEditingSections((current) => {
      const nextIsEditing = !current[section];
      return { ...current, [section]: nextIsEditing };
    });
  }

  async function handleSaveChanges() {
    if (!canEdit || isSaving || !hasUnsavedChanges) {
      return;
    }

    const errors = validateProfile(draftProfile, canEditContract);
    setProfileErrors(errors);

    if (Object.keys(errors).length > 0) {
      showToast('error', 'Revise os campos destacados antes de submeter.');
      return;
    }

    setIsSaving(true);

    const result = await saveProfile(draftProfile);
    setIsSaving(false);

    if (!result.success) {
      showToast('error', result.message || 'Não foi possível submeter o pedido agora.');
      return;
    }

    if (result.pending) {
      const immediateDetails = buildPendingChangeDetailsFromProfileDiff(profile, draftProfile);
      setHasPendingRequest(true);
      setPendingRequestLabel(result.message || 'Pedido enviado para aprovação.');
      setPendingRequestCreatedAt(new Date().toISOString());
      setPendingChangeDetails(immediateDetails);
      setPendingChanges(immediateDetails.map((item) => item.field));
      setDraftProfile(profile);
      closeAllEditingSections();
      setIsRequestFeedbackOpen(true);
      void syncPendingRequestState({ forceRefresh: true });
      return;
    }

    showToast('success', result.message || 'Alterações guardadas com sucesso.');
  }

  async function handleVoucherNosRequest() {
    if (isRequestingVoucherNos) {
      return;
    }

    if (!isSemTermoContract) {
      showToast('error', 'O voucher NOS só pode ser pedido por colaboradores com contrato sem termo.');
      return;
    }

    if (voucherIsInCooldown && voucherNextEligibleDate) {
      showToast('error', `Novo pedido disponível em ${formatPtDate(formatLocalDateOnly(voucherNextEligibleDate))}.`);
      return;
    }

    const token = getStoredAuthToken();
    if (!token) {
      showToast('error', 'Sessão inválida. Faz login novamente.');
      return;
    }

    setIsRequestingVoucherNos(true);

    try {
      const response = await apiRequest<{ message?: string; lastRequestDate?: string }>('/profile/me/voucher-nos/request', {
        method: 'POST',
        headers: authHeaders(token),
      });

      const lastRequestDate = response.lastRequestDate || formatLocalDateOnly(new Date());
      const nextProfile = {
        ...draftProfile,
        voucherNosData: lastRequestDate,
      };

      setDraftProfile(nextProfile);
      setProfile(nextProfile);
      showToast('success', response.message || 'Pedido de voucher NOS enviado para t.people.');
    } catch (error) {
      showToast('error', error instanceof Error ? error.message : 'Não foi possível emitir o voucher NOS.');
    } finally {
      setIsRequestingVoucherNos(false);
    }
  }

  return (
    <>
      <section className="profile-hero">
        <div className="hero-main">
          <div className="profile-hero__identity">
            <div className="profile-hero__avatar-wrap">
              {heroPhotoPreviewUrl && !isAvatarLoadError ? (
                <img
                  src={heroPhotoPreviewUrl}
                  alt="Foto de utilizador"
                  className="profile-hero__avatar"
                  onError={() => setIsAvatarLoadError(true)}
                />
              ) : (
                <span className="profile-hero__avatar profile-hero__avatar--fallback" aria-hidden="true">{heroInitials}</span>
              )}
              {canEdit && (
                <label className="profile-hero__avatar-edit" title="Editar foto de utilizador" aria-label="Editar foto de utilizador">
                  ✎
                  <input
                    type="file"
                    accept="image/*"
                    disabled={isSaving}
                    onClick={handleFileInputClick}
                    onChange={(event) => handleFileChange('photoUrl', event)}
                  />
                </label>
              )}
            </div>
            <div className="profile-hero__identity-copy">
              <h1>{heroName}</h1>
              <p className="profile-hero__role-line">{heroRoleLine}</p>
              <div className="profile-hero__meta">
                <span>{teamName}</span>
                <span>{draftProfile.workCountry || 'PT'}</span>
                {draftProfile.workCountry === 'BR' && draftProfile.brWorkState && <span>{draftProfile.brWorkState}</span>}
              </div>
            </div>
          </div>
        </div>

        <div className="completion-card completion-card--highlight">
          <p>Completude da ficha</p>
          <strong>{profileCompletion}%</strong>
          <div className="completion-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={profileCompletion}>
            <span style={{ width: `${profileCompletion}%` }} />
          </div>
          <div className="completion-card__footer">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="completion-card__button"
              onClick={() => setIsCompletionHelpOpen(true)}
            >
              <span className="completion-card__button-label">Checklist</span>
              <span className="completion-card__button-count">{completionIssueCount}</span>
            </Button>
          </div>
        </div>
      </section>

      {hasPendingRequest && (
        <section className="profile-request-banner" role="status" aria-live="polite">
          <div className="profile-request-banner__inner">
            <div className="profile-request-banner__content">
              <span className="profile-request-banner__chip">Em análise</span>
              <strong>Pedido de atualização da ficha</strong>
              <span>{pendingChanges.length > 0 ? `${pendingChanges.length} alteração(ões) aguardam aprovação` : 'A aguardar aprovação pela equipa RH'}</span>
            </div>
            <button
              type="button"
              className="profile-request-banner__btn"
              onClick={() => setIsPendingDetailOpen(true)}
            >
              Ver pedido
            </button>
          </div>
        </section>
      )}

      {isPendingDetailOpen && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="pending-modal-title" onClick={(e) => { if (e.target === e.currentTarget) setIsPendingDetailOpen(false); }}>
          <div className="pending-modal">
            <div className="pending-modal__header">
              <div>
                <p className="pending-modal__kicker">Ficha colaborador</p>
                <h2 id="pending-modal-title">Pedido em análise</h2>
              </div>
              <button type="button" className="pending-modal__close" onClick={() => setIsPendingDetailOpen(false)} aria-label="Fechar">×</button>
            </div>
            <p className="pending-modal__sub">Alterações submetidas e pendentes de aprovação pela equipa RH.</p>
            <div className="pending-modal__summary" aria-live="polite">
              <span className="pending-modal__summary-item">{pendingChangeDetails.length} alteração(ões)</span>
              {pendingRequestCreatedLabel && <span className="pending-modal__summary-item">Submetido em {pendingRequestCreatedLabel}</span>}
              {isPendingRequestSyncing && <span className="pending-modal__summary-item pending-modal__summary-item--sync">A sincronizar detalhes...</span>}
            </div>
            {pendingChangeDetails.length > 0 ? (
              <div className="pending-modal__table-wrap">
                <table className="pending-modal__table">
                  <thead>
                    <tr>
                      <th>Campo</th>
                      <th>Valor anterior</th>
                      <th>Novo valor</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pendingChangeDetails.map((detail) => (
                      <tr key={detail.fieldKey}>
                        <td className="pending-modal__field">{detail.field}</td>
                        <td className="pending-modal__old">{detail.oldValue}</td>
                        <td className="pending-modal__new">{detail.newValue}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="pending-modal__empty">Ainda a sincronizar os detalhes do pedido. Tente novamente dentro de alguns segundos.</p>
            )}
            <div className="pending-modal__footer">
              <button type="button" className="pending-modal__dismiss" onClick={() => setIsPendingDetailOpen(false)}>Fechar</button>
            </div>
          </div>
        </div>
      )}

      <nav className="profile-stepper" aria-label="Navegação por etapas da ficha">
        {profileSections.map((section) => (
          <button
            key={section.key}
            type="button"
            className={`profile-stepper__item${currentSection === section.key ? ' is-active' : ''}`}
            onClick={() => setCurrentSection(section.key)}
          >
            <span className="profile-stepper__label">{section.label}</span>
            {completionIssueCountBySection[section.key] > 0 && (
              <span className="profile-stepper__count" aria-label={`${completionIssueCountBySection[section.key]} campo(s) pendente(s)`}>
                {completionIssueCountBySection[section.key]}
              </span>
            )}
          </button>
        ))}
      </nav>

      <div className="profile-stepper-actions profile-stepper-actions--fixed">
        <Button type="button" variant="ghost" onClick={goToPreviousSection} disabled={currentSection === profileSections[0].key}>Etapa anterior</Button>
        <Button type="button" variant="primary" onClick={goToNextSection} disabled={currentSection === profileSections[profileSections.length - 1].key}>Próxima etapa</Button>
      </div>

      <section className="profile-grid">
        {currentSection === 'personal' && (
        <article className="profile-card profile-card--full">
          <div className="section-headline">
            <h2>1. Dados Pessoais</h2>
            {canEdit && (
              <button className={`section-edit-button${editingSections.personal ? ' is-active' : ''}`} type="button" onClick={() => toggleSectionEdit('personal')}>
                ✏️
              </button>
            )}
          </div>
          <div className="profile-fields profile-fields--2">
            <label>
              <span>Nome completo</span>
              <input type="text" value={draftProfile.nomeCompleto} disabled={!editingSections.personal} onChange={(event) => handleProfileChange('nomeCompleto', event.target.value)} />
              {profileErrors.nomeCompleto && <small>{profileErrors.nomeCompleto}</small>}
            </label>
            <label>
              <span>Nome abreviado</span>
              <input type="text" value={draftProfile.nomeAbreviado} disabled={!editingSections.personal} onChange={(event) => handleProfileChange('nomeAbreviado', event.target.value)} />
              {profileErrors.nomeAbreviado && <small>{profileErrors.nomeAbreviado}</small>}
            </label>
            <label>
              <span>Data de nascimento</span>
              <input type="date" value={draftProfile.dataNascimento} disabled={!editingSections.personal} onChange={(event) => handleProfileChange('dataNascimento', event.target.value)} />
              {profileErrors.dataNascimento && <small>{profileErrors.dataNascimento}</small>}
            </label>
            <label>
              <span>Género</span>
              <select value={draftProfile.genero} disabled={!editingSections.personal} onChange={(event) => handleProfileChange('genero', event.target.value)}>
                <option value="">Selecionar</option>
                {generoOptions.map((option) => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>
              {profileErrors.genero && <small>{profileErrors.genero}</small>}
            </label>
            <label>
              <span>Habilitações literárias</span>
              <select value={draftProfile.habilitacoesLiterarias} disabled={!editingSections.personal} onChange={(event) => handleProfileChange('habilitacoesLiterarias', event.target.value)}>
                <option value="">Selecionar</option>
                {habilitacoesOptions.map((option) => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>
              {profileErrors.habilitacoesLiterarias && <small>{profileErrors.habilitacoesLiterarias}</small>}
            </label>
            <label>
              <span>Curso</span>
              <input type="text" value={draftProfile.curso} disabled={!editingSections.personal} onChange={(event) => handleProfileChange('curso', event.target.value)} />
            </label>
            <label>
              <span>Faculdade</span>
              <input type="text" value={draftProfile.faculdade} disabled={!editingSections.personal} onChange={(event) => handleProfileChange('faculdade', event.target.value)} />
            </label>
            <label>
              <span>Nacionalidade</span>
              <input type="text" value={draftProfile.nacionalidade} disabled={!editingSections.personal} onChange={(event) => handleProfileChange('nacionalidade', event.target.value)} />
            </label>
            {isBrProfile && (
              <>
                <label>
                  <span>Estado de trabalho (BR)</span>
                  <select value={draftProfile.brWorkState} disabled={!editingSections.personal} onChange={(event) => handleProfileChange('brWorkState', event.target.value)}>
                    <option value="">Selecionar</option>
                    <option value="SP">São Paulo (SP)</option>
                    <option value="RS">Rio Grande do Sul (RS)</option>
                  </select>
                  {profileErrors.brWorkState && <small>{profileErrors.brWorkState}</small>}
                </label>
                <label>
                  <span>País de nascimento</span>
                  <input type="text" value={draftProfile.localNascimentoPais} disabled={!editingSections.personal} onChange={(event) => handleProfileChange('localNascimentoPais', event.target.value)} />
                  {profileErrors.localNascimentoPais && <small>{profileErrors.localNascimentoPais}</small>}
                </label>
                <label>
                  <span>Cidade de nascimento</span>
                  <input type="text" value={draftProfile.localNascimentoCidade} disabled={!editingSections.personal} onChange={(event) => handleProfileChange('localNascimentoCidade', event.target.value)} />
                  {profileErrors.localNascimentoCidade && <small>{profileErrors.localNascimentoCidade}</small>}
                </label>
                <label>
                  <span>Nome do pai</span>
                  <input type="text" value={draftProfile.nomePai} disabled={!editingSections.personal} onChange={(event) => handleProfileChange('nomePai', event.target.value)} />
                  {profileErrors.nomePai && <small>{profileErrors.nomePai}</small>}
                </label>
                <label>
                  <span>Nome da mãe</span>
                  <input type="text" value={draftProfile.nomeMae} disabled={!editingSections.personal} onChange={(event) => handleProfileChange('nomeMae', event.target.value)} />
                  {profileErrors.nomeMae && <small>{profileErrors.nomeMae}</small>}
                </label>
              </>
            )}
            <label>
              <span>Email pessoal</span>
              <input type="email" value={draftProfile.emailPessoal} disabled={!editingSections.personal} onChange={(event) => handleProfileChange('emailPessoal', event.target.value)} />
              {profileErrors.emailPessoal && <small>{profileErrors.emailPessoal}</small>}
            </label>
            <label>
              <span>{isBrProfile ? 'Contacto telefónico' : 'Telemóvel'}</span>
              <input type="text" value={draftProfile.telemovel} disabled={!editingSections.personal} onChange={(event) => handleProfileChange('telemovel', event.target.value)} />
              {profileErrors.telemovel && <small>{profileErrors.telemovel}</small>}
            </label>
            <label>
              <span>GitHub (se aplicável)</span>
              <input type="text" value={draftProfile.githubUser} disabled={!editingSections.personal} onChange={(event) => handleProfileChange('githubUser', event.target.value)} placeholder="username" />
            </label>
            {!isBrProfile && (
              <label>
                <span>Matrícula do carro</span>
                <input type="text" value={draftProfile.matriculaCarro} disabled={!editingSections.personal} onChange={(event) => handleProfileChange('matriculaCarro', event.target.value)} />
              </label>
            )}
          </div>
        </article>
        )}

        {currentSection === 'contacts' && (
        <article className="profile-card profile-card--full">
          <div className="section-headline">
            <h2>2. Dados de Contacto</h2>
            {canEdit && (
              <button className={`section-edit-button${editingSections.contacts ? ' is-active' : ''}`} type="button" onClick={() => toggleSectionEdit('contacts')}>
                ✏️
              </button>
            )}
          </div>
          <div className="profile-fields profile-fields--3">
            <div className="profile-address-switch field-span-3">
              <div className="profile-address-switch__copy">
                <span>Morada fiscal e endereço são diferentes?</span>
              </div>
              <div className="profile-address-switch__actions" role="group" aria-label="Morada fiscal e endereço são diferentes?">
                <Button
                  type="button"
                  variant={showSeparateAddresses ? 'primary' : 'ghost'}
                  size="sm"
                  disabled={!editingSections.contacts}
                  onClick={() => toggleAddressMode(true)}
                >
                  Sim, são diferentes
                </Button>
                <Button
                  type="button"
                  variant={!showSeparateAddresses ? 'primary' : 'ghost'}
                  size="sm"
                  disabled={!editingSections.contacts}
                  onClick={() => toggleAddressMode(false)}
                >
                  Não, é a mesma morada
                </Button>
              </div>
            </div>
            {showSeparateAddresses ? (
              <>
                <label className="field-span-3">
                  <span>Morada fiscal</span>
                  <input type="text" value={draftProfile.moradaFiscal} disabled={!editingSections.contacts} onChange={(event) => handleProfileChange('moradaFiscal', event.target.value)} />
                  {profileErrors.moradaFiscal && <small>{profileErrors.moradaFiscal}</small>}
                </label>
                <label className="field-span-3">
                  <span>Endereço</span>
                  <input type="text" value={draftProfile.endereco} disabled={!editingSections.contacts} onChange={(event) => handleProfileChange('endereco', event.target.value)} />
                  {profileErrors.endereco && <small>{profileErrors.endereco}</small>}
                </label>
              </>
            ) : (
              <label className="field-span-3">
                <span>Morada</span>
                <input type="text" value={draftProfile.moradaFiscal || draftProfile.endereco} disabled={!editingSections.contacts} onChange={(event) => handleProfileChange('moradaFiscal', event.target.value)} />
                <small>Esta morada é usada para ambos os campos.</small>
                {profileErrors.moradaFiscal && <small>{profileErrors.moradaFiscal}</small>}
                {profileErrors.endereco && <small>{profileErrors.endereco}</small>}
              </label>
            )}
            <label>
              <span>Localidade</span>
              <input type="text" value={draftProfile.localidade} disabled={!editingSections.contacts} onChange={(event) => handleProfileChange('localidade', event.target.value)} />
              {profileErrors.localidade && <small>{profileErrors.localidade}</small>}
            </label>
            <label>
              <span>{isBrProfile ? 'CEP' : 'Código postal'}</span>
              <input type="text" value={draftProfile.codigoPostal} disabled={!editingSections.contacts} onChange={(event) => handleProfileChange('codigoPostal', event.target.value)} />
              {profileErrors.codigoPostal && <small>{profileErrors.codigoPostal}</small>}
            </label>
            <label>
              <span>Comprovativo morada fiscal (PDF/JPG)</span>
              <input
                type="file"
                accept=".pdf,.jpg,.jpeg"
                disabled={!editingSections.contacts}
                onClick={handleFileInputClick}
                onChange={(event) => handleFileChange('comprovativoMoradaFiscal', event)}
              />
              {renderFileLink(draftProfile.comprovativoMoradaFiscal)}
              {profileErrors.comprovativoMoradaFiscal && <small>{profileErrors.comprovativoMoradaFiscal}</small>}
            </label>
          </div>
        </article>
        )}

        {currentSection === 'documents' && (
        <article className="profile-card">
          <div className="section-headline">
            <h2>3. Documentos de Identificação</h2>
            {canEdit && (
              <button className={`section-edit-button${editingSections.documents ? ' is-active' : ''}`} type="button" onClick={() => toggleSectionEdit('documents')}>
                ✏️
              </button>
            )}
          </div>
          <div className="profile-fields">
            {!isBrProfile ? (
              <>
                <label>
                  <span>Cartão Cidadão</span>
                  <input type="text" value={draftProfile.cartaoCidadao} disabled={!editingSections.documents} onChange={(event) => handleProfileChange('cartaoCidadao', event.target.value)} />
                  {profileErrors.cartaoCidadao && <small>{profileErrors.cartaoCidadao}</small>}
                </label>
                <label>
                  <span>Validade do cartão de cidadão</span>
                  <input type="date" value={draftProfile.validadeCartaoCidadao} disabled={!editingSections.documents} onChange={(event) => handleProfileChange('validadeCartaoCidadao', event.target.value)} />
                </label>
              </>
            ) : (
              <>
                <label>
                  <span>RG</span>
                  <input type="text" value={draftProfile.rg} disabled={!editingSections.documents} onChange={(event) => handleProfileChange('rg', event.target.value)} />
                  {profileErrors.rg && <small>{profileErrors.rg}</small>}
                </label>
                <label>
                  <span>Órgão emissor (RG)</span>
                  <input type="text" value={draftProfile.rgOrgaoEmissor} disabled={!editingSections.documents} onChange={(event) => handleProfileChange('rgOrgaoEmissor', event.target.value)} />
                  {profileErrors.rgOrgaoEmissor && <small>{profileErrors.rgOrgaoEmissor}</small>}
                </label>
                <label>
                  <span>Data expedição (RG)</span>
                  <input type="date" value={draftProfile.rgDataExpedicao} disabled={!editingSections.documents} onChange={(event) => handleProfileChange('rgDataExpedicao', event.target.value)} />
                  {profileErrors.rgDataExpedicao && <small>{profileErrors.rgDataExpedicao}</small>}
                </label>
                <label>
                  <span>CTPS</span>
                  <input type="text" value={draftProfile.ctps} disabled={!editingSections.documents} onChange={(event) => handleProfileChange('ctps', event.target.value)} />
                  {profileErrors.ctps && <small>{profileErrors.ctps}</small>}
                </label>
                <label>
                  <span>Série (CTPS)</span>
                  <input type="text" value={draftProfile.ctpsSerie} disabled={!editingSections.documents} onChange={(event) => handleProfileChange('ctpsSerie', event.target.value)} />
                  {profileErrors.ctpsSerie && <small>{profileErrors.ctpsSerie}</small>}
                </label>
                <label>
                  <span>Data expedição (CTPS)</span>
                  <input type="date" value={draftProfile.ctpsDataExpedicao} disabled={!editingSections.documents} onChange={(event) => handleProfileChange('ctpsDataExpedicao', event.target.value)} />
                  {profileErrors.ctpsDataExpedicao && <small>{profileErrors.ctpsDataExpedicao}</small>}
                </label>
                <label>
                  <span>CNH</span>
                  <input type="text" value={draftProfile.cnh} disabled={!editingSections.documents} onChange={(event) => handleProfileChange('cnh', event.target.value)} />
                </label>
                <label>
                  <span>Categoria (CNH)</span>
                  <input type="text" value={draftProfile.cnhCategoria} disabled={!editingSections.documents} onChange={(event) => handleProfileChange('cnhCategoria', event.target.value)} />
                </label>
                <label>
                  <span>Validade (CNH)</span>
                  <input type="date" value={draftProfile.cnhDataValidade} disabled={!editingSections.documents} onChange={(event) => handleProfileChange('cnhDataValidade', event.target.value)} />
                </label>
                <label>
                  <span>Título de eleitor</span>
                  <input type="text" value={draftProfile.tituloEleitor} disabled={!editingSections.documents} onChange={(event) => handleProfileChange('tituloEleitor', event.target.value)} />
                </label>
                <label>
                  <span>Zona eleitoral</span>
                  <input type="text" value={draftProfile.zonaEleitoral} disabled={!editingSections.documents} onChange={(event) => handleProfileChange('zonaEleitoral', event.target.value)} />
                </label>
                <label>
                  <span>Seção eleitoral</span>
                  <input type="text" value={draftProfile.secaoEleitoral} disabled={!editingSections.documents} onChange={(event) => handleProfileChange('secaoEleitoral', event.target.value)} />
                </label>
                <label>
                  <span>Certificado de reservista</span>
                  <input type="text" value={draftProfile.certificadoReservista} disabled={!editingSections.documents} onChange={(event) => handleProfileChange('certificadoReservista', event.target.value)} />
                </label>
              </>
            )}
            <label className="field-span-2">
              <span>{isBrProfile ? 'Comprovativo documento de identificação (PDF/JPG)' : 'Comprovativo cartão cidadão (PDF/JPG)'}</span>
              <input
                type="file"
                accept=".pdf,.jpg,.jpeg"
                disabled={!editingSections.documents}
                onClick={handleFileInputClick}
                onChange={(event) => handleFileChange('comprovativoCartaoCidadao', event)}
              />
              {renderFileLink(draftProfile.comprovativoCartaoCidadao)}
              {profileErrors.comprovativoCartaoCidadao && <small>{profileErrors.comprovativoCartaoCidadao}</small>}
            </label>
              {!isBrProfile && (
                <>
                  <label className="field-span-2">
                    <span>Certificado de habilitações (PDF/JPG)</span>
                    <input
                      type="file"
                      accept=".pdf,.jpg,.jpeg"
                      disabled={!editingSections.documents}
                      onClick={handleFileInputClick}
                      onChange={(event) => handleFileChange('certificadoHabilitacoesUrl', event)}
                    />
                    {renderFileLink(draftProfile.certificadoHabilitacoesUrl)}
                  </label>
                  <label className="field-span-2">
                    <span>Carta de condução (opcional) (PDF/JPG)</span>
                    <input
                      type="file"
                      accept=".pdf,.jpg,.jpeg"
                      disabled={!editingSections.documents}
                      onClick={handleFileInputClick}
                      onChange={(event) => handleFileChange('cartaConducaoUrl', event)}
                    />
                    {renderFileLink(draftProfile.cartaConducaoUrl)}
                  </label>
                  <label className="field-span-2">
                    <span>Registo criminal (PDF/JPG)</span>
                    <input
                      type="file"
                      accept=".pdf,.jpg,.jpeg"
                      disabled={!editingSections.documents}
                      onClick={handleFileInputClick}
                      onChange={(event) => handleFileChange('criminalRecordUrl', event)}
                    />
                    {renderFileLink(draftProfile.criminalRecordUrl)}
                  </label>
                </>
              )}
          </div>
        </article>
        )}

        {currentSection === 'tax' && (
        <article className="profile-card">
          <div className="section-headline">
            <h2>4. Dados Fiscais e Bancários</h2>
            {canEdit && (
              <button className={`section-edit-button${editingSections.tax ? ' is-active' : ''}`} type="button" onClick={() => toggleSectionEdit('tax')}>
                ✏️
              </button>
            )}
          </div>
          <div className="profile-fields">
            {!isBrProfile ? (
              <>
                <label>
                  <span>NIF</span>
                  <input type="text" value={draftProfile.nif} disabled={!editingSections.tax} onChange={(event) => handleProfileChange('nif', event.target.value)} />
                  {profileErrors.nif && <small>{profileErrors.nif}</small>}
                </label>
                <label>
                  <span>NISS</span>
                  <input type="text" value={draftProfile.niss} disabled={!editingSections.tax} onChange={(event) => handleProfileChange('niss', event.target.value)} />
                  {profileErrors.niss && <small>{profileErrors.niss}</small>}
                </label>
              </>
            ) : (
              <>
                <label>
                  <span>CPF</span>
                  <input type="text" value={draftProfile.cpf} disabled={!editingSections.tax} onChange={(event) => handleProfileChange('cpf', event.target.value)} />
                  {profileErrors.cpf && <small>{profileErrors.cpf}</small>}
                </label>
                <label>
                  <span>PIS</span>
                  <input type="text" value={draftProfile.pis} disabled={!editingSections.tax} onChange={(event) => handleProfileChange('pis', event.target.value)} />
                  {profileErrors.pis && <small>{profileErrors.pis}</small>}
                </label>
              </>
            )}
            {!isBrProfile && (
              <>
                <label>
                  <span>IBAN</span>
                  <input type="text" value={draftProfile.iban} disabled={!editingSections.tax} onChange={(event) => handleProfileChange('iban', event.target.value)} />
                  {profileErrors.iban && <small>{profileErrors.iban}</small>}
                </label>
                <label>
                  <span>Comprovativo IBAN</span>
                  <input
                    type="file"
                    accept=".pdf,.jpg,.jpeg"
                    disabled={!editingSections.tax}
                    onClick={handleFileInputClick}
                    onChange={(event) => handleFileChange('comprovativoIban', event)}
                  />
                  {renderFileLink(draftProfile.comprovativoIban)}
                  {profileErrors.comprovativoIban && <small>{profileErrors.comprovativoIban}</small>}
                </label>
                <label>
                  <span>Estado civil</span>
                  <select value={draftProfile.estadoCivil} disabled={!editingSections.tax} onChange={(event) => handleProfileChange('estadoCivil', event.target.value)}>
                    <option value="">Selecionar</option>
                    {estadoCivilOptions.map((option) => (
                      <option key={option} value={option}>{option}</option>
                    ))}
                  </select>
                  {profileErrors.estadoCivil && <small>{profileErrors.estadoCivil}</small>}
                </label>
                <label>
                  <span>Situação IRS</span>
                  <select value={draftProfile.situacaoIrs} disabled={!editingSections.tax} onChange={(event) => handleProfileChange('situacaoIrs', event.target.value)}>
                    <option value="">Selecionar</option>
                    {situacaoIrsOptions.map((option) => (
                      <option key={option} value={option}>{option}</option>
                    ))}
                  </select>
                  {profileErrors.situacaoIrs && <small>{profileErrors.situacaoIrs}</small>}
                </label>
                <label>
                  <span>Número de dependentes</span>
                  <input type="number" min="0" value={draftProfile.numeroDependentes} disabled={!editingSections.tax} onChange={(event) => handleProfileChange('numeroDependentes', event.target.value)} />
                  {profileErrors.numeroDependentes && <small>{profileErrors.numeroDependentes}</small>}
                </label>
                <label>
                  <span>Declaração IRS</span>
                  <a
                    href="/mod99-template.pdf"
                    target="_blank"
                    rel="noreferrer"
                    className="profile-file-template-link"
                    title="Descarregar modelo em branco da Declaração de Remunerações Mod. 99"
                  >
                    Descarregar template Mod. 99
                  </a>
                  <input
                    type="file"
                    accept=".pdf,.jpg,.jpeg"
                    disabled={!editingSections.tax}
                    onClick={handleFileInputClick}
                    onChange={(event) => handleFileChange('declaracaoIrs', event)}
                  />
                  {renderFileLink(draftProfile.declaracaoIrs)}
                  {profileErrors.declaracaoIrs && <small>{profileErrors.declaracaoIrs}</small>}
                </label>
                <label>
                  <span>IRS Jovem</span>
                  <select value={draftProfile.irsJovem} disabled={!editingSections.tax} onChange={(event) => handleProfileChange('irsJovem', event.target.value)}>
                    <option value="">Selecionar</option>
                    {irsJovemOptions.map((option) => (
                      <option key={option} value={option}>{option}</option>
                    ))}
                  </select>
                  {profileErrors.irsJovem && <small>{profileErrors.irsJovem}</small>}
                </label>
                <label>
                  <span>Ano do primeiro desconto</span>
                  <input type="text" inputMode="numeric" value={draftProfile.anoPrimeiroDesconto} disabled={!editingSections.tax} onChange={(event) => handleProfileChange('anoPrimeiroDesconto', event.target.value)} />
                  {profileErrors.anoPrimeiroDesconto && <small>{profileErrors.anoPrimeiroDesconto}</small>}
                </label>
              </>
            )}
            {isBrProfile && (
              <>
                <label>
                  <span>Primeiro emprego</span>
                  <select value={draftProfile.primeiroEmprego ? 'SIM' : 'NAO'} disabled={!editingSections.tax} onChange={(event) => handleProfileBooleanChange('primeiroEmprego', event.target.value === 'SIM')}>
                    <option value="SIM">Sim</option>
                    <option value="NAO">Não</option>
                  </select>
                </label>
                <label>
                  <span>Recebe aposentadoria</span>
                  <select value={draftProfile.recebeAposentadoria ? 'SIM' : 'NAO'} disabled={!editingSections.tax} onChange={(event) => handleProfileBooleanChange('recebeAposentadoria', event.target.value === 'SIM')}>
                    <option value="SIM">Sim</option>
                    <option value="NAO">Não</option>
                  </select>
                </label>
                <label>
                  <span>Recebe seguro de desemprego</span>
                  <select value={draftProfile.recebeSeguroDesemprego ? 'SIM' : 'NAO'} disabled={!editingSections.tax} onChange={(event) => handleProfileBooleanChange('recebeSeguroDesemprego', event.target.value === 'SIM')}>
                    <option value="SIM">Sim</option>
                    <option value="NAO">Não</option>
                  </select>
                </label>
                <label>
                  <span>Vale transporte</span>
                  <select value={draftProfile.valeTransporte ? 'SIM' : 'NAO'} disabled={!editingSections.tax} onChange={(event) => handleProfileBooleanChange('valeTransporte', event.target.value === 'SIM')}>
                    <option value="SIM">Sim</option>
                    <option value="NAO">Não</option>
                  </select>
                </label>
              </>
            )}
          </div>
        </article>
        )}

        {currentSection === 'emergency' && (
        <article className="profile-card">
          <div className="section-headline">
            <h2>5. Contacto de emergência</h2>
            {canEdit && (
              <button className={`section-edit-button${editingSections.emergency ? ' is-active' : ''}`} type="button" onClick={() => toggleSectionEdit('emergency')}>
                ✏️
              </button>
            )}
          </div>
          <div className="profile-fields">
            <label>
              <span>Nome do contacto</span>
              <input type="text" value={draftProfile.contactoEmergenciaNome} disabled={!editingSections.emergency} onChange={(event) => handleProfileChange('contactoEmergenciaNome', event.target.value)} />
              {profileErrors.contactoEmergenciaNome && <small>{profileErrors.contactoEmergenciaNome}</small>}
            </label>
            <label>
              <span>Grau de parentesco</span>
              <select value={draftProfile.contactoEmergenciaParentesco} disabled={!editingSections.emergency} onChange={(event) => handleProfileChange('contactoEmergenciaParentesco', event.target.value)}>
                <option value="">Selecionar</option>
                {parentescoOptions.map((option) => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>
              {profileErrors.contactoEmergenciaParentesco && <small>{profileErrors.contactoEmergenciaParentesco}</small>}
            </label>
            <label className="field-span-2">
              <span>Número de contacto</span>
              <input type="text" value={draftProfile.contactoEmergenciaNumero} disabled={!editingSections.emergency} onChange={(event) => handleProfileChange('contactoEmergenciaNumero', event.target.value)} />
              {profileErrors.contactoEmergenciaNumero && <small>{profileErrors.contactoEmergenciaNumero}</small>}
            </label>
          </div>
        </article>
        )}

        {currentSection === 'contract' && (
        <article className="profile-card">
          <div className="section-headline">
            <h2>6. Dados Contratuais</h2>
            <div className="profile-contract__actions">
              {canEditContract && (
                <button className={`section-edit-button${editingSections.contract ? ' is-active' : ''}`} type="button" onClick={() => toggleSectionEdit('contract')}>
                  ✏️
                </button>
              )}
            </div>
          </div>
          <div className="profile-fields profile-fields--contract">
            <label>
              <span>Número mecanográfico</span>
              <input
                type="text"
                value={draftProfile.numeroMecanografico}
                disabled={!canEditContract || !editingSections.contract}
                onChange={(event) => handleProfileChange('numeroMecanografico', event.target.value)}
              />
            </label>
            <label>
              <span>Nível (cargo)</span>
              <SearchableDropdown
                label="Cargo"
                value={draftProfile.cargo}
                placeholder="Selecionar cargo"
                options={cargoOptions}
                disabled={!canEditContract || !editingSections.contract}
                onChange={(value) => handleProfileChange('cargo', value)}
              />
              {profileErrors.cargo && <small>{profileErrors.cargo}</small>}
            </label>
            <label>
              <span>Categoria</span>
              <input
                type="text"
                value={draftProfile.categoriaProfissional}
                disabled={!canEditContract || !editingSections.contract}
                onChange={(event) => handleProfileChange('categoriaProfissional', event.target.value)}
              />
              {profileErrors.categoriaProfissional && <small>{profileErrors.categoriaProfissional}</small>}
            </label>
            <label>
              <span>Função</span>
              <SearchableDropdown
                label="Função"
                value={draftProfile.funcao}
                placeholder="Selecionar função"
                options={funcaoOptions}
                columns={1}
                disabled={!canEditContract || !editingSections.contract}
                onChange={(value) => handleProfileChange('funcao', value)}
              />
              <button
                type="button"
                className="profile-career-link"
                onClick={() => navigate('/plano-carreira')}
              >
                Ver próximos passos da função
              </button>
              {profileErrors.funcao && <small>{profileErrors.funcao}</small>}
            </label>
            <label>
              <span>CC (centro de custo)</span>
              <input
                type="text"
                value={contractCostCenter}
                placeholder="Preenchido com base na equipa"
                disabled
                readOnly
              />
            </label>
            <label>
              <span>Equipa</span>
              <input
                type="text"
                value={teamName}
                disabled
                readOnly
              />
            </label>
            <label>
              <span>Data admissão</span>
              <input type="date" value={draftProfile.dataInicioContrato} disabled={!canEditContract || !editingSections.contract} onChange={(event) => handleProfileChange('dataInicioContrato', event.target.value)} />
              {profileErrors.dataInicioContrato && <small>{profileErrors.dataInicioContrato}</small>}
            </label>
            <label>
              <span>Data fim do contrato</span>
              <input type="date" value={draftProfile.dataFimContrato} disabled={!canEditContract || !editingSections.contract} onChange={(event) => handleProfileChange('dataFimContrato', event.target.value)} />
            </label>
            <label>
              <span>Tipo de contrato</span>
              <select value={draftProfile.tipoContrato} disabled={!canEditContract || !editingSections.contract} onChange={(event) => handleProfileChange('tipoContrato', event.target.value)}>
                <option value="">Selecionar</option>
                {tipoContratoOptions.map((option) => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>
              {profileErrors.tipoContrato && <small>{profileErrors.tipoContrato}</small>}
            </label>
            <label>
              <span>Regime contrato</span>
              <input
                type="text"
                value={regimeContractValue}
                placeholder="Calculado automaticamente"
                disabled
                readOnly
              />
              {profileErrors.regimeHorario && <small>{profileErrors.regimeHorario}</small>}
              {profileErrors.horasSemanaisContrato && <small>{profileErrors.horasSemanaisContrato}</small>}
            </label>
            <div className="profile-contract-dynamic field-span-2">
              <div>
                <span>Horas de trabalho</span>
                <p>{isDynamicRegime ? dynamicRegimeSummary : 'Configura os horários para calcular automaticamente o regime de contrato.'}</p>
              </div>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={!canEditContract || !editingSections.contract}
                onClick={openDynamicRegimeModal}
              >
                Configurar horas de trabalho
              </Button>
            </div>
          </div>
        </article>
        )}

        {currentSection === 'trainings' && (
        <article className="profile-card profile-card--full profile-trainings-card">
          <div className="section-headline">
            <h2>7. Dados de Formação</h2>
          </div>

          <div className="profile-trainings-summary" aria-live="polite">
            <article>
              <span>Total</span>
              <strong>{isLoadingOwnTrainings ? '...' : sortedOwnTrainings.length}</strong>
            </article>
            <article>
              <span>Concluídas</span>
              <strong>{isLoadingOwnTrainings ? '...' : sortedOwnTrainings.filter((item) => !item.status || item.status === 'COMPLETED' || item.status === 'CONCLUIDA').length}</strong>
            </article>
            <article>
              <span>Horas acumuladas</span>
              <strong>{isLoadingOwnTrainings ? '...' : `${formatTrainingHours(sortedOwnTrainings.reduce((acc, item) => acc + item.horas, 0))} h`}</strong>
            </article>
          </div>

          {ownTrainingsStatus && (
            <div className="profile-trainings-error">
              <Toast show={Boolean(ownTrainingsStatus)} tone="error" message={ownTrainingsStatus} />
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => {
                  setOwnTrainingsLoaded(false);
                  setOwnTrainings([]);
                  setOwnTrainingsStatus('');
                }}
              >
                Tentar novamente
              </Button>
            </div>
          )}

          {!isLoadingOwnTrainings && sortedOwnTrainings.length === 0 && !ownTrainingsStatus && (
            <div className="profile-trainings-empty">
              <strong>Sem formações registadas.</strong>
              <p>Quando receberes ou concluíres formações, aparecem aqui automaticamente.</p>
            </div>
          )}

          <div className="profile-trainings-grid">
            {isLoadingOwnTrainings && (
              <article className="profile-training-item profile-training-item--loading">A carregar formações...</article>
            )}

            {!isLoadingOwnTrainings && sortedOwnTrainings.map((record) => (
              <article key={record.id} className="profile-training-item">
                <header>
                  <h4>{record.nome}</h4>
                  <Badge tone={getTrainingStatusTone(record.status) === 'approved' ? 'success' : getTrainingStatusTone(record.status) === 'pending' ? 'warning' : 'neutral'}>
                    {formatTrainingStatusLabel(record.status)}
                  </Badge>
                </header>

                <div className="profile-training-item__meta">
                  <span><strong>Data de início:</strong> {formatPtDate(resolveTrainingStartDate(record))}</span>
                  <span><strong>Data de conclusão:</strong> {formatPtDate(record.dataConclusao)}</span>
                  <span><strong>Horas:</strong> {formatTrainingHours(record.horas)} h</span>
                  <span><strong>Entidade:</strong> {record.entidade || '-'}</span>
                  <span><strong>Origem:</strong> {resolveTrainingOrigin(record)}</span>
                </div>

                {record.link && (
                  <a href={record.link} target="_blank" rel="noreferrer">Abrir conteúdo da formação</a>
                )}
              </article>
            ))}
          </div>
        </article>
        )}

        {currentSection === 'benefits' && (
        <article className="profile-card profile-card--full">
          <div className="section-headline">
            <h2>8. Pedido de Benefícios</h2>
            {canEdit && (
              <button className={`section-edit-button${editingSections.benefits ? ' is-active' : ''}`} type="button" onClick={() => toggleSectionEdit('benefits')}>
                ✏️
              </button>
            )}
          </div>
          <div className="profile-fields profile-fields--2">
            {!isBrProfile && (
              <label>
                <span>Número do Cartão Continente</span>
                <input
                  type="text"
                  value={draftProfile.numeroCartaoContinente}
                  disabled={!editingSections.benefits}
                  onChange={(event) => handleProfileChange('numeroCartaoContinente', event.target.value)}
                />
              </label>
            )}
            <div className="profile-voucher-nos field-span-2" role="status" aria-live="polite">
              <div className="profile-voucher-nos__copy">
                <span className="profile-voucher-nos__title">Voucher NOS</span>
                <strong>
                  {voucherLastRequestDate
                    ? `Último pedido em ${formatPtDate(draftProfile.voucherNosData)}`
                    : 'Ainda sem pedidos de voucher NOS'}
                </strong>
                <small>
                  {voucherNextEligibleDate
                    ? `Próximo pedido disponível em ${formatPtDate(formatLocalDateOnly(voucherNextEligibleDate))}`
                    : 'Sem pedidos anteriores, podes emitir agora.'}
                </small>
              </div>
              <Button
                type="button"
                variant="primary"
                size="sm"
                onClick={handleVoucherNosRequest}
                disabled={isRequestingVoucherNos || !isSemTermoContract || voucherIsInCooldown}
              >
                {isRequestingVoucherNos ? 'A emitir...' : 'Emitir voucher'}
              </Button>
              {!isSemTermoContract && (
                <p className="profile-voucher-nos__hint">Disponível apenas para contrato sem termo.</p>
              )}
              {isSemTermoContract && voucherIsInCooldown && voucherNextEligibleDate && (
                <p className="profile-voucher-nos__hint">Pedido bloqueado até {formatPtDate(formatLocalDateOnly(voucherNextEligibleDate))}.</p>
              )}
            </div>
            {!isBrProfile && (
              <label className="field-span-2">
                <span>Comprovativo Cartão Continente (PDF/JPG)</span>
                <input
                  type="file"
                  accept=".pdf,.jpg,.jpeg"
                  disabled={!editingSections.benefits}
                  onClick={handleFileInputClick}
                  onChange={(event) => handleFileChange('comprovativoCartaoContinente', event)}
                />
                {renderFileLink(draftProfile.comprovativoCartaoContinente)}
                {profileErrors.comprovativoCartaoContinente && <small>{profileErrors.comprovativoCartaoContinente}</small>}
              </label>
            )}
          </div>
        </article>
        )}

      </section>

      {toast.visible && (
        <aside className={`portal-toast portal-toast--${toast.tone === 'error' ? 'error' : 'success'}`} role="status" aria-live="polite">
          <strong>{toast.tone === 'success' ? 'Sucesso' : toast.tone === 'error' ? 'Atenção' : 'Informação'}</strong>
          <span>{toast.message}</span>
        </aside>
      )}

      {canEdit && (
        <div className={`floating-save${hasNonPhotoUnsavedChanges ? ' is-visible' : ''}`}>
          <button type="button" className="floating-save__button" onClick={handleSaveChanges} disabled={!hasNonPhotoUnsavedChanges || isSaving}>
            {isSaving ? (effectiveRequestMode ? 'A submeter...' : 'A guardar...') : effectiveRequestMode ? 'Submeter pedido' : 'Guardar alterações'}
          </button>
        </div>
      )}

      <Modal
        open={isCompletionHelpOpen}
        title="Checklist da ficha"
        onClose={() => setIsCompletionHelpOpen(false)}
        footer={(
          <Button type="button" variant="primary" onClick={() => setIsCompletionHelpOpen(false)}>
            Fechar
          </Button>
        )}
      >
        <div className="profile-completion-help profile-completion-help--modal">
          <header className="profile-completion-help__header">
            <div>
              <p className="profile-completion-help__eyebrow">Estado atual</p>
              <h4>{completionIssueCount === 0 ? 'Ficha completa' : `${completionIssueCount} campo${completionIssueCount === 1 ? '' : 's'} pendente${completionIssueCount === 1 ? '' : 's'}`}</h4>
            </div>
            <div className="profile-completion-help__score">
              <strong>{profileCompletion}%</strong>
              <span>feito</span>
            </div>
          </header>

          <div className="profile-completion-help__body">
            <div className="profile-completion-help__summary">
              <p>{completionIssueCount === 0 ? 'Sem pendências no momento.' : 'Preenche os itens abaixo para concluir a ficha.'}</p>
            </div>

            {completionIssueCount > 0 ? (
              <ul className="profile-completion-help__list">
                {completionIssueEntries.map((entry) => (
                  <li key={entry.field}>
                    <div>
                      <span>{entry.label}</span>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="profile-completion-help__empty">
                <strong>Perfeito</strong>
                <p>Não há nada por completar.</p>
              </div>
            )}
          </div>
        </div>
      </Modal>

      <Modal
        open={isRequestFeedbackOpen}
        title="Pedido submetido com sucesso"
        onClose={() => setIsRequestFeedbackOpen(false)}
        width="560px"
        footer={(
          <Button type="button" variant="primary" onClick={() => setIsRequestFeedbackOpen(false)}>
            Percebi
          </Button>
        )}
      >
        <div className="profile-request-feedback">
          <p>As alterações não foram aplicadas de imediato.</p>
          <p>O teu pedido ficou registado e está agora em análise pela equipa RH.</p>
          <p>Receberás notificação quando houver decisão.</p>
        </div>
      </Modal>

      <Modal
        open={isDynamicRegimeModalOpen}
        title="Configuração de horas de trabalho"
        onClose={() => setIsDynamicRegimeModalOpen(false)}
        width="760px"
        footer={(
          <div className="profile-dynamic-regime__footer">
            <Button type="button" variant="secondary" onClick={() => setIsDynamicRegimeModalOpen(false)}>
              Cancelar
            </Button>
            <Button type="button" variant="primary" onClick={applyDynamicRegime}>
              Aplicar regime
            </Button>
          </div>
        )}
      >
        <div className="profile-dynamic-regime">
          <div className="profile-dynamic-regime__hero">
            <p>Define os dias ativos e os intervalos horários. O regime de contrato é calculado automaticamente.</p>
            <strong>{dynamicRegimeDraftWeeklyHours == null ? 'Configuração incompleta' : formatWeeklyHoursLabel(dynamicRegimeDraftWeeklyHours)}</strong>
          </div>
          <div className="profile-dynamic-regime__grid">
            {dynamicRegimeDraft.map((day) => (
              <article key={day.key} className={`profile-dynamic-regime__day${day.enabled ? ' is-enabled' : ''}`}>
                <label className="profile-dynamic-regime__toggle">
                  <input
                    type="checkbox"
                    checked={day.enabled}
                    onChange={(event) => handleDynamicRegimeDayToggle(day.key, event.target.checked)}
                  />
                  <span>{day.label}</span>
                </label>

                <div className="profile-dynamic-regime__times">
                  <input
                    type="time"
                    value={day.start}
                    disabled={!day.enabled}
                    onChange={(event) => handleDynamicRegimeTimeChange(day.key, 'start', event.target.value)}
                  />
                  <span>até</span>
                  <input
                    type="time"
                    value={day.end}
                    disabled={!day.enabled}
                    onChange={(event) => handleDynamicRegimeTimeChange(day.key, 'end', event.target.value)}
                  />
                </div>
              </article>
            ))}
          </div>
        </div>
      </Modal>
    </>
  );
}
