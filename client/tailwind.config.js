/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        /*
         * Surface ladder for the app chrome. Every step is a pastel green, and
         * they get lighter as they come forward, so a panel reads as floating
         * above the botanical backdrop without falling back to plain white.
         *   panel  > rail > sunken > edge > page backdrop (set in index.css)
         */
        panel: {
          DEFAULT: '#f5fcf8',
          rail: '#eaf7f0',
          sunken: '#e6f4ec',
          edge: '#cde7d9',
        },
      },
    },
  },
  plugins: [],
}

