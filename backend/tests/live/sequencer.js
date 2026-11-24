// Runs the live files in a fixed order: the read-only ones first (they expect
// this run's records as fixtures.js made them), then flows (moves them), then
// shape (restores what it changes).
// A plain class: jest calls sort() and cacheResults() (shard / onlyFailures
// are not used for this suite), so @jest/test-sequencer is not needed.
const ORDER = ["matrix", "roles", "legacy", "flows", "shape"];
const rank = (p) => {
  const i = ORDER.findIndex((n) => p.endsWith(`${n}.live.js`));
  return i === -1 ? ORDER.length : i;
};

class LiveSequencer {
  sort(tests) {
    return [...tests].sort((a, b) => rank(a.path) - rank(b.path));
  }

  cacheResults() {}
}

module.exports = LiveSequencer;
module.exports.rank = rank;
