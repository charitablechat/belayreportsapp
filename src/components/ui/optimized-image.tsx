import { useState, useRef, useEffect, useCallback } from "react";
import { cn } from "@/lib/utils";

interface OptimizedImageProps {
  src: string;
  alt: string;
  className?: string;
  containerClassName?: string;
}

export function OptimizedImage({
  src,
  alt,
  className,
  containerClassName,
}: OptimizedImageProps) {
  const [loaded, setLoaded] = useState(false);
  const [inView, setInView] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Intersection Observer for lazy loading fallback
  useEffect(() => {
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

    // No IntersectionObserver — render immediately
    setInView(true);
  }, []);

  const handleLoad = useCallback(() => setLoaded(true), []);

  return (
    <div
      ref={containerRef}
      className={cn("relative overflow-hidden bg-foreground/5", containerClassName)}
    >
      {/* Shimmer skeleton — visible until image loads */}
      <div
        className={cn(
          "absolute inset-0 optimized-image-shimmer transition-opacity duration-300 ease-in-out",
          loaded ? "opacity-0" : "opacity-100"
        )}
        aria-hidden
      />

      {inView && (
        <img
          src={src}
          alt={alt}
          loading="lazy"
          onLoad={handleLoad}
          className={cn(
            "transition-opacity duration-300 ease-in-out",
            loaded ? "opacity-100" : "opacity-0",
            className
          )}
        />
      )}
    </div>
  );
}
