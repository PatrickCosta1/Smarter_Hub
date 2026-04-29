export type ChatbotContext = {
  isRootAccess: boolean;
  isAccessTotal: boolean;
  userRole: string;
  currentPath?: string;
  hasPermission: (code: string) => boolean;
};

export type AssistantReply = {
  text: string;
  suggestions: string[];
};

type FeatureSpec = {
  id: string;
  title: string;
  path?: string;
  keywords: string[];
  permissionsAny?: string[];
  requiresRootOrAccessTotal?: boolean;
  description: string;
  steps: string[];
  rules?: string[];
  commonIssues?: string[];
  related?: string[];
};

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function hasAnyPermission(ctx: ChatbotContext, permissionCodes: string[] = []) {
  if (ctx.isRootAccess || ctx.isAccessTotal) {
    return true;
  }

  return permissionCodes.some((code) => ctx.hasPermission(code));
}

function hasFeatureAccess(ctx: ChatbotContext, feature: FeatureSpec) {
  if (feature.requiresRootOrAccessTotal && !(ctx.isRootAccess || ctx.isAccessTotal)) {
    return false;
  }

  if (feature.permissionsAny && feature.permissionsAny.length > 0) {
    return hasAnyPermission(ctx, feature.permissionsAny);
  }

  return true;
}

function roleLabel(ctx: ChatbotContext) {
  const role = (ctx.userRole || '').toLowerCase();

  if (ctx.isRootAccess) {
    return 'Root Access';
  }

  if (ctx.isAccessTotal) {
    return 'Access Total';
  }

  switch (role) {
    case 'admin':
      return 'Admin';
    case 'manager':
      return 'Manager';
    case 'coordenador':
      return 'Coordenador';
    case 'convidado':
      return 'Convidado';
    default:
      return 'Colaborador';
  }
}

function queryWantsDiagnostic(query: string) {
  const normalized = normalize(query);
  return [
    'porque',
    'nao consigo',
    'não consigo',
    'bloque',
    'erro',
    'falha',
    'indisponivel',
    'indisponível',
  ].some((token) => normalized.includes(token));
}

function queryWantsRules(query: string) {
  const normalized = normalize(query);
  return [
    'regra',
    'regras',
    'condicao',
    'condição',
    'pre-condicao',
    'pre condição',
    'criterio',
    'critério',
    'elegibilidade',
  ].some((token) => normalized.includes(token));
}

function routeInstruction(ctx: ChatbotContext, feature: FeatureSpec) {
  if (!feature.path) {
    return 'Navega pelo menu lateral para o módulo indicado.';
  }

  if (ctx.currentPath === feature.path) {
    return `Já estás na página certa (${feature.path}).`;
  }

  return `Vai ao menu lateral e abre a rota ${feature.path}.`;
}

function buildAccessSummary(ctx: ChatbotContext): string[] {
  const areas: string[] = ['Home', 'A Minha Ficha'];

  if (ctx.isRootAccess || ctx.isAccessTotal) {
    areas.push('Dashboard');
  }

  if (ctx.userRole !== 'convidado') {
    areas.push('Equipas');
  }

  if (hasAnyPermission(ctx, ['view_user_list'])) {
    areas.push('Colaboradores');
  }

  if (hasAnyPermission(ctx, ['approve_profile_change', 'approve_vacation', 'reject_vacation', 'view_all_vacations'])) {
    areas.push('Aprovações');
  }

  if (hasAnyPermission(ctx, ['view_trainings', 'view_all_trainings', 'request_training', 'assign_training'])) {
    areas.push('Formações');
  }

  if (hasAnyPermission(ctx, ['request_vacation', 'view_own_vacations', 'view_all_vacations', 'manage_vacation_rules'])) {
    areas.push('Férias');
  }

  return areas;
}

