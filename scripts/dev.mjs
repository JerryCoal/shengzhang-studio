import { spawn } from 'node:child_process';
const processes = [
  spawn(process.execPath, ['--watch', '--env-file-if-exists=.env', 'server/index.mjs'], { stdio: 'inherit' }),
  spawn(process.execPath, ['node_modules/vite/bin/vite.js'], { stdio: 'inherit' }),
];
for (const child of processes) child.on('exit', code => { for (const p of processes) if (p !== child) p.kill(); process.exitCode = code || 0; });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { for (const p of processes) p.kill(); });
