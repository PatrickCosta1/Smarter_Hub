# SMARTER_HUB - Mapa Estruturado para System Prompt Dinâmico

**Data da Análise**: 13 de Abril de 2026  
**Versão do Sistema**: Pós-Revolução de Permissões (100% granular)  
**Responsável**: GitHub Copilot Analysis

---

## 1. ARQUITETURA DE UTILIZADORES

### 1.1 Tipos de Utilizadores (Enums - Legado em Transição)

```json
{
  "userRoles": {
    "COLABORADOR": {
      "label": "Colaborador",
      "description": "Utilizador padrão com permissões básicas",
      "isActive": true,
      "basePermissions": [
        "view_profile",
        "edit_profile",
        "request_profile_change",
        "view_notifications",
        "request_vacation",
        "view_own_vacations",
        "request_training",
        "view_trainings",
        "view_receipts",
        "download_receipt"
      ]
    },
    "MANAGER": {
      "label": "Manager",
      "description": "Gestor de equipa ou atividade",
      "isActive": true,
      "basePermissions": [
        "view_teams",
        "manage_team_members",
        "view_team_vacations",
        "approve_vacation",
        "reject_vacation",
        "assign_training",
        "view_user_list"
      ]
    },
    "COORDENADOR": {
      "label": "Coordenador",
      "description": "Coordenador de operações ou área",
      "isActive": true,
      "basePermissions": [
        "view_teams",
        "manage_team_members",
        "view_team_vacations",
        "approve_vacation",
        "reject_vacation",
        "approve_profile_change",
        "view_user_list",
        "view_all_vacations"
      ]
    },
    "ADMIN": {
      "label": "Administrador",
      "description": "Administrador do sistema com acesso amplo",
      "isActive": true,
      "basePermissions": [
        "view_user_list",
        "create_user",
        "edit_user",
        "manage_user_active",
        "reset_user_password",
        "manage_permissions",
        "view_system_settings",
        "manage_system_config",
        "view_audit_log",
        "view_teams",
        "create_team",
        "edit_team",
        "delete_team",
        "assign_team_leader",
        "manage_team_members",
        "view_all_vacations",
        "approve_vacation",
        "reject_vacation",
        "view_all_trainings",
        "assign_training",
        "manage_training_catalog",
        "view_all_receipts",
        "manage_notifications"
      ]
    },
    "CONVIDADO": {
      "label": "Convidado",
      "description": "Acesso limitado a recursos específicos",
      "isActive": true,
      "basePermissions": []
    }
  }
}
```

### 1.2 Sistema de Acesso Total (Access Total)

**Conceito**: Utilizadores com `hasAccessTotal=true` obtêm automaticamente TODAS as permissões ativas no sistema.

```json
{
  "accessTotal": {
    "model": "User",
    "fields": {
      "hasAccessTotal": { "type": "boolean", "description": "Flag que ativa todas as permissões" },
      "accessTotalGrantedById": { "type": "string|null", "description": "ID do utilizador que concedeu acesso total (rastreabilidade)" },
      "accessTotalGrantedAt": { "type": "datetime|null", "description": "Data/hora da concessão" }
    },
    "hierarchyExamples": {
      "root": {
        "username": "t.people",
        "email": "t.people@tlantic.com",
        "hasAccessTotal": true,
        "description": "Utilizador raiz com controlo total (sem permissão delegada)",
        "canGrantAccessTotal": true,
        "canRevokeAnyPermission": true
      },
      "delegated": {
        "example": "sara",
        "hasAccessTotal": true,
        "accessTotalGrantedById": "t.people",
        "description": "Utilizador com acesso total delegado por t.people",
        "canGrantAccessTotal": false,
        "canRevokeOwnPermissions": true,
        "canRevokePermissionsGrantedByOthers": false
      }
    },
    "detectionLogic": {
      "isAccessTotal": "user.isRootAccess OR user.hasAccessTotal OR (enabledPermissionCount === totalPermissionCount)",
      "note": "Um utilizador tem acesso total se TODAS as permissões estão ativas"
    }
  }
}
```

### 1.3 Utilizadores Especiais

```json
{
  "specialUsers": {
    "t.people": {
      "email": "t.people@tlantic.com",
      "role": "ADMIN",
      "isRootAccess": true,
      "hasAccessTotal": true,
      "description": "Utilizador supremo - pode conceder/revogar qualquer permissão incluindo acesso total",
      "notaEspecial": "Não aparecer em filtros de aprovadores de férias (não tem férias próprias)"
    },
    "sara": {
      "email": "sara@tlantic.com",
      "role": "ADMIN",
      "hasAccessTotal": true,
      "accessTotalGrantedBy": "t.people",
      "description": "Utilizadora delegada por t.people com acesso total",
      "responsabilidades": [
        "Aprovação de alterações de ficha",
        "Aprovação de férias",
        "Gestão de colaboradores"
      ]
    },
    "marcia": {
      "email": "marcia@tlantic.com",
      "role": "COORDENADOR",
      "permissionsFocused": [
        "approve_profile_change",
        "approve_vacation",
        "view_user_list"
      ],
      "description": "Coordenadora RH com permissões específicas"
    }
  }
}
```

---

## 2. CATÁLOGO COMPLETO DE PERMISSÕES

### 2.1 Permissões por Categoria

#### SYSTEM (Controlo do Sistema)

