import { RefObject } from 'react';

type ActiveFilter = 'ALL' | 'ACTIVE' | 'INACTIVE';
type CountryFilter = 'ALL' | 'PT' | 'BR';
type SortBy = 'createdAt' | 'updatedAt' | 'username' | 'email';
type SortDirection = 'asc' | 'desc';

type CollaboratorsFilterBarProps = {
  collaboratorQueryInputRef: RefObject<HTMLInputElement>;
  query: string;
  activeFilter: ActiveFilter;
  countryFilter: CountryFilter;
  sortBy: SortBy;
  sortDirection: SortDirection;
  pageSize: number;
  hasCustomFilters: boolean;
  activeFilterTags: string[];
  onQueryChange: (value: string) => void;
  onActiveFilterChange: (value: ActiveFilter) => void;
  onCountryFilterChange: (value: CountryFilter) => void;
  onSortByChange: (value: SortBy) => void;
  onSortDirectionChange: (value: SortDirection) => void;
  onPageSizeChange: (value: number) => void;
  onClearFilters: () => void;
};

export default function CollaboratorsFilterBar({
  collaboratorQueryInputRef,
  query,
  activeFilter,
  countryFilter,
  sortBy,
  sortDirection,
  pageSize,
  hasCustomFilters,
  activeFilterTags,
  onQueryChange,
  onActiveFilterChange,
  onCountryFilterChange,
  onSortByChange,
  onSortDirectionChange,
  onPageSizeChange,
  onClearFilters,
}: CollaboratorsFilterBarProps) {
  return (
    <div className="collaborators-filter-bar">
      <div className="collaborators-filter-group collaborators-filter-group--primary">
        <label className="collaborators-filter-group__search">
          <span>Pesquisar</span>
          <input
            ref={collaboratorQueryInputRef}
            type="search"
            value={query}
            autoComplete="off"
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="Nome, username, email, cargo, função..."
          />
        </label>

        <label>
          <span>Estado</span>
          <select value={activeFilter} onChange={(event) => onActiveFilterChange(event.target.value as ActiveFilter)}>
            <option value="ACTIVE">Ativo</option>
            <option value="INACTIVE">Inativo</option>
            <option value="ALL">Todos</option>
          </select>
        </label>

        <label>
          <span>País</span>
          <select value={countryFilter} onChange={(event) => onCountryFilterChange(event.target.value as CountryFilter)}>
            <option value="ALL">Todos</option>
            <option value="PT">Portugal</option>
            <option value="BR">Brasil</option>
          </select>
        </label>
      </div>

      <div className="collaborators-filter-group collaborators-filter-group--sort">
        <label>
          <span>Ordenar por</span>
          <select value={sortBy} onChange={(event) => onSortByChange(event.target.value as SortBy)}>
            <option value="updatedAt">Atualização</option>
            <option value="createdAt">Criação</option>
            <option value="username">Username</option>
            <option value="email">Email</option>
          </select>
        </label>

        <label>
          <span>Direção</span>
          <select value={sortDirection} onChange={(event) => onSortDirectionChange(event.target.value as SortDirection)}>
            <option value="desc">↓ Desc</option>
            <option value="asc">↑ Asc</option>
          </select>
        </label>

        <label>
          <span>Por página</span>
          <select value={pageSize} onChange={(event) => onPageSizeChange(Number(event.target.value))}>
            <option value={10}>10</option>
            <option value={20}>20</option>
            <option value={50}>50</option>
          </select>
        </label>

        <button
          type="button"
          className="collaborators-filter-clear-btn"
          onClick={onClearFilters}
          disabled={!hasCustomFilters && sortBy === 'updatedAt' && sortDirection === 'desc'}
        >
          Limpar filtros
        </button>
      </div>

      <div className="collaborators-filter-summary" aria-live="polite">
        <span className="collaborators-filter-summary__label">Filtros ativos</span>
        {activeFilterTags.length === 0 ? (
          <span className="collaborators-filter-summary__chip collaborators-filter-summary__chip--muted">Padrão</span>
        ) : (
          activeFilterTags.map((tag) => (
            <span key={tag} className="collaborators-filter-summary__chip">{tag}</span>
          ))
        )}
      </div>
    </div>
  );
}
