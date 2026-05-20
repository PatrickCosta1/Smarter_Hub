type DetailsFichaSection = 'conta' | 'identificacao' | 'contactos' | 'fiscal' | 'emergencia' | 'contrato';

type FichaSectionItem = {
  id: DetailsFichaSection;
  label: string;
};

type CollaboratorDetailsFichaSubnavProps = {
  sections: FichaSectionItem[];
  selectedSection: DetailsFichaSection;
  missingCounts: Record<DetailsFichaSection, number>;
  onSelectSection: (section: DetailsFichaSection) => void;
};

export default function CollaboratorDetailsFichaSubnav({
  sections,
  selectedSection,
  missingCounts,
  onSelectSection,
}: CollaboratorDetailsFichaSubnavProps) {
  return (
    <nav className="cm-ficha-subnav" aria-label="Subseccoes da ficha do colaborador">
      {sections.map((section) => (
        <button
          key={section.id}
          type="button"
          className={selectedSection === section.id ? 'is-active' : ''}
          onClick={() => onSelectSection(section.id)}
        >
          <span className="cm-ficha-subnav__label">{section.label}</span>
          {missingCounts[section.id] > 0 && (
            <span className="cm-ficha-subnav__count" aria-label={`${missingCounts[section.id]} campo(s) por preencher`}>
              {missingCounts[section.id]}
            </span>
          )}
        </button>
      ))}
    </nav>
  );
}
