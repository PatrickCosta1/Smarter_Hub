import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import LoadingScreen from '../components/LoadingScreen';
import Button from '../components/ui/Button';
import { getApiBase, getBackendBase } from '../portal/api';
import { situacaoIrsOptions, estadoCivilOptions, habilitacoesOptions, generoOptions, parentescoOptions, irsJovemOptions } from '../portal/data';

type AdmissionStatus = 'INVITED' | 'SUBMITTED' | 'CHANGES_REQUESTED' | 'APPROVED_PENDING_CONTRACT' | 'COMPLETED';

/* ── Tipos alinhados com ProfileData (sem campos contratuais) ── */
type AdmissionForm = {
  // Identificação pessoal
  nomeCompleto: string;
  nomeAbreviado: string;
  dataNascimento: string;
  genero: string;
  estadoCivil: string;
  habilitacoesLiterarias: string;
  curso: string;
  faculdade: string;
  nacionalidade: string;
  localNascimentoPais: string;
  localNascimentoCidade: string;
  nomePai: string;
  nomeMae: string;
  matriculaCarro: string;
  githubUser: string;
  // Contacto
  emailPessoal: string;
  telemovel: string;
  workCountry: 'PT' | 'BR';
  brWorkState: string;
  // Morada
  moradaFiscal: string;
  endereco: string;
  localidade: string;
  codigoPostal: string;
  // Documentos PT
  cartaoCidadao: string;
  validadeCartaoCidadao: string;
  nif: string;
  niss: string;
  iban: string;
  situacaoIrs: string;
  numeroDependentes: string;
  irsJovem: string;
  anoPrimeiroDesconto: string;
  primeiroEmprego: boolean;
  // Documentos BR
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
  recebeAposentadoria: boolean;
  recebeSeguroDesemprego: boolean;
  valeTransporte: boolean;
  // Benefícios PT
  numeroCartaoContinente: string;
  // Contacto de emergência
  contactoEmergenciaNome: string;
  contactoEmergenciaParentesco: string;
  contactoEmergenciaNumero: string;
  // Documentos (uploads)
  comprovativoMoradaFiscal: string;
  comprovativoCartaoCidadao: string;
  comprovativoIban: string;
  declaracaoIrs: string;
  comprovativoCartaoContinente: string;
};

type UploadField = 'comprovativoMoradaFiscal' | 'comprovativoCartaoCidadao' | 'comprovativoIban' | 'declaracaoIrs' | 'comprovativoCartaoContinente';

type AdmissionRequiredFieldKey = keyof AdmissionForm;

type AdmissionFormSettings = {
  requiredFields: AdmissionRequiredFieldKey[];
};

const DEFAULT_ADMISSION_REQUIRED_FIELDS: AdmissionRequiredFieldKey[] = [
  'nomeCompleto',
  'nomeAbreviado',
  'dataNascimento',
  'genero',
  'estadoCivil',
  'habilitacoesLiterarias',
  'emailPessoal',
  'telemovel',
  'moradaFiscal',
  'localidade',
  'codigoPostal',
  'contactoEmergenciaNome',
  'contactoEmergenciaParentesco',
  'contactoEmergenciaNumero',
  'brWorkState',
  'comprovativoMoradaFiscal',
  'comprovativoCartaoCidadao',
  'comprovativoIban',
  'declaracaoIrs',
];

type AdmissionPayload = {
  id: string;
  fullName: string;
  personalEmail: string;
  workCountry: 'PT' | 'BR';
  brWorkState: string | null;
  status: AdmissionStatus;
  reviewReason: string;
  tokenExpiresAt: string;
  personalData: Partial<Record<string, unknown>> | null;
  formSettings?: AdmissionFormSettings;
};

const BRAZIL_STATES = [
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA',
  'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO',
];

function str(v: unknown): string { return v == null ? '' : String(v); }
function bool(v: unknown): boolean { return v === true || v === 'true' || v === '1'; }

function buildAbbreviatedName(fullName: string) {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  return parts.length <= 1 ? fullName.trim() : `${parts[0]} ${parts[parts.length - 1]}`.trim();
}

function createEmptyForm(defaults: { fullName: string; personalEmail: string; workCountry: 'PT' | 'BR'; brWorkState: string }): AdmissionForm {
  return {
    nomeCompleto: defaults.fullName,
    nomeAbreviado: buildAbbreviatedName(defaults.fullName),
    dataNascimento: '', genero: '', estadoCivil: '', habilitacoesLiterarias: '',
    curso: '', faculdade: '', nacionalidade: '', localNascimentoPais: '', localNascimentoCidade: '',
    nomePai: '', nomeMae: '', matriculaCarro: '', githubUser: '',
    emailPessoal: defaults.personalEmail, telemovel: '',
    workCountry: defaults.workCountry, brWorkState: defaults.brWorkState,
    moradaFiscal: '', endereco: '', localidade: '', codigoPostal: '',
    cartaoCidadao: '', validadeCartaoCidadao: '', nif: '', niss: '', iban: '',
    situacaoIrs: '', numeroDependentes: '', irsJovem: '', anoPrimeiroDesconto: '', primeiroEmprego: false,
    cpf: '', pis: '', ctps: '', ctpsSerie: '', ctpsDataExpedicao: '',
    rg: '', rgOrgaoEmissor: '', rgDataExpedicao: '',
    cnh: '', cnhCategoria: '', cnhDataValidade: '',
    tituloEleitor: '', zonaEleitoral: '', secaoEleitoral: '', certificadoReservista: '',
    recebeAposentadoria: false, recebeSeguroDesemprego: false, valeTransporte: false,
    numeroCartaoContinente: '',
    contactoEmergenciaNome: '', contactoEmergenciaParentesco: '', contactoEmergenciaNumero: '',
    comprovativoMoradaFiscal: '', comprovativoCartaoCidadao: '', comprovativoIban: '',
    declaracaoIrs: '', comprovativoCartaoContinente: '',
  };
}

