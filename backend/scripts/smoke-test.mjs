import assert from 'node:assert/strict';

const backendBaseUrl = (process.env.SMB_BACKEND_URL || 'http://localhost:4000').replace(/\/$/, '');
const apiBaseUrl = `${backendBaseUrl}/api`;
const runMutations = isTruthy(process.env.SMB_SMOKE_MUTATIONS ?? 'true');
const targetPermissionCode = process.env.SMB_TEST_PERMISSION_CODE?.trim() || 'view_teams';

const ROUTE_KEYS = [
  'GET /health',
  'POST /auth/login',
  'GET /auth/me',
  'PATCH /auth/account',
  'POST /files/upload',
  'GET /permissions',
  'GET /users/:id/permissions',
  'POST /users/:id/permissions',
  'PATCH /users/:id/permissions/:permissionId',
  'DELETE /users/:id/permissions/:permissionId',
  'PATCH /users/:id/access-total',
  'GET /audit/permission-grants',
  'GET /profile/me',
  'GET /profile/requests/me',
  'PUT /profile/me',
  'GET /profile/requests',
  'POST /profile/requests/:id/approve',
  'POST /profile/requests/:id/reject',
  'GET /notifications/me',
  'PATCH /notifications/:id/read',
  'PATCH /notifications/read-all',
  'DELETE /notifications/:id',
  'ALL /receipts',
  'GET /users',
  'GET /users/collaborators',
  'PATCH /users/:id/active',
  'GET /users/me/teams',
  'GET /teams',
  'GET /teams/me',
  'GET /teams/me/:teamId',
  'PATCH /manager/team-members/:id',
  'GET /admin/users',
  'GET /admin/teams',
  'POST /admin/teams',
  'PATCH /admin/teams/:id',
  'DELETE /admin/teams/:id',
  'PATCH /admin/users/:id',
  'PATCH /admin/users/:id/credentials',
  'PATCH /admin/users/:id/memberships',
  'POST /users',
  'GET /trainings/me',
  'GET /trainings/assigned',
  'POST /trainings',
  'POST /trainings/assign',
  'POST /trainings/:id/complete',
  'PUT /trainings/:id',
  'DELETE /trainings/:id',
  'GET /vacations/me',
  'GET /vacations/overview',
  'GET /vacations/calendar',
  'POST /vacations',
  'GET /vacations/requests',
  'POST /vacations/:id/approve',
  'POST /vacations/:id/reject',
  'PUT /vacations/:id',
  'DELETE /vacations/:id',
];

const routeCoverage = new Set();
const results = [];

const credentials = {
  collaborator: readCredentials(
    'SMB_TEST_COLLABORATOR_USERNAME',
    'SMB_TEST_COLLABORATOR_PASSWORD',
    { username: 'ana', password: 'user123' },
  ),
  reviewer: readCredentials(
    'SMB_TEST_REVIEWER_USERNAME',
    'SMB_TEST_REVIEWER_PASSWORD',
    { username: 't.people', password: 'people123' },
  ),
  admin: readCredentials(
    'SMB_TEST_ADMIN_USERNAME',
    'SMB_TEST_ADMIN_PASSWORD',
    { username: 't.people', password: 'people123' },
  ),
};

function isTruthy(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value ?? '').trim().toLowerCase());
}

function readCredentials(usernameKey, passwordKey, fallback) {
  const username = process.env[usernameKey]?.trim();
  const password = process.env[passwordKey]?.trim();
  if (username && password) {
    return { username, password };
  }

  return fallback ?? null;
}

function nowIso() {
  return new Date().toISOString();
}

function log(event) {
  console.log(JSON.stringify({ ts: nowIso(), ...event }));
}

function summarizeBody(body) {
  if (Array.isArray(body)) {
    return { kind: 'array', length: body.length };
  }

  if (body && typeof body === 'object') {
    return { kind: 'object', keys: Object.keys(body).slice(0, 14) };
  }

  return { kind: typeof body, value: body == null ? null : String(body) };
}

function addResult(entry) {
  results.push(entry);
}

