import Button from '../ui/Button';
import Skeleton from '../ui/Skeleton';

type CargoHistoryEntry = {
  id: string;
  reviewedAt?: string | null;
  requestedData?: Record<string, unknown>;
  changesSummary?: string | null;
  reviewedBy?: {
    username?: string;
    profile?: {
      nomeAbreviado?: string;
      nomeCompleto?: string;
    } | null;
  } | null;
};

type CollaboratorDetailsStatusPanelProps = {
  isLoadingDetails: boolean;
  isActive: boolean;
  updatedAt: string;
  username: string;
  canManageActive: boolean;
  cargoHistoryEntries: CargoHistoryEntry[];
  onToggleActive: () => void;
};

export default function CollaboratorDetailsStatusPanel({
  isLoadingDetails,
  isActive,
  updatedAt,
  username,
  canManageActive,
  cargoHistoryEntries,
  onToggleActive,
}: CollaboratorDetailsStatusPanelProps) {
  return (
    <section className="cm-panel cm-panel--estado">
      {isLoadingDetails ? (
        <Skeleton lines={3} />
      ) : (
        <>
          <div className="cm-status-cards">
            <div className={`cm-status-card${isActive ? ' cm-status-card--active' : ' cm-status-card--inactive'}`}>
              <span>Conta</span>
              <strong>{isActive ? 'Ativa' : 'Inativa'}</strong>
            </div>
            <div className="cm-status-card">
              <span>Ultima atualizacao</span>
              <strong>{new Intl.DateTimeFormat('pt-PT', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(updatedAt))}</strong>
            </div>
          </div>
          <div className="cm-status-actions">
            <Button
              type="button"
              variant={isActive ? 'danger' : 'primary'}
              onClick={onToggleActive}
              disabled={!canManageActive || username === 't.people'}
            >
              {isActive ? 'Desativar conta' : 'Reativar conta'}
            </Button>
          </div>

          <div className="cm-history-block">
            <h5>Historico de evolucao de cargo</h5>
            {cargoHistoryEntries.length === 0 ? (
              <p className="cm-history-empty">Sem registos de mudanca de cargo ate ao momento.</p>
            ) : (
              <div className="cm-history-list">
                {cargoHistoryEntries.map((entry) => {
                  const reviewedLabel = entry.reviewedAt
                    ? new Intl.DateTimeFormat('pt-PT', {
                        day: '2-digit',
                        month: '2-digit',
                        year: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      }).format(new Date(entry.reviewedAt))
                    : 'Data indisponivel';
                  const requestedData = entry.requestedData || {};
                  const nextCargo = String(requestedData.cargo ?? '').trim() || 'Sem cargo';
                  const previousCargo = String(requestedData.previousCargo ?? '').trim() || 'Sem cargo';
                  const reviewerName = entry.reviewedBy?.profile?.nomeAbreviado
                    || entry.reviewedBy?.profile?.nomeCompleto
                    || entry.reviewedBy?.username
                    || 'Sistema';

                  return (
                    <article key={entry.id} className="cm-history-item">
                      <div>
                        <strong>{previousCargo}{' -> '}{nextCargo}</strong>
                        <p>{entry.changesSummary || 'Alteracao de cargo registada.'}</p>
                      </div>
                      <small>{reviewedLabel} · por {reviewerName}</small>
                    </article>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
}
