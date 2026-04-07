import { ChangeEvent, MouseEvent, useEffect, useMemo, useState } from 'react';
import {
  cargoOptions,
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
import { ProfileData, ProfileFieldError } from '../portal/types';

type SectionKey = 'personal' | 'contacts' | 'documents' | 'tax' | 'emergency' | 'contract';

const STORAGE_TOKEN_KEY = 'smarter_hub_auth_token';

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

function validateProfile(profile: ProfileData): ProfileFieldError {
  const errors: ProfileFieldError = {};

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
    'cargo',
    'funcao',
    'dataInicioContrato',
    'remuneracao',
    'tipoContrato',
    'regimeHorario',
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
  const { profile, saveProfile, userRole } = usePortal();

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
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string; visible: boolean }>({
    type: 'success',
    message: '',
    visible: false,
  });
  const [isSaving, setIsSaving] = useState(false);

  const canEdit = userRole !== 'convidado';
  const canEditContract = userRole === 'manager' || userRole === 'coordenador' || userRole === 'admin';
  const requestMode = !canEditContract;

  const profileCompletion = useMemo(() => {
    const fields = Object.values(draftProfile);
    const filled = fields.filter((item) => item.trim().length > 0).length;
    return Math.round((filled / fields.length) * 100);
  }, [draftProfile]);

  const collaboratorName = useMemo(() => `${draftProfile.primeiroNome} ${draftProfile.apelido}`.trim(), [draftProfile.apelido, draftProfile.primeiroNome]);
  const hasUnsavedChanges = useMemo(() => JSON.stringify(draftProfile) !== JSON.stringify(profile), [draftProfile, profile]);

  useEffect(() => {
    setDraftProfile(profile);
  }, [profile]);

  function showToast(type: 'success' | 'error', message: string) {
    setToast({ type, message, visible: true });
    window.setTimeout(() => {
      setToast((current) => ({ ...current, visible: false }));
    }, 3400);
  }

  function handleProfileChange(field: keyof ProfileData, value: string) {
    setDraftProfile((current) => {
      return { ...current, [field]: value };
    });

    setProfileErrors((current) => {
      if (!current[field]) {
        return current;
      }

      const updated = { ...current };
      delete updated[field];
      return updated;
    });

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

    const errors = validateProfile(draftProfile);
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
      showToast('success', 'Pedido efetuado com sucesso. Em breve irá receber uma resposta.');
      return;
    }

    showToast('success', result.message || 'Alterações guardadas com sucesso.');
  }

  return (
    <>
      <section className="profile-hero">
        <div className="hero-main">
          <p className="hero-kicker">Ficha de colaborador</p>
          <h1>{collaboratorName}</h1>
          <p>
            {profile.cargo} · {profile.tipoContrato} · {profile.regimeHorario}
          </p>
          <div className="hero-chips">
            <span>IRS Jovem: {profile.irsJovem || '-'}</span>
            <span>Dependentes: {profile.numeroDependentes || '0'}</span>
            <span>Último acesso: hoje</span>
          </div>
        </div>

        <div className="completion-card completion-card--highlight">
          <p>Completude da ficha</p>
          <strong>{profileCompletion}%</strong>
          <div className="completion-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={profileCompletion}>
            <span style={{ width: `${profileCompletion}%` }} />
          </div>
          <small>Completa a tua ficha</small>
        </div>
      </section>

      <section className="profile-grid">
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
              <select value={draftProfile.cargo} disabled={!canEditContract || !editingSections.contract} onChange={(event) => handleProfileChange('cargo', event.target.value)}>
                <option value="">Selecionar</option>
                {cargoOptions.map((option) => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>
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
      </section>

      {toast.visible && (
        <aside className={`portal-toast portal-toast--${toast.type}`} role="status" aria-live="polite">
          <strong>{toast.type === 'success' ? 'Sucesso' : 'Atenção'}</strong>
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
    </>
  );
}
