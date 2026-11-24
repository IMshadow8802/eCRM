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

// supertest binds its ephemeral server with listen(0), a wildcard bind, then
// dials 127.0.0.1. On macOS a wildcard bind can be handed a port that another
// process already holds on 127.0.0.1 (SO_REUSEADDR), and the dial reaches that
// process instead: the intermittent "socket hang up" / ECONNRESET in route
// suites. So the server is bound to 127.0.0.1 itself, which only gets a port
// that is free there. A host bind is asynchronous (address() is null until
// "listening"), so the URL is filled in when the request is sent.
const Test = require("supertest/lib/test");
const { serverAddress, end } = Test.prototype;
Test.prototype.serverAddress = function loopbackAddress(app, path) {
  if (app.address()) return serverAddress.call(this, app, path);
  this._server = app.listen(0, "127.0.0.1");
  this._loopbackPath = path;
  return "";
};
Test.prototype.end = function endOnLoopback(fn) {
  const server = this._server;
  if (!server || this.url) return end.call(this, fn);
  const send = () => {
    this.url = `http://127.0.0.1:${server.address().port}${this._loopbackPath}`;
    end.call(this, fn);
  };
  if (server.listening) send();
  else server.once("listening", send);
  return this;
};
