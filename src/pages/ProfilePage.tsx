import { ChangeEvent, MouseEvent, useEffect, useMemo, useState } from 'react';
import {
  estadoCivilOptions,
  generoOptions,
  habilitacoesOptions,
  irsJovemOptions,
  parentescoOptions,
  regimeHorarioOptions,
  situacaoIrsOptions,
  tipoContratoOptions,
} from '../portal/data';
import { getApiBase, getBackendBase, authHeaders } from '../portal/api';
import { usePortal } from '../portal/context';
import { useFeedbackToast } from '../portal/useFeedbackToast';
import { ProfileData, ProfileFieldError } from '../portal/types';
import Button from '../components/ui/Button';
import Modal from '../components/ui/Modal';

type SectionKey = 'personal' | 'contacts' | 'documents' | 'tax' | 'emergency' | 'contract';

const profileSections: Array<{ key: SectionKey; label: string }> = [
  { key: 'personal', label: 'Identificação' },
  { key: 'contacts', label: 'Contactos' },
  { key: 'documents', label: 'Documentos' },
  { key: 'tax', label: 'IRS e benefícios' },
  { key: 'emergency', label: 'Emergência' },
  { key: 'contract', label: 'Contrato' },
];

const STORAGE_TOKEN_KEY = 'smarter_hub_auth_token';

const profileFieldLabels: Partial<Record<keyof ProfileData, string>> = {
  primeiroNome: 'Primeiro nome',
  apelido: 'Apelido',
  nomeAbreviado: 'Nome abreviado',
  dataNascimento: 'Data de nascimento',
  genero: 'Género',
  estadoCivil: 'Estado civil',
  habilitacoesLiterarias: 'Habilitações literárias',
  curso: 'Curso',
  faculdade: 'Faculdade',
  emailPessoal: 'Email pessoal',
  telemovel: 'Telemóvel',
  moradaFiscal: 'Morada normal',
  endereco: 'Morada normal',
  localidade: 'Localidade',
  codigoPostal: 'Código postal',
  matriculaCarro: 'Matrícula do carro',
  cartaoCidadao: 'Cartão de cidadão',
  nif: 'NIF',
  niss: 'NISS',
  iban: 'IBAN',
  situacaoIrs: 'Situação IRS',
  numeroDependentes: 'Número de dependentes',
  irsJovem: 'IRS Jovem',
  anoPrimeiroDesconto: 'Ano do primeiro desconto',
  numeroCartaoContinente: 'Número cartão continente',
  voucherNosData: 'Voucher NOS',
  comprovativoMoradaFiscal: 'Comprovativo morada fiscal',
  comprovativoCartaoCidadao: 'Comprovativo cartão cidadão',
  comprovativoIban: 'Comprovativo IBAN',
  comprovativoCartaoContinente: 'Comprovativo cartão continente',
  contactoEmergenciaNome: 'Contacto de emergência - nome',
  contactoEmergenciaParentesco: 'Contacto de emergência - parentesco',
  contactoEmergenciaNumero: 'Contacto de emergência - número',
  cargo: 'Cargo',
  funcao: 'Função',
  dataInicioContrato: 'Data de início do contrato',
  dataFimContrato: 'Data de fim do contrato',
  remuneracao: 'Remuneração',
  tipoContrato: 'Tipo de contrato',
  regimeHorario: 'Regime horário',
  workCountry: 'País de trabalho',
};

const consolidatedAddressFields: Array<keyof ProfileData> = ['moradaFiscal', 'endereco'];

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

