import { execFile, execFileSync } from "child_process";
import { promisify } from "util";
import { CreateSandboxOptions, DesktopSandbox, SandboxProvider } from "./types";

const execFileAsync = promisify(execFile);

const IMAGE_NAME = process.env.SURF_DOCKER_IMAGE || "surf-desktop:latest";
const CONTAINER_PORT = "6080";
const MAX_BUFFER = 25 * 1024 * 1024;
const SURF_LABEL = "surf=1";

async function docker(args: string[]): Promise<Buffer> {
  const { stdout } = await execFileAsync("docker", args, {
    encoding: "buffer",
    maxBuffer: MAX_BUFFER,
  });
  return stdout;
}

interface DockerInspectResult {
  Config: { Labels?: Record<string, string> };
  NetworkSettings: { Ports?: Record<string, { HostPort: string }[] | null> };
}

async function inspect(containerId: string): Promise<DockerInspectResult> {
  let raw: Buffer;
  try {
    raw = await docker(["inspect", containerId]);
  } catch {
    throw new Error("Sandbox not found");
  }
  const [info] = JSON.parse(raw.toString("utf8")) as DockerInspectResult[];
  return info;
}

function extractHostPort(info: DockerInspectResult): string {
  const hostPort = info.NetworkSettings.Ports?.[`${CONTAINER_PORT}/tcp`]?.[0]?.HostPort;
  if (!hostPort) {
    throw new Error("Sandbox has no published noVNC port");
  }
  return hostPort;
}

async function getVerifiedContainer(
  containerId: string
): Promise<DockerInspectResult> {
  const info = await inspect(containerId);
  if (info.Config.Labels?.surf !== "1") {
    throw new Error(
      "Refusing to operate on a container without the surf=1 label"
    );
  }
  return info;
}

async function waitForHttpOk(
  url: string,
  timeoutMs = 8000,
  intervalMs = 200
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // noVNC not up yet, keep polling.
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error("Timed out waiting for noVNC to become ready");
}

const round = (n: number) => String(Math.round(n));

const expiryTimers = new Map<string, NodeJS.Timeout>();

function armExpiry(containerId: string, timeoutMs: number) {
  const existing = expiryTimers.get(containerId);
  if (existing) clearTimeout(existing);

  const timer = setTimeout(() => {
    docker(["kill", containerId]).catch(() => {});
    expiryTimers.delete(containerId);
  }, timeoutMs);
  timer.unref();
  expiryTimers.set(containerId, timer);
}

function disarmExpiry(containerId: string) {
  const existing = expiryTimers.get(containerId);
  if (existing) {
    clearTimeout(existing);
    expiryTimers.delete(containerId);
  }
}

class DockerDesktopSandbox implements DesktopSandbox {
  constructor(
    public readonly sandboxId: string,
    private readonly hostPort: string
  ) {}

  private exec(args: string[]): Promise<Buffer> {
    return docker(["exec", "--user", "surf", this.sandboxId, ...args]);
  }

  async screenshot(): Promise<Uint8Array> {
    return this.exec(["import", "-window", "root", "png:-"]);
  }

  async leftClick(x: number, y: number) {
    await this.exec(["xdotool", "mousemove", round(x), round(y), "click", "1"]);
  }

  async rightClick(x: number, y: number) {
    await this.exec(["xdotool", "mousemove", round(x), round(y), "click", "3"]);
  }

  async middleClick(x: number, y: number) {
    await this.exec(["xdotool", "mousemove", round(x), round(y), "click", "2"]);
  }

  async doubleClick(x: number, y: number) {
    await this.exec([
      "xdotool",
      "mousemove",
      round(x),
      round(y),
      "click",
      "--repeat",
      "2",
      "--delay",
      "120",
      "1",
    ]);
  }

  async moveMouse(x: number, y: number) {
    await this.exec(["xdotool", "mousemove", round(x), round(y)]);
  }

  async drag(start: [number, number], end: [number, number]) {
    await this.exec([
      "xdotool",
      "mousemove",
      round(start[0]),
      round(start[1]),
      "mousedown",
      "1",
      "mousemove",
      round(end[0]),
      round(end[1]),
      "mouseup",
      "1",
    ]);
  }

  async scroll(direction: "up" | "down", amount: number) {
    await this.exec([
      "xdotool",
      "click",
      "--repeat",
      String(amount),
      "--delay",
      "50",
      direction === "up" ? "4" : "5",
    ]);
  }

  async write(text: string, options?: { chunkSize: number; delayInMs: number }) {
    const chunkSize = options?.chunkSize ?? 25;
    const delayInMs = options?.delayInMs ?? 75;

    for (let i = 0; i < text.length; i += chunkSize) {
      await this.exec([
        "xdotool",
        "type",
        "--delay",
        "12",
        "--",
        text.slice(i, i + chunkSize),
      ]);
      if (i + chunkSize < text.length) {
        await new Promise((resolve) => setTimeout(resolve, delayInMs));
      }
    }
  }

  async press(keys: string | string[]) {
    const combo = Array.isArray(keys) ? keys.join("+") : keys;
    await this.exec(["xdotool", "key", combo]);
  }

  async setTimeout(timeoutMs: number) {
    armExpiry(this.sandboxId, timeoutMs);
  }

  async kill() {
    disarmExpiry(this.sandboxId);
    await docker(["kill", this.sandboxId]).catch(() => {});
  }

  getStreamUrl() {
    return `http://127.0.0.1:${this.hostPort}/vnc.html?autoconnect=true&resize=scale`;
  }
}

export const dockerProvider: SandboxProvider = {
  getConfigError() {
    try {
      execFileSync("docker", ["version", "--format", "{{.Server.Version}}"], {
        stdio: "ignore",
      });
    } catch {
      return "Docker CLI not found or the Docker daemon is not reachable. Install Docker and make sure it's running to use SANDBOX_PROVIDER=docker.";
    }

    try {
      execFileSync("docker", ["image", "inspect", IMAGE_NAME], {
        stdio: "ignore",
      });
    } catch {
      return `Docker image "${IMAGE_NAME}" not found locally. Build it: docker build -t ${IMAGE_NAME} docker/surf-desktop`;
    }

    return undefined;
  },

  async create({ resolution, timeoutMs }: CreateSandboxOptions) {
    const [width, height] = resolution;

    const raw = await docker([
      "run",
      "-d",
      "--rm",
      "--label",
      SURF_LABEL,
      "--shm-size=1g",
      "-p",
      "127.0.0.1::6080",
      "-e",
      `RESOLUTION_WIDTH=${width}`,
      "-e",
      `RESOLUTION_HEIGHT=${height}`,
      IMAGE_NAME,
    ]);
    const containerId = raw.toString("utf8").trim();

    const info = await inspect(containerId);
    const hostPort = extractHostPort(info);

    const sandbox = new DockerDesktopSandbox(containerId, hostPort);
    await waitForHttpOk(`http://127.0.0.1:${hostPort}/vnc.html`);
    await sandbox.setTimeout(timeoutMs);

    return sandbox;
  },

  async connect(sandboxId: string) {
    const info = await getVerifiedContainer(sandboxId);
    return new DockerDesktopSandbox(sandboxId, extractHostPort(info));
  },
};
