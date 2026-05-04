import { useEffect, useMemo, useRef, useState } from 'react';
import Button from '../components/ui/Button';
import { apiRequest, apiRequestCached, authHeaders, isAbortError } from '../portal/api';
import { tipoContratoOptions } from '../portal/data';

type DistributionItem = {
  label: string;
  count: number;
  share: number;
};

type AvgTenureByFunction = {
  label: string;
  avgTenure: number;
  count: number;
};

type TeamCharacterization = {
  headcount: number;
  averages: {
    age: number;
    tenure: number;
  };
  retentionRate: number;
  nosVoucherRate: number;
  avgVoucherRequestLeadDays: number | null;
  continenteCardRate: number;
  avgTenureByFunction: AvgTenureByFunction[];
  distributions: {
    hierarchy: DistributionItem[];
    geography: DistributionItem[];
    gender: DistributionItem[];
    function: DistributionItem[];
  };
};

type TeamInsights = {
  appliedFilters?: {
    teamId?: string;
    gender?: string;
    function?: string;
    contractTypes?: string[];
    geography?: string;
    level?: string;
    isActive?: string;
    periodStart?: string;
    periodEnd?: string;
  };
  selectedTeamName?: string;
  availableFilters?: {
    teams?: Array<{ id: string; name: string }>;
    genders?: string[];
    functions?: string[];
    contractTypes?: string[];
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
  teamId: string;
  gender: string;
  functionName: string;
  contractTypes: string[];
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

type DrillDimension = 'hierarchy' | 'geography' | 'gender' | 'function';

type DrillStep = {
  dimension: DrillDimension;
  label: string;
  previousFilters: DashboardFilters;
  previousFunctionSearch: string;
};

const STORAGE_TOKEN_KEY = 'smarter_hub_auth_token';

const DEFAULT_FILTERS: DashboardFilters = {
  teamId: '',
  gender: '',
  functionName: '',
  contractTypes: [],
  geography: '',
  level: '',
  isActive: 'all',
  periodPreset: 'all',
  periodStart: '',
  periodEnd: '',
};

function normalizeDashboardFilters(input?: Partial<DashboardFilters> | null): DashboardFilters {
  const base = input || {};

  return {
    ...DEFAULT_FILTERS,
    ...base,
    contractTypes: Array.isArray(base.contractTypes)
      ? base.contractTypes.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      : [],
  };
}

const EMPTY_CHARACTERIZATION: TeamCharacterization = {
  headcount: 0,
  averages: { age: 0, tenure: 0 },
  retentionRate: 0,
  nosVoucherRate: 0,
  avgVoucherRequestLeadDays: null,
  continenteCardRate: 0,
  avgTenureByFunction: [],
  distributions: {
    hierarchy: [],
    geography: [],
    gender: [],
    function: [],
  },
};

const PIE_COLORS = [
  '#3b82f6', '#ef4444', '#22c55e', '#a855f7', '#f59e0b',
  '#14b8a6', '#ec4899', '#64748b', '#0ea5e9', '#84cc16',
];

const DRILL_DIMENSION_TO_FILTER: Record<DrillDimension, keyof DashboardFilters> = {
  hierarchy: 'level',
  geography: 'geography',
  gender: 'gender',
  function: 'functionName',
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

function formatDeltaSign(delta: number, suffix = ' p.p.') {
  const sign = delta > 0 ? '+' : '';
  return `${sign}${formatDecimal(delta, 1)}${suffix}`;
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
  const normalizedFilters = normalizeDashboardFilters(filters);
  const params = new URLSearchParams();

  if (normalizedFilters.teamId) {
    params.set('teamId', normalizedFilters.teamId);
  }
  if (normalizedFilters.gender) {
    params.set('gender', normalizedFilters.gender);
  }
  if (normalizedFilters.functionName) {
    params.set('function', normalizedFilters.functionName);
  }
  if (normalizedFilters.contractTypes.length > 0) {
    normalizedFilters.contractTypes.forEach((contractType) => params.append('contractType', contractType));
  }
  if (normalizedFilters.geography) {
    params.set('geography', normalizedFilters.geography);
  }
  if (normalizedFilters.level) {
    params.set('level', normalizedFilters.level);
  }
  if (normalizedFilters.isActive !== 'all') {
    params.set('isActive', normalizedFilters.isActive);
  }
  if (normalizedFilters.periodStart) {
    params.set('periodStart', normalizedFilters.periodStart);
  }
  if (normalizedFilters.periodEnd) {
    params.set('periodEnd', normalizedFilters.periodEnd);
  }

  return params;
}

// ─── Pie Chart SVG ─────────────────────────────────────────────────────────────

function PieChart({
  data,
  maxLegend = 8,
  onSelect,
  selectedLabel,
}: {
  data: DistributionItem[];
  maxLegend?: number;
  onSelect?: (label: string) => void;
  selectedLabel?: string;
}) {
  const total = data.reduce((s, d) => s + d.count, 0);
  if (total === 0 || data.length === 0) {
    return <div className="ds-pie__empty">Sem dados</div>;
  }

  let currentAngle = -Math.PI / 2;
  const slices = data.slice(0, 9).map((item, i) => {
    const angle = (item.count / total) * Math.PI * 2;
    const startAngle = currentAngle;
    currentAngle += angle;
    const x1 = (50 + 42 * Math.cos(startAngle)).toFixed(3);
    const y1 = (50 + 42 * Math.sin(startAngle)).toFixed(3);
    const x2 = (50 + 42 * Math.cos(currentAngle)).toFixed(3);
    const y2 = (50 + 42 * Math.sin(currentAngle)).toFixed(3);
    const largeArc = angle > Math.PI ? 1 : 0;
    return {
      path: `M 50 50 L ${x1} ${y1} A 42 42 0 ${largeArc} 1 ${x2} ${y2} Z`,
      color: PIE_COLORS[i % PIE_COLORS.length],
      ...item,
    };
  });

  return (
    <div className="ds-pie-wrap">
      <svg viewBox="0 0 100 100" className="ds-pie__svg" aria-hidden="true">
        {slices.map((slice) => (
          <path
            key={slice.label}
            d={slice.path}
            fill={slice.color}
            role={onSelect ? 'button' : undefined}
            tabIndex={onSelect ? 0 : undefined}
            aria-label={onSelect ? `Filtrar por ${slice.label}` : undefined}
            className={[
              onSelect ? 'ds-pie__slice--interactive' : '',
              selectedLabel && selectedLabel === slice.label ? 'ds-pie__slice--selected' : '',
            ].filter(Boolean).join(' ')}
            onClick={onSelect ? () => onSelect(slice.label) : undefined}
            onKeyDown={onSelect ? (event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                onSelect(slice.label);
              }
            } : undefined}
          />
        ))}
      </svg>
      <div className="ds-pie__legend">
        {data.slice(0, maxLegend).map((item, i) => (
          <button
            key={item.label}
            type="button"
            className={`ds-pie__legend-row ${selectedLabel && selectedLabel === item.label ? 'ds-pie__legend-row--selected' : ''}`}
            onClick={onSelect ? () => onSelect(item.label) : undefined}
            disabled={!onSelect}
          >
            <span className="ds-pie__legend-dot" style={{ background: PIE_COLORS[i % PIE_COLORS.length] }} />
            <span className="ds-pie__legend-label" title={item.label}>{item.label}</span>
            <span className="ds-pie__legend-pct">{formatPercent(item.share, 0)}</span>
          </button>
        ))}
        {data.length > maxLegend && (
          <div className="ds-pie__legend-row ds-pie__legend-row--more">
            <span className="ds-pie__legend-dot" style={{ background: '#94a3b8' }} />
            <span className="ds-pie__legend-label">+{data.length - maxLegend} outros</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── KPI indicator ──────────────────────────────────────────────────────────────

function KpiCard({
  label,
  value,
  companyValue,
  delta,
  deltaPositiveIsGood = true,
  tooltip,
  unit,
}: {
  label: string;
  value: string;
  companyValue?: string;
  delta?: number;
  deltaPositiveIsGood?: boolean;
  tooltip?: string;
  unit?: string;
}) {
  const [showTooltip, setShowTooltip] = useState(false);
  const deltaClass = delta === undefined
    ? ''
    : delta === 0
      ? 'ds-kpi__delta--neutral'
      : (deltaPositiveIsGood ? delta > 0 : delta < 0)
        ? 'ds-kpi__delta--up'
        : 'ds-kpi__delta--down';

  return (
    <article className="ds-kpi-card">
      <div className="ds-kpi-card__header">
        <span className="ds-kpi-card__label">{label}</span>
        {tooltip && (
          <button
            type="button"
            className="ds-kpi-card__info"
            aria-label="Informação"
            onMouseEnter={() => setShowTooltip(true)}
            onMouseLeave={() => setShowTooltip(false)}
            onFocus={() => setShowTooltip(true)}
            onBlur={() => setShowTooltip(false)}
          >
            ?
            {showTooltip && <span className="ds-kpi-card__tooltip">{tooltip}</span>}
          </button>
        )}
      </div>
      <div className="ds-kpi-card__value">
        {value}
        {unit && <span className="ds-kpi-card__unit">{unit}</span>}
      </div>
      {companyValue && (
        <div className="ds-kpi-card__company">
          Empresa: <strong>{companyValue}</strong>
          {delta !== undefined && (
            <span className={`ds-kpi__delta ${deltaClass}`}>{formatDeltaSign(delta)}</span>
          )}
        </div>
      )}
    </article>
  );
}

export default function DashboardPage() {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [filters, setFilters] = useState<DashboardFilters>(DEFAULT_FILTERS);
  const [functionSearch, setFunctionSearch] = useState('');
  const [isContractDropdownOpen, setIsContractDropdownOpen] = useState(false);
  const [drillPath, setDrillPath] = useState<DrillStep[]>([]);
  const [drillRows, setDrillRows] = useState<DashboardExportRow[]>([]);
  const [drillRowsTotal, setDrillRowsTotal] = useState(0);
  const [isLoadingDrillRows, setIsLoadingDrillRows] = useState(false);
  const [drillRowsError, setDrillRowsError] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [error, setError] = useState('');
  const contractDropdownRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isContractDropdownOpen) {
      return;
    }

    const handleOutsideClick = (event: MouseEvent) => {
      if (!contractDropdownRef.current) {
        return;
      }

      if (event.target instanceof Node && !contractDropdownRef.current.contains(event.target)) {
        setIsContractDropdownOpen(false);
      }
    };

    window.addEventListener('mousedown', handleOutsideClick);
    return () => window.removeEventListener('mousedown', handleOutsideClick);
  }, [isContractDropdownOpen]);

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

  const availableFunctions = insights?.availableFilters?.functions ?? [];
  const availableContractTypes = tipoContratoOptions;
  const filteredFunctionOptions = functionSearch.trim()
    ? availableFunctions.filter((fn) => fn.toLowerCase().includes(functionSearch.toLowerCase()))
    : availableFunctions;

  const kpis = useMemo(() => [
    {
      label: 'Idade média',
      value: `${formatDecimal(selected.averages.age, 1)} anos`,
      companyValue: `${formatDecimal(company.averages.age, 1)} anos`,
      delta: parseDelta(selected.averages.age, company.averages.age),
      deltaPositiveIsGood: false,
    },
    {
      label: 'Tempo médio na Tlantic',
      value: `${formatDecimal(selected.averages.tenure, 1)} anos`,
      companyValue: `${formatDecimal(company.averages.tenure, 1)} anos`,
      delta: parseDelta(selected.averages.tenure, company.averages.tenure),
      deltaPositiveIsGood: true,
    },
    {
      label: 'Taxa de retenção',
      value: formatPercent(selected.retentionRate, 1),
      companyValue: formatPercent(company.retentionRate, 1),
      delta: parseDelta(selected.retentionRate, company.retentionRate),
      deltaPositiveIsGood: true,
      tooltip: 'Calculado com base no rácio de colaboradores ativos vs total (incluindo inativos).',
    },
    {
      label: '% elegíveis que pediram voucher NOS',
      value: formatPercent(selected.nosVoucherRate, 1),
      companyValue: formatPercent(company.nosVoucherRate, 1),
      delta: parseDelta(selected.nosVoucherRate, company.nosVoucherRate),
      deltaPositiveIsGood: true,
      tooltip: 'Percentagem de colaboradores elegíveis ao voucher NOS que já o pediram.',
    },
    {
      label: 'Tempo médio até pedir voucher NOS',
      value: selected.avgVoucherRequestLeadDays !== null
        ? `${formatDecimal(selected.avgVoucherRequestLeadDays, 0)} dias`
        : '-',
      companyValue: company.avgVoucherRequestLeadDays !== null
        ? `${formatDecimal(company.avgVoucherRequestLeadDays, 0)} dias`
        : '-',
      delta: selected.avgVoucherRequestLeadDays !== null && company.avgVoucherRequestLeadDays !== null
        ? parseDelta(selected.avgVoucherRequestLeadDays, company.avgVoucherRequestLeadDays)
        : undefined,
      deltaPositiveIsGood: false,
      tooltip: 'Tempo médio entre o início de contrato e o pedido do voucher NOS, apenas para colaboradores elegíveis que já o pediram.',
    },
    {
      label: '% Cartão Continente preenchido',
      value: formatPercent(selected.continenteCardRate, 1),
      companyValue: formatPercent(company.continenteCardRate, 1),
      delta: parseDelta(selected.continenteCardRate, company.continenteCardRate),
      deltaPositiveIsGood: true,
      tooltip: 'Percentagem de colaboradores ativos com número do cartão Continente registado no perfil.',
    },
  ], [selected, company]);

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

  async function loadDrillThroughRows(activeFilters: DashboardFilters, signal?: AbortSignal) {
    if (drillPath.length === 0) {
      setDrillRows([]);
      setDrillRowsTotal(0);
      setDrillRowsError('');
      return;
    }

    setIsLoadingDrillRows(true);
    setDrillRowsError('');

    try {
      const params = buildDashboardQuery(activeFilters);
      const suffix = params.toString() ? `?${params.toString()}` : '';
      const payload = await apiRequestCached<DashboardCollaboratorsResponse>(`/users/dashboard-collaborators${suffix}`, {
        headers: getAuthHeaders(),
        signal,
      }, 15000, true, 25000);

      if (!signal?.aborted) {
        setDrillRows(payload.rows.slice(0, 12));
        setDrillRowsTotal(payload.total);
      }
    } catch (loadError) {
      if (!isAbortError(loadError) && !signal?.aborted) {
        setDrillRowsError(loadError instanceof Error ? loadError.message : 'Falha ao carregar detalhe do drill-through.');
      }
    } finally {
      if (!signal?.aborted) {
        setIsLoadingDrillRows(false);
      }
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    void loadDrillThroughRows(filters, controller.signal);
    return () => controller.abort();
  }, [filters, drillPath.length]);

  function clearDrillPath() {
    if (drillPath.length === 0) {
      return;
    }

    const firstStep = drillPath[0];
    setFilters(normalizeDashboardFilters(firstStep.previousFilters));
    setFunctionSearch(firstStep.previousFunctionSearch);
    setDrillPath([]);
  }

  function drillUp() {
    if (drillPath.length === 0) {
      return;
    }

    const lastStep = drillPath[drillPath.length - 1];
    setFilters(normalizeDashboardFilters(lastStep.previousFilters));
    setFunctionSearch(lastStep.previousFunctionSearch);
    setDrillPath((current) => current.slice(0, -1));
  }

  function applyDrillDown(dimension: DrillDimension, label: string) {
    const trimmedLabel = label.trim();
    if (!trimmedLabel) {
      return;
    }

    const targetFilter = DRILL_DIMENSION_TO_FILTER[dimension];
    const currentValue = String(filters[targetFilter] ?? '');

    if (currentValue.toLowerCase() === trimmedLabel.toLowerCase()) {
      return;
    }

    setDrillPath((current) => [
      ...current,
      {
        dimension,
        label: trimmedLabel,
        previousFilters: filters,
        previousFunctionSearch: functionSearch,
      },
    ]);

    setFilters((current) => ({
      ...current,
      [targetFilter]: trimmedLabel,
    }));

    if (targetFilter === 'functionName') {
      setFunctionSearch(trimmedLabel);
    }
  }

  function updateFiltersManual(updater: (current: DashboardFilters) => DashboardFilters) {
    setDrillPath([]);
    setFilters((current) => normalizeDashboardFilters(updater(current)));
  }

  const hasActiveFilters = Object.entries(filters).some(([key, val]) => (
    !['periodPreset', 'periodStart', 'periodEnd'].includes(key)
    && (Array.isArray(val) ? val.length > 0 : Boolean(val) && val !== 'all')
  ));

  const activeDrillLabel = drillPath.length > 0
    ? drillPath.map((step, index) => `${index + 1}. ${step.label}`).join(' → ')
    : '';

  return (
    <section className="trainings-shell dashboard-team-shell">

      {/* ─── Filtros ─── */}
      <section className="ds-filters">
        <div className="ds-filters__grid">
          <label className="ds-filters__field">
            <span>Equipa</span>
            <select value={filters.teamId} onChange={(event) => updateFiltersManual((current) => ({ ...current, teamId: event.target.value }))}>
              <option value="">Todas</option>
              {(insights?.availableFilters?.teams ?? []).map((team) => (
                <option key={team.id} value={team.id}>{team.name}</option>
              ))}
            </select>
          </label>

          <label className="ds-filters__field">
            <span>Nível hierárquico</span>
            <select value={filters.level} onChange={(event) => updateFiltersManual((current) => ({ ...current, level: event.target.value }))}>
              <option value="">Todos</option>
              {(insights?.availableFilters?.levels ?? []).map((level) => (
                <option key={level} value={level}>{level}</option>
              ))}
            </select>
          </label>

          <label className="ds-filters__field">
            <span>Geografia</span>
            <select value={filters.geography} onChange={(event) => updateFiltersManual((current) => ({ ...current, geography: event.target.value }))}>
              <option value="">Todas</option>
              {(insights?.availableFilters?.geographies ?? []).map((geo) => (
                <option key={geo} value={geo}>{geo}</option>
              ))}
            </select>
          </label>

          <label className="ds-filters__field">
            <span>Género</span>
            <select value={filters.gender} onChange={(event) => updateFiltersManual((current) => ({ ...current, gender: event.target.value }))}>
              <option value="">Todos</option>
              {(insights?.availableFilters?.genders ?? []).map((gender) => (
                <option key={gender} value={gender}>{gender}</option>
              ))}
            </select>
          </label>

          <label className="ds-filters__field ds-filters__field--function">
            <span>Função</span>
            <div className="ds-filters__fn-wrap">
              <input
                type="text"
                list="ds-fn-list"
                value={functionSearch || filters.functionName}
                placeholder="Escrever para pesquisar..."
                onChange={(event) => {
                  const val = event.target.value;
                  setFunctionSearch(val);
                  const exact = availableFunctions.find((fn) => fn.toLowerCase() === val.toLowerCase());
                  updateFiltersManual((current) => ({ ...current, functionName: exact ?? '' }));
                }}
                onBlur={() => {
                  if (!filters.functionName) {
                    setFunctionSearch('');
                  }
                }}
              />
              <datalist id="ds-fn-list">
                {filteredFunctionOptions.map((fn) => (
                  <option key={fn} value={fn} />
                ))}
              </datalist>
              {filters.functionName && (
                <button
                  type="button"
                  className="ds-filters__fn-clear"
                  aria-label="Limpar função"
                  onClick={() => {
                    updateFiltersManual((current) => ({ ...current, functionName: '' }));
                    setFunctionSearch('');
                  }}
                >×</button>
              )}
            </div>
          </label>

          <div className="ds-filters__field ds-filters__field--contract" ref={contractDropdownRef}>
            <span>Tipo de contrato</span>
            <button
              type="button"
              className="ds-contract-filter__trigger"
              onClick={() => setIsContractDropdownOpen((current) => !current)}
              aria-expanded={isContractDropdownOpen}
              aria-haspopup="listbox"
            >
              <span className="ds-contract-filter__trigger-label">Tipo de contrato</span>
              <span className="ds-contract-filter__trigger-value">
                {filters.contractTypes.length > 0
                  ? `${filters.contractTypes.length} selecionado${filters.contractTypes.length > 1 ? 's' : ''}`
                  : 'Todos'}
              </span>
              <span className="ds-contract-filter__trigger-caret" aria-hidden="true">▾</span>
            </button>
            {isContractDropdownOpen && (
              <div className="ds-contract-filter__menu" role="listbox" aria-multiselectable="true">
                <div className="ds-contract-filter__toolbar">
                  <button
                    type="button"
                    className="ds-contract-filter__clear"
                    onClick={() => updateFiltersManual((current) => ({ ...current, contractTypes: [] }))}
                    disabled={filters.contractTypes.length === 0}
                  >
                    Limpar
                  </button>
                </div>
                {availableContractTypes.length === 0 && (
                  <p className="ds-contract-filter__empty">Sem tipos de contrato disponíveis.</p>
                )}
                {availableContractTypes.map((contractType) => {
                  const isChecked = filters.contractTypes.includes(contractType);

                  return (
                    <label key={contractType} className="ds-contract-filter__option">
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={(event) => updateFiltersManual((current) => ({
                          ...current,
                          contractTypes: event.target.checked
                            ? [...current.contractTypes, contractType]
                            : current.contractTypes.filter((item) => item !== contractType),
                        }))}
                      />
                      <span>{contractType}</span>
                    </label>
                  );
                })}
              </div>
            )}
          </div>

          <label className="ds-filters__field">
            <span>Estado</span>
            <select value={filters.isActive} onChange={(event) => updateFiltersManual((current) => ({ ...current, isActive: event.target.value as DashboardFilters['isActive'] }))}>
              {(insights?.availableFilters?.activeStates ?? [
                { value: 'all', label: 'Todos' },
                { value: 'active', label: 'Ativos' },
                { value: 'inactive', label: 'Inativos' },
              ]).map((item) => (
                <option key={item.value} value={item.value}>{item.label}</option>
              ))}
            </select>
          </label>

          <label className="ds-filters__field">
            <span>Período</span>
            <select value={filters.periodPreset} onChange={(event) => {
              setDrillPath([]);
              handlePeriodPresetChange(event.target.value as DashboardPeriodPreset);
            }}>
              <option value="all">Sem período</option>
              <option value="last12m">Últimos 12 meses</option>
              <option value="last3y">Últimos 3 anos</option>
              <option value="last5y">Últimos 5 anos</option>
              <option value="custom">Personalizado</option>
            </select>
          </label>

          {filters.periodPreset === 'custom' && (
            <>
              <label className="ds-filters__field">
                <span>Data início</span>
                <input
                  type="date"
                  value={filters.periodStart}
                  onChange={(event) => updateFiltersManual((current) => ({ ...current, periodStart: event.target.value }))}
                />
              </label>

              <label className="ds-filters__field">
                <span>Data fim</span>
                <input
                  type="date"
                  value={filters.periodEnd}
                  onChange={(event) => updateFiltersManual((current) => ({ ...current, periodEnd: event.target.value }))}
                />
              </label>
            </>
          )}
        </div>

        <div className="ds-filters__actions">
          <span className="ds-filters__meta">
            {selected.headcount} colaboradores
            {hasActiveFilters && ` · ${company.headcount} na empresa`}
            {summary?.refreshedAt && ` · ${formatDateTime(summary.refreshedAt)}`}
          </span>
          <div className="ds-filters__btns">
            {hasActiveFilters && (
              <Button type="button" variant="ghost" onClick={() => { setFilters(DEFAULT_FILTERS); setFunctionSearch(''); setDrillPath([]); }}>Limpar filtros</Button>
            )}
            <Button type="button" variant="secondary" isLoading={isRefreshing} onClick={() => void loadSummary(undefined, true, filters)}>Atualizar</Button>
            <Button type="button" variant="primary" isLoading={isExporting} onClick={() => void exportFilteredCollaborators()}>
              Exportar Excel
            </Button>
          </div>
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

      {/* ─── KPI cards ─── */}
      <section className="ds-kpi-grid">
        {kpis.map((kpi) => (
          <KpiCard key={kpi.label} {...kpi} />
        ))}
      </section>

      <section className="ds-drill-toolbar" aria-live="polite">
        <div className="ds-drill-toolbar__status">
          <strong>Drill</strong>
          {drillPath.length > 0 ? (
            <span>{activeDrillLabel}</span>
          ) : (
            <span>Clique numa fatia ou item da legenda para fazer drill-down.</span>
          )}
        </div>
        <div className="ds-drill-toolbar__actions">
          <Button type="button" variant="ghost" onClick={drillUp} disabled={drillPath.length === 0}>Drill up</Button>
          <Button type="button" variant="ghost" onClick={clearDrillPath} disabled={drillPath.length === 0}>Roll up</Button>
          <Button type="button" variant="secondary" onClick={() => void exportFilteredCollaborators()} disabled={drillPath.length === 0}>Drill through (Excel)</Button>
        </div>
      </section>

      {/* ─── Gráficos de distribuição ─── */}
      {isLoading && !summary ? (
        <section className="ds-charts-grid">
          <article className="ds-chart-card home-card--loading" />
          <article className="ds-chart-card home-card--loading" />
          <article className="ds-chart-card home-card--loading" />
          <article className="ds-chart-card home-card--loading" />
        </section>
      ) : (
        <section className="ds-charts-grid">
          <article className="ds-chart-card">
            <h3 className="ds-chart-card__title">Nível hierárquico</h3>
            <PieChart
              data={selected.distributions.hierarchy}
              onSelect={(label) => applyDrillDown('hierarchy', label)}
              selectedLabel={filters.level || undefined}
            />
          </article>

          <article className="ds-chart-card">
            <h3 className="ds-chart-card__title">Geografia</h3>
            <PieChart
              data={selected.distributions.geography}
              onSelect={(label) => applyDrillDown('geography', label)}
              selectedLabel={filters.geography || undefined}
            />
          </article>

          <article className="ds-chart-card">
            <h3 className="ds-chart-card__title">Género</h3>
            <PieChart
              data={selected.distributions.gender}
              onSelect={(label) => applyDrillDown('gender', label)}
              selectedLabel={filters.gender || undefined}
            />
          </article>

          <article className="ds-chart-card">
            <h3 className="ds-chart-card__title">Função</h3>
            <div className="ds-chart-card__scroll">
              <PieChart
                data={selected.distributions.function}
                maxLegend={12}
                onSelect={(label) => applyDrillDown('function', label)}
                selectedLabel={filters.functionName || undefined}
              />
            </div>
          </article>
        </section>
      )}

      {drillPath.length > 0 && (
        <section className="ds-drill-through">
          <div className="ds-drill-through__head">
            <h3>Drill-through</h3>
            <span>{drillRowsTotal} colaboradores encontrados</span>
          </div>

          {isLoadingDrillRows ? (
            <div className="ds-drill-through__state">A carregar detalhe...</div>
          ) : drillRowsError ? (
            <div className="ds-drill-through__state ds-drill-through__state--error">{drillRowsError}</div>
          ) : drillRows.length === 0 ? (
            <div className="ds-drill-through__state">Sem resultados para o drill atual.</div>
          ) : (
            <div className="ds-drill-through__table-wrap">
              <table className="ds-drill-through__table">
                <thead>
                  <tr>
                    <th>Nome</th>
                    <th>Função</th>
                    <th>Equipa</th>
                    <th>Geografia</th>
                    <th>Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {drillRows.map((row) => (
                    <tr key={row.id}>
                      <td>{row.nome || row.username}</td>
                      <td>{row.funcao || '-'}</td>
                      <td>{row.equipa || '-'}</td>
                      <td>{row.geografia || '-'}</td>
                      <td>{row.estado || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {/* ─── Tempo médio por função ─── */}
      {selected.avgTenureByFunction.length > 0 && (
        <section className="ds-tenure-section">
          <h3 className="ds-tenure-section__title">Tempo médio por função</h3>
          <div className="ds-tenure-grid">
            {selected.avgTenureByFunction.map((item) => {
              const companyItem = company.avgTenureByFunction.find((c) => c.label === item.label);
              const delta = companyItem ? parseDelta(item.avgTenure, companyItem.avgTenure) : undefined;
              return (
                <div key={item.label} className="ds-tenure-row">
                  <div className="ds-tenure-row__label" title={item.label}>{item.label}</div>
                  <div className="ds-tenure-row__bar-wrap">
                    <div
                      className="ds-tenure-row__bar"
                      style={{
                        width: `${Math.min(100, (item.avgTenure / Math.max(...selected.avgTenureByFunction.map((r) => r.avgTenure), 1)) * 100)}%`,
                      }}
                    />
                  </div>
                  <div className="ds-tenure-row__value">
                    {formatDecimal(item.avgTenure, 1)} anos
                    {delta !== undefined && (
                      <span className={`ds-kpi__delta ${delta >= 0 ? 'ds-kpi__delta--up' : 'ds-kpi__delta--down'}`}>
                        {formatDeltaSign(delta)}
                      </span>
                    )}
                  </div>
                  <div className="ds-tenure-row__count">{item.count} col.</div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* ─── Nota comparação com empresa ─── */}
      {hasActiveFilters && (
        <p className="ds-compare-note">
          Os valores de <strong>Empresa</strong> referem-se à totalidade dos colaboradores (sem filtros activos), permitindo comparar a selecção com a média geral da organização.
        </p>
      )}

    </section>
  );
}
