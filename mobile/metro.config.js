// Metro bundler config.
//
// Stays .js on purpose (see CLAUDE.md §9.1): Metro reads this before any
// TypeScript transform exists, so it cannot be .ts like app.config.ts is.

const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

/**
 * Teach Metro the module-system export conditions.
 *
 * Expo ships `unstable_enablePackageExports: true` with
 * `unstable_conditionNames: []`, relying entirely on
 * `unstable_conditionsByPlatform` — which on iOS is just `["react-native"]`.
 * A package whose `exports` map declares only `import`/`require` therefore
 * matches nothing, and Metro warns before falling back to file-based
 * resolution:
 *
 *   Attempted to import the module "reactotron-react-query" which is listed
 *   in the "exports" of ... however no match was resolved for this request
 *   (platform = ios). Falling back to file-based resolution.
 *
 * `reactotron-react-query` is the one that trips it — its exports are
 * `{ import, types }` with no `require`, no `default`, no `react-native`.
 *
 * Adding these does NOT override the platform conditions above: a package that
 * publishes a `react-native` entry still resolves to it. This only gives Metro
 * something to match when a package speaks only CJS/ESM. `require` before
 * `import` because Metro wants the CommonJS build where one exists.
 */
config.resolver.unstable_conditionNames = ["require", "import"];

module.exports = config;
