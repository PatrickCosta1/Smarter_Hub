import Button from '../ui/Button';

type DetailsTab = 'ficha' | 'permissoes' | 'estado';

type CollaboratorDetailsModalFooterProps = {
  detailsTab: DetailsTab;
  canEditUser: boolean;
  isSavingEditDraft: boolean;
  onClose: () => void;
  onSave: () => void;
};

export default function CollaboratorDetailsModalFooter({
  detailsTab,
  canEditUser,
  isSavingEditDraft,
  onClose,
  onSave,
}: CollaboratorDetailsModalFooterProps) {
  return (
    <div className="modal-footer-split collaborator-modal-footer">
      <Button type="button" variant="ghost" onClick={onClose}>Fechar</Button>
      {detailsTab === 'ficha' && canEditUser && (
        <Button type="button" variant="primary" isLoading={isSavingEditDraft} disabled={isSavingEditDraft} onClick={onSave}>
          Guardar ficha
        </Button>
      )}
    </div>
  );
}