const FEATURES: FeatureSpec[] = [
  {
    id: 'capabilities-overview',
    title: 'Mapa do que podes fazer no sistema',
    keywords: ['o que posso fazer', 'o que tenho acesso', 'o que consigo ver', 'meu acesso', 'capacidades', 'permissoes'],
    description: 'Resumo personalizado das áreas visíveis e capacidade de ação no teu perfil atual.',
    steps: [
      'Usa o menu lateral para confirmar as áreas efetivamente disponíveis.',
      'Abre cada área e valida as ações (criar, aprovar, exportar, editar).',
      'Se faltar uma área crítica, pede ajuste de permissões ao administrador.',
    ],
    related: ['Onde vejo o meu email Microsoft?', 'Como peço férias?', 'Como aprovo pedidos?'],
  },
  {
    id: 'profile-access',
    title: 'Perfil de acesso (email Microsoft, tipo de conta, identificador)',
    path: '/perfil',
    keywords: ['email microsoft', 'perfil de acesso', 'tipo de conta', 'identificador interno', 'onde vejo meu email'],
    description: 'Mostra os dados de identidade de login da conta autenticada.',
    steps: [
      'Clica no ícone de utilizador no topo do portal.',
      'Abre Perfil de acesso.',
      'Consulta Email Microsoft, Tipo de conta e Identificador interno.',
    ],
    related: ['Onde edito o email pessoal?', 'Onde edito os meus dados pessoais?'],
  },
  {
    id: 'profile-edit',
    title: 'A Minha Ficha (edição de dados)',
    path: '/profile',
    keywords: ['minha ficha', 'editar perfil', 'dados pessoais', 'dados contacto', 'iban', 'nif', 'cpf', 'campos obrigatorios'],
    description: 'Gestão completa da ficha por secções com validações e possível fluxo de aprovação.',
    steps: [
      'Abre A Minha Ficha.',
      'Escolhe a secção (Dados Pessoais, Contacto, Documentos, Fiscal/Bancário, Contratuais, Formação, Benefícios).',
      'Edita os campos necessários e guarda a secção.',
      'Se o teu perfil estiver em modo de pedido, a alteração segue para aprovação.',
    ],
    rules: [
      'Email pessoal é validado por formato.',
      'Campos PT e BR variam conforme país de trabalho (NIF/NISS vs CPF/CTPS/RG).',
      'Documentos e comprovativos podem ser obrigatórios por contexto.',
    ],
    commonIssues: [
      'Guardar bloqueado por campo obrigatório em falta.',
      'Pedido pendente impede nova submissão até decisão.',
    ],
    related: ['Como faço upload de comprovativos?', 'Porque a alteração fica pendente?'],
  },
  {
    id: 'benefits-voucher',
    title: 'Benefícios (Cartão Continente e Voucher NOS)',
    path: '/profile',
    keywords: ['voucher nos', 'emitir voucher', 'beneficios', 'cartao continente', 'pedido de beneficios'],
    description: 'Secção de benefícios na ficha com emissão de voucher e validações de elegibilidade.',
    steps: [
      'Em A Minha Ficha, abre a secção 8. Pedido de Benefícios.',
      'No bloco Voucher NOS, clica em Emitir voucher.',
      'Acompanha feedback imediato de sucesso ou bloqueio no próprio bloco e no toast.',
      'Confirma a notificação gerada para ti após submissão.',
    ],
    rules: [
      'Voucher NOS apenas para contrato Sem termo.',
      'Cooldown de 2 anos entre pedidos.',
      'Pedido vai para t.people por notificação automática.',
    ],
    commonIssues: [
      'Botão desativado por contrato não elegível.',
      'Bloqueio temporal até próxima elegibilidade.',
    ],
    related: ['Onde altero dados contratuais?', 'Onde vejo notificações?'],
  },
  {
    id: 'notifications',
    title: 'Notificações operacionais',
    path: '/notifications',
    keywords: ['notificacoes', 'notificação', 'sino', 'avisos', 'alertas'],
    description: 'Centro de eventos do sistema com leitura, limpeza e navegação para ações.',
    steps: [
      'Clica no sino no topo direito.',
      'Abre a página de Notificações.',
      'Marca como lidas ou remove individualmente.',
      'Usa as notificações para abrir fluxos de aprovação e acompanhamento de pedidos.',
    ],
    commonIssues: [
      'Notificação sem ação quando o pedido já foi resolvido.',
      'Perceção de duplicidade em ambientes de desenvolvimento com recarregamento rápido.',
    ],
    related: ['Como aprovo pedidos?', 'Como acompanhar o meu pedido de férias?'],
  },
  {
    id: 'teams-view',
    title: 'Equipas (consulta de estrutura e membros)',
    path: '/equipas',
    keywords: ['equipas', 'equipa', 'membros', 'estrutura', 'hierarquia'],
    description: 'Consulta de equipas e respetiva composição no âmbito autorizado.',
    steps: [
      'Abre Equipas.',
      'Seleciona a equipa relevante para ver membros e estrutura.',
      'Usa pesquisa/filtros quando disponíveis para localizar pessoas ou subequipas.',
    ],
    related: ['Como gerir membros de equipa?', 'Como ver férias da equipa?'],
  },
  {
    id: 'teams-manage',
    title: 'Equipas (gestão)',
    path: '/equipas',
    keywords: ['criar equipa', 'editar equipa', 'adicionar membro', 'remover membro', 'gerir equipas'],
    permissionsAny: ['create_team', 'edit_team', 'manage_team_members', 'assign_team_leader'],
    description: 'Operações de gestão de equipas, chefias e memberships.',
    steps: [
      'Abre Equipas.',
      'Seleciona a equipa e usa ações de edição (nome, estrutura, liderança, membros).',
      'Guarda alterações e valida impacto na visibilidade e aprovações.',
    ],
    commonIssues: [
      'Sem botões de gestão por falta de permissão granular.',
      'Membro fora de escopo por restrição de equipa/país/nível.',
    ],
    related: ['Como gerir permissões?', 'Porque não vejo determinada equipa?'],
  },
  {
    id: 'collaborators',
    title: 'Colaboradores (lista e detalhe)',
    path: '/colaboradores',
    keywords: ['colaboradores', 'lista utilizadores', 'gerir utilizadores', 'editar utilizador', 'ficha de outro colaborador'],
    permissionsAny: ['view_user_list'],
    description: 'Gestão da base de utilizadores com filtros, detalhe e ações administrativas.',
    steps: [
      'Abre Colaboradores.',
      'Filtra por role, equipa, país e estado.',
      'Entra no detalhe para editar perfil, estado de conta e permissões (consoante acesso).',
      'Usa exportações quando necessário para reporting.',
    ],
    commonIssues: [
      'Sem visibilidade de utilizadores fora do escopo de restrição.',
      'Ações bloqueadas por ausência de permissão específica (ex.: edit_user).',
    ],
    related: ['Como gerir permissões?', 'Como ativar/desativar utilizador?'],
  },
  {
    id: 'permissions',
    title: 'Permissões e Access Total',
    path: '/colaboradores',
    keywords: ['permissoes', 'access total', 'acesso total', 'gerir permissoes', 'root', 'restricoes por equipa'],
    permissionsAny: ['manage_permissions'],
    description: 'Gestão detalhada de permissões por utilizador, com restrições e auditoria.',
    steps: [
      'Abre Colaboradores e entra no utilizador alvo.',
      'Na área de permissões, ativa/desativa códigos conforme necessidade.',
      'Aplica restrições por equipa/país/nível quando aplicável.',
      'Confirma o efeito no menu e nas capacidades do utilizador.',
    ],
    rules: [
      'Access Total concede ampla cobertura sem ativação individual de cada código.',
      'Perfis no mesmo nível de Access Total têm restrições de revisão/gestão entre si.',
    ],
    related: ['Porque um menu não aparece para um utilizador?', 'Como validar escopo efetivo?'],
  },
  {
    id: 'approvals',
    title: 'Aprovações (ficha e férias/ausências)',
    path: '/aprovacoes',
    keywords: ['aprovacoes', 'aprovar', 'rejeitar', 'pedidos pendentes', 'motivo de rejeicao'],
    permissionsAny: ['approve_profile_change', 'approve_vacation', 'reject_vacation', 'view_all_vacations'],
    description: 'Painel de decisão para pedidos pendentes de ficha e férias/ausências.',
    steps: [
      'Abre Aprovações.',
      'Seleciona o separador correto (Perfil ou Férias/Ausências).',
      'Revê contexto do pedido e decide Aprovar/Rejeitar.',
      'Em rejeição, preenche motivo obrigatório.',
    ],
    rules: [
      'Motivo de rejeição é obrigatório.',
      'Autoaprovação é proibida pelas regras de negócio.',
      'Em multi-equipa, a decisão segue a cadeia de aprovação definida.',
    ],
    related: ['Onde vejo pedidos de férias?', 'Como funciona fallback para t.people?'],
  },
  {
    id: 'vacations',
    title: 'Férias e ausências (pedido e acompanhamento)',
    path: '/ferias',
    keywords: ['ferias', 'férias', 'ausencia', 'ausência', 'pedido de ferias', 'calendario'],
    permissionsAny: ['request_vacation', 'view_own_vacations', 'view_all_vacations'],
    description: 'Submissão, consulta e gestão de pedidos de férias e ausências.',
    steps: [
      'Abre Férias.',
      'Cria novo pedido escolhendo tipo (férias ou ausência).',
      'Define período, observações e anexos se necessário.',
      'Submete e acompanha estado no histórico.',
    ],
    rules: [
      'Meio-dia é permitido apenas para férias.',
      'Validações de país (PT/BR) são aplicadas automaticamente.',
      'Estados operacionais: Pendente, Aprovado, Rejeitado, Anulado.',
    ],
    commonIssues: [
      'Bloqueio por conflito de datas com pedido já existente.',
      'Bloqueio por regra legal/configurável (ex.: janelas BR/PT).',
    ],
    related: ['Quem aprova os meus pedidos?', 'Como cancelar pedido pendente?'],
  },
  {
    id: 'trainings-view',
    title: 'Formações (consulta própria)',
    path: '/formacoes',
    keywords: ['formacoes', 'formações', 'minhas formacoes', 'cursos', 'treino'],
    permissionsAny: ['view_trainings', 'view_all_trainings', 'request_training', 'assign_training'],
    description: 'Consulta de formações atribuídas com estado, datas, horas e origem.',
    steps: [
      'Abre Formações.',
      'Filtra por estado e critérios relevantes.',
      'Consulta detalhe da formação e respetivo estado de conclusão.',
    ],
    related: ['Como atribuir formação?', 'Como exportar formações?'],
  },
  {
    id: 'trainings-manage',
    title: 'Formações (gestão e atribuição)',
    path: '/formacoes',
    keywords: ['atribuir formacao', 'gestao formacoes', 'criar formacao', 'catalogo formacoes'],
    permissionsAny: ['assign_training', 'manage_training_catalog', 'view_all_trainings'],
    description: 'Gestão do ciclo de formações: catálogo, atribuição e monitorização.',
    steps: [
      'Abre Formações.',
      'Cria ou seleciona formação do catálogo.',
      'Atribui a colaboradores/equipas conforme escopo.',
      'Acompanha estado e conclusão.',
    ],
    commonIssues: [
      'Sem ações de gestão por falta de assign_training/manage_training_catalog.',
      'Colaboradores fora do escopo de restrição não aparecem para atribuição.',
    ],
    related: ['Como ver formações próprias?', 'Como exportar resultados?'],
  },
  {
    id: 'dashboard',
    title: 'Dashboard analítica',
    path: '/dashboard',
    keywords: ['dashboard', 'kpi', 'indicadores', 'metricas', 'métricas', 'filtro periodo'],
    requiresRootOrAccessTotal: true,
    description: 'Painel de indicadores com filtros e análise temporal.',
    steps: [
      'Abre Dashboard.',
      'Escolhe período por preset (12m, 3a, 5a) ou datas personalizadas.',
      'Aplica filtros e pesquisa para análise direcionada.',
    ],
    related: ['Como exportar Excel no dashboard?', 'Porque não vejo dashboard?'],
  },
  {
    id: 'dashboard-export',
    title: 'Exportação Excel do Dashboard',
    path: '/dashboard',
    keywords: ['exportar excel', 'xlsx', 'excel dashboard', 'download dashboard'],
    requiresRootOrAccessTotal: true,
    description: 'Exporta colaboradores resultantes dos filtros ativos no Dashboard.',
    steps: [
      'No Dashboard, aplica primeiro todos os filtros necessários.',
      'Clica em Exportar Excel.',
      'Confirma o ficheiro gerado com o snapshot do filtro atual.',
    ],
    commonIssues: [
      'Exportação não representa o esperado quando filtros não foram aplicados antes do clique.',
    ],
    related: ['Como usar filtro de período?', 'Que colunas saem no Excel?'],
  },
];

