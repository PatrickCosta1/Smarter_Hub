import assert from 'node:assert/strict';

const backendBaseUrl = (process.env.SMB_BACKEND_URL || 'http://localhost:4000').replace(/\/$/, '');
const apiBaseUrl = `${backendBaseUrl}/api`;
const runMutations = isTruthy(process.env.SMB_SMOKE_MUTATIONS);
const profileAction = (process.env.SMB_PROFILE_ACTION || 'reject').toLowerCase();
const vacationAction = (process.env.SMB_VACATION_ACTION || 'approve').toLowerCase();
const vacationRequestType = (process.env.SMB_VACATION_REQUEST_TYPE || 'ABSENCE_TRAINING').toUpperCase();
const targetPermissionCode = process.env.SMB_TEST_PERMISSION_CODE?.trim();

const credentials = {
  collaborator: readCredentials('SMB_TEST_COLLABORATOR_USERNAME', 'SMB_TEST_COLLABORATOR_PASSWORD'),
  reviewer: readCredentials('SMB_TEST_REVIEWER_USERNAME', 'SMB_TEST_REVIEWER_PASSWORD'),
  admin: readCredentials('SMB_TEST_ADMIN_USERNAME', 'SMB_TEST_ADMIN_PASSWORD'),
};

const results = [];

function isTruthy(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value ?? '').trim().toLowerCase());
}

function readCredentials(usernameKey, passwordKey) {
  const username = process.env[usernameKey]?.trim();
  const password = process.env[passwordKey]?.trim();

  if (!username || !password) {
    return null;
  }

  return { username, password };
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
    return { kind: 'object', keys: Object.keys(body).slice(0, 12) };
  }

  return { kind: typeof body, value: body == null ? null : String(body) };
}

function addResult(entry) {
  results.push(entry);
}

async function requestJson({ path, method = 'GET', token, body, expectedStatuses = [200], label }) {
  const url = path.startsWith('http') ? path : `${apiBaseUrl}${path}`;
  const startedAt = Date.now();
  const response = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
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

  const summary = summarizeBody(parsedBody);
  const durationMs = Date.now() - startedAt;

  log({
    level: response.ok ? 'info' : 'error',
    event: 'http',
    label,
    method,
    url,
    status: response.status,
    durationMs,
    response: summary,
  });

  if (!expectedStatuses.includes(response.status)) {
    const detail = typeof parsedBody === 'object' && parsedBody !== null
      ? JSON.stringify(parsedBody)
      : String(parsedBody || '');

    throw new Error(`${label || method} falhou com status ${response.status}. ${detail}`);
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
    expectedStatuses: [200],
  });

  assert.ok(payload && typeof payload === 'object' && 'token' in payload, `${label}: token em falta na resposta de login.`);
  assert.ok('user' in payload, `${label}: utilizador em falta na resposta de login.`);

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

async function runReadOnlySuite(name, creds, checks) {
  if (!creds) {
    log({ level: 'warn', event: 'suite:skip', suite: name, reason: 'credenciais em falta' });
    return;
  }

  const session = await runStep(name, 'login', async () => login(name, creds));
  if (!session) {
    return;
  }

  const token = session.token;
  const userId = session.user.id;

  await runStep(name, 'auth/me', () => requestJson({ label: `${name} auth/me`, path: '/auth/me', token }));
  await runStep(name, 'notifications/me', () => requestJson({ label: `${name} notifications/me`, path: '/notifications/me', token }));
  await runStep(name, 'permissions', () => requestJson({ label: `${name} permissions`, path: '/permissions', token }));

  if (checks.profile) {
    await runStep(name, 'profile/me', () => requestJson({ label: `${name} profile/me`, path: '/profile/me', token }));
    await runStep(name, 'profile/requests/me', () => requestJson({ label: `${name} profile/requests/me`, path: '/profile/requests/me', token }));
  }

  if (checks.teams) {
    await runStep(name, 'users/me/teams', () => requestJson({ label: `${name} users/me/teams`, path: '/users/me/teams', token }));
  }

  if (checks.vacations) {
    await runStep(name, 'vacations/me', () => requestJson({ label: `${name} vacations/me`, path: '/vacations/me', token }));
    await runStep(name, 'vacations/overview', () => requestJson({ label: `${name} vacations/overview`, path: '/vacations/overview', token }));
    await runStep(name, 'vacations/calendar', () => requestJson({ label: `${name} vacations/calendar`, path: '/vacations/calendar', token }));
  }

  if (checks.approvals) {
    await runStep(name, 'profile/requests', () => requestJson({ label: `${name} profile/requests`, path: '/profile/requests', token }));
    await runStep(name, 'vacations/requests', () => requestJson({ label: `${name} vacations/requests`, path: '/vacations/requests', token }));
  }

  if (checks.admin) {
    await runStep(name, 'admin/users', () => requestJson({ label: `${name} admin/users`, path: '/admin/users', token }));
    await runStep(name, 'admin/teams', () => requestJson({ label: `${name} admin/teams`, path: '/admin/teams', token }));
    await runStep(name, 'users/collaborators', () => requestJson({ label: `${name} users/collaborators`, path: '/users/collaborators?page=1&pageSize=5', token }));
    await runStep(name, 'users/self/permissions', () => requestJson({ label: `${name} users/self/permissions`, path: `/users/${userId}/permissions`, token }));
  }
}

