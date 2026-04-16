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

export default function HomePage() {
  const navigate = useNavigate();
  const { profile, unreadNotifications, hasPermission, isRootAccess, currentUser } = usePortal();
  const isTPeople = currentUser?.username === 't.people';
  const canViewUserList = isRootAccess || hasPermission('view_user_list');
  const canReviewApprovals = isRootAccess || hasPermission('approve_profile_change') || hasPermission('approve_vacation') || hasPermission('reject_vacation');
  const canManageTrainings = isRootAccess || hasPermission('assign_training') || hasPermission('view_all_trainings');
  const canManageCollaborators = isRootAccess || hasPermission('view_user_list') || hasPermission('manage_user_active') || hasPermission('manage_permissions');
  const isManagerFlow = canReviewApprovals || canManageTrainings || canManageCollaborators;
  const displayName = isTPeople
    ? 'T People'
    : profile.nomeCompleto?.trim() || profile.nomeAbreviado || 'Colaborador';
  const [pendingProfileRequests, setPendingProfileRequests] = useState(0);
  const [pendingVacationRequests, setPendingVacationRequests] = useState(0);
  const [assignedTrainings, setAssignedTrainings] = useState(0);
  const [ownPendingProfileRequest, setOwnPendingProfileRequest] = useState(false);
  const [isLoadingPendingProfileRequests, setIsLoadingPendingProfileRequests] = useState(true);
  const [isLoadingPendingVacationRequests, setIsLoadingPendingVacationRequests] = useState(true);
  const [isLoadingAssignedTrainings, setIsLoadingAssignedTrainings] = useState(true);
  const [isLoadingOwnPendingProfileRequest, setIsLoadingOwnPendingProfileRequest] = useState(true);

  const totalPending = useMemo(
    () => (isManagerFlow ? pendingProfileRequests + pendingVacationRequests : Number(ownPendingProfileRequest)),
    [isManagerFlow, ownPendingProfileRequest, pendingProfileRequests, pendingVacationRequests],
  );

  const isLoadingMetrics = isManagerFlow || isTPeople
    ? isLoadingPendingProfileRequests || isLoadingPendingVacationRequests || isLoadingAssignedTrainings
    : isLoadingOwnPendingProfileRequest;

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
            const summary = await apiRequestCached<DashboardSummaryMetrics>('/users/dashboard-summary', {
              headers,
              signal: controller.signal,
            }, 15000);

            if (!controller.signal.aborted) {
              setPendingProfileRequests(Number(summary.totals?.pendingProfileRequests || 0));
              setPendingVacationRequests(Number(summary.totals?.pendingVacationRequests || 0));
              setAssignedTrainings(Number(summary.totals?.trainingsAssigned || 0));
            }
          } catch (error) {
            if (!isAbortError(error) && !controller.signal.aborted) {
              setPendingProfileRequests(0);
              setPendingVacationRequests(0);
              setAssignedTrainings(0);
            }
          } finally {
            if (!controller.signal.aborted) {
              setIsLoadingPendingProfileRequests(false);
              setIsLoadingPendingVacationRequests(false);
              setIsLoadingAssignedTrainings(false);
            }
          }
        } else {
          const [profileRequestsResult, vacationRequestsResult, assignedTrainingsResult] = await Promise.allSettled([
            apiRequestCached<unknown[]>('/profile/requests', { headers, signal: controller.signal }, 15000),
            apiRequestCached<unknown[]>('/vacations/requests', { headers, signal: controller.signal }, 15000),
            apiRequestCached<Array<{ status?: string }>>('/trainings/assigned', { headers, signal: controller.signal }, 15000),
          ]);

          if (!controller.signal.aborted) {
            setPendingProfileRequests(profileRequestsResult.status === 'fulfilled' ? profileRequestsResult.value.length : 0);
            setPendingVacationRequests(vacationRequestsResult.status === 'fulfilled' ? vacationRequestsResult.value.length : 0);
            setAssignedTrainings(
              assignedTrainingsResult.status === 'fulfilled'
                ? assignedTrainingsResult.value.filter((item) => item.status === 'ASSIGNED').length
                : 0,
            );
            setIsLoadingPendingProfileRequests(false);
            setIsLoadingPendingVacationRequests(false);
            setIsLoadingAssignedTrainings(false);
          }
        }

        setOwnPendingProfileRequest(false);
        setIsLoadingOwnPendingProfileRequest(false);
        return;
      }

      void apiRequestCached<{ pending?: boolean }>('/profile/requests/me', { headers: getAuthHeaders(), signal: controller.signal }, 15000)
        .then((ownRequest) => {
          if (!controller.signal.aborted) {
            setOwnPendingProfileRequest(Boolean(ownRequest.pending));
          }
        })
        .catch((error) => {
          if (!isAbortError(error) && !controller.signal.aborted) {
            setOwnPendingProfileRequest(false);
          }
        })
        .finally(() => {
          if (!controller.signal.aborted) {
            setIsLoadingOwnPendingProfileRequest(false);
          }
        });

      setPendingProfileRequests(0);
      setPendingVacationRequests(0);
      setAssignedTrainings(0);
    })();

    return () => controller.abort();
  }, [canViewUserList, isManagerFlow, isTPeople]);

  return (
    <>
      <section className="home-hero">
        <div className="home-main">
          <p className="hero-kicker">Portal interno</p>
          <h1>{`Olá, ${displayName}!`}</h1>
          <p>{isTPeople
            ? 'Centro executivo com foco em decisões e operação.'
            : isManagerFlow
              ? 'Pendências e equipa num painel objetivo.'
              : 'Resumo direto com o essencial do dia.'}</p>

          <div className="home-metrics">
            <article>
              <span>Pendências</span>
              <strong>{isLoadingMetrics ? <LoadingInline variant="metric" /> : totalPending}</strong>
            </article>
            <article>
              <span>Notificações</span>
              <strong>{unreadNotifications}</strong>
            </article>
            <article>
              <span>Formações ativas</span>
              <strong>{isLoadingMetrics ? <LoadingInline variant="metric" /> : assignedTrainings}</strong>
            </article>
          </div>

          {!isManagerFlow && ownPendingProfileRequest && !isLoadingOwnPendingProfileRequest && (
            <div className="home-pending-banner">
              <strong>Pedido de alteração da ficha em análise</strong>
              <p>O teu pedido foi submetido e está à espera de aprovação. Vais receber uma notificação quando houver decisão.</p>
            </div>
          )}

          <div className="home-actions">
            {isTPeople ? (
              <>
                <Button variant="primary" type="button" onClick={() => navigate('/colaboradores')}>Gerir colaboradores</Button>
                <Button variant="ghost" type="button" onClick={() => navigate('/aprovacoes')}>Ver aprovações</Button>
              </>
            ) : isManagerFlow ? (
              <>
                <Button variant="primary" type="button" onClick={() => navigate('/aprovacoes')}>Ver pendências</Button>
                <Button variant="ghost" type="button" onClick={() => navigate('/colaboradores')}>Colaboradores</Button>
              </>
            ) : (
              <Button variant="primary" type="button" onClick={() => navigate('/profile')}>Abrir minha ficha</Button>
            )}
          </div>
        </div>
      </section>

      <section className="home-grid">
        {isLoadingMetrics ? (
          <>
            <Card as="article" className="home-card home-card--loading">
              <LoadingInline variant="cardTitle" />
              <LoadingInline variant="cardBody" />
              <LoadingInline variant="button" />
            </Card>
            <Card as="article" className="home-card home-card--loading">
              <LoadingInline variant="cardTitle" />
              <LoadingInline variant="cardBody" />
              <LoadingInline variant="button" />
            </Card>
          </>
        ) : isTPeople || isManagerFlow ? (
          <>
            <Card as="article" className="home-card">
              <p>Operação</p>
              <h3>Colaboradores</h3>
              <small>Ver ficha, permissões e estado da conta.</small>
              <Button size="sm" variant="secondary" type="button" onClick={() => navigate('/colaboradores')}>Abrir</Button>
            </Card>

            <Card as="article" className="home-card">
              <p>Aprovações</p>
              <h3>Fila atual</h3>
              <small>{totalPending} pendência(s) no momento.</small>
              <Button size="sm" variant="secondary" type="button" onClick={() => navigate('/aprovacoes')}>Abrir</Button>
            </Card>
          </>
        ) : (
          <>
            <Card as="article" className="home-card">
              <p>Dados pessoais</p>
              <h3>Ficha colaborador</h3>
              <small>Atualizar dados essenciais.</small>
              <Button size="sm" variant="secondary" type="button" onClick={() => navigate('/profile')}>Ver</Button>
            </Card>

            {ownPendingProfileRequest && !isLoadingOwnPendingProfileRequest && (
              <Card as="article" className="home-card home-card--highlight">
                <p>Pendente</p>
                <h3>Pedido de ficha em aprovação</h3>
                <small>Existe um pedido de alteração à espera de validação.</small>
                <Button size="sm" variant="secondary" type="button" onClick={() => navigate('/notifications')}>Ver detalhe</Button>
              </Card>
            )}
          </>
        )}
      </section>
    </>
  );
}
