import { spawnSync } from 'node:child_process';

function run(command, args) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });

  if (typeof result.status === 'number') {
    return result.status;
  }

  return 1;
}

const testArgs = process.argv.slice(2);
const playwrightCommand = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

const testExitCode = run(playwrightCommand, ['playwright', 'test', ...testArgs]);
const cleanupExitCode = run(npmCommand, ['run', 'e2e:cleanup']);

if (testExitCode !== 0) {
  process.exit(testExitCode);
}

if (cleanupExitCode !== 0) {
  process.exit(cleanupExitCode);
}
