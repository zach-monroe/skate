import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { DesktopSandbox } from "@/lib/sandbox";
import { SSEEvent, SSEEventType, ActionResponse, sleep } from "@/types/api";
import {
  ComputerInteractionStreamerFacade,
  ComputerInteractionStreamerFacadeStreamProps,
} from "@/lib/streaming/types";
import { ResolutionScaler } from "@/lib/streaming/resolution";
import {
  LocalComputerAction,
  LocalModelTurn,
  LocalModelTurnSchema,
} from "@/lib/streaming/actions";
import { logDebug, logError } from "../logger";
import {
  LOCAL_LLM_API_KEY,
  LOCAL_LLM_BASE_URL,
  LOCAL_LLM_JSON_MODE,
  LOCAL_LLM_MODEL,
} from "../config";

const TYPE_ACTION_CHUNK_SIZE = 50;
const TYPE_ACTION_DELAY_MS = 25;
const WAIT_DELAY_MS = 800;
const SETTLE_DELAY_MS = 300;
const MAX_TURN_ATTEMPTS = 3;
const OLD_SCREENSHOT_PLACEHOLDER = "[earlier screenshot omitted]";

function buildInstructions([width, height]: [number, number]): string {
  return `
You are Skate, a helpful assistant that can use a computer to help the user with their tasks.
You control a Linux desktop sandbox. You see it through screenshots and act on it one step at a time.
The desktop has common applications installed, such as Firefox, a terminal, a file manager and a text editor.

Every screenshot you receive is exactly ${width}x${height} pixels. Coordinates are pixels from the top-left corner (0,0);
x must be within 0-${width - 1} and y within 0-${height - 1}.

You MUST reply with a single JSON object and nothing else (no markdown, no prose outside the JSON):
{ "reasoning": string, "action": <action> | null }

"reasoning" briefly explains what you see and why you chose the action.
"action" is exactly ONE of the following, or null when the task is complete:
- { "type": "click", "button": "left" | "right" | "wheel", "x": number, "y": number }
- { "type": "double_click", "x": number, "y": number }
- { "type": "drag", "path": [{ "x": number, "y": number }, { "x": number, "y": number }] }  (exactly a start and an end point)
- { "type": "keypress", "keys": string[] }  (e.g. ["ctrl", "l"] or ["Enter"])
- { "type": "move", "x": number, "y": number }
- { "type": "scroll", "scroll_x": number, "scroll_y": number, "x": number, "y": number }  (x,y is where the mouse is placed; scroll_x/scroll_y are scroll amounts, not positions; negative scroll_y scrolls up, positive scrolls down)
- { "type": "type", "text": string }
- { "type": "wait" }
- { "type": "screenshot" }

After each action you receive a new screenshot. When the task is done (or cannot be done), set "action" to null and
put a final summary for the user in "reasoning".

Example reply:
{"reasoning": "The Firefox icon is at the bottom left; I will open it.", "action": {"type": "click", "button": "left", "x": 40, "y": ${height - 30}}}`;
}

function extractJson(text: string): unknown {
  let body = text.trim();
  const fenced = body.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenced) body = fenced[1];
  return JSON.parse(body);
}

