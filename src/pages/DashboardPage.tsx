import { useEffect, useMemo, useState } from 'react';
import Button from '../components/ui/Button';
import Badge from '../components/ui/Badge';
import { apiRequest, apiRequestCached, authHeaders, isAbortError } from '../portal/api';

type DistributionItem = {
  label: string;
  count: number;
  share: number;
};

type TeamCharacterization = {
  headcount: number;
  averages: {
    age: number;
    tenure: number;
  };
  retentionRate: number;
  distributions: {
    hierarchy: DistributionItem[];
    geography: DistributionItem[];
    gender: DistributionItem[];
    function: DistributionItem[];
  };
};

type TeamInsights = {
  appliedFilters?: {
    search?: string;
    teamId?: string;
    role?: string;
    gender?: string;
    function?: string;
    geography?: string;
    level?: string;
    isActive?: string;
    periodStart?: string;
    periodEnd?: string;
  };
  selectedTeamName?: string;
  availableFilters?: {
    teams?: Array<{ id: string; name: string }>;
    roles?: string[];
    genders?: string[];
    functions?: string[];
    geographies?: string[];
    levels?: string[];
    activeStates?: Array<{ value: string; label: string }>;
  };
  selected: TeamCharacterization;
  company: TeamCharacterization;
};

type DashboardSummary = {
  refreshedAt?: string;
  teamInsights?: TeamInsights;
};

type DashboardPeriodPreset = 'all' | 'last12m' | 'last3y' | 'last5y' | 'custom';

type DashboardFilters = {
  search: string;
  teamId: string;
  role: string;
  gender: string;
  functionName: string;
  geography: string;
  level: string;
  isActive: 'all' | 'active' | 'inactive';
  periodPreset: DashboardPeriodPreset;
  periodStart: string;
  periodEnd: string;
};

type DashboardExportRow = {
  id: string;
  nome: string;
  username: string;
  email: string;
  numeroMecanografico: string;
  role: string;
  estado: string;
  equipa: string;
  nivel: string;
  funcao: string;
  genero: string;
  geografia: string;
  dataInicioContrato: string;
};

type DashboardCollaboratorsResponse = {
  refreshedAt?: string;
  total: number;
  rows: DashboardExportRow[];
};

const STORAGE_TOKEN_KEY = 'smarter_hub_auth_token';

const DEFAULT_FILTERS: DashboardFilters = {
  search: '',
  teamId: '',
  role: '',
  gender: '',
  functionName: '',
  geography: '',
  level: '',
  isActive: 'all',
  periodPreset: 'all',
  periodStart: '',
  periodEnd: '',
};

const EMPTY_CHARACTERIZATION: TeamCharacterization = {
  headcount: 0,
  averages: {
    age: 0,
    tenure: 0,
  },
  retentionRate: 0,
  distributions: {
    hierarchy: [],
    geography: [],
    gender: [],
    function: [],
  },
};

function getAuthHeaders() {
  const token = localStorage.getItem(STORAGE_TOKEN_KEY) || '';
  return authHeaders(token);
}

function formatDecimal(value: number, digits = 1) {
  return new Intl.NumberFormat('pt-PT', {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  }).format(value);
}

function formatPercent(value: number, digits = 1) {
  return `${formatDecimal(value, digits)}%`;
}

