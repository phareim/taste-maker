/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'media',
  presets: [
    require('./config/tufte.preset.cjs'),
  ],
  content: [
    "./components/**/*.{js,vue,ts}",
    "./layouts/**/*.vue",
    "./pages/**/*.vue",
    "./plugins/**/*.{js,ts}",
    "./app.vue",
  ],
}
