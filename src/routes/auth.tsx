import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { toast } from "sonner";
import { Heart } from "lucide-react";

export const Route = createFileRoute("/auth")({
  ssr: false,
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [role, setRole] = useState<"parent" | "child">("parent");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    // Non-empty checks
    if (!email) { toast.error("Email is required."); return; }
    if (!password) { toast.error("Password is required."); return; }

    // Email format validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) { toast.error("Please enter a valid email address."); return; }

    // Confirm password check for signup
    if (mode === "signup") {
      if (!fullName.trim()) { toast.error("Full name is required."); return; }
      if (password !== confirmPassword) { toast.error("Passwords do not match."); return; }
      if (password.length < 6) { toast.error("Password must be at least 6 characters."); return; }
    }

    setLoading(true);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: `${window.location.origin}/dashboard`,
            data: { full_name: fullName, role },
          },
        });
        if (error) {
          if (error.message.toLowerCase().includes("user already registered") || error.message.toLowerCase().includes("already exists")) {
            toast.error("An account with this email already exists.");
          } else {
            toast.error(error.message);
          }
          return;
        }
        toast.success("Account created. Welcome!");
        navigate({ to: role === "parent" ? "/dashboard" : "/family" });
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) {
          toast.error("Invalid email or password.");
          return;
        }
        // Load user profile to decide redirect
        const { data: { user } } = await supabase.auth.getUser();
        const { data: profile } = await supabase
          .from("profiles")
          .select("role")
          .eq("id", user!.id)
          .single();
        navigate({ to: profile?.role === "parent" ? "/dashboard" : "/family" });
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Authentication failed. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function handleGoogle() {
    setLoading(true);
    const result = await lovable.auth.signInWithOAuth("google", {
      redirect_uri: window.location.origin + "/dashboard",
    });
    if (result.error) {
      toast.error("Google sign-in failed.");
      setLoading(false);
      return;
    }
    if (result.redirected) return;
    // After OAuth, redirect based on role
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", user.id)
        .single();
      navigate({ to: profile?.role === "parent" ? "/dashboard" : "/family" });
    } else {
      navigate({ to: "/dashboard" });
    }
  }

  return (
    <div className="min-h-screen grid lg:grid-cols-2">
      <aside className="hidden lg:flex flex-col justify-between p-12 bg-stone-900 text-white">
        <div className="flex items-center gap-3">
          <div className="size-9 rounded-lg bg-primary grid place-items-center font-bold">E</div>
          <span className="font-display text-xl">ElderCare Connect</span>
        </div>
        <div>
          <h1 className="font-display italic text-5xl leading-tight mb-6">
            Care that travels<br />the distance.
          </h1>
          <p className="text-white/60 max-w-md">
            Look after the people who looked after you — medicines, daily check-ins,
            emergencies and visits, all in one calm place the whole family shares.
          </p>
        </div>
        <div className="flex items-center gap-3 text-xs font-mono uppercase tracking-widest text-white/40">
          <Heart className="size-3.5" /> A family-first health companion
        </div>
      </aside>

      <main className="flex items-center justify-center p-6 sm:p-12">
        <div className="w-full max-w-sm space-y-8 animate-fade-in">
          <div>
            <h2 className="font-display text-3xl font-bold">
              {mode === "signup" ? "Create your account" : "Welcome back"}
            </h2>
            <p className="text-sm text-muted-foreground mt-2">
              {mode === "signup" ? "Set up care for yourself or a loved one." : "Sign in to continue."}
            </p>
          </div>

          <Button onClick={handleGoogle} disabled={loading} variant="outline" className="w-full h-11 rounded-xl">
            {mode === "signup" ? "Create account with Google" : "Sign in with Google"}
          </Button>

          <div className="flex items-center gap-3 text-xs font-mono text-muted-foreground uppercase">
            <div className="h-px flex-1 bg-border" /> or <div className="h-px flex-1 bg-border" />
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === "signup" && (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="name">Full name</Label>
                  <Input
                    id="name"
                    aria-label="Full name"
                    required
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="Martha Jennings"
                    className="h-11 rounded-xl"
                  />
                </div>
                <div className="space-y-2">
                  <Label>I am a</Label>
                  <RadioGroup value={role} onValueChange={(v) => setRole(v as "parent" | "child")} className="grid grid-cols-2 gap-2">
                    <label className={`rounded-xl border p-3 cursor-pointer text-sm ${role === "parent" ? "border-primary bg-primary/5" : "border-border"}`}>
                      <RadioGroupItem value="parent" className="sr-only" />
                      <div className="font-semibold">Parent</div>
                      <div className="text-xs text-muted-foreground">Receiving care</div>
                    </label>
                    <label className={`rounded-xl border p-3 cursor-pointer text-sm ${role === "child" ? "border-primary bg-primary/5" : "border-border"}`}>
                      <RadioGroupItem value="child" className="sr-only" />
                      <div className="font-semibold">Family member</div>
                      <div className="text-xs text-muted-foreground">Monitoring a parent</div>
                    </label>
                  </RadioGroup>
                </div>
              </>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="email">Email address</Label>
              <Input
                id="email"
                type="email"
                aria-label="Email address"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="h-11 rounded-xl"
                placeholder="you@example.com"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pw">Password {mode === "signup" && <span className="text-xs text-muted-foreground">(min 6 chars)</span>}</Label>
              <Input
                id="pw"
                type="password"
                aria-label="Password"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="h-11 rounded-xl"
              />
            </div>
            {mode === "signup" && (
              <div className="space-y-1.5">
                <Label htmlFor="pw-confirm">Confirm password</Label>
                <Input
                  id="pw-confirm"
                  type="password"
                  aria-label="Confirm password"
                  required
                  minLength={6}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="h-11 rounded-xl"
                />
              </div>
            )}
            <Button type="submit" disabled={loading} className="w-full h-11 rounded-xl bg-primary text-primary-foreground hover:bg-primary/90">
              {loading ? "Please wait…" : mode === "signup" ? "Create account" : "Sign in"}
            </Button>
          </form>

          <p className="text-center text-sm text-muted-foreground">
            {mode === "signup" ? "Already have an account?" : "New here?"}{" "}
            <button
              onClick={() => {
                setMode(mode === "signup" ? "signin" : "signup");
                setPassword("");
                setConfirmPassword("");
              }}
              className="text-primary font-semibold hover:underline"
            >
              {mode === "signup" ? "Sign in" : "Create one"}
            </button>
          </p>
        </div>
      </main>
    </div>
  );
}