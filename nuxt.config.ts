// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2024-04-03',
  devtools: { enabled: false },

  // Tufte base layer first (fonts + tokens + dark palette), then the app's
  // own main.css can override on top.
  css: ['~/assets/css/tufte.css', '~/assets/css/main.css'],

  app: {
    head: {
      title: 'taste-maker',
      // Tufte Viz tactile paper layer: <html> opts in, <body> is the desk.
      // Drop `tufte-tactile` here and the whole app falls back to flat paper.
      htmlAttrs: { class: 'tufte-tactile' },
      bodyAttrs: { class: 'tufte-desk' },
      meta: [
        { name: 'description', content: 'A personal taste library' },
        { name: 'viewport', content: 'width=device-width, initial-scale=1, viewport-fit=cover' },
        // The desk, not the paper — the tactile layer's page ground.
        { name: 'theme-color', content: '#7a7062', media: '(prefers-color-scheme: light)' },
        { name: 'theme-color', content: '#2a2622', media: '(prefers-color-scheme: dark)' },
      ],
    },
  },

  modules: ['@nuxtjs/tailwindcss'],

  nitro: {
    preset: 'cloudflare-module',
  },

  runtimeConfig: {
    allowedUserEmails: '', // NUXT_ALLOWED_USER_EMAILS (wrangler [vars], comma-separated)
  },

  typescript: {
    strict: false,
    typeCheck: false,
  },

  components: {
    dirs: [
      // Tufte shared primitives auto-imported WITHOUT a path prefix so they
      // are <MonoLabel>, <CardFrame>, etc. (NOT <TufteMonoLabel>).
      { path: '~/components/tufte', pathPrefix: false },
      { path: '~/components', pathPrefix: false },
    ],
  },
})
