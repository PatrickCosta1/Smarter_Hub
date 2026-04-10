import { expect, Page, test } from '@playwright/test';

test.describe.configure({ mode: 'serial' });

const API_BASE = process.env.SMB_E2E_API_BASE_URL || 'http://127.0.0.1:4000/api';

const ROOT_USERNAME = process.env.SMB_E2E_ROOT_USERNAME || 't.people';
const ROOT_PASSWORD = process.env.SMB_E2E_ROOT_PASSWORD || 'people123';
const APPROVER_USERNAME = process.env.SMB_E2E_APPROVER_USERNAME || 'sara.magalhaes';
const APPROVER_PASSWORD = process.env.SMB_E2E_APPROVER_PASSWORD || 'sara123';

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
  };
  team: {
    id: string;
    name: string;
  };
  profileChangeFields: Array<{ key: string; value: string }>;
  vacationWindow: {
    start: string;
    end: string;
  };
};

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

async function findVacationWindow(country: 'PT' | 'BR' = 'PT') {
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
    const startIso = toIsoDate(cursor);
    const nextDay = addDays(cursor, 1);
    const endIso = toIsoDate(nextDay);
    const weekday = cursor.getDay();

    if (weekday === 0 || weekday === 6) {
      cursor.setDate(cursor.getDate() + 1);
      continue;
    }

    if (nextDay.getDay() === 0 || nextDay.getDay() === 6) {
      cursor.setDate(cursor.getDate() + 1);
      continue;
    }

    if (!holidays.has(startIso) && !holidays.has(endIso)) {
      return { start: startIso, end: endIso };
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

async function createScenario() {
  const rootLogin = await apiLogin(ROOT_USERNAME, ROOT_PASSWORD);
  const approverLogin = await apiLogin(APPROVER_USERNAME, APPROVER_PASSWORD);

  const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const teamName = `QA Team ${uniqueSuffix}`;
  const collaboratorUsername = `qa.user.${uniqueSuffix}`;
  const collaboratorEmail = `${collaboratorUsername}@smarterhub.test`;

  const team = await apiRequest<{ id: string; name: string }>(rootLogin.token, 'POST', '/admin/teams', {
    name: teamName,
    leaderId: approverLogin.user.id,
    memberIds: [],
    parentTeamId: null,
  });

  const collaborator = await apiRequest<{ id: string }>(rootLogin.token, 'POST', '/users', {
    username: collaboratorUsername,
    password: collaboratorPassword,
    email: collaboratorEmail,
    fullName: 'QA Colaborador',
    role: 'COLABORADOR',
    teamId: team.id,
  });

  const profileChangeFields = [
    { key: 'primeiroNome', value: `QA ${uniqueSuffix}` },
    { key: 'apelido', value: `Apelido ${uniqueSuffix}` },
    { key: 'nomeAbreviado', value: `QA ${uniqueSuffix}` },
  ];

  const vacationWindow = await findVacationWindow('PT');

  return {
    collaborator: {
      id: collaborator.id,
      username: collaboratorUsername,
      password: collaboratorPassword,
      email: collaboratorEmail,
    },
    team,
    profileChangeFields,
    vacationWindow,
  } satisfies Scenario;
}

test('notificacao de ficha mostra campos legiveis e leva a aprovacoes', async ({ page }) => {
  const scenario = await createScenario();
  const collaboratorLogin = await apiLogin(scenario.collaborator.username, scenario.collaborator.password);

  await apiRequest(collaboratorLogin.token, 'PUT', '/profile/me', Object.fromEntries(scenario.profileChangeFields.map((item) => [item.key, item.value])));

  await login(page, ROOT_USERNAME, ROOT_PASSWORD);
  await page.goto('/notifications');

  const notificationCard = page.locator('.notification-card').filter({ has: page.getByRole('button', { name: 'Ir para aprovações' }) }).first();
  await expect(notificationCard).toBeVisible({ timeout: 20000 });
  await notificationCard.getByRole('button', { name: 'Ir para aprovações' }).click();

  await expect(page.locator('.trainings-hero').getByRole('heading', { name: 'Aprovações' })).toBeVisible();

  await page.getByRole('button', { name: /Alterações de ficha/i }).click();
  await expect(page.locator('.rh-request-list .trainings-mobile-card').first()).toBeVisible();
  await page.getByRole('button', { name: 'Aprovar' }).first().click();
  await expect(page.locator('.rh-request-list .trainings-mobile-card').first()).toBeVisible();
});

test('pedido de férias e aprovação ficam visíveis no fluxo principal', async ({ page }) => {
  const scenario = await createScenario();
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

test('permissoes completas podem ser ativadas na ficha do colaborador', async ({ page }) => {
  const scenario = await createScenario();

  await login(page, ROOT_USERNAME, ROOT_PASSWORD);
  await page.goto('/colaboradores');

  await page.getByLabel('Pesquisar').fill(scenario.collaborator.username);
  await expect(page.getByText(scenario.collaborator.username)).toBeVisible({ timeout: 20000 });

  await page.getByRole('button', { name: 'Permissões' }).first().click();
  await expect(page.getByRole('heading', { name: /Gestão do colaborador/i })).toBeVisible();

  await page.getByRole('button', { name: 'Dar acesso total' }).click();
  await expect(page.getByRole('button', { name: 'Revogar acesso total' })).toBeVisible();
});