function formatDateTime(value?: string) {
  if (!value) {
    return 'Agora';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return 'Agora';
  }

  return new Intl.DateTimeFormat('pt-PT', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function parseDelta(selected: number, company: number) {
  return selected - company;
}

function formatDeltaPercentPoint(delta: number) {
  const sign = delta > 0 ? '+' : '';
  return `${sign}${formatDecimal(delta, 1)} p.p.`;
}

function formatDateForInput(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function createPresetRange(preset: DashboardPeriodPreset) {
  if (preset === 'all' || preset === 'custom') {
    return { periodStart: '', periodEnd: '' };
  }

  const end = new Date();
  const start = new Date(end);

  if (preset === 'last12m') {
    start.setFullYear(start.getFullYear() - 1);
  }

  if (preset === 'last3y') {
    start.setFullYear(start.getFullYear() - 3);
  }

  if (preset === 'last5y') {
    start.setFullYear(start.getFullYear() - 5);
  }

  return {
    periodStart: formatDateForInput(start),
    periodEnd: formatDateForInput(end),
  };
}

function buildDashboardQuery(filters: DashboardFilters) {
  const params = new URLSearchParams();

  if (filters.search.trim()) {
    params.set('search', filters.search.trim());
  }
  if (filters.teamId) {
    params.set('teamId', filters.teamId);
  }
  if (filters.role) {
    params.set('role', filters.role);
  }
  if (filters.gender) {
    params.set('gender', filters.gender);
  }
  if (filters.functionName) {
    params.set('function', filters.functionName);
  }
  if (filters.geography) {
    params.set('geography', filters.geography);
  }
  if (filters.level) {
    params.set('level', filters.level);
  }
  if (filters.isActive !== 'all') {
    params.set('isActive', filters.isActive);
  }
  if (filters.periodStart) {
    params.set('periodStart', filters.periodStart);
  }
  if (filters.periodEnd) {
    params.set('periodEnd', filters.periodEnd);
  }

  return params;
}

function buildDistributionComparison(teamDist: DistributionItem[], companyDist: DistributionItem[]) {
  const teamMap = new Map(teamDist.map((item) => [item.label, item]));
  const companyMap = new Map(companyDist.map((item) => [item.label, item]));

  const labels = Array.from(new Set([...teamMap.keys(), ...companyMap.keys()]));

  return labels
    .map((label) => {
      const team = teamMap.get(label);
      const company = companyMap.get(label);
      const teamShare = team?.share ?? 0;
      const companyShare = company?.share ?? 0;
      return {
        label,
        teamCount: team?.count ?? 0,
        companyCount: company?.count ?? 0,
        teamShare,
        companyShare,
        delta: parseDelta(teamShare, companyShare),
      };
    })
    .sort((a, b) => b.teamCount - a.teamCount || b.companyCount - a.companyCount || a.label.localeCompare(b.label));
}

export default function DashboardPage() {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [filters, setFilters] = useState<DashboardFilters>(DEFAULT_FILTERS);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    void loadSummary(controller.signal, false, filters);
    return () => controller.abort();
  }, [filters]);

  async function loadSummary(signal?: AbortSignal, forceRefresh = false, appliedFilters = filters) {
    if (forceRefresh) {
      setIsRefreshing(true);
    } else {
      setIsLoading(true);
    }

    setError('');

    const params = buildDashboardQuery(appliedFilters);
    const suffix = params.toString() ? `?${params.toString()}` : '';

    try {
      const payload = await apiRequestCached<DashboardSummary>(`/users/dashboard-summary${suffix}`, {
        headers: getAuthHeaders(),
        signal,
      }, 25000, forceRefresh, 35000);

      if (!signal?.aborted) {
        setSummary(payload);
      }
    } catch (loadError) {
      if (!isAbortError(loadError) && !signal?.aborted) {
        setError(loadError instanceof Error ? loadError.message : 'Não foi possível carregar o dashboard.');
      }
    } finally {
      if (!signal?.aborted) {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    }
  }

  const insights = summary?.teamInsights;
  const selected = insights?.selected ?? EMPTY_CHARACTERIZATION;
  const company = insights?.company ?? EMPTY_CHARACTERIZATION;

  const indicators = useMemo(() => {
    const ageDelta = parseDelta(selected.averages.age, company.averages.age);
    const tenureDelta = parseDelta(selected.averages.tenure, company.averages.tenure);
    const retentionDelta = parseDelta(selected.retentionRate, company.retentionRate);

    return [
      {
        label: 'Idade média',
        selectedValue: `${formatDecimal(selected.averages.age, 1)} anos`,
        companyValue: `${formatDecimal(company.averages.age, 1)} anos`,
        delta: formatDeltaPercentPoint(ageDelta),
      },
      {
        label: 'Tempo médio na Tlantic',
        selectedValue: `${formatDecimal(selected.averages.tenure, 1)} anos`,
        companyValue: `${formatDecimal(company.averages.tenure, 1)} anos`,
        delta: formatDeltaPercentPoint(tenureDelta),
      },
      {
        label: 'Taxa de retenção',
        selectedValue: formatPercent(selected.retentionRate, 1),
        companyValue: formatPercent(company.retentionRate, 1),
        delta: formatDeltaPercentPoint(retentionDelta),
      },
    ];
  }, [company.averages.age, company.averages.tenure, company.retentionRate, selected.averages.age, selected.averages.tenure, selected.retentionRate]);

  const hierarchyComparison = useMemo(() => buildDistributionComparison(selected.distributions.hierarchy, company.distributions.hierarchy), [company.distributions.hierarchy, selected.distributions.hierarchy]);
  const geographyComparison = useMemo(() => buildDistributionComparison(selected.distributions.geography, company.distributions.geography), [company.distributions.geography, selected.distributions.geography]);
  const genderComparison = useMemo(() => buildDistributionComparison(selected.distributions.gender, company.distributions.gender), [company.distributions.gender, selected.distributions.gender]);
  const functionComparison = useMemo(() => buildDistributionComparison(selected.distributions.function, company.distributions.function), [company.distributions.function, selected.distributions.function]);

  function handlePeriodPresetChange(nextPreset: DashboardPeriodPreset) {
    if (nextPreset === 'custom') {
      setFilters((current) => ({ ...current, periodPreset: 'custom' }));
      return;
    }

    const nextRange = createPresetRange(nextPreset);
    setFilters((current) => ({
      ...current,
      periodPreset: nextPreset,
      periodStart: nextRange.periodStart,
      periodEnd: nextRange.periodEnd,
    }));
  }

  async function exportFilteredCollaborators() {
    setIsExporting(true);

    try {
      const params = buildDashboardQuery(filters);
      const suffix = params.toString() ? `?${params.toString()}` : '';
      const payload = await apiRequest<DashboardCollaboratorsResponse>(`/users/dashboard-collaborators${suffix}`, {
        headers: getAuthHeaders(),
      });

      const { Workbook } = await import('exceljs');
      const workbook = new Workbook();
      const worksheet = workbook.addWorksheet('Colaboradores');

      worksheet.columns = [
        { header: 'Nome', key: 'nome', width: 28 },
        { header: 'Username', key: 'username', width: 20 },
        { header: 'Email', key: 'email', width: 32 },
        { header: 'Nº mecanográfico', key: 'numeroMecanografico', width: 18 },
        { header: 'Role', key: 'role', width: 16 },
        { header: 'Estado', key: 'estado', width: 12 },
        { header: 'Equipa', key: 'equipa', width: 26 },
        { header: 'Nível', key: 'nivel', width: 20 },
        { header: 'Função', key: 'funcao', width: 24 },
        { header: 'Género', key: 'genero', width: 14 },
        { header: 'Geografia', key: 'geografia', width: 18 },
        { header: 'Início contrato', key: 'dataInicioContrato', width: 16 },
      ];

      payload.rows.forEach((row) => {
        worksheet.addRow(row);
      });

      worksheet.getRow(1).font = { bold: true };

      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });

      const now = new Date();
      const dateStamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
      const filename = `dashboard-colaboradores-${dateStamp}.xlsx`;

      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : 'Não foi possível exportar o ficheiro Excel.');
    } finally {
      setIsExporting(false);
    }
  }

  return (
    <section className="trainings-shell dashboard-team-shell">
      

      <section className="dashboard-team-filters">
        <label>
          <span>Pesquisa</span>
          <input
            type="search"
            value={filters.search}
            onChange={(event) => setFilters((current) => ({ ...current, search: event.target.value }))}
            placeholder="Nome, username, email, equipa, função, nível, geografia, nº mecanográfico..."
          />
        </label>

        <label>
          <span>Equipa</span>
          <select value={filters.teamId} onChange={(event) => setFilters((current) => ({ ...current, teamId: event.target.value }))}>
            <option value="">Todas</option>
            {(insights?.availableFilters?.teams ?? []).map((team) => (
              <option key={team.id} value={team.id}>{team.name}</option>
            ))}
          </select>
        </label>

        <label>
          <span>Nível hierárquico</span>
          <select value={filters.level} onChange={(event) => setFilters((current) => ({ ...current, level: event.target.value }))}>
            <option value="">Todos</option>
            {(insights?.availableFilters?.levels ?? []).map((level) => (
              <option key={level} value={level}>{level}</option>
            ))}
          </select>
        </label>

        <label>
          <span>Geografia</span>
          <select value={filters.geography} onChange={(event) => setFilters((current) => ({ ...current, geography: event.target.value }))}>
            <option value="">Todas</option>
            {(insights?.availableFilters?.geographies ?? []).map((geo) => (
              <option key={geo} value={geo}>{geo}</option>
            ))}
          </select>
        </label>

        <label>
          <span>Género</span>
          <select value={filters.gender} onChange={(event) => setFilters((current) => ({ ...current, gender: event.target.value }))}>
            <option value="">Todos</option>
            {(insights?.availableFilters?.genders ?? []).map((gender) => (
              <option key={gender} value={gender}>{gender}</option>
            ))}
          </select>
        </label>

        <label>
          <span>Função</span>
          <select value={filters.functionName} onChange={(event) => setFilters((current) => ({ ...current, functionName: event.target.value }))}>
            <option value="">Todas</option>
            {(insights?.availableFilters?.functions ?? []).map((fn) => (
              <option key={fn} value={fn}>{fn}</option>
            ))}
          </select>
        </label>

        <label>
          <span>Role</span>
          <select value={filters.role} onChange={(event) => setFilters((current) => ({ ...current, role: event.target.value }))}>
            <option value="">Todas</option>
            {(insights?.availableFilters?.roles ?? []).map((role) => (
              <option key={role} value={role}>{role}</option>
            ))}
          </select>
        </label>

        <label>
          <span>Estado</span>
          <select value={filters.isActive} onChange={(event) => setFilters((current) => ({ ...current, isActive: event.target.value as DashboardFilters['isActive'] }))}>
            {(insights?.availableFilters?.activeStates ?? []).map((item) => (
              <option key={item.value} value={item.value}>{item.label}</option>
            ))}
          </select>
        </label>

        <label>
          <span>Período</span>
          <select value={filters.periodPreset} onChange={(event) => handlePeriodPresetChange(event.target.value as DashboardPeriodPreset)}>
            <option value="all">Sem período</option>
            <option value="last12m">Últimos 12 meses</option>
            <option value="last3y">Últimos 3 anos</option>
            <option value="last5y">Últimos 5 anos</option>
            <option value="custom">Personalizado</option>
          </select>
        </label>

        {filters.periodPreset === 'custom' && (
          <>
            <label>
              <span>Data início</span>
              <input
                type="date"
                value={filters.periodStart}
                onChange={(event) => setFilters((current) => ({ ...current, periodStart: event.target.value }))}
              />
            </label>

            <label>
              <span>Data fim</span>
              <input
                type="date"
                value={filters.periodEnd}
                onChange={(event) => setFilters((current) => ({ ...current, periodEnd: event.target.value }))}
              />
            </label>
          </>
        )}

        <div className="dashboard-team-filters__actions">
          <Button type="button" variant="ghost" onClick={() => setFilters(DEFAULT_FILTERS)}>Limpar filtros</Button>
          <Button type="button" variant="secondary" isLoading={isRefreshing} onClick={() => void loadSummary(undefined, true, filters)}>Atualizar</Button>
          <Button type="button" variant="primary" isLoading={isExporting} onClick={() => void exportFilteredCollaborators()}>
            Exportar Excel
          </Button>
        </div>
      </section>

      {error ? (
        <article className="dashboard-card dashboard-card--state">
          <div className="vacations-panel-state vacations-panel-state--error">
            <strong>Falha ao carregar o dashboard</strong>
            <p>{error}</p>
            <button type="button" className="vacations-panel-state__action" onClick={() => void loadSummary(undefined, true, filters)}>
              Tentar novamente
            </button>
          </div>
        </article>
      ) : null}

      <section className="dashboard-team-indicators">
        {indicators.map((item) => (
          <article key={item.label} className="dashboard-team-indicator-card">
            <span>{item.label}</span>
            <strong>{item.selectedValue}</strong>
            <small>Empresa: {item.companyValue}</small>
            <Badge tone="neutral">{item.delta}</Badge>
          </article>
        ))}
      </section>

      {isLoading && !summary ? (
        <section className="dashboard-team-distributions">
          <article className="dashboard-team-distribution-card home-card--loading" />
          <article className="dashboard-team-distribution-card home-card--loading" />
          <article className="dashboard-team-distribution-card home-card--loading" />
          <article className="dashboard-team-distribution-card home-card--loading" />
        </section>
      ) : (
        <section className="dashboard-team-distributions">
          <article className="dashboard-team-distribution-card">
            <div className="dashboard-team-distribution-card__head">
              <h3>Distribuição por nível hierárquico</h3>
              <small>Equipa vs Empresa</small>
            </div>
            <div className="dashboard-team-distribution-table">
              {hierarchyComparison.slice(0, 12).map((item) => (
                <div key={`level-${item.label}`} className="dashboard-team-distribution-row">
                  <span>{item.label}</span>
                  <small>{formatPercent(item.teamShare, 1)} · Empresa {formatPercent(item.companyShare, 1)} · {formatDeltaPercentPoint(item.delta)}</small>
                </div>
              ))}
            </div>
          </article>

          <article className="dashboard-team-distribution-card">
            <div className="dashboard-team-distribution-card__head">
              <h3>Distribuição por geografia</h3>
              <small>Equipa vs Empresa</small>
            </div>
            <div className="dashboard-team-distribution-table">
              {geographyComparison.slice(0, 12).map((item) => (
                <div key={`geo-${item.label}`} className="dashboard-team-distribution-row">
                  <span>{item.label}</span>
                  <small>{formatPercent(item.teamShare, 1)} · Empresa {formatPercent(item.companyShare, 1)} · {formatDeltaPercentPoint(item.delta)}</small>
                </div>
              ))}
            </div>
          </article>

          <article className="dashboard-team-distribution-card">
            <div className="dashboard-team-distribution-card__head">
              <h3>Distribuição por género</h3>
              <small>Equipa vs Empresa</small>
            </div>
            <div className="dashboard-team-distribution-table">
              {genderComparison.slice(0, 12).map((item) => (
                <div key={`gender-${item.label}`} className="dashboard-team-distribution-row">
                  <span>{item.label}</span>
                  <small>{formatPercent(item.teamShare, 1)} · Empresa {formatPercent(item.companyShare, 1)} · {formatDeltaPercentPoint(item.delta)}</small>
                </div>
              ))}
            </div>
          </article>

          <article className="dashboard-team-distribution-card">
            <div className="dashboard-team-distribution-card__head">
              <h3>Distribuição por função</h3>
              <small>Equipa vs Empresa</small>
            </div>
            <div className="dashboard-team-distribution-table">
              {functionComparison.slice(0, 12).map((item) => (
                <div key={`fn-${item.label}`} className="dashboard-team-distribution-row">
                  <span>{item.label}</span>
                  <small>{formatPercent(item.teamShare, 1)} · Empresa {formatPercent(item.companyShare, 1)} · {formatDeltaPercentPoint(item.delta)}</small>
                </div>
              ))}
            </div>
          </article>
        </section>
      )}
    </section>
  );
}
