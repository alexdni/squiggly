import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // Neuro theme color palette
        'neuro': {
          'primary': '#4F46E5',      // Indigo
          'secondary': '#06B6D4',    // Cyan
          'accent': '#8B5CF6',       // Purple
          'success': '#10B981',      // Green
          'warning': '#F59E0B',      // Amber
          'danger': '#EF4444',       // Red
          'dark': '#1E293B',         // Slate-800
          'light': '#F8FAFC',        // Slate-50
        },
        // EEG band colors
        'band': {
          'delta': '#7C3AED',        // Violet
          'theta': '#3B82F6',        // Blue
          'alpha1': '#06B6D4',       // Cyan
          'alpha2': '#14B8A6',       // Teal
          'smr': '#10B981',          // Green
          'beta2': '#F59E0B',        // Amber
          'hibeta': '#F97316',       // Orange
          'lowgamma': '#EF4444',     // Red
        },
      },
      backgroundImage: {
        "gradient-radial": "radial-gradient(var(--tw-gradient-stops))",
        "gradient-conic":
          "conic-gradient(from 180deg at 50% 50%, var(--tw-gradient-stops))",
      },
    },
  },
  plugins: [],
};
export default config;
