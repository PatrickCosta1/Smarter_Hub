import { useEffect, useMemo, useState } from 'react';
import Button from '../components/ui/Button';
import Badge from '../components/ui/Badge';
import Skeleton from '../components/ui/Skeleton';
import EmptyState from '../components/ui/EmptyState';
import { apiRequestCached, authHeaders, isAbortError } from '../portal/api';
import { usePortal } from '../portal/context';

const STORAGE_TOKEN_KEY = 'smarter_hub_auth_token';

type DashboardSummary = {
  refreshedAt: string;
  totals: {
    collaborators: number;
    activeUsers: number;
    inactiveUsers: number;
    teams: number;
    pendingProfileRequests: number;
    pendingVacationRequests: number;
    trainingsAssigned: number;
    trainingsCompleted: number;
    trainingHoursAvg: number;
    promotionEvents: number;
  };
  averages: {
    age: number;
    tenure: number;
  };
  charts: {
    educationDistribution: Array<{ label: string; count: number }>;
    genderByArea: Array<{
      area: string;
      total: number;
      counts: {
        Masculino: number;
        Feminino: number;
        Outro: number;
        'Não informado': number;
      };
    }>;
    timeInCurrentLevelByCargo: Array<{
      cargo: string;
      averageYears: number;
      people: number;
    }>;
  };
  recentPromotions: Array<{
    id: string;
    userId: string;
    collaborator: string;
    promotedTo: string;
    reviewedAt: string;
  }>;
};

const numberFormatter = new Intl.NumberFormat('pt-PT', { maximumFractionDigits: 1 });

function getAuthHeaders() {
  const token = localStorage.getItem(STORAGE_TOKEN_KEY) || '';
  return authHeaders(token);
}

function formatDateLong(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '-';
  }

  return new Intl.DateTimeFormat('pt-PT', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  }).format(date);
}

function formatNumber(value: number) {
  return numberFormatter.format(value);
}

function ProgressBar({ value, total }: { value: number; total: number }) {
  const percent = total > 0 ? Math.max(8, Math.round((value / total) * 100)) : 8;

  return (
    <div className="dashboard-bar">
      <span style={{ width: `${Math.min(percent, 100)}%` }} />
    </div>
  );
}

