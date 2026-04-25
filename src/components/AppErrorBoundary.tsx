import { Component, type ReactNode } from "react";
import { captureException } from "@/lib/sentry";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

/**
 * Lightweight top-level error boundary. Forwards uncaught render errors to
 * Sentry (no-op in dev) and shows a graceful fallback instead of a blank screen.
 */
export class AppErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: { componentStack?: string }): void {
    captureException(error, { componentStack: info.componentStack });
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 24, fontFamily: "system-ui, sans-serif" }}>
          <h1 style={{ fontSize: 18, fontWeight: 600 }}>Something went wrong.</h1>
          <p style={{ marginTop: 8, color: "#555" }}>
            The error has been reported. Please refresh the page to continue.
          </p>
        </div>
      );
    }
    return this.props.children;
  }
}
