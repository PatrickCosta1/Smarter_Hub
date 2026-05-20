type DetailsTab = 'ficha' | 'permissoes' | 'estado';

type CollaboratorDetailsTabsProps = {
  activeTab: DetailsTab;
  onTabChange: (tab: DetailsTab) => void;
};

export default function CollaboratorDetailsTabs({
  activeTab,
  onTabChange,
}: CollaboratorDetailsTabsProps) {
  return (
    <nav className="collaborator-modal-tabs">
      <button type="button" className={activeTab === 'ficha' ? 'is-active' : ''} onClick={() => onTabChange('ficha')}>
        1. Ficha
      </button>
      <button type="button" className={activeTab === 'permissoes' ? 'is-active' : ''} onClick={() => onTabChange('permissoes')}>
        2. Permissoes
      </button>
      <button type="button" className={activeTab === 'estado' ? 'is-active' : ''} onClick={() => onTabChange('estado')}>
        3. Estado
      </button>
    </nav>
  );
}
