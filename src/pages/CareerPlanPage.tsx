import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { usePortal } from '../portal/context';
import { CAREER_LEVELS, resolveCareerPlan, type CareerStep } from '../portal/career-plan';

type CareerTab = 'nivel' | 'roadmap' | 'avaliacao';

export default function CareerPlanPage() {
  const { profile } = usePortal();
  const careerPdfUrl = (import.meta.env.VITE_CAREER_PLAN_PDF_URL as string | undefined)?.trim();
  const plan = useMemo(
    () => resolveCareerPlan(profile.cargo, profile.funcao),
    [profile.cargo, profile.funcao],
  );

  const allLevelSteps = useMemo(
    () => CAREER_LEVELS.map((lvl) => {
      const found = [plan.currentStep, ...plan.nextSteps].find((s) => s.level === lvl);
      if (found) return found;
      // build minimal placeholder for levels not in plan
      return { level: lvl, title: '', expectations: [], signals: [] } as CareerStep;
    }),
    [plan],
  );

  const currentLevelIndex = CAREER_LEVELS.indexOf(plan.currentStep.level);

  const [activeTab, setActiveTab] = useState<CareerTab>('nivel');
  const [activeLevel, setActiveLevel] = useState(plan.currentStep.level);

  useEffect(() => {
    setActiveLevel(plan.currentStep.level);
  }, [plan.currentStep.level]);

  const activeStep = useMemo<CareerStep>(
    () => allLevelSteps.find((s) => s.level === activeLevel) ?? plan.currentStep,
    [activeLevel, allLevelSteps, plan.currentStep],
  );

  return (
    <div className="cp-shell">

      {/* ── HERO ── */}
      <header className="cp-hero">
        <div className="cp-hero__left">
          <span className="cp-eyebrow">{plan.family.label}</span>
          <h1 className="cp-hero__name">{profile.cargo || 'Nível por definir'}</h1>
          <p className="cp-hero__sub">{plan.currentStep.level} · {plan.currentStep.title}</p>
          <div className="cp-progress-track" aria-label="Progressão na hierarquia">
            <div className="cp-progress-bar" style={{ width: `${Math.round(((currentLevelIndex + 1) / CAREER_LEVELS.length) * 100)}%` }} />
          </div>
          <p className="cp-progress-label">
            Nível {currentLevelIndex + 1} de {CAREER_LEVELS.length} na hierarquia
            {currentLevelIndex + 1 < CAREER_LEVELS.length && (
              <> · Próximo: <strong>{CAREER_LEVELS[currentLevelIndex + 1]}</strong></>
            )}
          </p>
        </div>
        <div className="cp-hero__right">
          <div className="cp-stat">
            <span>Área</span>
            <strong>{plan.family.label}</strong>
          </div>
          <div className="cp-stat">
            <span>Funções da área</span>
            <strong>{plan.family.roles.length > 0 ? plan.family.roles.join(' · ') : '-'}</strong>
          </div>
          <div className="cp-stat">
            <span>Progressão para</span>
            <strong>
              {plan.family.nextStepFocus[0] ?? 'Avaliação de desempenho anual'}
            </strong>
          </div>
          {careerPdfUrl && (
            <a className="cp-pdf-link" href={careerPdfUrl} target="_blank" rel="noreferrer">
              Plano de carreira PDF ↗
            </a>
          )}
          <Link className="cp-profile-link" to="/profile">A Minha Ficha →</Link>
        </div>
      </header>

      {/* ── TABS ── */}
      <nav className="cp-tabs" aria-label="Secções">
        {([
          ['nivel', 'O meu nível'],
          ['roadmap', 'Roadmap de níveis'],
          ['avaliacao', 'Processo de avaliação'],
        ] as [CareerTab, string][]).map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={`cp-tab${activeTab === id ? ' is-active' : ''}`}
            onClick={() => setActiveTab(id)}
          >
            {label}
          </button>
        ))}
      </nav>

      {/* ── O MEU NÍVEL ── */}
      {activeTab === 'nivel' && (
        <div className="cp-body">
          <div className="cp-two-col">
            <section className="cp-card">
              <h2 className="cp-card__title">O que é esperado no meu nível</h2>
              <p className="cp-card__desc">{plan.family.summary}</p>
              <ul className="cp-list">
                {plan.currentStep.expectations.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            </section>

            <section className="cp-card">
              <h2 className="cp-card__title">Sinais de prontidão para o próximo passo</h2>
              <ul className="cp-list cp-list--signals">
                {plan.currentStep.signals.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
              <div className="cp-divider" />
              <h3 className="cp-card__sub">Competências comportamentais esperadas</h3>
              <ul className="cp-list cp-list--plain">
                {plan.family.expectedBehaviors.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
            </section>
          </div>

          <section className="cp-card cp-card--accent">
            <h2 className="cp-card__title">Critérios de progressão de carreira</h2>
            <div className="cp-three-col">
              {plan.family.nextStepFocus.map((item, i) => (
                <div key={item} className="cp-criterion">
                  <span className="cp-criterion__num">{i + 1}</span>
                  <p>{item}</p>
                </div>
              ))}
            </div>
            <p className="cp-footnote">
              A progressão é sempre baseada em mérito, potencial e oportunidade interna - em conformidade com o Plano de Carreira oficial.
            </p>
          </section>

          <section className="cp-card">
            <h2 className="cp-card__title">Competências-chave da tua área</h2>
            <div className="cp-tags">
              {plan.family.coreSkills.map((skill) => (
                <span key={skill} className="cp-tag">{skill}</span>
              ))}
            </div>
          </section>
        </div>
      )}

      {/* ── ROADMAP ── */}
      {activeTab === 'roadmap' && (
        <div className="cp-body cp-body--roadmap">
          <aside className="cp-timeline">
            <p className="cp-timeline__label">Hierarquia oficial</p>
            {allLevelSteps.map((step, i) => (
              <button
                key={step.level}
                type="button"
                aria-selected={step.level === activeLevel}
                className={[
                  'cp-tl-item',
                  step.level === activeLevel ? 'is-active' : '',
                  i < currentLevelIndex ? 'is-past' : '',
                  i === currentLevelIndex ? 'is-current' : '',
                ].filter(Boolean).join(' ')}
                onClick={() => setActiveLevel(step.level)}
              >
                <span className="cp-tl-dot" />
                <span className="cp-tl-name">{step.level}</span>
              </button>
            ))}
          </aside>

          <section className="cp-card cp-card--detail" aria-live="polite">
            {activeStep.expectations.length > 0 ? (
              <>
                <div className="cp-detail-header">
                  <h2 className="cp-card__title">{activeStep.level}</h2>
                  <span className="cp-detail-sub">{activeStep.title}</span>
                  {activeStep.level === plan.currentStep.level && (
                    <span className="cp-badge cp-badge--current">Nível atual</span>
                  )}
                </div>
                <div className="cp-two-col cp-two-col--flush">
                  <div>
                    <h3 className="cp-card__sub">Expectativas</h3>
                    <ul className="cp-list">
                      {activeStep.expectations.map((e) => <li key={e}>{e}</li>)}
                    </ul>
                  </div>
                  <div>
                    <h3 className="cp-card__sub">Comportamentos-chave</h3>
                    <ul className="cp-list cp-list--signals">
                      {activeStep.signals.map((s) => <li key={s}>{s}</li>)}
                    </ul>
                  </div>
                </div>
              </>
            ) : (
              <p className="cp-empty">Seleciona um nível para ver os detalhes.</p>
            )}
          </section>
        </div>
      )}

      {/* ── AVALIAÇÃO ── */}
      {activeTab === 'avaliacao' && (
        <div className="cp-body">
          <section className="cp-card">
            <h2 className="cp-card__title">Como funciona o processo de avaliação</h2>
            <p className="cp-card__desc">Dois momentos distintos e complementares, alinhados com o Template de Avaliação de Desempenho 2026.</p>
            <div className="cp-stages">
              {plan.evaluationStages.map((stage, i) => (
                <div key={stage.stage} className="cp-stage">
                  <div className="cp-stage__num">{i + 1}</div>
                  <div className="cp-stage__body">
                    <strong>{stage.stage}</strong>
                    <ul className="cp-list cp-list--plain">
                      {stage.items.map((item) => <li key={item}>{item}</li>)}
                    </ul>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="cp-card">
            <h2 className="cp-card__title">Secções do template oficial (2026)</h2>
            <p className="cp-card__desc">Cada secção tem um responsável definido e orientações específicas.</p>
            <div className="cp-sections-grid">
              {plan.evaluationSections.map((sec, i) => (
                <div key={sec.title} className="cp-section-item">
                  <div className="cp-section-item__num">{i + 1}</div>
                  <div>
                    <p className="cp-section-item__title">{sec.title.replace(/^Secção \d+ – /, '')}</p>
                    <p className="cp-section-item__owner">Responsável: {sec.responsible}</p>
                    <ul className="cp-list cp-list--plain">
                      {sec.instructions.map((ins) => <li key={ins}>{ins}</li>)}
                    </ul>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="cp-card cp-card--accent">
            <h2 className="cp-card__title">Plano 30-60-90 dias</h2>
            <div className="cp-three-col">
              {plan.ninetyDayPlan.map((item, i) => (
                <div key={item} className="cp-criterion">
                  <span className="cp-criterion__num">{i === 0 ? '30d' : i === 1 ? '60d' : '90d'}</span>
                  <p>{item}</p>
                </div>
              ))}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
