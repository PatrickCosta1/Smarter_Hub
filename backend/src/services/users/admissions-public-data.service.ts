import { z } from 'zod';

const EMPLOYEE_ADMISSION_PUBLIC_FIELDS = [
  'nomeCompleto',
  'nomeAbreviado',
  'dataNascimento',
  'genero',
  'estadoCivil',
  'habilitacoesLiterarias',
  'curso',
  'faculdade',
  'nacionalidade',
  'emailPessoal',
  'telemovel',
  'githubUser',
  'moradaFiscal',
  'endereco',
  'localidade',
  'codigoPostal',
  'matriculaCarro',
  'localNascimentoPais',
  'localNascimentoCidade',
  'nomePai',
  'nomeMae',
  'cartaoCidadao',
  'validadeCartaoCidadao',
  'nif',
  'cpf',
  'pis',
  'ctps',
  'ctpsSerie',
  'ctpsDataExpedicao',
  'rg',
  'rgOrgaoEmissor',
  'rgDataExpedicao',
  'cnh',
  'cnhCategoria',
  'cnhDataValidade',
  'tituloEleitor',
  'zonaEleitoral',
  'secaoEleitoral',
  'certificadoReservista',
  'niss',
  'iban',
  'situacaoIrs',
  'numeroDependentes',
  'declaracaoIrs',
  'irsJovem',
  'anoPrimeiroDesconto',
  'primeiroEmprego',
  'recebeAposentadoria',
  'recebeSeguroDesemprego',
  'valeTransporte',
  'numeroCartaoContinente',
  'voucherNosData',
  'comprovativoMoradaFiscal',
  'comprovativoCartaoCidadao',
  'comprovativoIban',
  'comprovativoCartaoContinente',
  'criminalRecordUrl',
  'contactoEmergenciaNome',
  'contactoEmergenciaParentesco',
  'contactoEmergenciaNumero',
  'workCountry',
  'brWorkState',
] as const;

type EmployeeAdmissionPublicField = typeof EMPLOYEE_ADMISSION_PUBLIC_FIELDS[number];
export type EmployeeAdmissionPersonalData = Partial<Record<EmployeeAdmissionPublicField, string | boolean>>;

export const ADMISSION_SETTINGS_COUNTRIES = ['PT', 'BR'] as const;
export type AdmissionSettingsCountry = typeof ADMISSION_SETTINGS_COUNTRIES[number];

export const ADMISSION_REQUIRED_FIELD_KEYS = [
  'nomeCompleto',
  'nomeAbreviado',
  'dataNascimento',
  'genero',
  'estadoCivil',
  'habilitacoesLiterarias',
  'curso',
  'faculdade',
  'nacionalidade',
  'emailPessoal',
  'telemovel',
  'githubUser',
  'moradaFiscal',
  'endereco',
  'localidade',
  'codigoPostal',
  'contactoEmergenciaNome',
  'contactoEmergenciaParentesco',
  'contactoEmergenciaNumero',
  'matriculaCarro',
  'cartaoCidadao',
  'validadeCartaoCidadao',
  'nif',
  'niss',
  'iban',
  'situacaoIrs',
  'numeroDependentes',
  'declaracaoIrs',
  'irsJovem',
  'anoPrimeiroDesconto',
  'numeroCartaoContinente',
  'voucherNosData',
  'comprovativoMoradaFiscal',
  'comprovativoCartaoCidadao',
  'comprovativoIban',
  'comprovativoCartaoContinente',
  'criminalRecordUrl',
  'brWorkState',
  'cpf',
  'pis',
  'ctps',
  'ctpsSerie',
  'ctpsDataExpedicao',
  'rg',
  'rgOrgaoEmissor',
  'rgDataExpedicao',
  'cnh',
  'cnhCategoria',
  'cnhDataValidade',
  'tituloEleitor',
  'zonaEleitoral',
  'secaoEleitoral',
  'certificadoReservista',
  'localNascimentoPais',
  'localNascimentoCidade',
  'nomePai',
  'nomeMae',
] as const;

export type AdmissionRequiredFieldKey = typeof ADMISSION_REQUIRED_FIELD_KEYS[number];

