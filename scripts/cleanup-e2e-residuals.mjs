const API_BASE = process.env.SMB_E2E_API_BASE_URL || 'http://127.0.0.1:4000/api';
const ROOT_USERNAME = process.env.SMB_E2E_ROOT_USERNAME || 't.people';
const ROOT_PASSWORD = process.env.SMB_E2E_ROOT_PASSWORD || 'people123';

const USERNAME_REGEX = /^qa\./i;
const EMAIL_REGEX = /@smarterhub\.test$/i;
const TEAM_REGEX = /^QA Team\s/i;

async function fetchJson(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, options);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload?.message || payload?.error || `${response.status} ${response.statusText}`;
    throw new Error(`Falha em ${options.method || 'GET'} ${path}: ${message}`);
  }
  return payload;
}

async function adminDelete(token, path) {
  const response = await fetch(`${API_BASE}${path}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });

  if (response.ok || response.status === 404) {
    return true;
  }

  const payload = await response.json().catch(() => ({}));
  const message = payload?.message || payload?.error || `${response.status} ${response.statusText}`;
  throw new Error(`Falha em DELETE ${path}: ${message}`);
}

async function run() {
  const login = await fetchJson('/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: ROOT_USERNAME, password: ROOT_PASSWORD }),
  });

  const token = login.token;
  const headers = { Authorization: `Bearer ${token}` };

  const users = await fetchJson('/admin/users', { headers });
  const teams = await fetchJson('/admin/teams', { headers });

  const userTargets = users.filter((item) => USERNAME_REGEX.test(item.username) || EMAIL_REGEX.test(item.email));
  const teamTargets = teams.filter((item) => TEAM_REGEX.test(item.name));

  let deletedUsers = 0;
  let deletedTeams = 0;

  for (const user of userTargets) {
    await adminDelete(token, `/admin/users/${user.id}`);
    deletedUsers += 1;
  }

  for (const team of teamTargets) {
    await adminDelete(token, `/admin/teams/${team.id}`);
    deletedTeams += 1;
  }

  const usersAfter = await fetchJson('/admin/users', { headers });
  const teamsAfter = await fetchJson('/admin/teams', { headers });
  const residualUsers = usersAfter.filter((item) => USERNAME_REGEX.test(item.username) || EMAIL_REGEX.test(item.email));
  const residualTeams = teamsAfter.filter((item) => TEAM_REGEX.test(item.name));

  console.log('Deleted users:', deletedUsers);
  console.log('Deleted teams:', deletedTeams);
  console.log('Residual users:', residualUsers.length);
  console.log('Residual teams:', residualTeams.length);

  if (residualUsers.length > 0 || residualTeams.length > 0) {
    process.exitCode = 2;
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
