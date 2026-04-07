import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiRequest, authHeaders } from '../portal/api';
import { usePortal } from '../portal/context';

const STORAGE_TOKEN_KEY = 'smarter_hub_auth_token';

function getAuthHeaders() {
  const token = localStorage.getItem(STORAGE_TOKEN_KEY) || '';
  return authHeaders(token);
}

export default function HomePage() {
  const navigate = useNavigate();
  const { profile, unreadNotifications, userRole } = usePortal();
  const isManagerFlow = userRole === 'manager' || userRole === 'coordenador' || userRole === 'admin';
  const [pendingProfileRequests, setPendingProfileRequests] = useState(0);
  const [pendingVacationRequests, setPendingVacationRequests] = useState(0);
  const [assignedTrainings, setAssignedTrainings] = useState(0);

  const profileCompletion = Math.round((Object.values(profile).filter((item) => item.trim().length > 0).length / Object.values(profile).length) * 100);

  const totalPending = useMemo(
    () => pendingProfileRequests + pendingVacationRequests,
    [pendingProfileRequests, pendingVacationRequests],
  );

  useEffect(() => {
    if (!isManagerFlow) {
      return;
    }

    void (async () => {
      try {
        const [profileRequests, vacationRequests, trainings] = await Promise.all([
          apiRequest<unknown[]>('/profile/requests', { headers: getAuthHeaders() }),
          apiRequest<unknown[]>('/vacations/requests', { headers: getAuthHeaders() }),
          apiRequest<Array<{ status?: string }>>('/trainings/assigned', { headers: getAuthHeaders() }),
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
          <h1>Olá, {profile.primeiroNome}!</h1>
          <p>{isManagerFlow ? 'Painel de gestão focado em aprovações, formações e acompanhamento de equipas.' : 'A tua área de trabalho foi preparada com os atalhos mais importantes para tarefas diárias, dados pessoais e comunicação interna.'}</p>

          <div className="home-actions">
            {isManagerFlow ? (
              <>
                <button className="cta-button cta-primary" type="button" onClick={() => navigate('/aprovacoes')}>
                  Abrir aprovações
                </button>
                <button className="cta-button cta-ghost" type="button" onClick={() => navigate('/formacoes')}>
                  Gerir formações
                </button>
              </>
            ) : (
              <button className="cta-button cta-primary" type="button" onClick={() => navigate('/profile')}>
                Abrir ficha de colaborador
              </button>
            )}
          </div>
        </div>

        <aside className="home-aside">
          <h2>Resumo rápido</h2>
          <ul>
            <li>
              <span>{isManagerFlow ? 'Pedidos por validar' : 'Perfil concluído'}</span>
              <strong>{isManagerFlow ? totalPending : `${profileCompletion}%`}</strong>
            </li>
            <li>
              <span>Notificações pendentes</span>
              <strong>{unreadNotifications}</strong>
            </li>
            <li>
              <span>{isManagerFlow ? 'Formações atribuídas ativas' : 'Estado contratual'}</span>
              <strong>{isManagerFlow ? assignedTrainings : profile.tipoContrato}</strong>
            </li>
          </ul>
        </aside>
      </section>

      <section className="home-grid">
        {isManagerFlow ? (
          <>
            <article className="home-card">
              <p>Aprovações</p>
              <h3>Pedidos de ficha e férias</h3>
              <small>{pendingProfileRequests} pedidos de ficha e {pendingVacationRequests} pedidos de férias aguardam decisão.</small>
              <button type="button" onClick={() => navigate('/aprovacoes')}>Abrir</button>
            </article>

            <article className="home-card">
              <p>Formação</p>
              <h3>Plano de formação da equipa</h3>
              <small>Atribui formações por colaborador, acompanha conclusão e remove bloqueios rapidamente.</small>
              <button type="button" onClick={() => navigate('/formacoes')}>Abrir</button>
            </article>

            <article className="home-card">
              <p>Comunicação</p>
              <h3>Notificações internas RH</h3>
              <small>Centraliza eventos críticos do dia e marca ações tratadas sem perder histórico.</small>
              <button type="button" onClick={() => navigate('/notifications')}>Abrir</button>
            </article>
          </>
        ) : (
          <>
            <article className="home-card">
              <p>Dados pessoais</p>
              <h3>Ficha colaborador</h3>
              <small>Atualiza morada, documentos, fiscalidade e contacto de emergência.</small>
              <button type="button" onClick={() => navigate('/profile')}>Abrir</button>
            </article>

            <article className="home-card">
              <p>Comunicação</p>
              <h3>Notificações e mensagens</h3>
              <small>Consulta avisos internos, mensagens da equipa e pedidos pendentes.</small>
              <button type="button" onClick={() => navigate('/notifications')}>Abrir</button>
            </article>

            <article className="home-card">
              <p>Formação</p>
              <h3>Formações e horas</h3>
              <small>Consulta formações atribuídas e conclui quando terminares.</small>
              <button type="button" onClick={() => navigate('/formacoes')}>Abrir</button>
            </article>
          </>
        )}
      </section>
    </>
  );
}