async function runProfileMutationSuite() {
  if (!runMutations) {
    log({ level: 'warn', event: 'suite:skip', suite: 'profile-mutation', reason: 'SMB_SMOKE_MUTATIONS desativado' });
    return;
  }

  if (!credentials.collaborator || !credentials.reviewer) {
    log({ level: 'warn', event: 'suite:skip', suite: 'profile-mutation', reason: 'faltam credenciais de colaborador e reviewer' });
    return;
  }

  const collaboratorSession = await runStep('profile-mutation', 'collaborator login', async () => login('collaborator', credentials.collaborator));
  const reviewerSession = await runStep('profile-mutation', 'reviewer login', async () => login('reviewer', credentials.reviewer));
  if (!collaboratorSession || !reviewerSession) {
    return;
  }

  const collaboratorToken = collaboratorSession.token;
  const reviewerToken = reviewerSession.token;
  const collaboratorUser = collaboratorSession.user;

  const currentProfile = await runStep('profile-mutation', 'collaborator profile snapshot', async () => requestJson({ label: 'collaborator profile/me', path: '/profile/me', token: collaboratorToken }));
  if (!currentProfile) {
    return;
  }

  const nextShortName = `${String(currentProfile.nomeAbreviado || currentProfile.primeiroNome || collaboratorUser.username).trim()} QA`;
  const profileResponse = await runStep('profile-mutation', 'submit profile change request', async () => requestJson({
    label: 'submit profile change request',
    path: '/profile/me',
    method: 'PUT',
    token: collaboratorToken,
    body: { nomeAbreviado: nextShortName },
    expectedStatuses: [200],
  }));

  if (!profileResponse) {
    return;
  }

  const profileRequests = await runStep('profile-mutation', 'reviewer sees profile requests', async () => requestJson({
    label: 'reviewer profile/requests',
    path: '/profile/requests',
    token: reviewerToken,
  }));

  const profileRequest = Array.isArray(profileRequests)
    ? profileRequests.find((item) => item.userId === collaboratorUser.id && item.status === 'PENDING')
    : null;

  if (!profileRequest) {
    log({ level: 'error', event: 'assert', suite: 'profile-mutation', step: 'find profile request', message: 'Pedido pendente não encontrado.' });
  } else if (profileAction === 'approve') {
    await runStep('profile-mutation', 'approve profile request', async () => requestJson({
      label: 'approve profile request',
      path: `/profile/requests/${profileRequest.id}/approve`,
      method: 'POST',
      token: reviewerToken,
    }));
  } else {
    await runStep('profile-mutation', 'reject profile request', async () => requestJson({
      label: 'reject profile request',
      path: `/profile/requests/${profileRequest.id}/reject`,
      method: 'POST',
      token: reviewerToken,
      body: { reason: 'Smoke test rejection.' },
    }));
  }

  const collaboratorNotifications = await runStep('profile-mutation', 'collaborator notifications after review', async () => requestJson({
    label: 'collaborator notifications/me after profile review',
    path: '/notifications/me',
    token: collaboratorToken,
  }));

  const targetNotification = Array.isArray(collaboratorNotifications)
    ? collaboratorNotifications.find((item) => String(item.title || '').toLowerCase().includes('pedido de alteração de ficha'))
    : null;

  if (targetNotification) {
    await runStep('profile-mutation', 'mark notification read', async () => requestJson({
      label: 'mark notification read',
      path: `/notifications/${targetNotification.id}/read`,
      method: 'PATCH',
      token: collaboratorToken,
    }));

    await runStep('profile-mutation', 'delete notification', async () => requestJson({
      label: 'delete notification',
      path: `/notifications/${targetNotification.id}`,
      method: 'DELETE',
      token: collaboratorToken,
    }));
  }
}

