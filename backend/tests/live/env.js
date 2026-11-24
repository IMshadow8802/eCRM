// Loads backend/.env.live (LIVE_BASE_URL, LIVE_PASSWORD) for the live suite
// only. Written by the owner; never printed. Missing file = client.js refuses.
require("dotenv").config({ path: require("path").join(__dirname, "..", "..", ".env.live"), quiet: true });