async function requestJson({ path, method = 'GET', token, body, expectedStatuses = [200], label, routeKey }) {
  const url = path.startsWith('http') ? path : `${apiBaseUrl}${path}`;
  const startedAt = Date.now();

  const response = await fetch(url, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const rawText = await response.text();
  let parsedBody = null;

  if (rawText) {
    try {
      parsedBody = JSON.parse(rawText);
    } catch {
      parsedBody = rawText;
    }
  }

  const durationMs = Date.now() - startedAt;
  log({
    level: response.ok ? 'info' : 'error',
    event: 'http',
    label,
    method,
    url,
    status: response.status,
    durationMs,
    routeKey,
    response: summarizeBody(parsedBody),
  });

  if (!expectedStatuses.includes(response.status)) {
    const detail = typeof parsedBody === 'object' && parsedBody !== null
      ? JSON.stringify(parsedBody)
      : String(parsedBody || '');
    throw new Error(`${label || method} falhou com status ${response.status}. ${detail}`);
  }

  if (routeKey) {
    routeCoverage.add(routeKey);
  }

  return parsedBody;
}

async function requestFormData({ path, token, formData, expectedStatuses = [201], label, routeKey }) {
  const url = `${apiBaseUrl}${path}`;
  const startedAt = Date.now();

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: formData,
  });

  const parsedBody = await response.json().catch(() => null);
  const durationMs = Date.now() - startedAt;

  log({
    level: response.ok ? 'info' : 'error',
    event: 'http',
    label,
    method: 'POST',
    url,
    status: response.status,
    durationMs,
    routeKey,
    response: summarizeBody(parsedBody),
  });

  if (!expectedStatuses.includes(response.status)) {
    throw new Error(`${label || 'POST form-data'} falhou com status ${response.status}.`);
  }

  if (routeKey) {
    routeCoverage.add(routeKey);
  }

  return parsedBody;
}

async function runStep(suite, step, fn) {
  const startedAt = Date.now();
  log({ level: 'info', event: 'step:start', suite, step });

  try {
    const value = await fn();
    const durationMs = Date.now() - startedAt;
    log({ level: 'info', event: 'step:pass', suite, step, durationMs, result: summarizeBody(value) });
    addResult({ suite, step, status: 'passed', durationMs });
    return value;
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    const message = error instanceof Error ? error.message : String(error);
    log({ level: 'error', event: 'step:fail', suite, step, durationMs, message });
    addResult({ suite, step, status: 'failed', durationMs, message });
    return null;
  }
}

async function login(label, creds) {
  assert.ok(creds, `${label}: credenciais em falta.`);

  const payload = await requestJson({
    label: `${label} login`,
    path: '/auth/login',
    method: 'POST',
    body: creds,
    routeKey: 'POST /auth/login',
  });

  assert.ok(payload && payload.token && payload.user, `${label}: resposta de login inválida.`);
  return payload;
}

