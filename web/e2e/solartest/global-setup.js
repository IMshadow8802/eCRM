// SolarTest proof before any browser opens: the backend on :5001 is up, and
// "Neha " signs in with the test-only password, which exists only on SolarTest.
import { API, token } from "./solartest.js";

export default async function globalSetup() {
  const h = await fetch(`${API}/health`).catch(() => null);
  if (h?.status !== 200) throw new Error(`refused: ${API}/health is not 200`);
  await token("neha").catch(() => { throw new Error("refused: 'Neha ' cannot sign in with LIVE_PASSWORD — this is not SolarTest"); });
}