function validateProfile(profile: ProfileData, canEditContract: boolean = true): ProfileFieldError {
  const errors: ProfileFieldError = {};

  const contractFields: Array<keyof ProfileData> = [
    'cargo',
    'funcao',
    'dataInicioContrato',
    'remuneracao',
    'tipoContrato',
    'regimeHorario',
  ];

  const requiredKeys: Array<keyof ProfileData> = [
    'primeiroNome',
    'apelido',
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
    'cartaoCidadao',
    'nif',
    'niss',
    'iban',
    'situacaoIrs',
    'numeroDependentes',
    'irsJovem',
    'anoPrimeiroDesconto',
    'comprovativoMoradaFiscal',
    'comprovativoCartaoCidadao',
    'comprovativoIban',
    'contactoEmergenciaNome',
    'contactoEmergenciaParentesco',
    'contactoEmergenciaNumero',
    ...(canEditContract ? contractFields : []),
  ];

  requiredKeys.forEach((key) => {
    if (!profile[key].trim()) {
      errors[key] = 'Campo obrigatório.';
    }
  });

  if (profile.emailPessoal && !/^\S+@\S+\.\S+$/.test(profile.emailPessoal)) {
    errors.emailPessoal = 'Email inválido.';
  }

  if (profile.nif && !/^\d{9}$/.test(profile.nif)) {
    errors.nif = 'O NIF deve ter 9 dígitos.';
  }

  if (profile.numeroDependentes && !/^\d+$/.test(profile.numeroDependentes)) {
    errors.numeroDependentes = 'Use apenas números inteiros.';
  }

  if (profile.anoPrimeiroDesconto && !/^\d{4}$/.test(profile.anoPrimeiroDesconto)) {
    errors.anoPrimeiroDesconto = 'Indique o ano com 4 dígitos.';
  }

  return errors;
}

