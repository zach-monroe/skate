export interface CreateSandboxOptions {
  resolution: [number, number];
  timeoutMs: number;
}

/**
 * The subset of desktop control the agent needs, independent of where the
 * desktop actually runs (E2B, a local container, ...).
 */
export interface DesktopSandbox {
  readonly sandboxId: string;

  screenshot(): Promise<Uint8Array>;

  leftClick(x: number, y: number): Promise<void>;
  rightClick(x: number, y: number): Promise<void>;
  middleClick(x: number, y: number): Promise<void>;
  doubleClick(x: number, y: number): Promise<void>;
  moveMouse(x: number, y: number): Promise<void>;
  drag(start: [number, number], end: [number, number]): Promise<void>;
  scroll(direction: "up" | "down", amount: number): Promise<void>;

  write(
    text: string,
    options?: { chunkSize: number; delayInMs: number }
  ): Promise<void>;
  press(keys: string | string[]): Promise<void>;

  /** Resets the remaining lifetime of the sandbox to `timeoutMs`. */
  setTimeout(timeoutMs: number): Promise<void>;
  kill(): Promise<void>;

  /** URL the browser embeds to show the live desktop. */
  getStreamUrl(): string;
}

export interface SandboxProvider {
  /** Returns a message when required configuration is missing. */
  getConfigError(): string | undefined;
  create(options: CreateSandboxOptions): Promise<DesktopSandbox>;
  connect(sandboxId: string): Promise<DesktopSandbox>;
}