type AdmissionFieldMeta = {
  label: string;
  countries: AdmissionSettingsCountry[];
  defaultRequiredCountries: AdmissionSettingsCountry[];
};

const ADMISSION_FIELD_META: Record<AdmissionRequiredFieldKey, AdmissionFieldMeta> = {
  nomeCompleto: { label: 'Nome completo', countries: ['PT', 'BR'], defaultRequiredCountries: ['PT', 'BR'] },
  nomeAbreviado: { label: 'Nome abreviado', countries: ['PT', 'BR'], defaultRequiredCountries: ['PT', 'BR'] },
  dataNascimento: { label: 'Data de nascimento', countries: ['PT', 'BR'], defaultRequiredCountries: ['PT', 'BR'] },
  genero: { label: 'Género', countries: ['PT', 'BR'], defaultRequiredCountries: ['PT', 'BR'] },
  estadoCivil: { label: 'Estado civil', countries: ['PT', 'BR'], defaultRequiredCountries: ['PT', 'BR'] },
  habilitacoesLiterarias: { label: 'Habilitações literárias', countries: ['PT', 'BR'], defaultRequiredCountries: ['PT', 'BR'] },
  curso: { label: 'Curso', countries: ['PT', 'BR'], defaultRequiredCountries: [] },
  faculdade: { label: 'Faculdade', countries: ['PT', 'BR'], defaultRequiredCountries: [] },
  nacionalidade: { label: 'Nacionalidade', countries: ['PT', 'BR'], defaultRequiredCountries: [] },
  emailPessoal: { label: 'Email pessoal', countries: ['PT', 'BR'], defaultRequiredCountries: ['PT', 'BR'] },
  telemovel: { label: 'Telemóvel', countries: ['PT', 'BR'], defaultRequiredCountries: ['PT', 'BR'] },
  githubUser: { label: 'Utilizador GitHub', countries: ['PT', 'BR'], defaultRequiredCountries: [] },
  moradaFiscal: { label: 'Morada fiscal', countries: ['PT', 'BR'], defaultRequiredCountries: ['PT', 'BR'] },
  endereco: { label: 'Endereço', countries: ['PT', 'BR'], defaultRequiredCountries: [] },
  localidade: { label: 'Localidade', countries: ['PT', 'BR'], defaultRequiredCountries: ['PT', 'BR'] },
  codigoPostal: { label: 'Código postal', countries: ['PT', 'BR'], defaultRequiredCountries: ['PT', 'BR'] },
  contactoEmergenciaNome: { label: 'Contacto de emergência · Nome', countries: ['PT', 'BR'], defaultRequiredCountries: ['PT', 'BR'] },
  contactoEmergenciaParentesco: { label: 'Contacto de emergência · Parentesco', countries: ['PT', 'BR'], defaultRequiredCountries: ['PT', 'BR'] },
  contactoEmergenciaNumero: { label: 'Contacto de emergência · Telefone', countries: ['PT', 'BR'], defaultRequiredCountries: ['PT', 'BR'] },
  matriculaCarro: { label: 'Matrícula do carro', countries: ['PT'], defaultRequiredCountries: [] },
  cartaoCidadao: { label: 'Cartão de Cidadão', countries: ['PT'], defaultRequiredCountries: [] },
  validadeCartaoCidadao: { label: 'Validade do Cartão de Cidadão', countries: ['PT'], defaultRequiredCountries: [] },
  nif: { label: 'NIF', countries: ['PT'], defaultRequiredCountries: [] },
  niss: { label: 'NISS', countries: ['PT'], defaultRequiredCountries: [] },
  iban: { label: 'IBAN', countries: ['PT'], defaultRequiredCountries: [] },
  situacaoIrs: { label: 'Situação de IRS', countries: ['PT'], defaultRequiredCountries: [] },
  numeroDependentes: { label: 'Número de dependentes', countries: ['PT'], defaultRequiredCountries: [] },
  declaracaoIrs: { label: 'Documento · Declaração IRS', countries: ['PT'], defaultRequiredCountries: ['PT'] },
  irsJovem: { label: 'IRS Jovem', countries: ['PT'], defaultRequiredCountries: [] },
  anoPrimeiroDesconto: { label: 'Ano do primeiro desconto', countries: ['PT'], defaultRequiredCountries: [] },
  numeroCartaoContinente: { label: 'Número do Cartão Continente', countries: ['PT'], defaultRequiredCountries: [] },
  voucherNosData: { label: 'Data pedido voucher NOS', countries: ['PT'], defaultRequiredCountries: [] },
  comprovativoMoradaFiscal: { label: 'Documento · Comprovativo de morada', countries: ['PT', 'BR'], defaultRequiredCountries: ['PT', 'BR'] },
  comprovativoCartaoCidadao: { label: 'Documento · Identificação', countries: ['PT', 'BR'], defaultRequiredCountries: ['PT', 'BR'] },
  comprovativoIban: { label: 'Documento · Comprovativo de IBAN/conta', countries: ['PT', 'BR'], defaultRequiredCountries: ['PT', 'BR'] },
  comprovativoCartaoContinente: { label: 'Documento · Cartão Continente', countries: ['PT'], defaultRequiredCountries: [] },
  criminalRecordUrl: { label: 'Documento · Registo criminal', countries: ['PT'], defaultRequiredCountries: [] },
  brWorkState: { label: 'Estado de trabalho (Brasil)', countries: ['BR'], defaultRequiredCountries: ['BR'] },
  cpf: { label: 'CPF', countries: ['BR'], defaultRequiredCountries: [] },
  pis: { label: 'PIS', countries: ['BR'], defaultRequiredCountries: [] },
  ctps: { label: 'CTPS', countries: ['BR'], defaultRequiredCountries: [] },
  ctpsSerie: { label: 'CTPS · Série', countries: ['BR'], defaultRequiredCountries: [] },
  ctpsDataExpedicao: { label: 'CTPS · Data de expedição', countries: ['BR'], defaultRequiredCountries: [] },
  rg: { label: 'RG', countries: ['BR'], defaultRequiredCountries: [] },
  rgOrgaoEmissor: { label: 'RG · Órgão emissor', countries: ['BR'], defaultRequiredCountries: [] },
  rgDataExpedicao: { label: 'RG · Data de expedição', countries: ['BR'], defaultRequiredCountries: [] },
  cnh: { label: 'CNH', countries: ['BR'], defaultRequiredCountries: [] },
  cnhCategoria: { label: 'CNH · Categoria', countries: ['BR'], defaultRequiredCountries: [] },
  cnhDataValidade: { label: 'CNH · Data de validade', countries: ['BR'], defaultRequiredCountries: [] },
  tituloEleitor: { label: 'Título de Eleitor', countries: ['BR'], defaultRequiredCountries: [] },
  zonaEleitoral: { label: 'Zona Eleitoral', countries: ['BR'], defaultRequiredCountries: [] },
  secaoEleitoral: { label: 'Seção Eleitoral', countries: ['BR'], defaultRequiredCountries: [] },
  certificadoReservista: { label: 'Certificado de Reservista', countries: ['BR'], defaultRequiredCountries: [] },
  localNascimentoPais: { label: 'País de nascimento', countries: ['BR'], defaultRequiredCountries: [] },
  localNascimentoCidade: { label: 'Cidade de nascimento', countries: ['BR'], defaultRequiredCountries: [] },
  nomePai: { label: 'Nome do pai', countries: ['BR'], defaultRequiredCountries: [] },
  nomeMae: { label: 'Nome da mãe', countries: ['BR'], defaultRequiredCountries: [] },
};

