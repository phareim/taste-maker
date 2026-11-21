// A stand-in for the Workers runtime's HTMLRewriter, which plain Node does
// not have. It covers only what server/utils/enrich/metadata.ts registers
// (`meta`, `title`, JSON-LD scripts) and finds them with regexes, so it says
// nothing about how the real parser treats unusual markup. Text arrives the
// way the real one delivers it: in pieces, the last one empty with
// lastInTextNode set.
function attributes(tag) {
  const attrs = {}
  for (const m of tag.matchAll(/([^\s"'<>\/=]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g)) {
    attrs[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? ''
  }
  return attrs
}

function deliverText(handler, text) {
  if (!handler.text) return
  const half = Math.ceil(text.length / 2)
  handler.text({ text: text.slice(0, half), lastInTextNode: false })
  handler.text({ text: text.slice(half), lastInTextNode: false })
  handler.text({ text: '', lastInTextNode: true })
}

export class FakeHTMLRewriter {
  constructor() {
    this.handlers = []
  }

  on(selector, handler) {
    this.handlers.push({ selector, handler })
    return this
  }

  transform(response) {
    const run = (html) => {
      for (const { selector, handler } of this.handlers) {
        if (selector === 'meta') {
          for (const m of html.matchAll(/<meta\b[^>]*>/gi)) {
            const attrs = attributes(m[0])
            handler.element?.({ getAttribute: (name) => attrs[name.toLowerCase()] ?? null })
          }
        } else if (selector === 'title') {
          for (const m of html.matchAll(/<title\b[^>]*>([\s\S]*?)<\/title>/gi)) {
            handler.element?.({})
            deliverText(handler, m[1])
          }
        } else if (selector === 'script[type="application/ld+json"]') {
          for (const m of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
            handler.element?.({})
            deliverText(handler, m[1])
          }
        } else {
          throw new Error(`FakeHTMLRewriter does not know the selector ${selector}`)
        }
      }
    }
    // Lazy like the real one: handlers run as the body is consumed.
    return new Response(
      new ReadableStream({
        async pull(controller) {
          const html = await response.text()
          run(html)
          controller.enqueue(new TextEncoder().encode(html))
          controller.close()
        },
      })
    )
  }
}
