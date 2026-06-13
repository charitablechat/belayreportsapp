import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { GradientButton } from "@/components/ui/gradient-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Eye, EyeOff, WifiOff, ArrowRight } from "lucide-react";
import { usePWA } from "@/hooks/usePWA";
const belayReportsLogo = "/__l5e/assets-v1/8c7f8dfa-a725-400e-8f7e-c806cf7d7039/belay-reports-wide.gif";
import signinBg from "@/assets/signin-bg.jpg.asset.json";
import shimmerLogo from "@/assets/shimmer-wide-logo.gif.asset.json";
import { hasCachedSessionForOffline } from "@/lib/cached-auth";
import { createOfflineSession } from "@/lib/offline-auth";
import { createGuestSession } from "@/lib/guest-session";
import { getLastKnownAccount } from "@/lib/last-known-account";
import { isCredentialsDamaged, clearCredentialsDamagedFlag } from "@/lib/auth-resilience";
import { triggerHaptic } from "@/lib/haptics";
import { toast } from "sonner";
import { PasswordStrengthMeter } from "@/components/ui/password-strength-meter";

// Helper to get user-friendly error messages
const getAuthErrorMessage = (error: any): string => {
  const message = error?.message?.toLowerCase() || '';
  
  if (message.includes('invalid login credentials') || message.includes('invalid credentials')) {
    return 'Invalid email or password. Please check your credentials and try again.';
  }
  if (message.includes('email not confirmed')) {
    return 'Please check your email and confirm your account before signing in.';
  }
  if (message.includes('unable to validate email') || message.includes('invalid email')) {
    return 'Please enter a valid email address.';
  }
  if (message.includes('rate limit') || message.includes('too many requests')) {
    return 'Too many attempts. Please wait a moment and try again.';
  }
  if (message.includes('network') || message.includes('fetch')) {
    return 'Network error. Please check your connection and try again.';
  }
  if (message.includes('timed out') || message.includes('timeout')) {
    return 'Sign-in timed out. The service may be temporarily unavailable — please try again in a moment.';
  }
  
  return error?.message || 'An unexpected error occurred. Please try again.';
};

// Hard cap on how long we'll wait for Supabase auth to respond before giving
// the user a real error. The Supabase JS client has no built-in timeout, so
// when the auth API is unreachable (platform outage, DNS, paused project) the
// submit button would otherwise stay on "Please wait..." forever.
const SIGN_IN_TIMEOUT_MS = 20_000;

