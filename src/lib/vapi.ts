import Vapi from "@vapi-ai/web";

const publicKey = import.meta.env.VITE_VAPI_PUBLIC_KEY as string | undefined;

let _vapi: Vapi | null = null;

/**
 * Returns the shared Vapi instance. Created lazily so it only initialises
 * when the feature is first used and only when a public key is present.
 */
export function getVapi(): Vapi | null {
  if (!publicKey) {
    console.warn("[VAPI] VITE_VAPI_PUBLIC_KEY is not set — voice calls are disabled.");
    return null;
  }
  if (!_vapi) {
    _vapi = new Vapi(publicKey);
  }
  return _vapi;
}

/**
 * The assistant configuration for the ElderCare AI Companion voice call.
 * Uses the same friendly persona as the text companion.
 */
export const COMPANION_ASSISTANT_CONFIG = {
  model: {
    provider: "openai" as const,
    model: "gpt-4o",
    messages: [
      {
        role: "system" as const,
        content: `You are a warm, patient, and friendly AI companion for elderly people. 
Your role is to:
- Provide friendly conversation and emotional support
- Gently remind the user about medicines if they mention feeling unwell
- Encourage them to stay hydrated, rest well, and keep in touch with family
- Keep responses concise and easy to understand — short sentences, no jargon
- Speak slowly and clearly
- If the user seems confused or in distress, calmly encourage them to call a family member or use the SOS button in the app

You are NOT a doctor. Do not give medical diagnoses. If something sounds urgent, say "Please call your family or press the SOS button right away."`,
      },
    ],
  },
  voice: {
    provider: "11labs" as const,
    voiceId: "21m00Tcm4TlvDq8ikWAM", // Rachel — warm, clear, elderly-friendly
  },
  name: "ElderCare Companion",
  firstMessage: "Hello! It's lovely to hear your voice. How are you feeling today?",
} as const;