export default function DashboardPage() {
  const { isRootAccess, isAccessTotal } = usePortal();
  const canAccess = isRootAccess || isAccessTotal;

  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [status, setStatus] = useState('');
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!canAccess) {
      return;
    }

    const controller = new AbortController();
    void loadSummary(controller.signal);

    return () => controller.abort();
  }, [canAccess]);

  async function loadSummary(signal?: AbortSignal, forceRefresh = false) {
    setIsLoading(true);
    setStatus('');

    try {
      const data = await apiRequestCached<DashboardSummary>('/users/dashboard-summary', {
        headers: getAuthHeaders(),
        signal,
      }, 30000, forceRefresh);

      if (signal?.aborted) {
        return;
      }

      setSummary(data);
    } catch (error) {
      if (!isAbortError(error)) {
        setStatus(error instanceof Error ? error.message : 'Falha ao carregar a dashboard.');
      }
    } finally {
      if (!signal?.aborted) {
        setIsLoading(false);
      }
    }
  }

  const kpis = useMemo(() => {
    if (!summary) {
      return [];
    }

    return [
      { label: 'Colaboradores', value: summary.totals.collaborators },
      { label: 'Ativos', value: summary.totals.activeUsers },
      { label: 'Tempo médio de casa', value: summary.averages.tenure, suffix: ' anos' },
      { label: 'Idade média', value: summary.averages.age, suffix: ' anos' },
      { label: 'Pendências abertas', value: summary.totals.pendingProfileRequests + summary.totals.pendingVacationRequests },
      { label: 'Formações concluídas', value: summary.totals.trainingsCompleted },
    ];
  }, [summary]);

  const maxEducation = summary ? Math.max(...summary.charts.educationDistribution.map((item) => item.count), 1) : 1;
  const maxTimeInLevel = summary ? Math.max(...summary.charts.timeInCurrentLevelByCargo.map((item) => item.averageYears), 1) : 1;

  if (!canAccess) {
    return (
      <section className="dashboard-shell">
        <article className="dashboard-access-card">
          <h3>Acesso restrito</h3>
          <p>Este painel é exclusivo para perfis com acesso total.</p>
        </article>
      </section>
    );
  }

  return (
    <section className="dashboard-shell">
      <header className="dashboard-hero dashboard-hero--compact">
        <div>
          <p className="hero-kicker">Painel executivo</p>
          <h2>KPIs de pessoas, operação e progressão</h2>
          <p>Uma vista única, rápida e limpa. Sem ruído, sem repetição, com métricas que importam.</p>
        </div>
        <div className="dashboard-hero__actions">
          <Badge tone="info">Atualização rápida</Badge>
          <Button type="button" variant="primary" onClick={() => void loadSummary(undefined, true)} isLoading={isLoading}>
            Atualizar
          </Button>
        </div>
      </header>

      {status && <article className="dashboard-status-card">{status}</article>}

      <section className="dashboard-kpi-grid dashboard-kpi-grid--compact">
        {isLoading || !summary
          ? Array.from({ length: 6 }).map((_, index) => (
            <article key={index} className="dashboard-kpi-card">
              <Skeleton lines={2} />
            </article>
          ))
          : kpis.map((item) => (
            <article key={item.label} className="dashboard-kpi-card dashboard-kpi-card--strong">
              <span>{item.label}</span>
              <strong>{typeof item.value === 'number' ? `${formatNumber(item.value)}${item.suffix || ''}` : item.value}</strong>
            </article>
          ))}
      </section>

      <section className="dashboard-grid dashboard-grid--modern">
        <article className="dashboard-panel dashboard-card dashboard-panel--feature">
          <header className="dashboard-panel__head">
            <div>
              <h3>Género por área</h3>
              <p>Onde a equipa está concentrada e como se distribui.</p>
            </div>
          </header>
          {isLoading ? (
            <Skeleton lines={7} />
          ) : !summary || summary.charts.genderByArea.length === 0 ? (
            <EmptyState title="Sem dados suficientes." message="Este bloco aparece quando existirem equipa e perfil preenchidos." />
          ) : (
            <div className="dashboard-stack">
              {summary.charts.genderByArea.map((row) => {
                const total = Math.max(row.total, 1);
                return (
                  <div key={row.area} className="dashboard-chart-row">
                    <div className="dashboard-chart-row__meta">
                      <span>{row.area}</span>
                      <small>{row.total} pessoa(s)</small>
                    </div>
                    <div className="dashboard-stackbar" aria-hidden="true">
                      <span className="dashboard-stackbar__male" style={{ width: `${(row.counts.Masculino / total) * 100}%` }} />
                      <span className="dashboard-stackbar__female" style={{ width: `${(row.counts.Feminino / total) * 100}%` }} />
                      <span className="dashboard-stackbar__other" style={{ width: `${((row.counts.Outro + row.counts['Não informado']) / total) * 100}%` }} />
                    </div>
                    <strong>M {row.counts.Masculino} · F {row.counts.Feminino} · O {row.counts.Outro + row.counts['Não informado']}</strong>
                  </div>
                );
              })}
            </div>
          )}
        </article>

        <article className="dashboard-panel dashboard-card dashboard-panel--stacked">
          <header className="dashboard-panel__head">
            <div>
              <h3>Formação</h3>
              <p>Distribuição compacta dos principais níveis académicos.</p>
            </div>
          </header>
          {isLoading ? (
            <Skeleton lines={6} />
          ) : !summary || summary.charts.educationDistribution.length === 0 ? (
            <EmptyState title="Sem dados académicos." message="Este gráfico é preenchido quando houver habilitações registadas." />
          ) : (
            <div className="dashboard-stack">
              {summary.charts.educationDistribution.map((item) => (
                <div key={item.label} className="dashboard-chart-row dashboard-chart-row--tighter">
                  <div className="dashboard-chart-row__meta">
                    <span>{item.label}</span>
                    <small>{item.count} pessoa(s)</small>
                  </div>
                  <ProgressBar value={item.count} total={maxEducation} />
                </div>
              ))}
            </div>
          )}
        </article>

        <article className="dashboard-panel dashboard-card dashboard-panel--stacked">
          <header className="dashboard-panel__head">
            <div>
              <h3>Tempo médio de casa por cargo</h3>
              <p>Leitura rápida da permanência por cargo atual.</p>
            </div>
          </header>
          {isLoading ? (
            <Skeleton lines={6} />
          ) : !summary || summary.charts.timeInCurrentLevelByCargo.length === 0 ? (
            <EmptyState title="Sem progressões suficientes." message="Os níveis surgem assim que existirem datas de início ou promoções aprovadas." />
          ) : (
            <div className="dashboard-stack">
              {summary.charts.timeInCurrentLevelByCargo.map((item) => (
                <div key={item.cargo} className="dashboard-chart-row dashboard-chart-row--tighter">
                  <div className="dashboard-chart-row__meta">
                    <span>{item.cargo}</span>
                    <small>{item.people} pessoa(s)</small>
                  </div>
                  <ProgressBar value={item.averageYears} total={maxTimeInLevel} />
                  <strong>{formatNumber(item.averageYears)} ano(s)</strong>
                </div>
              ))}
            </div>
          )}
        </article>

        <article className="dashboard-panel dashboard-card dashboard-panel--full dashboard-panel--timeline">
          <header className="dashboard-panel__head">
            <div>
              <h3>Últimas progressões</h3>
              <p>Histórico inferido de pedidos de alteração de cargo aprovados, sem tabela de carreira separada.</p>
            </div>
            <Badge tone="success">{summary?.totals.promotionEvents || 0}</Badge>
          </header>
          {isLoading ? (
            <Skeleton lines={6} />
          ) : !summary || summary.recentPromotions.length === 0 ? (
            <EmptyState title="Sem histórico de progressão." message="Quando existirem pedidos aprovados de cargo, aparecem aqui." />
          ) : (
            <div className="dashboard-timeline">
              {summary.recentPromotions.map((item) => (
                <article key={item.id} className="dashboard-timeline__item">
                  <div>
                    <span>{item.collaborator}</span>
                    <small>{item.promotedTo}</small>
                  </div>
                  <strong>Subiu de nível a {formatDateLong(item.reviewedAt)}</strong>
                </article>
              ))}
            </div>
          )}
        </article>
      </section>

      {summary && (
        <footer className="dashboard-footnote">
          <span>Colaboradores ativos: {summary.totals.activeUsers}</span>
          <span>Inativos: {summary.totals.inactiveUsers}</span>
          <span>Equipas: {summary.totals.teams}</span>
          <span>Atualizado a {formatDateLong(summary.refreshedAt)}</span>
        </footer>
      )}
    </section>
  );
}
