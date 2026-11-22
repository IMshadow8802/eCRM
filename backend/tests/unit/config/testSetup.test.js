// tests/setup.js binds supertest's ephemeral server to 127.0.0.1 (see there).
const express = require("express");
const request = require("supertest");

describe("test setup: supertest on loopback", () => {
  it("binds the server to 127.0.0.1, not the wildcard", async () => {
    const app = express().get("/", (req, res) => res.end("ok"));
    const t = request(app).get("/");
    let bound;
    t._server.once("listening", () => { bound = t._server.address().address; });
    const r = await t;
    expect(r.status).toBe(200);
    expect(bound).toBe("127.0.0.1");
  });

  it("closes the server after the request", async () => {
    const t = request(express().get("/", (req, res) => res.end("ok"))).get("/");
    await t;
    expect(t._server.listening).toBe(false);
  });
});