```json
{
  "SYSTEM": [
    {
      "code": "manage_permissions",
      "label": "Gerir permissões",
      "description": "Permite atribuir e remover permissões a outros utilizadores",
      "requiresRestrictions": true,
      "criticalityLevel": "CRITICAL",
      "restrictions": {
        "restrictedToTeams": "Pode restringir a equipas específicas",
        "restrictedToCountries": "PT/BR",
        "restrictedToLevels": "Pode limitar a níveis de hierarquia",
        "customRestrictions": "Sem aplicação conhecida"
      }
    },
    {
      "code": "view_system_settings",
      "label": "Ver configurações do sistema",
      "description": "Permite consultar as definições globais",
      "requiresRestrictions": false,
      "criticalityLevel": "HIGH"
    },
    {
      "code": "manage_system_config",
      "label": "Gerir configurações do sistema",
      "description": "Permite alterar definições globais do portal",
      "requiresRestrictions": false,
      "criticalityLevel": "CRITICAL"
    },
    {
      "code": "view_audit_log",
      "label": "Ver histórico de auditoria",
      "description": "Permite consultar o histórico de alterações e acessos (PermissionGrant logs)",
      "requiresRestrictions": false,
      "criticalityLevel": "HIGH"
    }
  ]
}
```

#### USERS (Gestão de Utilizadores)

```json
{
  "USERS": [
    {
      "code": "view_user_list",
      "label": "Ver utilizadores",
      "description": "Permite consultar a lista de utilizadores do sistema",
      "requiresRestrictions": false,
      "usage": "Necessário para /users (endpoint públicos)"
    },
    {
      "code": "create_user",
      "label": "Criar utilizadores",
      "description": "Permite criar novos utilizadores (atribui automaticamente permissões padrão por role)",
      "requiresRestrictions": false,
      "automaticPermissions": {
        "onColaborador": [
          "view_profile",
          "request_profile_change",
          "view_notifications",
          "request_vacation",
          "view_own_vacations",
          "request_training",
          "view_trainings",
          "view_receipts",
          "download_receipt"
        ],
        "onTeamLeader": [
          "view_teams",
          "manage_team_members",
          "view_team_vacations",
          "approve_vacation",
          "reject_vacation",
          "assign_training"
        ]
      }
    },
    {
      "code": "edit_user",
      "label": "Editar utilizadores",
      "description": "Permite editar dados de outros utilizadores (role, equipas, credenciais)",
      "requiresRestrictions": true,
      "scope": "Pode ser restringido a equipas específicas"
    },
    {
      "code": "manage_user_active",
      "label": "Ativar e desativar utilizadores",
      "description": "Permite ativar ou desativar contas (isActive flag)",
      "requiresRestrictions": true
    },
    {
      "code": "reset_user_password",
      "label": "Redefinir passwords",
      "description": "Permite redefinir credenciais de acesso",
      "requiresRestrictions": true
    }
  ]
}
```

#### TEAMS (Gestão de Equipas)

```json
{
  "TEAMS": [
    {
      "code": "view_teams",
      "label": "Ver equipas",
      "description": "Permite consultar equipas e respetiva composição",
      "requiresRestrictions": true,
      "usage": "Frontend: ManagerTeamsPage, EquipasPage"
    },
    {
      "code": "create_team",
      "label": "Criar equipas",
      "description": "Permite criar novas equipas",
      "requiresRestrictions": false
    },
    {
      "code": "edit_team",
      "label": "Editar equipas",
      "description": "Permite alterar dados de equipas existentes (name, manager, coordinator)",
      "requiresRestrictions": true
    },
    {
      "code": "delete_team",
      "label": "Apagar equipas",
      "description": "Permite remover equipas",
      "requiresRestrictions": true
    },
    {
      "code": "assign_team_leader",
      "label": "Definir chefe de equipa",
      "description": "Permite atribuir um chefe de equipa (managerId/coordinatorId)",
      "requiresRestrictions": true
    },
    {
      "code": "manage_team_members",
      "label": "Gerir membros da equipa",
      "description": "Permite adicionar, remover e mover membros entre equipas via TeamMembership",
      "requiresRestrictions": true
    }
  ]
}
```

#### VACATIONS (Gestão de Férias)

```json
{
  "VACATIONS": [
    {
      "code": "request_vacation",
      "label": "Pedir férias",
      "description": "Permite criar pedidos de férias próprias",
      "requiresRestrictions": false,
      "validations": [
        "Apenas dias úteis (seg-sex)",
        "Sem feriados nacionais",
        "Políticas por país: PT (10 dias consecutivos) vs BR (5-14 dias, máx 3 períodos)"
      ]
    },
    {
      "code": "view_own_vacations",
      "label": "Ver férias próprias",
      "description": "Permite consultar os próprios pedidos e histórico",
      "requiresRestrictions": false
    },
    {
      "code": "view_team_vacations",
      "label": "Ver férias da equipa",
      "description": "Permite consultar pedidos de férias de equipas específicas",
      "requiresRestrictions": true,
      "scope": "Restrito a equipas do utilizador"
    },
    {
      "code": "view_all_vacations",
      "label": "Ver todas as férias",
      "description": "Permite consultar pedidos de férias de todos os utilizadores",
      "requiresRestrictions": false
    },
    {
      "code": "approve_vacation",
      "label": "Aprovar férias",
      "description": "Permite aprovar pedidos de férias",
      "requiresRestrictions": true,
      "approvalsModel": {
        "structure": "VacationApproval com approvalLevel",
        "workflow": "Vacation.status PENDING → múltiplos aprovadores por nível → APPROVED",
        "triggerNotification": "email + in-app notification"
      }
    },
    {
      "code": "reject_vacation",
      "label": "Rejeitar férias",
      "description": "Permite rejeitar pedidos de férias (com motivo obrigatório)",
      "requiresRestrictions": true
    },
    {
      "code": "manage_vacation_rules",
      "label": "Gerir regras de férias",
      "description": "Permite alterar regras e critérios de aprovação",
      "requiresRestrictions": false,
      "affectsRules": ["enforceVacationBusinessDays", "validateVacationCountryPolicy"]
    }
  ]
}
```

#### TRAININGS (Gestão de Formações)

