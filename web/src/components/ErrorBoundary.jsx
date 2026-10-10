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
          gap: "calc(12rem / 15)",
          padding: "calc(32rem / 15)",
          textAlign: "center",
        }}
      >
        <div style={{ fontSize: "calc(18rem / 15)", fontWeight: 700 }}>Something went wrong</div>
        <div style={{ fontSize: "calc(14rem / 15)", opacity: 0.7, maxWidth: "calc(420rem / 15)" }}>
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
        <div style={{ display: "flex", flexWrap: "wrap", gap: "calc(8rem / 15)", marginTop: "calc(8rem / 15)", justifyContent: "center" }}>
          <button
            type="button"
            onClick={this.handleDismiss}
            data-testid="error-boundary-dismiss"
            style={{
              font: "inherit",
              fontWeight: 600,
              minHeight: "calc(40rem / 15)",
              padding: "calc(8rem / 15) calc(16rem / 15)",
              borderRadius: 12,
              border: "1px solid currentColor",
              background: "transparent",
              color: "inherit",
              fontWeight: 500,
              opacity: 0.7,
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
              minHeight: "calc(40rem / 15)",
              padding: "calc(8rem / 15) calc(16rem / 15)",
              borderRadius: 12,
              // Two identical outlines left no primary action on the one screen
              // where the user most needs to be told what to press.
              border: "2px solid currentColor",
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
