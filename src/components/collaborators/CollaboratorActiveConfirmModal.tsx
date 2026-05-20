import Button from '../ui/Button';
import Modal from '../ui/Modal';

type CollaboratorActiveConfirmTarget = {
  id: string;
  isActive: boolean;
  displayName: string;
};

type CollaboratorActiveConfirmModalProps = {
  target: CollaboratorActiveConfirmTarget | null;
  isBusy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

export default function CollaboratorActiveConfirmModal({
  target,
  isBusy,
  onCancel,
  onConfirm,
}: CollaboratorActiveConfirmModalProps) {
  return (
    <Modal
      open={Boolean(target)}
      title={target?.isActive ? 'Confirmar desativacao' : 'Confirmar reativacao'}
      onClose={onCancel}
      width="min(640px, 92vw)"
      showCloseButton={false}
      footer={
        <div className="modal-footer-split">
          <Button type="button" variant="ghost" onClick={onCancel}>Cancelar</Button>
          <Button
            type="button"
            variant={target?.isActive ? 'danger' : 'primary'}
            isLoading={isBusy}
            disabled={isBusy}
            onClick={onConfirm}
          >
            Confirmar
          </Button>
        </div>
      }
    >
      <div className="permissions-access-modal">
        <p>
          {target?.isActive
            ? `Isto vai desativar a conta de ${target.displayName}.`
            : `Isto vai reativar a conta de ${target?.displayName || 'este colaborador'}.`}
        </p>
      </div>
    </Modal>
  );
}
