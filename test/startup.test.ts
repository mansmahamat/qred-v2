// Runs the real server as a child process to test startup.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

const root = fileURLToPath(new URL('..', import.meta.url));
const tsx = fileURLToPath(new URL('../node_modules/.bin/tsx', import.meta.url));

function startServer(env: NodeJS.ProcessEnv) {
  return new Promise<{ code: number | null; stderr: string }>((resolve, reject) => {
    const child = spawn(tsx, ['src/server.ts'], { cwd: root, env });
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
    // If the check is removed the server never exits: kill it and fail.
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('The server started instead of refusing to'));
    }, 10_000);
    child.on('exit', (code) => {
      clearTimeout(timer);
      resolve({ code, stderr });
    });
  });
}

it('refuses to start outside demo mode without a database', async () => {
  const { DEMO_MODE: _demo, DATABASE_DIR: _dir, ...env } = process.env;

  const { code, stderr } = await startServer({ ...env, PORT: '0' });

  expect(code).toBe(1);
  expect(stderr).toContain('DATABASE_DIR is required outside demo mode');
});