export default function ProfilePage() {
  const { profile, saveProfile, hasPermission, isRootAccess, isAccessTotal, currentUser } = usePortal();

  const [draftProfile, setDraftProfile] = useState<ProfileData>(profile);
  const [editingSections, setEditingSections] = useState<Record<SectionKey, boolean>>({
    personal: false,
    contacts: false,
    documents: false,
    tax: false,
    emergency: false,
    contract: false,
  });
  const [profileErrors, setProfileErrors] = useState<ProfileFieldError>({});
  const { toast, showToast } = useFeedbackToast(3400);
  const [isSaving, setIsSaving] = useState(false);
  const [currentSection, setCurrentSection] = useState<SectionKey>('personal');
  const [hasPendingRequest, setHasPendingRequest] = useState(false);
  const [pendingRequestLabel, setPendingRequestLabel] = useState('');
  const [pendingChanges, setPendingChanges] = useState<string[]>([]);
  const [isRequestFeedbackOpen, setIsRequestFeedbackOpen] = useState(false);
  const [showSeparateAddresses, setShowSeparateAddresses] = useState(false);
  const [isCompletionHelpOpen, setIsCompletionHelpOpen] = useState(false);

  const canEdit =
    isRootAccess
    || hasPermission('edit_profile')
    || hasPermission('request_profile_change')
    || hasPermission('edit_other_profile');
  const canEditContract = isRootAccess || hasPermission('edit_other_profile');
  const requestMode = !isRootAccess && (isAccessTotal || hasPermission('request_profile_change') || !canEditContract);
  const teamName = currentUser?.team?.name?.trim() || 'Sem equipa';

  const profileCompletion = useMemo(() => {
    const fields = Object.values(draftProfile);
    const filled = fields.filter((item) => item.trim().length > 0).length;
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

  const collaboratorName = useMemo(() => `${draftProfile.primeiroNome} ${draftProfile.apelido}`.trim(), [draftProfile.apelido, draftProfile.primeiroNome]);
  const hasUnsavedChanges = useMemo(() => JSON.stringify(draftProfile) !== JSON.stringify(profile), [draftProfile, profile]);

  useEffect(() => {
    setDraftProfile(profile);
  }, [profile]);

  useEffect(() => {
    const hasDifferentAddress = profile.moradaFiscal.trim().length > 0
      && profile.endereco.trim().length > 0
      && profile.moradaFiscal.trim() !== profile.endereco.trim();
    setShowSeparateAddresses(hasDifferentAddress);
  }, [profile.endereco, profile.moradaFiscal]);

  useEffect(() => {
    const token = localStorage.getItem(STORAGE_TOKEN_KEY) || '';
    if (!token) {
      return;
    }

    (async () => {
      try {
        const response = await fetch(`${getApiBase()}/profile/requests/me`, {
          headers: authHeaders(token),
        });

        if (!response.ok) {
          return;
        }

        const payload = (await response.json()) as {
          pending?: boolean;
          request?: {
            changesSummary?: string;
            createdAt?: string;
          } | null;
        };

        const pending = Boolean(payload.pending);
        setHasPendingRequest(pending);
        const summary = pending ? payload.request?.changesSummary || 'Pedido de alteração em análise pela equipa RH.' : '';
        setPendingRequestLabel(summary);
        
        // Parse campos individuais da lista
        if (summary && summary.includes(':')) {
          const parts = summary.split(':');
          const fieldsList = parts[1] || '';
          const fields = fieldsList
            .split(',')
            .map(f => f.trim())
            .filter(f => f.length > 0);
          setPendingChanges(fields);
        } else {
          setPendingChanges([]);
        }
      } catch {
        // Silencioso para não bloquear a edição da ficha se este fetch falhar.
      }
    })();
  }, []);

  function closeAllEditingSections() {
    setEditingSections({
      personal: false,
      contacts: false,
      documents: false,
      tax: false,
      emergency: false,
      contract: false,
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
      handleProfileChange(field, payload.linkPath || payload.link || '');
      showToast('success', 'Ficheiro carregado com sucesso.');
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

    if (requestMode) {
      setHasPendingRequest(true);
      setPendingRequestLabel(result.message || 'Pedido enviado para aprovação.');
      setDraftProfile(profile);
      closeAllEditingSections();
      setIsRequestFeedbackOpen(true);
      return;
    }

    showToast('success', result.message || 'Alterações guardadas com sucesso.');
  }

  return (
    <>
      <section className="profile-hero">
        <div className="hero-main">
          <p className="hero-kicker">Ficha de colaborador</p>
          <h1>{profile.nomeAbreviado || collaboratorName}</h1>
          <div className="profile-hero__meta">
            <span>{profile.cargo || 'Cargo por definir'}</span>
            <span>{teamName}</span>
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
              <span className="completion-card__button-label">O que falta?</span>
              <span className="completion-card__button-count">{completionIssueEntries.length}</span>
            </Button>
          </div>
        </div>
      </section>

      {hasPendingRequest && (
        <section className="profile-request-banner" role="status" aria-live="polite">
          <div>
            <strong>Pedido em análise</strong>
            {pendingChanges.length > 0 && (
              <div className="profile-request-fields">
                {pendingChanges.map((field) => (
                  <span key={field} className="profile-request-field-badge">
                    {field}
                  </span>
                ))}
              </div>
            )}
          </div>
        </section>
      )}

      <nav className="profile-stepper" aria-label="Navegação por etapas da ficha">
        {profileSections.map((section) => (
          <button
            key={section.key}
            type="button"
            className={`profile-stepper__item${currentSection === section.key ? ' is-active' : ''}`}
            onClick={() => setCurrentSection(section.key)}
          >
            {section.label}
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
            <h2>1. Identificação pessoal</h2>
            {canEdit && (
              <button className={`section-edit-button${editingSections.personal ? ' is-active' : ''}`} type="button" onClick={() => toggleSectionEdit('personal')}>
                ✏️
              </button>
            )}
          </div>
          <div className="profile-fields profile-fields--3">
            <label>
              <span>Primeiro nome</span>
              <input type="text" value={draftProfile.primeiroNome} disabled={!editingSections.personal} onChange={(event) => handleProfileChange('primeiroNome', event.target.value)} />
              {profileErrors.primeiroNome && <small>{profileErrors.primeiroNome}</small>}
            </label>
            <label>
              <span>Apelido</span>
              <input type="text" value={draftProfile.apelido} disabled={!editingSections.personal} onChange={(event) => handleProfileChange('apelido', event.target.value)} />
              {profileErrors.apelido && <small>{profileErrors.apelido}</small>}
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
              <span>Estado civil</span>
              <select value={draftProfile.estadoCivil} disabled={!editingSections.personal} onChange={(event) => handleProfileChange('estadoCivil', event.target.value)}>
                <option value="">Selecionar</option>
                {estadoCivilOptions.map((option) => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>
              {profileErrors.estadoCivil && <small>{profileErrors.estadoCivil}</small>}
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
          </div>
        </article>
        )}

        {currentSection === 'contacts' && (
        <article className="profile-card profile-card--full">
          <div className="section-headline">
            <h2>2. Contactos e moradas</h2>
            {canEdit && (
              <button className={`section-edit-button${editingSections.contacts ? ' is-active' : ''}`} type="button" onClick={() => toggleSectionEdit('contacts')}>
                ✏️
              </button>
            )}
          </div>
          <div className="profile-fields profile-fields--3">
            <label>
              <span>Email pessoal</span>
              <input type="email" value={draftProfile.emailPessoal} disabled={!editingSections.contacts} onChange={(event) => handleProfileChange('emailPessoal', event.target.value)} />
              {profileErrors.emailPessoal && <small>{profileErrors.emailPessoal}</small>}
            </label>
            <label>
              <span>Telemóvel</span>
              <input type="text" value={draftProfile.telemovel} disabled={!editingSections.contacts} onChange={(event) => handleProfileChange('telemovel', event.target.value)} />
              {profileErrors.telemovel && <small>{profileErrors.telemovel}</small>}
            </label>
            <label>
              <span>Matrícula do carro</span>
              <input type="text" value={draftProfile.matriculaCarro} disabled={!editingSections.contacts} onChange={(event) => handleProfileChange('matriculaCarro', event.target.value)} />
            </label>
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
              <span>Código postal</span>
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
            <h2>3. Documentos e fiscalidade</h2>
            {canEdit && (
              <button className={`section-edit-button${editingSections.documents ? ' is-active' : ''}`} type="button" onClick={() => toggleSectionEdit('documents')}>
                ✏️
              </button>
            )}
          </div>
          <div className="profile-fields">
            <label>
              <span>Cartão Cidadão</span>
              <input type="text" value={draftProfile.cartaoCidadao} disabled={!editingSections.documents} onChange={(event) => handleProfileChange('cartaoCidadao', event.target.value)} />
              {profileErrors.cartaoCidadao && <small>{profileErrors.cartaoCidadao}</small>}
            </label>
            <label>
              <span>NIF</span>
              <input type="text" value={draftProfile.nif} disabled={!editingSections.documents} onChange={(event) => handleProfileChange('nif', event.target.value)} />
              {profileErrors.nif && <small>{profileErrors.nif}</small>}
            </label>
            <label>
              <span>NISS</span>
              <input type="text" value={draftProfile.niss} disabled={!editingSections.documents} onChange={(event) => handleProfileChange('niss', event.target.value)} />
              {profileErrors.niss && <small>{profileErrors.niss}</small>}
            </label>
            <label>
              <span>IBAN</span>
              <input type="text" value={draftProfile.iban} disabled={!editingSections.documents} onChange={(event) => handleProfileChange('iban', event.target.value)} />
              {profileErrors.iban && <small>{profileErrors.iban}</small>}
            </label>
            <label className="field-span-2">
              <span>Comprovativo cartão cidadão (PDF/JPG)</span>
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
            <label className="field-span-2">
              <span>Comprovativo IBAN</span>
              <input
                type="file"
                accept=".pdf,.jpg,.jpeg"
                disabled={!editingSections.documents}
                onClick={handleFileInputClick}
                onChange={(event) => handleFileChange('comprovativoIban', event)}
              />
              {renderFileLink(draftProfile.comprovativoIban)}
              {profileErrors.comprovativoIban && <small>{profileErrors.comprovativoIban}</small>}
            </label>
          </div>
        </article>
        )}

        {currentSection === 'tax' && (
        <article className="profile-card">
          <div className="section-headline">
            <h2>4. IRS e benefícios</h2>
            {canEdit && (
              <button className={`section-edit-button${editingSections.tax ? ' is-active' : ''}`} type="button" onClick={() => toggleSectionEdit('tax')}>
                ✏️
              </button>
            )}
          </div>
          <div className="profile-fields">
            <label className="field-span-2">
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
            <label>
              <span>Número cartão continente (opcional)</span>
              <input type="text" value={draftProfile.numeroCartaoContinente} disabled={!editingSections.tax} onChange={(event) => handleProfileChange('numeroCartaoContinente', event.target.value)} />
            </label>
            <label>
              <span>Voucher NOS (data)</span>
              <input type="date" value={draftProfile.voucherNosData} disabled={!editingSections.tax} onChange={(event) => handleProfileChange('voucherNosData', event.target.value)} />
            </label>
            <label className="field-span-2">
              <span>Comprovativo cartão continente (opcional)</span>
              <input
                type="file"
                accept=".pdf,.jpg,.jpeg"
                disabled={!editingSections.tax}
                onClick={handleFileInputClick}
                onChange={(event) => handleFileChange('comprovativoCartaoContinente', event)}
              />
              {renderFileLink(draftProfile.comprovativoCartaoContinente)}
            </label>
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
            <h2>6. Situação contratual</h2>
            {canEditContract && (
              <button className={`section-edit-button${editingSections.contract ? ' is-active' : ''}`} type="button" onClick={() => toggleSectionEdit('contract')}>
                ✏️
              </button>
            )}
          </div>
          <div className="profile-fields">
            <label>
              <span>Cargo</span>
              <input type="text" value={draftProfile.cargo} disabled={!canEditContract || !editingSections.contract} onChange={(event) => handleProfileChange('cargo', event.target.value)} />
              {profileErrors.cargo && <small>{profileErrors.cargo}</small>}
            </label>
            <label className="field-span-2">
              <span>Função</span>
              <textarea value={draftProfile.funcao} disabled={!canEditContract || !editingSections.contract} onChange={(event) => handleProfileChange('funcao', event.target.value)} rows={2} />
              {profileErrors.funcao && <small>{profileErrors.funcao}</small>}
            </label>
            <label>
              <span>Data início do contrato</span>
              <input type="date" value={draftProfile.dataInicioContrato} disabled={!canEditContract || !editingSections.contract} onChange={(event) => handleProfileChange('dataInicioContrato', event.target.value)} />
              {profileErrors.dataInicioContrato && <small>{profileErrors.dataInicioContrato}</small>}
            </label>
            <label>
              <span>Data fim do contrato</span>
              <input type="date" value={draftProfile.dataFimContrato} disabled={!canEditContract || !editingSections.contract} onChange={(event) => handleProfileChange('dataFimContrato', event.target.value)} />
            </label>
            <label>
              <span>Remuneração</span>
              <input type="number" min="0" value={draftProfile.remuneracao} disabled={!canEditContract || !editingSections.contract} onChange={(event) => handleProfileChange('remuneracao', event.target.value)} />
              {profileErrors.remuneracao && <small>{profileErrors.remuneracao}</small>}
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
              <span>Regime horário</span>
              <select value={draftProfile.regimeHorario} disabled={!canEditContract || !editingSections.contract} onChange={(event) => handleProfileChange('regimeHorario', event.target.value)}>
                <option value="">Selecionar</option>
                {regimeHorarioOptions.map((option) => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>
              {profileErrors.regimeHorario && <small>{profileErrors.regimeHorario}</small>}
            </label>
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
        <div className={`floating-save${hasUnsavedChanges ? ' is-visible' : ''}`}>
          <button type="button" className="floating-save__button" onClick={handleSaveChanges} disabled={!hasUnsavedChanges || isSaving}>
            {isSaving ? (requestMode ? 'A submeter...' : 'A guardar...') : requestMode ? 'Submeter pedido' : 'Guardar alterações'}
          </button>
        </div>
      )}

      <Modal
        open={isCompletionHelpOpen}
        title="O que falta completar"
        onClose={() => setIsCompletionHelpOpen(false)}
        width="80%"
        footer={(
          <Button type="button" variant="primary" onClick={() => setIsCompletionHelpOpen(false)}>
            Fechar
          </Button>
        )}
      >
        <div className="profile-completion-help profile-completion-help--modal">
          <header className="profile-completion-help__header">
            <div>
              <p className="profile-completion-help__eyebrow">Resumo rápido</p>
              <h4>{completionIssueEntries.length === 0 ? 'A ficha está completa' : 'Campos por concluir'}</h4>
            </div>
            <div className="profile-completion-help__score">
              <strong>{profileCompletion}%</strong>
              <span>concluída</span>
            </div>
          </header>

          <div className="profile-completion-help__body">
            <div className="profile-completion-help__summary">
              <p>{completionIssueEntries.length === 0 ? 'Não há campos em falta no momento.' : `Faltam ${completionIssueEntries.length} campos para concluir a ficha.`}</p>
              <small>Usa esta lista como atalho para perceber o que precisa de atenção.</small>
            </div>

            {completionIssueEntries.length > 0 ? (
              <ul className="profile-completion-help__list">
                {completionIssueEntries.map((entry) => (
                  <li key={entry.field}>
                    <div>
                      <span>{entry.label}</span>
                      <small>{entry.message}</small>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="profile-completion-help__empty">
                <strong>Perfeito.</strong>
                <p>Não precisas de corrigir nada agora.</p>
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
    </>
  );
}
