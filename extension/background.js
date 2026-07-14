const MENU_SELECTION_ID = 'taste-capture-selection'
const MENU_IMAGE_ID = 'taste-capture-image'

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: MENU_SELECTION_ID,
    title: 'Capture to taste library',
    contexts: ['selection'],
  })
  chrome.contextMenus.create({
    id: MENU_IMAGE_ID,
    title: 'Capture to taste library',
    contexts: ['image'],
  })
})

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab) return

  let pending
  if (info.menuItemId === MENU_SELECTION_ID) {
    pending = {
      kind: 'quote',
      body: info.selectionText || '',
      title: tab.title || '',
      source_url: tab.url || '',
    }
  } else if (info.menuItemId === MENU_IMAGE_ID) {
    pending = {
      kind: 'art',
      body: '',
      image_url: info.srcUrl || '',
      title: tab.title || '',
      source_url: tab.url || '',
    }
  } else {
    return
  }

  await chrome.storage.session.set({ pendingCapture: pending })
  await chrome.windows.create({
    url: chrome.runtime.getURL('popup.html'),
    type: 'popup',
    width: 420,
    height: 640,
  })
})
