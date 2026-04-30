export type PermissionCategory =
  | 'SYSTEM'
  | 'USERS'
  | 'TEAMS'
  | 'VACATIONS'
  | 'TRAININGS'
  | 'PROFILE'
  | 'NOTIFICATIONS';

export type PermissionCatalogItem = {
  code: string;
  label: string;
  description: string;
  category: PermissionCategory;
  requiresRestrictions: boolean;
};

export const PERMISSION_CATALOG: PermissionCatalogItem[] = [
  { code: 'view_user_list', label: 'Ver utilizadores', description: 'Permite consultar a lista de utilizadores do sistema.', category: 'USERS', requiresRestrictions: false },
  { code: 'create_user', label: 'Criar utilizadores', description: 'Permite criar novos utilizadores.', category: 'USERS', requiresRestrictions: false },
  { code: 'edit_user', label: 'Editar utilizadores', description: 'Permite editar dados de outros utilizadores.', category: 'USERS', requiresRestrictions: true },
  { code: 'manage_user_active', label: 'Ativar e desativar utilizadores', description: 'Permite ativar ou desativar contas.', category: 'USERS', requiresRestrictions: true },
  { code: 'reset_user_password', label: 'Redefinir passwords', description: 'Permite redefinir credenciais de acesso.', category: 'USERS', requiresRestrictions: true },
  { code: 'manage_permissions', label: 'Gerir permissões', description: 'Permite atribuir e remover permissões a outros utilizadores.', category: 'SYSTEM', requiresRestrictions: true },
  { code: 'view_system_settings', label: 'Ver configurações do sistema', description: 'Permite consultar as definições globais.', category: 'SYSTEM', requiresRestrictions: false },
  { code: 'manage_system_config', label: 'Gerir configurações do sistema', description: 'Permite alterar definições globais do portal.', category: 'SYSTEM', requiresRestrictions: false },
  { code: 'view_audit_log', label: 'Ver histórico de auditoria', description: 'Permite consultar o histórico de alterações e acessos.', category: 'SYSTEM', requiresRestrictions: false },

  { code: 'view_teams', label: 'Ver equipas', description: 'Permite consultar equipas e respetiva composição.', category: 'TEAMS', requiresRestrictions: true },
  { code: 'create_team', label: 'Criar equipas', description: 'Permite criar novas equipas.', category: 'TEAMS', requiresRestrictions: false },
  { code: 'edit_team', label: 'Editar equipas', description: 'Permite alterar dados de equipas existentes.', category: 'TEAMS', requiresRestrictions: true },
  { code: 'delete_team', label: 'Apagar equipas', description: 'Permite remover equipas.', category: 'TEAMS', requiresRestrictions: true },
  { code: 'assign_team_leader', label: 'Definir chefe de equipa', description: 'Permite atribuir um chefe de equipa.', category: 'TEAMS', requiresRestrictions: true },
  { code: 'manage_team_members', label: 'Gerir membros da equipa', description: 'Permite adicionar, remover e mover membros entre equipas.', category: 'TEAMS', requiresRestrictions: true },

  { code: 'request_vacation', label: 'Pedir férias', description: 'Permite criar pedidos de férias próprias.', category: 'VACATIONS', requiresRestrictions: false },
  { code: 'view_own_vacations', label: 'Ver férias próprias', description: 'Permite consultar os próprios pedidos e histórico.', category: 'VACATIONS', requiresRestrictions: false },
  { code: 'view_team_vacations', label: 'Ver férias da equipa', description: 'Permite consultar pedidos de férias de equipas específicas.', category: 'VACATIONS', requiresRestrictions: true },
  { code: 'view_all_vacations', label: 'Ver todas as férias', description: 'Permite consultar pedidos de férias de todos os utilizadores.', category: 'VACATIONS', requiresRestrictions: false },
  { code: 'approve_vacation', label: 'Aprovar férias', description: 'Permite aprovar pedidos de férias.', category: 'VACATIONS', requiresRestrictions: true },
  { code: 'reject_vacation', label: 'Rejeitar férias', description: 'Permite rejeitar pedidos de férias.', category: 'VACATIONS', requiresRestrictions: true },
  { code: 'manage_vacation_rules', label: 'Gerir regras de férias', description: 'Permite alterar regras e critérios de aprovação.', category: 'VACATIONS', requiresRestrictions: false },
  { code: 'view_hours_bank', label: 'Ver banco de horas', description: 'Permite consultar saldos e relatórios de banco de horas.', category: 'VACATIONS', requiresRestrictions: true },
  { code: 'manage_hours_bank', label: 'Gerir banco de horas', description: 'Permite lançar créditos/débitos e ajustar limites do banco de horas.', category: 'VACATIONS', requiresRestrictions: false },

  { code: 'request_training', label: 'Pedir formação', description: 'Permite solicitar formações.', category: 'TRAININGS', requiresRestrictions: false },
  { code: 'view_trainings', label: 'Ver formações próprias', description: 'Permite consultar formações do próprio utilizador.', category: 'TRAININGS', requiresRestrictions: false },
  { code: 'view_all_trainings', label: 'Ver todas as formações', description: 'Permite consultar formações de todos os utilizadores.', category: 'TRAININGS', requiresRestrictions: false },
  { code: 'assign_training', label: 'Atribuir formações', description: 'Permite atribuir formações a outros utilizadores.', category: 'TRAININGS', requiresRestrictions: true },
  { code: 'manage_training_catalog', label: 'Gerir catálogo de formações', description: 'Permite criar, editar e apagar formações disponíveis.', category: 'TRAININGS', requiresRestrictions: false },
  { code: 'mark_training_completed', label: 'Marcar formação concluída', description: 'Permite assinalar uma formação como concluída.', category: 'TRAININGS', requiresRestrictions: true },

  { code: 'view_profile', label: 'Ver perfil', description: 'Permite consultar o perfil próprio ou de outros conforme contexto.', category: 'PROFILE', requiresRestrictions: true },
  { code: 'edit_profile', label: 'Editar perfil', description: 'Permite editar o perfil próprio.', category: 'PROFILE', requiresRestrictions: false },
  { code: 'edit_other_profile', label: 'Editar perfis de outros', description: 'Permite editar perfis de outros utilizadores.', category: 'PROFILE', requiresRestrictions: true },
  { code: 'manage_profile_dropdown_options', label: 'Gerir cargos e funções', description: 'Permite gerir o catálogo de cargos e funções disponível na ficha do colaborador.', category: 'PROFILE', requiresRestrictions: false },
  { code: 'request_profile_change', label: 'Pedir alteração de ficha', description: 'Permite submeter pedidos de alteração de dados.', category: 'PROFILE', requiresRestrictions: false },
  { code: 'approve_profile_change', label: 'Aprovar alterações de ficha', description: 'Permite aprovar pedidos de alteração de dados.', category: 'PROFILE', requiresRestrictions: true },

  { code: 'view_notifications', label: 'Ver notificações', description: 'Permite consultar notificações do sistema.', category: 'NOTIFICATIONS', requiresRestrictions: false },
  { code: 'manage_notifications', label: 'Gerir notificações', description: 'Permite criar, enviar e gerir notificações.', category: 'NOTIFICATIONS', requiresRestrictions: false },
];