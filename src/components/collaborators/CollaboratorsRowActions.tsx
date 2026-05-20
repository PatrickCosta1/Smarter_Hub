import Button from '../ui/Button';

type CollaboratorsRowActionsProps = {
  displayName: string;
  isMenuOpen: boolean;
  onEdit: () => void;
  onToggleMore: (triggerElement: HTMLElement) => void;
};

export default function CollaboratorsRowActions({
  displayName,
  isMenuOpen,
  onEdit,
  onToggleMore,
}: CollaboratorsRowActionsProps) {
  return (
    <div className="collaborators-actions">
      <Button
        type="button"
        size="sm"
        variant="primary"
        onClick={onEdit}
      >
        Editar
      </Button>

      <div className="collaborators-actions-menu">
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="collaborators-actions-menu__trigger"
          aria-haspopup="menu"
          aria-expanded={isMenuOpen}
          aria-label={`Mais ações para ${displayName}`}
          onClick={(event) => onToggleMore(event.currentTarget)}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <circle cx="5" cy="12" r="2" />
            <circle cx="12" cy="12" r="2" />
            <circle cx="19" cy="12" r="2" />
          </svg>
        </Button>
      </div>
    </div>
  );
}