```json
{
  "TRAININGS": [
    {
      "code": "request_training",
      "label": "Pedir formação",
      "description": "Permite solicitar formações",
      "requiresRestrictions": false
    },
    {
      "code": "view_trainings",
      "label": "Ver formações próprias",
      "description": "Permite consultar formações do próprio utilizador",
      "requiresRestrictions": false
    },
    {
      "code": "view_all_trainings",
      "label": "Ver todas as formações",
      "description": "Permite consultar formações de todos os utilizadores",
      "requiresRestrictions": false
    },
    {
      "code": "assign_training",
      "label": "Atribuir formações",
      "description": "Permite atribuir formações a outros utilizadores (Training.assignedByUserId)",
      "requiresRestrictions": true
    },
    {
      "code": "manage_training_catalog",
      "label": "Gerir catálogo de formações",
      "description": "Permite criar, editar e apagar formações disponíveis",
      "requiresRestrictions": false
    },
    {
      "code": "mark_training_completed",
      "label": "Marcar formação concluída",
      "description": "Permite assinalar uma formação como concluída (Training.status = CONCLUIDA)",
      "requiresRestrictions": true
    }
  ]
}
```

#### PROFILE (Gestão de Perfil/Ficha)

```json
{
  "PROFILE": [
    {
      "code": "view_profile",
      "label": "Ver perfil",
      "description": "Permite consultar o perfil próprio ou de outros conforme contexto",
      "requiresRestrictions": true,
      "scope": "Sem restrição = global; com restrição = apenas equipas atribuídas"
    },
    {
      "code": "edit_profile",
      "label": "Editar perfil",
      "description": "Permite editar o perfil próprio",
      "requiresRestrictions": false
    },
    {
      "code": "edit_other_profile",
      "label": "Editar perfis de outros",
      "description": "Permite editar perfis de outros utilizadores (direto, sem pedido)",
      "requiresRestrictions": true
    },
    {
      "code": "request_profile_change",
      "label": "Pedir alteração de ficha",
      "description": "Permite submeter pedidos de alteração de dados (ProfileChangeRequest status=PENDING)",
      "requiresRestrictions": false
    },
    {
      "code": "approve_profile_change",
      "label": "Aprovar alterações de ficha",
      "description": "Permite aprovar pedidos de alteração de dados",
      "requiresRestrictions": true,
      "workflow": {
        "status": "ProfileChangeRequest.status PENDING → APPROVED/REJECTED",
        "triggerAction": "Aplicar Profile.requestedData ao modelo quando aprovado",
        "triggerNotification": "email + in-app notification"
      }
    }
  ]
}
```

#### RECEIPTS (Gestão de Recibos)

```json
{
  "RECEIPTS": [
    {
      "code": "view_receipts",
      "label": "Ver recibos",
      "description": "Permite consultar recibos próprios",
      "requiresRestrictions": false
    },
    {
      "code": "view_all_receipts",
      "label": "Ver todos os recibos",
      "description": "Permite consultar recibos de toda a organização",
      "requiresRestrictions": false
    },
    {
      "code": "download_receipt",
      "label": "Descarregar recibos",
      "description": "Permite descarregar documentos de recibos",
      "requiresRestrictions": false
    }
  ]
}
```

#### NOTIFICATIONS (Gestão de Notificações)

```json
{
  "NOTIFICATIONS": [
    {
      "code": "view_notifications",
      "label": "Ver notificações",
      "description": "Permite consultar notificações do sistema",
      "requiresRestrictions": false
    },
    {
      "code": "manage_notifications",
      "label": "Gerir notificações",
      "description": "Permite criar, enviar e gerir notificações",
      "requiresRestrictions": false
    }
  ]
}
```

### 2.2 Total de Permissões

**Total**: 42 permissões granulares  
**Categorias**: 8 (SYSTEM, USERS, TEAMS, VACATIONS, TRAININGS, PROFILE, RECEIPTS, NOTIFICATIONS)

---

## 3. WORKFLOWS DE APROVAÇÃO

### 3.1 Fluxo de Aprovação de Férias

```json
{
  "vacationApprovalWorkflow": {
    "trigger": "POST /vacations (user.request_vacation)",
    "initialStatus": "PENDING",
    "model": {
      "vacation": "Vacation { id, userId, status: PENDING|APPROVED|REJECTED|CANCELLED, ... }",
      "approvals": "VacationApproval[] { vacationId, approverId, approvalLevel, status: PENDING|APPROVED|REJECTED|SKIPPED, ... }"
    },
    "steps": [
      {
        "level": 1,
        "description": "Chefe de équipa ou Gestor da Atividade",
        "permissionRequired": "approve_vacation OR reject_vacation",
        "restrictionField": "contextTeamId (automaticamente vinculado à equipa do utilizador)",
        "actions": ["APPROVE", "REJECT"],
        "statusTransition": "PENDING → WAITING (nível 2) ou APPROVED (final) ou REJECTED",
        "notificationOnApprove": "Email + in-app ao utilizador: 'Férias aprovadas pelo chefe'",
        "notificationOnReject": "Email + in-app: 'Férias rejeitadas com motivo'"
      },
      {
        "level": 2,
        "description": "Segunda aprovação (RH/Coordenador)",
        "permissionRequired": "approve_vacation",
        "restrictionField": "Sem restrição (visão global)",
        "prerequisite": "Level 1 APPROVED",
        "actions": ["APPROVE", "REJECT"],
        "statusTransition": "WAITING → APPROVED ou REJECTED",
        "notificationOnApprove": "Email + in-app: 'Férias finalmente aprovadas'",
        "notificationOnReject": "Email + in-app: 'Férias rejeitadas por RH'"
      }
    ],
    "specialCases": {
      "t.people": {
        "description": "Utilizador raiz com hasAccessTotal",
        "noVacations": true,
        "note": "Não pode submeter férias próprias"
      },
      "sara": {
        "description": "Utilizadora delegada com hasAccessTotal",
        "noVacations": true,
        "note": "Não pode submeter férias próprias (decisão RH)"
      },
      "multipleApprovers": {
        "scenario": "Vários aprovadores para mesma equipa",
        "handling": "Qualquer aprovador pode aprovar/rejeitar independentemente"
      }
    },
    "validations": [
      "enforceVacationBusinessDays (sem weekends/feriados)",
      "validateVacationCountryPolicy (PT vs BR regras diferentes)"
    ],
    "countryPolicies": {
      "PT": {
        "mandatory": "10 dias úteis consecutivos no ano",
        "fractionated": "Permitido com limitações",
        "weekends": "Não contam"
      },
      "BR": {
        "minDaysPerPeriod": "5 dias corridos",
        "maxPeriods": 3,
        "mandatoryBlock": "Um período ≥ 14 dias se 3 períodos",
        "fractionedAllowed": false,
        "weekends": "Contam como dias corridos"
      }
    }
  }
}
```