async function runVacationMutationSuite() {
  if (!runMutations) {
    log({ level: 'warn', event: 'suite:skip', suite: 'vacation-mutation', reason: 'SMB_SMOKE_MUTATIONS desativado' });
    return;
  }

  if (!credentials.collaborator || !credentials.reviewer) {
    log({ level: 'warn', event: 'suite:skip', suite: 'vacation-mutation', reason: 'faltam credenciais de colaborador e reviewer' });
    return;
  }

  const collaboratorSession = await runStep('vacation-mutation', 'collaborator login', async () => login('collaborator', credentials.collaborator));
  const reviewerSession = await runStep('vacation-mutation', 'reviewer login', async () => login('reviewer', credentials.reviewer));
  if (!collaboratorSession || !reviewerSession) {
    return;
  }

  const collaboratorToken = collaboratorSession.token;
  const reviewerToken = reviewerSession.token;
  const collaboratorUser = collaboratorSession.user;

  const teams = await runStep('vacation-mutation', 'collaborator teams', async () => requestJson({
    label: 'collaborator users/me/teams',
    path: '/users/me/teams',
    token: collaboratorToken,
  }));

  if (!Array.isArray(teams) || teams.length === 0) {
    log({ level: 'warn', event: 'assert', suite: 'vacation-mutation', step: 'team lookup', message: 'Nenhuma equipa disponível para criar o pedido de férias.' });
    return;
  }

  const contextTeamId = teams[0].teamId || teams[0].id;
  const startDate = addDays(10);
  const endDate = addDays(12);

  const vacationCreated = await runStep('vacation-mutation', 'submit vacation request', async () => requestJson({
    label: 'submit vacation request',
    path: '/vacations',
    method: 'POST',
    token: collaboratorToken,
    body: {
      dataInicio: startDate,
      dataFim: endDate,
      observacoes: 'Smoke test de férias.',
      requestType: vacationRequestType,
      attachmentLink: '',
      contextTeamId,
      partialDay: 'FULL',
    },
    expectedStatuses: [201],
  }));

  if (!vacationCreated) {
    return;
  }

  const reviewerRequests = await runStep('vacation-mutation', 'reviewer sees vacation requests', async () => requestJson({
    label: 'reviewer vacations/requests',
    path: '/vacations/requests',
    token: reviewerToken,
  }));

  const vacationRequest = Array.isArray(reviewerRequests)
    ? reviewerRequests.find((item) => item.userId === collaboratorUser.id && item.dataInicio === startDate && item.dataFim === endDate && item.requestType === vacationRequestType && item.status === 'PENDING')
    : null;

  if (!vacationRequest) {
    log({ level: 'error', event: 'assert', suite: 'vacation-mutation', step: 'find vacation request', message: 'Pedido de férias pendente não encontrado.' });
    return;
  }

  if (vacationAction === 'reject') {
    await runStep('vacation-mutation', 'reject vacation request', async () => requestJson({
      label: 'reject vacation request',
      path: `/vacations/${vacationRequest.id}/reject`,
      method: 'POST',
      token: reviewerToken,
      body: { reason: 'Smoke test rejection.' },
    }));
  } else {
    await runStep('vacation-mutation', 'approve vacation request', async () => requestJson({
      label: 'approve vacation request',
      path: `/vacations/${vacationRequest.id}/approve`,
      method: 'POST',
      token: reviewerToken,
    }));
  }

  const collaboratorNotifications = await runStep('vacation-mutation', 'collaborator notifications after vacation review', async () => requestJson({
    label: 'collaborator notifications/me after vacation review',
    path: '/notifications/me',
    token: collaboratorToken,
  }));

  const targetNotification = Array.isArray(collaboratorNotifications)
    ? collaboratorNotifications.find((item) => String(item.title || '').toLowerCase().includes('pedido de férias') || String(item.title || '').toLowerCase().includes('pedido de ausência'))
    : null;

  if (targetNotification) {
    await runStep('vacation-mutation', 'mark vacation notification read', async () => requestJson({
      label: 'mark vacation notification read',
      path: `/notifications/${targetNotification.id}/read`,
      method: 'PATCH',
      token: collaboratorToken,
    }));

    await runStep('vacation-mutation', 'delete vacation notification', async () => requestJson({
      label: 'delete vacation notification',
      path: `/notifications/${targetNotification.id}`,
      method: 'DELETE',
      token: collaboratorToken,
    }));
  }
}

