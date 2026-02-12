export interface AIProvider {
  /** Display name for this provider */
  name: string;
  /** Check if the provider's CLI/tool is available on this machine */
  isAvailable(): Promise<boolean>;
  /** Whether this provider needs Ink to unmount (terminal-based providers do) */
  requiresUnmount: boolean;
  /** Spawn the generation session. Resolves when the session ends. */
  spawn(opts: {
    xcliDir: string;
    actionsDir: string;
    systemPrompt: string;
  }): Promise<void>;
}

export class ClaudeCodeProvider implements AIProvider {
  name = "Claude Code";
  requiresUnmount = true;

  async isAvailable(): Promise<boolean> {
    return Bun.which("claude") !== null;
  }

  async spawn(opts: {
    xcliDir: string;
    actionsDir: string;
    systemPrompt: string;
  }): Promise<void> {
    const proc = Bun.spawn(
      [
        "claude",
        "--append-system-prompt",
        opts.systemPrompt,
        "I'm ready to create a new xcli action. Describe what you'd like the script to do.",
      ],
      {
        cwd: opts.xcliDir,
        stdio: ["inherit", "inherit", "inherit"],
      },
    );

    await proc.exited;
  }
}

export function getDefaultProvider(): AIProvider {
  return new ClaudeCodeProvider();
}
