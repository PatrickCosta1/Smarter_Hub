import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiRequestCached, authHeaders } from '../portal/api';
import { usePortal } from '../portal/context';
import Button from '../components/ui/Button';
import Card from '../components/ui/Card';

const STORAGE_TOKEN_KEY = 'smarter_hub_auth_token';

function getAuthHeaders() {
  const token = localStorage.getItem(STORAGE_TOKEN_KEY) || '';
  return authHeaders(token);
}

export default function HomePage() {
  const navigate = useNavigate();
  const { profile, unreadNotifications, userRole } = usePortal();
  const isManagerFlow = userRole === 'manager' || userRole === 'coordenador' || userRole === 'admin';
  const displayName = `${profile.primeiroNome} ${profile.apelido}`.trim() || profile.primeiroNome || 'Colaborador';
  const [pendingProfileRequests, setPendingProfileRequests] = useState(0);
  const [pendingVacationRequests, setPendingVacationRequests] = useState(0);
  const [assignedTrainings, setAssignedTrainings] = useState(0);

  const profileCompletion = Math.round((Object.values(profile).filter((item) => item.trim().length > 0).length / Object.values(profile).length) * 100);
  const coreMissingCount = useMemo(() => {
    const coreFields = [
      profile.telemovel,
      profile.endereco,
      profile.localidade,
      profile.codigoPostal,
      profile.nif,
      profile.iban,
      profile.contactoEmergenciaNome,
      profile.contactoEmergenciaNumero,
    ];

    return coreFields.filter((value) => !value || !value.trim()).length;
  }, [
    profile.codigoPostal,
    profile.contactoEmergenciaNome,
    profile.contactoEmergenciaNumero,
    profile.endereco,
    profile.iban,
    profile.localidade,
    profile.nif,
    profile.telemovel,
  ]);

  const totalPending = useMemo(
    () => pendingProfileRequests + pendingVacationRequests,
    [pendingProfileRequests, pendingVacationRequests],
  );

  const quickSummaryRows = useMemo(() => {
    const nowLabel = new Intl.DateTimeFormat('pt-PT', { hour: '2-digit', minute: '2-digit' }).format(new Date());

    if (isManagerFlow) {
      const pressure = totalPending >= 6 ? 'Alta pressão operacional' : totalPending >= 3 ? 'Pressão moderada' : 'Fluxo estável';
      const backlogFocus = pendingVacationRequests > pendingProfileRequests ? 'Férias em prioridade' : 'Fichas em prioridade';

      return [
        {
          label: 'Pulso operacional',
          value: `${pressure} · ${backlogFocus}`,
        },
        {
          label: 'Risco de atraso',
          value: totalPending > 0 ? `${totalPending} pedido(s) ainda sem decisão` : 'Nenhum bloqueio ativo',
        },
        {
          label: 'Cadência da equipa',
          value: `${assignedTrainings} formação(ões) ativas · atualização ${nowLabel}`,
        },
      ];
    }

    const profileGuidance =
      coreMissingCount > 3
        ? 'Prioridade: completar contactos e dados fiscais'
        : coreMissingCount > 0
          ? `${coreMissingCount} campo(s) essenciais por validar`
          : 'Dados essenciais completos';

    return [
      {
        label: 'Próxima decisão',
        value: profileCompletion < 100 ? profileGuidance : 'Ficha em estado de revisão final',
      },
      {
        label: 'Sinal de comunicação',
        value: unreadNotifications > 0 ? `${unreadNotifications} notificação(ões) por tratar` : 'Canal limpo, sem alertas',
      },
      {
        label: 'Ritmo de atualização',
        value: `Última sincronização às ${nowLabel}`,
      },
    ];
  }, [
    assignedTrainings,
    coreMissingCount,
    isManagerFlow,
    pendingProfileRequests,
    pendingVacationRequests,
    profileCompletion,
    totalPending,
    unreadNotifications,
  ]);

  useEffect(() => {
    if (!isManagerFlow) {
      return;
    }

    void (async () => {
      try {
        const [profileRequests, vacationRequests, trainings] = await Promise.all([
          apiRequestCached<unknown[]>('/profile/requests', { headers: getAuthHeaders() }, 15000),
          apiRequestCached<unknown[]>('/vacations/requests', { headers: getAuthHeaders() }, 15000),
          apiRequestCached<Array<{ status?: string }>>('/trainings/assigned', { headers: getAuthHeaders() }, 15000),
        ]);

        setPendingProfileRequests(profileRequests.length);
        setPendingVacationRequests(vacationRequests.length);
        setAssignedTrainings(trainings.filter((item) => item.status === 'ASSIGNED').length);
      } catch {
        setPendingProfileRequests(0);
        setPendingVacationRequests(0);
        setAssignedTrainings(0);
      }
    })();
  }, [isManagerFlow]);

  return (
    <>
      <section className="home-hero">
        <div className="home-main">
          <p className="hero-kicker">Portal interno</p>
          <h1>Olá, {displayName}!</h1>
          <p>{isManagerFlow ? 'Pendências, equipa e execução diária.' : 'Tudo o que precisas num único painel.'}</p>

          <div className="home-metrics">
            <article>
              <span>{isManagerFlow ? 'Pendentes' : 'Perfil'}</span>
              <strong>{isManagerFlow ? totalPending : `${profileCompletion}%`}</strong>
            </article>
            <article>
              <span>Notificações</span>
              <strong>{unreadNotifications}</strong>
            </article>
            <article>
              <span>{isManagerFlow ? 'Formações' : 'Contrato'}</span>
              <strong>{isManagerFlow ? assignedTrainings : profile.tipoContrato}</strong>
            </article>
          </div>

          <div className="home-actions">
            {isManagerFlow ? (
              <>
                <Button variant="primary" type="button" onClick={() => navigate('/aprovacoes')}>Ver pendências</Button>
                <Button variant="ghost" type="button" onClick={() => navigate('/formacoes')}>Gestão de formações</Button>
              </>
            ) : (
              <Button variant="primary" type="button" onClick={() => navigate('/profile')}>Abrir minha ficha</Button>
            )}
          </div>
        </div>

        <aside className="home-aside">
          <h2>Resumo rápido</h2>
          <ul>
            {quickSummaryRows.map((row) => (
              <li key={row.label}>
                <span>{row.label}</span>
                <strong>{row.value}</strong>
              </li>
            ))}
          </ul>
        </aside>
      </section>

      <section className="home-grid">
        {isManagerFlow ? (
          <>
            <Card as="article" className="home-card">
              <p>Aprovações</p>
              <h3>Pedidos de ficha e férias</h3>
              <small>{pendingProfileRequests + pendingVacationRequests} pendentes.</small>
              <Button size="sm" variant="secondary" type="button" onClick={() => navigate('/aprovacoes')}>Ver</Button>
            </Card>

            <Card as="article" className="home-card">
              <p>Formação</p>
              <h3>Plano de formação da equipa</h3>
              <small>Gerir e concluir formações.</small>
              <Button size="sm" variant="secondary" type="button" onClick={() => navigate('/formacoes')}>Ver</Button>
            </Card>

            <Card as="article" className="home-card">
              <p>Comunicação</p>
              <h3>Notificações internas</h3>
              <small>Alertas e acompanhamento.</small>
              <Button size="sm" variant="secondary" type="button" onClick={() => navigate('/notifications')}>Ver</Button>
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

            <Card as="article" className="home-card">
              <p>Comunicação</p>
              <h3>Notificações e mensagens</h3>
              <small>Ver avisos e mensagens.</small>
              <Button size="sm" variant="secondary" type="button" onClick={() => navigate('/notifications')}>Ver</Button>
            </Card>

            <Card as="article" className="home-card">
              <p>Formação</p>
              <h3>Formações e horas</h3>
              <small>Consultar e concluir.</small>
              <Button size="sm" variant="secondary" type="button" onClick={() => navigate('/formacoes')}>Ver</Button>
            </Card>
          </>
        )}
      </section>
    </>
  );
}