async function runAdminMutationSuite() {
  if (!runMutations) {
    return;
  }

  if (!credentials.admin) {
    log({ level: 'warn', event: 'suite:skip', suite: 'admin-mutation', reason: 'credenciais de admin em falta' });
    return;
  }

  const targetUserId = process.env.SMB_TEST_TARGET_USER_ID?.trim();
  const targetPermissionId = process.env.SMB_TEST_PERMISSION_ID?.trim();

  if (targetUserId && (targetPermissionId || targetPermissionCode)) {
    const adminSession = await runStep('admin-mutation', 'admin login', async () => login('admin', credentials.admin));
    if (!adminSession) {
      return;
    }

    const token = adminSession.token;
    let resolvedPermissionId = targetPermissionId || '';

    if (!resolvedPermissionId && targetPermissionCode) {
      const permissions = await runStep('admin-mutation', 'resolve permission code', async () => requestJson({
        label: 'resolve permission code',
        path: '/permissions',
        token,
      }));

      if (permissions && Array.isArray(permissions.permissions)) {
        const resolvedPermission = permissions.permissions.find((item) => item.code === targetPermissionCode);
        resolvedPermissionId = resolvedPermission?.id || '';
      }
    }

    if (!resolvedPermissionId) {
      log({ level: 'warn', event: 'suite:skip', suite: 'admin-mutation', reason: 'não foi possível resolver a permissão de teste' });
      return;
    }

    await runStep('admin-mutation', 'grant permission', async () => requestJson({
      label: 'grant permission',
      path: `/users/${targetUserId}/permissions`,
      method: 'POST',
      token,
      body: {
        permissionId: resolvedPermissionId,
        isEnabled: true,
        notes: 'Smoke test grant.',
        reason: 'Smoke test grant.',
      },
    }));

    await runStep('admin-mutation', 'verify granted permission', async () => requestJson({
      label: 'verify granted permission',
      path: `/users/${targetUserId}/permissions`,
      token,
    }));

    await runStep('admin-mutation', 'revoke permission', async () => requestJson({
      label: 'revoke permission',
      path: `/users/${targetUserId}/permissions/${resolvedPermissionId}`,
      method: 'DELETE',
      token,
    }));
  }
}

async function main() {
  log({ level: 'info', event: 'suite:start', backendBaseUrl, apiBaseUrl, runMutations, profileAction, vacationAction });

  await runStep('health', 'health check', async () => requestJson({
    label: 'health check',
    path: `${backendBaseUrl}/health`,
    expectedStatuses: [200],
  }));

  await runReadOnlySuite('collaborator-readonly', credentials.collaborator, { profile: true, vacations: true, teams: true, approvals: false, admin: false });
  await runReadOnlySuite('reviewer-readonly', credentials.reviewer, { profile: false, vacations: false, teams: false, approvals: true, admin: false });
  await runReadOnlySuite('admin-readonly', credentials.admin, { profile: false, vacations: false, teams: false, approvals: true, admin: true });

  await runProfileMutationSuite();
  await runVacationMutationSuite();
  await runAdminMutationSuite();

  const failed = results.filter((item) => item.status === 'failed');
  const passed = results.filter((item) => item.status === 'passed');

  log({
    level: failed.length > 0 ? 'error' : 'info',
    event: 'suite:summary',
    passed: passed.length,
    failed: failed.length,
    skipped: results.filter((item) => item.status === 'skipped').length,
  });

  if (failed.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  log({ level: 'error', event: 'fatal', message: error instanceof Error ? error.message : String(error) });
  process.exitCode = 1;
});