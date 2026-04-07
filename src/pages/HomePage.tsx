import { useNavigate } from 'react-router-dom';
import { usePortal } from '../portal/context';

export default function HomePage() {
  const navigate = useNavigate();
  const { profile, unreadNotifications } = usePortal();

  const profileCompletion = Math.round((Object.values(profile).filter((item) => item.trim().length > 0).length / Object.values(profile).length) * 100);

  return (
    <>
      <section className="home-hero">
        <div className="home-main">
          <p className="hero-kicker">Portal interno</p>
          <h1>Olá, {profile.primeiroNome}!</h1>
          <p>
            A tua área de trabalho foi preparada com os atalhos mais importantes para tarefas diárias, dados pessoais e comunicação interna.
          </p>

          <div className="home-actions">
            <button className="cta-button cta-primary" type="button" onClick={() => navigate('/profile')}>
              Abrir ficha de colaborador
            </button>
          </div>
        </div>

        <aside className="home-aside">
          <h2>Resumo rápido</h2>
          <ul>
            <li>
              <span>Perfil concluído</span>
              <strong>{profileCompletion}%</strong>
            </li>
            <li>
              <span>Notificações pendentes</span>
              <strong>{unreadNotifications}</strong>
            </li>
            <li>
              <span>Estado contratual</span>
              <strong>{profile.tipoContrato}</strong>
            </li>
          </ul>
        </aside>
      </section>

      <section className="home-grid">
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
          <small>Regista formações e acompanha o total de horas acumuladas.</small>
          <button type="button" onClick={() => navigate('/formacoes')}>Abrir</button>
        </article>
      </section>
    </>
  );
}