function mapApiToForm(data: Partial<Record<string, unknown>> | null, defaults: { fullName: string; personalEmail: string; workCountry: 'PT' | 'BR'; brWorkState: string }): AdmissionForm {
  const d = data ?? {};
  return {
    nomeCompleto: str(d.nomeCompleto) || defaults.fullName,
    nomeAbreviado: str(d.nomeAbreviado) || buildAbbreviatedName(defaults.fullName),
    dataNascimento: str(d.dataNascimento),
    genero: str(d.genero),
    estadoCivil: str(d.estadoCivil),
    habilitacoesLiterarias: str(d.habilitacoesLiterarias),
    curso: str(d.curso),
    faculdade: str(d.faculdade),
    nacionalidade: str(d.nacionalidade),
    localNascimentoPais: str(d.localNascimentoPais),
    localNascimentoCidade: str(d.localNascimentoCidade),
    nomePai: str(d.nomePai),
    nomeMae: str(d.nomeMae),
    matriculaCarro: str(d.matriculaCarro),
    githubUser: str(d.githubUser),
    emailPessoal: str(d.emailPessoal) || defaults.personalEmail,
    telemovel: str(d.telemovel),
    workCountry: defaults.workCountry,
    brWorkState: str(d.brWorkState) || defaults.brWorkState,
    moradaFiscal: str(d.moradaFiscal),
    endereco: str(d.endereco),
    localidade: str(d.localidade),
    codigoPostal: str(d.codigoPostal),
    cartaoCidadao: str(d.cartaoCidadao),
    validadeCartaoCidadao: str(d.validadeCartaoCidadao),
    nif: str(d.nif),
    niss: str(d.niss),
    iban: str(d.iban),
    situacaoIrs: str(d.situacaoIrs),
    numeroDependentes: str(d.numeroDependentes),
    irsJovem: str(d.irsJovem),
    anoPrimeiroDesconto: str(d.anoPrimeiroDesconto),
    primeiroEmprego: bool(d.primeiroEmprego),
    cpf: str(d.cpf),
    pis: str(d.pis),
    ctps: str(d.ctps),
    ctpsSerie: str(d.ctpsSerie),
    ctpsDataExpedicao: str(d.ctpsDataExpedicao),
    rg: str(d.rg),
    rgOrgaoEmissor: str(d.rgOrgaoEmissor),
    rgDataExpedicao: str(d.rgDataExpedicao),
    cnh: str(d.cnh),
    cnhCategoria: str(d.cnhCategoria),
    cnhDataValidade: str(d.cnhDataValidade),
    tituloEleitor: str(d.tituloEleitor),
    zonaEleitoral: str(d.zonaEleitoral),
    secaoEleitoral: str(d.secaoEleitoral),
    certificadoReservista: str(d.certificadoReservista),
    recebeAposentadoria: bool(d.recebeAposentadoria),
    recebeSeguroDesemprego: bool(d.recebeSeguroDesemprego),
    valeTransporte: bool(d.valeTransporte),
    numeroCartaoContinente: str(d.numeroCartaoContinente),
    contactoEmergenciaNome: str(d.contactoEmergenciaNome),
    contactoEmergenciaParentesco: str(d.contactoEmergenciaParentesco),
    contactoEmergenciaNumero: str(d.contactoEmergenciaNumero),
    comprovativoMoradaFiscal: str(d.comprovativoMoradaFiscal),
    comprovativoCartaoCidadao: str(d.comprovativoCartaoCidadao),
    comprovativoIban: str(d.comprovativoIban),
    declaracaoIrs: str(d.declaracaoIrs),
    comprovativoCartaoContinente: str(d.comprovativoCartaoContinente),
  };
}

function mapFormToApi(form: AdmissionForm): Record<string, unknown> {
  return { ...form, nomeAbreviado: form.nomeAbreviado || buildAbbreviatedName(form.nomeCompleto) };
}

async function readApiError(response: Response) {
  const payload = await response.json().catch(() => ({}));
  if (payload && typeof payload === 'object' && 'message' in payload && typeof payload.message === 'string') {
    return payload.message;
  }
  return 'Ocorreu um erro inesperado.';
}

