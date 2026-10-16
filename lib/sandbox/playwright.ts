import { randomUUID } from "crypto";
import { existsSync } from "fs";
import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
} from "playwright";
import { CreateSandboxOptions, DesktopSandbox, SandboxProvider } from "./types";

const START_URL =
  process.env.SKATE_PLAYWRIGHT_START_URL || "https://duckduckgo.com";
const START_NAVIGATION_TIMEOUT_MS = 15_000;
// Opens a visible browser window by default. Set SKATE_PLAYWRIGHT_HEADLESS=true
// for tests/CI; with no display available (e.g. SSH) it falls back to headless.
function resolveHeadless(): boolean {
  const setting = process.env.SKATE_PLAYWRIGHT_HEADLESS;
  if (setting === "true") return true;
  if (setting === "false") return false;
  const noDisplay =
    process.platform === "linux" &&
    !process.env.DISPLAY &&
    !process.env.WAYLAND_DISPLAY;
  return noDisplay;
}
const HEADLESS = resolveHeadless();
// One wheel "click" is about 100px in a browser
const WHEEL_CLICK_PX = 100;

interface SandboxEntry {
  context: BrowserContext;
  page: Page;
  expiry?: NodeJS.Timeout;
}

// Kept on globalThis so dev-server HMR and separate route bundles share state.
// Only sandboxes created here are in the registry, so connect() can never
// attach to anything else.
const globalState = globalThis as unknown as {
  __skatePlaywrightBrowser?: Promise<Browser>;
  __skatePlaywrightSandboxes?: Map<string, SandboxEntry>;
};
const registry = (globalState.__skatePlaywrightSandboxes ??= new Map());

async function getBrowser(): Promise<Browser> {
  const existing = globalState.__skatePlaywrightBrowser;
  if (existing) {
    const browser = await existing.catch(() => undefined);
    if (browser?.isConnected()) return browser;
  }
  const launched = chromium.launch({ headless: HEADLESS });
  globalState.__skatePlaywrightBrowser = launched;
  return launched;
}

// Maps the xdotool-style key names the agents emit to Playwright key names.
const KEY_ALIASES: Record<string, string> = {
  ctrl: "Control",
  control: "Control",
  alt: "Alt",
  option: "Alt",
  shift: "Shift",
  super: "Meta",
  meta: "Meta",
  cmd: "Meta",
  command: "Meta",
  win: "Meta",
  enter: "Enter",
  return: "Enter",
  esc: "Escape",
  escape: "Escape",
  tab: "Tab",
  space: "Space",
  backspace: "Backspace",
  delete: "Delete",
  del: "Delete",
  up: "ArrowUp",
  down: "ArrowDown",
  left: "ArrowLeft",
  right: "ArrowRight",
  pageup: "PageUp",
  page_up: "PageUp",
  pagedown: "PageDown",
  page_down: "PageDown",
  home: "Home",
  end: "End",
  insert: "Insert",
};

function toPlaywrightKey(key: string): string {
  const lower = key.trim().toLowerCase();
  if (KEY_ALIASES[lower]) return KEY_ALIASES[lower];
  if (/^f\d{1,2}$/.test(lower)) return lower.toUpperCase();
  return key.trim();
}

export class PlaywrightDesktopSandbox implements DesktopSandbox {
  constructor(
    public readonly sandboxId: string,
    private readonly entry: SandboxEntry
  ) {}

  private get page() {
    return this.entry.page;
  }

  async screenshot(): Promise<Uint8Array> {
    return this.page.screenshot({ type: "png" });
  }

  /** Smaller frames for the live viewer stream. */
  async screenshotJpeg(): Promise<Uint8Array> {
    return this.page.screenshot({ type: "jpeg", quality: 60 });
  }

  async leftClick(x: number, y: number) {
    await this.page.mouse.click(x, y);
  }

  async rightClick(x: number, y: number) {
    await this.page.mouse.click(x, y, { button: "right" });
  }

  async middleClick(x: number, y: number) {
    await this.page.mouse.click(x, y, { button: "middle" });
  }

  async doubleClick(x: number, y: number) {
    await this.page.mouse.dblclick(x, y);
  }

  async moveMouse(x: number, y: number) {
    await this.page.mouse.move(x, y);
  }

  async drag(start: [number, number], end: [number, number]) {
    const { mouse } = this.page;
    await mouse.move(start[0], start[1]);
    await mouse.down();
    await mouse.move(end[0], end[1], { steps: 10 });
    await mouse.up();
  }

  async scroll(direction: "up" | "down", amount: number) {
    const delta = amount * WHEEL_CLICK_PX;
    await this.page.mouse.wheel(0, direction === "up" ? -delta : delta);
  }

  async write(text: string, options?: { chunkSize: number; delayInMs: number }) {
    const chunkSize = options?.chunkSize ?? 25;
    const delayInMs = options?.delayInMs ?? 75;

    for (let i = 0; i < text.length; i += chunkSize) {
      await this.page.keyboard.type(text.slice(i, i + chunkSize), {
        delay: 12,
      });
      if (i + chunkSize < text.length) {
        await new Promise((resolve) => setTimeout(resolve, delayInMs));
      }
    }
  }

  async press(keys: string | string[]) {
    const parts = (Array.isArray(keys) ? keys : keys.split("+")).map(
      toPlaywrightKey
    );
    await this.page.keyboard.press(parts.join("+"));
  }

  async setTimeout(timeoutMs: number) {
    if (this.entry.expiry) clearTimeout(this.entry.expiry);
    this.entry.expiry = setTimeout(() => {
      void this.kill();
    }, timeoutMs);
    this.entry.expiry.unref();
  }

  async kill() {
    if (this.entry.expiry) clearTimeout(this.entry.expiry);
    registry.delete(this.sandboxId);
    await this.entry.context.close().catch(() => {});
  }

  getStreamUrl() {
    return `/api/playwright/${this.sandboxId}/view`;
  }
}

/** Looks up a live sandbox created by this provider, for the viewer routes. */
export function getPlaywrightSandbox(
  sandboxId: string
): PlaywrightDesktopSandbox | undefined {
  const entry = registry.get(sandboxId);
  if (!entry || entry.page.isClosed()) return undefined;
  return new PlaywrightDesktopSandbox(sandboxId, entry);
}

export const playwrightProvider: SandboxProvider = {
  getConfigError() {
    let executable: string;
    try {
      executable = chromium.executablePath();
    } catch {
      executable = "";
    }
    if (!executable || !existsSync(executable)) {
      return "Playwright's Chromium is not installed. Run: npx playwright install chromium";
    }
    return undefined;
  },

  async create({ resolution, timeoutMs }: CreateSandboxOptions) {
    const [width, height] = resolution;
    const browser = await getBrowser();
    const context = await browser.newContext({
      viewport: { width, height },
      deviceScaleFactor: 1,
    });
    const page = await context.newPage();

    // Offline or blocked start pages shouldn't prevent the sandbox from existing
    await page
      .goto(START_URL, {
        waitUntil: "domcontentloaded",
        timeout: START_NAVIGATION_TIMEOUT_MS,
      })
      .catch(() => {});

    const sandboxId = randomUUID();
    const entry: SandboxEntry = { context, page };
    registry.set(sandboxId, entry);

    const sandbox = new PlaywrightDesktopSandbox(sandboxId, entry);
    await sandbox.setTimeout(timeoutMs);
    return sandbox;
  },

  async connect(sandboxId: string) {
    const sandbox = getPlaywrightSandbox(sandboxId);
    if (!sandbox) throw new Error("Sandbox not found");
    return sandbox;
  },
};
