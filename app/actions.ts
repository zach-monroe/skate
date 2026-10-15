"use server";

import { SANDBOX_TIMEOUT_MS } from "@/lib/config";
import { getSandboxProvider } from "@/lib/sandbox";

export async function increaseTimeout(sandboxId: string) {
  try {
    const desktop = await getSandboxProvider().connect(sandboxId);
    await desktop.setTimeout(SANDBOX_TIMEOUT_MS); // 5 minutes
    return true;
  } catch (error) {
    console.error("Failed to increase timeout:", error);
    return false;
  }
}

export async function stopSandboxAction(sandboxId: string) {
  try {
    const desktop = await getSandboxProvider().connect(sandboxId);
    await desktop.kill();
    return true;
  } catch (error) {
    console.error("Failed to stop sandbox:", error);
    return false;
  }
}