function getDefaultRequiredFieldsForCountry(country: AdmissionSettingsCountry): AdmissionRequiredFieldKey[] {
  return ADMISSION_REQUIRED_FIELD_KEYS
    .filter((field) => ADMISSION_FIELD_META[field].countries.includes(country))
    .filter((field) => ADMISSION_FIELD_META[field].defaultRequiredCountries.includes(country));
}

export const DEFAULT_ADMISSION_REQUIRED_FIELDS_BY_COUNTRY: Record<AdmissionSettingsCountry, AdmissionRequiredFieldKey[]> = {
  PT: getDefaultRequiredFieldsForCountry('PT'),
  BR: getDefaultRequiredFieldsForCountry('BR'),
};

export const DEFAULT_ADMISSION_REQUIRED_FIELDS: AdmissionRequiredFieldKey[] = DEFAULT_ADMISSION_REQUIRED_FIELDS_BY_COUNTRY.PT;

const admissionRequiredFieldSchema = z.enum(ADMISSION_REQUIRED_FIELD_KEYS);
const admissionCountrySchema = z.enum(ADMISSION_SETTINGS_COUNTRIES);

const admissionStoredFormSettingsSchema = z.object({
  byCountry: z.object({
    PT: z.object({ requiredFields: z.array(admissionRequiredFieldSchema).min(1) }),
    BR: z.object({ requiredFields: z.array(admissionRequiredFieldSchema).min(1) }),
  }),
});

