/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./app/**/*.{html,js,ejs}",
    "./test/**/*.{html,js}",
    "./*.html"
  ],
  theme: {
    extend: {
      colors: {
        'brand': {
          'primary': '#F8BA59',
          'secondary': '#451F21',
          'light': '#fac876',
          'dark': '#5c2a2d'
        }
      },
      fontFamily: {
        'sora': ['Sora', 'sans-serif'],
        'avenir': ['Avenir Book', 'sans-serif'],
        'avenir-medium': ['Avenir Medium', 'sans-serif'],
        'ringbearer': ['Ringbearer', 'serif']
      },
      backdropFilter: {
        'none': 'none',
        'blur': 'blur(20px)',
      },
      animation: {
        'pulse-slow': 'pulse 3s ease-in-out infinite',
        'float': 'float 6s ease-in-out infinite',
      },
      keyframes: {
        float: {
          '0%, 100%': { transform: 'translateY(0px) rotate(0deg)' },
          '50%': { transform: 'translateY(-20px) rotate(180deg)' },
        }
      }
    },
  },
  plugins: [],
}