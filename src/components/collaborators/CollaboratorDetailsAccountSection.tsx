import Badge from '../ui/Badge';
import Button from '../ui/Button';

type TeamOption = {
  id: string;
  name: string;
};

type CredentialsDraft = {
  username: string;
  email: string;
};

type EditDraftAccount = {
  workCountry: 'PT' | 'BR';
  teamId: string;
  isActive: boolean;
};

type CollaboratorDetailsAccountSectionProps = {
  selectedUsername: string;
  selectedEmail: string;
  canEditCredentials: boolean;
  canEditUser: boolean;
  disableActiveToggle: boolean;
  credentialsDraft: CredentialsDraft;
  editDraft: EditDraftAccount;
  collaboratorTeamOptions: TeamOption[];
  isSavingCredentials: boolean;
  onCredentialsDraftChange: (patch: Partial<CredentialsDraft>) => void;
  onWorkCountryChange: (country: 'PT' | 'BR') => void;
  onTeamChange: (teamId: string) => void;
  onActiveChange: (isActive: boolean) => void;
  onSaveCredentials: () => void;
};

export default function CollaboratorDetailsAccountSection({
  selectedUsername,
  selectedEmail,
  canEditCredentials,
  canEditUser,
  disableActiveToggle,
  credentialsDraft,
  editDraft,
  collaboratorTeamOptions,
  isSavingCredentials,
  onCredentialsDraftChange,
  onWorkCountryChange,
  onTeamChange,
  onActiveChange,
  onSaveCredentials,
}: CollaboratorDetailsAccountSectionProps) {
  return (
    <article className="cm-section cm-section--account">
      <div className="cm-section-head">
        <div>
          <h5 className="cm-section-title">Conta e acesso</h5>
          <p>Configuracao base do utilizador, autenticacao e contexto organizacional.</p>
        </div>
        <Badge tone="info">Base</Badge>
      </div>
      <div className="collaborator-edit-grid collaborator-edit-grid--top">
        <label className="cm-field-card">
          <span>Username</span>
          <input
            type="text"
            value={canEditCredentials ? credentialsDraft.username : selectedUsername}
            onChange={(event) => onCredentialsDraftChange({ username: event.target.value })}
            disabled={!canEditCredentials}
            autoComplete="off"
          />
        </label>
        <label className="cm-field-card">
          <span>Email login</span>
          <input
            type="email"
            value={canEditCredentials ? credentialsDraft.email : selectedEmail}
            onChange={(event) => onCredentialsDraftChange({ email: event.target.value })}
            disabled={!canEditCredentials}
            autoComplete="off"
          />
        </label>
        <label className="cm-field-card">
          <span>Pais de trabalho</span>
          <select
            value={editDraft.workCountry}
            onChange={(event) => onWorkCountryChange(event.target.value as 'PT' | 'BR')}
            disabled={!canEditUser}
          >
            <option value="PT">Portugal</option>
            <option value="BR">Brasil</option>
          </select>
        </label>
        <label className="cm-field-card">
          <span>Equipa principal</span>
          <select value={editDraft.teamId} onChange={(event) => onTeamChange(event.target.value)} disabled={!canEditUser}>
            <option value="">Sem equipa</option>
            {collaboratorTeamOptions.map((team) => (
              <option key={team.id} value={team.id}>{team.name}</option>
            ))}
          </select>
        </label>
        <label className="cm-field-card">
          <span>Estado da conta</span>
          <select
            value={editDraft.isActive ? 'ACTIVE' : 'INACTIVE'}
            onChange={(event) => onActiveChange(event.target.value === 'ACTIVE')}
            disabled={!canEditUser || disableActiveToggle}
          >
            <option value="ACTIVE">Ativa</option>
            <option value="INACTIVE">Inativa</option>
          </select>
        </label>
      </div>
      {canEditCredentials && (
        <div className="cm-inline-action">
          <Button type="button" size="sm" variant="secondary" isLoading={isSavingCredentials} onClick={onSaveCredentials}>
            Guardar credenciais
          </Button>
          <small>Altera username e email de acesso ao sistema.</small>
        </div>
      )}
    </article>
  );
}