export default function EmployeeAdmissionPage() {
  const { token = '' } = useParams();
  const [admission, setAdmission] = useState<AdmissionPayload | null>(null);
  const [form, setForm] = useState<AdmissionForm | null>(null);
  const [status, setStatus] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [uploadingField, setUploadingField] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadAdmission() {
      setIsLoading(true);
      try {
        const response = await fetch(`${getApiBase()}/users/admissions/public/${token}`);
        if (!response.ok) {
          throw new Error(await readApiError(response));
        }
        const payload = await response.json() as AdmissionPayload;
        if (cancelled) return;

        setAdmission(payload);
        setForm(mapApiToForm(payload.personalData, {
          fullName: payload.fullName,
          personalEmail: payload.personalEmail,
          workCountry: payload.workCountry,
          brWorkState: payload.brWorkState || '',
        }));
      } catch (error) {
        if (!cancelled) {
          setStatus(error instanceof Error ? error.message : 'Não foi possível carregar o convite.');
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    void loadAdmission();
    return () => { cancelled = true; };
  }, [token]);

  const isReadOnly = useMemo(
    () => admission?.status === 'APPROVED_PENDING_CONTRACT' || admission?.status === 'COMPLETED',
    [admission?.status],
  );

  function updateField<K extends keyof AdmissionForm>(field: K, value: AdmissionForm[K]) {
    setForm((current) => current ? { ...current, [field]: value } : current);
  }

  async function uploadDocument(field: UploadField, file: File) {
    setUploadingField(field);
    setStatus('');
    try {
      const body = new FormData();
      body.append('file', file);
      const response = await fetch(`${getApiBase()}/files/admissions/${token}/upload`, { method: 'POST', body });
      if (!response.ok) throw new Error(await readApiError(response));
      const payload = await response.json() as { linkPath: string };
      updateField(field, `${getBackendBase()}${payload.linkPath}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Falha no upload do ficheiro.');
    } finally {
      setUploadingField(null);
    }
  }

  function handleFileChange(field: UploadField) {
    return (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;
      void uploadDocument(field, file);
      event.target.value = '';
    };
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form) return;
    setIsSubmitting(true);
    setStatus('');
    try {
      const response = await fetch(`${getApiBase()}/users/admissions/public/${token}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(mapFormToApi(form)),
      });
      if (!response.ok) throw new Error(await readApiError(response));
      setAdmission((current) => current ? { ...current, status: 'SUBMITTED', reviewReason: '' } : current);
      setStatus('sucesso');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Falha ao submeter a ficha.');
    } finally {
      setIsSubmitting(false);
    }
  }

  if (isLoading) {
    return <LoadingScreen />;
  }

  if (!admission || !form) {
    return (
      <div style={styles.pageShell}>
        <div style={{ ...styles.card, maxWidth: 480, textAlign: 'center', padding: '48px 40px' }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>🔗</div>
          <h2 style={{ margin: '0 0 8px', color: '#111827', fontSize: 22, fontWeight: 700 }}>Convite inválido</h2>
          <p style={{ margin: 0, color: '#6b7280', fontSize: 15 }}>{status || 'Este link de admissão é inválido ou já expirou. Contacta o departamento de RH.'}</p>
        </div>
      </div>
    );
  }

  const isBR = form.workCountry === 'BR';
  const isCompleted = admission.status === 'COMPLETED' || admission.status === 'APPROVED_PENDING_CONTRACT';
  const requiredFieldsSet = new Set<AdmissionRequiredFieldKey>(admission.formSettings?.requiredFields?.length
    ? admission.formSettings.requiredFields
    : DEFAULT_ADMISSION_REQUIRED_FIELDS);

  const isFieldRequired = (field: AdmissionRequiredFieldKey) => {
    if (field === 'brWorkState' && !isBR) {
      return false;
    }
    if ((field === 'declaracaoIrs' || field === 'comprovativoCartaoContinente') && isBR) {
      return false;
    }
    return requiredFieldsSet.has(field);
  };

  const alwaysVisibleFields: AdmissionRequiredFieldKey[] = ['workCountry', 'primeiroEmprego', 'recebeAposentadoria', 'recebeSeguroDesemprego', 'valeTransporte'];

  const isFieldVisible = (field: AdmissionRequiredFieldKey) => {
    if (alwaysVisibleFields.includes(field)) {
      return true;
    }
    if (field === 'brWorkState' && !isBR) {
      return false;
    }
    if ((field === 'declaracaoIrs' || field === 'comprovativoCartaoContinente') && isBR) {
      return false;
    }
    return requiredFieldsSet.has(field);
  };

  const sectionHasVisibleField = (fields: AdmissionRequiredFieldKey[]) => fields.some(isFieldVisible);

  const requiredLabel = (label: string, field: AdmissionRequiredFieldKey) => (
    `${label}${isFieldRequired(field) ? ' *' : ''}`
  );

  if (status === 'sucesso') {
    return (
      <div style={styles.pageShell}>
        <div style={{ ...styles.card, maxWidth: 480, textAlign: 'center', padding: '48px 40px' }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>✅</div>
          <h2 style={{ margin: '0 0 8px', color: '#111827', fontSize: 22, fontWeight: 700 }}>Ficha submetida!</h2>
          <p style={{ margin: 0, color: '#6b7280', fontSize: 15 }}>Os teus dados foram enviados ao RH para revisão. Irás receber uma notificação em breve.</p>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.pageShell}>
      <div style={styles.card}>

        {/* Header */}
        <div style={styles.cardHeader}>
          <div style={styles.cardHeaderBadge}>Ficha de Admissão</div>
          <h1 style={styles.cardHeaderTitle}>Bem-vindo(a) ao Smarter Hub</h1>
          <p style={styles.cardHeaderSubtitle}>Preenche os teus dados pessoais. Serão revistos pelo RH do teu país antes de criarem a tua conta.</p>
        </div>

        {/* Banners */}
        {admission.reviewReason ? (
          <div style={styles.bannerWarning}>
            <span style={{ fontSize: 18 }}>⚠️</span>
            <div>
              <p style={{ margin: '0 0 2px', fontWeight: 700, color: '#92400e' }}>Devolvido para correção</p>
              <p style={{ margin: 0, color: '#78350f', fontSize: 14 }}>{admission.reviewReason}</p>
            </div>
          </div>
        ) : null}
        {isCompleted ? (
          <div style={styles.bannerInfo}>
            <span style={{ fontSize: 18 }}>🔒</span>
            <p style={{ margin: 0, color: '#1e40af', fontSize: 14 }}>Esta ficha já seguiu para a fase contratual e está bloqueada. Contacta o RH se precisares de alterar algo.</p>
          </div>
        ) : null}
        {status && status !== 'sucesso' ? (
          <div style={styles.bannerError} aria-live="polite">
            <span style={{ fontSize: 18 }}>❌</span>
            <p style={{ margin: 0, fontSize: 14 }}>{status}</p>
          </div>
        ) : null}

        <form onSubmit={handleSubmit} style={styles.form}>

          {/* ── 1. Dados pessoais ── */}
          {sectionHasVisibleField([
            'nomeCompleto', 'nomeAbreviado', 'dataNascimento', 'genero', 'estadoCivil', 'habilitacoesLiterarias',
            'curso', 'faculdade', 'nacionalidade', 'localNascimentoPais', 'localNascimentoCidade', 'nomePai', 'nomeMae',
            'matriculaCarro', 'githubUser',
          ]) ? (
            <FormSection title="Dados pessoais" icon="👤">
              <div style={styles.grid2}>
                {isFieldVisible('nomeCompleto') ? (
                  <Field label={requiredLabel('Nome completo', 'nomeCompleto')} span={2}>
                    <input style={styles.input} value={form.nomeCompleto} onChange={(e) => updateField('nomeCompleto', e.target.value)} disabled={isReadOnly} placeholder="Nome completo" required={isFieldRequired('nomeCompleto')} />
                  </Field>
                ) : null}
                {isFieldVisible('nomeAbreviado') ? (
                  <Field label={requiredLabel('Nome abreviado', 'nomeAbreviado')}>
                    <input style={styles.input} value={form.nomeAbreviado} onChange={(e) => updateField('nomeAbreviado', e.target.value)} disabled={isReadOnly} placeholder="Nome Apelido" required={isFieldRequired('nomeAbreviado')} />
                  </Field>
                ) : null}
                {isFieldVisible('dataNascimento') ? (
                  <Field label={requiredLabel('Data de nascimento', 'dataNascimento')}>
                    <input style={styles.input} type="date" value={form.dataNascimento} onChange={(e) => updateField('dataNascimento', e.target.value)} disabled={isReadOnly} required={isFieldRequired('dataNascimento')} />
                  </Field>
                ) : null}
                {isFieldVisible('genero') ? (
                  <Field label={requiredLabel('Género', 'genero')}>
                    <select style={styles.input} value={form.genero} onChange={(e) => updateField('genero', e.target.value)} disabled={isReadOnly} required={isFieldRequired('genero')}>
                      <option value="">Selecionar</option>
                      {generoOptions.map((o) => <option key={o} value={o}>{o}</option>)}
                    </select>
                  </Field>
                ) : null}
                {isFieldVisible('estadoCivil') ? (
                  <Field label={requiredLabel('Estado civil', 'estadoCivil')}>
                    <select style={styles.input} value={form.estadoCivil} onChange={(e) => updateField('estadoCivil', e.target.value)} disabled={isReadOnly} required={isFieldRequired('estadoCivil')}>
                      <option value="">Selecionar</option>
                      {estadoCivilOptions.map((o) => <option key={o} value={o}>{o}</option>)}
                    </select>
                  </Field>
                ) : null}
                {isFieldVisible('habilitacoesLiterarias') ? (
                  <Field label={requiredLabel('Habilitações literárias', 'habilitacoesLiterarias')}>
                    <select style={styles.input} value={form.habilitacoesLiterarias} onChange={(e) => updateField('habilitacoesLiterarias', e.target.value)} disabled={isReadOnly} required={isFieldRequired('habilitacoesLiterarias')}>
                      <option value="">Selecionar</option>
                      {habilitacoesOptions.map((o) => <option key={o} value={o}>{o}</option>)}
                    </select>
                  </Field>
                ) : null}
                {isFieldVisible('curso') ? (
                  <Field label="Curso">
                    <input style={styles.input} value={form.curso} onChange={(e) => updateField('curso', e.target.value)} disabled={isReadOnly} placeholder="Engenharia Informática" />
                  </Field>
                ) : null}
                {isFieldVisible('faculdade') ? (
                  <Field label="Faculdade / Instituição">
                    <input style={styles.input} value={form.faculdade} onChange={(e) => updateField('faculdade', e.target.value)} disabled={isReadOnly} placeholder="Universidade do Porto" />
                  </Field>
                ) : null}
                {isFieldVisible('nacionalidade') ? (
                  <Field label="Nacionalidade">
                    <input style={styles.input} value={form.nacionalidade} onChange={(e) => updateField('nacionalidade', e.target.value)} disabled={isReadOnly} placeholder="Portuguesa" />
                  </Field>
                ) : null}
                {isFieldVisible('localNascimentoPais') ? (
                  <Field label="País de nascimento">
                    <input style={styles.input} value={form.localNascimentoPais} onChange={(e) => updateField('localNascimentoPais', e.target.value)} disabled={isReadOnly} placeholder="Portugal" />
                  </Field>
                ) : null}
                {isFieldVisible('localNascimentoCidade') ? (
                  <Field label="Cidade de nascimento">
                    <input style={styles.input} value={form.localNascimentoCidade} onChange={(e) => updateField('localNascimentoCidade', e.target.value)} disabled={isReadOnly} placeholder="Lisboa" />
                  </Field>
                ) : null}
                {isFieldVisible('nomePai') ? (
                  <Field label="Nome do pai">
                    <input style={styles.input} value={form.nomePai} onChange={(e) => updateField('nomePai', e.target.value)} disabled={isReadOnly} />
                  </Field>
                ) : null}
                {isFieldVisible('nomeMae') ? (
                  <Field label="Nome da mãe">
                    <input style={styles.input} value={form.nomeMae} onChange={(e) => updateField('nomeMae', e.target.value)} disabled={isReadOnly} />
                  </Field>
                ) : null}
                {isFieldVisible('matriculaCarro') ? (
                  <Field label="Matrícula do carro">
                    <input style={styles.input} value={form.matriculaCarro} onChange={(e) => updateField('matriculaCarro', e.target.value)} disabled={isReadOnly} placeholder="AA-00-BB" />
                  </Field>
                ) : null}
                {isFieldVisible('githubUser') ? (
                  <Field label="Utilizador GitHub">
                    <input style={styles.input} value={form.githubUser} onChange={(e) => updateField('githubUser', e.target.value)} disabled={isReadOnly} placeholder="@username" />
                  </Field>
                ) : null}
              </div>
            </FormSection>
          ) : null}

          {/* ── 2. Contacto ── */}
          <FormSection title="Contacto" icon="📞">
            <div style={styles.grid2}>
              {isFieldVisible('emailPessoal') ? (
                <Field label={requiredLabel('Email pessoal', 'emailPessoal')}>
                  <input style={styles.input} type="email" value={form.emailPessoal} onChange={(e) => updateField('emailPessoal', e.target.value)} disabled={isReadOnly} placeholder="email@exemplo.com" required={isFieldRequired('emailPessoal')} />
                </Field>
              ) : null}
              {isFieldVisible('telemovel') ? (
                <Field label={requiredLabel('Telemóvel', 'telemovel')}>
                  <input style={styles.input} value={form.telemovel} onChange={(e) => updateField('telemovel', e.target.value)} disabled={isReadOnly} placeholder="+351 900 000 000" required={isFieldRequired('telemovel')} />
                </Field>
              ) : null}
              <Field label="País de trabalho">
                <select style={styles.input} value={form.workCountry} disabled>
                  <option value="PT">🇵🇹 Portugal</option>
                  <option value="BR">🇧🇷 Brasil</option>
                </select>
              </Field>
              {isBR && isFieldVisible('brWorkState') ? (
                <Field label={requiredLabel('Estado (BR)', 'brWorkState')}>
                  <select style={styles.input} value={form.brWorkState} onChange={(e) => updateField('brWorkState', e.target.value)} disabled={isReadOnly} required={isFieldRequired('brWorkState')}>
                    <option value="">Selecionar estado</option>
                    {BRAZIL_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </Field>
              ) : null}
            </div>
          </FormSection>

          {/* ── 3. Morada ── */}
          {sectionHasVisibleField(['moradaFiscal', 'codigoPostal', 'localidade']) ? (
            <FormSection title="Morada" icon="🏠">
              <div style={styles.grid2}>
                {isFieldVisible('moradaFiscal') ? (
                  <Field label={requiredLabel('Morada fiscal', 'moradaFiscal')} span={2}>
                    <input style={styles.input} value={form.moradaFiscal} onChange={(e) => { updateField('moradaFiscal', e.target.value); updateField('endereco', e.target.value); }} disabled={isReadOnly} placeholder="Rua, número, andar…" required={isFieldRequired('moradaFiscal')} />
                  </Field>
                ) : null}
                {isFieldVisible('codigoPostal') ? (
                  <Field label={requiredLabel(isBR ? 'CEP' : 'Código postal', 'codigoPostal')}>
                    <input style={styles.input} value={form.codigoPostal} onChange={(e) => updateField('codigoPostal', e.target.value)} disabled={isReadOnly} placeholder={isBR ? '00000-000' : '0000-000'} required={isFieldRequired('codigoPostal')} />
                  </Field>
                ) : null}
                {isFieldVisible('localidade') ? (
                  <Field label={requiredLabel('Localidade', 'localidade')}>
                    <input style={styles.input} value={form.localidade} onChange={(e) => updateField('localidade', e.target.value)} disabled={isReadOnly} placeholder="Lisboa" required={isFieldRequired('localidade')} />
                  </Field>
                ) : null}
              </div>
            </FormSection>
          ) : null}

          {/* ── 4a. Documentos PT ── */}
          {!isBR && sectionHasVisibleField(['cartaoCidadao', 'validadeCartaoCidadao', 'nif', 'niss', 'iban', 'situacaoIrs', 'numeroDependentes', 'irsJovem', 'anoPrimeiroDesconto', 'primeiroEmprego']) ? (
            <FormSection title="Identificação e dados fiscais" icon="📋">
              <div style={styles.grid2}>
                {isFieldVisible('cartaoCidadao') ? (
                  <Field label="N.º Cartão de Cidadão">
                    <input style={styles.input} value={form.cartaoCidadao} onChange={(e) => updateField('cartaoCidadao', e.target.value)} disabled={isReadOnly} />
                  </Field>
                ) : null}
                {isFieldVisible('validadeCartaoCidadao') ? (
                  <Field label="Validade do CC">
                    <input style={styles.input} type="date" value={form.validadeCartaoCidadao} onChange={(e) => updateField('validadeCartaoCidadao', e.target.value)} disabled={isReadOnly} />
                  </Field>
                ) : null}
                {isFieldVisible('nif') ? (
                  <Field label="NIF">
                    <input style={styles.input} value={form.nif} onChange={(e) => updateField('nif', e.target.value)} disabled={isReadOnly} placeholder="000 000 000" />
                  </Field>
                ) : null}
                {isFieldVisible('niss') ? (
                  <Field label="N.º Segurança Social (NISS)">
                    <input style={styles.input} value={form.niss} onChange={(e) => updateField('niss', e.target.value)} disabled={isReadOnly} />
                  </Field>
                ) : null}
                {isFieldVisible('iban') ? (
                  <Field label="IBAN">
                    <input style={styles.input} value={form.iban} onChange={(e) => updateField('iban', e.target.value)} disabled={isReadOnly} placeholder="PT50 0000 0000 0000 0000 0000 0" />
                  </Field>
                ) : null}
                {isFieldVisible('situacaoIrs') ? (
                  <Field label="Situação IRS">
                    <select style={styles.input} value={form.situacaoIrs} onChange={(e) => updateField('situacaoIrs', e.target.value)} disabled={isReadOnly}>
                      <option value="">Selecionar</option>
                      {situacaoIrsOptions.map((o) => <option key={o} value={o}>{o}</option>)}
                    </select>
                  </Field>
                ) : null}
                {isFieldVisible('numeroDependentes') ? (
                  <Field label="N.º de dependentes">
                    <input style={styles.input} type="number" min="0" value={form.numeroDependentes} onChange={(e) => updateField('numeroDependentes', e.target.value)} disabled={isReadOnly} placeholder="0" />
                  </Field>
                ) : null}
                {isFieldVisible('irsJovem') ? (
                  <Field label="IRS Jovem">
                    <select style={styles.input} value={form.irsJovem} onChange={(e) => updateField('irsJovem', e.target.value)} disabled={isReadOnly}>
                      <option value="">Selecionar</option>
                      {irsJovemOptions.map((o) => <option key={o} value={o}>{o}</option>)}
                    </select>
                  </Field>
                ) : null}
                {isFieldVisible('anoPrimeiroDesconto') ? (
                  <Field label="Ano do 1.º desconto IRS">
                    <input style={styles.input} value={form.anoPrimeiroDesconto} onChange={(e) => updateField('anoPrimeiroDesconto', e.target.value)} disabled={isReadOnly} placeholder="2024" />
                  </Field>
                ) : null}
                {isFieldVisible('primeiroEmprego') ? (
                  <div style={{ paddingTop: 20 }}>
                    <CheckField label="1.º emprego" checked={form.primeiroEmprego} onChange={(v) => updateField('primeiroEmprego', v)} disabled={isReadOnly} />
                  </div>
                ) : null}
              </div>
            </FormSection>
          ) : null}

          {/* ── 4b. Documentos BR ── */}
          {isBR && sectionHasVisibleField([
            'cpf', 'pis', 'ctps', 'ctpsSerie', 'ctpsDataExpedicao', 'rg', 'rgOrgaoEmissor', 'rgDataExpedicao',
            'cnh', 'cnhCategoria', 'cnhDataValidade', 'tituloEleitor', 'zonaEleitoral', 'secaoEleitoral', 'certificadoReservista',
            'iban', 'numeroDependentes', 'recebeAposentadoria', 'recebeSeguroDesemprego', 'valeTransporte',
          ]) ? (
            <FormSection title="Identificação e dados fiscais (Brasil)" icon="📋">
              <div style={styles.grid2}>
                {isFieldVisible('cpf') ? (
                  <Field label="CPF">
                    <input style={styles.input} value={form.cpf} onChange={(e) => updateField('cpf', e.target.value)} disabled={isReadOnly} placeholder="000.000.000-00" />
                  </Field>
                ) : null}
                {isFieldVisible('pis') ? (
                  <Field label="PIS / NIT">
                    <input style={styles.input} value={form.pis} onChange={(e) => updateField('pis', e.target.value)} disabled={isReadOnly} />
                  </Field>
                ) : null}
                {isFieldVisible('ctps') ? (
                  <Field label="CTPS">
                    <input style={styles.input} value={form.ctps} onChange={(e) => updateField('ctps', e.target.value)} disabled={isReadOnly} />
                  </Field>
                ) : null}
                {isFieldVisible('ctpsSerie') ? (
                  <Field label="CTPS Série">
                    <input style={styles.input} value={form.ctpsSerie} onChange={(e) => updateField('ctpsSerie', e.target.value)} disabled={isReadOnly} />
                  </Field>
                ) : null}
                {isFieldVisible('ctpsDataExpedicao') ? (
                  <Field label="Data de expedição CTPS">
                    <input style={styles.input} type="date" value={form.ctpsDataExpedicao} onChange={(e) => updateField('ctpsDataExpedicao', e.target.value)} disabled={isReadOnly} />
                  </Field>
                ) : null}
                {isFieldVisible('rg') ? (
                  <Field label="RG">
                    <input style={styles.input} value={form.rg} onChange={(e) => updateField('rg', e.target.value)} disabled={isReadOnly} />
                  </Field>
                ) : null}
                {isFieldVisible('rgOrgaoEmissor') ? (
                  <Field label="Órgão emissor RG">
                    <input style={styles.input} value={form.rgOrgaoEmissor} onChange={(e) => updateField('rgOrgaoEmissor', e.target.value)} disabled={isReadOnly} placeholder="SSP/SP" />
                  </Field>
                ) : null}
                {isFieldVisible('rgDataExpedicao') ? (
                  <Field label="Data de expedição RG">
                    <input style={styles.input} type="date" value={form.rgDataExpedicao} onChange={(e) => updateField('rgDataExpedicao', e.target.value)} disabled={isReadOnly} />
                  </Field>
                ) : null}
                {isFieldVisible('cnh') ? (
                  <Field label="CNH (opcional)">
                    <input style={styles.input} value={form.cnh} onChange={(e) => updateField('cnh', e.target.value)} disabled={isReadOnly} />
                  </Field>
                ) : null}
                {isFieldVisible('cnhCategoria') ? (
                  <Field label="Categoria CNH">
                    <input style={styles.input} value={form.cnhCategoria} onChange={(e) => updateField('cnhCategoria', e.target.value)} disabled={isReadOnly} placeholder="B" />
                  </Field>
                ) : null}
                {isFieldVisible('cnhDataValidade') ? (
                  <Field label="Validade CNH">
                    <input style={styles.input} type="date" value={form.cnhDataValidade} onChange={(e) => updateField('cnhDataValidade', e.target.value)} disabled={isReadOnly} />
                  </Field>
                ) : null}
                {isFieldVisible('tituloEleitor') ? (
                  <Field label="Título de eleitor">
                    <input style={styles.input} value={form.tituloEleitor} onChange={(e) => updateField('tituloEleitor', e.target.value)} disabled={isReadOnly} />
                  </Field>
                ) : null}
                {isFieldVisible('zonaEleitoral') ? (
                  <Field label="Zona eleitoral">
                    <input style={styles.input} value={form.zonaEleitoral} onChange={(e) => updateField('zonaEleitoral', e.target.value)} disabled={isReadOnly} />
                  </Field>
                ) : null}
                {isFieldVisible('secaoEleitoral') ? (
                  <Field label="Secção eleitoral">
                    <input style={styles.input} value={form.secaoEleitoral} onChange={(e) => updateField('secaoEleitoral', e.target.value)} disabled={isReadOnly} />
                  </Field>
                ) : null}
                {isFieldVisible('certificadoReservista') ? (
                  <Field label="Certificado de reservista (opcional)">
                    <input style={styles.input} value={form.certificadoReservista} onChange={(e) => updateField('certificadoReservista', e.target.value)} disabled={isReadOnly} />
                  </Field>
                ) : null}
                {isFieldVisible('iban') ? (
                  <Field label="IBAN / Conta bancária">
                    <input style={styles.input} value={form.iban} onChange={(e) => updateField('iban', e.target.value)} disabled={isReadOnly} />
                  </Field>
                ) : null}
                {isFieldVisible('numeroDependentes') ? (
                  <Field label="N.º de dependentes">
                    <input style={styles.input} type="number" min="0" value={form.numeroDependentes} onChange={(e) => updateField('numeroDependentes', e.target.value)} disabled={isReadOnly} placeholder="0" />
                  </Field>
                ) : null}
                {isFieldVisible('recebeAposentadoria') || isFieldVisible('recebeSeguroDesemprego') || isFieldVisible('valeTransporte') ? (
                  <div style={{ paddingTop: 20 }}>
                    {isFieldVisible('recebeAposentadoria') ? <CheckField label="Recebe aposentadoria" checked={form.recebeAposentadoria} onChange={(v) => updateField('recebeAposentadoria', v)} disabled={isReadOnly} /> : null}
                    {isFieldVisible('recebeSeguroDesemprego') ? <CheckField label="Recebe seguro-desemprego" checked={form.recebeSeguroDesemprego} onChange={(v) => updateField('recebeSeguroDesemprego', v)} disabled={isReadOnly} /> : null}
                    {isFieldVisible('valeTransporte') ? <CheckField label="Vale transporte" checked={form.valeTransporte} onChange={(v) => updateField('valeTransporte', v)} disabled={isReadOnly} /> : null}
                  </div>
                ) : null}
              </div>
            </FormSection>
          ) : null}

          {/* ── 5. Benefícios PT ── */}
          {!isBR && isFieldVisible('numeroCartaoContinente') ? (
            <FormSection title="Benefícios" icon="🎁">
              <div style={styles.grid2}>
                <Field label="N.º Cartão Continente">
                  <input style={styles.input} value={form.numeroCartaoContinente} onChange={(e) => updateField('numeroCartaoContinente', e.target.value)} disabled={isReadOnly} />
                </Field>
              </div>
            </FormSection>
          ) : null}

          {/* ── 6. Contacto de emergência ── */}
          {sectionHasVisibleField(['contactoEmergenciaNome', 'contactoEmergenciaParentesco', 'contactoEmergenciaNumero']) ? (
            <FormSection title="Contacto de emergência" icon="🚨">
              <div style={styles.grid2}>
                {isFieldVisible('contactoEmergenciaNome') ? (
                  <Field label={requiredLabel('Nome', 'contactoEmergenciaNome')}>
                    <input style={styles.input} value={form.contactoEmergenciaNome} onChange={(e) => updateField('contactoEmergenciaNome', e.target.value)} disabled={isReadOnly} required={isFieldRequired('contactoEmergenciaNome')} />
                  </Field>
                ) : null}
                {isFieldVisible('contactoEmergenciaParentesco') ? (
                  <Field label={requiredLabel('Parentesco', 'contactoEmergenciaParentesco')}>
                    <select style={styles.input} value={form.contactoEmergenciaParentesco} onChange={(e) => updateField('contactoEmergenciaParentesco', e.target.value)} disabled={isReadOnly} required={isFieldRequired('contactoEmergenciaParentesco')}>
                      <option value="">Selecionar</option>
                      {parentescoOptions.map((o) => <option key={o} value={o}>{o}</option>)}
                    </select>
                  </Field>
                ) : null}
                {isFieldVisible('contactoEmergenciaNumero') ? (
                  <Field label={requiredLabel('Telefone', 'contactoEmergenciaNumero')}>
                    <input style={styles.input} value={form.contactoEmergenciaNumero} onChange={(e) => updateField('contactoEmergenciaNumero', e.target.value)} disabled={isReadOnly} placeholder="+351 900 000 000" required={isFieldRequired('contactoEmergenciaNumero')} />
                  </Field>
                ) : null}
              </div>
            </FormSection>
          ) : null}

          {/* ── 7. Documentos ── */}
          {sectionHasVisibleField(['comprovativoMoradaFiscal', 'comprovativoCartaoCidadao', 'comprovativoIban', 'declaracaoIrs', 'comprovativoCartaoContinente']) ? (
            <FormSection title="Documentos" icon="📎">
              <p style={{ margin: '0 0 16px', color: '#6b7280', fontSize: 14 }}>
                Faz upload dos documentos solicitados em formato PDF, JPG ou PNG (máx. 10 MB cada).
              </p>
              <div style={styles.grid2}>
                {([
                  { field: 'comprovativoMoradaFiscal' as UploadField, label: 'Comprovativo de morada', icon: '🏠', required: isFieldRequired('comprovativoMoradaFiscal') },
                  { field: 'comprovativoCartaoCidadao' as UploadField, label: isBR ? 'Documento de identificação (RG/CNH)' : 'Cartão de Cidadão', icon: '🪪', required: isFieldRequired('comprovativoCartaoCidadao') },
                  { field: 'comprovativoIban' as UploadField, label: 'Comprovativo de IBAN / conta bancária', icon: '🏦', required: isFieldRequired('comprovativoIban') },
                  ...(!isBR ? [{ field: 'declaracaoIrs' as UploadField, label: 'Declaração IRS', icon: '📄', required: isFieldRequired('declaracaoIrs') }] : []),
                  ...(!isBR ? [{ field: 'comprovativoCartaoContinente' as UploadField, label: 'Comprovativo Cartão Continente', icon: '🛒', required: isFieldRequired('comprovativoCartaoContinente') }] : []),
                ]).filter(({ field }) => isFieldVisible(field as AdmissionRequiredFieldKey)).map(({ field, label, icon, required }) => (
                  <div key={field} style={styles.fileZone}>
                    <div style={styles.fileZoneIcon}>{icon}</div>
                    <p style={styles.fileZoneLabel}>{label}{required ? ' *' : ''}</p>
                    {form[field] ? (
                      <a href={form[field] as string} target="_blank" rel="noreferrer" style={styles.fileZoneLink}>
                        ✅ Ficheiro carregado — ver
                      </a>
                    ) : (
                      <p style={styles.fileZonePlaceholder}>{uploadingField === field ? 'A carregar…' : 'Nenhum ficheiro'}</p>
                    )}
                    {!isReadOnly ? (
                      <label style={uploadingField !== null || isReadOnly ? { ...styles.fileZoneBtn, opacity: 0.5, cursor: 'not-allowed' } : styles.fileZoneBtn}>
                        {uploadingField === field ? 'A carregar…' : form[field] ? 'Substituir' : 'Escolher ficheiro'}
                        <input type="file" style={{ display: 'none' }} onChange={handleFileChange(field)} disabled={isReadOnly || uploadingField !== null} accept=".pdf,.jpg,.jpeg,.png" />
                      </label>
                    ) : null}
                  </div>
                ))}
              </div>
            </FormSection>
          ) : null}

          {/* ── Acções ── */}
          {!isReadOnly ? (
            <div style={styles.formActions}>
              <Button type="submit" variant="primary" disabled={isSubmitting || uploadingField !== null}>
                {isSubmitting ? 'A submeter…' : 'Submeter ficha'}
              </Button>
            </div>
          ) : null}
        </form>

        {/* Footer */}
        <div style={styles.cardFooter}>
          <p style={{ margin: 0, color: '#9ca3af', fontSize: 12, textAlign: 'center' }}>
            Os teus dados são tratados de forma confidencial e em conformidade com o RGPD. · Smarter Hub · Tlantic
          </p>
        </div>
      </div>
    </div>
  );
}

/* ── Sub-componentes ── */

function FormSection({ title, icon, children }: { title: string; icon: string; children: React.ReactNode }) {
  return (
    <div style={styles.section}>
      <div style={styles.sectionHeader}>
        <span style={styles.sectionIcon}>{icon}</span>
        <h3 style={styles.sectionTitle}>{title}</h3>
      </div>
      <div style={styles.sectionBody}>{children}</div>
    </div>
  );
}

function Field({ label, children, span }: { label: string; children: React.ReactNode; span?: number }) {
  return (
    <div style={span === 2 ? { gridColumn: 'span 2' } : undefined}>
      <label style={styles.fieldLabel}>{label}</label>
      {children}
    </div>
  );
}

function CheckField({ label, checked, onChange, disabled }: { label: string; checked: boolean; onChange: (v: boolean) => void; disabled: boolean }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: disabled ? 'default' : 'pointer', marginBottom: 8, fontSize: 14, color: '#374151' }}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} disabled={disabled} style={{ width: 16, height: 16, accentColor: '#1a56db' }} />
      {label}
    </label>
  );
}

