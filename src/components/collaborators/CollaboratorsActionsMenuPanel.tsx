type CollaboratorsActionsMenuPanelProps = {
  displayName: string;
  isActive: boolean;
  isBusy: boolean;
  canManagePermissions: boolean;
  canManageActive: boolean;
  top: number;
  right: number;
  onOpenPermissions: () => void;
  onToggleActive: () => void;
};

export default function CollaboratorsActionsMenuPanel({
  displayName,
  isActive,
  isBusy,
  canManagePermissions,
  canManageActive,
  top,
  right,
  onOpenPermissions,
  onToggleActive,
}: CollaboratorsActionsMenuPanelProps) {
  return (
    <div
      className="collaborators-actions-menu__panel"
      role="menu"
      aria-label={`Acoes rapidas de ${displayName}`}
      style={{ position: 'fixed', top, right }}
    >
      <button
        type="button"
        className="collaborators-actions-menu__item"
        role="menuitem"
        disabled={!canManagePermissions}
        onClick={onOpenPermissions}
      >
        Permissoes
      </button>
      <button
        type="button"
        className={`collaborators-actions-menu__item${isActive ? ' is-danger' : ''}`}
        role="menuitem"
        disabled={!canManageActive || isBusy}
        onClick={onToggleActive}
      >
        {isBusy ? 'A processar...' : isActive ? 'Desativar' : 'Reativar'}
      </button>
    </div>
  );
}