function scoreFeature(feature: FeatureSpec, normalizedQuery: string, tokens: string[]): number {
  let score = 0;

  for (const keyword of feature.keywords) {
    const normalizedKeyword = normalize(keyword);
    if (normalizedQuery.includes(normalizedKeyword)) {
      score += normalizedKeyword.length > 10 ? 9 : 7;
    }
  }

  for (const token of tokens) {
    if (token.length < 3) {
      continue;
    }

    if (feature.keywords.some((keyword) => normalize(keyword).includes(token))) {
      score += 2;
    }
  }

  return score;
}

function buildFeatureReply(feature: FeatureSpec, query: string, ctx: ChatbotContext): AssistantReply {
  if (feature.id === 'capabilities-overview') {
    const availableAreas = buildAccessSummary(ctx);

    return {
      text: [
        `No teu perfil (${roleLabel(ctx)}), tens acesso a: ${availableAreas.join(', ')}.`,
        'Se uma área não aparecer no menu, falta permissão para esse fluxo.',
      ].join('\n'),
      suggestions: [
        'Como peço férias?',
        'Como aprovo pedidos?',
        'Onde emito voucher NOS?',
        'Como exporto Excel no dashboard?',
      ],
    };
  }

  const canAccess = hasFeatureAccess(ctx, feature);
  const baseSuggestions = feature.related && feature.related.length > 0
    ? feature.related.slice(0, 4)
    : getInitialSuggestions(ctx).slice(0, 4);

  if (!canAccess) {
    const missing: string[] = [];

    if (feature.requiresRootOrAccessTotal) {
      missing.push('Root Access ou Access Total');
    }

    if (feature.permissionsAny && feature.permissionsAny.length > 0) {
      missing.push(`uma das permissões: ${feature.permissionsAny.join(', ')}`);
    }

    return {
      text: [
        `Não tens acesso a ${feature.title}.`,
        `Requisito: ${missing.join(' + ')}.`,
        'Se precisares desta área, pede revisão de permissões ao administrador.',
      ].join('\n'),
      suggestions: baseSuggestions,
    };
  }

  const wantsDiagnostic = queryWantsDiagnostic(query);
  const wantsRules = queryWantsRules(query);

  const detailLines: string[] = [
    routeInstruction(ctx, feature),
    ...feature.steps.slice(0, 3).map((step, index) => `${index + 1}. ${step}`),
  ];

  if (wantsRules && feature.rules && feature.rules.length > 0) {
    detailLines.push('', 'Regras importantes:');
    detailLines.push(...feature.rules.map((rule) => `- ${rule}`));
  }

  if (wantsDiagnostic && feature.commonIssues && feature.commonIssues.length > 0) {
    detailLines.push('', 'Possíveis causas do bloqueio:');
    detailLines.push(...feature.commonIssues.map((issue) => `- ${issue}`));
  }

  return {
    text: detailLines.join('\n'),
    suggestions: baseSuggestions,
  };
}