export type AdmissionFormSettings = z.infer<typeof admissionStoredFormSettingsSchema>;

export const admissionFormSettingsSchema = z.object({
  country: admissionCountrySchema,
  requiredFields: z.array(admissionRequiredFieldSchema).min(1),
});

export type AdmissionFormSettingsUpdateInput = z.infer<typeof admissionFormSettingsSchema>;

function normalizeTextField(value?: string | null) {
  if (typeof value !== 'string') {
    return '';
  }

  return value.trim();
}

export function normalizeBooleanField(value: unknown) {
  return value === true || value === 'true' || value === '1';
}

export function buildEmptyAdmissionPersonalData(input: {
  fullName: string;
  personalEmail: string;
  workCountry: 'PT' | 'BR';
  brWorkState?: 'SP' | 'RS' | null;
}): EmployeeAdmissionPersonalData {
  return {
    nomeCompleto: input.fullName,
    nomeAbreviado: input.fullName,
    emailPessoal: input.personalEmail,
    workCountry: input.workCountry,
    brWorkState: input.workCountry === 'BR' ? (input.brWorkState ?? '') : '',
  };
}

export function normalizeEmployeeAdmissionPersonalData(
  payload: unknown,
  invitation: { fullName: string; personalEmail: string; workCountry: 'PT' | 'BR'; brWorkState?: 'SP' | 'RS' | null },
) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('Payload inválido.');
  }

  const source = payload as Record<string, unknown>;
  const normalized: EmployeeAdmissionPersonalData = buildEmptyAdmissionPersonalData(invitation);

  for (const field of EMPLOYEE_ADMISSION_PUBLIC_FIELDS) {
    if (!(field in source)) {
      continue;
    }

    if (field === 'primeiroEmprego' || field === 'recebeAposentadoria' || field === 'recebeSeguroDesemprego' || field === 'valeTransporte') {
      normalized[field] = normalizeBooleanField(source[field]);
      continue;
    }

    normalized[field] = source[field] == null ? '' : String(source[field]);
  }

  normalized.nomeCompleto = normalizeTextField(String(normalized.nomeCompleto ?? invitation.fullName)) || invitation.fullName;
  normalized.emailPessoal = normalizeTextField(String(normalized.emailPessoal ?? invitation.personalEmail)).toLowerCase() || invitation.personalEmail;
  normalized.workCountry = invitation.workCountry;
  normalized.brWorkState = invitation.workCountry === 'BR' ? normalizeTextField(String(normalized.brWorkState ?? invitation.brWorkState ?? '')) : '';

  return normalized;
}

function normalizeRequiredFieldsForCountry(fields: readonly AdmissionRequiredFieldKey[], country: AdmissionSettingsCountry) {
  const allowed = new Set(getAdmissionRequiredFieldOptionsByCountry(country).map((field) => field.key));
  const unique: AdmissionRequiredFieldKey[] = [];

  for (const field of fields) {
    if (!allowed.has(field) || unique.includes(field)) {
      continue;
    }
    unique.push(field);
  }

  if (unique.length === 0) {
    return [...DEFAULT_ADMISSION_REQUIRED_FIELDS_BY_COUNTRY[country]];
  }

  return unique;
}

