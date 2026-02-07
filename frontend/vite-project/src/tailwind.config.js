/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        "brand-blue": "#144584",
        "brand-blue-hover": "#0d315e",
        "brand-orange": "#f7b918",
        "brand-orange-hover": "#e5ab14",
        "status-finished": "#10b981",
        "status-cancelled": "#ef4444",
        "ui-bg": "#f8f9fa",
        "ui-card": "#ffffff",
        "ui-border": "#e5e7eb",
        "text-main": "#1a1a1a",
        "text-muted": "#64748b",
      },
      fontFamily: {
        sans: ["Inter", "sans-serif"],
      },
      borderRadius: {
        DEFAULT: "0.25rem",
        lg: "0.5rem",
        xl: "0.75rem",
        full: "9999px",
      },
    },
  },
  plugins: [],
};
