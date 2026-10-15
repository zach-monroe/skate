import { z } from "zod";
import { OpenAIComputerAction } from "@/types/openai";

const point = z.object({ x: z.number(), y: z.number() });

// Field-for-field mirror of OpenAIComputerAction so validated actions can be
// emitted as ACTION SSE events unchanged.
export const LocalActionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("click"),
    button: z.enum(["left", "right", "wheel"]),
    x: z.number(),
    y: z.number(),
  }),
  z.object({ type: z.literal("double_click"), x: z.number(), y: z.number() }),
  z.object({
    type: z.literal("drag"),
    path: z.array(point).length(2),
  }),
  z.object({ type: z.literal("keypress"), keys: z.array(z.string()).min(1) }),
  z.object({ type: z.literal("move"), x: z.number(), y: z.number() }),
  z.object({
    type: z.literal("scroll"),
    scroll_x: z.number(),
    scroll_y: z.number(),
    x: z.number(),
    y: z.number(),
  }),
  z.object({ type: z.literal("type"), text: z.string() }),
  z.object({ type: z.literal("wait") }),
  z.object({ type: z.literal("screenshot") }),
]);

export const LocalModelTurnSchema = z.object({
  reasoning: z.string(),
  // null means the task is finished
  action: LocalActionSchema.nullable(),
});

export type LocalComputerAction = z.infer<typeof LocalActionSchema> &
  OpenAIComputerAction;
export type LocalModelTurn = z.infer<typeof LocalModelTurnSchema>;
