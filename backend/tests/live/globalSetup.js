// Runs once per `pnpm test:live`: creates this run's records (fixtures.js)
// and hands the file to every suite through LIVE_RUN_FILE. The TestCRM proof
// (client.js) runs before the first write; a refusal fails the whole run.
require("./env");
const { createRun, writeRun } = require("./fixtures");

module.exports = async function globalSetup() {
  const run = await createRun();
  process.env.LIVE_RUN_FILE = writeRun(run);
};
