// Test environment defaults — keep db disconnected; controllers should mock it.
process.env.NODE_ENV = "test";
process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret-change-me";
process.env.PORT = process.env.PORT || "0";

// Silence noisy startup logs during tests
const noop = () => {};
global.console = {
  ...console,
  log: noop,
  info: noop,
  warn: noop,
};
