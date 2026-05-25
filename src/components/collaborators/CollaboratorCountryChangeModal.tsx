import Button from '../ui/Button';
import Modal from '../ui/Modal';

type PendingCountryChange = {
  from: 'PT' | 'BR';
  to: 'PT' | 'BR';
};

type CollaboratorCountryChangeModalProps = {
  open: boolean;
  pendingCountryChange: PendingCountryChange | null;
  onCancel: () => void;
  onConfirm: () => void;
};

export default function CollaboratorCountryChangeModal({
  open,
  pendingCountryChange,
  onCancel,
  onConfirm,
}: CollaboratorCountryChangeModalProps) {
  const fromCountry = pendingCountryChange?.from === 'BR' ? 'Brasil' : 'Portugal';
  const toCountry = pendingCountryChange?.to === 'BR' ? 'Brasil' : 'Portugal';

  return (
    <Modal
      open={open}
      title="Confirmar mudança de país"
      onClose={onCancel}
      width="min(580px, 94vw)"
      footer={
        <div className="modal-footer-split">
          <Button type="button" variant="ghost" onClick={onCancel}>Cancelar</Button>
          <Button type="button" variant="primary" onClick={onConfirm}>Confirmar e guardar</Button>
        </div>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <p style={{ margin: 0 }}>
          Está prestes a alterar o país de trabalho de <strong>{fromCountry}</strong> para <strong>{toCountry}</strong>.
        </p>
        <p style={{ margin: 0, fontWeight: 600 }}>O que vai acontecer automaticamente:</p>
        <ul style={{ margin: 0, paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 6, fontSize: '0.9rem' }}>
          <li>Todos os <strong>pedidos de férias e ausências pendentes</strong> serão cancelados, porque foram submetidos com as regras do país anterior.</li>
          <li>Todas as <strong>equipas atuais</strong> serão removidas e o colaborador terá de ser reatribuído a uma equipa do novo país.</li>
          <li>
            Os <strong>dados exclusivos de {fromCountry}</strong> serão apagados, os campos exclusivos de {toCountry} serão inicializados,
            e os campos comuns serão mantidos.
          </li>
          {pendingCountryChange?.to === 'BR' && (
            <li>O <strong>código postal</strong> será limpo para evitar conflito de formato com o CEP do Brasil.</li>
          )}
        </ul>
        <p style={{ margin: 0, color: '#6b7280', fontSize: '0.85rem' }}>
          Registos históricos aprovados, formações e restantes dados aplicáveis continuam preservados.
        </p>
      </div>
    </Modal>
  );
}