function addDays(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function uniqueSuffix() {
  return `${Date.now()}${Math.floor(Math.random() * 1000)}`;
}

async function main() {
  log({ level: 'info', event: 'suite:start', backendBaseUrl, apiBaseUrl, runMutations });

  await runStep('health', 'health check', async () => requestJson({
    label: 'health',
    path: `${backendBaseUrl}/health`,
    routeKey: 'GET /health',
  }));

  const adminSession = await runStep('auth', 'admin login', async () => login('admin', credentials.admin));
  const reviewerSession = await runStep('auth', 'reviewer login', async () => login('reviewer', credentials.reviewer || credentials.admin));

  if (!adminSession || !reviewerSession) {
    throw new Error('Falha no login base (admin/reviewer) para executar a suite completa.');
  }

  const adminToken = adminSession.token;
  const reviewerToken = reviewerSession.token;

  const bootstrapTeamName = `QA Team ${uniqueSuffix()}`;
  const bootstrapTeam = await runStep('admin', 'create bootstrap team', () => requestJson({
    label: 'create bootstrap team',
    path: '/admin/teams',
    method: 'POST',
    token: adminToken,
    body: {
      name: bootstrapTeamName,
      country: 'PT',
      memberIds: [],
    },
    routeKey: 'POST /admin/teams',
    expectedStatuses: [201],
  }));

  if (!bootstrapTeam?.id) {
    throw new Error('Falha ao criar equipa bootstrap.');
  }

  const teamId = bootstrapTeam.id;
  let collaboratorSession = await runStep('auth', 'collaborator login', async () => {
    const payload = await requestJson({
      label: 'collaborator login',
      path: '/auth/login',
      method: 'POST',
      body: credentials.collaborator,
      routeKey: 'POST /auth/login',
      expectedStatuses: [200, 401],
    });

    if (payload?.token && payload?.user) {
      return payload;
    }

    return null;
  });
  let provisionedCollaboratorId = null;
  let collaboratorPassword = credentials.collaborator?.password || '';

  if (!collaboratorSession) {
    const provisionSuffix = uniqueSuffix();
    const provisionUsername = `smoke.collab${provisionSuffix}`;
    const provisionPassword = 'Smoke123!';

    const provisioned = await runStep('auth', 'provision collaborator user', () => requestJson({
      label: 'provision collaborator user',
      path: '/users',
      method: 'POST',
      token: adminToken,
      body: {
        fullName: `Smoke Collaborator ${provisionSuffix}`,
        username: provisionUsername,
        email: `smoke.collab${provisionSuffix}@example.com`,
        password: provisionPassword,
        role: 'COLABORADOR',
        teamId,
      },
      routeKey: 'POST /users',
      expectedStatuses: [201],
    }));

    if (!provisioned?.id) {
      throw new Error('Não foi possível provisionar colaborador temporário.');
    }

    provisionedCollaboratorId = provisioned.id;
    collaboratorPassword = provisionPassword;
    collaboratorSession = await runStep('auth', 'collaborator login (provisioned)', async () => login('collaborator-provisioned', {
      username: provisionUsername,
      password: provisionPassword,
    }));
  }

  if (!collaboratorSession) {
    throw new Error('Falha no login de colaborador para executar a suite completa.');
  }

  const collaboratorToken = collaboratorSession.token;

  await runStep('auth', 'auth/me admin', () => requestJson({ label: 'auth/me admin', path: '/auth/me', token: adminToken, routeKey: 'GET /auth/me' }));
  await runStep('auth', 'auth/account collaborator', () => requestJson({
    label: 'auth/account collaborator',
    path: '/auth/account',
    method: 'PATCH',
    token: collaboratorToken,
    body: {
      username: collaboratorSession.user.username,
      currentPassword: collaboratorPassword,
    },
    routeKey: 'PATCH /auth/account',
  }));

  const collaboratorTeams = await runStep('users', 'users/me/teams collaborator', () => requestJson({
    label: 'users/me/teams collaborator',
    path: '/users/me/teams',
    token: collaboratorToken,
    routeKey: 'GET /users/me/teams',
  }));

  const contextTeamId = Array.isArray(collaboratorTeams) && collaboratorTeams[0]
    ? (collaboratorTeams[0].teamId || collaboratorTeams[0].id)
    : teamId;

  await runStep('users', 'users list', () => requestJson({ label: 'users list', path: '/users?limit=10', token: adminToken, routeKey: 'GET /users' }));
  await runStep('users', 'users collaborators', () => requestJson({ label: 'users collaborators', path: '/users/collaborators?page=1&pageSize=10', token: adminToken, routeKey: 'GET /users/collaborators' }));
  await runStep('users', 'teams visible list', () => requestJson({ label: 'teams visible list', path: '/teams', token: adminToken, routeKey: 'GET /teams' }));
  await runStep('users', 'teams me list', () => requestJson({ label: 'teams me list', path: '/teams/me', token: adminToken, routeKey: 'GET /teams/me' }));

  await runStep('admin', 'admin teams', () => requestJson({ label: 'admin teams', path: '/admin/teams', token: adminToken, routeKey: 'GET /admin/teams' }));
  await runStep('admin', 'patch team', () => requestJson({
    label: 'patch team',
    path: `/admin/teams/${teamId}`,
    method: 'PATCH',
    token: adminToken,
    body: { name: `${bootstrapTeamName} Updated` },
    routeKey: 'PATCH /admin/teams/:id',
  }));
  await runStep('admin', 'teams me details by id', () => requestJson({
    label: 'teams me details by id',
    path: `/teams/me/${teamId}`,
    token: adminToken,
    routeKey: 'GET /teams/me/:teamId',
  }));

  const userSuffix = uniqueSuffix();
  const createdUser = await runStep('admin', 'create user', () => requestJson({
    label: 'create user',
    path: '/users',
    method: 'POST',
    token: adminToken,
    body: {
      fullName: `Smoke User ${userSuffix}`,
      username: `smoke.user${userSuffix}`,
      email: `smoke.user${userSuffix}@example.com`,
      password: 'Smoke123!',
      role: 'COLABORADOR',
      teamId,
    },
    routeKey: 'POST /users',
    expectedStatuses: [201],
  }));

  if (!createdUser?.id) {
    throw new Error('Falha ao criar utilizador temporário.');
  }

  const targetUserId = createdUser.id;

  await runStep('admin', 'admin users', () => requestJson({ label: 'admin users', path: '/admin/users', token: adminToken, routeKey: 'GET /admin/users' }));

  await runStep('admin', 'patch admin user profile', () => requestJson({
    label: 'patch admin user profile',
    path: `/admin/users/${targetUserId}`,
    method: 'PATCH',
    token: adminToken,
    body: {
      role: 'COLABORADOR',
      teamId,
      workCountry: 'PT',
      localidade: 'Porto',
      isActive: true,
    },
    routeKey: 'PATCH /admin/users/:id',
  }));

  const updatedUsername = `smoke.userx${userSuffix}`;
  await runStep('admin', 'patch admin user credentials', () => requestJson({
    label: 'patch admin user credentials',
    path: `/admin/users/${targetUserId}/credentials`,
    method: 'PATCH',
    token: adminToken,
    body: {
      username: updatedUsername,
      password: 'Smoke123!',
    },
    routeKey: 'PATCH /admin/users/:id/credentials',
  }));

  await runStep('admin', 'patch admin user memberships', () => requestJson({
    label: 'patch admin user memberships',
    path: `/admin/users/${targetUserId}/memberships`,
    method: 'PATCH',
    token: adminToken,
    body: {
      memberships: [{ teamId, membershipRole: 'PARTICIPANT', isApprover: false, isActive: true }],
    },
    routeKey: 'PATCH /admin/users/:id/memberships',
  }));

  await runStep('users', 'manager patch team member', () => requestJson({
    label: 'manager patch team member',
    path: `/manager/team-members/${targetUserId}`,
    method: 'PATCH',
    token: adminToken,
    body: {
      teamId,
      cargo: 'Analista QA',
      funcao: 'Automação',
    },
    routeKey: 'PATCH /manager/team-members/:id',
  }));

  await runStep('users', 'deactivate user', () => requestJson({
    label: 'deactivate user',
    path: `/users/${targetUserId}/active`,
    method: 'PATCH',
    token: adminToken,
    body: { isActive: false },
    routeKey: 'PATCH /users/:id/active',
  }));

  await runStep('users', 'reactivate user', () => requestJson({
    label: 'reactivate user',
    path: `/users/${targetUserId}/active`,
    method: 'PATCH',
    token: adminToken,
    body: { isActive: true },
    routeKey: 'PATCH /users/:id/active',
  }));

  await runStep('profile', 'get profile me', () => requestJson({ label: 'profile me', path: '/profile/me', token: collaboratorToken, routeKey: 'GET /profile/me' }));
  await runStep('profile', 'get profile requests me', () => requestJson({ label: 'profile requests me', path: '/profile/requests/me', token: collaboratorToken, routeKey: 'GET /profile/requests/me' }));

  const firstProfileChange = await runStep('profile', 'submit profile request (approve path)', () => requestJson({
    label: 'submit profile request 1',
    path: '/profile/me',
    method: 'PUT',
    token: collaboratorToken,
    body: { nomeAbreviado: `Perfil QA ${uniqueSuffix()}` },
    routeKey: 'PUT /profile/me',
  }));

  if (firstProfileChange) {
    const pendingRequests = await runStep('profile', 'list profile requests', () => requestJson({
      label: 'list profile requests',
      path: '/profile/requests',
      token: reviewerToken,
      routeKey: 'GET /profile/requests',
    }));

    const toApprove = Array.isArray(pendingRequests)
      ? pendingRequests.find((item) => item.userId === collaboratorSession.user.id && item.status === 'PENDING')
      : null;

    if (toApprove) {
      await runStep('profile', 'approve profile request', () => requestJson({
        label: 'approve profile request',
        path: `/profile/requests/${toApprove.id}/approve`,
        method: 'POST',
        token: reviewerToken,
        routeKey: 'POST /profile/requests/:id/approve',
      }));
    }
  }

  const secondProfileChange = await runStep('profile', 'submit profile request (reject path)', () => requestJson({
    label: 'submit profile request 2',
    path: '/profile/me',
    method: 'PUT',
    token: collaboratorToken,
    body: { nomeAbreviado: `Perfil QB ${uniqueSuffix()}` },
    routeKey: 'PUT /profile/me',
  }));

  if (secondProfileChange) {
    const pendingRequests = await requestJson({
      label: 'list profile requests 2',
      path: '/profile/requests',
      token: reviewerToken,
      routeKey: 'GET /profile/requests',
    });

    const toReject = Array.isArray(pendingRequests)
      ? pendingRequests.find((item) => item.userId === collaboratorSession.user.id && item.status === 'PENDING')
      : null;

    if (toReject) {
      await runStep('profile', 'reject profile request', () => requestJson({
        label: 'reject profile request',
        path: `/profile/requests/${toReject.id}/reject`,
        method: 'POST',
        token: reviewerToken,
        body: { reason: 'Smoke rejection.' },
        routeKey: 'POST /profile/requests/:id/reject',
      }));
    }
  }

  await runStep('notifications', 'list notifications', () => requestJson({
    label: 'notifications me',
    path: '/notifications/me',
    token: collaboratorToken,
    routeKey: 'GET /notifications/me',
  }));

  await runStep('notifications', 'mark all read', () => requestJson({
    label: 'notifications read all',
    path: '/notifications/read-all',
    method: 'PATCH',
    token: collaboratorToken,
    routeKey: 'PATCH /notifications/read-all',
  }));

  const notificationsAfterReadAll = await requestJson({
    label: 'notifications after read-all',
    path: '/notifications/me',
    token: collaboratorToken,
    routeKey: 'GET /notifications/me',
  });

  if (Array.isArray(notificationsAfterReadAll) && notificationsAfterReadAll[0]) {
    const notificationId = notificationsAfterReadAll[0].id;
    await runStep('notifications', 'mark notification read', () => requestJson({
      label: 'mark notification read',
      path: `/notifications/${notificationId}/read`,
      method: 'PATCH',
      token: collaboratorToken,
      routeKey: 'PATCH /notifications/:id/read',
    }));

    await runStep('notifications', 'delete notification', () => requestJson({
      label: 'delete notification',
      path: `/notifications/${notificationId}`,
      method: 'DELETE',
      token: collaboratorToken,
      routeKey: 'DELETE /notifications/:id',
    }));
  }

  await runStep('trainings', 'create own training', () => requestJson({
    label: 'create own training',
    path: '/trainings',
    method: 'POST',
    token: collaboratorToken,
    body: {
      nome: `Formação Smoke ${uniqueSuffix()}`,
      link: '',
      horas: 2,
      duracao: '2h',
      entidade: 'QA Academy',
      dataConclusao: addDays(1),
    },
    routeKey: 'POST /trainings',
    expectedStatuses: [201],
  }));

  const trainingsMe = await runStep('trainings', 'list trainings me', () => requestJson({
    label: 'list trainings me',
    path: '/trainings/me',
    token: collaboratorToken,
    routeKey: 'GET /trainings/me',
  }));

  if (Array.isArray(trainingsMe) && trainingsMe[0]) {
    const trainingId = trainingsMe[0].id;
    await runStep('trainings', 'update own training', () => requestJson({
      label: 'update own training',
      path: `/trainings/${trainingId}`,
      method: 'PUT',
      token: collaboratorToken,
      body: {
        nome: `Formação Smoke Atualizada ${uniqueSuffix()}`,
        link: '',
        horas: 3,
        duracao: '3h',
        entidade: 'QA Academy',
        dataConclusao: addDays(2),
      },
      routeKey: 'PUT /trainings/:id',
    }));

    await runStep('trainings', 'delete own training', () => requestJson({
      label: 'delete own training',
      path: `/trainings/${trainingId}`,
      method: 'DELETE',
      token: collaboratorToken,
      routeKey: 'DELETE /trainings/:id',
    }));
  }

  const assignedTraining = await runStep('trainings', 'assign training', () => requestJson({
    label: 'assign training',
    path: '/trainings/assign',
    method: 'POST',
    token: adminToken,
    body: {
      userId: collaboratorSession.user.id,
      nome: `Atribuída Smoke ${uniqueSuffix()}`,
      link: '',
      horas: 1,
      duracao: '1h',
      entidade: 'RH',
    },
    routeKey: 'POST /trainings/assign',
    expectedStatuses: [201],
  }));

  await runStep('trainings', 'list trainings assigned', () => requestJson({
    label: 'list trainings assigned',
    path: '/trainings/assigned',
    token: adminToken,
    routeKey: 'GET /trainings/assigned',
  }));

  if (assignedTraining?.id) {
    await runStep('trainings', 'complete assigned training', () => requestJson({
      label: 'complete assigned training',
      path: `/trainings/${assignedTraining.id}/complete`,
      method: 'POST',
      token: collaboratorToken,
      routeKey: 'POST /trainings/:id/complete',
      expectedStatuses: [200, 403],
    }));
  }

  await runStep('vacations', 'vacations me', () => requestJson({ label: 'vacations me', path: '/vacations/me', token: collaboratorToken, routeKey: 'GET /vacations/me' }));
  await runStep('vacations', 'vacations overview', () => requestJson({ label: 'vacations overview', path: '/vacations/overview', token: collaboratorToken, routeKey: 'GET /vacations/overview' }));
  await runStep('vacations', 'vacations calendar', () => requestJson({ label: 'vacations calendar', path: '/vacations/calendar', token: collaboratorToken, routeKey: 'GET /vacations/calendar' }));

  let vacationRequestForApprove = null;
  let vacationRequestForReject = null;
  let vacationRequestForUpdateDelete = null;

  if (runMutations && contextTeamId) {
    vacationRequestForApprove = await runStep('vacations', 'create vacation request for approve', () => requestJson({
      label: 'create vacation request approve',
      path: '/vacations',
      method: 'POST',
      token: collaboratorToken,
      body: {
        dataInicio: addDays(20),
        dataFim: addDays(21),
        observacoes: 'Smoke approve',
        requestType: 'ABSENCE_TRAINING',
        attachmentLink: '',
        contextTeamId,
        partialDay: 'FULL',
      },
      routeKey: 'POST /vacations',
      expectedStatuses: [201],
    }));

    vacationRequestForReject = await runStep('vacations', 'create vacation request for reject', () => requestJson({
      label: 'create vacation request reject',
      path: '/vacations',
      method: 'POST',
      token: collaboratorToken,
      body: {
        dataInicio: addDays(24),
        dataFim: addDays(25),
        observacoes: 'Smoke reject',
        requestType: 'ABSENCE_MEDICAL',
        attachmentLink: '',
        contextTeamId,
        partialDay: 'FULL',
      },
      routeKey: 'POST /vacations',
      expectedStatuses: [201],
    }));

    vacationRequestForUpdateDelete = await runStep('vacations', 'create vacation request for update/delete', () => requestJson({
      label: 'create vacation request update delete',
      path: '/vacations',
      method: 'POST',
      token: collaboratorToken,
      body: {
        dataInicio: addDays(28),
        dataFim: addDays(28),
        observacoes: 'Smoke update delete',
        requestType: 'ABSENCE_TRAINING',
        attachmentLink: '',
        contextTeamId,
        partialDay: 'FULL',
      },
      routeKey: 'POST /vacations',
      expectedStatuses: [201],
    }));
  }

  await runStep('vacations', 'list vacations requests', () => requestJson({ label: 'vacations requests', path: '/vacations/requests', token: reviewerToken, routeKey: 'GET /vacations/requests' }));

  if (vacationRequestForApprove?.id) {
    await runStep('vacations', 'approve vacation request', () => requestJson({
      label: 'approve vacation request',
      path: `/vacations/${vacationRequestForApprove.id}/approve`,
      method: 'POST',
      token: reviewerToken,
      routeKey: 'POST /vacations/:id/approve',
    }));
  }

  if (vacationRequestForReject?.id) {
    await runStep('vacations', 'reject vacation request', () => requestJson({
      label: 'reject vacation request',
      path: `/vacations/${vacationRequestForReject.id}/reject`,
      method: 'POST',
      token: reviewerToken,
      body: { reason: 'Smoke rejection' },
      routeKey: 'POST /vacations/:id/reject',
    }));
  }

  if (vacationRequestForUpdateDelete?.id) {
    const updatedVacation = await runStep('vacations', 'update vacation request', () => requestJson({
      label: 'update vacation request',
      path: `/vacations/${vacationRequestForUpdateDelete.id}`,
      method: 'PUT',
      token: collaboratorToken,
      body: {
        dataInicio: addDays(29),
        dataFim: addDays(29),
        observacoes: 'Smoke versioned',
        requestType: 'ABSENCE_TRAINING',
        attachmentLink: '',
        contextTeamId,
        partialDay: 'FULL',
      },
      routeKey: 'PUT /vacations/:id',
    }));

    if (updatedVacation?.id) {
      await runStep('vacations', 'delete vacation request', () => requestJson({
        label: 'delete vacation request',
        path: `/vacations/${updatedVacation.id}`,
        method: 'DELETE',
        token: collaboratorToken,
        routeKey: 'DELETE /vacations/:id',
      }));
    }
  }

  const permissionsCatalog = await runStep('permissions', 'permissions catalog', () => requestJson({
    label: 'permissions catalog',
    path: '/permissions',
    token: adminToken,
    routeKey: 'GET /permissions',
  }));

  const chosenPermission = Array.isArray(permissionsCatalog?.permissions)
    ? permissionsCatalog.permissions.find((item) => item.code === targetPermissionCode) || permissionsCatalog.permissions[0]
    : null;

  await runStep('permissions', 'user permissions get', () => requestJson({
    label: 'user permissions get',
    path: `/users/${targetUserId}/permissions`,
    token: adminToken,
    routeKey: 'GET /users/:id/permissions',
  }));

  if (chosenPermission?.id) {
    await runStep('permissions', 'user permissions post', () => requestJson({
      label: 'user permissions post',
      path: `/users/${targetUserId}/permissions`,
      method: 'POST',
      token: adminToken,
      body: {
        permissionId: chosenPermission.id,
        isEnabled: true,
        notes: 'Smoke assign',
        reason: 'Smoke assign',
      },
      routeKey: 'POST /users/:id/permissions',
    }));

    await runStep('permissions', 'user permissions patch', () => requestJson({
      label: 'user permissions patch',
      path: `/users/${targetUserId}/permissions/${chosenPermission.id}`,
      method: 'PATCH',
      token: adminToken,
      body: {
        isEnabled: true,
        notes: 'Smoke patch',
        reason: 'Smoke patch',
        restrictedToCountries: ['PT'],
      },
      routeKey: 'PATCH /users/:id/permissions/:permissionId',
      expectedStatuses: [200, 400],
    }));

    await runStep('permissions', 'user permissions delete', () => requestJson({
      label: 'user permissions delete',
      path: `/users/${targetUserId}/permissions/${chosenPermission.id}`,
      method: 'DELETE',
      token: adminToken,
      routeKey: 'DELETE /users/:id/permissions/:permissionId',
    }));
  }

  await runStep('permissions', 'access total grant', () => requestJson({
    label: 'access total grant',
    path: `/users/${targetUserId}/access-total`,
    method: 'PATCH',
    token: adminToken,
    body: { isEnabled: true, reason: 'Smoke grant' },
    routeKey: 'PATCH /users/:id/access-total',
  }));

  await runStep('permissions', 'access total revoke', () => requestJson({
    label: 'access total revoke',
    path: `/users/${targetUserId}/access-total`,
    method: 'PATCH',
    token: adminToken,
    body: { isEnabled: false, reason: 'Smoke revoke' },
    routeKey: 'PATCH /users/:id/access-total',
  }));

  await runStep('permissions', 'audit permission grants', () => requestJson({
    label: 'audit permission grants',
    path: `/audit/permission-grants?userId=${targetUserId}&limit=20&offset=0`,
    token: adminToken,
    routeKey: 'GET /audit/permission-grants',
  }));

  await runStep('files', 'upload file', () => {
    const formData = new FormData();
    const content = new Blob(['smoke file'], { type: 'text/plain' });
    formData.append('file', content, 'smoke.txt');

    return requestFormData({
      label: 'upload file',
      path: '/files/upload',
      token: collaboratorToken,
      formData,
      routeKey: 'POST /files/upload',
      expectedStatuses: [201],
    });
  });

  await runStep('receipts', 'receipts placeholder route', () => requestJson({
    label: 'receipts placeholder route',
    path: '/receipts',
    token: adminToken,
    expectedStatuses: [410, 501],
    routeKey: 'ALL /receipts',
  }));

  await runStep('cleanup', 'detach team from temp user', () => requestJson({
    label: 'detach team from temp user',
    path: `/admin/users/${targetUserId}`,
    method: 'PATCH',
    token: adminToken,
    body: { teamId: null, isActive: true },
    routeKey: 'PATCH /admin/users/:id',
  }));

  await runStep('cleanup', 'delete temp team', () => requestJson({
    label: 'delete temp team',
    path: `/admin/teams/${teamId}`,
    method: 'DELETE',
    token: adminToken,
    routeKey: 'DELETE /admin/teams/:id',
  }));

  await runStep('cleanup', 'deactivate temp user', () => requestJson({
    label: 'deactivate temp user',
    path: `/users/${targetUserId}/active`,
    method: 'PATCH',
    token: adminToken,
    body: { isActive: false },
    routeKey: 'PATCH /users/:id/active',
  }));

  if (provisionedCollaboratorId) {
    await runStep('cleanup', 'deactivate provisioned collaborator', () => requestJson({
      label: 'deactivate provisioned collaborator',
      path: `/users/${provisionedCollaboratorId}/active`,
      method: 'PATCH',
      token: adminToken,
      body: { isActive: false },
      routeKey: 'PATCH /users/:id/active',
    }));
  }

  const missingRoutes = ROUTE_KEYS.filter((key) => !routeCoverage.has(key));
  if (missingRoutes.length > 0) {
    log({ level: 'error', event: 'coverage:missing-routes', missingRoutes });
  } else {
    log({ level: 'info', event: 'coverage:complete', covered: routeCoverage.size });
  }

  const failed = results.filter((item) => item.status === 'failed');
  const passed = results.filter((item) => item.status === 'passed');

  log({
    level: failed.length > 0 || missingRoutes.length > 0 ? 'error' : 'info',
    event: 'suite:summary',
    passed: passed.length,
    failed: failed.length,
    totalRoutes: ROUTE_KEYS.length,
    coveredRoutes: routeCoverage.size,
    missingRoutes: missingRoutes.length,
  });

  if (failed.length > 0 || missingRoutes.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  log({ level: 'error', event: 'fatal', message: error instanceof Error ? error.message : String(error) });
  process.exitCode = 1;
});