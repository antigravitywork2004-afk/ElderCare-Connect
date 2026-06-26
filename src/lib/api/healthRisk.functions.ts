import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const RiskInput = z.object({
  age: z.number().int().min(0).max(130),
  bpSystolic: z.number().int().min(40).max(300),
  bpDiastolic: z.number().int().min(20).max(200),
  sugarLevel: z.number().int().min(20).max(800),
  heartRate: z.number().int().min(0).max(300),
  activityLevel: z.enum(["low", "moderate", "high"]),
  weight: z.number().min(0).max(1000).optional(),
  oxygenLevel: z.number().int().min(0).max(100).optional(),
  wellnessData: z.string().max(1000).optional(),
});

export type RiskResult = {
  risk_level: "low" | "medium" | "high";
  risk_score: number;
  summary: string;
  recommendations: string;
};

const GATEWAY = "https://ai.gateway.lovable.dev/v1/chat/completions";

function calculateDeterministicRisk(
  age: number,
  systolic: number,
  diastolic: number,
  sugar: number,
  heartRate: number,
  activity: "low" | "moderate" | "high",
  oxygen?: number
): { risk_level: "low" | "medium" | "high"; risk_score: number } {
  // High Risk Criteria: BP >= 180/110 or sugar >= 250 or HR >= 120 or oxygen < 90
  const isHigh = 
    systolic >= 180 || 
    diastolic >= 110 || 
    sugar >= 250 || 
    heartRate >= 120 ||
    (oxygen !== undefined && oxygen < 90);

  if (isHigh) {
    return { risk_level: "high", risk_score: 85 };
  }

  // Medium Risk Criteria: BP >= 140/90 or sugar >= 126 or HR >= 85 or age >= 55 or activity low
  const isMedium = 
    systolic >= 140 || 
    diastolic >= 90 || 
    sugar >= 126 || 
    heartRate >= 85 || 
    age >= 55 ||
    activity === "low" ||
    (oxygen !== undefined && oxygen < 95);

  if (isMedium) {
    return { risk_level: "medium", risk_score: 55 };
  }

  // Low Risk: Otherwise
  return { risk_level: "low", risk_score: 15 };
}

export const predictHealthRisk = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => RiskInput.parse(data))
  .handler(async ({ data }): Promise<RiskResult> => {
    const lovableKey = process.env.LOVABLE_API_KEY;
    const openaiKey = process.env.OPENAI_API_KEY;

    // 1. Calculate deterministic risk to ensure exact matching with spec guidelines
    const detRisk = calculateDeterministicRisk(
      data.age,
      data.bpSystolic,
      data.bpDiastolic,
      data.sugarLevel,
      data.heartRate,
      data.activityLevel,
      data.oxygenLevel
    );

    // 2. Draft default summary/recommendations to use as fallback or prompt context
    const defaultData: Record<"low" | "medium" | "high", { summary: string, recommendations: string }> = {
      low: {
        summary: "Your health indicators appear stable. Continue regular exercise, healthy eating, and routine monitoring.",
        recommendations: "Your health indicators appear stable. Continue regular exercise, healthy eating, and routine monitoring.",
      },
      medium: {
        summary: "Consider improving activity levels, monitoring blood pressure regularly, and consulting a healthcare professional.",
        recommendations: "Consider improving activity levels, monitoring blood pressure regularly, and consulting a healthcare professional if values remain elevated.",
      },
      high: {
        summary: "Your readings indicate elevated health risk. Seek medical advice promptly.",
        recommendations: "Your readings indicate elevated health risk. Seek medical advice promptly and continue regular monitoring.",
      },
    };

    const fallback = defaultData[detRisk.risk_level];

    const prompt = `You are a preventive-health assistant for elderly patients. Analyse the following vitals and return a JSON object only.
    
Patient data:
- Age: ${data.age}
- Blood pressure: ${data.bpSystolic}/${data.bpDiastolic} mmHg
- Fasting blood sugar: ${data.sugarLevel} mg/dL
- Heart rate: ${data.heartRate} bpm
- Daily activity level: ${data.activityLevel}
${data.weight ? `- Weight: ${data.weight} kg\n` : ""}${data.oxygenLevel ? `- Oxygen Level: ${data.oxygenLevel}%\n` : ""}${data.wellnessData ? `- Additional wellness details: ${data.wellnessData}\n` : ""}

We have classified the patient as "${detRisk.risk_level} Risk" (Risk Score: ${detRisk.risk_score}/100) based on clinical thresholds.
You MUST generate a warm summary and actionable bullet recommendations corresponding to this risk level.
If the risk level is low, include: "Your health indicators appear stable. Continue regular exercise, healthy eating, and routine monitoring."
If the risk level is medium, include: "Consider improving activity levels, monitoring blood pressure regularly, and consulting a healthcare professional if values remain elevated."
If the risk level is high, include: "Your readings indicate elevated health risk. Seek medical advice promptly and continue regular monitoring."

Return ONLY valid JSON with this exact shape:
{"risk_level":"${detRisk.risk_level}","risk_score":${detRisk.risk_score},"summary":"one or two short sentences","recommendations":"actionable bullet points separated by newlines"}
`;

    let parsed: RiskResult = {
      risk_level: detRisk.risk_level,
      risk_score: detRisk.risk_score,
      summary: fallback.summary,
      recommendations: fallback.recommendations,
    };

    try {
      let res: Response | null = null;
      if (lovableKey) {
        res = await fetch(GATEWAY, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Lovable-API-Key": lovableKey,
          },
          body: JSON.stringify({
            model: "google/gemini-3-flash-preview",
            messages: [{ role: "user", content: prompt }],
            response_format: { type: "json_object" },
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
            messages: [{ role: "user", content: prompt }],
            response_format: { type: "json_object" },
          }),
        });
      }

      if (res && res.ok) {
        const json = await res.json();
        const content: string = json?.choices?.[0]?.message?.content ?? "{}";
        const resObj = JSON.parse(content);
        if (resObj.summary && resObj.recommendations) {
          parsed.summary = resObj.summary;
          parsed.recommendations = resObj.recommendations;
        }
      }
    } catch (e) {
      console.error("AI gateway failed, falling back to deterministic recommendations:", e);
    }

    // Double check that the final risk level and score strictly match our deterministic rules
    parsed.risk_level = detRisk.risk_level;
    parsed.risk_score = detRisk.risk_score;

    return parsed;
  });
