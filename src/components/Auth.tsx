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
import { hasCachedSessionForOffline } from "@/lib/cached-auth";
import { triggerHaptic } from "@/lib/haptics";
import { toast } from "sonner";

// Helper to get user-friendly error messages
const getAuthErrorMessage = (error: any): string => {
  const message = error?.message?.toLowerCase() || '';
  
  if (message.includes('user already registered') || message.includes('already been registered')) {
    return 'An account with this email already exists. Try signing in instead.';
  }
  if (message.includes('invalid login credentials') || message.includes('invalid credentials')) {
    return 'Invalid email or password. Please check your credentials and try again.';
  }
  if (message.includes('email not confirmed')) {
    return 'Please check your email and confirm your account before signing in.';
  }
  if (message.includes('password should be at least')) {
    return 'Password must be at least 6 characters long.';
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
  
  return error?.message || 'An unexpected error occurred. Please try again.';
};

export default function Auth() {
  const navigate = useNavigate();
  const { isOnline } = usePWA();
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [isSignUp, setIsSignUp] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [isForgotPassword, setIsForgotPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleGoToDashboard = () => {
    navigate("/dashboard");
  };

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    
    if (!email || !password) {
      setError("Please enter both email and password.");
      return;
    }

    if (isSignUp && (!firstName.trim() || !lastName.trim())) {
      setError("Please enter your first and last name.");
      return;
    }

    if (password.length < 6) {
      setError("Password must be at least 6 characters long.");
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
            data: {
              first_name: firstName.trim(),
              last_name: lastName.trim(),
            },
          },
        });

        if (error) throw error;
        toast.success("Account created! Check your email to confirm your account.");
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
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/`,
      });

      if (error) throw error;
      toast.success("Password reset email sent! Check your inbox.");
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
                  ? "Tap below to access your cached reports."
                  : "Sign in requires an internet connection."}
              </AlertDescription>
            </Alert>
          )}
          {!isOnline && hasCachedSessionForOffline() && (
            <GradientButton
              type="button"
              onClick={handleGoToDashboard}
              className="w-full mb-4"
            >
              Go to Dashboard <ArrowRight className="ml-2 h-4 w-4" />
            </GradientButton>
          )}
          <form onSubmit={isForgotPassword ? handleForgotPassword : handleAuth} className="space-y-4">
            {isSignUp && !isForgotPassword && (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="firstName">First Name</Label>
                  <Input
                    id="firstName"
                    type="text"
                    placeholder="John"
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    required
                    maxLength={50}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="lastName">Last Name</Label>
                  <Input
                    id="lastName"
                    type="text"
                    placeholder="Smith"
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    required
                    maxLength={50}
                  />
                </div>
              </div>
            )}
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
                {isSignUp && password.length > 0 && (
                  <div className="space-y-2 pt-1">
                    <div className="flex gap-1">
                      {[1, 2, 3, 4].map((level) => {
                        const strength = 
                          (password.length >= 6 ? 1 : 0) +
                          (/[A-Z]/.test(password) ? 1 : 0) +
                          (/[0-9]/.test(password) ? 1 : 0) +
                          (/[^A-Za-z0-9]/.test(password) ? 1 : 0);
                        const isActive = level <= strength;
                        const colorClass = strength <= 1 ? 'bg-destructive' : strength === 2 ? 'bg-orange-500' : strength === 3 ? 'bg-yellow-500' : 'bg-green-500';
                        return (
                          <div 
                            key={level} 
                            className={`h-1 flex-1 rounded-full transition-colors ${isActive ? colorClass : 'bg-muted'}`} 
                          />
                        );
                      })}
                    </div>
                    <ul className="text-xs space-y-0.5">
                      <li className={`flex items-center gap-1.5 ${password.length >= 6 ? 'text-green-600 dark:text-green-400' : 'text-muted-foreground'}`}>
                        <span className={`w-1 h-1 rounded-full ${password.length >= 6 ? 'bg-green-500' : 'bg-muted-foreground'}`} />
                        At least 6 characters
                      </li>
                      <li className={`flex items-center gap-1.5 ${/[A-Z]/.test(password) ? 'text-green-600 dark:text-green-400' : 'text-muted-foreground'}`}>
                        <span className={`w-1 h-1 rounded-full ${/[A-Z]/.test(password) ? 'bg-green-500' : 'bg-muted-foreground'}`} />
                        One uppercase letter
                      </li>
                      <li className={`flex items-center gap-1.5 ${/[0-9]/.test(password) ? 'text-green-600 dark:text-green-400' : 'text-muted-foreground'}`}>
                        <span className={`w-1 h-1 rounded-full ${/[0-9]/.test(password) ? 'bg-green-500' : 'bg-muted-foreground'}`} />
                        One number
                      </li>
                      <li className={`flex items-center gap-1.5 ${/[^A-Za-z0-9]/.test(password) ? 'text-green-600 dark:text-green-400' : 'text-muted-foreground'}`}>
                        <span className={`w-1 h-1 rounded-full ${/[^A-Za-z0-9]/.test(password) ? 'bg-green-500' : 'bg-muted-foreground'}`} />
                        One special character
                      </li>
                    </ul>
                  </div>
                )}
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
