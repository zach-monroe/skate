import { getPlaywrightSandbox } from "@/lib/sandbox/playwright";

export const dynamic = "force-dynamic";

// Page embedded in the desktop iframe; shows the live MJPEG stream.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!getPlaywrightSandbox(id)) {
    return new Response("Sandbox not found", { status: 404 });
  }

  const html = `<!doctype html>
<html>
  <body style="margin:0;height:100vh;background:#000;display:flex;align-items:center;justify-content:center">
    <img src="/api/playwright/${encodeURIComponent(id)}/stream" style="max-width:100%;max-height:100%;object-fit:contain" alt="Browser sandbox">
  </body>
</html>`;

  return new Response(html, { headers: { "Content-Type": "text/html" } });
}
