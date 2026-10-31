/**
 * AI HUD CLI 桥接抽象端口 (CLI Bridge Port)
 * 契约规范：docs/ARCHITECTURE.md 第 4.2 节、第 8.4 节 IPC (cli.run)
 *
 * 仅允许执行驱动 capabilities.cli_commands 白名单内的子进程命令（如 gemini agy）。
 */

export interface CliResult {
  readonly exit_code: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface CliBridge {
  run(command: string, args: readonly string[], timeout_ms?: number): Promise<CliResult>;
}
