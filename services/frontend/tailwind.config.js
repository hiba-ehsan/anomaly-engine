/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        ground: '#07090e',
        'ground-tint': '#101522',
        panel: '#10141c',
        accent: {
          DEFAULT: '#ff6b00',
          warm: '#ff951f',
          hover: '#e05e00',
        },
        value: {
          DEFAULT: '#edcd8c',
          light: '#f7e3ba',
          dim: '#c4a668',
        },
        ink: {
          DEFAULT: '#f4f5f7',
          muted: '#c9ced8',
          dim: '#7e8799',
        },
        line: {
          DEFAULT: '#303139',
          hairline: '#20242e',
          strong: '#464954',
        },
        navy: {
          50: '#f0f4f8',
          100: '#d9e2ec',
          200: '#bcccdc',
          300: '#9fb3c8',
          400: '#829ab1',
          500: '#627d98',
          600: '#486581',
          700: '#334e68',
          800: '#1b2332',
          850: '#131924',
          900: '#10141c',
          950: '#07090e',
        },
        yellow: {
          400: '#edcd8c',
          500: '#ff951f',
          600: '#ff6b00',
        }
      },
      fontFamily: {
        sans: ['"IBM Plex Sans"', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
        display: ['"Host Grotesk"', '"IBM Plex Sans"', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'Monaco', 'Consolas', 'monospace'],
      },
      letterSpacing: {
        tighter: '-0.045em',
      },
      borderRadius: {
        panel: '5px',
        editorial: '4px',
        control: '0px',
      }
    },
  },
  plugins: [],
};
