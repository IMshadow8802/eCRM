import { Component } from "react";

/**
 * App-level error boundary. A render/commit-phase throw anywhere below this
 * (e.g. a drag-and-drop reconciliation crash) previously unmounted the whole
 * React tree → blank white screen. This catches it and shows a recoverable
 * fallback instead. Reset the key on route change so navigating away clears it.
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error("Uncaught UI error:", error, info?.componentStack);
  }

  handleReload = () => window.location.reload();

  handleDismiss = () => this.setState({ error: null });

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div
        role="alert"
        data-testid="error-boundary"
        style={{
          minHeight: "60vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 12,
          padding: 32,
          textAlign: "center",
        }}
      >
        <div style={{ fontSize: 18, fontWeight: 700 }}>Something went wrong</div>
        <div style={{ fontSize: 14, opacity: 0.7, maxWidth: 420 }}>
          The page hit an unexpected error. Your data is safe — reload to
          continue.
        </div>
        {/* These stay plain <button>s on purpose. ui/Button reads
            `theme.tokens`, which only exists on this app's own theme — so
            using it here would make the last-resort recovery screen depend on
            the very machinery that may have just thrown. The styling below is
            self-contained for the same reason: no theme, no tokens, nothing
            that can fail a second time. `currentColor` and `font: inherit`
            keep it looking like the app in both light and dark without
            reading a palette. */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8, justifyContent: "center" }}>
          <button
            type="button"
            onClick={this.handleDismiss}
            data-testid="error-boundary-dismiss"
            style={{
              font: "inherit",
              fontWeight: 600,
              minHeight: 40,
              padding: "8px 16px",
              borderRadius: 12,
              border: "1px solid currentColor",
              background: "transparent",
              color: "inherit",
              opacity: 0.85,
              cursor: "pointer",
            }}
          >
            Try again
          </button>
          <button
            type="button"
            onClick={this.handleReload}
            data-testid="error-boundary-reload"
            style={{
              font: "inherit",
              fontWeight: 600,
              minHeight: 40,
              padding: "8px 16px",
              borderRadius: 12,
              border: "1px solid currentColor",
              background: "transparent",
              color: "inherit",
              cursor: "pointer",
            }}
          >
            Reload
          </button>
        </div>
      </div>
    );
  }
}
