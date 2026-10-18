import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/** @type {import('tailwindcss').Config} */
export default {
  content: [
    resolve(__dirname, 'index.html'),
    resolve(__dirname, 'src/**/*.{js,ts,jsx,tsx}'),
  ],
  theme: {
    extend: {
      colors: {
        bg: {
          0: 'var(--bg-0)',
          1: 'var(--bg-1)',
          2: 'var(--bg-2)',
          3: 'var(--bg-3)',
          4: 'var(--bg-4)',
        },
        primary: {
          DEFAULT: 'var(--primary)',
          hover: 'var(--primary-hover)',
          dim: 'var(--primary-dim)',
        },
        secondary: {
          DEFAULT: 'var(--secondary)',
          hover: 'var(--secondary-hover)',
          dim: 'var(--secondary-dim)',
        },
        accent: {
          DEFAULT: 'var(--accent)',
          hover: 'var(--accent-hover)',
          dim: 'var(--accent-dim)',
        },
      },
    },
  },
  plugins: [],
}
