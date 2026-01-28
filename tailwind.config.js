/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
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
    },
  },
}
