// components/ItemCard.vue links an item's source_url only through linkableUrl.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { ROOT } from './helpers/setup.mjs'

const { linkableUrl } = await import('~/utils/linkableUrl')

test('linkableUrl: http and https are links, every other scheme is not', () => {
  assert.equal(linkableUrl('https://example.test/a?b=1'), 'https://example.test/a?b=1')
  assert.equal(linkableUrl(' http://example.test '), 'http://example.test/')
  for (const raw of ['javascript:alert(document.domain)', 'JavaScript:alert(1)', ' javascript:alert(1)', 'data:text/html,<script>alert(1)</script>', 'vbscript:x', 'file:///etc/passwd', 'example.test/no-scheme', '', null, undefined]) {
    assert.equal(linkableUrl(raw), null, String(raw))
  }
})

test('ItemCard never binds the raw source_url to a link or window.open', () => {
  const vue = readFileSync(`${ROOT}/components/ItemCard.vue`, 'utf8')
  assert.doesNotMatch(vue, /:href="item\.source_url"/)
  assert.doesNotMatch(vue, /window\.open\(props\.item\.source_url/)
  assert.match(vue, /:href="sourceHref"/)
  assert.match(vue, /linkableUrl\(props\.item\.source_url\)/)
})
