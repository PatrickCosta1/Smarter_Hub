import type { ReactNode } from 'react';

import CollaboratorDetailsTabs from './CollaboratorDetailsTabs';

type DetailsTab = 'ficha' | 'permissoes' | 'estado';

type CollaboratorDetailsModalShellProps = {
  activeTab: DetailsTab;
  onTabChange: (tab: DetailsTab) => void;
  fichaContent: ReactNode;
  permissoesContent: ReactNode;
  estadoContent: ReactNode;
};

export default function CollaboratorDetailsModalShell({
  activeTab,
  onTabChange,
  fichaContent,
  permissoesContent,
  estadoContent,
}: CollaboratorDetailsModalShellProps) {
  return (
    <section className="collaborator-modal-shell">
      <CollaboratorDetailsTabs activeTab={activeTab} onTabChange={onTabChange} />
      {activeTab === 'ficha' && fichaContent}
      {activeTab === 'permissoes' && permissoesContent}
      {activeTab === 'estado' && estadoContent}
    </section>
  );
}
