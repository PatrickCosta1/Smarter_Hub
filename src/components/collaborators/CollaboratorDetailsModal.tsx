import type { ChangeEvent, ReactNode } from 'react';

import Modal from '../ui/Modal';
import CollaboratorDetailsFichaPanel from './CollaboratorDetailsFichaPanel';
import CollaboratorDetailsModalFooter from './CollaboratorDetailsModalFooter';
import CollaboratorDetailsModalShell from './CollaboratorDetailsModalShell';
import CollaboratorDetailsPermissionsPanel from './CollaboratorDetailsPermissionsPanel';
import CollaboratorDetailsStatusPanel from './CollaboratorDetailsStatusPanel';

type DetailsTab = 'ficha' | 'permissoes' | 'estado';
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

type PermissionCategoryItem = {
  id: string;
  label: string;
};

type PermissionListItem = {
  id: string;
  label: string;
  isSelected: boolean;
  isEnabled: boolean;
};

type SelectedPermissionSummary = {
  id: string;
  label: string;
  description: string;
  grantedByLabel: string;
};

type StatusHistoryEntry = {
  id: string;
  reviewedAt?: string | null;
  requestedData?: Record<string, unknown>;
  changesSummary?: string | null;
  reviewedBy?: {
    username?: string;
    profile?: {
      nomeAbreviado?: string;
      nomeCompleto?: string;
    } | null;
  } | null;
};

type ActiveProfileSectionView = {
  key: string;
  title: string;
  description: string;
  sectionClassName?: string;
  fields: Array<{
    key: string;
    label: string;
    className: string;
    control: ReactNode;
  }>;
};

type SelectedRow = {
  username: string;
  email: string;
  isActive: boolean;
  updatedAt: string;
};

type CollaboratorDetailsModalProps = {
  open: boolean;
  title: string;
  selectedRow: SelectedRow | null;
  detailsTab: DetailsTab;
  onTabChange: (tab: DetailsTab) => void;
  canEditUser: boolean;
  isSavingEditDraft: boolean;
  onClose: () => void;
  onSaveDraft: () => void;

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
  canEditCredentials: boolean;
  canManageProfileOptions: boolean;
  isSavingCredentials: boolean;
  credentialsDraft: CredentialsDraft;
  accountEditDraft: AccountEditDraft;
  collaboratorTeamOptions: TeamOption[];
  activeProfileSectionView: ActiveProfileSectionView | null;
  onSelectFichaSection: (section: DetailsFichaSection) => void;
  onPhotoChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onOpenProfileOption: (type: 'CARGO' | 'FUNCAO') => void;
  onCredentialsDraftChange: (patch: Partial<CredentialsDraft>) => void;
  onWorkCountryChange: (country: 'PT' | 'BR') => void;
  onTeamChange: (teamId: string) => void;
  onActiveChange: (isActive: boolean) => void;
  onSaveCredentials: () => void;

  isLoadingDetails: boolean;
  selectedUserAccessTotal: boolean;
  canManagePermissions: boolean;
  canToggleAccessTotal: boolean;
  isTogglingAccessTotal: boolean;
  onGrantAccessTotal: () => void;
  onRevokeAccessTotal: () => void;
  permissionCategories: PermissionCategoryItem[];
  activePermissionCategoryId: string;
  onSelectPermissionCategory: (categoryId: string) => void;
  permissionSearch: string;
  onPermissionSearchChange: (value: string) => void;
  permissionItems: PermissionListItem[];
  onSelectPermission: (permissionId: string) => void;
  selectedPermission: SelectedPermissionSummary | null;
  selectedPermissionEnabled: boolean;
  onSetSelectedPermissionEnabled: (enabled: boolean) => void;
  selectedRestrictionCountries: string[];
  onToggleCountry: (country: string) => void;
  pendingTeamToAdd: string;
  onPendingTeamToAddChange: (teamId: string) => void;
  availableTeamsToAdd: TeamOption[];
  onAddTeamRestriction: () => void;
  selectedRestrictedTeams: TeamOption[];
  onRemoveTeamRestriction: (teamId: string) => void;
  selectedNotes: string;
  onNotesChange: (value: string) => void;
  isSavingSelectedPermission: boolean;
  onSaveSelectedPermission: () => void;

  canManageActive: boolean;
  cargoHistoryEntries: StatusHistoryEntry[];
  onToggleActive: () => void;
};