### 3.2 Fluxo de Aprovação de Alteração de Ficha

```json
{
  "profileChangeRequestWorkflow": {
    "trigger": "POST /profile/request (user.request_profile_change)",
    "initialStatus": "PENDING",
    "model": {
      "profileChangeRequest": "ProfileChangeRequest { id, userId, status: PENDING|APPROVED|REJECTED, requestedData: JSON, changesSummary, reviewedById, reviewedAt, reviewReason }"
    },
    "steps": [
      {
        "description": "Submissão do Pedido",
        "actor": "Colaborador",
        "permissionRequired": "request_profile_change",
        "action": "Submeter alterações JSON com 50+ campos (primeiroNome, apelido, nomorfo, dados pessoais, bancários, etc.)",
        "statusAfter": "PENDING",
        "notificationTo": ["approve_profile_change holders"]
      },
      {
        "description": "Análise e Aprovação",
        "actor": "RH/Coordenador/Sara/People",
        "permissionRequired": "approve_profile_change",
        "restrictionField": "Pode ser restringido a colaboradores específicos",
        "actions": ["APPROVE (aplicar JSON ao Profile)", "REJECT (com motivo)"],
        "statusTransition": "PENDING → APPROVED ou REJECTED",
        "onApprove": {
          "action": "Aplicar requestedData.fields ao modelo Profile",
          "notation": "Profile.updatedAt = agora",
          "notification": "Email + in-app: 'Ficha atualizada com sucesso'"
        },
        "onReject": {
          "action": "Reter requestedData, marcar REJECTED",
          "notification": "Email + in-app: 'Pedido rejeitado com motivo'"
        }
      }
    ],
    "fields": [
      "primeiroNome", "apelido", "nomeAbreviado",
      "dataNascimento", "genero", "estadoCivil",
      "habilitacoesLiterarias", "curso", "faculdade",
      "emailPessoal", "telemovel",
      "moradaFiscal", "endereco", "localidade", "codigoPostal",
      "matriculaCarro", "cartaoCidadao",
      "nif", "niss", "iban",
      "situacaoIrs", "numeroDependentes", "irsJovem", "anoPrimeiroDesconto",
      "numeroCartaoContinente", "voucherNosData",
      "comprovativoMoradaFiscal", "comprovativoCartaoCidadao", "comprovativoIban", "comprovativoCartaoContinente",
      "contactoEmergenciaNome", "contactoEmergenciaParentesco", "contactoEmergenciaNumero",
      "cargo", "funcao", "dataInicioContrato", "dataFimContrato",
      "remuneracao", "tipoContrato", "regimeHorario",
      "workCountry"
    ]
  }
}
```

### 3.3 Fluxo de Atribuição de Permissões

```json
{
  "permissionAssignmentWorkflow": {
    "trigger": "POST /users/:id/permissions (user.manage_permissions)",
    "model": {
      "userPermission": "UserPermission { userId, permissionId, isEnabled, restrictedToTeams[], restrictedToCountries[], restrictedToLevels[], customRestrictions, notes, grantedById, grantedAt }",
      "permissionGrant": "PermissionGrant { id, actorUserId, targetUserId, permissionId, action: GRANT|REVOKE, reason, createdAt }"
    },
    "steps": [
      {
        "operation": "GRANT (Adicionar Permissão)",
        "prequisites": [
          "user.manage_permissions",
          "actor != target",
          "actor tem autoridade (isRootAccess OR hasAccessTotal)"
        ],
        "payload": {
          "permissionCode": "string",
          "isEnabled": true,
          "restrictedToTeams": ["opcional lista de team IDs"],
          "restrictedToCountries": ["PT", "BR"],
          "restrictedToLevels": ["opcional lista de níveis"],
          "customRestrictions": "JSON livre para lógica custom",
          "notes": "razão humana para a atribuição",
          "reason": "log event reason"
        },
        "effects": [
          "Criar/atualizar UserPermission entry",
          "Registar PermissionGrant event com action=GRANT",
          "Se enabledPermissionCount == totalPermissions → user.hasAccessTotal = true (automático)"
        ]
      },
      {
        "operation": "REVOKE (Remover Permissão)",
        "prequisites": [
          "user.manage_permissions",
          "actor == grantedById (quem deu pode tirar) OR isRootAccess"
        ],
        "payload": {
          "reason": "log event reason"
        },
        "effects": [
          "Soft-delete: UserPermission.isEnabled = false",
          "Registar PermissionGrant event com action=REVOKE",
          "Se enabledPermissionCount < totalPermissions → user.hasAccessTotal = false (automático)"
        ]
      }
    ],
    "restrictionLevels": {
      "global": "Sem restrictions = acesso a todas as instâncias",
      "team": "restrictedToTeams = ["team1", "team2"] → acesso apenas a esses colaboradores",
      "country": "restrictedToCountries = ["PT"] → acesso apenas a PT users",
      "hierarchyLevel": "restrictedToLevels = ["level1", "level2"] → acesso apenas a níveis específicos"
    },
    "auditLog": "Todos os eventos armazenados em PermissionGrant com timestamps e razões"
  }
}
```

