import { DesktopSandbox, getSandboxProvider } from "@/lib/sandbox";
import { SSEEvent, SSEEventType } from "@/types/api";
import {
  ComputerInteractionStreamerFacade,
  createStreamingResponse,
} from "@/lib/streaming";
import { SANDBOX_TIMEOUT_MS } from "@/lib/config";
import { OpenAIComputerStreamer } from "@/lib/streaming/openai";
import { logError } from "@/lib/logger";

export const maxDuration = 800;

export async function POST(request: Request) {
  const abortController = new AbortController();
  const { signal } = abortController;

  request.signal.addEventListener("abort", () => {
    abortController.abort();
  });

  const {
    messages,
    sandboxId,
    resolution,
  } = await request.json();

  const provider = getSandboxProvider();
  const configError = provider.getConfigError();

  if (configError) {
    return new Response(configError, { status: 500 });
  }

  let desktop: DesktopSandbox | undefined;
  let activeSandboxId = sandboxId;
  let vncUrl: string | undefined;

  try {
    if (!activeSandboxId) {
      const newSandbox = await provider.create({
        resolution,
        timeoutMs: SANDBOX_TIMEOUT_MS,
      });

      activeSandboxId = newSandbox.sandboxId;
      vncUrl = newSandbox.getStreamUrl();
      desktop = newSandbox;
    } else {
      desktop = await provider.connect(activeSandboxId);
    }

    if (!desktop) {
      return new Response("Failed to connect to sandbox", { status: 500 });
    }

    desktop.setTimeout(SANDBOX_TIMEOUT_MS);

    try {
      const streamer: ComputerInteractionStreamerFacade =
        new OpenAIComputerStreamer(desktop, resolution);

      if (!sandboxId && activeSandboxId && vncUrl) {
        async function* stream(): AsyncGenerator<SSEEvent> {
          yield {
            type: SSEEventType.SANDBOX_CREATED,
            sandboxId: activeSandboxId,
            vncUrl: vncUrl as string,
          };

          yield* streamer.stream({ messages, signal });
        }

        return createStreamingResponse(stream());
      } else {
        return createStreamingResponse(streamer.stream({ messages, signal }));
      }
    } catch (error) {
      logError("Error from streaming service:", error);

      return new Response(
        "An error occurred with the AI service. Please try again.",
        { status: 500 }
      );
    }
  } catch (error) {
    logError("Error connecting to sandbox:", error);
    return new Response("Failed to connect to sandbox", { status: 500 });
  }
}
