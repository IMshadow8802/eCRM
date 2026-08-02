// Flat config (ESLint 9+). The design-system rules below are the point of this
// file: they turn "always use the theme" from a convention people forget into
// a build error.
const expo = require("eslint-config-expo/flat");
const reactNative = require("eslint-plugin-react-native");

module.exports = [
  ...expo,
  {
    ignores: ["node_modules/**", "android/**", "ios/**", ".expo/**", "dist/**"],
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    plugins: { "react-native": reactNative },
    rules: {
      // A hex/rgb literal anywhere outside src/theme means the palette has
      // been forked. Use a token.
      "react-native/no-color-literals": "error",
      // Inline styles dodge the token system and re-allocate every render.
      "react-native/no-inline-styles": "warn",
      "react-native/no-unused-styles": "warn",

      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "react-native",
              importNames: ["Text", "TextInput", "Button", "Alert"],
              message:
                "Use the design system: Text/Input/Button from src/ui. RN's Text takes a raw fontSize (bypassing the type scale), and Alert cannot be styled or show a loading state — use Dialog.",
            },
          ],
        },
      ],
    },
  },
  {
    // The theme IS the palette, and the primitives are the only place allowed
    // to consume raw RN elements and literal colours.
    files: ["src/theme/**/*.ts", "src/ui/**/*.tsx"],
    rules: {
      "react-native/no-color-literals": "off",
      "no-restricted-imports": "off",
    },
  },
];
