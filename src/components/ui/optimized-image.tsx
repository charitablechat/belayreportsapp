import { useState, useRef, useEffect, useCallback } from "react";
import { cn } from "@/lib/utils";

interface OptimizedImageProps {
  src: string;
  alt: string;
  className?: string;
  containerClassName?: string;
  priority?: boolean;
  width?: number;
  height?: number;
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

  // Reset loaded state when src changes (e.g., signed URL rotation)
  useEffect(() => {
    setLoaded(false);
  }, [src]);
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

  const handleLoad = useCallback(() => setLoaded(true), []);

  return (
    <div
      ref={containerRef}
      className={cn("relative overflow-hidden bg-zinc-950", containerClassName)}
    >
      {/* Brutalist skeleton — visible until image loads */}
      <div
        className={cn(
          "absolute inset-0 optimized-image-shimmer border-2 border-black dark:border-white transition-opacity duration-300 ease-in-out",
          loaded ? "opacity-0" : "opacity-100"
        )}
        aria-hidden
      />

      {inView && (
        <img
          src={src}
          alt={alt}
          width={width}
          height={height}
          loading={priority ? "eager" : "lazy"}
          decoding="async"
          onLoad={handleLoad}
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