export function buildDefaultAdmissionFormSettings(): AdmissionFormSettings {
  return {
    byCountry: {
      PT: { requiredFields: [...DEFAULT_ADMISSION_REQUIRED_FIELDS_BY_COUNTRY.PT] },
      BR: { requiredFields: [...DEFAULT_ADMISSION_REQUIRED_FIELDS_BY_COUNTRY.BR] },
    },
  };
}

export function normalizeAdmissionFormSettings(raw: unknown): AdmissionFormSettings {
  const fallback = buildDefaultAdmissionFormSettings();

  if (!raw) {
    return fallback;
  }

  const parsedCurrent = admissionStoredFormSettingsSchema.safeParse(raw);
  if (parsedCurrent.success) {
    return {
      byCountry: {
        PT: { requiredFields: normalizeRequiredFieldsForCountry(parsedCurrent.data.byCountry.PT.requiredFields, 'PT') },
        BR: { requiredFields: normalizeRequiredFieldsForCountry(parsedCurrent.data.byCountry.BR.requiredFields, 'BR') },
      },
    };
  }

  // Compatibilidade com formato legado: { requiredFields: string[] }
  const legacy = z.object({ requiredFields: z.array(admissionRequiredFieldSchema).min(1) }).safeParse(raw);
  if (!legacy.success) {
    return fallback;
  }

  return {
    byCountry: {
      PT: { requiredFields: normalizeRequiredFieldsForCountry(legacy.data.requiredFields, 'PT') },
      BR: { requiredFields: normalizeRequiredFieldsForCountry(legacy.data.requiredFields, 'BR') },
    },
  };
}

export function resolveAdmissionRequiredFieldsByCountry(
  settings: AdmissionFormSettings | { requiredFields: AdmissionRequiredFieldKey[] } | undefined,
  country: AdmissionSettingsCountry,
) {
  if (!settings) {
    return [...DEFAULT_ADMISSION_REQUIRED_FIELDS_BY_COUNTRY[country]];
  }

  if ('byCountry' in settings) {
    return normalizeRequiredFieldsForCountry(settings.byCountry[country].requiredFields, country);
  }

  return normalizeRequiredFieldsForCountry(settings.requiredFields, country);
}

export function getAdmissionRequiredFieldOptionsByCountry(country: AdmissionSettingsCountry) {
  return ADMISSION_REQUIRED_FIELD_KEYS
    .filter((key) => ADMISSION_FIELD_META[key].countries.includes(country))
    .map((key) => ({
      key,
      label: ADMISSION_FIELD_META[key].label,
      defaultRequired: ADMISSION_FIELD_META[key].defaultRequiredCountries.includes(country),
    }));
}

export function getAdmissionRequiredFieldOptions() {
  return {
    PT: getAdmissionRequiredFieldOptionsByCountry('PT'),
    BR: getAdmissionRequiredFieldOptionsByCountry('BR'),
  };
}

