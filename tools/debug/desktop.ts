import { spawn, type ChildProcess } from 'node:child_process';
import { access } from 'node:fs/promises';
/** Private virtual desktop; only the authenticated gateway exposes its viewer. */
export async function startDesktop(own: (process: ChildProcess) => void) {
  const run = (command: string, args: string[]) => own(spawn(command, args, { stdio: ['ignore', 'inherit', 'inherit'] }));
  run('Xvfb', [':99', '-screen', '0', '1440x1000x24', '-nolisten', 'tcp']);
  for (let attempt = 0; ; attempt++) {
    try { await access('/tmp/.X11-unix/X99'); break; }
    catch { if (attempt >= 100) throw Error('Debug game display failed to start'); }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  run('x11vnc', ['-display', ':99', '-localhost', '-rfbport', '5900', '-nopw', '-forever', '-shared', '-quiet']);
  run('websockify', ['--web', '/usr/share/novnc', '127.0.0.1:6080', '127.0.0.1:5900']);
}
