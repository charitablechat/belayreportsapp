import { useState, useRef, useCallback, useEffect } from "react";
import { Camera, RotateCcw, Check, X, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface CameraCaptureDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Receives the captured File. May return a Promise; the dialog will await
   * it before tearing down the canvas backing store, so the underlying Blob
   * survives any async persistence (compress → IndexedDB → optional upload).
   * This matters on iOS/WebKit where eager canvas teardown has been observed
   * to interact badly with pending Blob materialization.
   */
  onCapture: (file: File) => void | Promise<void>;
}

type CameraState = "initializing" | "streaming" | "preview" | "error";

export function CameraCaptureDialog({
  open,
  onOpenChange,
  onCapture,
}: CameraCaptureDialogProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [state, setState] = useState<CameraState>("initializing");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [capturedBlob, setCapturedBlob] = useState<Blob | null>(null);
  const [errorMessage, setErrorMessage] = useState("");

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const startStream = useCallback(async () => {
    setState("initializing");
    setErrorMessage("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "environment",
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
      setState("streaming");
    } catch (err: any) {
      console.error("[CameraCapture] getUserMedia failed:", err);
      const msg =
        err?.name === "NotAllowedError"
          ? "Camera permission denied. Please allow camera access in your browser settings."
          : err?.name === "NotFoundError"
            ? "No camera found on this device."
            : "Could not access camera. Please try again.";
      setErrorMessage(msg);
      setState("error");
    }
  }, []);

  // Start camera when dialog opens, clean up on close
  useEffect(() => {
    if (open) {
      startStream();
    } else {
      stopStream();
      // Revoke any preview URL to prevent memory leaks
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
      setCapturedBlob(null);
      setState("initializing");
    }
    return () => stopStream();
  }, [open, startStream, stopStream]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleShutter = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.drawImage(video, 0, 0);
    canvas.toBlob(
      (blob) => {
        // Zero canvas dimensions to release backing store memory (critical for iPad Safari)
        canvas.width = 0;
        canvas.height = 0;
        if (!blob) return;
        setCapturedBlob(blob);
        setPreviewUrl(URL.createObjectURL(blob));
        setState("preview");
        stopStream();
      },
      "image/jpeg",
      0.9,
    );
  }, [stopStream]);

  const handleRetake = useCallback(() => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setCapturedBlob(null);
    startStream();
  }, [previewUrl, startStream]);

  const handleUsePhoto = useCallback(() => {
    if (!capturedBlob) return;
    const file = new File([capturedBlob], `capture-${Date.now()}.jpg`, {
      type: "image/jpeg",
    });
    onCapture(file);
    onOpenChange(false);
  }, [capturedBlob, onCapture, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg p-0 overflow-hidden" hideDefaultClose>
        <DialogHeader className="p-4 pb-0">
          <DialogTitle className="flex items-center justify-between">
            <span>Take Photo</span>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => onOpenChange(false)}
              className="h-8 w-8"
            >
              <X className="h-4 w-4" />
            </Button>
          </DialogTitle>
        </DialogHeader>

        <div className="relative bg-black aspect-[4/3] w-full flex items-center justify-center">
          {/* Hidden canvas for capture */}
          <canvas ref={canvasRef} className="hidden" />

          {state === "initializing" && (
            <div className="text-muted-foreground text-sm animate-pulse">
              Starting camera…
            </div>
          )}

          {state === "error" && (
            <div className="flex flex-col items-center gap-3 p-6 text-center">
              <AlertCircle className="h-10 w-10 text-destructive" />
              <p className="text-sm text-muted-foreground">{errorMessage}</p>
              <Button variant="outline" size="sm" onClick={startStream}>
                Try Again
              </Button>
            </div>
          )}

          {(state === "streaming" || state === "initializing") && (
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="w-full h-full object-cover"
            />
          )}

          {state === "preview" && previewUrl && (
            <img
              src={previewUrl}
              alt="Captured preview"
              className="w-full h-full object-contain"
            />
          )}
        </div>

        <div className="flex items-center justify-center gap-4 p-4">
          {state === "streaming" && (
            <Button
              onClick={handleShutter}
              size="lg"
              className="rounded-full w-16 h-16 p-0"
            >
              <Camera className="h-6 w-6" />
            </Button>
          )}

          {state === "preview" && (
            <>
              <Button variant="outline" onClick={handleRetake}>
                <RotateCcw className="h-4 w-4 mr-2" />
                Retake
              </Button>
              <Button onClick={handleUsePhoto}>
                <Check className="h-4 w-4 mr-2" />
                Use Photo
              </Button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
