import Button from '../ui/Button';

type CollaboratorsHeaderActionsProps = {
  canCreateUser: boolean;
  onCreateUser: () => void;
  onImportUsers: () => void;
  onExportUsers: () => void;
};

export default function CollaboratorsHeaderActions({
  canCreateUser,
  onCreateUser,
  onImportUsers,
  onExportUsers,
}: CollaboratorsHeaderActionsProps) {
  return (
    <div className="people-page-header">
      <div className="people-page-header__actions">
        {canCreateUser && (
          <Button type="button" variant="primary" onClick={onCreateUser}>+ Novo colaborador</Button>
        )}
        {canCreateUser && (
          <Button type="button" variant="secondary" onClick={onImportUsers}>Importar em massa</Button>
        )}
        <Button type="button" variant="primary" onClick={onExportUsers}>
          Exportar
        </Button>
      </div>
    </div>
  );
}
