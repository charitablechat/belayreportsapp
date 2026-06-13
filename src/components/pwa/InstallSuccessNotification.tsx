import { useEffect } from 'react';
import confetti from 'canvas-confetti';
import { PartyPopper } from 'lucide-react';
import { toast } from 'sonner';

export const InstallSuccessNotification = () => {
  useEffect(() => {
    const handleAppInstalled = () => {
      if (import.meta.env.DEV) {
        console.log('[Install Success] App installed, showing celebration');
      }

      // Trigger confetti animation
      const duration = 3000;
      const animationEnd = Date.now() + duration;
      const defaults = { startVelocity: 30, spread: 360, ticks: 60, zIndex: 9999 };

      const randomInRange = (min: number, max: number) => {
        return Math.random() * (max - min) + min;
      };

      const interval = setInterval(() => {
        const timeLeft = animationEnd - Date.now();

        if (timeLeft <= 0) {
          clearInterval(interval);
          return;
        }

        const particleCount = 50 * (timeLeft / duration);

        confetti({
          ...defaults,
          particleCount,
          origin: { x: randomInRange(0.1, 0.3), y: Math.random() - 0.2 }
        });
        confetti({
          ...defaults,
          particleCount,
          origin: { x: randomInRange(0.7, 0.9), y: Math.random() - 0.2 }
        });
      }, 250);

      // Show success toast
      toast.success('Welcome to Belay Reports! 🎉', {
        description: (
          <div className="space-y-2 mt-2">
            <p className="font-medium">Your app is now installed!</p>
            <ul className="text-sm space-y-1 text-muted-foreground">
              <li>✓ Work completely offline</li>
              <li>✓ Faster access from home screen</li>
              <li>✓ Native app experience</li>
              <li>✓ Auto-sync when online</li>
            </ul>
          </div>
        ),
        duration: 60000,
        icon: <PartyPopper className="w-5 h-5" />,
      });
    };

    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  return null;
};
