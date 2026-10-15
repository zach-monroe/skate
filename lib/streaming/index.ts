import { DesktopSandbox } from "@/lib/sandbox";
import { SSEEvent } from "@/types/api";
import { ComputerInteractionStreamerFacade } from "./types";
import { OpenAIComputerStreamer } from "./openai";
import { LocalComputerStreamer } from "./local";

export {
  ComputerInteractionStreamerFacade,
  type ComputerInteractionStreamerFacadeStreamProps,
} from "./types";

export function getComputerStreamer(
  desktop: DesktopSandbox,
  resolution: [number, number]
): ComputerInteractionStreamerFacade {
  const name = process.env.MODEL_PROVIDER || "openai";

  switch (name) {
    case "openai":
      return new OpenAIComputerStreamer(desktop, resolution);
    case "local":
      return new LocalComputerStreamer(desktop, resolution);
    default:
      throw new Error(`Unknown MODEL_PROVIDER: ${name}`);
  }
}

export function formatSSE(event: SSEEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

export function createStreamingResponse(
  generator: AsyncGenerator<SSEEvent>
): Response {
  const stream = new ReadableStream({
    async start(controller) {
      for await (const chunk of generator) {
        controller.enqueue(new TextEncoder().encode(formatSSE(chunk)));
      }
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
