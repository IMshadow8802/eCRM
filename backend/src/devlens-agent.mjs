// devlens agent: loaded with NODE_OPTIONS=--import into a host Express app.
// Counts requests per route per minute and serves them at */__devlens/stats; keeps the last stdout/stderr
// lines in memory for */__devlens/logs, keeps calls that ended >= 400 for */__devlens/calls and answers
// */__devlens/runtime.
// Side effects only; exports nothing. Must never break or slow the host.
import http from "node:http"
import { hostname } from "node:os"
import { readFileSync } from "node:fs"
import { timingSafeEqual } from "node:crypto"
import { StringDecoder } from "node:string_decoder"
import { monitorEventLoopDelay } from "node:perf_hooks"

// Same bounds as HIST_BOUNDS_MS in server/src/monitor/series.ts. 10 slots, last = > 5000 ms.
const BOUNDS = [10, 25, 50, 100, 250, 500, 1000, 2500, 5000]
const MINUTE = 60_000
const KEEP_MINUTES = 1440
const MAX_ROUTES = 200
const MAX_ERRORS = 50
const PREFIX = "/__devlens/"
const MAX_LOG_LINES = 2000
const MAX_LOG_TEXT = 1_048_576 // chars of text across the ring
const MAX_LINE = 4096
const CUT = 8192 // stored cap: lines are redacted at read time a bit past MAX_LINE, so a secret straddling the cut still matches
const MIN_KEY = 16
const MAX_PAGE = 500
const READ_BUDGET = 25 // ms of redaction per logs call
const LAG_RES = 20 // ms

let key = process.env.DEVLENS_KEY || ""
if (key && key.length < MIN_KEY) {
  key = "" // a guessable key would expose the logs; endpoints off, the app is untouched
  try { process.stderr.write(`devlens-agent: DEVLENS_KEY is shorter than ${MIN_KEY} characters; agent endpoints disabled\n`) } catch {}
}
const startedAt = Date.now()
const minutes = new Map() // minute epoch ms -> { routes: { "<METHOD> <pattern>": {...} }, count }
const errors = []

function bucket(t) {
  let m = minutes.get(t)
  if (!m) {
    m = { routes: Object.create(null), count: 0 }
    minutes.set(t, m) // Map keeps insertion order, so the oldest is first
    while (minutes.size > KEEP_MINUTES) minutes.delete(minutes.keys().next().value)
  }
  return m
}

function record(method, route, status, ms) {
  const now = Date.now()
  const m = bucket(now - (now % MINUTE))
  let k = method + " " + route
  if (!m.routes[k] && m.count >= MAX_ROUTES) k = method + " (other)"
  if (!m.routes[k]) m.count++
  const r = (m.routes[k] ??= { n: 0, s2: 0, s3: 0, s4: 0, s5: 0, sumMs: 0, hist: new Array(BOUNDS.length + 1).fill(0) })
  r.n++
  const cls = Math.floor(status / 100)
  if (cls >= 2 && cls <= 5) r["s" + cls]++
  r.sumMs += Math.round(ms)
  let i = BOUNDS.findIndex((b) => ms <= b)
  if (i < 0) i = BOUNDS.length
  r.hist[i]++
  if (cls === 5) {
    errors.push({ t: now, method, route, status, ms: Math.round(ms) })
    if (errors.length > MAX_ERRORS) errors.shift()
  }
}

function keyOk(given) {
  const a = Buffer.from(String(given ?? ""))
  const b = Buffer.from(key)
  return a.length === b.length && timingSafeEqual(a, b)
}

function serve(req, res, query, body) {
  if (!keyOk(req.headers["x-devlens-key"])) {
    res.writeHead(401, { "content-type": "application/json" })
    res.end(JSON.stringify({ agent: "devlens-agent", error: "key" }))
    return
  }
  const out = { agent: "devlens-agent", version: 1, startedAt, now: Date.now(), ...body(new URLSearchParams(query)) }
  res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" })
  res.end(JSON.stringify(out))
}