export class LocalComputerStreamer
  implements ComputerInteractionStreamerFacade {
  public instructions: string;
  public desktop: DesktopSandbox;
  public resolution: [number, number];

  private client: OpenAI;
  private model: string;
  private resolutionScaler: ResolutionScaler;

  constructor(desktop: DesktopSandbox, resolution: [number, number]) {
    if (!LOCAL_LLM_BASE_URL || !LOCAL_LLM_MODEL) {
      throw new Error(
        "MODEL_PROVIDER=local requires LOCAL_LLM_BASE_URL and LOCAL_LLM_MODEL to be set"
      );
    }

    this.desktop = desktop;
    this.resolution = resolution;
    this.model = LOCAL_LLM_MODEL;
    this.client = new OpenAI({
      baseURL: LOCAL_LLM_BASE_URL,
      apiKey: LOCAL_LLM_API_KEY,
    });
    this.resolutionScaler = new ResolutionScaler(desktop, resolution);
    this.instructions = buildInstructions(
      this.resolutionScaler.getScaledResolution()
    );
  }

  async executeAction(action: LocalComputerAction): Promise<ActionResponse | void> {
    const desktop = this.desktop;
    const scale = (x: number, y: number) =>
      this.resolutionScaler.scaleToOriginalSpace([x, y]);

    switch (action.type) {
      case "screenshot":
        break;
      case "double_click": {
        const [x, y] = scale(action.x, action.y);
        await desktop.doubleClick(x, y);
        break;
      }
      case "click": {
        const [x, y] = scale(action.x, action.y);
        if (action.button === "left") await desktop.leftClick(x, y);
        else if (action.button === "right") await desktop.rightClick(x, y);
        else if (action.button === "wheel") await desktop.middleClick(x, y);
        break;
      }
      case "type":
        await desktop.write(action.text, {
          chunkSize: TYPE_ACTION_CHUNK_SIZE,
          delayInMs: TYPE_ACTION_DELAY_MS,
        });
        break;
      case "keypress":
        await desktop.press(action.keys);
        break;
      case "move": {
        const [x, y] = scale(action.x, action.y);
        await desktop.moveMouse(x, y);
        break;
      }
      case "scroll": {
        // scroll_x/scroll_y are deltas, so only the position is scaled
        const [x, y] = scale(action.x, action.y);
        await desktop.moveMouse(x, y);
        if (action.scroll_y < 0) {
          await desktop.scroll("up", Math.abs(action.scroll_y));
        } else if (action.scroll_y > 0) {
          await desktop.scroll("down", action.scroll_y);
        }
        break;
      }
      case "wait":
        await sleep(WAIT_DELAY_MS);
        break;
      case "drag": {
        const [start, end] = action.path.map((p) => scale(p.x, p.y));
        await desktop.drag(start, end);
        break;
      }
    }
  }

  private async screenshotMessage(
    text: string
  ): Promise<ChatCompletionMessageParam> {
    const png = await this.resolutionScaler.takeScreenshot();
    return {
      role: "user",
      content: [
        { type: "text", text },
        {
          type: "image_url",
          image_url: {
            url: `data:image/png;base64,${png.toString("base64")}`,
          },
        },
      ],
    };
  }

  /** Keeps only the most recent user screenshot; older ones become text. */
  private pruneScreenshots(
    history: ChatCompletionMessageParam[]
  ): ChatCompletionMessageParam[] {
    let lastUserIndex = -1;
    history.forEach((m, i) => {
      if (m.role === "user") lastUserIndex = i;
    });

    return history.map((message, i) => {
      if (
        message.role !== "user" ||
        i === lastUserIndex ||
        !Array.isArray(message.content)
      ) {
        return message;
      }
      return {
        ...message,
        content: message.content.map((part) =>
          part.type === "image_url"
            ? { type: "text" as const, text: OLD_SCREENSHOT_PLACEHOLDER }
            : part
        ),
      };
    });
  }

  /** Requests one turn, retrying with a correction when the reply is invalid. */
  private async requestTurn(
    history: ChatCompletionMessageParam[]
  ): Promise<{ turn: LocalModelTurn; raw: string }> {
    const base = this.pruneScreenshots(history);
    let correction: ChatCompletionMessageParam[] = [];
    let lastError = "";

    for (let attempt = 1; attempt <= MAX_TURN_ATTEMPTS; attempt++) {
      const completion = await this.client.chat.completions.create({
        model: this.model,
        messages: [...base, ...correction],
        ...(LOCAL_LLM_JSON_MODE
          ? { response_format: { type: "json_object" as const } }
          : {}),
      });
      const raw = completion.choices[0]?.message?.content ?? "";

      try {
        const parsed = LocalModelTurnSchema.safeParse(extractJson(raw));
        if (parsed.success) return { turn: parsed.data, raw };
        lastError = parsed.error.message;
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      }

      logDebug("LOCAL_LLM_INVALID_TURN", { attempt, error: lastError, raw });
      // Appended to this request only; never persisted in the transcript
      correction = [
        { role: "assistant", content: raw },
        {
          role: "user",
          content: `Your reply was invalid: ${lastError}\nReply again with ONLY a single JSON object of the form {"reasoning": string, "action": <action> | null}. No markdown, no other text.`,
        },
      ];
    }

    throw new Error(
      `Local model failed to produce a valid action after ${MAX_TURN_ATTEMPTS} attempts: ${lastError}`
    );
  }

  async *stream(
    props: ComputerInteractionStreamerFacadeStreamProps
  ): AsyncGenerator<SSEEvent> {
    const { messages, signal } = props;
    let turnIndex = 0;

    try {
      logDebug("LOCAL_STREAM_START", {
        model: this.model,
        resolution: this.resolution,
        scaled_resolution: this.resolutionScaler.getScaledResolution(),
        message_count: messages.length,
      });

      const history: ChatCompletionMessageParam[] = [
        { role: "system", content: this.instructions },
        ...messages.map((m) => ({ role: m.role, content: m.content })),
        await this.screenshotMessage("Here is the current screen."),
      ];

      while (true) {
        if (signal.aborted) {
          yield {
            type: SSEEventType.DONE,
            content: "Generation stopped by user",
          };
          break;
        }

        turnIndex += 1;
        const { turn, raw } = await this.requestTurn(history);
        history.push({ role: "assistant", content: raw });

        logDebug("LOCAL_TURN", { turnIndex, action: turn.action?.type ?? null });

        if (turn.reasoning) {
          yield { type: SSEEventType.REASONING, content: turn.reasoning };
        }

        if (turn.action === null) {
          yield { type: SSEEventType.DONE };
          break;
        }

        yield { type: SSEEventType.ACTION, action: turn.action };
        await this.executeAction(turn.action as LocalComputerAction);
        yield { type: SSEEventType.ACTION_COMPLETED };

        await sleep(SETTLE_DELAY_MS);
        history.push(
          await this.screenshotMessage("Here is the screen after your action.")
        );
      }
    } catch (error) {
      logError("LOCAL_STREAMER", error);
      yield {
        type: SSEEventType.ERROR,
        content:
          "An error occurred with the local model. Check that it is running and returning valid JSON actions.",
      };
    }
  }
}
