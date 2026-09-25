# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## USER NOTES

### Goal (in progress)

I want to make this entire project work WITHOUT using external services. Meaning it will be configured to use local services only. (Users will bring their own self-hosted LLMs, etc.) I want to use basic containerization to provide the same core functionality of SURF without needing an API key or service with E2B

Decisions so far:
- E2B and OpenAI stay selectable alongside the new local options (not removed).
- The Next.js app runs on the host (`npm run dev`/`start`). Only the desktop sandboxes run in Docker. Label sandbox containers `surf=1` and refuse to connect to or kill unlabeled ones (the app has no auth and takes `sandboxId` from the client). Bind noVNC ports to `127.0.0.1`.
- The target model is Gemma, served through a web UI's OpenAI-compatible endpoint. Don't rely on native tool calling: prefer a strict JSON action validated with `zod`, and reuse `ResolutionScaler` for screenshot downscaling.

Plan:
1. **Done:** sandbox abstraction (`lib/sandbox/`) with the E2B adapter behind it.
2. Docker sandbox provider: Xvfb + window manager + Firefox + x11vnc/noVNC image; input via `xdotool`, screenshots via `scrot`/`import`; `sandboxId` is the container ID.
3. `ComputerInteractionStreamerFacade` for OpenAI-compatible local models, selected by env var.
4. Config, `.env.example`, `docker-compose`/README updates.

Where the code is still coupled to E2B/OpenAI:

- **E2B coupling** (now isolated in `lib/sandbox/e2b.ts`)
  - Everything else uses the `DesktopSandbox`/`SandboxProvider` interfaces from `lib/sandbox/types.ts`, and `getSandboxProvider()` picks the provider from `SANDBOX_PROVIDER` (default `e2b`, the only one registered so far).
  - `app/page.tsx` embeds the stream URL in an iframe. A Docker provider must supply a browser-viewable stream (e.g. noVNC).
- **OpenAI coupling**
  - The agent loop relies on the Responses API `computer` tool and `previous_response_id`.
  - Most self-hosted servers (Ollama, vLLM, llama.cpp) only expose an OpenAI-compatible chat completions API with no built-in `computer` tool. Local models need a different loop: a tool/JSON schema for click, type, etc., a prompt describing it, and manually managed conversation history.
- **`ResolutionScaler`** is currently unused but becomes relevant, since smaller local vision models usually need downscaled screenshots and coordinate mapping.
- **Config**
  - `E2B_API_KEY` and `OPENAI_API_KEY` should become optional.
  - New variables are needed for the LLM base URL and model name.
  - `OPENAI_MODEL` is currently hardcoded in `lib/config.ts`.

## Commands

- `npm run dev` — Next.js dev server on http://localhost:3000 (output piped through `pino-pretty`)
- `npm run build` / `npm run start` — production build / server
- `npm run lint` — `next lint` (extends `next/core-web-vitals`)

There is no test runner configured. `lib/streaming/resolution.test.ts` is a standalone script (it `console.log`s results), not a Jest/Vitest suite.

Env vars (copy `.env.example` to `.env.local`): `E2B_API_KEY`, `OPENAI_API_KEY`, optional `SANDBOX_PROVIDER` (defaults to `e2b`), optional `NEXT_PUBLIC_GTM_ID`, optional `LOG_LEVEL` (defaults to `debug`).

## Architecture

Surf is a Next.js 15 App Router app (React 19, Tailwind 4, `@/*` path alias to repo root) where an OpenAI computer-use agent drives a desktop sandbox (currently E2B Desktop, a Linux VM streamed to the browser over VNC) through the `DesktopSandbox` interface in `lib/sandbox/`.

### Request flow

1. `app/page.tsx` measures the desktop iframe wrapper and passes `resolution: [w, h]` with each message. The sandbox is created at that size.
2. `lib/chat-context.tsx` (`ChatProvider`) POSTs `{messages, sandboxId, resolution}` to `/api/chat` and parses the SSE response into `ChatMessage`s. The `onSandboxCreated` callback hands the `sandboxId`/`vncUrl` back to `page.tsx`.
3. `app/api/chat/route.ts` creates a sandbox via the configured `SandboxProvider` if no `sandboxId` was sent (otherwise connects to the existing one). It emits a `SANDBOX_CREATED` event first for new sandboxes, then delegates to a streamer. `maxDuration = 800`.
4. `lib/streaming/openai.ts` (`OpenAIComputerStreamer`) runs the agent loop against the OpenAI **Responses API** with the GA `computer` tool (model set in `lib/config.ts` as `OPENAI_MODEL`). Each turn it:
   - executes every action in each `computer_call` via `executeAction`, which maps to `DesktopSandbox` calls
   - captures a screenshot
   - sends a `computer_call_output` back using `previous_response_id`
   
   The loop ends when a response has no computer calls, or when the abort signal fires (client disconnect or Stop).
5. `lib/streaming/index.ts` defines `ComputerInteractionStreamerFacade` (the abstraction for other model backends) and `createStreamingResponse`, which turns an `AsyncGenerator<SSEEvent>` into a `text/event-stream` response.

### Things that span files

- **SSE event contract**: `types/api.ts` (`SSEEventType`, `SSEEvent`) is the shared contract between the server generator and `lib/chat-context.tsx`. `types/chat.ts` holds the client-side message types. Adding an event type means touching both sides.
- **Action types**: `types/openai.ts` defines the computer-action shapes. GPT-5.4 can return batched `actions[]` per call, and `normalizeComputerCall` also handles the legacy single `action`. Screenshot timing depends on the batch: trailing `wait` actions suppress the fallback delay, and click/scroll/async-keypress batches get a short delay (see `shouldApplyFallbackDelay`).
- **Sandbox lifecycle**: sandbox timeout is `SANDBOX_TIMEOUT_MS` (5 min) and is reset on every `/api/chat` call. `app/actions.ts` server actions (`increaseTimeout`, `stopSandboxAction`) are called from `page.tsx` for the countdown timer and the Stop button. The client owns `sandboxId` and sends it back on each request, so there is no server-side session state.
- **Resolution**: `lib/streaming/resolution.ts` (`ResolutionScaler`, with bounds in `lib/config.ts`) is currently **not used** by the OpenAI path. Screenshots are sent at original size and the model infers display dimensions from them.
- **Logging**: use `logDebug`/`logError`/`logSuccess`/`logWarning` from `lib/logger.ts` rather than `console`. The logger is plain `pino` with no transport, because worker-thread transports crash in the Next.js server runtime. Pretty-printing happens only via the `| pino-pretty` pipe in the npm scripts.

### UI

`components/ui/*` are shadcn-style primitives (see `components.json`). Feature components live in `components/` and `components/chat/`. Styles are in `styles/` (`globals.css`, `theme.css`, `variables.css`).
