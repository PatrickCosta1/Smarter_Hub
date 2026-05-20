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
  return (
    <Modal
      open={open}
      title="Confirmar mudanca de pais"
      onClose={onCancel}
      width="min(500px, 94vw)"
      footer={
        <div className="modal-footer-split">
          <Button type="button" variant="ghost" onClick={onCancel}>Cancelar</Button>
          <Button type="button" variant="primary" onClick={onConfirm}>Confirmar e guardar</Button>
        </div>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <p style={{ margin: 0 }}>
          Esta prestes a alterar o pais de trabalho de{' '}
          <strong>{pendingCountryChange?.from === 'BR' ? 'Brasil' : 'Portugal'}</strong>{' '}
          para{' '}
          <strong>{pendingCountryChange?.to === 'BR' ? 'Brasil' : 'Portugal'}</strong>.
        </p>
        <p style={{ margin: 0, fontWeight: 600 }}>O que vai acontecer automaticamente:</p>
        <ul style={{ margin: 0, paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 6, fontSize: '0.9rem' }}>
          <li>Todos os <strong>pedidos de ferias e ausencias pendentes</strong> serao cancelados - foram submetidos sob as regras do pais anterior.</li>
          <li>Todas as <strong>equipas atuais</strong> serao removidas - devera atribuir o colaborador a uma equipa do novo pais.</li>
          <li>
            Os <strong>dados exclusivos de {pendingCountryChange?.from === 'PT' ? 'Portugal' : 'Brasil'} serao apagados</strong>:{' '}
            {pendingCountryChange?.from === 'PT'
              ? 'NIF, NISS, Cartao de Cidadao, IBAN, dados de IRS, matricula, Cartao Continente, comprovativos.'
              : 'CPF, PIS, CTPS, RG, CNH, Titulo de Eleitor, nome do pai/mae, informacoes de beneficios (aposentadoria, seguro-desemprego, vale-transporte).'}
          </li>
          {pendingCountryChange?.to === 'BR' && (
            <li>O <strong>codigo postal</strong> sera apagado - o formato CEP do Brasil e diferente do codigo postal portugues.</li>
          )}
        </ul>
        <p style={{ margin: 0, color: '#6b7280', fontSize: '0.85rem' }}>
          Os registos historicos aprovados, formacoes e dados existentes sao mantidos.
        </p>
      </div>
    </Modal>
  );
}
