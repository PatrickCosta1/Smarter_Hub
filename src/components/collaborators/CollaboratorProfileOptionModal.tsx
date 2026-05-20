import Button from '../ui/Button';
import Modal from '../ui/Modal';

type CollaboratorProfileOptionModalProps = {
  open: boolean;
  profileOptionType: 'CARGO' | 'FUNCAO';
  profileOptionLabel: string;
  profileOptionGroup: string;
  isSavingProfileOption: boolean;
  onClose: () => void;
  onSave: () => void;
  onTypeChange: (value: 'CARGO' | 'FUNCAO') => void;
  onLabelChange: (value: string) => void;
  onGroupChange: (value: string) => void;
};

export default function CollaboratorProfileOptionModal({
  open,
  profileOptionType,
  profileOptionLabel,
  profileOptionGroup,
  isSavingProfileOption,
  onClose,
  onSave,
  onTypeChange,
  onLabelChange,
  onGroupChange,
}: CollaboratorProfileOptionModalProps) {
  return (
    <Modal
      open={open}
      title={profileOptionType === 'CARGO' ? 'Adicionar novo cargo' : 'Adicionar nova funcao'}
      onClose={onClose}
      width="520px"
      footer={(
        <div className="profile-option-modal__footer">
          <Button type="button" variant="ghost" onClick={onClose} disabled={isSavingProfileOption}>
            Cancelar
          </Button>
          <Button type="button" variant="primary" isLoading={isSavingProfileOption} onClick={onSave}>
            Guardar
          </Button>
        </div>
      )}
    >
      <div className="profile-option-modal">
        <label>
          <span>Tipo</span>
          <select value={profileOptionType} onChange={(event) => onTypeChange(event.target.value as 'CARGO' | 'FUNCAO')} disabled={isSavingProfileOption}>
            <option value="CARGO">Cargo</option>
            <option value="FUNCAO">Funcao</option>
          </select>
        </label>

        <label>
          <span>Nome</span>
          <input
            type="text"
            value={profileOptionLabel}
            disabled={isSavingProfileOption}
            placeholder={profileOptionType === 'CARGO' ? 'Ex.: Staff Engineer' : 'Ex.: Data Governance Specialist'}
            onChange={(event) => onLabelChange(event.target.value)}
          />
        </label>

        {profileOptionType === 'FUNCAO' && (
          <label>
            <span>Grupo (opcional)</span>
            <input
              type="text"
              value={profileOptionGroup}
              disabled={isSavingProfileOption}
              placeholder="Ex.: Produto"
              onChange={(event) => onGroupChange(event.target.value)}
            />
          </label>
        )}
      </div>
    </Modal>
  );
}