export default function CollaboratorDetailsModal({
  open,
  title,
  selectedRow,
  detailsTab,
  onTabChange,
  canEditUser,
  isSavingEditDraft,
  onClose,
  onSaveDraft,

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
  canEditCredentials,
  canManageProfileOptions,
  isSavingCredentials,
  credentialsDraft,
  accountEditDraft,
  collaboratorTeamOptions,
  activeProfileSectionView,
  onSelectFichaSection,
  onPhotoChange,
  onOpenProfileOption,
  onCredentialsDraftChange,
  onWorkCountryChange,
  onTeamChange,
  onActiveChange,
  onSaveCredentials,

  isLoadingDetails,
  selectedUserAccessTotal,
  canManagePermissions,
  canToggleAccessTotal,
  isTogglingAccessTotal,
  onGrantAccessTotal,
  onRevokeAccessTotal,
  permissionCategories,
  activePermissionCategoryId,
  onSelectPermissionCategory,
  permissionSearch,
  onPermissionSearchChange,
  permissionItems,
  onSelectPermission,
  selectedPermission,
  selectedPermissionEnabled,
  onSetSelectedPermissionEnabled,
  selectedRestrictionCountries,
  onToggleCountry,
  pendingTeamToAdd,
  onPendingTeamToAddChange,
  availableTeamsToAdd,
  onAddTeamRestriction,
  selectedRestrictedTeams,
  onRemoveTeamRestriction,
  selectedNotes,
  onNotesChange,
  isSavingSelectedPermission,
  onSaveSelectedPermission,

  canManageActive,
  cargoHistoryEntries,
  onToggleActive,
}: CollaboratorDetailsModalProps) {
  return (
    <Modal
      open={open}
      title={title}
      onClose={onClose}
      width="min(1360px, 97vw)"
      showCloseButton={false}
      footer={
        <CollaboratorDetailsModalFooter
          detailsTab={detailsTab}
          canEditUser={canEditUser}
          isSavingEditDraft={isSavingEditDraft}
          onClose={onClose}
          onSave={onSaveDraft}
        />
      }
    >
      <CollaboratorDetailsModalShell
        activeTab={detailsTab}
        onTabChange={onTabChange}
        fichaContent={selectedRow ? (
          <CollaboratorDetailsFichaPanel
            selectedUsername={selectedRow.username}
            selectedEmail={selectedRow.email}
            selectedCollaboratorPhotoUrl={selectedCollaboratorPhotoUrl}
            selectedCollaboratorInitials={selectedCollaboratorInitials}
            selectedCollaboratorName={selectedCollaboratorName}
            collaboratorRoleLine={collaboratorRoleLine}
            selectedCollaboratorTeamName={selectedCollaboratorTeamName}
            collaboratorCompletion={collaboratorCompletion}
            collaboratorMissingFieldTotal={collaboratorMissingFieldTotal}
            detailsFichaSections={detailsFichaSections}
            detailsFichaSection={detailsFichaSection}
            detailsFichaMissingCounts={detailsFichaMissingCounts}
            canEditUser={canEditUser}
            canEditCredentials={canEditCredentials}
            canManageProfileOptions={canManageProfileOptions}
            isSavingEditDraft={isSavingEditDraft}
            isSavingCredentials={isSavingCredentials}
            credentialsDraft={credentialsDraft}
            accountEditDraft={accountEditDraft}
            collaboratorTeamOptions={collaboratorTeamOptions}
            disableActiveToggle={selectedRow.username === 't.people'}
            activeProfileSectionView={activeProfileSectionView}
            onSelectFichaSection={onSelectFichaSection}
            onPhotoChange={onPhotoChange}
            onOpenProfileOption={onOpenProfileOption}
            onCredentialsDraftChange={onCredentialsDraftChange}
            onWorkCountryChange={onWorkCountryChange}
            onTeamChange={onTeamChange}
            onActiveChange={onActiveChange}
            onSaveCredentials={onSaveCredentials}
          />
        ) : null}
        permissoesContent={selectedRow ? (
          <CollaboratorDetailsPermissionsPanel
            isLoadingDetails={isLoadingDetails}
            selectedUserAccessTotal={selectedUserAccessTotal}
            canManagePermissions={canManagePermissions}
            canToggleAccessTotal={canToggleAccessTotal}
            isTogglingAccessTotal={isTogglingAccessTotal}
            onGrantAccessTotal={onGrantAccessTotal}
            onRevokeAccessTotal={onRevokeAccessTotal}
            categories={permissionCategories}
            activeCategoryId={activePermissionCategoryId}
            onSelectCategory={onSelectPermissionCategory}
            permissionSearch={permissionSearch}
            onPermissionSearchChange={onPermissionSearchChange}
            permissions={permissionItems}
            onSelectPermission={onSelectPermission}
            hasSelectedPermission={Boolean(selectedPermission)}
            selectedPermissionLabel={selectedPermission?.label || ''}
            selectedPermissionDescription={selectedPermission?.description || ''}
            selectedPermissionEnabled={selectedPermissionEnabled}
            onSetSelectedPermissionEnabled={onSetSelectedPermissionEnabled}
            selectedRestrictionCountries={selectedRestrictionCountries}
            onToggleCountry={onToggleCountry}
            pendingTeamToAdd={pendingTeamToAdd}
            onPendingTeamToAddChange={onPendingTeamToAddChange}
            availableTeamsToAdd={availableTeamsToAdd}
            onAddTeamRestriction={onAddTeamRestriction}
            selectedRestrictedTeams={selectedRestrictedTeams}
            onRemoveTeamRestriction={onRemoveTeamRestriction}
            selectedNotes={selectedNotes}
            onNotesChange={onNotesChange}
            grantedByLabel={selectedPermission?.grantedByLabel || ''}
            isSavingSelectedPermission={isSavingSelectedPermission}
            onSaveSelectedPermission={onSaveSelectedPermission}
          />
        ) : null}
        estadoContent={selectedRow ? (
          <CollaboratorDetailsStatusPanel
            isLoadingDetails={isLoadingDetails}
            isActive={selectedRow.isActive}
            updatedAt={selectedRow.updatedAt}
            username={selectedRow.username}
            canManageActive={canManageActive}
            cargoHistoryEntries={cargoHistoryEntries}
            onToggleActive={onToggleActive}
          />
        ) : null}
      />
    </Modal>
  );
}
