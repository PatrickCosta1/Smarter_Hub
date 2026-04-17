const REQUEST_TIMING_ENABLED = process.env.REQUEST_TIMING_LOGS !== 'false';
const REQUEST_TIMING_WARN_MS = Number(process.env.REQUEST_TIMING_WARN_MS ?? 250);

export function createRequestTimer(label: string) {
  const startedAt = performance.now();
  let lastAt = startedAt;
  const steps: Array<{ name: string; durationMs: number }> = [];

  function mark(name: string) {
    if (!REQUEST_TIMING_ENABLED) {
      return;
    }

    const now = performance.now();
    steps.push({ name, durationMs: now - lastAt });
    lastAt = now;
  }

  function done(extra?: Record<string, unknown>) {
    if (!REQUEST_TIMING_ENABLED) {
      return;
    }

    const totalMs = performance.now() - startedAt;
    if (totalMs < REQUEST_TIMING_WARN_MS) {
      return;
    }

    const payload = steps.map((step) => `${step.name}=${Math.round(step.durationMs)}ms`).join(' | ');
    const suffix = extra ? ` ${JSON.stringify(extra)}` : '';
    console.info(`[request timing] ${label} total=${Math.round(totalMs)}ms${payload ? ` | ${payload}` : ''}${suffix}`);
  }

  return { mark, done };
}