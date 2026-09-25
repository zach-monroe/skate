import { Sandbox } from "@e2b/desktop";
import {
  CreateSandboxOptions,
  DesktopSandbox,
  SandboxProvider,
} from "./types";

class E2BDesktopSandbox implements DesktopSandbox {
  constructor(private readonly sandbox: Sandbox) {}

  get sandboxId() {
    return this.sandbox.sandboxId;
  }

  screenshot() {
    return this.sandbox.screenshot();
  }

  leftClick(x: number, y: number) {
    return this.sandbox.leftClick(x, y);
  }

  rightClick(x: number, y: number) {
    return this.sandbox.rightClick(x, y);
  }

  middleClick(x: number, y: number) {
    return this.sandbox.middleClick(x, y);
  }

  doubleClick(x: number, y: number) {
    return this.sandbox.doubleClick(x, y);
  }

  moveMouse(x: number, y: number) {
    return this.sandbox.moveMouse(x, y);
  }

  drag(start: [number, number], end: [number, number]) {
    return this.sandbox.drag(start, end);
  }

  scroll(direction: "up" | "down", amount: number) {
    return this.sandbox.scroll(direction, amount);
  }

  write(text: string, options?: { chunkSize: number; delayInMs: number }) {
    return this.sandbox.write(text, options);
  }

  press(keys: string | string[]) {
    return this.sandbox.press(keys);
  }

  setTimeout(timeoutMs: number) {
    return this.sandbox.setTimeout(timeoutMs);
  }

  kill() {
    return this.sandbox.kill();
  }

  getStreamUrl() {
    return this.sandbox.stream.getUrl();
  }
}

export const e2bProvider: SandboxProvider = {
  getConfigError() {
    return process.env.E2B_API_KEY ? undefined : "E2B API key not found";
  },

  async create({ resolution, timeoutMs }: CreateSandboxOptions) {
    const sandbox = await Sandbox.create({
      resolution,
      dpi: 96,
      timeoutMs,
    });

    await sandbox.stream.start();

    return new E2BDesktopSandbox(sandbox);
  },

  async connect(sandboxId: string) {
    return new E2BDesktopSandbox(await Sandbox.connect(sandboxId));
  },
};
