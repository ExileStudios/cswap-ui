// Launches cswap UI detached from the terminal.
//
// ELECTRON_RUN_AS_NODE is removed because VS Code (and other Electron hosts)
// leak it into child processes, which would make electron.exe run as plain Node.
import { spawn } from 'node:child_process';
import path from 'node:path';
import electron from 'electron';

const appDir = path.join(import.meta.dirname, '..');
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const foreground = process.argv.includes('--snapshot');
const child = spawn(electron, [appDir, ...process.argv.slice(2)], {
  env,
  detached: !foreground,
  stdio: foreground ? 'inherit' : 'ignore',
});

if (foreground) child.on('exit', (code) => process.exit(code ?? 1));
else child.unref();