/* ── Estilos ── */

const styles = {
  pageShell: {
    minHeight: '100vh',
    background: 'linear-gradient(135deg, #1a56db 0%, #0e3f9e 60%, #1e3a5f 100%)',
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'center',
    padding: '40px 16px 80px',
  } as React.CSSProperties,
  card: {
    background: '#ffffff',
    borderRadius: 20,
    boxShadow: '0 24px 64px rgba(0,0,0,0.18)',
    width: '100%',
    maxWidth: 800,
    overflow: 'hidden',
  } as React.CSSProperties,
  cardHeader: {
    background: 'linear-gradient(135deg, #1a56db 0%, #0e3f9e 100%)',
    padding: '36px 40px 32px',
    color: '#fff',
  } as React.CSSProperties,
  cardHeaderBadge: {
    display: 'inline-block',
    background: 'rgba(255,255,255,0.15)',
    borderRadius: 20,
    padding: '4px 14px',
    fontSize: 12,
    fontWeight: 600,
    letterSpacing: '0.5px',
    textTransform: 'uppercase' as const,
    marginBottom: 12,
    color: 'rgba(255,255,255,0.9)',
  } as React.CSSProperties,
  cardHeaderTitle: { margin: '0 0 6px', fontSize: 28, fontWeight: 800, letterSpacing: '-0.5px' } as React.CSSProperties,
  cardHeaderSubtitle: { margin: 0, fontSize: 15, color: 'rgba(255,255,255,0.78)', lineHeight: 1.6 } as React.CSSProperties,
  bannerWarning: {
    display: 'flex', alignItems: 'flex-start', gap: 12,
    background: '#fffbeb', borderTop: '1px solid #fcd34d', borderBottom: '1px solid #fcd34d', padding: '16px 40px',
  } as React.CSSProperties,
  bannerInfo: {
    display: 'flex', alignItems: 'flex-start', gap: 12,
    background: '#eff6ff', borderTop: '1px solid #bfdbfe', borderBottom: '1px solid #bfdbfe', padding: '16px 40px',
  } as React.CSSProperties,
  bannerError: {
    display: 'flex', alignItems: 'flex-start', gap: 12,
    background: '#fef2f2', borderTop: '1px solid #fecaca', borderBottom: '1px solid #fecaca', padding: '16px 40px', color: '#991b1b',
  } as React.CSSProperties,
  form: { padding: '8px 0' } as React.CSSProperties,
  section: { borderBottom: '1px solid #f3f4f6' } as React.CSSProperties,
  sectionHeader: { display: 'flex', alignItems: 'center', gap: 10, padding: '20px 40px 0', marginBottom: 16 } as React.CSSProperties,
  sectionIcon: { fontSize: 18, lineHeight: 1 } as React.CSSProperties,
  sectionTitle: { margin: 0, fontSize: 15, fontWeight: 700, color: '#111827', letterSpacing: '-0.2px' } as React.CSSProperties,
  sectionBody: { padding: '0 40px 24px' } as React.CSSProperties,
  grid2: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px 20px' } as React.CSSProperties,
  fieldLabel: {
    display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 5,
    textTransform: 'uppercase' as const, letterSpacing: '0.4px',
  } as React.CSSProperties,
  input: {
    display: 'block', width: '100%', boxSizing: 'border-box' as const,
    padding: '9px 12px', border: '1.5px solid #e5e7eb', borderRadius: 8,
    fontSize: 14, color: '#111827', background: '#fff', outline: 'none',
    transition: 'border-color 0.15s', fontFamily: 'inherit',
  } as React.CSSProperties,
  fileZone: {
    border: '1.5px dashed #d1d5db', borderRadius: 12, padding: '20px 16px',
    display: 'flex', flexDirection: 'column' as const, alignItems: 'center', gap: 6,
    textAlign: 'center' as const, background: '#fafafa',
  } as React.CSSProperties,
  fileZoneIcon: { fontSize: 28, lineHeight: 1 } as React.CSSProperties,
  fileZoneLabel: { margin: 0, fontSize: 13, fontWeight: 600, color: '#374151' } as React.CSSProperties,
  fileZonePlaceholder: { margin: 0, fontSize: 12, color: '#9ca3af' } as React.CSSProperties,
  fileZoneLink: { fontSize: 13, color: '#1a56db', textDecoration: 'none', fontWeight: 500 } as React.CSSProperties,
  fileZoneBtn: {
    marginTop: 4, display: 'inline-block', background: '#1a56db', color: '#fff',
    fontSize: 12, fontWeight: 600, padding: '7px 16px', borderRadius: 8,
    cursor: 'pointer', border: 'none', userSelect: 'none' as const,
  } as React.CSSProperties,
  formActions: {
    padding: '24px 40px', borderTop: '1px solid #f3f4f6',
    display: 'flex', justifyContent: 'flex-end',
  } as React.CSSProperties,
  cardFooter: { background: '#f9fafb', borderTop: '1px solid #e5e7eb', padding: '16px 40px' } as React.CSSProperties,
} satisfies Record<string, React.CSSProperties>;
