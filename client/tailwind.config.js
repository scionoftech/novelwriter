/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        serif: ['Georgia', 'Charter', 'Iowan Old Style', 'Times New Roman', 'serif'],
      },
      colors: {
        ink: {
          950: '#0d0f14',
          900: '#12141b',
          850: '#171a23',
          800: '#1d212c',
          700: '#2a2f3d',
          600: '#3b4152',
          500: '#565d70',
          400: '#7a8194',
          300: '#9aa1b3',
          200: '#c3c8d4',
          100: '#e4e7ee',
        },
        accent: {
          400: '#e8b34b',
          500: '#d99e2b',
          600: '#b98420',
        },
      },
    },
  },
  plugins: [],
};
