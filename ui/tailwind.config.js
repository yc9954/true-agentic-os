/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Graphite Terminal palette — one accent (teal), cool graphite neutrals,
        // exactly three status hues.
        app: "#0A0C10",
        sidebar: "#0E1117",
        panel: "#0B0E14",
        panelhdr: "#12161D",
        bd: "#1C2128",
        bdsoft: "#15191F",
        fg: "#E6EDF3",
        fg2: "#9DA7B3",
        fg3: "#6E7781",
        accent: "rgb(var(--accent-rgb) / <alpha-value>)",
        accentsoft: "var(--accentsoft)",
        onaccent: "var(--onaccent)",
        ok: "#3FB950",
        warn: "#D29922",
        err: "#F85149",
      },
      fontFamily: {
        sans: ['"Inter"', '"SF Pro Text"', "-apple-system", "BlinkMacSystemFont", "system-ui", "Arial", "sans-serif"],
        mono: ['"JetBrains Mono"', '"SF Mono"', '"Cascadia Code"', "ui-monospace", "Menlo", "monospace"],
      },
      keyframes: {
        "tao-glow": {
          "0%, 100%": { boxShadow: "0 0 0 1px #2DD4BF, 0 0 18px -2px rgba(45,212,191,0.2)" },
          "50%": { boxShadow: "0 0 0 1px #2DD4BF, 0 0 22px -2px rgba(45,212,191,0.5)" },
        },
        "tao-blink": { "0%, 49%": { opacity: "1" }, "50%, 100%": { opacity: "0" } },
        "tao-pulse": { "0%, 100%": { opacity: "1" }, "50%": { opacity: "0.35" } },
      },
      animation: {
        "tao-glow": "tao-glow 1.6s ease-in-out infinite",
        "tao-blink": "tao-blink 1s step-end infinite",
        "tao-pulse": "tao-pulse 1.1s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};
