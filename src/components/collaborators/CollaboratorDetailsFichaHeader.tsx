import type { ChangeEvent } from 'react';

import Badge from '../ui/Badge';
import Button from '../ui/Button';

type CollaboratorDetailsFichaHeaderProps = {
  selectedCollaboratorPhotoUrl: string;
  selectedCollaboratorInitials: string;
  selectedCollaboratorName: string;
  collaboratorRoleLine: string;
  selectedUsername: string;
  selectedEmail: string;
  selectedCollaboratorTeamName: string;
  workCountry: 'PT' | 'BR';
  brWorkState: '' | 'SP' | 'RS';
  isActive: boolean;
  collaboratorCompletion: number;
  collaboratorMissingFieldTotal: number;
  canEditUser: boolean;
  isSavingEditDraft: boolean;
  canManageProfileOptions: boolean;
  onPhotoChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onOpenProfileOption: (type: 'CARGO' | 'FUNCAO') => void;
};

export default function CollaboratorDetailsFichaHeader({
  selectedCollaboratorPhotoUrl,
  selectedCollaboratorInitials,
  selectedCollaboratorName,
  collaboratorRoleLine,
  selectedUsername,
  selectedEmail,
  selectedCollaboratorTeamName,
  workCountry,
  brWorkState,
  isActive,
  collaboratorCompletion,
  collaboratorMissingFieldTotal,
  canEditUser,
  isSavingEditDraft,
  canManageProfileOptions,
  onPhotoChange,
  onOpenProfileOption,
}: CollaboratorDetailsFichaHeaderProps) {
  return (
    <div className="cm-identity-bar">
      <div className="cm-identity-main">
        <div className="cm-avatar-wrap">
          {selectedCollaboratorPhotoUrl ? (
            <img src={selectedCollaboratorPhotoUrl} alt="Foto de utilizador" className="cm-avatar cm-avatar--photo" />
          ) : (
            <div className="cm-avatar">{selectedCollaboratorInitials}</div>
          )}
          {canEditUser && (
            <label className="cm-avatar-edit" title="Editar foto de utilizador" aria-label="Editar foto de utilizador">
              ✎
              <input
                type="file"
                accept="image/*"
                onChange={onPhotoChange}
                onClick={(event) => {
                  event.currentTarget.value = '';
                }}
                disabled={!canEditUser || isSavingEditDraft}
              />
            </label>
          )}
        </div>

        <div className="cm-identity-info">
          <strong>{selectedCollaboratorName}</strong>
          <span className="cm-identity-role">{collaboratorRoleLine}</span>
          <span>@{selectedUsername} · {selectedEmail}</span>
          <div className="cm-identity-meta">
            <span>{selectedCollaboratorTeamName}</span>
            <span>{workCountry || 'PT'}</span>
            {workCountry === 'BR' && brWorkState && <span>{brWorkState}</span>}
          </div>
        </div>
      </div>

      <div className="cm-identity-side">
        <div className="cm-identity-badges">
          <Badge tone="neutral">{workCountry || 'PT'}</Badge>
          <Badge tone={isActive ? 'success' : 'danger'}>{isActive ? 'Ativo' : 'Inativo'}</Badge>
        </div>

        <div className="cm-identity-progress">
          <span className="cm-identity-progress__label">Completude da ficha</span>
          <strong>{collaboratorCompletion}%</strong>
          <div className="cm-identity-progress__track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={collaboratorCompletion}>
            <span style={{ width: `${collaboratorCompletion}%` }} />
          </div>
          <small>{collaboratorMissingFieldTotal} campo(s) em falta</small>
        </div>

        {canManageProfileOptions && (
          <div className="cm-identity-actions">
            <Button type="button" variant="ghost" size="sm" onClick={() => onOpenProfileOption('CARGO')}>+ Cargo</Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => onOpenProfileOption('FUNCAO')}>+ Função</Button>
          </div>
        )}
      </div>
    </div>
  );
}
