import Button from '../ui/Button';
import EmptyState from '../ui/EmptyState';
import Skeleton from '../ui/Skeleton';

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

type TeamOption = {
  id: string;
  name: string;
};

type CollaboratorDetailsPermissionsPanelProps = {
  isLoadingDetails: boolean;
  selectedUserAccessTotal: boolean;
  canManagePermissions: boolean;
  canToggleAccessTotal: boolean;
  isTogglingAccessTotal: boolean;
  onGrantAccessTotal: () => void;
  onRevokeAccessTotal: () => void;
  categories: PermissionCategoryItem[];
  activeCategoryId: string;
  onSelectCategory: (categoryId: string) => void;
  permissionSearch: string;
  onPermissionSearchChange: (value: string) => void;
  permissions: PermissionListItem[];
  onSelectPermission: (permissionId: string) => void;
  hasSelectedPermission: boolean;
  selectedPermissionLabel: string;
  selectedPermissionDescription: string;
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
  grantedByLabel: string;
  isSavingSelectedPermission: boolean;
  onSaveSelectedPermission: () => void;
};

export default function CollaboratorDetailsPermissionsPanel({
  isLoadingDetails,
  selectedUserAccessTotal,
  canManagePermissions,
  canToggleAccessTotal,
  isTogglingAccessTotal,
  onGrantAccessTotal,
  onRevokeAccessTotal,
  categories,
  activeCategoryId,
  onSelectCategory,
  permissionSearch,
  onPermissionSearchChange,
  permissions,
  onSelectPermission,
  hasSelectedPermission,
  selectedPermissionLabel,
  selectedPermissionDescription,
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
  grantedByLabel,
  isSavingSelectedPermission,
  onSaveSelectedPermission,
}: CollaboratorDetailsPermissionsPanelProps) {
  const canEditSelectedPermission = canManagePermissions && !selectedUserAccessTotal;

  return (
    <section className="cm-panel">
      {isLoadingDetails ? (
        <Skeleton lines={3} />
      ) : (
        <>
          {selectedUserAccessTotal && (
            <div className="cm-access-total-banner">
              <div className="cm-access-total-banner__info">
                <strong>Acesso total ativo</strong>
                <span>Este utilizador tem acesso efetivo a todas as permissoes do sistema. As configuracoes individuais estao suspensas.</span>
              </div>
              {canToggleAccessTotal && (
                <Button type="button" size="sm" variant="ghost" isLoading={isTogglingAccessTotal} disabled={isTogglingAccessTotal} onClick={onRevokeAccessTotal}>
                  Revogar
                </Button>
              )}
            </div>
          )}
          {!selectedUserAccessTotal && canToggleAccessTotal && (
            <div className="cm-perms-top-bar">
              <Button type="button" size="sm" variant="secondary" isLoading={isTogglingAccessTotal} disabled={isTogglingAccessTotal} onClick={onGrantAccessTotal}>
                Dar acesso total
              </Button>
            </div>
          )}

          <div className="cm-perms-body">
            <aside className="cm-perm-categories">
              {categories.map((item) => (
                <button key={item.id} type="button" className={item.id === activeCategoryId ? 'is-active' : ''} onClick={() => onSelectCategory(item.id)}>
                  {item.label}
                </button>
              ))}
            </aside>

            <div className="cm-perm-main">
              <div className="cm-perm-list">
                <input
                  type="search"
                  className="cm-perm-search"
                  placeholder="Pesquisar permissao..."
                  value={permissionSearch}
                  onChange={(event) => onPermissionSearchChange(event.target.value)}
                />
                <div className="cm-perm-items">
                  {permissions.length === 0 && (
                    <EmptyState title="Sem permissoes" message="Escolhe outra categoria." />
                  )}
                  {permissions.map((permission) => (
                    <button
                      key={permission.id}
                      type="button"
                      className={`cm-perm-item${permission.isSelected ? ' is-selected' : ''}${permission.isEnabled ? ' is-on' : ''}`}
                      onClick={() => onSelectPermission(permission.id)}
                    >
                      <strong>{permission.label}</strong>
                      <span>{permission.isEnabled ? '● Ativa' : '○ Inativa'}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="cm-perm-editor">
                {!hasSelectedPermission ? (
                  <p className="cm-perm-empty">Seleciona uma permissao para configurar.</p>
                ) : (
                  <>
                    <header className="cm-perm-editor-head">
                      <h5>{selectedPermissionLabel}</h5>
                      <p>{selectedPermissionDescription}</p>
                    </header>

                    <div className="cm-perm-editor-form">
                      <div className="cm-perm-field cm-perm-field--toggle">
                        <span>Estado</span>
                        <div className="cm-toggle-btns">
                          <button type="button" className={selectedPermissionEnabled ? 'is-on' : ''} onClick={() => onSetSelectedPermissionEnabled(true)} disabled={!canEditSelectedPermission}>Ativa</button>
                          <button type="button" className={!selectedPermissionEnabled ? 'is-on' : ''} onClick={() => onSetSelectedPermissionEnabled(false)} disabled={!canEditSelectedPermission}>Inativa</button>
                        </div>
                      </div>

                      <div className="cm-perm-field">
                        <span>Paises</span>
                        <div className="cm-token-pills">
                          {['PT', 'BR'].map((country) => (
                            <button
                              key={country}
                              type="button"
                              className={selectedRestrictionCountries.includes(country) ? 'is-on' : ''}
                              onClick={() => onToggleCountry(country)}
                              disabled={!canEditSelectedPermission}
                            >
                              {country}
                            </button>
                          ))}
                        </div>
                        <small>Vazio = todos os paises.</small>
                      </div>

                      <div className="cm-perm-field">
                        <span>Equipas</span>
                        <div className="collab-team-selector">
                          <select value={pendingTeamToAdd} onChange={(event) => onPendingTeamToAddChange(event.target.value)} disabled={!canEditSelectedPermission || availableTeamsToAdd.length === 0}>
                            <option value="">Selecionar equipa</option>
                            {availableTeamsToAdd.map((team) => (
                              <option key={team.id} value={team.id}>{team.name}</option>
                            ))}
                          </select>
                          <Button type="button" size="sm" variant="secondary" onClick={onAddTeamRestriction} disabled={!canEditSelectedPermission || !pendingTeamToAdd}>+</Button>
                        </div>
                        {selectedRestrictedTeams.length > 0 && (
                          <div className="collab-team-chips">
                            {selectedRestrictedTeams.map((team) => (
                              <button key={team.id} type="button" className="collab-team-chip" onClick={() => onRemoveTeamRestriction(team.id)} disabled={!canEditSelectedPermission}>
                                {team.name} ×
                              </button>
                            ))}
                          </div>
                        )}
                        <small>Vazio = todas as equipas.</small>
                      </div>

                      <div className="cm-perm-field">
                        <span>Notas</span>
                        <input
                          type="text"
                          value={selectedNotes}
                          onChange={(event) => onNotesChange(event.target.value)}
                          placeholder="Contexto opcional"
                          disabled={!canEditSelectedPermission}
                        />
                      </div>
                    </div>

                    <div className="cm-perm-editor-footer">
                      <small>Por: {grantedByLabel}</small>
                      <Button type="button" variant="primary" size="sm" isLoading={isSavingSelectedPermission} onClick={onSaveSelectedPermission} disabled={!canEditSelectedPermission}>
                        Guardar
                      </Button>
                    </div>
                    {selectedUserAccessTotal && <small className="cm-perm-disabled-hint">Revoga o acesso total para editar permissoes individuais.</small>}
                  </>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