---

## 4. MAPA DE UI/FRONTEND

### 4.1 Navegação Principal (PortalLayout)

```json
{
  "navbar": {
    "fixed": true,
    "structure": "Sidebar esquerda + Header topo",
    "brand": {
      "logo": "Tlantic logo",
      "location": "sidebar top"
    },
    "menu": [
      {
        "id": "home",
        "label": "Home",
        "path": "/",
        "icon": "🏠",
        "visibleToAll": true
      },
      {
        "id": "profile",
        "label": "A Minha Ficha",
        "path": "/profile",
        "icon": "📋",
        "requiredPermission": "view_profile OR edit_profile",
        "hiddenFor": ["t.people"]
      },
      {
        "id": "equipas",
        "label": "Equipas",
        "path": "/equipas",
        "icon": "👥",
        "requiredPermission": "view_teams OR manage_team_members"
      },
      {
        "id": "colaboradores",
        "label": "Colaboradores",
        "path": "/colaboradores",
        "icon": "👨‍💼",
        "requiredPermission": "view_user_list"
      },
      {
        "id": "admin",
        "label": "Administração",
        "path": "/admin",
        "icon": "⚙️",
        "requiredPermission": "edit_user OR create_team OR edit_team OR delete_team"
      },
      {
        "id": "aprovacoes",
        "label": "Aprovações",
        "path": "/aprovacoes",
        "icon": "✅",
        "requiredPermission": "approve_profile_change OR approve_vacation OR reject_vacation OR view_all_vacations"
      },
      {
        "id": "formacoes",
        "label": "Formações",
        "path": "/formacoes",
        "icon": "📚",
        "requiredPermission": "view_trainings OR view_all_trainings OR request_training OR assign_training"
      },
      {
        "id": "ferias",
        "label": "Férias",
        "path": "/ferias",
        "icon": "🏖️",
        "requiredPermission": "request_vacation OR view_own_vacations OR view_all_vacations",
        "hiddenFor": ["t.people"]
      },
      {
        "id": "recibos",
        "label": "Recibos",
        "path": "/recibos",
        "icon": "🧾",
        "requiredPermission": "view_receipts OR view_all_receipts"
      },
      {
        "id": "notificacoes",
        "label": "Notificações",
        "path": "/notifications",
        "icon": "🔔",
        "badge": "unreadNotificationCount",
        "visibleToAll": true
      }
    ],
    "search": {
      "feature": "Pesquisa de áreas (filtro live no menu)",
      "placeholder": "Pesquisar área..."
    }
  }
}
```

### 4.2 HomePage

```json
{
  "HomePage": {
    "path": "/",
    "requiredPermission": "none (público após login)",
    "sections": [
      {
        "name": "Hero Section",
        "content": {
          "greeting": "Olá, {displayName}!",
          "displayNameLogic": "isTPeople ? 'T People' : `${profile.primeiroNome} ${profile.apelido]`",
          "subtitle": "isTPeople ? 'Centro executivo...' : isManagerFlow ? 'Pendências e equipa...' : 'Resumo direto...'"
        }
      },
      {
        "name": "Metrics",
        "cards": [
          { "metric": "Pendências", "value": "totalPending (conditional)" },
          { "metric": "Notificações", "value": "unreadNotifications" },
          { "metric": "Formações ativas", "value": "assignedTrainings.filter(s=ASSIGNED).length" }
        ]
      },
      {
        "name": "Pending Banner",
        "visible": "!isManagerFlow AND ownPendingProfileRequest",
        "content": "Pedido de alteração de ficha em análise"
      },
      {
        "name": "Action Buttons",
        "conditional": {
          "isTPeople": [
            { "button": "Gerir colaboradores", "goto": "/colaboradores" },
            { "button": "Ver aprovações", "goto": "/aprovacoes" }
          ],
          "isManagerFlow": [
            { "button": "Ver pendências", "goto": "/aprovacoes" },
            { "button": "Colaboradores", "goto": "/colaboradores" }
          ],
          "else": [
            { "button": "Abrir minha ficha", "goto": "/profile" }
          ]
        }
      },
      {
        "name": "Info Cards",
        "visible": "isTPeople OR isManagerFlow",
        "cards": [
          {
            "title": "Colaboradores",
            "description": "Ver ficha, permissões e estado",
            "cta": "Abrir"
          },
          {
            "title": "Fila de Aprovações",
            "description": "{totalPending} pendência(s)",
            "cta": "Abrir"
          }
        ]
      }
    ]
  }
}
```

### 4.3 AdminPage

```json
{
  "AdminPage": {
    "path": "/admin",
    "requiredPermissions": ["edit_user OR create_team OR edit_team OR delete_team"],
    "sections": [
      {
        "tab": "Utilizadores",
        "features": [
          {
            "title": "Criar novo utilizador",
            "requiredPermission": "create_user",
            "fields": ["username", "email", "password", "fullName", "role", "teamId", "workCountry"],
            "onSuccess": "Permissões padrão atribuídas automaticamente por role"
          },
          {
            "title": "Editar utilizador",
            "requiredPermission": "edit_user",
            "fields": ["role", "teamId", "workCountry", "localidade", "isActive"],
            "visibleAdmin": true
          },
          {
            "title": "Resetar password",
            "requiredPermission": "reset_user_password",
            "action": "Gera nova password temporária"
          }
        ]
      },
      {
        "tab": "Equipas",
        "features": [
          {
            "title": "Criar equipa",
            "requiredPermission": "create_team",
            "fields": ["name", "leaderId", "parentTeamId", "memberIds"]
          },
          {
            "title": "Editar equipa",
            "requiredPermission": "edit_team",
            "fields": ["name", "managerId", "coordinatorId"]
          },
          {
            "title": "Apagar equipa",
            "requiredPermission": "delete_team"
          },
          {
            "title": "Atribuir chefe",
            "requiredPermission": "assign_team_leader"
          }
        ]
      }
    ]
  }
}
```

