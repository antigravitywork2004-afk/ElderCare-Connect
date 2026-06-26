import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const ChatInput = z.object({
  parentName: z.string().max(120).optional(),
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().min(1).max(4000),
      }),
    )
    .min(1)
    .max(40),
});

const GATEWAY = "https://ai.gateway.lovable.dev/v1/chat/completions";

export const askCompanion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => ChatInput.parse(data))
  .handler(async ({ data }): Promise<{ reply?: string; error?: string; retryAfter?: number | null; message?: string }> => {
    const lovableKey = process.env.LOVABLE_API_KEY;
    const openaiKey = process.env.OPENAI_API_KEY;

    const system = `You are "Companion", a warm, patient and friendly AI friend for an elderly person${
      data.parentName ? ` named ${data.parentName}` : ""
    }. 
- Speak simply, kindly and slowly, in short sentences.
- Gently remind them about taking medicines, drinking water, eating, and resting when relevant.
- Answer everyday questions and offer companionship and encouragement.
- You are NOT a doctor. For any medical emergency or worrying symptom, calmly tell them to use the SOS button or call their family/doctor.
- Be cheerful and never condescending.`;

    let res: Response;
    if (lovableKey) {
      res = await fetch(GATEWAY, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Lovable-API-Key": lovableKey,
        },
        body: JSON.stringify({
          model: "google/gemini-3-flash-preview",
          messages: [{ role: "system", content: system }, ...data.messages],
        }),
      });
    } else if (openaiKey) {
      res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${openaiKey}`,
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [{ role: "system", content: system }, ...data.messages],
        }),
      });
    } else {
      return { error: "not_configured" };
    }

    if (res.status === 429) {
      const retryAfter = res.headers.get("Retry-After") || res.headers.get("retry-after");
      let retryAfterSeconds = retryAfter ? parseInt(retryAfter, 10) : null;
      if (retryAfterSeconds !== null && isNaN(retryAfterSeconds)) {
        retryAfterSeconds = null;
      }
      return { error: "rate_limit", retryAfter: retryAfterSeconds };
    }
    if (res.status === 402) {
      return { error: "credits_exhausted" };
    }
    if (!res.ok) {
      return { error: "request_failed", message: `AI request failed (${res.status})` };
    }

    const json = await res.json();
    const reply: string = json?.choices?.[0]?.message?.content ?? "I'm here for you. Could you say that again?";
    return { reply };
  });