const REQUIRED_FIELD_ERROR_MESSAGES: Record<AdmissionRequiredFieldKey, string> = {
  nomeCompleto: 'Nome completo é obrigatório.',
  nomeAbreviado: 'Nome abreviado é obrigatório.',
  dataNascimento: 'Data de nascimento é obrigatória.',
  genero: 'Género é obrigatório.',
  estadoCivil: 'Estado civil é obrigatório.',
  habilitacoesLiterarias: 'Habilitações literárias são obrigatórias.',
  curso: 'Curso é obrigatório.',
  faculdade: 'Faculdade é obrigatória.',
  nacionalidade: 'Nacionalidade é obrigatória.',
  emailPessoal: 'Email pessoal inválido.',
  telemovel: 'Telemóvel é obrigatório.',
  githubUser: 'Utilizador GitHub é obrigatório.',
  moradaFiscal: 'Morada fiscal é obrigatória.',
  endereco: 'Endereço é obrigatório.',
  localidade: 'Localidade é obrigatória.',
  codigoPostal: 'Código postal é obrigatório.',
  contactoEmergenciaNome: 'Nome do contacto de emergência é obrigatório.',
  contactoEmergenciaParentesco: 'Parentesco do contacto de emergência é obrigatório.',
  contactoEmergenciaNumero: 'Número do contacto de emergência é obrigatório.',
  matriculaCarro: 'Matrícula do carro é obrigatória.',
  cartaoCidadao: 'Cartão de Cidadão é obrigatório.',
  validadeCartaoCidadao: 'Validade do Cartão de Cidadão é obrigatória.',
  nif: 'NIF é obrigatório.',
  niss: 'NISS é obrigatório.',
  iban: 'IBAN é obrigatório.',
  situacaoIrs: 'Situação de IRS é obrigatória.',
  numeroDependentes: 'Número de dependentes é obrigatório.',
  declaracaoIrs: 'Declaração IRS é obrigatória.',
  irsJovem: 'Campo IRS Jovem é obrigatório.',
  anoPrimeiroDesconto: 'Ano do primeiro desconto é obrigatório.',
  numeroCartaoContinente: 'Número do Cartão Continente é obrigatório.',
  voucherNosData: 'Data de pedido do voucher NOS é obrigatória.',
  comprovativoMoradaFiscal: 'Comprovativo de morada é obrigatório.',
  comprovativoCartaoCidadao: 'Documento de identificação é obrigatório.',
  comprovativoIban: 'Comprovativo de IBAN/conta bancária é obrigatório.',
  comprovativoCartaoContinente: 'Comprovativo de Cartão Continente é obrigatório.',
  criminalRecordUrl: 'Registo criminal é obrigatório.',
  brWorkState: 'Estado de trabalho no Brasil é obrigatório.',
  cpf: 'CPF é obrigatório.',
  pis: 'PIS é obrigatório.',
  ctps: 'CTPS é obrigatório.',
  ctpsSerie: 'Série da CTPS é obrigatória.',
  ctpsDataExpedicao: 'Data de expedição da CTPS é obrigatória.',
  rg: 'RG é obrigatório.',
  rgOrgaoEmissor: 'Órgão emissor do RG é obrigatório.',
  rgDataExpedicao: 'Data de expedição do RG é obrigatória.',
  cnh: 'CNH é obrigatória.',
  cnhCategoria: 'Categoria da CNH é obrigatória.',
  cnhDataValidade: 'Data de validade da CNH é obrigatória.',
  tituloEleitor: 'Título de Eleitor é obrigatório.',
  zonaEleitoral: 'Zona eleitoral é obrigatória.',
  secaoEleitoral: 'Seção eleitoral é obrigatória.',
  certificadoReservista: 'Certificado de reservista é obrigatório.',
  localNascimentoPais: 'País de nascimento é obrigatório.',
  localNascimentoCidade: 'Cidade de nascimento é obrigatória.',
  nomePai: 'Nome do pai é obrigatório.',
  nomeMae: 'Nome da mãe é obrigatório.',
};

function validateRequiredTextField(data: EmployeeAdmissionPersonalData, field: AdmissionRequiredFieldKey, errors: string[]) {
  const value = normalizeTextField(String(data[field] ?? ''));

  if (!value) {
    errors.push(REQUIRED_FIELD_ERROR_MESSAGES[field]);
    return;
  }

  if (field === 'emailPessoal' && !z.string().email().safeParse(value).success) {
    errors.push(REQUIRED_FIELD_ERROR_MESSAGES[field]);
  }
}

export function validateEmployeeAdmissionPersonalDataWithSettings(
  data: EmployeeAdmissionPersonalData,
  country: 'PT' | 'BR',
  settings?: AdmissionFormSettings,
) {
  const errors: string[] = [];

  const requiredFields = resolveAdmissionRequiredFieldsByCountry(settings, country);

  for (const field of requiredFields) {
    validateRequiredTextField(data, field, errors);
  }

  return errors;
}

export function validateEmployeeAdmissionPersonalData(data: EmployeeAdmissionPersonalData, country: 'PT' | 'BR') {
  return validateEmployeeAdmissionPersonalDataWithSettings(data, country, buildDefaultAdmissionFormSettings());
}