### 4.4 PermissionsPage

```json
{
  "PermissionsPage": {
    "path": "/permissoes",
    "requiredPermissions": ["manage_permissions"],
    "targetUserLookup": {
      "method": "Pesquisa de username/email na lista de colaboradores",
      "requirement": "Selecionar utilizador alvo"
    },
    "sections": [
      {
        "title": "Acesso Total",
        "feature": "Toggle hasAccessTotal with reason",
        "effects": [
          "Ativar: Apaga todas as UserPermissions, ativa hasAccessTotal = true",
          "Desativar: hasAccessTotal = false, volta a permissões granulares"
        ],
        "permissionRequired": "manage_permissions AND canRevokeAccessTotal(actor, targetUser)"
      },
      {
        "title": "Permissões Granulares",
        "tabs": ["SYSTEM", "USERS", "TEAMS", "VACATIONS", "TRAININGS", "PROFILE", "RECEIPTS", "NOTIFICATIONS"],
        "perPermission": {
          "display": [
            "Checkbox enabled/disabled",
            "Restrictions UI se requiresRestrictions=true",
            "Notes field",
            "Granted by: {name}",
            "Granted at: {date}"
          ],
          "actions": ["REVOKE (se canRevokePermission)", "EDIT (se enabledÏ restringido)"]
        }
      },
      {
        "title": "Audit Log",
        "feature": "PermissionGrant timeline",
        "columns": ["Action", "Permission", "Actor", "Target", "Date", "Reason"]
      }
    ]
  }
}
```

### 4.5 RHApprovalsPage

```json
{
  "RHApprovalsPage": {
    "path": "/aprovacoes",
    "requiredPermissions": ["approve_profile_change OR approve_vacation OR reject_vacation OR view_all_vacations"],
    "tabs": [
      {
        "id": "profiles",
        "label": "Alterações de Ficha",
        "requiredPermission": "approve_profile_change",
        "visible": "canReviewProfiles",
        "table": {
          "columns": [
            "Colaborador (displayName)",
            "Mudanças (changesSummary)",
            "Status (PENDING/APPROVED/REJECTED)",
            "Data (createdAt)",
            "Ações (APPROVE/REJECT)"
          ],
          "dataSource": "GET /profile/requests (manager/RH context)"
        },
        "actions": {
          "APPROVE": {
            "endpoint": "POST /profile/requests/:id/approve",
            "effects": "Aplicar Profile.requestedData, marcar APPROVED, notify user"
          },
          "REJECT": {
            "endpoint": "POST /profile/requests/:id/reject",
            "payload": "reason (obrigatório)",
            "effects": "Marcar REJECTED, notify user com motivo"
          }
        }
      },
      {
        "id": "vacations",
        "label": "Pedidos de Férias",
        "requiredPermission": "approve_vacation OR reject_vacation OR view_all_vacations",
        "visible": "canReviewVacations",
        "table": {
          "columns": [
            "Colaborador",
            "Período (dataInicio - dataFim)",
            "Tipo (VACATION/ABSENCE_MEDICAL/ABSENCE_TRAINING)",
            "Status (PENDING/APPROVED/REJECTED)",
            "Data",
            "Ações"
          ],
          "dataSource": "GET /vacations/requests (filtered by scope)"
        },
        "actions": {
          "APPROVE": {
            "endpoint": "POST /vacations/:id/approve",
            "effects": "VacationApproval.status = next_level OR Vacation.status = APPROVED"
          },
          "REJECT": {
            "endpoint": "POST /vacations/:id/reject",
            "payload": "reason (obrigatório)",
            "effects": "Vacation.status = REJECTED"
          }
        }
      }
    ]
  }
}
```

### 4.6 VacationsPage

```json
{
  "VacationsPage": {
    "path": "/ferias",
    "requiredPermissions": ["request_vacation OR view_own_vacations OR view_all_vacations"],
    "hiddenFor": ["t.people"],
    "sections": [
      {
        "title": "Pedir Férias",
        "requiredPermission": "request_vacation",
        "form": {
          "fields": {
            "dataInicio": { "type": "date", "required": true },
            "dataFim": { "type": "date", "required": true, "validation": ">= dataInicio" },
            "requestType": { "type": "enum", "options": ["VACATION", "ABSENCE_MEDICAL", "ABSENCE_TRAINING"] },
            "partialDay": { "type": "enum", "options": ["FULL", "AM", "PM"], "onlyForVACATION": true },
            "observacoes": { "type": "text", "optional": true },
            "attachmentLink": { "type": "url", "optional": true }
          },
          "validations": [
            "enforceVacationBusinessDays",
            "validateVacationCountryPolicy (PT vs BR)",
            "ABSENCE_MEDICAL max 3 dias",
            "PartialDay only on mesmo dia AND requestType=VACATION"
          ]
        },
        "onSubmit": {
          "status": "PENDING",
          "createVacationApproval": "For each approvalLevel (baseado em contextTeamId ou contexto)"
        }
      },
      {
        "title": "Histórico",
        "requiredPermission": "view_own_vacations",
        "table": {
          "columns": ["Período", "Tipo", "Status", "Data Pedido", "Decisão"],
          "filters": ["Status", "Ano"]
        }
      },
      {
        "title": "Ver Todas (Manager/RH)",
        "requiredPermission": "view_all_vacations OR view_team_vacations",
        "table": {
          "columns": ["Colaborador", "Período", "Tipo", "Status", "Equipa", "Ações"],
          "scope": "Baseado em permissões (team vs global)"
        }
      }
    ]
  }
}
```

