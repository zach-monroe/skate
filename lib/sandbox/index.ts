import { e2bProvider } from "./e2b";
import { SandboxProvider } from "./types";

export type {
  CreateSandboxOptions,
  DesktopSandbox,
  SandboxProvider,
} from "./types";

export function getSandboxProvider(): SandboxProvider {
  const name = process.env.SANDBOX_PROVIDER || "e2b";

  switch (name) {
    case "e2b":
      return e2bProvider;
    default:
      throw new Error(`Unknown SANDBOX_PROVIDER: ${name}`);
  }
}
