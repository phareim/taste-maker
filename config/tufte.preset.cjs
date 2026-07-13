/* Tufte Viz Tailwind preset — semantic, theme-aware utilities over the
   --tufte-* / semantic CSS variables in assets/css/tufte.css.
   One accent per screen. Hairlines, never boxes. */

module.exports = {
  theme: {
    extend: {
      colors: {
        paper:          'var(--surface-page)',
        'paper-raised': 'var(--surface-card)',
        'paper-sunk':   'var(--surface-sunk)',
        ink:            'var(--text-strong)',
        body:           'var(--text-body)',
        mute:           'var(--text-muted)',
        faint:          'var(--text-faint)',
        accent:         'var(--tufte-accent)',
        'accent-ink':   'var(--text-accent)',
        rule:           'var(--border-rule)',
        'rule-strong':  'var(--border-strong)',
      },
      fontFamily: {
        serif: ['et-book', 'Charter', 'Palatino', 'Georgia', 'serif'],
        mono:  ['SF Mono', 'ui-monospace', 'Menlo', 'Consolas', 'monospace'],
      },
      borderColor: {
        rule: 'var(--border-rule)',
        'rule-strong': 'var(--border-strong)',
      },
      maxWidth: {
        measure: '65ch',
      },
    },
  },
}
