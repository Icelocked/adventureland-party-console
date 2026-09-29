import { spawn } from 'node:child_process';
export async function docker(args: string[], options: { signal?: AbortSignal; combined?: boolean } = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', args, { windowsHide: true, signal: options.signal, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '', tail = '', failure: Error | undefined;
    const capture = (chunk: Buffer) => { output += chunk; if (output.length > 200000) output = output.slice(-200000); };
    child.stdout.on('data', capture);
    if (options.combined) child.stderr.on('data', capture);
    for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => {
      tail = (tail + chunk).slice(-4000);
    });
    child.on('error', error => { failure = new Error(error.name === 'AbortError' ? 'Startup cancelled' :
      'Docker is unavailable. Install/start Docker Desktop or Docker Engine; containers need access to the Docker socket. ' + error.message); });
    // Wait for the CLI and its pipes to close before teardown can inspect resources.
    child.on('close', code => failure ? reject(failure) : code === 0 ? resolve(output.trim()) : reject(new Error(tail || `Docker exited ${code}`)));
  });
}
