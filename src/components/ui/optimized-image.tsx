import { useState, useRef, useEffect, useCallback } from "react";
import { cn } from "@/lib/utils";
import { ImageOff } from "lucide-react";

interface OptimizedImageProps {
  src: string;
  alt: string;
  className?: string;
  containerClassName?: string;
  priority?: boolean;
  width?: number;
  height?: number;
}

/** Extract origin+pathname from a URL, ignoring query params (signed URL rotation) */
function getUrlBase(url: string): string {
  try {
    const u = new URL(url);
    return u.origin + u.pathname;
  } catch {
    return url;
  }
}

export function OptimizedImage({
  src,
  alt,
  className,
  containerClassName,
  priority = false,
  width,
  height,
}: OptimizedImageProps) {
  const [loaded, setLoaded] = useState(false);
  const [inView, setInView] = useState(priority);
  const [retryCount, setRetryCount] = useState(0);
  const [failed, setFailed] = useState(false);

  // Track previous src base for smart cross-fade (no flash on signed URL rotation)
  const prevSrcBaseRef = useRef<string>(getUrlBase(src));
  const [currentSrc, setCurrentSrc] = useState(src);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const newBase = getUrlBase(src);
    if (newBase !== prevSrcBaseRef.current) {
      // URL path changed — reset loaded state for new image
      setLoaded(false);
      setRetryCount(0);
      setFailed(false);
    }
    setCurrentSrc(src);
    prevSrcBaseRef.current = newBase;
  }, [src]);

  // Clean up retry timer on unmount
  useEffect(() => {
    return () => {
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
    };
  }, []);

  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (priority) return;
    const el = containerRef.current;
    if (!el) return;

    if ("IntersectionObserver" in window) {
      const observer = new IntersectionObserver(
        ([entry]) => {
          if (entry.isIntersecting) {
            setInView(true);
            observer.disconnect();
          }
        },
        { rootMargin: "200px" }
      );
      observer.observe(el);
      return () => observer.disconnect();
    }

    setInView(true);
  }, [priority]);

  const handleLoad = useCallback(() => {
    setLoaded(true);
    setFailed(false);
    setRetryCount(0);
  }, []);

  const handleError = useCallback(() => {
    if (retryCount < 1) {
      // Retry once after 3 seconds — store timer in ref for proper cleanup
      retryTimerRef.current = setTimeout(() => {
        retryTimerRef.current = null;
        setRetryCount(prev => prev + 1);
        setCurrentSrc(prev => {
          try {
            const u = new URL(prev);
            u.searchParams.set('_retry', String(Date.now()));
            return u.toString();
          } catch {
            return prev + (prev.includes('?') ? '&' : '?') + '_retry=' + Date.now();
          }
        });
      }, 3000);
      return;
    }
    // After retry failed, show broken-image fallback
    setFailed(true);
    setLoaded(false);
  }, [retryCount]);

  return (
    <div
      ref={containerRef}
      className={cn("relative overflow-hidden bg-zinc-950", containerClassName)}
    >
      {/* Shimmer skeleton — visible until image loads */}
      {!failed && (
        <div
          className={cn(
            "absolute inset-0 optimized-image-shimmer border-2 border-black dark:border-white transition-opacity duration-300 ease-in-out",
            loaded ? "opacity-0" : "opacity-100"
          )}
          aria-hidden
        />
      )}

      {/* Broken image fallback */}
      {failed && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-muted-foreground bg-muted/50">
          <ImageOff className="w-6 h-6" />
          <span className="text-xs">Failed to load</span>
        </div>
      )}

      {inView && !failed && (
        <img
          src={currentSrc}
          alt={alt}
          width={width}
          height={height}
          loading={priority ? "eager" : "lazy"}
          decoding="async"
          onLoad={handleLoad}
          onError={handleError}
          className={cn(
            "w-full h-full object-cover transition-opacity duration-300 ease-in-out",
            loaded ? "opacity-100" : "opacity-0",
            className
          )}
        />
      )}
    </div>
  );
}
