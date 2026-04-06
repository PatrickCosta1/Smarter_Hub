import { spawnSync } from 'node:child_process';

function run(command, args) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: process.env,
  });

  return result.status ?? 1;
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function initDatabaseWithRetry() {
  const maxAttempts = 8;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    console.log(`[render-start] Database init attempt ${attempt}/${maxAttempts}`);

    const pushStatus = run('npm', ['run', 'prisma:push']);

    if (pushStatus === 0) {
      const seedStatus = run('npm', ['run', 'db:seed']);

      if (seedStatus === 0) {
        console.log('[render-start] Database initialized successfully.');
        return true;
      }
    }

    if (attempt < maxAttempts) {
      const waitMs = attempt * 5000;
      console.log(`[render-start] Database not ready. Retrying in ${waitMs / 1000}s...`);
      await delay(waitMs);
      continue;
    }
  }

  return false;
}

const initialized = await initDatabaseWithRetry();

if (!initialized) {
  console.error('[render-start] Failed to initialize database after retries.');
  process.exit(1);
}

const startStatus = run('npm', ['run', 'start']);
process.exit(startStatus);
