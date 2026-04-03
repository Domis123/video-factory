import { spawn } from 'node:child_process';
import type { FfCommand } from './ffmpeg.js';

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export function exec(cmd: FfCommand): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd.command, cmd.args);
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];

    proc.stdout.on('data', (d) => stdout.push(d));
    proc.stderr.on('data', (d) => stderr.push(d));

    proc.on('error', reject);
    proc.on('close', (exitCode) => {
      resolve({
        stdout: Buffer.concat(stdout).toString(),
        stderr: Buffer.concat(stderr).toString(),
        exitCode: exitCode ?? 1,
      });
    });
  });
}

export async function execOrThrow(cmd: FfCommand): Promise<string> {
  const result = await exec(cmd);
  if (result.exitCode !== 0) {
    throw new Error(`${cmd.command} failed (exit ${result.exitCode}): ${result.stderr}`);
  }
  return result.stdout;
}
