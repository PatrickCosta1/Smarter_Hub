import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiRequestCached, authHeaders, isAbortError } from '../portal/api';
import { usePortal } from '../portal/context';
import Button from '../components/ui/Button';
import Card from '../components/ui/Card';
import LoadingInline from '../components/ui/LoadingInline';

const STORAGE_TOKEN_KEY = 'smarter_hub_auth_token';

type DashboardSummaryMetrics = {
  totals?: {
    pendingProfileRequests?: number;
    pendingVacationRequests?: number;
    trainingsAssigned?: number;
  };
};

function getAuthHeaders() {
  const token = localStorage.getItem(STORAGE_TOKEN_KEY) || '';
  return authHeaders(token);
}

function getTimeGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return 'Bom dia';
  if (hour < 19) return 'Boa tarde';
  return 'Boa noite';
}

export default function HomePage() {
  const navigate = useNavigate();
  const { profile, unreadNotifications, hasPermission, isRootAccess, currentUser } = usePortal();
  const isTPeople = currentUser?.username === 't.people';
  const canViewUserList = isRootAccess || hasPermission('view_user_list');
  const canReviewApprovals = isRootAccess || hasPermission('approve_profile_change') || hasPermission('approve_vacation') || hasPermission('reject_vacation');
  const canManageTrainings = isRootAccess || hasPermission('assign_training') || hasPermission('view_all_trainings');
  const canManageCollaborators = isRootAccess || hasPermission('view_user_list') || hasPermission('manage_user_active') || hasPermission('manage_permissions');
  const isManagerFlow = canReviewApprovals || canManageTrainings || canManageCollaborators;
  const shortName = profile.nomeAbreviado?.trim();
  const fullName = profile.nomeCompleto?.trim();
  const displayName = isTPeople
    ? 'T People'
    : shortName || fullName || currentUser?.username || 'Colaborador';
  const [pendingProfileRequests, setPendingProfileRequests] = useState(0);
  const [pendingVacationRequests, setPendingVacationRequests] = useState(0);
  const [pendingProfileApprovals, setPendingProfileApprovals] = useState(0);
  const [pendingVacationApprovals, setPendingVacationApprovals] = useState(0);
  const [assignedTrainings, setAssignedTrainings] = useState(0);
  const [ownPendingProfileRequest, setOwnPendingProfileRequest] = useState(false);
  const [ownPendingVacationCount, setOwnPendingVacationCount] = useState(0);
  const [isLoadingPendingProfileRequests, setIsLoadingPendingProfileRequests] = useState(true);
  const [isLoadingPendingVacationRequests, setIsLoadingPendingVacationRequests] = useState(true);
  const [isLoadingAssignedTrainings, setIsLoadingAssignedTrainings] = useState(true);
  const [isLoadingOwnPendingProfileRequest, setIsLoadingOwnPendingProfileRequest] = useState(true);

  const totalPending = useMemo(
    () => (isManagerFlow ? pendingProfileApprovals + pendingVacationApprovals : Number(ownPendingProfileRequest)),
    [isManagerFlow, ownPendingProfileRequest, pendingProfileApprovals, pendingVacationApprovals],
  );

  const isLoadingMetrics = isManagerFlow || isTPeople
    ? isLoadingPendingProfileRequests || isLoadingPendingVacationRequests || isLoadingAssignedTrainings || isLoadingOwnPendingProfileRequest
    : isLoadingOwnPendingProfileRequest;
  const approvalsDefaultTab = pendingVacationApprovals > 0 && pendingProfileApprovals === 0 ? 'vacations' : 'profiles';
  const approvalsDefaultPath = `/aprovacoes?tab=${approvalsDefaultTab}`;

  useEffect(() => {
    const controller = new AbortController();

    void (async () => {
      setIsLoadingPendingProfileRequests(true);
      setIsLoadingPendingVacationRequests(true);
      setIsLoadingAssignedTrainings(true);
      setIsLoadingOwnPendingProfileRequest(true);

      if (isManagerFlow || isTPeople) {
        const headers = getAuthHeaders();

        if (canViewUserList) {
          try {
            const [summary, profileApprovals, vacationApprovals, ownRequest, ownVacations, ownTrainings] = await Promise.all([
              apiRequestCached<DashboardSummaryMetrics>('/users/dashboard-summary', {
                headers,
                signal: controller.signal,
              }, 15000, true),
              apiRequestCached<unknown[]>('/profile/requests', { headers, signal: controller.signal }, 15000, true),
              apiRequestCached<unknown[]>('/vacations/requests', { headers, signal: controller.signal }, 15000, true),
              apiRequestCached<{ pending?: boolean }>('/profile/requests/me', { headers, signal: controller.signal }, 15000),
              apiRequestCached<Array<{ status: string }>>('/vacations/me', { headers, signal: controller.signal }, 15000),
              apiRequestCached<Array<{ status?: string }>>('/trainings/me', { headers, signal: controller.signal }, 15000),
            ]);

            if (!controller.signal.aborted) {
              setPendingProfileRequests(Number(summary.totals?.pendingProfileRequests || 0));
              setPendingVacationRequests(Number(summary.totals?.pendingVacationRequests || 0));
              setPendingProfileApprovals(profileApprovals.length);
              setPendingVacationApprovals(vacationApprovals.length);
              setAssignedTrainings(ownTrainings.filter((item) => item.status === 'ASSIGNED').length);
              setOwnPendingProfileRequest(Boolean(ownRequest.pending));
              setOwnPendingVacationCount(ownVacations.filter((v) => v.status === 'PENDING').length);
            }
          } catch (error) {
            if (!isAbortError(error) && !controller.signal.aborted) {
              setPendingProfileRequests(0);
              setPendingVacationRequests(0);
              setPendingProfileApprovals(0);
              setPendingVacationApprovals(0);
              setAssignedTrainings(0);
              setOwnPendingProfileRequest(false);
              setOwnPendingVacationCount(0);
            }
          } finally {
            if (!controller.signal.aborted) {
              setIsLoadingPendingProfileRequests(false);
              setIsLoadingPendingVacationRequests(false);
              setIsLoadingAssignedTrainings(false);
              setIsLoadingOwnPendingProfileRequest(false);
            }
          }
        } else {
          const [profileRequestsResult, vacationRequestsResult, assignedTrainingsResult, ownRequestResult, ownVacationsResult] = await Promise.allSettled([
            apiRequestCached<unknown[]>('/profile/requests', { headers, signal: controller.signal }, 15000, true),
            apiRequestCached<unknown[]>('/vacations/requests', { headers, signal: controller.signal }, 15000, true),
            apiRequestCached<Array<{ status?: string }>>('/trainings/me', { headers, signal: controller.signal }, 15000),
            apiRequestCached<{ pending?: boolean }>('/profile/requests/me', { headers, signal: controller.signal }, 15000),
            apiRequestCached<Array<{ status: string }>>('/vacations/me', { headers, signal: controller.signal }, 15000),
          ]);

          if (!controller.signal.aborted) {
            setPendingProfileRequests(profileRequestsResult.status === 'fulfilled' ? profileRequestsResult.value.length : 0);
            setPendingVacationRequests(vacationRequestsResult.status === 'fulfilled' ? vacationRequestsResult.value.length : 0);
            setPendingProfileApprovals(profileRequestsResult.status === 'fulfilled' ? profileRequestsResult.value.length : 0);
            setPendingVacationApprovals(vacationRequestsResult.status === 'fulfilled' ? vacationRequestsResult.value.length : 0);
            setAssignedTrainings(
              assignedTrainingsResult.status === 'fulfilled'
                ? assignedTrainingsResult.value.filter((item) => item.status === 'ASSIGNED').length
                : 0,
            );
            setOwnPendingProfileRequest(ownRequestResult.status === 'fulfilled' ? Boolean(ownRequestResult.value.pending) : false);
            setOwnPendingVacationCount(ownVacationsResult.status === 'fulfilled' ? ownVacationsResult.value.filter((v) => v.status === 'PENDING').length : 0);
            setIsLoadingPendingProfileRequests(false);
            setIsLoadingPendingVacationRequests(false);
            setIsLoadingAssignedTrainings(false);
            setIsLoadingOwnPendingProfileRequest(false);
          }
        }
        return;
      }

      const headers = getAuthHeaders();
      void Promise.allSettled([
        apiRequestCached<{ pending?: boolean }>('/profile/requests/me', { headers, signal: controller.signal }, 15000),
        apiRequestCached<Array<{ status: string }>>('/vacations/me', { headers, signal: controller.signal }, 15000),
      ]).then(([profileResult, vacationsResult]) => {
        if (!controller.signal.aborted) {
          setOwnPendingProfileRequest(profileResult.status === 'fulfilled' ? Boolean(profileResult.value.pending) : false);
          setOwnPendingVacationCount(vacationsResult.status === 'fulfilled' ? vacationsResult.value.filter((v) => v.status === 'PENDING').length : 0);
          setIsLoadingOwnPendingProfileRequest(false);
          setIsLoadingPendingVacationRequests(false);
        }
      });

      setPendingProfileRequests(0);
      setPendingVacationRequests(0);
      setPendingProfileApprovals(0);
      setPendingVacationApprovals(0);
      setAssignedTrainings(0);
    })();

    return () => controller.abort();
  }, [canViewUserList, isManagerFlow, isTPeople]);

  const greeting = getTimeGreeting();

  return (
    <>
      <section className="home-hero">
        <div className="home-hero__content">
          <div className="home-hero__text">
            <p className="home-hero__kicker">
              {isTPeople ? 'Centro executivo' : isManagerFlow ? 'Painel de gestão' : 'Portal interno'}
            </p>
            <h1 className="home-hero__title">
              {greeting}, <span className="home-hero__name">{displayName}</span>
            </h1>
            <p className="home-hero__sub">
              {isTPeople
                ? 'Visão global da organização com foco em decisões e operação.'
                : isManagerFlow
                  ? 'Consulta as pendências da equipa e age com rapidez.'
                  : 'O teu espaço pessoal - ficha, férias, formações e notificações.'}
            </p>
          </div>

          <div className="home-hero__metrics">
            {isLoadingMetrics ? (
              <>
                <div className="home-metric home-metric--loading"><LoadingInline variant="metric" /></div>
                <div className="home-metric home-metric--loading"><LoadingInline variant="metric" /></div>
                <div className="home-metric home-metric--loading"><LoadingInline variant="metric" /></div>
              </>
            ) : isManagerFlow || isTPeople ? (
              <>
                {isTPeople ? (
                  <div className={`home-metric${pendingProfileRequests > 0 ? ' home-metric--alert' : ''}`}>
                    <span>Fichas pendentes</span>
                    <strong>{pendingProfileRequests}</strong>
                  </div>
                ) : (
                  <div className={`home-metric${ownPendingProfileRequest ? ' home-metric--alert' : ''}`}>
                    <span>Minha ficha</span>
                    <strong>{ownPendingProfileRequest ? 'Em análise' : 'OK'}</strong>
                  </div>
                )}
                <div className={`home-metric${ownPendingVacationCount > 0 ? ' home-metric--alert' : ''}`}>
                  <span>Férias pendentes</span>
                  <strong>{ownPendingVacationCount}</strong>
                </div>
                <div className="home-metric">
                  <span>Minhas formações ativas</span>
                  <strong>{assignedTrainings}</strong>
                </div>
                <div className={`home-metric${unreadNotifications > 0 ? ' home-metric--info' : ''}`}>
                  <span>Notificações</span>
                  <strong>{unreadNotifications}</strong>
                </div>
              </>
            ) : (
              <>
                <div className={`home-metric${ownPendingProfileRequest ? ' home-metric--alert' : ''}`}>
                  <span>Ficha</span>
                  <strong>{ownPendingProfileRequest ? 'Em análise' : 'OK'}</strong>
                </div>
                <div className={`home-metric${unreadNotifications > 0 ? ' home-metric--info' : ''}`}>
                  <span>Notificações</span>
                  <strong>{unreadNotifications}</strong>
                </div>
                <div className="home-metric">
                  <span>Minhas formações ativas</span>
                  <strong>{assignedTrainings}</strong>
                </div>
              </>
            )}
          </div>

          <div className="home-hero__actions">
            {isTPeople ? (
              <>
                <Button variant="primary" type="button" onClick={() => navigate('/colaboradores')}>Gerir colaboradores</Button>
                <Button variant="ghost" type="button" onClick={() => navigate(approvalsDefaultPath)}>Ver aprovações</Button>
              </>
            ) : isManagerFlow ? (
              <>
                <Button variant="primary" type="button" onClick={() => navigate(approvalsDefaultPath)}>
                  Ver aprovações {totalPending > 0 && <span className="home-cta-badge">{totalPending}</span>}
                </Button>
                <Button variant="ghost" type="button" onClick={() => navigate('/colaboradores')}>Colaboradores</Button>
              </>
            ) : (
              <>
                <Button variant="primary" type="button" onClick={() => navigate('/profile')}>Abrir minha ficha</Button>
                <Button variant="ghost" type="button" onClick={() => navigate('/ferias')}>Férias</Button>
              </>
            )}
          </div>
        </div>
      </section>

      {!isManagerFlow && !isTPeople && ownPendingProfileRequest && !isLoadingOwnPendingProfileRequest && (
        <div className="home-pending-alert">
          <span className="home-pending-alert__icon" aria-hidden="true">⏳</span>
          <div>
            <strong>Pedido de alteração da ficha em análise</strong>
            <p>O teu pedido foi submetido e está à espera de aprovação. Vais receber uma notificação quando houver decisão.</p>
          </div>
          <Button variant="ghost" size="sm" type="button" onClick={() => navigate('/notifications')}>Ver notificações</Button>
        </div>
      )}

      {/* <section className="home-grid">
        {isLoadingMetrics ? (
          <>
            {[0, 1, 2].map((i) => (
              <Card key={i} as="article" className="home-card home-card--loading">
                <LoadingInline variant="cardTitle" />
                <LoadingInline variant="cardBody" />
                <LoadingInline variant="button" />
              </Card>
            ))}
          </>
        ) : isTPeople || isManagerFlow ? (
          <>
            <Card as="article" className="home-card">
              <p className="home-card__label">Gestão</p>
              <h3>Colaboradores</h3>
              <small>Ver ficha, permissões e estado da conta.</small>
              <Button size="sm" variant="secondary" type="button" onClick={() => navigate('/colaboradores')}>Abrir</Button>
            </Card>

            <Card as="article" className={`home-card${pendingProfileRequests > 0 ? ' home-card--alert' : ''}`}>
              <p className="home-card__label">Aprovações</p>
              <h3>Fichas pendentes</h3>
              <small>{pendingProfileRequests > 0 ? `${pendingProfileRequests} pedido(s) aguardam revisão.` : 'Sem fichas por aprovar.'}</small>
              <Button size="sm" variant="secondary" type="button" onClick={() => navigate('/aprovacoes?tab=profiles')}>Abrir</Button>
            </Card>

            <Card as="article" className={`home-card${pendingVacationRequests > 0 ? ' home-card--alert' : ''}`}>
              <p className="home-card__label">Aprovações</p>
              <h3>Férias pendentes</h3>
              <small>{pendingVacationRequests > 0 ? `${pendingVacationRequests} pedido(s) de férias por validar.` : 'Sem pedidos de férias pendentes.'}</small>
              <Button size="sm" variant="secondary" type="button" onClick={() => navigate('/aprovacoes?tab=vacations')}>Abrir</Button>
            </Card>

            <Card as="article" className="home-card">
              <p className="home-card__label">Desenvolvimento</p>
              <h3>Minhas formações ativas</h3>
              <small>{assignedTrainings > 0 ? `${assignedTrainings} formação(ões) ativas para ti.` : 'Sem formações ativas para ti.'}</small>
              <Button size="sm" variant="secondary" type="button" onClick={() => navigate('/formacoes')}>Ver formações</Button>
            </Card>

            <Card as="article" className={`home-card${unreadNotifications > 0 ? ' home-card--info' : ''}`}>
              <p className="home-card__label">Comunicação</p>
              <h3>Notificações</h3>
              <small>{unreadNotifications > 0 ? `${unreadNotifications} notificação(ões) por ler.` : 'Nenhuma notificação pendente.'}</small>
              <Button size="sm" variant="secondary" type="button" onClick={() => navigate('/notifications')}>Ver todas</Button>
            </Card>
          </>
        ) : (
          <>
            <Card as="article" className={`home-card${ownPendingProfileRequest ? ' home-card--alert' : ''}`}>
              <p className="home-card__label">Dados pessoais</p>
              <h3>Minha ficha</h3>
              <small>{ownPendingProfileRequest ? 'Pedido de alteração em análise pela equipa RH.' : 'Mantém os teus dados atualizados.'}</small>
              <Button size="sm" variant="secondary" type="button" onClick={() => navigate('/profile')}>Ver ficha</Button>
            </Card>

            <Card as="article" className="home-card">
              <p className="home-card__label">Ausências</p>
              <h3>Férias</h3>
              <small>Consulta o teu calendário e submete pedidos de férias.</small>
              <Button size="sm" variant="secondary" type="button" onClick={() => navigate('/ferias')}>Consultar</Button>
            </Card>

            <Card as="article" className={`home-card${unreadNotifications > 0 ? ' home-card--info' : ''}`}>
              <p className="home-card__label">Comunicação</p>
              <h3>Notificações</h3>
              <small>{unreadNotifications > 0 ? `Tens ${unreadNotifications} notificação(ões) por ler.` : 'Estás a par de tudo.'}</small>
              <Button size="sm" variant="secondary" type="button" onClick={() => navigate('/notifications')}>Ver todas</Button>
            </Card>

            <Card as="article" className="home-card">
              <p className="home-card__label">Desenvolvimento</p>
              <h3>Formações</h3>
              <small>Acede às tuas formações atribuídas e regista novas.</small>
              <Button size="sm" variant="secondary" type="button" onClick={() => navigate('/formacoes')}>Ver formações</Button>
            </Card>
          </>
        )}
      </section> */}
    </>
  );
}
