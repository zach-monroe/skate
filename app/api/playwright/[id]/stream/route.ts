import { getPlaywrightSandbox } from "@/lib/sandbox/playwright";

export const dynamic = "force-dynamic";
export const maxDuration = 800;

const BOUNDARY = "skateframe";
const FRAME_INTERVAL_MS = 250;

// View-only live feed of the sandbox browser as multipart/x-mixed-replace JPEGs.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const sandbox = getPlaywrightSandbox(id);

  if (!sandbox) {
    return new Response("Sandbox not found", { status: 404 });
  }

  const encoder = new TextEncoder();
  let cancelled = false;

  const stream = new ReadableStream({
    async start(controller) {
      request.signal.addEventListener("abort", () => {
        cancelled = true;
      });

      while (!cancelled) {
        try {
          const frame = await sandbox.screenshotJpeg();
          if (cancelled) break;
          controller.enqueue(
            encoder.encode(
              `--${BOUNDARY}\r\nContent-Type: image/jpeg\r\nContent-Length: ${frame.length}\r\n\r\n`
            )
          );
          controller.enqueue(frame);
          controller.enqueue(encoder.encode("\r\n"));
        } catch {
          // Sandbox was stopped or expired
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, FRAME_INTERVAL_MS));
      }

      try {
        controller.close();
      } catch {
        // already closed by cancel
      }
    },
    cancel() {
      cancelled = true;
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": `multipart/x-mixed-replace; boundary=${BOUNDARY}`,
      "Cache-Control": "no-cache, no-store",
    },
  });
}