export default function Auth() {
  const navigate = useNavigate();
  const { isOnline } = usePWA();
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isForgotPassword, setIsForgotPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [credentialsDamaged] = useState<boolean>(() => isCredentialsDamaged());
  const [lastKnown] = useState(() => getLastKnownAccount());

  const handleGoToDashboard = () => {
    navigate("/dashboard");
  };

  const handleResumeLastKnown = async () => {
    if (!lastKnown) return;
    triggerHaptic('medium');
    try {
      await createOfflineSession(lastKnown.email ?? '', '');
      toast.success(`Continuing offline as ${lastKnown.email ?? 'your account'}.`);
      navigate('/dashboard', { replace: true });
    } catch {
      toast.error("Could not resume offline. Try guest mode or reconnect to sign in.");
    }
  };

  const handleGuestMode = () => {
    triggerHaptic('medium');
    createGuestSession();
    toast.success("Continuing as Guest. Your work stays on this device until you sign in.", {
      duration: 7000,
    });
    navigate('/dashboard', { replace: true });
  };

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    
    if (!email || !password) {
      setError("Please enter both email and password.");
      return;
    }

    if (password.length < 6) {
      setError("Password must be at least 6 characters long.");
      return;
    }

    triggerHaptic('medium');
    setLoading(true);

    try {
      // OFFLINE SIGN-IN: Allow sign-in while offline
      if (!isOnline) {
        await createOfflineSession(email, password);
        toast.success("Signed in offline. Credentials will be verified when you reconnect.");
        navigate("/dashboard", { replace: true });
        return;
      }

      const { data, error } = await Promise.race([
        supabase.auth.signInWithPassword({ email, password }),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error('Sign-in timed out. The service may be temporarily unavailable — please try again in a moment.')),
            SIGN_IN_TIMEOUT_MS
          )
        ),
      ]);

      if (error) throw error;

      // Successful online sign-in clears any prior "damaged" warning.
      if (credentialsDamaged) clearCredentialsDamagedFlag();

      // C4: capture refresh token for future offline sign-ins.
      if (data.session?.user?.email && data.session?.refresh_token) {
        const { saveUserMapping } = await import('@/lib/offline-auth');
        await saveUserMapping(
          data.session.user.email,
          data.session.user.id,
          data.session.refresh_token
        ).catch(() => {});
      }
    } catch (error: any) {
      console.error("Authentication error:", error);
      const friendlyMessage = getAuthErrorMessage(error);
      setError(friendlyMessage);
      toast.error(friendlyMessage);
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    
    if (!email) {
      setError("Please enter your email address.");
      return;
    }

    triggerHaptic('medium');
    setLoading(true);

    try {
      // M18: PWA reset-link quirk affects BOTH iOS and Windows installed PWAs —
      // the reset link opens in the system browser (Safari / Edge), not the
      // installed standalone shell. Detect either standalone mode and tag the
      // redirect so we can surface guidance after reset.
      const isStandalone = window.matchMedia('(display-mode: standalone)').matches
        || window.matchMedia('(display-mode: window-controls-overlay)').matches
        || (window.navigator as any).standalone === true;
      const redirectTo = `${window.location.origin}/${isStandalone ? '?from=pwa' : ''}`;
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo,
      });

      if (error) throw error;
      const successMsg = isStandalone
        ? "Password reset email sent! Note: the reset link will open in your browser, not the installed app."
        : "Password reset email sent! Check your inbox.";
      toast.success(successMsg);
      setIsForgotPassword(false);
    } catch (error: any) {
      console.error("Password reset error:", error);
      const friendlyMessage = getAuthErrorMessage(error);
      setError(friendlyMessage);
      toast.error(friendlyMessage);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative min-h-screen flex flex-col items-center justify-center gap-6 md:gap-10 p-2 md:p-4">
      {/* Background */}
      <div className="absolute inset-0 z-0">
        <img
          src={signinBg.url}
          alt=""
          className="w-full h-full object-cover"
        />
      </div>
      <img
        src={shimmerLogo.url}
        alt="Belay Reports"
        className="relative z-10 w-full max-w-md md:max-w-lg max-h-[20vh] object-contain drop-shadow-lg"
      />

      <Card className="relative z-10 w-full max-w-md shadow-2xl backdrop-blur-sm bg-card/95 mx-2">
        <CardHeader className="space-y-4 text-center">
          <div className="mx-auto w-48 h-24 flex items-center justify-center">
            <img src={belayReportsLogo} alt="Belay Reports Logo" width={192} height={93} className="w-full h-full object-contain" fetchPriority="high" />
          </div>
          <CardDescription>
            {isForgotPassword 
              ? "Reset your password" 
              : "Sign in to continue"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {credentialsDamaged && (
            <Alert className="mb-4 border-destructive/50 bg-destructive/10">
              <AlertDescription className="text-sm text-destructive">
                <span className="font-semibold">Offline credentials damaged.</span>{" "}
                Your saved offline sign-in data could not be verified. Please
                connect to the internet and sign in again to restore offline access.
              </AlertDescription>
            </Alert>
          )}
          {error && (
            <Alert className="mb-4 border-destructive/50 bg-destructive/10">
              <AlertDescription className="text-sm text-destructive">
                {error}
              </AlertDescription>
            </Alert>
          )}
          {!isOnline && (
            <Alert className="mb-4 border-orange-500/50 bg-orange-500/10">
              <WifiOff className="h-4 w-4 text-orange-500" />
              <AlertDescription className="text-sm">
                <span className="font-semibold">You're offline.</span>{" "}
                {hasCachedSessionForOffline()
                  ? "Tap below to access your cached reports, or continue as a Guest."
                  : "Continue as a Guest to start using the app right now, or sign in offline if you have an account."}
              </AlertDescription>
            </Alert>
          )}
          {!isOnline && (
            <GradientButton
              type="button"
              onClick={handleGuestMode}
              className="w-full mb-3"
            >
              Continue offline as Guest <ArrowRight className="ml-2 h-4 w-4" />
            </GradientButton>
          )}
          {lastKnown && (
            <Button
              type="button"
              variant="outline"
              onClick={handleResumeLastKnown}
              className="w-full mb-3"
            >
              Continue offline as {lastKnown.email ?? 'last account'}
            </Button>
          )}
          {!isOnline && hasCachedSessionForOffline() && (
            <Button
              type="button"
              variant="outline"
              onClick={handleGoToDashboard}
              className="w-full mb-4"
            >
              Open my cached reports
            </Button>
          )}
          <form onSubmit={isForgotPassword ? handleForgotPassword : handleAuth} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="inspector@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            {!isForgotPassword && (
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    placeholder="Enter your password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="pr-10"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => {
                      triggerHaptic('light');
                      setShowPassword(!showPassword);
                    }}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                    aria-label={showPassword ? "Hide password" : "Show password"}
                  >
                    {showPassword ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                </div>
                <PasswordStrengthMeter password={password} />
                <div className="text-right">
                  <button
                    type="button"
                    onClick={() => setIsForgotPassword(true)}
                    className="text-sm text-primary hover:underline"
                  >
                    Forgot password?
                  </button>
                </div>
              </div>
            )}
            <GradientButton
              type="submit"
              className="w-full"
              disabled={loading || (!isOnline && isForgotPassword)}
            >
              {loading 
                ? "Please wait..." 
                : isForgotPassword 
                ? "Send Reset Link" 
                : !isOnline
                ? "Sign In Offline"
                : "Sign In"}
            </GradientButton>
            {isForgotPassword && (
              <Button
                type="button"
                variant="ghost"
                className="w-full"
                onClick={() => setIsForgotPassword(false)}
              >
                Back to sign in
              </Button>
            )}
            <p className="text-xs text-center text-muted-foreground">
              Contact your administrator if you need an account.
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
