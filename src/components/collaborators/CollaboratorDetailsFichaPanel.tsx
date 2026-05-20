import type { ChangeEvent, ReactNode } from 'react';

import CollaboratorDetailsAccountSection from './CollaboratorDetailsAccountSection';
import CollaboratorDetailsFichaHeader from './CollaboratorDetailsFichaHeader';
import CollaboratorDetailsFichaSubnav from './CollaboratorDetailsFichaSubnav';
import CollaboratorDetailsProfileSection from './CollaboratorDetailsProfileSection';

type DetailsFichaSection = 'conta' | 'identificacao' | 'contactos' | 'fiscal' | 'emergencia' | 'contrato';

type TeamOption = {
  id: string;
  name: string;
};

type CredentialsDraft = {
  username: string;
  email: string;
};

type AccountEditDraft = {
  workCountry: 'PT' | 'BR';
  brWorkState: '' | 'SP' | 'RS';
  isActive: boolean;
  teamId: string;
};

type ProfileFieldView = {
  key: string;
  label: string;
  className: string;
  control: ReactNode;
};

type ActiveProfileSectionView = {
  key: string;
  title: string;
  description: string;
  sectionClassName?: string;
  fields: ProfileFieldView[];
};

type CollaboratorDetailsFichaPanelProps = {
  selectedUsername: string;
  selectedEmail: string;
  selectedCollaboratorPhotoUrl: string;
  selectedCollaboratorInitials: string;
  selectedCollaboratorName: string;
  collaboratorRoleLine: string;
  selectedCollaboratorTeamName: string;
  collaboratorCompletion: number;
  collaboratorMissingFieldTotal: number;
  detailsFichaSections: Array<{ id: DetailsFichaSection; label: string }>;
  detailsFichaSection: DetailsFichaSection;
  detailsFichaMissingCounts: Record<DetailsFichaSection, number>;
  canEditUser: boolean;
  canEditCredentials: boolean;
  canManageProfileOptions: boolean;
  isSavingEditDraft: boolean;
  isSavingCredentials: boolean;
  credentialsDraft: CredentialsDraft;
  accountEditDraft: AccountEditDraft;
  collaboratorTeamOptions: TeamOption[];
  disableActiveToggle: boolean;
  activeProfileSectionView: ActiveProfileSectionView | null;
  onSelectFichaSection: (section: DetailsFichaSection) => void;
  onPhotoChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onOpenProfileOption: (type: 'CARGO' | 'FUNCAO') => void;
  onCredentialsDraftChange: (patch: Partial<CredentialsDraft>) => void;
  onWorkCountryChange: (country: 'PT' | 'BR') => void;
  onTeamChange: (teamId: string) => void;
  onActiveChange: (isActive: boolean) => void;
  onSaveCredentials: () => void;
};

export default function CollaboratorDetailsFichaPanel({
  selectedUsername,
  selectedEmail,
  selectedCollaboratorPhotoUrl,
  selectedCollaboratorInitials,
  selectedCollaboratorName,
  collaboratorRoleLine,
  selectedCollaboratorTeamName,
  collaboratorCompletion,
  collaboratorMissingFieldTotal,
  detailsFichaSections,
  detailsFichaSection,
  detailsFichaMissingCounts,
  canEditUser,
  canEditCredentials,
  canManageProfileOptions,
  isSavingEditDraft,
  isSavingCredentials,
  credentialsDraft,
  accountEditDraft,
  collaboratorTeamOptions,
  disableActiveToggle,
  activeProfileSectionView,
  onSelectFichaSection,
  onPhotoChange,
  onOpenProfileOption,
  onCredentialsDraftChange,
  onWorkCountryChange,
  onTeamChange,
  onActiveChange,
  onSaveCredentials,
}: CollaboratorDetailsFichaPanelProps) {
  return (
    <section className="cm-panel">
      <CollaboratorDetailsFichaHeader
        selectedCollaboratorPhotoUrl={selectedCollaboratorPhotoUrl}
        selectedCollaboratorInitials={selectedCollaboratorInitials}
        selectedCollaboratorName={selectedCollaboratorName}
        collaboratorRoleLine={collaboratorRoleLine}
        selectedUsername={selectedUsername}
        selectedEmail={selectedEmail}
        selectedCollaboratorTeamName={selectedCollaboratorTeamName}
        workCountry={accountEditDraft.workCountry}
        brWorkState={accountEditDraft.brWorkState}
        isActive={accountEditDraft.isActive}
        collaboratorCompletion={collaboratorCompletion}
        collaboratorMissingFieldTotal={collaboratorMissingFieldTotal}
        canEditUser={canEditUser}
        isSavingEditDraft={isSavingEditDraft}
        canManageProfileOptions={canManageProfileOptions}
        onPhotoChange={onPhotoChange}
        onOpenProfileOption={onOpenProfileOption}
      />

      <CollaboratorDetailsFichaSubnav
        sections={detailsFichaSections}
        selectedSection={detailsFichaSection}
        missingCounts={detailsFichaMissingCounts}
        onSelectSection={onSelectFichaSection}
      />

      <div className="cm-edit-body">
        {detailsFichaSection === 'conta' && (
          <CollaboratorDetailsAccountSection
            selectedUsername={selectedUsername}
            selectedEmail={selectedEmail}
            canEditCredentials={canEditCredentials}
            canEditUser={canEditUser}
            disableActiveToggle={disableActiveToggle}
            credentialsDraft={credentialsDraft}
            editDraft={accountEditDraft}
            collaboratorTeamOptions={collaboratorTeamOptions}
            isSavingCredentials={isSavingCredentials}
            onCredentialsDraftChange={onCredentialsDraftChange}
            onWorkCountryChange={onWorkCountryChange}
            onTeamChange={onTeamChange}
            onActiveChange={onActiveChange}
            onSaveCredentials={onSaveCredentials}
          />
        )}

        {detailsFichaSection !== 'conta' && activeProfileSectionView && (
          <CollaboratorDetailsProfileSection
            key={activeProfileSectionView.key}
            title={activeProfileSectionView.title}
            description={activeProfileSectionView.description}
            sectionClassName={activeProfileSectionView.sectionClassName}
            fields={activeProfileSectionView.fields}
          />
        )}

        {!canEditUser && <p className="cm-no-permission">Sem permissoes para editar dados deste colaborador.</p>}
      </div>
    </section>
  );
}