function statsBody(q) {
  // missing/invalid since: last hour only, so a bad call never serializes 24 h on the host's event loop
  const since = Number(q.get("since")) || Date.now() - 3_600_000
  return {
    minutes: [...minutes].filter(([t]) => t >= since).map(([t, m]) => ({ t, routes: m.routes })),
    errors: errors.filter((e) => e.t >= since),
  }
}

// ---- live logs: stdout/stderr lines kept RAW in a ring bounded by line count and total text.
// Capture does only split + copy on the app's write path; ANSI stripping and redaction run at read time
// (<= 500 lines per poll, only while someone watches). Lines never leave the process unredacted.
const logs = [] // { seq, t, stream, text, pem? }, oldest first; seq is contiguous so index = seq - first
let logSeq = 0
let logText = 0
// Every pattern is anchored on a literal and has bounded quantifiers or disjoint classes, so an 8 KB line
// costs well under a millisecond (no catastrophic backtracking).
const ANSI = [/\x1b\[[0-9;?]*[ -\/]*[@-~]/g, /\x1b\][^\x07\x1b]{0,512}(?:\x07|\x1b\\)/g]
const REDACT = [
  [/\b([a-z][a-z0-9+.-]{1,20}:\/\/[^\s:@\/]{0,100}:)[^\s"'<>]{1,200}@/gi, "$1[redacted]@"], // scheme://user:PASS@, up to the last @ (raw @ in a password)
  // cookie values: a JSON/inspect array up to its ], a quoted string, an unterminated quote to end of line, or the bare rest
  [/\b((?:set-)?cookie["']?\s{0,10}[:=]\s{0,10})(?:\[[^\]\r\n]{0,2048}\]|"(?:[^"\\]|\\.)*"|'[^']*'|["'].*|[^"'\r\n]+)/gi, "$1[redacted]"],
  [/\b((?:password|passwd|pwd)\s{0,10}=\s{0,10})[^;"'\r\n]{1,200};/gi, "$1[redacted];"], // Password=p@ss word;
  [/(authorization["']?\s{0,10}[:=]\s{0,10}["']?)(?:(?:bearer|basic)\s{1,10})?[^\s"',;]+/gi, "$1[redacted]"],
  [/\b(bearer|basic)\s{1,10}[\w.~+/-]+=*/gi, "$1 [redacted]"],
  [/((?:password|passwd|pwd|secret|token|api[_-]?key)[\w-]{0,40}["']?\s{0,10}[:=]\s{0,10})(?:"(?:[^"\\]|\\.)*"|'[^']*'|[^\s"'&,;]+)/gi, "$1[redacted]"],
  [/\beyJ[\w-]{5,200}\.[\w-]{5,}\.[\w-]*/g, "[redacted]"], // JWT: base64url of '{"' starts every header
]
const PEM_LINES = 200 // a BEGIN without END stops hiding lines after this many
const COOKIE_LINES = 50
function clean(l) {
  if (l.pem) return "[redacted private key]"
  if (l.ck) return "[redacted]"
  let text = l.text
  if (text.includes("\x1b")) for (const re of ANSI) text = text.replace(re, "")
  if (key) text = text.replaceAll(key, "[redacted]")
  for (const [re, to] of REDACT) text = text.replace(re, to)
  return text.length > MAX_LINE ? text.slice(0, MAX_LINE) : text
}
// a slice of a bigger chunk is a V8 sliced string that pins the whole chunk; copy it out when it is much smaller
const own = (s, srcLen) => (srcLen > 2 * s.length + 64 ? Buffer.from(s).toString() : s)
function pushLine(s, raw, srcLen) {
  let text = raw.length > CUT ? raw.slice(0, CUT) : raw
  if (text.endsWith("\r")) text = text.slice(0, -1)
  const cr = text.lastIndexOf("\r") // progress bars redraw with \r: keep what the terminal shows
  if (cr >= 0) text = text.slice(cr + 1)
  text = own(text, srcLen)
  const l = { seq: ++logSeq, t: Date.now(), stream: s.name, text }
  if (s.ck > 0) { // inside a multi-line inspect array of cookies ('set-cookie': [ ... ])
    l.ck = true
    s.ck = text.includes("]") ? 0 : s.ck - 1
  } else if (text.endsWith("[") && /cookie["']?\s{0,10}:\s{0,10}\[$/i.test(text)) s.ck = COOKIE_LINES
  if (s.pem > 0 || text.includes("PRIVATE KEY-----")) { // PEM blocks span lines: hide BEGIN..END whole
    l.pem = true
    if (/-----END [A-Z ]{0,30}PRIVATE KEY-----/.test(text)) s.pem = 0
    else if (/-----BEGIN [A-Z ]{0,30}PRIVATE KEY-----/.test(text)) s.pem = PEM_LINES
    else s.pem--
  }
  logs.push(l)
  logText += text.length
  while (logs.length > MAX_LOG_LINES || logText > MAX_LOG_TEXT) logText -= logs.shift().text.length
}
function capture(s, chunk, enc) {
  const str = typeof chunk !== "string" ? s.dec.write(chunk) // Buffer / Uint8Array
    : typeof enc === "string" && !/^utf-?8$/i.test(enc) && Buffer.isEncoding(enc) ? s.dec.write(Buffer.from(chunk, enc)) // write(b64, "base64")
    : chunk
  if (!str) return
  let i = 0
  for (let j; (j = str.indexOf("\n", i)) >= 0; i = j + 1) {
    pushLine(s, s.pending + str.slice(i, Math.min(j, i + CUT)), str.length)
    s.pending = ""
  }
  if (i < str.length && s.pending.length < CUT) s.pending = own(s.pending + str.slice(i, i + CUT - s.pending.length), str.length)
}
if (key) { // no key: endpoints are off, so do not touch the app's streams at all
  let capturing = false // a write made while capturing (none today) must not recurse
  for (const [stream, name] of [[process.stdout, "out"], [process.stderr, "err"]]) {
    try {
      const orig = stream.write
      const s = { name, pending: "", pem: 0, ck: 0, dec: new StringDecoder("utf8") }
      stream.write = function (chunk, enc) {
        const r = orig.apply(this, arguments) // the app's write first, unchanged, always
        if (!capturing) {
          capturing = true
          try { capture(s, chunk, enc) } catch {}
          capturing = false
        }
        return r
      }
    } catch {}
  }
}

function logsBody(q) {
  const after = Math.max(0, Math.floor(Number(q.get("after"))) || 0)
  const limit = Math.min(MAX_PAGE, Math.max(1, Math.floor(Number(q.get("limit"))) || MAX_PAGE))
  const first = logs.length ? logs[0].seq : 0
  const last = logs.length ? logs[logs.length - 1].seq : 0
  const start = logs.length && after >= first ? after - first + 1 : 0
  // redaction runs on the host's event loop: stop after READ_BUDGET ms, the client continues from the last seq
  const page = logs.slice(start, start + limit)
  const lines = []
  const t0 = performance.now()
  for (const l of page) {
    if (lines.length && performance.now() - t0 > READ_BUDGET) break
    lines.push({ seq: l.seq, t: l.t, stream: l.stream, text: cleaned(l) })
  }
  const out = { first, last, gap: after > 0 && after < first - 1, lines }
  if (lines.length < page.length) out.more = true
  return out
}

// ---- runtime: event-loop lag, CPU over a rolling ~5 s window, cgroup limits read on request only
let lag
try {
  lag = monitorEventLoopDelay({ resolution: LAG_RES })
  lag.enable()
  setInterval(() => { try { lag.reset() } catch {} }, 60_000).unref()
} catch {}
const cpu = [] // { at: hrtime ms, u: cpuUsage }, one per second, last 6
function sampleCpu() {
  try {
    cpu.push({ at: performance.now(), u: process.cpuUsage() })
    if (cpu.length > 6) cpu.shift()
  } catch {}
}
sampleCpu()
try { setInterval(sampleCpu, 1000).unref() } catch {}

function readNum(path) {
  try {
    const v = readFileSync(path, "utf8").trim()
    const n = Number(v.split(/\s+/)[0])
    return Number.isFinite(n) ? n : null // "max" -> null
  } catch { return null }
}
function cgroup() {
  // v2 first, then v1. v1 "unlimited" is a huge number, v2 is "max"
  let memLimit = readNum("/sys/fs/cgroup/memory.max")
  let memUsage = readNum("/sys/fs/cgroup/memory.current")
  let cpuQuota = null
  let cpuMax = null
  try { cpuMax = readFileSync("/sys/fs/cgroup/cpu.max", "utf8").trim().split(/\s+/) } catch {}
  if (cpuMax) {
    if (cpuMax[0] !== "max" && Number(cpuMax[1]) > 0) cpuQuota = Number(cpuMax[0]) / Number(cpuMax[1])
  } else {
    const q = readNum("/sys/fs/cgroup/cpu/cpu.cfs_quota_us")
    const p = readNum("/sys/fs/cgroup/cpu/cpu.cfs_period_us")
    if (q > 0 && p > 0) cpuQuota = q / p
  }
  memLimit ??= readNum("/sys/fs/cgroup/memory/memory.limit_in_bytes")
  memUsage ??= readNum("/sys/fs/cgroup/memory/memory.usage_in_bytes")
  if (memLimit !== null && memLimit >= 2 ** 60) memLimit = null
  return { memLimit, memUsage, cpuQuota: cpuQuota === null ? null : Math.round(cpuQuota * 100) / 100 }
}
const ms = (ns) => Math.max(0, Math.round((ns / 1e6 - LAG_RES) * 100) / 100) // histogram counts the timer interval itself

function runtimeBody() {
  const m = process.memoryUsage()
  const a = cpu[0]
  const at = performance.now()
  const u = process.cpuUsage()
  const dt = (at - a.at) * 1000 // µs
  const cpuPct = dt > 0 ? Math.round(((u.user - a.u.user + u.system - a.u.system) / dt) * 1000) / 10 : 0
  let eventLoop = { p50: 0, p99: 0, max: 0 }
  if (lag?.count) {
    eventLoop = { p50: ms(lag.percentile(50)), p99: ms(lag.percentile(99)), max: ms(lag.max) }
    lag.reset()
  }
  return {
    node: process.version, pid: process.pid, hostname: hostname(), uptime: Math.round(process.uptime() * 10) / 10,
    memory: { rss: m.rss, heapUsed: m.heapUsed, heapTotal: m.heapTotal, external: m.external },
    cgroup: cgroup(),
    cpuPct,
    eventLoop,
  }
}

// ---- calls: every request that ends >= 400, with headers, bodies and the log lines from that moment.
// On the response path only references are taken (res.write/res.end chunks, up to MAX_BODY, and only once the
// status is >= 400); decoding, masking and serializing run in a setImmediate after finish. Key set only.
const MAX_CALLS = 2000
const MAX_CALL_TEXT = 8 * 1024 * 1024 // chars of serialized calls across the ring
const MAX_BODY = 16384
const MAX_CALL_PAGE = 200
const PAGE_TEXT = 1024 * 1024 // per calls response, so one poll never serializes the whole 8 MB on the host's loop
const CALL_LOGS = 50
const CALL_LOG_TEXT = 8192 // chars of log lines per call, so line size never decides how many calls the ring holds
const MAX_CHUNKS = 64 // many tiny writes are merged into one copy past this
const MASK_BUDGET = 2 * MAX_BODY // chars of a parsed body walked; past it values become "[cut]"
const SECRET_HEADERS = new Set(["authorization", "proxy-authorization", "cookie", "set-cookie", "x-devlens-key"])
const PW_KEY = /^(password|passwd|pwd|new_?password|old_?password|confirm_?password|current_?password)$/i
const MAX_DEPTH = 20
const calls = [] // { size, out, call, lines }, oldest first; call.seq is contiguous so index = seq - first
let callSeq = 0
let callText = 0

const hide = (s) => (key && s.includes(key) ? s.replaceAll(key, "[redacted]") : s)
// The cheap masking only (user decision): password-named keys in parsed JSON, no free-text scanning.
// Builds a copy (the app's object is never touched) and walks at most b.n chars of keys + values, so an 11 MB
// body costs the same as a 32 KB one: only ~16 KB is kept anyway. Past the budget values become "[cut]".
function mask(v, b, d = 0) {
  if (b.n <= 0) { b.cut = true; return "[cut]" }
  if (typeof v === "string") {
    b.n -= v.length
    if (v.length <= MAX_BODY) return v
    b.cut = true
    return v.slice(0, MAX_BODY)
  }
  b.n -= 8
  if (v === null || typeof v !== "object") return v
  if (d >= MAX_DEPTH) return "[too deep]" // also ends cycles
  if (Array.isArray(v)) {
    const out = []
    for (let i = 0; i < v.length; i++) {
      if (b.n <= 0) { b.cut = true; out.push("[cut]"); break }
      out.push(mask(v[i], b, d + 1))
    }
    return out
  }
  if (v instanceof Date) return v
  if (ArrayBuffer.isView(v)) return `[binary ${v.byteLength} bytes]`
  if (typeof v.toJSON === "function") { // a DTO / ORM document: mask what JSON.stringify would emit, under the same budget
    const j = v.toJSON()
    return j !== v && j !== null && typeof j === "object" ? mask(j, b, d + 1) : mask(j, b, d)
  }
  // class instances fall through: their own enumerable keys, walked and masked like a plain object
  const out = Object.create(null) // a "__proto__" key from JSON.parse stays a plain key
  // ponytail: for-in still lets V8 enumerate a giant flat object's keys once; arrays (the bulk-import shape) stop at the budget
  for (const k in v) {
    if (!Object.hasOwn(v, k)) continue
    if (b.n <= 0) { b.cut = true; out[k] = "[cut]"; break }
    b.n -= k.length
    out[k] = PW_KEY.test(k) ? "[redacted]" : mask(v[k], b, d + 1)
  }
  return out
}
function heads(h) {
  const out = {}
  for (const [n, v] of Object.entries(h || {})) {
    const name = n.toLowerCase()
    out[name] = SECRET_HEADERS.has(name) ? "[redacted]" : hide(Array.isArray(v) ? v.join(", ") : String(v))
  }
  return out
}
function text(s, cut) {
  if (s === null) return { body: null, truncated: false }
  const len = s.length
  if (len > MAX_BODY + key.length) { s = s.slice(0, MAX_BODY + key.length); cut = true } // room for a key straddling the cut
  s = hide(s)
  if (s.length > MAX_BODY) { s = s.slice(0, MAX_BODY); cut = true }
  return { body: own(s, len), truncated: cut }
}
function reqBody(b) {
  if (b === undefined || b === null) return text(null)
  if (typeof b === "string") return text(b, false)
  if (Buffer.isBuffer(b)) return text(b.toString("utf8", 0, MAX_BODY), b.length > MAX_BODY)
  const bud = { n: MASK_BUDGET, cut: false }
  const s = JSON.stringify(mask(b, bud)) ?? null
  return text(s, bud.cut)
}
const toBuf = ([x, e]) => (typeof x === "string" ? Buffer.from(x, Buffer.isEncoding(e) ? e : "utf8") : x)
function resBody(c, res) {
  if (!c.chunks) return text("", false) // HEAD: nothing was sent
  const enc = res.getHeader("content-encoding")
  if (enc && String(enc).toLowerCase() !== "identity") return { body: `[compressed: ${enc}]`, truncated: false }
  let s = Buffer.concat(c.chunks.map(toBuf)).toString()
  let cut = c.cut
  if (!cut && /json/i.test(String(res.getHeader("content-type")))) {
    let o, ok = true
    try { o = JSON.parse(s) } catch { ok = false }
    if (ok) { // not in the try: a failed stringify drops the call, never keeps it unmasked
      const bud = { n: MASK_BUDGET, cut: false }
      s = JSON.stringify(mask(o, bud))
      cut = bud.cut
    }
  }
  return text(s, cut)
}
// Cleaned once per ring line (l.c), however many calls or /logs reads include it.
const cleaned = (l) => (l.c ??= clean(l))
// The lines nearest the failure: walk back from finish, at most CALL_LOGS lines / CALL_LOG_TEXT chars, later win.
// Only references to the RAW ring entries, each with its share of the text cap: cleaning waits for /calls reads,
// off the error path, and a line never leaves the process before it is cleaned.
function logsAround(from, to) {
  const out = []
  let room = CALL_LOG_TEXT
  for (let i = logs.length - 1; i >= 0 && out.length < CALL_LOGS && room > 0; i--) {
    const l = logs[i]
    if (l.t > to) continue
    if (l.t < from) break
    // cleaned text is cut to n, so the total stays <= the cap; a hidden line's placeholder is never cut mid-word
    const n = Math.min(l.pem || l.ck ? Math.max(l.text.length, 24) : l.text.length, MAX_LINE, room)
    room -= n
    out.push([l, n])
  }
  return out.reverse()
}
const callLine = ([l, n]) => {
  const text = cleaned(l)
  return { t: l.t, stream: l.stream, text: text.length > n ? own(text.slice(0, n), text.length) : text }
}
// Runs inside the response path: references only, and nothing at all while the status is < 400.
// The status is final here: headers went out with the first write (HEAD sends no body, so it keeps nothing).
function keep(c, res, chunk, enc) {
  if (!c.chunks || res.statusCode < 400 || chunk == null || typeof chunk === "function" || !chunk.length) return
  const room = MAX_BODY - c.bytes
  if (room <= 0) { c.cut = true; return }
  let x = chunk
  if (chunk.length > room) { // copy the head out: a slice/subarray would pin a huge chunk until the call is saved
    x = typeof chunk === "string" ? own(chunk.slice(0, room), chunk.length) : Buffer.from(chunk.subarray(0, room))
    c.cut = true
  }
  c.bytes += x.length
  c.chunks.push([x, typeof enc === "string" ? enc : undefined])
  // tiny-chunk writers (CSV/SSE, 1-byte writes): merge into one copy so per-response tuples stay bounded
  if (c.chunks.length >= MAX_CHUNKS) c.chunks = [[Buffer.concat(c.chunks.map(toBuf)), undefined]]
}
function wrapRes(res, method) {
  const c = { at: Date.now(), chunks: method === "HEAD" ? null : [], bytes: 0, cut: false }
  const write = res.write
  const end = res.end
  res.write = function (chunk, enc) {
    const r = write.apply(this, arguments) // the app's call first, unchanged, always; a throw reaches the app as before
    try { keep(c, res, chunk, enc) } catch {}
    return r
  }
  res.end = function (chunk, enc) {
    const r = end.apply(this, arguments)
    try { keep(c, res, chunk, enc) } catch {}
    return r
  }
  return c
}
function saveCall(c, req, res, method, url, route, status, took, t, ip) {
  const call = {
    seq: 0, t, method, url: hide(url), route, status, ms: Math.round(took * 10) / 10, ip,
    req: { headers: heads(req.headers), ...reqBody(req.body) },
    res: { headers: heads(res.getHeaders()), ...resBody(c, res) },
  }
  const lines = logsAround(c.at - 100, t + 50)
  // estimate, not JSON.stringify(call): a storm would pay a full serialization per call for one number
  let size = 512 + call.url.length + route.length + (call.req.body?.length ?? 0) + (call.res.body?.length ?? 0)
  for (const h of [call.req.headers, call.res.headers]) for (const n in h) size += n.length + h[n].length + 6
  let raw = 0
  for (const [l, n] of lines) { size += n + 48; raw += l.text.length }
  call.seq = ++callSeq // nothing above can be half-done: a call that threw never took a seq
  // out: serialized size (lines are cut to n). size: memory held, since a referenced line stays alive after the
  // log ring drops it, its raw text counts too (its cleaned cache, <= MAX_LINE chars, is not counted: small, bounded)
  calls.push({ size: size + raw, out: size, call, lines })
  callText += size + raw
  while (calls.length > MAX_CALLS || callText > MAX_CALL_TEXT) callText -= calls.shift().size
}

function callsBody(q) {
  const after = Math.max(0, Math.floor(Number(q.get("after"))) || 0)
  const limit = Math.min(MAX_CALL_PAGE, Math.max(1, Math.floor(Number(q.get("limit"))) || MAX_CALL_PAGE))
  const first = calls.length ? calls[0].call.seq : 0
  const last = calls.length ? calls[calls.length - 1].call.seq : 0
  const page = []
  let size = 0
  const t0 = performance.now()
  // whole calls only: a cut (size or the READ_BUDGET of log cleaning) lands between calls, and the client
  // continues from the last seq returned, so nothing is skipped
  for (let i = calls.length && after >= first ? after - first + 1 : 0; i < calls.length && page.length < limit; i++) {
    if (page.length && (size + calls[i].out > PAGE_TEXT || performance.now() - t0 > READ_BUDGET)) break
    size += calls[i].out
    page.push({ ...calls[i].call, logs: calls[i].lines.map(callLine) })
  }
  return { first, last, gap: after > 0 && after < first - 1, more: page.length > 0 && page.at(-1).seq < last, calls: page }
}

const ENDPOINTS = new Map([["stats", statsBody], ["logs", logsBody], ["runtime", runtimeBody], ["calls", callsBody]])

// req.baseUrl is the matched path (/users/12345), not the mount pattern. Masking, per segment:
// 1. a segment equal to a learned value becomes :name (any length);
// 2. else every learned value of length >= 2 inside it becomes :name, longest first
//    (/files/:name.:ext -> :name.:ext, /n/:first-:last -> :first-:last). This can over-mask a literal
//    segment that happens to contain a value (users/user -> :userIds): cosmetic, never a leak;
// 3. else digits, uuid, long hex, >= 24 chars become :id.
// Wildcard parts (Express 4 "*" = "a/b", Express 5 "*rest" = ["a", "b"]) render as :0 / :rest, and a run
// of consecutive segments of the same wildcard collapses to one, so /w/a/b and /w/c share one key.
const ID = /^(\d+|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{16,})$/i
const esc = (v) => v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
function maskSeg(seg, byValue) {
  let d = seg
  try { d = decodeURIComponent(seg) } catch {}
  const e = byValue.get(d)
  if (e) return e
  const hits = []
  for (const v of byValue.keys()) if (v.length >= 2 && d.includes(v)) hits.push(v)
  if (hits.length) {
    hits.sort((a, b) => b.length - a.length) // alternation tries in order: longest value wins at each spot
    return d.replace(new RegExp(hits.map(esc).join("|"), "g"), (m) => ":" + byValue.get(m).name)
  }
  return ID.test(seg) || seg.length >= 24 ? ":id" : seg
}
function maskBase(base, byValue) {
  const out = []
  let prev
  for (const seg of base.split("/")) {
    const m = maskSeg(seg, byValue)
    if (typeof m === "string") out.push(m)
    else if (!(m.wild && prev?.wild && prev.name === m.name)) out.push(":" + m.name)
    prev = m
  }
  return out.join("/")
}
// No route pattern (auth middleware 401 before routing, app-level handlers): the raw pathname, each segment
// masked by maskRaw, at most 8 segments / 200 chars. A bot scan of random paths is bounded by MAX_ROUTES.
const MAX_SEGS = 8
const MAX_PATH = 200
const DIGIT = /\d/
const LETTER = /[a-z]/i
// privacy, unrouted paths only: ids as above, plus emails (@ / %40), dotted names with digits longer than 12
// (report.2024.10.pdf), and 12+ chars mixing letters and digits (tokens, slugs carrying ids). Linear tests only.
function maskRaw(seg) {
  if (ID.test(seg) || seg.length >= 24 || seg.includes("@") || seg.includes("%40")) return ":id"
  if (seg.length < 12 || !DIGIT.test(seg)) return seg
  return (seg.length > 12 && seg.includes(".")) || LETTER.test(seg) ? ":id" : seg
}
function maskPath(path) {
  if (typeof path !== "string" || path[0] !== "/") return "(unmatched)"
  const segs = path.split("/", MAX_SEGS + 2) // "" before the leading "/", 8 kept, 1 more tells us it was cut
  let out = ""
  for (let i = 1; i < segs.length && i <= MAX_SEGS; i++) out += "/" + maskRaw(segs[i])
  if (segs.length > MAX_SEGS + 1 || out.length > MAX_PATH) out = out.slice(0, MAX_PATH) + "/…"
  return out
}

const origEmit = http.Server.prototype.emit
http.Server.prototype.emit = function (event, req, res) {
  if (event === "request") {
    let served = false
    try {
      const url = req.url
      const q = url.indexOf("?")
      const path = q < 0 ? url : url.slice(0, q)
      const at = key ? path.lastIndexOf(PREFIX) : -1
      const body = at >= 0 && ENDPOINTS.get(path.slice(at + PREFIX.length))
      if (body) {
        served = true
        serve(req, res, q < 0 ? "" : url.slice(q + 1), body)
        return true
      }
      if (!path.endsWith("/health")) {
        const t0 = process.hrtime.bigint()
        const method = req.method
        // Express restores baseUrl when a route throws/rejects, so capture the key when it assigns req.route.
        // Express replaces req.params at every level (mount, router, route, sub-app), so remember every
        // value->name pair it ever assigns and mask against the union when the request finishes.
        // snap: copy of the learned pairs when req.route is assigned. At that moment they are exactly the
        // ancestor chain; later depth-0 assignments (error handler, custom 404, router exit) would wipe them.
        let route, base, snap
        const seen = new Map()
        let params = req.params
        // Each pair is tagged with the baseUrl length it was assigned at. A new assignment at depth d
        // drops pairs at depth >= d: those came from layers that matched, called next(), and are not
        // ancestors of the layer now running (e.g. a fall-through app.use("/:lang", mw)).
        const learn = (p, d) => {
          for (const [v, e] of seen) if (e.d >= d) seen.delete(v)
          for (const [name, v] of Object.entries(p || {})) {
            if (typeof v === "string" && v) seen.set(v, { name, d })
            // wildcard values span segments: learn each part (an encoded %2F value also stays whole above)
            const parts = Array.isArray(v) ? v : typeof v === "string" && v.includes("/") ? v.split("/") : []
            for (const x of parts) if (typeof x === "string" && x && !seen.has(x)) seen.set(x, { name, d, wild: true })
          }
        }
        Object.defineProperty(req, "params", {
          configurable: true,
          enumerable: true,
          get: () => params,
          set(v) { params = v; try { learn(v, (this.baseUrl || "").length) } catch {} },
        })
        Object.defineProperty(req, "route", {
          configurable: true,
          enumerable: true,
          get: () => route,
          set(v) {
            if (v === route) return // Express assigns each route twice
            route = v
            try { base = this.baseUrl || ""; snap = new Map(seen) } catch {}
          },
        })
        const cap = key ? wrapRes(res, method) : null // no key: the response object is not touched
        res.on("finish", () => {
          try {
            // no snapshot means base was never safely captured: fall back to the masked path, never a raw baseUrl
            const pattern = route && snap && maskBase(base, snap) + String(route.path)
            // finalhandler's 404 (route called next()) carries this CSP; a handler's own 404 does not
            const status = res.statusCode
            const fallthrough = status === 404 && res.getHeader("content-security-policy") === "default-src 'none'"
            const k = pattern && !fallthrough ? pattern : status === 404 ? "(not found)" : maskPath(path)
            const took = Number(process.hrtime.bigint() - t0) / 1e6
            record(method, k, status, took)
            if (cap && status >= 400) {
              const t = Date.now()
              const xff = req.headers["x-forwarded-for"]
              // read now: the socket may be closed or reused by the time the deferred step runs
              const ip = (typeof xff === "string" && xff.split(",", 1)[0].trim()) || req.headers["x-real-ip"] || req.socket?.remoteAddress || null
              setImmediate(() => { try { saveCall(cap, req, res, method, url, k, status, took, t, ip) } catch {} })
            }
          } catch {}
        })
      }
    } catch {
      if (served) { // never hand a half-served stats request to the app
        try { res.destroy() } catch {}
        return true
      }
    }
  }
  return origEmit.apply(this, arguments)
}
