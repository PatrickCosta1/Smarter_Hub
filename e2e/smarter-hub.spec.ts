import { expect, Page, test, type TestInfo } from '@playwright/test';

test.describe.configure({ mode: 'serial' });

const API_BASE = process.env.SMB_E2E_API_BASE_URL || 'http://127.0.0.1:4000/api';

const ROOT_USERNAME = process.env.SMB_E2E_ROOT_USERNAME || 't.people';
const ROOT_PASSWORD = process.env.SMB_E2E_ROOT_PASSWORD || 'people123';

const collaboratorPassword = 'Qa123456!';

type ApiLoginResult = {
  token: string;
  user: {
    id: string;
    username: string;
  };
};

type Scenario = {
  collaborator: {
    id: string;
    username: string;
    password: string;
    email: string;
    fullName: string;
  };
  team: {
    id: string;
    name: string;
  };
  profileChangeFields: Array<{ key: string; value: string }>;
  vacationWindow: {
    start: string;
    end: string;
  } | null;
};

type CleanupTask = () => Promise<void>;

const cleanupRegistry = new WeakMap<TestInfo, CleanupTask[]>();

function registerCleanup(testInfo: TestInfo, task: CleanupTask) {
  const tasks = cleanupRegistry.get(testInfo) ?? [];
  tasks.push(task);
  cleanupRegistry.set(testInfo, tasks);
}

async function runCleanup(testInfo: TestInfo) {
  const tasks = cleanupRegistry.get(testInfo) ?? [];
  cleanupRegistry.delete(testInfo);

  for (const task of [...tasks].reverse()) {
    try {
      await task();
    } catch {
      // Cleanup should not mask the original test result.
    }
  }
}

test.afterEach(async ({}, testInfo) => {
  await runCleanup(testInfo);
});

async function apiLogin(username: string, password: string) {
  const response = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ username, password }),
  });

  if (!response.ok) {
    throw new Error(`Falha ao autenticar ${username}.`);
  }

  return response.json() as Promise<ApiLoginResult>;
}

async function apiRequest<T>(token: string, method: string, path: string, body?: unknown) {
  const response = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({} as { message?: string }));
    throw new Error(payload.message || `Falha em ${method} ${path}.`);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}

