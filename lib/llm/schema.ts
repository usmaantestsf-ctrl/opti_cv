import { z } from "zod";

export const Op = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("reorder"),
    ids: z.array(z.number().int()).min(2).max(40),
  }),
  z.object({
    type: z.literal("rewrite"),
    id: z.number().int(),
    text: z.string().min(1).max(2000),
  }),
  z.object({
    type: z.literal("delete"),
    id: z.number().int(),
  }),
]);

export const Out = z.object({
  operations: z.array(Op).max(100),
  notes: z.array(z.string().max(400)).max(50),
});

export type Operation = z.infer<typeof Op>;
export type LLMOutput = z.infer<typeof Out>;
