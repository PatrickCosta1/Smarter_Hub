// ─────────────────────────────────────────────────────────────────────────────
// chatbot-kb.ts — Base de conhecimento do assistente Smarter Hub
// Cobertura: todas as funcionalidades do sistema, contexto por perfil/página
// ─────────────────────────────────────────────────────────────────────────────

export type ChatbotContext = {
  isRootAccess: boolean;
  isAccessTotal: boolean;
  userRole: string;
  currentPath?: string;
  username?: string;
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

// ─── Helpers ──────────────────────────────────────────────────────────────────

function normalize(text: string): string {
  return text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function hasAnyPermission(ctx: ChatbotContext, codes: string[] = []): boolean {
  if (ctx.isRootAccess || ctx.isAccessTotal) return true;
  return codes.some((c) => ctx.hasPermission(c));
}

function hasFeatureAccess(ctx: ChatbotContext, feature: FeatureSpec): boolean {
  if (feature.requiresRootOrAccessTotal && !(ctx.isRootAccess || ctx.isAccessTotal)) return false;
  if (feature.permissionsAny?.length) return hasAnyPermission(ctx, feature.permissionsAny);
  return true;
}

function roleLabel(ctx: ChatbotContext): string {
  if (ctx.isRootAccess) return 'Root Access';
  if (ctx.isAccessTotal) return 'Access Total';
  switch ((ctx.userRole || '').toLowerCase()) {
    case 'admin':       return 'Admin';
    case 'manager':     return 'Manager';
    case 'coordenador': return 'Coordenador';
    case 'convidado':   return 'Convidado';
    default:            return 'Colaborador';
  }
}

// ─── Deteção de intenção ──────────────────────────────────────────────────────

function isGreeting(q: string): boolean {
  const n = normalize(q).trim();
  return /^(ola|oi|bom dia|boa tarde|boa noite|hey|hello|hi|opa|olá|epa|boas)[!.,?]*$/.test(n);
}
function isThanks(q: string): boolean {
  const n = normalize(q);
  return ['obrigado','obrigada','brigado','brigada','valeu','muito obrigado','thanks','tks'].some((t) => n.includes(t));
}
function isFarewell(q: string): boolean {
  const n = normalize(q).trim();
  return /^(tchau|adeus|ate logo|ate ja|bye|fica bem|flw)[!.,?]*$/.test(n);
}
function isConfused(q: string): boolean {
  const n = normalize(q);
  return ['nao percebi','nao entendi','pode explicar','mais detalhes','explica melhor','como assim'].some((t) => n.includes(t));
}
function queryWantsDiagnostic(q: string): boolean {
  const n = normalize(q);
  return ['porque','por que','nao consigo','nao funciona','bloque','erro','falha','indisponivel','problema','nao aparece','nao vejo'].some((t) => n.includes(t));
}
function queryWantsRules(q: string): boolean {
  const n = normalize(q);
  return ['regra','regras','condicao','criterio','elegibilidade','quando posso','o que e preciso'].some((t) => n.includes(t));
}

function routeInstruction(ctx: ChatbotContext, feature: FeatureSpec): string {
  if (!feature.path) return 'Navega pelo menu lateral para o módulo indicado.';
  if (ctx.currentPath === feature.path) return 'Já estás na página certa.';
  return `Vai ao menu lateral e abre **${feature.path}**.`;
}

function buildAccessSummary(ctx: ChatbotContext): string[] {
  const areas: string[] = ['Home', 'A Minha Ficha'];
  if (ctx.isRootAccess || ctx.isAccessTotal) areas.push('Dashboard');
  if ((ctx.userRole || '').toLowerCase() !== 'convidado') areas.push('Equipas');
  if (hasAnyPermission(ctx, ['view_user_list'])) areas.push('Colaboradores');
  if (hasAnyPermission(ctx, ['approve_profile_change','approve_vacation','reject_vacation','view_all_vacations'])) areas.push('Aprovações');
  if (hasAnyPermission(ctx, ['view_trainings','view_all_trainings','request_training','assign_training'])) areas.push('Formações');
  if (hasAnyPermission(ctx, ['request_vacation','view_own_vacations','view_all_vacations','manage_vacation_rules'])) areas.push('Férias');
  if (hasAnyPermission(ctx, ['view_hours_bank','manage_hours_bank'])) areas.push('Banco de Horas');
  return areas;
}

// ─── Sugestões iniciais por página ────────────────────────────────────────────

export function getInitialSuggestions(ctx: ChatbotContext): string[] {
  const path = ctx.currentPath ?? '';
  const pageSpecific: Record<string, string[]> = {
    '/banco-horas': [
      'Como vejo o meu saldo de banco de horas?',
      'Como lançar horas para um colaborador?',
      'Como definir o limite de horas?',
      'O que é a política de fecho quadrimestral?',
      'Como exportar banco de horas em Excel?',
    ],
    '/ferias': [
      'Como peço férias?',
      'Quais são as regras de férias para BR?',
      'Como cancelo um pedido de férias?',
      'Quem aprova os meus pedidos?',
    ],
    '/aprovacoes': [
      'Como aprovo um pedido de férias?',
      'Posso rejeitar sem motivo?',
      'Como funciona aprovação multi-equipa?',
    ],
    '/colaboradores': [
      'Como ativo ou desativo um utilizador?',
      'Como gerir permissões de um colaborador?',
      'O que é o Access Total?',
    ],
    '/dashboard': [
      'Como exportar Excel no dashboard?',
      'Como filtrar por período?',
      'Que KPIs aparecem no dashboard?',
    ],
    '/profile': [
      'Como edito os meus dados pessoais?',
      'Como faço upload de comprovativos?',
      'Como emito o voucher NOS?',
    ],
    '/formacoes': [
      'Como vejo as minhas formações?',
      'Como atribuir formação a um colaborador?',
    ],
  };
  if (pageSpecific[path]) return pageSpecific[path].slice(0, 6);
  const base = [
    'O que posso fazer com o meu perfil?',
    'Como peço férias?',
    'Como aprovo pedidos?',
    'Como vejo o meu banco de horas?',
    'Onde emito voucher NOS?',
    'Como gerir permissões?',
  ];
  if (ctx.isRootAccess || ctx.isAccessTotal) base.push('Como exporto Excel no dashboard?');
  return base.slice(0, 7);
}

// ─── Base de conhecimento ─────────────────────────────────────────────────────

const FEATURES: FeatureSpec[] = [
  {
    id: 'capabilities-overview',
    title: 'Mapa do que podes fazer no sistema',
    keywords: ['o que posso fazer','o que tenho acesso','o que consigo ver','meu acesso','capacidades','permissoes','areas disponiveis','menu disponivel'],
    description: 'Resumo personalizado das áreas e ações disponíveis.',
    steps: [
      'Consulta o menu lateral para confirmar as áreas disponíveis.',
      'Abre cada área e verifica as ações (criar, aprovar, exportar, editar).',
      'Se faltar uma área crítica, pede ajuste de permissões ao administrador.',
    ],
    related: ['Como peço férias?','Como aprovo pedidos?','Onde está o banco de horas?'],
  },
  {
    id: 'profile-access',
    title: 'Perfil de acesso — email Microsoft e tipo de conta',
    path: '/perfil',
    keywords: ['email microsoft','perfil de acesso','tipo de conta','identificador interno','onde vejo meu email','conta microsoft','login'],
    description: 'Dados de identidade da conta autenticada.',
    steps: [
      'Clica no ícone de utilizador no topo do portal.',
      'Abre **Perfil de acesso**.',
      'Consulta Email Microsoft, Tipo de conta e Identificador interno.',
    ],
    related: ['Onde edito o email pessoal?','Como altero dados pessoais?'],
  },
  {
    id: 'profile-edit',
    title: 'A Minha Ficha — edição de dados pessoais',
    path: '/profile',
    keywords: ['minha ficha','editar perfil','dados pessoais','dados de contacto','iban','nif','cpf','campos obrigatorios','alterar dados','nome completo','morada','dados bancarios','ficha pessoal'],
    description: 'Gestão da ficha por secções com validações e fluxo de aprovação.',
    steps: [
      'Abre **A Minha Ficha**.',
      'Escolhe a secção: Dados Pessoais, Contacto, Documentos, Fiscal/Bancário, Contratuais, Formação Académica ou Benefícios.',
      'Edita os campos e guarda a secção.',
      'Se o perfil estiver em modo de aprovação, a alteração fica pendente.',
    ],
    rules: [
      'Email pessoal é validado por formato.',
      'PT usa NIF/NISS; BR usa CPF/CTPS/RG.',
      'Nome completo exige mínimo 2 partes (utilizadores PT).',
    ],
    commonIssues: [
      'Guardar bloqueado por campo obrigatório em falta.',
      'Pedido pendente impede nova submissão até decisão.',
      'IBAN inválido (formato PT50 para contas portuguesas).',
    ],
    related: ['Como faço upload de comprovativos?','Porque a alteração fica pendente?','Como emito o voucher NOS?'],
  },
  {
    id: 'profile-approval-flow',
    title: 'Fluxo de aprovação de alterações de ficha',
    path: '/aprovacoes',
    keywords: ['alteracao pendente','pedido de alteracao','aprovar ficha','aprovar alteracao','pedido pendente ficha','aprovacao de dados','porque fica pendente'],
    permissionsAny: ['approve_profile_change'],
    description: 'Processo de revisão e aprovação de pedidos de alteração de dados.',
    steps: [
      'O colaborador submete alteração na sua ficha.',
      'É gerada notificação para o aprovador.',
      'Aprovador abre **Aprovações** → separador **Perfil**.',
      'Revê diff e decide Aprovar ou Rejeitar com motivo.',
    ],
    rules: [
      'Autoaprovação é bloqueada.',
      'Fallback para t.people se não houver aprovador direto.',
    ],
    related: ['Como aprovar pedidos?','O que é o fallback t.people?'],
  },
  {
    id: 'upload-files',
    title: 'Upload de comprovativos e documentos',
    path: '/profile',
    keywords: ['upload','comprovativo','ficheiro','documento','anexar','foto','pdf','carregar ficheiro','anexo','submeter documento'],
    description: 'Submissão de ficheiros nas secções da ficha.',
    steps: [
      'Em **A Minha Ficha**, abre a secção onde o comprovativo é necessário.',
      'Clica no botão de upload ou zona drag & drop.',
      'Seleciona o ficheiro (PDF, JPG, PNG; máx. 5 MB).',
      'Confirma o upload e guarda a secção.',
    ],
    rules: [
      'Formatos aceites: PDF, JPG, JPEG, PNG.',
      'Tamanho máximo: 5 MB por ficheiro.',
    ],
    commonIssues: [
      'Upload bloqueado por formato inválido.',
      'Ficheiro demasiado grande (>5 MB).',
    ],
    related: ['Como edito os meus dados?'],
  },
  {
    id: 'benefits-voucher',
    title: 'Benefícios — Voucher NOS e Cartão Continente',
    path: '/profile',
    keywords: ['voucher nos','emitir voucher','beneficios','benefícios','cartao continente','nos','pedido de beneficios'],
    description: 'Emissão de voucher NOS e gestão de benefícios na ficha.',
    steps: [
      'Em **A Minha Ficha**, abre a secção **Pedido de Benefícios**.',
      'No bloco **Voucher NOS**, clica em **Emitir voucher**.',
      'Acompanha feedback de sucesso ou bloqueio.',
      'Recebe notificação de confirmação após submissão.',
    ],
    rules: [
      'Voucher NOS apenas para contratos **Sem termo**.',
      'Cooldown de **2 anos** entre pedidos.',
      'Pedido notificado automaticamente a t.people.',
    ],
    commonIssues: [
      'Botão desativado: contrato não elegível.',
      'Bloqueio temporal: dentro do período de cooldown.',
    ],
    related: ['Como altero dados contratuais?','Onde vejo notificações?'],
  },
  {
    id: 'notifications',
    title: 'Notificações do sistema',
    path: '/notifications',
    keywords: ['notificacoes','notificação','notificações','sino','avisos','alertas','badge','ver notificacoes','limpar notificacoes'],
    description: 'Centro de eventos com leitura, limpeza e navegação para ações.',
    steps: [
      'Clica no **sino** no topo direito (badge mostra não lidas).',
      'Abre a página de Notificações.',
      'Marca como lidas ou remove individualmente.',
      'Usa as notificações como atalho para fluxos de aprovação.',
    ],
    commonIssues: [
      'Notificação sem ação: pedido já foi resolvido.',
      'Badge não atualiza: faz refresh da página.',
    ],
    related: ['Como aprovo pedidos?','Como acompanhar o meu pedido de férias?'],
  },
  {
    id: 'teams-view',
    title: 'Equipas — consulta de estrutura e membros',
    path: '/equipas',
    keywords: ['equipas','equipa','membros','estrutura de equipas','hierarquia','ver equipa','membros da equipa','a minha equipa'],
    description: 'Consulta de equipas e respetiva composição.',
    steps: [
      'Abre **Equipas** no menu lateral.',
      'Seleciona a equipa para ver membros e estrutura.',
      'Usa pesquisa e filtros para localizar pessoas.',
    ],
    related: ['Como gerir membros de equipa?','Como ver férias da equipa?'],
  },
  {
    id: 'teams-manage',
    title: 'Equipas — gestão e administração',
    path: '/equipas',
    keywords: ['criar equipa','editar equipa','adicionar membro','remover membro','gerir equipas','lider de equipa','chefia','adicionar a equipa'],
    permissionsAny: ['create_team','edit_team','manage_team_members','assign_team_leader'],
    description: 'Operações de gestão de equipas, liderança e memberships.',
    steps: [
      'Abre **Equipas**.',
      'Seleciona a equipa e usa as ações de edição.',
      'Edita nome, estrutura, liderança e membros.',
      'Guarda e confirma impacto em aprovações.',
    ],
    rules: [
      'Requer permissão manage_team_members ou assign_team_leader.',
      'A liderança define os aprovadores de férias automaticamente.',
    ],
    commonIssues: [
      'Sem botões de gestão: falta permissão granular.',
      'Membro não aparece: fora do escopo de restrição.',
    ],
    related: ['Como gerir permissões?','Porque não vejo determinada equipa?'],
  },
  {
    id: 'collaborators',
    title: 'Colaboradores — lista, detalhe e gestão',
    path: '/colaboradores',
    keywords: ['colaboradores','lista utilizadores','gerir utilizadores','editar utilizador','ficha de outro colaborador','ver colaboradores','pesquisar colaborador'],
    permissionsAny: ['view_user_list'],
    description: 'Gestão da base de utilizadores com filtros, detalhe e ações administrativas.',
    steps: [
      'Abre **Colaboradores**.',
      'Filtra por role, equipa, país e estado.',
      'Entra no detalhe para editar, alterar estado e permissões.',
      'Usa exportações para reporting.',
    ],
    commonIssues: [
      'Utilizadores fora de escopo não aparecem.',
      'Ações bloqueadas por permissão insuficiente.',
    ],
    related: ['Como gerir permissões?','Como ativar ou desativar utilizador?'],
  },
  {
    id: 'user-activation',
    title: 'Ativar ou desativar utilizador',
    path: '/colaboradores',
    keywords: ['ativar utilizador','desativar utilizador','bloquear conta','suspender conta','reativar conta','conta inativa','ativo','inativo'],
    permissionsAny: ['edit_user','manage_users'],
    description: 'Alteração do estado de conta de colaboradores.',
    steps: [
      'Abre **Colaboradores** e localiza o utilizador.',
      'Entra no detalhe.',
      'Alterna entre **Ativo** e **Inativo** na secção de estado.',
      'Confirma — registo de auditoria e notificação gerados.',
    ],
    rules: [
      'Utilizadores inativos não conseguem fazer login.',
      'A desativação não apaga dados nem histórico.',
      'Root/AT não podem ser desativados por outros AT.',
    ],
    related: ['Como gerir permissões?','Como repor acesso?'],
  },
  {
    id: 'permissions',
    title: 'Permissões e Access Total',
    path: '/colaboradores',
    keywords: ['permissoes','permissões','access total','acesso total','gerir permissoes','root','restricoes por equipa','atribuir permissao','remover permissao','dar acesso','revogar acesso'],
    permissionsAny: ['manage_permissions'],
    description: 'Gestão detalhada de permissões por utilizador.',
    steps: [
      'Abre **Colaboradores** → detalhe do utilizador.',
      'Na área de permissões, ativa/desativa códigos.',
      'Aplica restrições por equipa, país ou nível.',
      'Confirma efeito no menu e capacidades.',
    ],
    rules: [
      'Access Total concede cobertura ampla sem ativar cada código individualmente.',
      'Perfis AT têm proteção mútua (não se gerem entre si).',
      'Root Access é imune a alterações por outros utilizadores.',
    ],
    commonIssues: [
      'Menu não atualiza após permissão: faz logout/login.',
      'Permissão revogada mas ações visíveis: aguarda cache expirar.',
    ],
    related: ['O que é o Access Total?','Como ativar utilizador?'],
  },
  {
    id: 'approvals',
    title: 'Aprovações — ficha e férias/ausências',
    path: '/aprovacoes',
    keywords: ['aprovacoes','aprovações','aprovar','rejeitar','pedidos pendentes','motivo de rejeicao','painel de aprovacoes','decidir pedido'],
    permissionsAny: ['approve_profile_change','approve_vacation','reject_vacation','view_all_vacations'],
    description: 'Painel de decisão para pedidos pendentes.',
    steps: [
      'Abre **Aprovações**.',
      'Seleciona separador: **Perfil** ou **Férias/Ausências**.',
      'Revê contexto e decide Aprovar ou Rejeitar.',
      'Em rejeição, preenche motivo obrigatório.',
    ],
    rules: [
      'Motivo de rejeição é obrigatório.',
      'Autoaprovação é bloqueada.',
      'Em multi-equipa, segue cadeia de aprovação.',
    ],
    related: ['Como funciona aprovação multi-equipa?','O que é o fallback t.people?'],
  },
  {
    id: 'approval-multi-team',
    title: 'Aprovação de férias em cenário multi-equipa',
    path: '/aprovacoes',
    keywords: ['multi-equipa','multi equipa','varias equipas','aprovacao em cadeia','dois aprovadores','quem aprova','fluxo de aprovacao','cadeia de aprovacao'],
    permissionsAny: ['approve_vacation','view_all_vacations'],
    description: 'Fluxo de aprovação quando colaborador pertence a múltiplas equipas.',
    steps: [
      'Cada pedido segue a cadeia de aprovação por equipa primária.',
      'Se o líder estiver ausente, o pedido sobe para fallback.',
      'Fallback final: t.people (se configurado).',
      'Rejeição de um aprovador encerra o processo.',
    ],
    rules: [
      'Pedido só fica "Aprovado" com todos os aprovadores necessários.',
      'Rejeição de um aprovador encerra o fluxo.',
    ],
    related: ['Como aprovar um pedido?','O que é o fallback t.people?'],
  },
  {
    id: 'vacations',
    title: 'Férias e ausências — pedido e acompanhamento',
    path: '/ferias',
    keywords: ['ferias','férias','ausencia','ausência','pedido de ferias','pedir ferias','marcar ferias','solicitar ferias','dias de ferias','historico ferias','calendario ferias'],
    permissionsAny: ['request_vacation','view_own_vacations','view_all_vacations'],
    description: 'Submissão, consulta e gestão de pedidos de férias e ausências.',
    steps: [
      'Abre **Férias / Ausências**.',
      'Clica em **Novo pedido** e escolhe o tipo.',
      'Define período, observações e anexos.',
      'Submete e acompanha estado no histórico.',
    ],
    rules: [
      'Meio-dia apenas para férias.',
      'Validações PT/BR aplicadas automaticamente.',
      'Estados: Pendente → Aprovado / Rejeitado / Anulado.',
    ],
    commonIssues: [
      'Conflito de datas com pedido existente.',
      'Bloqueio por regra de antecedência mínima.',
    ],
    related: ['Quem aprova os meus pedidos?','Como cancelo pedido?','Regras de férias BR'],
  },
  {
    id: 'vacation-cancel',
    title: 'Cancelar pedido de férias',
    path: '/ferias',
    keywords: ['cancelar ferias','anular ferias','cancelar pedido','anular pedido','retirar pedido','desistir de ferias','remover pedido de ferias'],
    permissionsAny: ['request_vacation','view_own_vacations'],
    description: 'Como cancelar um pedido de férias pendente ou aprovado.',
    steps: [
      'Abre **Férias** e localiza o pedido no histórico.',
      'Abre o detalhe do pedido.',
      'Usa **Anular pedido** (disponível para Pendente e Aprovado).',
      'Confirma — aprovador é notificado.',
    ],
    rules: [
      'Pedidos com data já iniciada podem não ser canceláveis.',
      'Aprovador é notificado do cancelamento.',
    ],
    related: ['Como peço férias?'],
  },
  {
    id: 'vacation-rules',
    title: 'Regras de férias — configuração e compliance PT/BR',
    path: '/ferias',
    keywords: ['regras ferias','regras de ferias','politica de ferias','compliance ferias','ferias pt','ferias br','dias uteis','dias corridos','antecedencia','janela de pedido','manage vacation rules'],
    permissionsAny: ['manage_vacation_rules','view_all_vacations'],
    description: 'Configuração das regras de férias com compliance automático PT/BR.',
    steps: [
      'Acede a **Férias** → configuração de regras (apenas gestores).',
      'Define antecedência mínima, janelas e tipos de ausência.',
      'Regras PT/BR são aplicadas conforme país de trabalho.',
    ],
    rules: [
      'PT: dias úteis, Código do Trabalho.',
      'BR: dias corridos, CLT.',
    ],
    related: ['Como peço férias?','Quem aprova pedidos de férias?'],
  },
  {
    id: 'trainings-view',
    title: 'Formações — consulta e histórico pessoal',
    path: '/formacoes',
    keywords: ['formacoes','formações','minhas formacoes','cursos','treino','treinamentos','ver formacoes','historico formacoes','certificado','conclusao'],
    permissionsAny: ['view_trainings','view_all_trainings','request_training','assign_training'],
    description: 'Consulta de formações atribuídas com estado, datas e horas.',
    steps: [
      'Abre **Formações**.',
      'Filtra por estado (Pendente, Em progresso, Concluída).',
      'Clica numa formação para ver detalhe: horas, data, conclusão e fonte.',
    ],
    related: ['Como atribuir formação?','Como exportar formações?'],
  },
  {
    id: 'trainings-manage',
    title: 'Formações — gestão, catálogo e atribuição',
    path: '/formacoes',
    keywords: ['atribuir formacao','gestao formacoes','criar formacao','catalogo formacoes','atribuir curso','novo curso','adicionar formacao','gerir formacoes'],
    permissionsAny: ['assign_training','manage_training_catalog','view_all_trainings'],
    description: 'Gestão do ciclo de formações: catálogo, atribuição e monitorização.',
    steps: [
      'Abre **Formações**.',
      'Cria ou seleciona formação no catálogo.',
      'Atribui a colaboradores ou equipas.',
      'Acompanha estado e conclusão.',
    ],
    commonIssues: [
      'Sem ações de gestão: falta assign_training ou manage_training_catalog.',
      'Colaborador não aparece: fora do escopo de restrição.',
    ],
    related: ['Como ver formações próprias?','Como exportar resultados?'],
  },
  {
    id: 'dashboard',
    title: 'Dashboard analítica — KPIs e filtros',
    path: '/dashboard',
    keywords: ['dashboard','kpi','indicadores','metricas','métricas','filtro periodo','painel','relatorio','estatisticas','analise','graficos'],
    requiresRootOrAccessTotal: true,
    description: 'Painel de indicadores com filtros e análise temporal.',
    steps: [
      'Abre **Dashboard** (Root/AT apenas).',
      'Escolhe período: preset (12m, 3a, 5a) ou datas personalizadas.',
      'Aplica filtros por equipa, país e role.',
      'KPIs atualizam em tempo real.',
    ],
    related: ['Como exportar Excel no dashboard?','Que KPIs aparecem?'],
  },
  {
    id: 'dashboard-export',
    title: 'Exportação Excel do Dashboard',
    path: '/dashboard',
    keywords: ['exportar excel','xlsx','excel dashboard','download dashboard','exportar relatorio','exportar dados','download excel'],
    requiresRootOrAccessTotal: true,
    description: 'Exporta colaboradores filtrados para Excel.',
    steps: [
      'No **Dashboard**, aplica os filtros necessários.',
      'Clica em **Exportar Excel**.',
      'Ficheiro gerado reflete o snapshot dos filtros ativos.',
    ],
    commonIssues: [
      'Exportação inesperada: aplica filtros antes de exportar.',
      'Ficheiro vazio: sem resultados com os filtros ativos.',
    ],
    related: ['Como usar filtro de período?'],
  },
  {
    id: 'hour-bank-balance',
    title: 'Banco de Horas — Meu Saldo pessoal',
    path: '/banco-horas',
    keywords: ['banco de horas','meu saldo','saldo de horas','horas creditadas','horas debitadas','saldo atual','minhas horas','total de horas','horas acumuladas','banco horas saldo','consultar horas','ver saldo banco horas'],
    permissionsAny: ['view_hours_bank','manage_hours_bank'],
    description: 'Consulta do saldo pessoal com histórico de lançamentos.',
    steps: [
      'Abre **Banco de Horas** → separador **Meu Saldo**.',
      'Consulta KPIs: Creditado, Debitado, Saldo atual, Limite.',
      'A barra de progresso mostra a % de utilização do limite.',
      'O histórico lista lançamentos com tipo, horas, motivo e data.',
    ],
    rules: [
      'Limite padrão BR: 100 horas.',
      'Saldo excedido é assinalado a vermelho com alerta.',
      'Data de próximo fecho exibida com base na política configurada.',
    ],
    commonIssues: [
      'Saldo a 0: nenhum lançamento registado ainda.',
      'Limite não visível: perfil BR não configurado.',
    ],
    related: ['O que é a política de fecho?','Como lançar horas?','Como mudar o limite?'],
  },
  {
    id: 'hour-bank-overview',
    title: 'Banco de Horas — Visão RH dos colaboradores',
    path: '/banco-horas',
    keywords: ['visao rh','visão rh','overview banco horas','todos os colaboradores banco horas','tabela banco horas','colaboradores com excedente','excedente banco horas','monitorizar horas','saldo equipa','filtrar banco horas'],
    permissionsAny: ['view_hours_bank','manage_hours_bank'],
    description: 'Tabela de colaboradores com KPIs agregados e filtros.',
    steps: [
      'Em **Banco de Horas** → separador **Visão RH**.',
      'Consulta KPIs: Total colaboradores, Com excedente, Saldo agregado, Excedente total.',
      'A tabela lista créditos, débitos, saldo, limite e estado por colaborador.',
      'Filtra por nome ou ativa "Filtrar excedentes" para focar nos casos críticos.',
    ],
    rules: [
      'Visível para view_hours_bank, manage_hours_bank, Root ou AT.',
      'O utilizador logado não aparece na listagem.',
    ],
    related: ['Como lançar horas?','Como alterar limite?','Como exportar?'],
  },
  {
    id: 'hour-bank-entries',
    title: 'Banco de Horas — Criar lançamento (crédito/débito)',
    path: '/banco-horas',
    keywords: ['lancamento banco horas','lançamento banco horas','creditar horas','debitar horas','adicionar horas','remover horas','registar horas','novo lancamento','criar lancamento','horas credito','horas debito','motivo lancamento','lancar horas'],
    permissionsAny: ['manage_hours_bank'],
    description: 'Registo de crédito ou débito de horas para um colaborador.',
    steps: [
      'Em **Banco de Horas** → separador **Lançamentos**.',
      'Seleciona o colaborador na lista.',
      'Escolhe tipo: **Crédito** (adiciona) ou **Débito** (remove horas).',
      'Introduz as horas e o motivo.',
      'Submete — saldo atualizado imediatamente.',
    ],
    rules: [
      'Motivo do lançamento é obrigatório.',
      'Horas devem ser positivas (>0).',
      'Débito não pode resultar em saldo negativo.',
    ],
    commonIssues: [
      'Colaborador não aparece: fora do escopo de acesso.',
      'Erro de validação: horas inválidas ou motivo em falta.',
    ],
    related: ['Como ver saldo de colaborador?','Como alterar limite?'],
  },
  {
    id: 'hour-bank-limits',
    title: 'Banco de Horas — Definir limite por colaborador',
    path: '/banco-horas',
    keywords: ['limite banco horas','definir limite','alterar limite','configurar limite horas','limite de horas','maximo de horas','limite colaborador','horas maximas'],
    permissionsAny: ['manage_hours_bank'],
    description: 'Configuração do limite máximo de saldo acumulado por colaborador.',
    steps: [
      'Em **Banco de Horas** → separador **Limites**.',
      'Seleciona o colaborador na lista.',
      'Introduz o novo limite em horas.',
      'Clica em **Guardar** — aplicado imediatamente.',
    ],
    rules: [
      'Limite padrão BR: **100 horas**.',
      'Limite personalizável por colaborador.',
      'Alterar limite não afeta saldo existente.',
    ],
    related: ['Meu saldo banco de horas','Como lançar horas?'],
  },
  {
    id: 'hour-bank-export',
    title: 'Banco de Horas — Exportar relatório Excel',
    path: '/banco-horas',
    keywords: ['exportar banco horas','excel banco horas','download banco horas','xlsx banco horas','relatorio banco horas','exportar saldos'],
    permissionsAny: ['manage_hours_bank'],
    description: 'Exportação do relatório de saldos para Excel.',
    steps: [
      'Em **Banco de Horas** → separador **Visão RH**.',
      'Aplica filtros necessários.',
      'Clica em **↓ Exportar XLSX**.',
    ],
    related: ['Como filtrar visão RH?','Que colunas tem o Excel?'],
  },
  {
    id: 'hour-bank-br-policy',
    title: 'Banco de Horas — Estados BR e política de fecho',
    path: '/banco-horas',
    keywords: ['politica de fecho','política de fecho','fecho banco horas','fecho quadrimestral','fecho semestral','fecho anual','proximo fecho','sao paulo','rio grande do sul','estado br','sp','rs','regras br banco horas','estados brasileiros'],
    permissionsAny: ['view_hours_bank','manage_hours_bank'],
    description: 'Como funciona a política de fecho periódico para colaboradores BR.',
    steps: [
      'O estado de trabalho BR (SP ou RS) define a política de fecho.',
      'SP: fecho quadrimestral (fevereiro, junho, outubro).',
      'RS: fecho semestral.',
      'Em **Meu Saldo**, o chip de política e a data do próximo fecho são exibidos.',
    ],
    rules: [
      'SP (São Paulo): fecho em fevereiro, junho e outubro.',
      'RS (Rio Grande do Sul): fecho semestral.',
      'Sem estado BR configurado: política padrão.',
    ],
    related: ['Como defino o estado BR?','Meu saldo banco de horas','Como alterar limite?'],
  },
  {
    id: 'login-issues',
    title: 'Problemas de login e acesso à conta',
    keywords: ['nao consigo entrar','erro de login','esqueci senha','esqueci password','conta bloqueada','sem acesso','sessao expirada','credenciais invalidas','nao consigo fazer login'],
    description: 'Resolução de problemas de autenticação.',
    steps: [
      'Verifica credenciais (email Microsoft corporativo).',
      'Se sessão expirou, faz logout e autentica novamente.',
      'Se conta desativada, contacta o administrador.',
      'Esquecimento de password: usa fluxo de recuperação Microsoft.',
    ],
    commonIssues: [
      'Conta inativa: desativada por administrador.',
      'Token expirado: faz novo login.',
      'Erro 401/403: sessão inválida ou permissão insuficiente.',
    ],
    related: ['Como ativar utilizador?','Como gerir permissões?'],
  },
  {
    id: 'audit-trail',
    title: 'Auditoria e rastreio de ações',
    keywords: ['auditoria','audit','log de acoes','historico de acoes','quem fez','rastreio','registo de alteracoes','trail'],
    requiresRootOrAccessTotal: true,
    description: 'Registo de ações administrativas no sistema.',
    steps: [
      'O sistema regista automaticamente ações críticas.',
      'Registo inclui: quem, o quê, quando e contexto.',
      'Acesso ao log disponível para Root e AT.',
    ],
    rules: [
      'Registos de auditoria são imutáveis.',
    ],
    related: ['Como gerir permissões?'],
  },
];

// ─── Scoring ──────────────────────────────────────────────────────────────────

function scoreFeature(feature: FeatureSpec, normalizedQuery: string, tokens: string[]): number {
  let score = 0;
  for (const keyword of feature.keywords) {
    const nk = normalize(keyword);
    if (normalizedQuery.includes(nk)) {
      score += nk.split(' ').length > 2 ? 12 : nk.length > 10 ? 9 : 7;
    }
  }
  for (const token of tokens) {
    if (token.length < 3) continue;
    for (const keyword of feature.keywords) {
      const nk = normalize(keyword);
      if (nk.includes(token)) score += 2;
      if (normalize(feature.title).includes(token)) score += 1;
    }
  }
  return score;
}

// ─── Construtores de resposta ─────────────────────────────────────────────────

function buildFeatureReply(feature: FeatureSpec, query: string, ctx: ChatbotContext): AssistantReply {
  if (feature.id === 'capabilities-overview') {
    const areas = buildAccessSummary(ctx);
    const name = ctx.username ? ` **${ctx.username}**` : '';
    return {
      text: [`Olá${name}! No teu perfil (**${roleLabel(ctx)}**) tens acesso a:`, '', areas.map((a) => `• ${a}`).join('\n'), '', 'Se alguma área não aparecer, falta permissão — fala com o administrador.'].join('\n'),
      suggestions: ['Como peço férias?','Como aprovo pedidos?','Onde está o banco de horas?','Como exporto Excel no dashboard?'],
    };
  }

  const canAccess = hasFeatureAccess(ctx, feature);
  const baseSuggestions = (feature.related?.length)
    ? feature.related.slice(0, 4)
    : getInitialSuggestions(ctx).slice(0, 4);

  if (!canAccess) {
    const missing: string[] = [];
    if (feature.requiresRootOrAccessTotal) missing.push('Root Access ou Access Total');
    if (feature.permissionsAny?.length) missing.push(`uma das permissões: **${feature.permissionsAny.join(', ')}**`);
    return {
      text: [`Não tens acesso a **${feature.title}**.`, missing.length ? `Requisito: ${missing.join(' + ')}.` : '', 'Pede revisão de permissões ao administrador.'].filter(Boolean).join('\n'),
      suggestions: baseSuggestions,
    };
  }

  const wantsDiagnostic = queryWantsDiagnostic(query);
  const wantsRules = queryWantsRules(query);

  const lines: string[] = [
    `**${feature.title}**`, '',
    routeInstruction(ctx, feature), '',
    ...feature.steps.map((s, i) => `${i + 1}. ${s}`),
  ];

  if (wantsRules && feature.rules?.length) {
    lines.push('', '**Regras importantes:**');
    lines.push(...feature.rules.map((r) => `• ${r}`));
  }
  if (wantsDiagnostic && feature.commonIssues?.length) {
    lines.push('', '**Possíveis causas:**');
    lines.push(...feature.commonIssues.map((i) => `• ${i}`));
  }

  return { text: lines.join('\n'), suggestions: baseSuggestions };
}

function buildDisambiguation(candidates: FeatureSpec[], _ctx: ChatbotContext): AssistantReply {
  return {
    text: ['Encontrei vários fluxos relacionados. Qual destes pretendes?', '', ...candidates.slice(0, 4).map((c, i) => `${i + 1}. ${c.title}`)].join('\n'),
    suggestions: candidates.slice(0, 4).map((c) => c.title),
  };
}

function buildFallback(query: string, ctx: ChatbotContext): AssistantReply {
  const areas = buildAccessSummary(ctx).join(', ');
  return {
    text: [`Não consegui identificar com precisão essa tarefa.`, '', `As tuas áreas disponíveis: **${areas}**.`, '', 'Tenta reformular: **ação + módulo** (ex.: "como aprovar férias" ou "ver saldo banco horas").'].join('\n'),
    suggestions: getInitialSuggestions(ctx),
  };
}

function buildGreetingReply(ctx: ChatbotContext): AssistantReply {
  const name = ctx.username ? `, **${ctx.username}**` : '';
  return {
    text: `Olá${name}! Sou o assistente do Smarter Hub.\nEstás ligado como **${roleLabel(ctx)}**. Em que posso ajudar?`,
    suggestions: getInitialSuggestions(ctx),
  };
}

function buildThanksReply(): AssistantReply {
  return { text: 'De nada! Estou aqui sempre que precisares. 👍', suggestions: [] };
}
function buildFarewellReply(): AssistantReply {
  return { text: 'Até logo! Qualquer dúvida, é só perguntar. 👋', suggestions: [] };
}
function buildConfusedReply(ctx: ChatbotContext): AssistantReply {
  return {
    text: 'Sem problema! Podes perguntar de forma específica, por exemplo:\n• "Como peço férias?"\n• "Como vejo o meu saldo de banco de horas?"\n• "Como aprovar um pedido pendente?"',
    suggestions: getInitialSuggestions(ctx).slice(0, 5),
  };
}

// ─── Entry point ──────────────────────────────────────────────────────────────

export function resolveAssistantReply(query: string, ctx: ChatbotContext): AssistantReply {
  const trimmed = query.trim();
  if (!trimmed) return buildFallback(query, ctx);

  if (isGreeting(trimmed)) return buildGreetingReply(ctx);
  if (isThanks(trimmed)) return buildThanksReply();
  if (isFarewell(trimmed)) return buildFarewellReply();
  if (isConfused(trimmed)) return buildConfusedReply(ctx);

  const normalizedQuery = normalize(trimmed);
  const tokens = normalizedQuery.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return buildFallback(query, ctx);

  const scored = FEATURES
    .map((feature) => {
      let score = scoreFeature(feature, normalizedQuery, tokens);
      if (feature.path && ctx.currentPath === feature.path) score += 4;
      return { feature, score };
    })
    .sort((a, b) => b.score - a.score);

  const best = scored[0];
  if (!best || best.score < 6) return buildFallback(query, ctx);

  const second = scored[1];
  if (second && second.score >= best.score - 2 && second.score >= 9) {
    const candidates = [best.feature, second.feature, scored[2]?.feature].filter(Boolean) as FeatureSpec[];
    return buildDisambiguation(candidates, ctx);
  }

  return buildFeatureReply(best.feature, query, ctx);
}