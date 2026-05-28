import Button from '../ui/Button';
import Modal from '../ui/Modal';

export type CollaboratorCreateDraft = {
  fullName: string;
  personalEmail: string;
  workCountry: 'PT' | 'BR';
  brWorkState: '' | 'SP' | 'RS';
};

type CollaboratorCreateModalProps = {
  open: boolean;
  isCreatingUser: boolean;
  draft: CollaboratorCreateDraft;
  onClose: () => void;
  onSubmit: () => void;
  onDraftChange: (patch: Partial<CollaboratorCreateDraft>) => void;
  canConfigureFormSettings?: boolean;
  onOpenFormSettings?: () => void;
};

export default function CollaboratorCreateModal({
  open,
  isCreatingUser,
  draft,
  onClose,
  onSubmit,
  onDraftChange,
  canConfigureFormSettings = false,
  onOpenFormSettings,
}: CollaboratorCreateModalProps) {
  return (
    <Modal
      open={open}
      title="Novo colaborador"
      onClose={onClose}
      width="min(700px, 94vw)"
      footer={
        <div className="modal-footer-split">
          <Button type="button" variant="ghost" onClick={onClose} disabled={isCreatingUser}>Cancelar</Button>
          <Button type="button" variant="primary" isLoading={isCreatingUser} onClick={onSubmit}>Enviar convite</Button>
        </div>
      }
    >
      <form className="trainings-form" onSubmit={(event) => { event.preventDefault(); onSubmit(); }}>
        <label>
          <span>Nome completo</span>
          <input
            type="text"
            value={draft.fullName}
            onChange={(event) => onDraftChange({ fullName: event.target.value })}
            placeholder="Ex.: Ana Rodrigues"
            autoComplete="off"
            disabled={isCreatingUser}
          />
        </label>
        <label>
          <span>Email pessoal</span>
          <input
            type="email"
            value={draft.personalEmail}
            onChange={(event) => onDraftChange({ personalEmail: event.target.value })}
            placeholder="ana@email.com"
            autoComplete="off"
            disabled={isCreatingUser}
          />
          <small>Será enviado um link único e seguro para preencher a ficha de admissão.</small>
        </label>
        <label>
          <span>País de trabalho</span>
          <select
            value={draft.workCountry}
            onChange={(event) => onDraftChange({ workCountry: event.target.value as 'PT' | 'BR' })}
            disabled={isCreatingUser}
          >
            <option value="PT">Portugal</option>
            <option value="BR">Brasil</option>
          </select>
        </label>
        {draft.workCountry === 'BR' ? (
          <label>
            <span>Estado de trabalho</span>
            <select
              value={draft.brWorkState}
              onChange={(event) => onDraftChange({ brWorkState: event.target.value as '' | 'SP' | 'RS' })}
              disabled={isCreatingUser}
            >
              <option value="">Selecionar</option>
              <option value="SP">Sao Paulo</option>
              <option value="RS">Rio Grande do Sul</option>
            </select>
          </label>
        ) : null}

        {canConfigureFormSettings ? (
          <div style={{
            display: 'grid',
            gap: 8,
            padding: '12px 14px',
            borderRadius: 10,
            border: '1px solid #dbe6f5',
            background: '#f8fbff',
          }}>
            <small style={{ color: '#335174', fontSize: 12 }}>
              Precisa de ajustar os campos obrigatórios do formulário enviado por email?
            </small>
            <div>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={isCreatingUser || !onOpenFormSettings}
                onClick={() => onOpenFormSettings?.()}
              >
                Configurar campos do formulário
              </Button>
            </div>
          </div>
        ) : null}
      </form>
    </Modal>
  );
}
