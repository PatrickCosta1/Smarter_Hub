import Button from '../ui/Button';
import EmptyState from '../ui/EmptyState';
import Modal from '../ui/Modal';
import Skeleton from '../ui/Skeleton';

type ExportCandidate = {
  id: string;
  email: string;
  username: string;
  profile?: {
    cargo?: string;
    funcao?: string;
    workCountry?: 'PT' | 'BR';
  } | null;
};

type CollaboratorExportModalProps = {
  open: boolean;
  isExportingWorkbook: boolean;
  isLoadingExportCandidates: boolean;
  exportSearch: string;
  exportCandidatesFiltered: ExportCandidate[];
  selectedExportUserId: string;
  selectedExportCandidate: ExportCandidate | null;
  onClose: () => void;
  onExport: () => void;
  onExportSearchChange: (value: string) => void;
  onSelectExportUser: (userId: string) => void;
  getDisplayName: (candidate: ExportCandidate) => string;
  getTeamName: (candidate: ExportCandidate) => string;
};

export default function CollaboratorExportModal({
  open,
  isExportingWorkbook,
  isLoadingExportCandidates,
  exportSearch,
  exportCandidatesFiltered,
  selectedExportUserId,
  selectedExportCandidate,
  onClose,
  onExport,
  onExportSearchChange,
  onSelectExportUser,
  getDisplayName,
  getTeamName,
}: CollaboratorExportModalProps) {
  return (
    <Modal
      open={open}
      title="Exportar ficha de colaborador"
      onClose={onClose}
      width="min(980px, 96vw)"
      showCloseButton={false}
      footer={(
        <div className="modal-footer-split">
          <Button type="button" variant="ghost" onClick={onClose} disabled={isExportingWorkbook}>
            Cancelar
          </Button>
          <Button
            type="button"
            variant="primary"
            isLoading={isExportingWorkbook}
            disabled={!selectedExportCandidate || isLoadingExportCandidates || isExportingWorkbook}
            onClick={onExport}
          >
            Exportar Excel
          </Button>
        </div>
      )}
    >
      <div className="collaborator-export-modal">
        <label className="collaborator-export-modal__search">
          <span>Pesquisar colaborador</span>
          <input
            type="search"
            value={exportSearch}
            placeholder="Nome, username, email, cargo, função, equipa..."
            onChange={(event) => onExportSearchChange(event.target.value)}
          />
        </label>

        {isLoadingExportCandidates ? (
          <Skeleton lines={4} />
        ) : exportCandidatesFiltered.length === 0 ? (
          <EmptyState
            title="Sem colaboradores para exportação."
            message="Ajusta os filtros da listagem ou a pesquisa da janela de exportação."
          />
        ) : (
          <div className="collaborator-export-modal__layout">
            <aside className="collaborator-export-list" aria-label="Selecionar colaborador para exportação">
              {exportCandidatesFiltered.map((item) => {
                const teamName = getTeamName(item);
                const isSelected = selectedExportUserId === item.id;

                return (
                  <button
                    key={item.id}
                    type="button"
                    className={`collaborator-export-item${isSelected ? ' is-selected' : ''}`}
                    onClick={() => onSelectExportUser(item.id)}
                  >
                    <strong>{getDisplayName(item)}</strong>
                    <span>{item.email}</span>
                    <small>{item.profile?.cargo || '-'} · {teamName === '-' ? 'Sem equipa' : teamName}</small>
                  </button>
                );
              })}
            </aside>

            <section className="collaborator-export-preview" aria-live="polite">
              {selectedExportCandidate ? (
                <>
                  <h4>{getDisplayName(selectedExportCandidate)}</h4>
                  <p>{selectedExportCandidate.email}</p>
                  <div className="collaborator-export-preview__grid">
                    <article>
                      <span>Cargo</span>
                      <strong>{selectedExportCandidate.profile?.cargo || '-'}</strong>
                    </article>
                    <article>
                      <span>Função</span>
                      <strong>{selectedExportCandidate.profile?.funcao || '-'}</strong>
                    </article>
                    <article>
                      <span>País</span>
                      <strong>{selectedExportCandidate.profile?.workCountry || 'PT'}</strong>
                    </article>
                    <article>
                      <span>Equipa</span>
                      <strong>{getTeamName(selectedExportCandidate) === '-' ? 'Sem equipa' : getTeamName(selectedExportCandidate)}</strong>
                    </article>
                  </div>
                  <small>O ficheiro inclui logo, resumo executivo e detalhe da ficha por secções para leitura profissional.</small>
                </>
              ) : (
                <EmptyState
                  title="Seleciona um colaborador"
                  message="Escolhe um registo na lista para preparar a exportação."
                />
              )}
            </section>
          </div>
        )}
      </div>
    </Modal>
  );
}
