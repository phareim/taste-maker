const keyInput = document.getElementById('key')
const saveBtn = document.getElementById('save-btn')
const savedHint = document.getElementById('saved-hint')

async function init() {
  const { extensionKey } = await chrome.storage.sync.get('extensionKey')
  if (extensionKey) keyInput.value = extensionKey
}

saveBtn.addEventListener('click', async () => {
  await chrome.storage.sync.set({ extensionKey: keyInput.value.trim() })
  savedHint.style.visibility = 'visible'
  setTimeout(() => {
    savedHint.style.visibility = 'hidden'
  }, 1500)
})

init()
