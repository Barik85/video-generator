import { spawn } from "node:child_process";

export class ExecError extends Error {
  constructor(
    readonly cmd: string,
    readonly code: number | null,
    readonly stderr: string,
  ) {
    super(`${cmd} exited with ${code}: ${stderr.trim().split("\n").slice(-3).join(" | ")}`);
  }
}

export function run(cmd: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    p.stdout.on("data", (d) => (stdout += d));
    p.stderr.on("data", (d) => (stderr += d));
    p.on("error", reject);
    p.on("close", (code) => (code === 0 ? resolve({ stdout, stderr }) : reject(new ExecError(cmd, code, stderr))));
  });
}

export const ffmpeg = (args: string[]) => run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args]);
