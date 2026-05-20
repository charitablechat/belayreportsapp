import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * WideTableScroller — wraps wide tables and renders a permanent, app-level
 * horizontal scrollbar (track + draggable thumb) below the content whenever
 * the inner content overflows horizontally. Never depends on OS overlay
 * scrollbars (which auto-hide on macOS / iPadOS / ChromeOS).
 *
 * - Track stays visible whenever scrollWidth > clientWidth.
 * - Thumb width scales to visible / total ratio (min 40px).
 * - Dragging the thumb scrolls the container; scrolling the container
 *   (wheel, swipe, trackpad, keyboard) moves the thumb.
 * - Clicking the track jumps the thumb to that position.
 * - Left/right buttons nudge by ~80% of the visible width.
 */
interface WideTableScrollerProps {
  children: ReactNode;
  className?: string;
  ariaLabel?: string;
  /** Optional cue text shown above the scrollbar. */
  hint?: string | null;
}

export function WideTableScroller({
  children,
  className,
  ariaLabel = "Table horizontal scroll",
  hint = "Scroll horizontally to see more columns",
}: WideTableScrollerProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const [overflow, setOverflow] = useState(false);
  const [thumb, setThumb] = useState({ width: 0, left: 0, trackWidth: 0 });
  const dragState = useRef<{
    active: boolean;
    startX: number;
    startScrollLeft: number;
    ratio: number;
  } | null>(null);

  const measure = useCallback(() => {
    const sc = scrollRef.current;
    const tr = trackRef.current;
    if (!sc || !tr) return;
    const { scrollWidth, clientWidth, scrollLeft } = sc;
    const trackWidth = tr.clientWidth;
    const hasOverflow = scrollWidth > clientWidth + 1;
    setOverflow(hasOverflow);
    if (!hasOverflow) {
      setThumb({ width: 0, left: 0, trackWidth });
      return;
    }
    const ratio = clientWidth / scrollWidth;
    const rawWidth = Math.max(40, trackWidth * ratio);
    const maxLeft = trackWidth - rawWidth;
    const scrollRange = scrollWidth - clientWidth;
    const left = scrollRange > 0 ? (scrollLeft / scrollRange) * maxLeft : 0;
    setThumb({ width: rawWidth, left, trackWidth });
    if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.debug("[zipline.scrollbar.measure]", {
        scrollWidth, clientWidth, scrollLeft, trackWidth, overflow: hasOverflow, thumbWidth: rawWidth, thumbLeft: left,
      });
    }
  }, []);

  useEffect(() => {
    const sc = scrollRef.current;
    if (!sc) return;
    measure();
    const onScroll = () => measure();
    sc.addEventListener("scroll", onScroll, { passive: true });
    const ro = new ResizeObserver(() => measure());
    ro.observe(sc);
    if (sc.firstElementChild) ro.observe(sc.firstElementChild);
    if (trackRef.current) ro.observe(trackRef.current);
    window.addEventListener("resize", measure);
    // iOS Safari / iPad PWA: rotation, on-screen keyboard, and pinch-zoom
    // change the layout viewport without always firing `resize`. Hook into
    // visualViewport + orientationchange + visibilitychange so the scroll
    // fixture stays accurate across mobile/PWA lifecycle events.
    window.addEventListener("orientationchange", measure);
    const onVisibility = () => { if (!document.hidden) measure(); };
    document.addEventListener("visibilitychange", onVisibility);
    const vv = (window as any).visualViewport as VisualViewport | undefined;
    vv?.addEventListener("resize", measure);
    vv?.addEventListener("scroll", measure);
    // Re-measure shortly after mount in case fonts/images change layout.
    const t = setTimeout(measure, 250);
    return () => {
      sc.removeEventListener("scroll", onScroll);
      ro.disconnect();
      window.removeEventListener("resize", measure);
      window.removeEventListener("orientationchange", measure);
      document.removeEventListener("visibilitychange", onVisibility);
      vv?.removeEventListener("resize", measure);
      vv?.removeEventListener("scroll", measure);
      clearTimeout(t);
    };
  }, [measure]);


  const beginDrag = useCallback((e: React.PointerEvent) => {
    const sc = scrollRef.current;
    const tr = trackRef.current;
    if (!sc || !tr) return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const trackWidth = tr.clientWidth;
    const scrollRange = sc.scrollWidth - sc.clientWidth;
    const maxLeft = trackWidth - thumb.width;
    const ratio = maxLeft > 0 ? scrollRange / maxLeft : 0;
    dragState.current = {
      active: true,
      startX: e.clientX,
      startScrollLeft: sc.scrollLeft,
      ratio,
    };
    e.preventDefault();
  }, [thumb.width]);

  const onDragMove = useCallback((e: React.PointerEvent) => {
    const sc = scrollRef.current;
    const st = dragState.current;
    if (!sc || !st?.active) return;
    const dx = e.clientX - st.startX;
    sc.scrollLeft = st.startScrollLeft + dx * st.ratio;
    if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.debug("[zipline.scrollbar.drag]", { dx, scrollLeft: sc.scrollLeft });
    }
  }, []);

  const endDrag = useCallback((e: React.PointerEvent) => {
    if (dragState.current) dragState.current.active = false;
    try { (e.target as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* noop */ }
  }, []);

  const onTrackClick = useCallback((e: React.MouseEvent) => {
    const sc = scrollRef.current;
    const tr = trackRef.current;
    if (!sc || !tr) return;
    // Ignore clicks on the thumb itself (handled by drag).
    if ((e.target as HTMLElement).dataset.role === "thumb") return;
    const rect = tr.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const targetLeft = clickX - thumb.width / 2;
    const maxLeft = tr.clientWidth - thumb.width;
    const clamped = Math.max(0, Math.min(maxLeft, targetLeft));
    const scrollRange = sc.scrollWidth - sc.clientWidth;
    sc.scrollTo({ left: maxLeft > 0 ? (clamped / maxLeft) * scrollRange : 0, behavior: "smooth" });
  }, [thumb.width]);

  const nudge = useCallback((dir: 1 | -1) => {
    const sc = scrollRef.current;
    if (!sc) return;
    sc.scrollBy({ left: dir * sc.clientWidth * 0.8, behavior: "smooth" });
  }, []);

  const onThumbKey = useCallback((e: React.KeyboardEvent) => {
    const sc = scrollRef.current;
    if (!sc) return;
    const step = sc.clientWidth * 0.2;
    if (e.key === "ArrowRight") { sc.scrollBy({ left: step, behavior: "smooth" }); e.preventDefault(); }
    else if (e.key === "ArrowLeft") { sc.scrollBy({ left: -step, behavior: "smooth" }); e.preventDefault(); }
    else if (e.key === "Home") { sc.scrollTo({ left: 0, behavior: "smooth" }); e.preventDefault(); }
    else if (e.key === "End") { sc.scrollTo({ left: sc.scrollWidth, behavior: "smooth" }); e.preventDefault(); }
    else if (e.key === "PageDown") { sc.scrollBy({ left: sc.clientWidth * 0.8, behavior: "smooth" }); e.preventDefault(); }
    else if (e.key === "PageUp") { sc.scrollBy({ left: -sc.clientWidth * 0.8, behavior: "smooth" }); e.preventDefault(); }
  }, []);

  const ariaValueNow = (() => {
    const sc = scrollRef.current;
    if (!sc) return 0;
    const range = sc.scrollWidth - sc.clientWidth;
    return range > 0 ? Math.round((sc.scrollLeft / range) * 100) : 0;
  })();

  return (
    <div className={cn("relative", className)}>
      <div ref={scrollRef} className="overflow-x-auto scroll-hint-wrapper">
        {children}
      </div>
      {/* Permanent scroll fixture. Render the measuring track at all times so
          overflow can be detected before the visible control is shown. */}
      <div className={cn("mt-3", overflow ? "block" : "invisible h-0 overflow-hidden pointer-events-none")}>
          <div className="rounded-md border-2 border-primary/50 bg-background/95 backdrop-blur-sm shadow-lg px-2 py-1.5">
            <div className="flex items-center gap-2">
              <span className="hidden sm:inline text-[11px] font-semibold text-foreground/80 whitespace-nowrap pr-1">
                Scroll →
              </span>
              <button
                type="button"
                aria-label="Scroll left"
                onClick={() => nudge(-1)}
                className="shrink-0 h-7 w-7 rounded border border-border bg-muted hover:bg-muted-foreground/20 text-foreground text-base leading-none flex items-center justify-center"
              >
                ‹
              </button>
              <div
                ref={trackRef}
                role="scrollbar"
                aria-controls="wide-table-scroll"
                aria-orientation="horizontal"
                aria-label={ariaLabel}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={ariaValueNow}
                onClick={onTrackClick}
                className="relative flex-1 h-5 rounded-full bg-muted border border-border cursor-pointer select-none"
              >
                <div
                  data-role="thumb"
                  tabIndex={0}
                  onKeyDown={onThumbKey}
                  onPointerDown={beginDrag}
                  onPointerMove={onDragMove}
                  onPointerUp={endDrag}
                  onPointerCancel={endDrag}
                  style={{ width: thumb.width, transform: `translateX(${thumb.left}px)` }}
                  className="absolute top-0 left-0 h-full rounded-full bg-primary hover:bg-primary/90 cursor-grab active:cursor-grabbing shadow-md ring-1 ring-primary-foreground/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 touch-none"
                />
              </div>
              <button
                type="button"
                aria-label="Scroll right"
                onClick={() => nudge(1)}
                className="shrink-0 h-7 w-7 rounded border border-border bg-muted hover:bg-muted-foreground/20 text-foreground text-base leading-none flex items-center justify-center"
              >
                ›
              </button>
            </div>
          </div>
        </div>
    </div>
  );
}
