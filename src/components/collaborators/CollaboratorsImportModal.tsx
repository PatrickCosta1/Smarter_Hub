import type { ChangeEvent } from 'react';

import Button from '../ui/Button';
import EmptyState from '../ui/EmptyState';
import Modal from '../ui/Modal';

type CollaboratorImportRow = {
  rowNumber: number;
  fullName: string;
  username: string;
  email: string;
  workCountry: 'PT' | 'BR';
  teamName: string;
  subTeamName: string;
  profile: {
    cargo?: string;
    funcao?: string;
  };
};

type CollaboratorImportIssue = {
  rowNumber: number;
  message: string;
};

type CollaboratorImportResult = {
  rowNumber: number;
  username: string;
  email: string;
  fullName?: string;
  status: 'CREATED' | 'FAILED';
  message: string;
};

type CollaboratorsImportModalProps = {
  open: boolean;
  isImportingUsers: boolean;
  isParsingImportFile: boolean;
  importFileName: string;
  importRows: CollaboratorImportRow[];
  importIssues: CollaboratorImportIssue[];
  importPreviewRows: CollaboratorImportRow[];
  importResults: CollaboratorImportResult[];
  importCreatedCount: number;
  importFailedCount: number;
  importFileAccept: string;
  onClose: () => void;
  onImport: () => void;
  onDownloadTemplate: () => void;
  onImportFileChange: (event: ChangeEvent<HTMLInputElement>) => void;
};

export default function CollaboratorsImportModal({
  open,
  isImportingUsers,
  isParsingImportFile,
  importFileName,
  importRows,
  importIssues,
  importPreviewRows,
  importResults,
  importCreatedCount,
  importFailedCount,
  importFileAccept,
  onClose,
  onImport,
  onDownloadTemplate,
  onImportFileChange,
}: CollaboratorsImportModalProps) {
  return (
    <Modal
      open={open}
      title="Importação em massa de colaboradores"
      onClose={onClose}
      width="min(1180px, 96vw)"
      showCloseButton={false}
      footer={(
        <div className="modal-footer-split">
          <Button type="button" variant="ghost" onClick={onClose} disabled={isImportingUsers || isParsingImportFile}>
            Fechar
          </Button>
          <Button
            type="button"
            variant="primary"
            isLoading={isImportingUsers}
            disabled={isParsingImportFile || isImportingUsers || importRows.length === 0 || importIssues.length > 0}
            onClick={onImport}
          >
            Importar {importRows.length > 0 ? `${importRows.length} linha(s)` : ''}
          </Button>
        </div>
      )}
    >
      <div className="collaborator-import-modal">
        <div className="collaborator-import-modal__hero">
          <div>
            <strong>Excel ou CSV da ficha</strong>
            <p>Importa novos colaboradores em lote a partir de um ficheiro com dados da ficha. Campos de comprovativos não entram neste processo e devem ser anexados depois na ficha individual. Esta ação está disponível apenas para quem tem acesso total.</p>
          </div>
          <div className="collaborator-import-modal__hero-actions">
            <Button type="button" variant="ghost" size="sm" onClick={onDownloadTemplate}>
              Descarregar modelo XLSX
            </Button>
            <label className="collaborator-import-upload">
              <span>{isParsingImportFile ? 'A ler ficheiro...' : 'Escolher ficheiro'}</span>
              <input type="file" accept={importFileAccept} onChange={onImportFileChange} disabled={isParsingImportFile || isImportingUsers} />
            </label>
          </div>
        </div>

        <div className="collaborator-import-meta">
          <article>
            <span>Ficheiro</span>
            <strong>{importFileName || 'Nenhum selecionado'}</strong>
          </article>
          <article>
            <span>Linhas preparadas</span>
            <strong>{importRows.length}</strong>
          </article>
          <article>
            <span>Problemas locais</span>
            <strong>{importIssues.length}</strong>
          </article>
        </div>

        {importIssues.length > 0 && (
          <div className="collaborator-import-issues">
            <strong>Corrigir antes de importar</strong>
            <div className="collaborator-import-issues__list">
              {importIssues.slice(0, 20).map((issue) => (
                <p key={`${issue.rowNumber}-${issue.message}`}>Linha {issue.rowNumber}: {issue.message}</p>
              ))}
              {importIssues.length > 20 && <p>+ {importIssues.length - 20} problema(s) adicional(is)</p>}
            </div>
          </div>
        )}

        <div className="collaborator-import-preview">
          <div className="collaborator-import-preview__head">
            <strong>Pré-visualização</strong>
            <span>{importRows.length > 8 ? `A mostrar 8 de ${importRows.length} linhas` : `${importRows.length} linha(s)`}</span>
          </div>
          {importRows.length === 0 ? (
            <EmptyState title="Sem dados carregados" message="Seleciona um ficheiro Excel ou CSV para validar o conteúdo antes da importação." />
          ) : (
            <div className="collaborator-import-preview__table-wrap">
              <table className="collaborator-import-preview__table">
                <thead>
                  <tr>
                    <th>Linha</th>
                    <th>Nome</th>
                    <th>Username</th>
                    <th>Email</th>
                    <th>País</th>
                    <th>Equipa</th>
                    <th>Subequipa</th>
                    <th>Cargo</th>
                    <th>Função</th>
                  </tr>
                </thead>
                <tbody>
                  {importPreviewRows.map((row) => (
                    <tr key={`${row.rowNumber}-${row.username}-${row.email}`}>
                      <td>{row.rowNumber}</td>
                      <td>{row.fullName}</td>
                      <td>{row.username}</td>
                      <td>{row.email}</td>
                      <td>{row.workCountry}</td>
                      <td>{row.teamName || 'Sem equipa'}</td>
                      <td>{row.subTeamName || '-'}</td>
                      <td>{row.profile.cargo || '-'}</td>
                      <td>{row.profile.funcao || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {importResults.length > 0 && (
          <div className="collaborator-import-results">
            <div className="collaborator-import-results__head">
              <strong>Resultado da execução</strong>
              <span>{importCreatedCount} criado(s) · {importFailedCount} falhado(s)</span>
            </div>
            <div className="collaborator-import-results__list">
              {importResults.map((item) => (
                <article key={`${item.rowNumber}-${item.username}-${item.status}`} className={`collaborator-import-result${item.status === 'CREATED' ? ' is-success' : ' is-failed'}`}>
                  <div>
                    <strong>Linha {item.rowNumber} · {item.fullName || item.username || item.email}</strong>
                    <p>{item.username} · {item.email}</p>
                  </div>
                  <span>{item.message}</span>
                </article>
              ))}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
