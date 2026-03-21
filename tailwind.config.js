/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        display: ['Space Grotesk', 'Inter', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
      // Extended screen sizes for 4K support
      screens: {
        '3xl': '1920px',  // Full HD+
        '4xl': '2560px',  // 2K / QHD
        '5xl': '3200px',  // Near 4K
      },
      // Extended max-width values for 4K containers
      maxWidth: {
        '8xl': '88rem',    // 1408px
        '9xl': '96rem',    // 1536px
        '10xl': '120rem',  // 1920px
        '4k': '200rem',    // 3200px
      },
      keyframes: {
        orbFloat: {
          '0%, 100%': { transform: 'translate(0, 0) scale(1)' },
          '33%': { transform: 'translate(20px, -15px) scale(1.05)' },
          '66%': { transform: 'translate(-15px, 10px) scale(0.95)' },
        },
      },
      animation: {
        'orb-float': 'orbFloat 8s ease-in-out infinite',
      },
    },
  },
}