### 4.7 ProfilePage

```json
{
  "ProfilePage": {
    "path": "/profile",
    "requiredPermissions": ["view_profile OR edit_profile"],
    "hiddenFor": ["t.people"],
    "sections": [
      {
        "title": "Dados Pessoais",
        "requiredPermission": "edit_profile",
        "editable": true,
        "fields": [
          "primeiroNome", "apelido", "nomeAbreviado",
          "dataNascimento", "genero", "estadoCivil",
          "emailPessoal", "telemovel"
        ]
      },
      {
        "title": "Morada",
        "editable": true,
        "fields": [
          "moradaFiscal", "endereco", "localidade", "codigoPostal"
        ]
      },
      {
        "title": "Documentação",
        "editable": true,
        "fields": [
          "cartaoCidadao", "matriculaCarro",
          "nif", "niss", "iban",
          "numeroCartaoContinente"
        ]
      },
      {
        "title": "Fiscal & Benefícios",
        "editable": true,
        "fields": [
          "situacaoIrs", "numeroDependentes", "irsJovem",
          "anoPrimeiroDesconto", "voucherNosData"
        ]
      },
      {
        "title": "Contacto Emergência",
        "editable": true,
        "fields": [
          "contactoEmergenciaNome", "contactoEmergenciaParentesco", "contactoEmergenciaNumero"
        ]
      },
      {
        "title": "Laboral",
        "editable": true,
        "fields": [
          "cargo", "funcao", "dataInicioContrato", "dataFimContrato",
          "remuneracao", "tipoContrato", "regimeHorario", "workCountry"
        ]
      },
      {
        "title": "Pedir Alteração",
        "description": "Submeter pedido à RH para validação de alterações",
        "action": "POST /profile/request",
        "payload": "selectedChanges (JSON com única alterações)",
        "onSuccess": {
          "status": "PENDING",
          "notification": "Pedido submetido à RH",
          "banner": "Pedido em análise..."
        }
      },
      {
        "title": "Histórico de Pedidos",
        "requiredPermission": "view_own_vacations (ou similar)",
        "table": {
          "columns": ["Data", "Mudanças", "Status", "Decisão RH"],
          "data": "GET /profile/requests/me"
        }
      }
    ]
  }
}
```

---

## 5. CONTEXTO TÉCNICO E MODELO DE DADOS

### 5.1 Modelo de Restrições de Permissões

```json
{
  "UserPermission": {
    "fields": {
      "userId": "ID do utilizador",
      "permissionId": "ID da permissão",
      "isEnabled": "Ativa/inativa (soft-delete via isEnabled=false)",
      "restrictedToTeams": ["team1", "team2", "..."],
      "restrictedToCountries": ["PT", "BR"],
      "restrictedToLevels": ["level1", "level2"],
      "customRestrictions": "JSON livre para regras custom",
      "notes": "Razão humana (ex: '[AUTO_PRESET_DEFAULT_EMPLOYEE]')",
      "grantedById": "ID do utilizador que concedeu",
      "grantedAt": "Timestamp de atribuição",
      "updatedAt": "Última atualização"
    },
    "uniqueConstraint": "userId + permissionId (um utilizador uma permissão)",
    "cascadeDelete": "Se utilizador apagado, todas as suas UserPermissions apagadas"
  }
}
```

### 5.2 Modelo de Auditoria

```json
{
  "PermissionGrant": {
    "purpose": "Rastrear todos os eventos de concessão/revogação de permissões",
    "fields": {
      "id": "ID único",
      "actorUserId": "Quem fez a ação",
      "targetUserId": "Para quem foi feita",
      "permissionId": "Qual permissão",
      "action": "GRANT ou REVOKE",
      "reason": "Motivo textual",
      "createdAt": "Timestamp"
    },
    "indexes": [
      "actorUserId (quem fez)",
      "targetUserId (quem recebeu)",
      "permissionId",
      "createdAt (ordenação cronológica)"
    ]
  }
}
```

### 5.3 Estados e Transições

```json
{
  "Vacation.status": {
    "PENDING": "Novo pedido, aguardando primeiro aprovador",
    "APPROVED": "Aprovado em todas as camadas",
    "REJECTED": "Rejeitado em qualquer camada",
    "CANCELLED": "Cancelado pelo utilizador"
  },
  "ProfileChangeRequest.status": {
    "PENDING": "Novo pedido, aguardando RH",
    "APPROVED": "Aprovado e aplicado ao Profile",
    "REJECTED": "Rejeitado"
  },
  "VacationApproval.status": {
    "PENDING": "Esperando decisão deste aprovador",
    "APPROVED": "Este aprovador aprovou",
    "REJECTED": "Este aprovador rejeitou",
    "WAITING": "Aprovado por este nível, aguardando próximo",
    "SKIPPED": "Não aplicável para este aprovador"
  }
}
```

---

## 6. CASOS DE USO CRÍTICOS PARA IA

### 6.1 Cenário: "Como posso aprovar uma férias?"

**Resposta do System Prompt**:
1. Utilizador deve ter `approve_vacation` permissão
2. Navegar para `/aprovacoes` → tab "Pedidos de Férias"
3. Clicar em APPROVE no pedido de {colaborador}
4. Sistema automático:
   - Marca VacationApproval[nível atual].status = APPROVED
   - Se nível 2 final → Vacation.status = APPROVED, notifica colaborador
   - Se não final → passa para próximo aprovador (WAITING)
5. Motivo opcional, mas recomendado

### 6.2 Cenário: "Posso ver as férias de todos?"

