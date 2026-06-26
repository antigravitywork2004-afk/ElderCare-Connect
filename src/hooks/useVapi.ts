import { useCallback, useEffect, useRef, useState } from "react";
import { getVapi, COMPANION_ASSISTANT_CONFIG } from "@/lib/vapi";

export type VapiCallStatus = "idle" | "connecting" | "active" | "ending";

/**
 * Hook that manages a VAPI voice call session.
 *
 * Usage:
 *   const { status, startCall, stopCall, isMuted, toggleMute, isAvailable } = useVapi();
 */
export function useVapi() {
  const vapi = useRef(getVapi());
  const [status, setStatus] = useState<VapiCallStatus>("idle");
  const [isMuted, setIsMuted] = useState(false);
  const [volumeLevel, setVolumeLevel] = useState(0);

  const isAvailable = vapi.current !== null;

  useEffect(() => {
    const v = vapi.current;
    if (!v) return;

    const onCallStart = () => setStatus("active");
    const onCallEnd = () => {
      setStatus("idle");
      setIsMuted(false);
      setVolumeLevel(0);
    };
    const onVolume = (vol: number) => setVolumeLevel(vol);
    const onError = (err: unknown) => {
      console.error("[VAPI] error:", err);
      setStatus("idle");
    };

    v.on("call-start", onCallStart);
    v.on("call-end", onCallEnd);
    v.on("volume-level", onVolume);
    v.on("error", onError);

    return () => {
      v.off("call-start", onCallStart);
      v.off("call-end", onCallEnd);
      v.off("volume-level", onVolume);
      v.off("error", onError);
    };
  }, []);

  const startCall = useCallback(async () => {
    const v = vapi.current;
    if (!v || status !== "idle") return;
    setStatus("connecting");
    try {
      await v.start(COMPANION_ASSISTANT_CONFIG as Parameters<typeof v.start>[0]);
    } catch (err) {
      console.error("[VAPI] failed to start:", err);
      setStatus("idle");
    }
  }, [status]);

  const stopCall = useCallback(() => {
    const v = vapi.current;
    if (!v) return;
    setStatus("ending");
    v.stop();
  }, []);

  const toggleMute = useCallback(() => {
    const v = vapi.current;
    if (!v || status !== "active") return;
    const next = !isMuted;
    v.setMuted(next);
    setIsMuted(next);
  }, [isMuted, status]);

  return { status, startCall, stopCall, isMuted, toggleMute, volumeLevel, isAvailable };
}
