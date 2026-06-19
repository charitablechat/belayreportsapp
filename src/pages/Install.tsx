import { useNavigate } from 'react-router-dom';
import { SEO } from "@/components/SEO";
import { goBack } from '@/lib/navigation';
import { Download, Smartphone, Zap, Wifi, Save, RefreshCw, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { usePWAInstall } from '@/hooks/usePWAInstall';
import logoAsset from "@/assets/belay-reports-wide.gif.asset.json";
const logo = logoAsset.url;

export default function Install() {
  const navigate = useNavigate();
  const { isInstallable, isInstalled, promptInstall } = usePWAInstall();

  const handleInstallClick = async () => {
    if (isInstallable) {
      await promptInstall();
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/20">
      <SEO
        title="Install Belay Reports — Offline-Ready Field App"
        description="Install Belay Reports on iOS, Android, or desktop for offline inspection capture, automatic sync, and faster field reporting."
        path="/install"
      />
      {/* Header */}
      <header className="border-b border-white/20 bg-white/10 dark:bg-black/20 backdrop-blur-[12px] shadow-md shadow-black/5">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => goBack(navigate)}
              className="gap-2"
            >
              <ArrowLeft className="h-4 w-4" />
              Back to Dashboard
            </Button>
          </div>
        </div>
      </header>

      <div className="container mx-auto px-4 py-12 max-w-4xl">
        {/* Hero Section */}
        <div className="text-center mb-12">
          <div className="flex justify-center mb-6">
            <img src={logo} alt="Belay Reports" className="h-16" />
          </div>
          <h1 className="text-4xl font-bold mb-4">Install Belay Reports</h1>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            Get the best experience with our Progressive Web App. Install it on your device for fast, offline-capable inspections.
          </p>
        </div>

        {/* Install Button */}
        {isInstalled ? (
          <Card className="mb-12 bg-primary/5 border-primary/20">
            <CardContent className="pt-6">
              <div className="text-center">
                <div className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 mb-4">
                  <Download className="h-6 w-6 text-primary" />
                </div>
                <h2 className="text-xl font-semibold mb-2">App Already Installed!</h2>
                <p className="text-muted-foreground mb-4">
                  You're all set. The app is installed on your device.
                </p>
                <Button onClick={() => navigate('/dashboard')}>
                  Go to Dashboard
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card className="mb-12 bg-primary text-primary-foreground">
            <CardContent className="pt-6">
              <div className="text-center">
                {isInstallable ? (
                  <>
                    <h2 className="text-2xl font-semibold mb-4">Ready to Install</h2>
                    <p className="mb-6 text-primary-foreground/90">
                      Click the button below to install the app on your device
                    </p>
                    <Button
                      size="lg"
                      variant="secondary"
                      onClick={handleInstallClick}
                      className="gap-2 font-semibold"
                    >
                      <Download className="h-5 w-5" />
                      Install Now
                    </Button>
                  </>
                ) : (
                  <>
                    <h2 className="text-2xl font-semibold mb-4">Manual Installation</h2>
                    <p className="text-primary-foreground/90">
                      Follow the instructions below for your device
                    </p>
                  </>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Benefits Section */}
        <div className="mb-12">
          <h2 className="text-2xl font-bold text-center mb-8">Why Install?</h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
            <Card>
              <CardContent className="pt-6">
                <div className="flex flex-col items-center text-center">
                  <div className="h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center mb-4">
                    <Smartphone className="h-6 w-6 text-primary" />
                  </div>
                  <h3 className="font-semibold mb-2">Home Screen Access</h3>
                  <p className="text-sm text-muted-foreground">
                    Launch directly from your home screen like a native app
                  </p>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-6">
                <div className="flex flex-col items-center text-center">
                  <div className="h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center mb-4">
                    <Zap className="h-6 w-6 text-primary" />
                  </div>
                  <h3 className="font-semibold mb-2">Lightning Fast</h3>
                  <p className="text-sm text-muted-foreground">
                    Instant loading with optimized performance
                  </p>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-6">
                <div className="flex flex-col items-center text-center">
                  <div className="h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center mb-4">
                    <Wifi className="h-6 w-6 text-primary" />
                  </div>
                  <h3 className="font-semibold mb-2">Work Offline</h3>
                  <p className="text-sm text-muted-foreground">
                    Continue working in the field without internet
                  </p>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-6">
                <div className="flex flex-col items-center text-center">
                  <div className="h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center mb-4">
                    <Save className="h-6 w-6 text-primary" />
                  </div>
                  <h3 className="font-semibold mb-2">Auto-Save</h3>
                  <p className="text-sm text-muted-foreground">
                    Your work is automatically saved locally
                  </p>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-6">
                <div className="flex flex-col items-center text-center">
                  <div className="h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center mb-4">
                    <RefreshCw className="h-6 w-6 text-primary" />
                  </div>
                  <h3 className="font-semibold mb-2">Auto-Sync</h3>
                  <p className="text-sm text-muted-foreground">
                    Syncs automatically when you're back online
                  </p>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-6">
                <div className="flex flex-col items-center text-center">
                  <div className="h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center mb-4">
                    <Download className="h-6 w-6 text-primary" />
                  </div>
                  <h3 className="font-semibold mb-2">No App Store</h3>
                  <p className="text-sm text-muted-foreground">
                    Install directly without app store approval
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Installation Instructions */}
        <div className="space-y-8">
          <h2 className="text-2xl font-bold text-center">Installation Instructions</h2>

          {/* iOS Safari */}
          <Card>
            <CardContent className="pt-6">
              <h3 className="text-xl font-semibold mb-4">📱 iOS (iPhone/iPad)</h3>
              <ol className="space-y-3 text-sm">
                <li className="flex gap-3">
                  <span className="font-semibold text-primary">1.</span>
                  <span>Open this page in <strong>Safari</strong> browser</span>
                </li>
                <li className="flex gap-3">
                  <span className="font-semibold text-primary">2.</span>
                  <span>Tap the <strong>Share</strong> button (square with arrow pointing up)</span>
                </li>
                <li className="flex gap-3">
                  <span className="font-semibold text-primary">3.</span>
                  <span>Scroll down and tap <strong>"Add to Home Screen"</strong></span>
                </li>
                <li className="flex gap-3">
                  <span className="font-semibold text-primary">4.</span>
                  <span>Tap <strong>"Add"</strong> in the top right corner</span>
                </li>
              </ol>
            </CardContent>
          </Card>

          {/* Android Chrome */}
          <Card>
            <CardContent className="pt-6">
              <h3 className="text-xl font-semibold mb-4">🤖 Android</h3>
              <ol className="space-y-3 text-sm">
                <li className="flex gap-3">
                  <span className="font-semibold text-primary">1.</span>
                  <span>Open this page in <strong>Chrome</strong> browser</span>
                </li>
                <li className="flex gap-3">
                  <span className="font-semibold text-primary">2.</span>
                  <span>Tap the <strong>three-dot menu</strong> in the top right</span>
                </li>
                <li className="flex gap-3">
                  <span className="font-semibold text-primary">3.</span>
                  <span>Tap <strong>"Install app"</strong> or <strong>"Add to Home screen"</strong></span>
                </li>
                <li className="flex gap-3">
                  <span className="font-semibold text-primary">4.</span>
                  <span>Tap <strong>"Install"</strong> in the popup</span>
                </li>
              </ol>
            </CardContent>
          </Card>

          {/* Desktop */}
          <Card>
            <CardContent className="pt-6">
              <h3 className="text-xl font-semibold mb-4">💻 Desktop (Chrome/Edge)</h3>
              <ol className="space-y-3 text-sm">
                <li className="flex gap-3">
                  <span className="font-semibold text-primary">1.</span>
                  <span>Look for the <strong>install icon</strong> in the address bar (computer with down arrow)</span>
                </li>
                <li className="flex gap-3">
                  <span className="font-semibold text-primary">2.</span>
                  <span>Click the icon and select <strong>"Install"</strong></span>
                </li>
                <li className="flex gap-3">
                  <span className="font-semibold text-primary">3.</span>
                  <span>The app will open in its own window</span>
                </li>
              </ol>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