**Resposta do System Prompt**:
- Se você tem `view_all_vacations` → SIM, sem limites
- Se você tem `view_team_vacations` com "restrictedToTeams" → SIM, apenas essas equipas
- Se você tem apenas `view_own_vacations` → NÃO, apenas suas férias
- Se é chefe de equipa (Team.managerId) → peut-être, depende de permissões granulares

### 6.3 Cenário: "Como atribuir uma permissão a um utilizador?"

**Resposta do System Prompt**:
1. Você precisa `manage_permissions`
2. Ir a `/permissoes` → Pesquisar utilizador
3. Selecionar permissão (ex: `approve_vacation`)
4. Se `requiresRestrictions=true`: indicar restrições (equipas, países, níveis)
5. Adicionar nota (ex: "Chefe de equipa TLANTIC", "\[AUTO_PRESET_TEAM_LEADER\]")
6. Clicar GRANT
7. Sistema registra no PermissionGrant audit log
8. Utilizador recebe notificação sobre nova permissão
9. Se todos as permissões ativas → hasAccessTotal = true (automático)

### 6.4 Cenário: "Qual é a política de férias em PT vs BR?"

**Resposta do System Prompt**:
- **PT**: Mínimo 10 dias úteis consecutivos no ano. Fracionado permitido depois.
- **BR**: Máx 3 períodos/ano, cada período ≥5 dias corridos. Se 3 períodos, um ≥14 dias. Sem fracionado meio-dia.
- **Ambos**: Sem weekends/feriados nacionais em pedidos de férias (usa ABSENCE_* para isso)

---

## 7. PERGUNTAS COMUNS PARA OPERACIONAL

### Q: "Como sai uma pessoa de uma equipa?"
**A**: Remove-se o TeamMembership (soft ou hard-delete), e a pessoa fica sem equipa (teamId=null). Se era chefe, a equipa fica sem manager.

### Q: "Posso recuperar uma permissão revogada?"
**A**: Tecnicamente, pode conceder novamente (nova UserPermission), mas o histórico fica no PermissionGrant audit log. Não há "undelete" automático.

### Q: "O que acontece quando alguém é desativado (isActive=false)?"
**A**: Não consegue fazer login. Permissões técnicamente ainda existem mas são inúteis. Pode reativar via AdminPage.

### Q: "Qual é a diferença entre ADMIN role e hasAccessTotal?"
**A**: O role ADMIN é herdado (coluna enum). hasAccessTotal é dinâmico (baseado em permissões granulares ativas). Admin não = autom Açoático acesso total.

### Q: "Posso ter MultiRole (ex: MANAGER + COORDENADOR)?"
**A**: Não na BD (role é singular). Faz-se via permissões granulares individuais.

---

## 8. DIMENSÕES DINÂMICAS PARA O LLM

Ao responder a perguntas do utilizador, o system prompt deve:

1. **Verificar Role**: Que role tem o utilizador? (enum Role)
2. **Verificar Permissões**: Quais permissões específicas tem?
3. **Verificar Restrições**: Aplicam-se TeamRestrictions? CountryRestrictions? LevelRestrictions?
4. **Verificar Contexto**: Que equipa? Que país? Que nível?
5. **Verificar Status**: Está ativo? Tem acesso total? Tem pending requests?
6. **Responder Dinamicamente**: "Você pode fazer A mas apenas se tiver B, e afeta Z."

---

## 9. ENDPOINTS RESUMIDOS PARA REFERÊNCIA

### Auth
- `POST /auth/login` - Login
- `GET /auth/me` - Utilizador atual
- `PATCH /auth/account` - Alterar credenciais

### Users
- `GET /users` - Lista (requer view_user_list)
- `POST /users` - Criar (requer create_user, auto-permissões)
- `GET /users/:id` - Detalhe
- `PATCH /users/:id` - Editar (requer edit_user)
- `PATCH /users/:id/active` - Ativar/desativar

### Profile
- `GET /profile/me` - Meu perfil
- `PATCH /profile/me` - Editar meu perfil
- `POST /profile/request` - Pedir alteração (requer request_profile_change)
- `GET /profile/requests` - Ver pedidos (RH context)
- `POST /profile/requests/:id/approve` - Aprovar (requer approve_profile_change)
- `POST /profile/requests/:id/reject` - Rejeitar

### Vacations
- `POST /vacations` - Criar pedido (requer request_vacation)
- `GET /vacations/me` - Minhas férias
- `GET /vacations/requests` - Pedidos a aprovar (RH/Manager)
- `POST /vacations/:id/approve` - Aprovar
- `POST /vacations/:id/reject` - Rejeitar

### Permissions
- `GET /permissions` - Ver catálogo completo
- `GET /users/:id/permissions` - Permissões de um utilizador
- `POST /users/:id/permissions` - Conceder permissão (requer manage_permissions)
- `PATCH /users/:id/permissions/:permissionId` - Editar restrições
- `DELETE /users/:id/permissions/:permissionId` - Revogar (requer canRevokePermission)
- `PATCH /users/:id/access-total` - Ativar/desativar acesso total
- `GET /audit/permission-grants` - Histórico de grants

---

## CONCLUSÃO

Este documento constitui a **Especificação Completa para System Prompt Dinâmico do Chatbase**. O LLM deve usar esta estrutura para:

✅ Entender a arquitetura de tipos de utilizadores e permissões  
✅ Responder perguntas sobre quem pode fazer o quê  
✅ Descrever workflows passo-a-passo  
✅ Mapear UI às funcionalidades  
✅ Rastrear dependências (ex: "setup_team_leader" requer assign_team_leader permissão)  
✅ Explicar validações e regras de negócio  
✅ Oferecer sugestões contextuais baseadas em role/permissões  

---

**Data de Geração**: 13 de Abril de 2026  
**Sistema**: SMARTER_HUB v2 (Pós-Revolução Permissões)  
**Escopo**: 100% Permissões Granulares + Workflows de Aprovação  
