import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import bootstrapModule from './bootstrap.cjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const args = ['compose', '--project-name', 'al-e2e-pr21', '-f', 'e2e/game/compose.yml'];
function docker(command, capture = false) {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', [...args, ...command], { cwd: root, stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit', windowsHide: true });
    let output = '';
    child.stdout?.on('data', chunk => { output += chunk; });
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolve(output) : reject(new Error('Docker exited ' + code)));
  });
}
export async function up() {
  await docker(['up', '--build', '--detach', '--wait', '--wait-timeout', '300']);
  return bootstrapModule.bootstrap();
}
export async function logs() {
  const output = await docker(['logs', '--no-color', '--timestamps'], true);
  const destination = resolve(root, '.build/e2e-live/server.log');
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, output);
  console.log(destination);
}
export async function down() { await docker(['down', '--volumes', '--remove-orphans']); }
const command = process.argv[2];
if (command === 'up') await up();
else if (command === 'down') await down();
else if (command === 'logs') await logs();
else if (command === 'reset') await bootstrapModule.reset();
else if (process.argv[1] === fileURLToPath(import.meta.url)) throw new Error('Usage: node e2e/game/manage.mjs up|down|logs|reset');
