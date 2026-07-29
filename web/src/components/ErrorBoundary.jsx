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
        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          <button
            type="button"
            onClick={this.handleDismiss}
            data-testid="error-boundary-dismiss"
            style={{ padding: "8px 16px", cursor: "pointer" }}
          >
            Try again
          </button>
          <button
            type="button"
            onClick={this.handleReload}
            data-testid="error-boundary-reload"
            style={{
              padding: "8px 16px",
              cursor: "pointer",
              fontWeight: 600,
            }}
          >
            Reload
          </button>
        </div>
      </div>
    );
  }
}
