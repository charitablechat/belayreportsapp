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
import ropeWorksLogo from "@/assets/rope-works-logo.png";
import authBackgroundVideo from "@/assets/auth-background.mp4";
import { hasCachedSession as checkCachedSession } from "@/lib/cached-auth";
import { triggerHaptic } from "@/lib/haptics";

export default function Auth() {
  const navigate = useNavigate();
  const { isOnline } = usePWA();
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSignUp, setIsSignUp] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [isForgotPassword, setIsForgotPassword] = useState(false);

  const handleGoToDashboard = () => {
    navigate("/dashboard");
  };

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!email || !password) {
      return;
    }

    if (password.length < 6) {
      return;
    }

    triggerHaptic('medium');
    setLoading(true);

    try {
      if (isSignUp) {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: `${window.location.origin}/`,
          },
        });

        if (error) throw error;
        setIsSignUp(false);
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });

        if (error) throw error;
      }
    } catch (error: any) {
      console.error("Authentication error:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!email) {
      return;
    }

    triggerHaptic('medium');
    setLoading(true);

    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/`,
      });

      if (error) throw error;
      setIsForgotPassword(false);
    } catch (error: any) {
      console.error("Password reset error:", error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative min-h-screen flex items-center justify-center p-2 md:p-4">
      {/* Background - Video on desktop, gradient on mobile */}
      <div className="absolute inset-0 z-0">
        {/* Static gradient fallback for mobile and reduced motion */}
        <div className="absolute inset-0 bg-gradient-to-br from-primary/20 via-secondary/10 to-accent/20 md:hidden" />
        
        {/* Video background - desktop only, respects reduced motion */}
        <video 
          autoPlay 
          loop 
          muted 
          playsInline
          className="hidden md:block w-full h-full object-cover motion-reduce:hidden"
          onLoadedMetadata={(e) => {
            const video = e.currentTarget;
            video.playbackRate = 0.7;
          }}
        >
          <source src={authBackgroundVideo} type="video/mp4" />
        </video>
        
        {/* Gradient fallback when motion is reduced */}
        <div className="absolute inset-0 bg-gradient-to-br from-primary/20 via-secondary/10 to-accent/20 hidden motion-reduce:block" />
      </div>
      <Card className="relative z-10 w-full max-w-md shadow-2xl backdrop-blur-sm bg-card/95 mx-2">
        <CardHeader className="space-y-4 text-center">
          <div className="mx-auto w-48 h-24 flex items-center justify-center">
            <img src={ropeWorksLogo} alt="Rope Works Logo" className="w-full h-full object-contain" />
          </div>
          <CardTitle className="text-2xl font-bold">Rope Works Inspection</CardTitle>
          <CardDescription>
            {isForgotPassword 
              ? "Reset your password" 
              : isSignUp 
              ? "Create your inspector account" 
              : "Sign in to continue"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!isOnline && (
            <Alert className="mb-4 border-orange-500/50 bg-orange-500/10">
              <WifiOff className="h-4 w-4 text-orange-500" />
              <AlertDescription className="text-sm">
                <span className="font-semibold">You're offline.</span>{" "}
                {checkCachedSession() 
                  ? "Your cached credentials will be used to access the dashboard."
                  : "Sign in requires an internet connection."}
              </AlertDescription>
            </Alert>
          )}
          {!isOnline && checkCachedSession() && (
            <GradientButton
              type="button"
              onClick={handleGoToDashboard}
              className="w-full mb-4"
            >
              Go to Dashboard <ArrowRight className="ml-2 h-4 w-4" />
            </GradientButton>
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
                {!isSignUp && (
                  <div className="text-right">
                    <button
                      type="button"
                      onClick={() => setIsForgotPassword(true)}
                      className="text-sm text-primary hover:underline"
                    >
                      Forgot password?
                    </button>
                  </div>
                )}
              </div>
            )}
            <GradientButton
              type="submit"
              className="w-full"
              disabled={loading}
            >
              {loading 
                ? "Please wait..." 
                : isForgotPassword 
                ? "Send Reset Link" 
                : isSignUp 
                ? "Create Account" 
                : "Sign In"}
            </GradientButton>
            {isForgotPassword ? (
              <Button
                type="button"
                variant="ghost"
                className="w-full"
                onClick={() => setIsForgotPassword(false)}
              >
                Back to sign in
              </Button>
            ) : (
              <Button
                type="button"
                variant="ghost"
                className="w-full"
                onClick={() => {
                  triggerHaptic('light');
                  setIsSignUp(!isSignUp);
                }}
              >
                {isSignUp ? "Already have an account? Sign in" : "Need an account? Sign up"}
              </Button>
            )}
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
