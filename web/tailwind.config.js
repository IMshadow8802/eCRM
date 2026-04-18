/** @type {import('tailwindcss').Config} */
const withMT = require("@material-tailwind/react/utils/withMT");


module.exports = withMT({
  content: ["./index.html", "./src/**/*.{vue,js,ts,jsx,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      fontFamily: {
        sans: ['Poppins', 'sans-serif'],
      },
      fontWeight: {
        thin: 300,
        light: 400,
        normal: 500,     // bold-by-default: anything not explicit renders medium
        medium: 500,
        semibold: 500,   // alias so existing font-semibold calls still mean 500
        bold: 600,       // Poppins 600 reads as visually "bold" on screen
        extrabold: 700,
        black: 800,
      },
    },
  },
  plugins: [],
});