async function apiRequestRaw(token: string, method: string, path: string, body?: unknown) {
  return fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function toIsoDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function addDays(base: Date, days: number) {
  const next = new Date(base);
  next.setDate(next.getDate() + days);
  return next;
}

async function findVacationWindow(country: 'PT' | 'BR' = 'PT', businessDays = 2) {
  const startSearch = addDays(new Date(), 7);
  const endSearch = addDays(new Date(), 90);
  const years = Array.from(new Set([startSearch.getFullYear(), endSearch.getFullYear()]));

  const holidays = new Set<string>();
  for (const year of years) {
    const response = await fetch(`https://date.nager.at/api/v3/PublicHolidays/${year}/${country}`);
    if (!response.ok) {
      continue;
    }

    const payload = await response.json() as Array<{ date: string }>;
    payload.forEach((item) => holidays.add(item.date));
  }

  const cursor = new Date(startSearch);
  while (cursor <= endSearch) {
    const range: string[] = [];
    let isValid = true;

    for (let i = 0; i < businessDays; i += 1) {
      const day = addDays(cursor, i);
      const iso = toIsoDate(day);
      const weekday = day.getDay();
      if (weekday === 0 || weekday === 6 || holidays.has(iso)) {
        isValid = false;
        break;
      }

      range.push(iso);
    }

    if (isValid && range.length === businessDays) {
      return { start: range[0], end: range[range.length - 1] };
    }

    cursor.setDate(cursor.getDate() + 1);
  }

  throw new Error('Não foi possível encontrar um período válido para férias.');
}

async function login(page: Page, username: string, password: string) {
  const session = await apiLogin(username, password);

  await page.goto('/');
  await page.evaluate((token) => {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem('smarter_hub_auth_token', token);
  }, session.token);
  await page.goto('/');

  await expect(page.locator('.portal-header')).toBeVisible({ timeout: 20000 });
}

async function createScenario(options?: { includeVacationWindow?: boolean }, testInfo?: TestInfo) {
  const rootLogin = await apiLogin(ROOT_USERNAME, ROOT_PASSWORD);

  const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const teamName = `QA Team ${uniqueSuffix}`;
  const collaboratorUsername = `qa.user.${uniqueSuffix}`;
  const collaboratorEmail = `${collaboratorUsername}@smarterhub.test`;
  const collaboratorFullName = `QA Colaborador ${uniqueSuffix}`;

  const team = await apiRequest<{ id: string; name: string }>(rootLogin.token, 'POST', '/admin/teams', {
    name: teamName,
    leaderId: null,
    memberIds: [],
    parentTeamId: null,
  });

  const collaborator = await apiRequest<{ id: string }>(rootLogin.token, 'POST', '/users', {
    username: collaboratorUsername,
    password: collaboratorPassword,
    email: collaboratorEmail,
    fullName: collaboratorFullName,
    role: 'COLABORADOR',
    teamId: team.id,
    workCountry: 'BR',
  });

  if (testInfo) {
    registerCleanup(testInfo, async () => {
      await deleteUserAsRoot(collaborator.id);
    });
    registerCleanup(testInfo, async () => {
      await deleteTeamAsRoot(team.id);
    });
  }

  const profileChangeFields = [
    { key: 'primeiroNome', value: `QA ${uniqueSuffix}` },
    { key: 'apelido', value: `Apelido ${uniqueSuffix}` },
    { key: 'nomeAbreviado', value: `QA ${uniqueSuffix}` },
  ];

  const vacationWindow = options?.includeVacationWindow
    ? await findVacationWindow('BR', 5)
    : null;

  return {
    collaborator: {
      id: collaborator.id,
      username: collaboratorUsername,
      password: collaboratorPassword,
      email: collaboratorEmail,
      fullName: collaboratorFullName,
    },
    team,
    profileChangeFields,
    vacationWindow,
  } satisfies Scenario;
}

async function deleteUserAsRoot(userId: string) {
  const rootLogin = await apiLogin(ROOT_USERNAME, ROOT_PASSWORD);
  const response = await apiRequestRaw(rootLogin.token, 'DELETE', `/admin/users/${userId}`);

  if (!response.ok && response.status !== 404) {
    const payload = await response.json().catch(() => ({} as { message?: string }));
    throw new Error(payload.message || `Falha ao remover utilizador ${userId}.`);
  }
}

async function deleteTeamAsRoot(teamId: string) {
  const rootLogin = await apiLogin(ROOT_USERNAME, ROOT_PASSWORD);
  const response = await apiRequestRaw(rootLogin.token, 'DELETE', `/admin/teams/${teamId}`);

  if (!response.ok && response.status !== 404) {
    const payload = await response.json().catch(() => ({} as { message?: string }));
    throw new Error(payload.message || `Falha ao remover equipa ${teamId}.`);
  }
}

async function createUserAsRoot(params: {
  fullName: string;
  username: string;
  email: string;
  password: string;
  role?: 'COLABORADOR' | 'MANAGER' | 'COORDENADOR' | 'ADMIN' | 'CONVIDADO';
  workCountry?: 'PT' | 'BR';
}, testInfo?: TestInfo) {
  const rootLogin = await apiLogin(ROOT_USERNAME, ROOT_PASSWORD);
  const user = await apiRequest<{ id: string; username: string; email: string }>(rootLogin.token, 'POST', '/users', {
    fullName: params.fullName,
    username: params.username,
    email: params.email,
    password: params.password,
    role: params.role ?? 'COLABORADOR',
    workCountry: params.workCountry,
  });

  if (testInfo) {
    registerCleanup(testInfo, async () => {
      await deleteUserAsRoot(user.id);
    });
  }

  return user;
}

test('alteracao de ficha aparece no fluxo de aprovacoes e pode ser aprovada', async ({ page }, testInfo) => {
  test.setTimeout(60000);
  const scenario = await createScenario(undefined, testInfo);
  const collaboratorLogin = await apiLogin(scenario.collaborator.username, scenario.collaborator.password);

  await apiRequest(collaboratorLogin.token, 'PUT', '/profile/me', Object.fromEntries(scenario.profileChangeFields.map((item) => [item.key, item.value])));

  await login(page, ROOT_USERNAME, ROOT_PASSWORD);
  await page.goto('/aprovacoes');
  const rootSession = await apiLogin(ROOT_USERNAME, ROOT_PASSWORD);

  await expect(page.locator('.trainings-hero').getByRole('heading', { name: 'Aprovações' })).toBeVisible();

  await page.getByRole('button', { name: /Alterações de ficha/i }).click();
  const targetCard = page.locator('.rh-request-list .rh-profile-card').filter({ hasText: scenario.collaborator.fullName }).first();
  await expect(targetCard).toBeVisible({ timeout: 20000 });

  const profileRequests = await apiRequest<Array<{ id: string; user?: { username?: string } }>>(rootSession.token, 'GET', '/profile/requests');
  const targetRequest = profileRequests.find((item) => item.user?.username === scenario.collaborator.username);
  if (!targetRequest) {
    throw new Error('Pedido de alteração de ficha não encontrado para aprovação.');
  }

  await apiRequest(rootSession.token, 'POST', `/profile/requests/${targetRequest.id}/approve`);

  await expect.poll(async () => {
    const profile = await apiRequest<{ primeiroNome?: string }>(collaboratorLogin.token, 'GET', '/profile/me');
    return profile.primeiroNome;
  }, { timeout: 20000 }).toBe(scenario.profileChangeFields[0].value);
});

test('pedido de férias e aprovação ficam visíveis no fluxo principal', async ({ page }, testInfo) => {
  test.setTimeout(60000);
  const scenario = await createScenario({ includeVacationWindow: true }, testInfo);
  if (!scenario.vacationWindow) {
    throw new Error('Janela de férias não foi gerada para o cenário de aprovação.');
  }
  const collaboratorSession = await apiLogin(scenario.collaborator.username, scenario.collaborator.password);
  const collaboratorTeams = await apiRequest<Array<{ teamId?: string; id?: string }>>(collaboratorSession.token, 'GET', '/users/me/teams');
  const collaboratorTeamId = collaboratorTeams[0]?.teamId || collaboratorTeams[0]?.id || scenario.team.id;

  await apiRequest(collaboratorSession.token, 'POST', '/vacations', {
    dataInicio: scenario.vacationWindow.start,
    dataFim: scenario.vacationWindow.end,
    observacoes: 'Pedido QA de férias para validação E2E.',
    requestType: 'VACATION',
    attachmentLink: '',
    contextTeamId: collaboratorTeamId,
    partialDay: 'FULL',
  });

  await login(page, ROOT_USERNAME, ROOT_PASSWORD);
  await page.goto('/aprovacoes');

  await page.getByRole('button', { name: /Férias e ausências/i }).click();
  await expect(page.getByRole('button', { name: 'Aprovar' }).first()).toBeVisible({ timeout: 20000 });
  await page.getByRole('button', { name: 'Aprovar' }).first().click();
  await expect(page.getByRole('button', { name: 'Aprovar' }).first()).toBeVisible();
});

test('permissoes completas podem ser ativadas e revogadas na ficha do colaborador', async ({ page }, testInfo) => {
  test.setTimeout(60000);
  const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const username = `qa.perm.${uniqueSuffix}`;
  const email = `${username}@smarterhub.test`;

  await createUserAsRoot({
    fullName: 'QA Permissoes',
    username,
    email,
    password: collaboratorPassword,
    role: 'COLABORADOR',
    workCountry: 'BR',
  }, testInfo);

  await login(page, ROOT_USERNAME, ROOT_PASSWORD);
  await page.goto('/colaboradores');

  await page.getByLabel('Pesquisar').fill(username);
  await expect(page.getByText(username)).toBeVisible({ timeout: 20000 });

  await page.getByRole('button', { name: 'Permissões' }).first().click();
  await expect(page.getByRole('heading', { name: /Gestão do colaborador/i })).toBeVisible();

  await page.getByRole('button', { name: 'Dar acesso total' }).click();
  await page.getByRole('button', { name: 'Confirmar' }).click();
  await expect(page.getByRole('button', { name: 'Revogar acesso total' })).toBeEnabled({ timeout: 20000 });

  await page.getByRole('button', { name: 'Revogar acesso total' }).click();
  await page.getByRole('button', { name: 'Confirmar' }).click();
  await expect(page.getByRole('button', { name: 'Dar acesso total' })).toBeVisible();
});

test('criacao de utilizador com pais BR fica refletida na tabela de administracao', async ({ page }, testInfo) => {
  const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const username = `qa.admin.${uniqueSuffix}`;
  const email = `${username}@smarterhub.test`;

  await createUserAsRoot({
    fullName: 'QA Brasil',
    username,
    email,
    password: collaboratorPassword,
    role: 'COLABORADOR',
    workCountry: 'BR',
  }, testInfo);

  await login(page, ROOT_USERNAME, ROOT_PASSWORD);
  await page.goto('/admin');

  await page.getByLabel('Pesquisar').fill(username);
  await expect(page.getByText(username)).toBeVisible({ timeout: 20000 });
  await expect(page.getByText('BR', { exact: true })).toBeVisible();
});

test('login invalido mostra erro sem autenticar utilizador', async ({ page }) => {
  await page.goto('/login');

  await page.getByLabel('Utilizador').fill(`qa.invalid.${Date.now()}`);
  await page.locator('#login-password').fill('wrong-password');
  await page.getByRole('button', { name: 'Entrar no portal' }).click();

  await expect(page.getByText(/credenciais inválidas|credenciais invalidas|falha ao autenticar/i)).toBeVisible({ timeout: 20000 });
  await expect(page.locator('.portal-header')).not.toBeVisible();
});

test('utilizador colaborador sem permissao recebe 403 ao consultar administracao', async ({}, testInfo) => {
  const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const username = `qa.noadmin.${uniqueSuffix}`;
  const email = `${username}@smarterhub.test`;

  await createUserAsRoot({
    fullName: `QA Sem Admin ${uniqueSuffix}`,
    username,
    email,
    password: collaboratorPassword,
    role: 'COLABORADOR',
    workCountry: 'BR',
  }, testInfo);

  const collaboratorSession = await apiLogin(username, collaboratorPassword);
  const response = await apiRequestRaw(collaboratorSession.token, 'GET', '/admin/users');

  expect(response.status).toBe(403);
});

test('rejeicao de pedido de alteracao remove item da fila de aprovacoes', async ({ page }, testInfo) => {
  const scenario = await createScenario(undefined, testInfo);
  const collaboratorLogin = await apiLogin(scenario.collaborator.username, scenario.collaborator.password);

  await apiRequest(collaboratorLogin.token, 'PUT', '/profile/me', Object.fromEntries(scenario.profileChangeFields.map((item) => [item.key, item.value])));

  await login(page, ROOT_USERNAME, ROOT_PASSWORD);
  await page.goto('/aprovacoes');

  await page.getByRole('button', { name: /Alterações de ficha/i }).click();
  const targetCard = page.locator('.rh-request-list .rh-profile-card').filter({ hasText: scenario.collaborator.fullName }).first();
  await expect(targetCard).toBeVisible({ timeout: 20000 });

  await targetCard.getByRole('button', { name: 'Rejeitar' }).click();
  await expect.poll(async () => {
    const rootSession = await apiLogin(ROOT_USERNAME, ROOT_PASSWORD);
    const pendingRequests = await apiRequest<Array<{ user?: { username?: string } }>>(rootSession.token, 'GET', '/profile/requests');
    return pendingRequests.some((item) => item.user?.username === scenario.collaborator.username);
  }, { timeout: 20000 }).toBe(false);
});

test('sessao invalida envia o utilizador para o login', async ({ page }) => {
  await page.goto('/');

  await page.evaluate(() => {
    localStorage.setItem('smarter_hub_auth_token', 'invalid-token-for-e2e');
  });

  await page.reload();

  await expect(page.getByRole('heading', { name: 'Smarter Hub' })).toBeVisible({ timeout: 20000 });
  await expect(page.locator('.auth-card')).toBeVisible();
});

test('rejeicao de pedido de ferias remove item da fila e guarda motivo', async ({ page }, testInfo) => {
  test.setTimeout(60000);
  const scenario = await createScenario({ includeVacationWindow: true }, testInfo);
  if (!scenario.vacationWindow) {
    throw new Error('Janela de férias não foi gerada para o cenário de rejeição.');
  }

  const collaboratorSession = await apiLogin(scenario.collaborator.username, scenario.collaborator.password);
  const collaboratorTeams = await apiRequest<Array<{ teamId?: string; id?: string }>>(collaboratorSession.token, 'GET', '/users/me/teams');
  const collaboratorTeamId = collaboratorTeams[0]?.teamId || collaboratorTeams[0]?.id || scenario.team.id;

  await apiRequest(collaboratorSession.token, 'POST', '/vacations', {
    dataInicio: scenario.vacationWindow.start,
    dataFim: scenario.vacationWindow.end,
    observacoes: 'Pedido QA de férias para rejeição E2E.',
    requestType: 'VACATION',
    attachmentLink: '',
    contextTeamId: collaboratorTeamId,
    partialDay: 'FULL',
  });

  await login(page, ROOT_USERNAME, ROOT_PASSWORD);
  await page.goto('/aprovacoes');
  const rootSession = await apiLogin(ROOT_USERNAME, ROOT_PASSWORD);

  await page.getByRole('button', { name: /Férias e ausências/i }).click();
  const targetCard = page.locator('.rh-request-list .trainings-mobile-card').filter({ hasText: scenario.collaborator.fullName });
  await expect(targetCard).toBeVisible({ timeout: 20000 });

  const rejectionReason = 'Pedido fora da janela de aprovação.';
  const vacationRequests = await apiRequest<Array<{ id: string; user?: { username?: string } }>>(rootSession.token, 'GET', '/vacations/requests');
  const targetRequest = vacationRequests.find((item) => item.user?.username === scenario.collaborator.username);
  if (!targetRequest) {
    throw new Error('Pedido de férias não encontrado para rejeição.');
  }

  await apiRequest(rootSession.token, 'POST', `/vacations/${targetRequest.id}/reject`, {
    reason: rejectionReason,
  });

  await expect.poll(async () => {
    const updatedRequests = await apiRequest<Array<{ user?: { username?: string } }>>(rootSession.token, 'GET', '/vacations/requests');
    return updatedRequests.some((item) => item.user?.username === scenario.collaborator.username);
  }, { timeout: 20000 }).toBe(false);

  const collaboratorHistory = await apiRequest<Array<{ id: string; status: string; reviewReason?: string }>>(collaboratorSession.token, 'GET', '/vacations/me');
  const rejectedRequest = collaboratorHistory.find((item) => item.id === targetRequest.id);
  expect(rejectedRequest?.status).toBe('REJECTED');
  expect(rejectedRequest?.reviewReason).toContain(rejectionReason);
});

test('formularios mostram validacao quando submetidos em branco', async ({ page }) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);
  await page.goto('/admin');

  await page.getByRole('button', { name: 'Novo utilizador' }).click();
  await page.getByRole('button', { name: 'Criar utilizador' }).click();
  await expect(page.getByText('Preenche primeiro nome, apelido, email e password.')).toBeVisible({ timeout: 20000 });
});