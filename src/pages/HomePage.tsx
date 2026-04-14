import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiRequestCached, authHeaders, isAbortError } from '../portal/api';
import { usePortal } from '../portal/context';
import Button from '../components/ui/Button';
import Card from '../components/ui/Card';
import LoadingInline from '../components/ui/LoadingInline';

const STORAGE_TOKEN_KEY = 'smarter_hub_auth_token';

function getAuthHeaders() {
  const token = localStorage.getItem(STORAGE_TOKEN_KEY) || '';
  return authHeaders(token);
}

export default function HomePage() {
  const navigate = useNavigate();
  const { profile, unreadNotifications, hasPermission, isRootAccess, currentUser } = usePortal();
  const isTPeople = currentUser?.username === 't.people';
  const canReviewApprovals = isRootAccess || hasPermission('approve_profile_change') || hasPermission('approve_vacation') || hasPermission('reject_vacation');
  const canManageTrainings = isRootAccess || hasPermission('assign_training') || hasPermission('view_all_trainings');
  const canManageCollaborators = isRootAccess || hasPermission('view_user_list') || hasPermission('manage_user_active') || hasPermission('manage_permissions');
  const isManagerFlow = canReviewApprovals || canManageTrainings || canManageCollaborators;
  const displayName = isTPeople
    ? 'T People'
    : `${profile.primeiroNome} ${profile.apelido}`.trim() || profile.primeiroNome || 'Colaborador';
  const [pendingProfileRequests, setPendingProfileRequests] = useState(0);
  const [pendingVacationRequests, setPendingVacationRequests] = useState(0);
  const [assignedTrainings, setAssignedTrainings] = useState(0);
  const [ownPendingProfileRequest, setOwnPendingProfileRequest] = useState(false);
  const [isLoadingSummary, setIsLoadingSummary] = useState(true);

  const totalPending = useMemo(
    () => (isManagerFlow ? pendingProfileRequests + pendingVacationRequests : Number(ownPendingProfileRequest)),
    [isManagerFlow, ownPendingProfileRequest, pendingProfileRequests, pendingVacationRequests],
  );

  useEffect(() => {
    const controller = new AbortController();

    void (async () => {
      setIsLoadingSummary(true);

      try {
        if (isManagerFlow || isTPeople) {
          const [profileRequests, vacationRequests, trainings] = await Promise.all([
            apiRequestCached<unknown[]>('/profile/requests', { headers: getAuthHeaders(), signal: controller.signal }, 15000),
            apiRequestCached<unknown[]>('/vacations/requests', { headers: getAuthHeaders(), signal: controller.signal }, 15000),
            apiRequestCached<Array<{ status?: string }>>('/trainings/assigned', { headers: getAuthHeaders(), signal: controller.signal }, 15000),
          ]);

          setPendingProfileRequests(profileRequests.length);
          setPendingVacationRequests(vacationRequests.length);
          setAssignedTrainings(trainings.filter((item) => item.status === 'ASSIGNED').length);
          setOwnPendingProfileRequest(false);
          return;
        }

        const ownRequest = await apiRequestCached<{ pending?: boolean }>('/profile/requests/me', { headers: getAuthHeaders(), signal: controller.signal }, 15000);
        setOwnPendingProfileRequest(Boolean(ownRequest.pending));
        setPendingProfileRequests(0);
        setPendingVacationRequests(0);
        setAssignedTrainings(0);
      } catch (error) {
        if (isAbortError(error) || controller.signal.aborted) {
          return;
        }

        setPendingProfileRequests(0);
        setPendingVacationRequests(0);
        setAssignedTrainings(0);
        setOwnPendingProfileRequest(false);
      } finally {
        if (!controller.signal.aborted) {
          setIsLoadingSummary(false);
        }
      }
    })();

    return () => controller.abort();
  }, [isManagerFlow, isTPeople]);

  return (
    <>
      <section className="home-hero">
        <div className="home-main">
          <p className="hero-kicker">Portal interno</p>
          <h1>{isLoadingSummary ? <LoadingInline variant="title" /> : `Olá, ${displayName}!`}</h1>
          <p>
            {isLoadingSummary ? (
              <LoadingInline variant="body" />
            ) : isTPeople
              ? 'Centro executivo com foco em decisões e operação.'
              : isManagerFlow
                ? 'Pendências e equipa num painel objetivo.'
                : 'Resumo direto com o essencial do dia.'}
          </p>

          <div className="home-metrics">
            <article>
              <span>Pendências</span>
              <strong>{isLoadingSummary ? <LoadingInline variant="metric" /> : totalPending}</strong>
            </article>
            <article>
              <span>Notificações</span>
              <strong>{isLoadingSummary ? <LoadingInline variant="metric" /> : unreadNotifications}</strong>
            </article>
            <article>
              <span>Formações ativas</span>
              <strong>{isLoadingSummary ? <LoadingInline variant="metric" /> : assignedTrainings}</strong>
            </article>
          </div>

          {!isManagerFlow && ownPendingProfileRequest && !isLoadingSummary && (
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
        {isLoadingSummary ? (
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

            {ownPendingProfileRequest && (
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