function buildDisambiguation(candidates: FeatureSpec[], ctx: ChatbotContext): AssistantReply {
  return {
    text: [
      'A tua pergunta pode referir vários fluxos. Qual destes queres?',
      ...candidates.slice(0, 3).map((candidate, index) => `${index + 1}. ${candidate.title}`),
    ].join('\n'),
    suggestions: candidates.slice(0, 4).map((candidate) => candidate.title),
  };
}

function buildFallback(query: string, ctx: ChatbotContext): AssistantReply {
  const availableAreas = buildAccessSummary(ctx).join(', ');

  return {
    text: [
      'Não consegui identificar com precisão essa tarefa.',
      `Áreas visíveis no teu perfil: ${availableAreas}.`,
      'Reformula em formato objetivo + ação (ex.: "aprovar pedido de férias").',
    ].join('\n'),
    suggestions: getInitialSuggestions(ctx),
  };
}

export function resolveAssistantReply(query: string, ctx: ChatbotContext): AssistantReply {
  const normalizedQuery = normalize(query);
  const tokens = normalizedQuery.split(/\s+/).filter(Boolean);

  if (tokens.length === 0) {
    return buildFallback(query, ctx);
  }

  const scored = FEATURES
    .map((feature) => ({ feature, score: scoreFeature(feature, normalizedQuery, tokens) }))
    .sort((a, b) => b.score - a.score);

  const best = scored[0];
  if (!best || best.score < 6) {
    return buildFallback(query, ctx);
  }

  const second = scored[1];
  if (second && second.score >= best.score - 2 && second.score >= 7) {
    return buildDisambiguation([best.feature, second.feature, scored[2]?.feature].filter(Boolean) as FeatureSpec[], ctx);
  }

  return buildFeatureReply(best.feature, query, ctx);
}

export function getInitialSuggestions(ctx: ChatbotContext): string[] {
  const base = [
    'O que posso fazer com o meu perfil?',
    'Onde vejo o meu email Microsoft?',
    'Onde edito a minha ficha?',
    'Como peço férias?',
    'Como aprovo pedidos?',
    'Onde emito voucher NOS?',
    'Como gerir permissões?',
  ];

  if (ctx.isRootAccess || ctx.isAccessTotal) {
    base.push('Como exporto Excel no dashboard?');
  }

  return base.slice(0, 8);
}
