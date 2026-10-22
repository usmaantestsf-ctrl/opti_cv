import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "media",
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        accent: {
          DEFAULT: "#4f46e5", // indigo-600
          hover: "#4338ca",   // indigo-700
          light: "#e0e7ff",   // indigo-100
        },
      },
    },
  },
  plugins: [],
};

export default config;
