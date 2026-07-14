const API_URL = 'https://taste.phareim.no/api/ingest/capture'

const state = { kind: 'quote' }

const els = {
  kindBtns: Array.from(document.querySelectorAll('.kind-btn')),
  bodyLabel: document.getElementById('body-label'),
  imageField: document.getElementById('image-field'),
  title: document.getElementById('title'),
  body: document.getElementById('body'),
  imageUrl: document.getElementById('image_url'),
  sourceUrl: document.getElementById('source_url'),
  creator: document.getElementById('creator'),
  note: document.getElementById('note'),
  status: document.getElementById('status'),
  submitBtn: document.getElementById('submit-btn'),
  form: document.getElementById('capture-form'),
}

function setKind(kind) {
  state.kind = kind
  els.kindBtns.forEach((btn) => btn.classList.toggle('active', btn.dataset.kind === kind))
  els.bodyLabel.textContent =
    kind === 'quote' ? 'Quote' : kind === 'art' ? 'Description' : kind === 'music' ? 'Track' : 'Body'
  els.imageField.classList.toggle('hidden', kind !== 'art')
}

els.kindBtns.forEach((btn) => btn.addEventListener('click', () => setKind(btn.dataset.kind)))

function showStatus(message, kind) {
  els.status.textContent = message
  els.status.hidden = false
  els.status.className = `status ${kind}`
}

function clearStatus() {
  els.status.hidden = true
  els.status.textContent = ''
  els.status.className = 'status'
  els.status.onclick = null
  els.status.style.cursor = ''
}

async function prefillFromPending() {
  const { pendingCapture } = await chrome.storage.session.get('pendingCapture')
  if (!pendingCapture) return false

  await chrome.storage.session.remove('pendingCapture')
  setKind(pendingCapture.kind)
  els.body.value = pendingCapture.body || ''
  els.title.value = pendingCapture.title || ''
  els.sourceUrl.value = pendingCapture.source_url || ''
  els.imageUrl.value = pendingCapture.image_url || ''
  return true
}

async function prefillFromActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (!tab) return

  els.title.value = tab.title || ''
  els.sourceUrl.value = tab.url || ''

  let selection = ''
  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => window.getSelection().toString(),
    })
    selection = result || ''
  } catch {
    selection = ''
  }

  if (selection) {
    setKind('quote')
    els.body.value = selection
  } else {
    setKind('reference')
  }
}

async function init() {
  setKind('quote')
  const usedPending = await prefillFromPending()
  if (!usedPending) await prefillFromActiveTab()
  els.body.focus()
}

async function submit(event) {
  event.preventDefault()
  const body = els.body.value.trim()
  if (!body) return

  const { extensionKey } = await chrome.storage.sync.get('extensionKey')
  if (!extensionKey) {
    showStatus('No ingest key set — click to add one.', 'error')
    els.status.style.cursor = 'pointer'
    els.status.onclick = () => chrome.runtime.openOptionsPage()
    return
  }

  els.submitBtn.disabled = true
  clearStatus()

  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${extensionKey}`,
      },
      body: JSON.stringify({
        kind: state.kind,
        body,
        title: els.title.value.trim() || null,
        source_url: els.sourceUrl.value.trim() || null,
        creator: els.creator.value.trim() || null,
        note: els.note.value.trim() || null,
        image_url: els.imageUrl.value.trim() || null,
      }),
    })

    if (res.status === 401) {
      showStatus('Key rejected — check it in options.', 'error')
      return
    }
    if (!res.ok) {
      showStatus('Could not save the item.', 'error')
      return
    }

    showStatus('Captured.', 'success')
    els.title.value = ''
    els.body.value = ''
    els.note.value = ''
    els.imageUrl.value = ''
    els.body.focus()
  } catch {
    showStatus('Network error — could not reach taste-maker.', 'error')
  } finally {
    els.submitBtn.disabled = false
  }
}

els.form.addEventListener('submit', submit)
els.form.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') submit(e)
})

init()
