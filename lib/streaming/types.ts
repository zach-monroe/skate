import { DesktopSandbox } from "@/lib/sandbox";
import { SSEEvent, ActionResponse } from "@/types/api";

export interface ComputerInteractionStreamerFacadeStreamProps {
  signal: AbortSignal;
  messages: { role: "user" | "assistant"; content: string }[];
}

export abstract class ComputerInteractionStreamerFacade {
  abstract instructions: string;
  abstract desktop: DesktopSandbox;
  abstract resolution: [number, number];

  abstract stream(
    props: ComputerInteractionStreamerFacadeStreamProps
  ): AsyncGenerator<SSEEvent>;

  // action type is specific to the streamer implementation
  abstract executeAction(action: unknown): Promise<ActionResponse | void>;
}
