import { up, down, logs } from './manage.mjs';

export default async function setup(config) {
  // FullConfig can still expose projects excluded by the CLI project selector.
  const selectors = process.argv.flatMap((argument, index, argv) => argument.startsWith('--project=') ? [argument.slice(10)] : argument === '--project' ? [argv[index + 1]] : []);
  if (selectors.length && !selectors.some(name => name === 'live' || name.includes('*'))) return;
  if (!config.projects.some(project => project.name === 'live')) return;
  // Debugging opt-in keeps this exact disposable project across selected reruns.
  // Normal local and CI runs always collect evidence and remove the database.
  try {
    await up();
  } catch (error) {
    await logs().catch(() => {});
    if (!process.env.E2E_KEEP_GAME) await down();
    throw error;
  }
  return async () => {
    try { await logs(); }
    finally { if (!process.env.E2E_KEEP_GAME) await down(); }
  };
}
