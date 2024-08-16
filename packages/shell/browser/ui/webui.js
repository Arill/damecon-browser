class WebUI {
  windowId = -1
  activeTabId = -1
  tabList = []
  settingsUrl = 'chrome-extension://' + chrome.runtime.id + '/settings.html'

  constructor() {
    const $ = document.querySelector.bind(document)

    this.$ = {
      body: $('body'),
      root: $('#root'),
      topBar: $('#topbar'),
      tabList: $('#tabstrip .tab-list'),
      tabTemplate: $('#tabtemplate'),
      createTabButton: $('#createtab'),
      toolBar: $('.toolbar'),
      goBackButton: $('#goback'),
      goForwardButton: $('#goforward'),
      reloadButton: $('#reload'),
      addressUrl: $('#addressurl'),

      browserActions: $('#actions'),

      minimizeButton: $('#minimize'),
      maximizeButton: $('#maximize'),
      closeButton: $('#close'),
    }

    this.$.createTabButton.addEventListener('click', () => chrome.tabs.create())
    this.$.goBackButton.addEventListener('click', () => chrome.tabs.goBack())
    this.$.goForwardButton.addEventListener('click', () => chrome.tabs.goForward())
    this.$.reloadButton.addEventListener('click', () => chrome.tabs.reload())
    this.$.addressUrl.addEventListener('keypress', this.onAddressUrlKeyPress.bind(this))

    this.$.minimizeButton.addEventListener('click', () =>
      chrome.windows.get(chrome.windows.WINDOW_ID_CURRENT, (win) => {
        chrome.windows.update(win.id, { state: win.state === 'minimized' ? 'normal' : 'minimized' })
      })
    )
    this.$.maximizeButton.addEventListener('click', () =>
      chrome.windows.get(chrome.windows.WINDOW_ID_CURRENT, (win) => {
        chrome.windows.update(win.id, { state: win.state === 'maximized' ? 'normal' : 'maximized' })
      })
    )
    this.$.closeButton.addEventListener('click', () => chrome.windows.remove())
    
    // Received message from main.js
    ipc.on('webui-message', (ev, msg) => {
      if (msg?.type) {
        switch (msg.type) {
          case 'status-kc3-is-updating':
          case 'error-do-update':
          case 'update-process-started':
          case 'update-process-progress':
          case 'update-process-completed':
            chrome.runtime.sendMessage(msg);
            break;
          default:
            alert('webui.js received unknown webui-message type:\n' + JSON.stringify(msg))
            break;
        }
      }
      else alert('webui.js received unknown webui-message:\n' + JSON.stringify(msg))
    })

    // Received message from settings.js/new-tab.js
    chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
      (async () => {
        let result;
        try {
          switch (msg.type) {
            case 'get-config':
              result = await ipc.send('webui-message', 'get-config');
              break;
            case 'get-config-item':
              result = await ipc.send('webui-message', 'get-config-item', {key: msg.data.key});
              break;
            case 'set-config-item':
              result = await ipc.send('webui-message', 'set-config-item', {key: msg.data.key, value: msg.data.value});
              if (msg.data.key == 'window.style.theme') {
                this.$.body.dataset.colorTheme = msg.data.value;
              }
              else if (msg.data.key == 'window.style.brightness') {
                this.$.body.dataset.brightness = msg.data.value;
              }
              break;
            case 'kc3-doupdate':
            case 'kc3-get-isupdating':
              result = await ipc.send('webui-message', msg.type);
              break;
            default:
              throw new Error(`Unknown message type ${msg.type || '(none)'}`);
          }
          sendResponse({ result, complete: true});
        }
        catch (error) {
          console.log('webui.js encountered an error retrieving a response to a message', error)
          sendResponse({ error, complete: false });
        }
      })();
      return true;
    }.bind(this))
    
    this.init()
  }

  async init() {
    await this.initTheme()
    await this.initTabs()
  }

  async initTheme() {
    const theme = await ipc.send('webui-message', 'get-config-item', {key: 'window.style.theme'})
    this.$.body.dataset.colorTheme = theme
    const bright = await ipc.send('webui-message', 'get-config-item', {key: 'window.style.brightness'})
    this.$.body.dataset.brightness = bright
  }

  async initTabs() {
    const tabs = await new Promise((resolve) => chrome.tabs.query({ windowId: -2 }, resolve))
    this.tabList = [...tabs]

    const activeTab = this.tabList.find((tab) => tab.active)
    this.setActiveTab(activeTab)

    // Wait to setup tabs and windowId prior to listening for updates.
    this.setupBrowserListeners()
  }

  setupBrowserListeners() {
    if (!chrome.tabs.onCreated) {
      throw new Error(`chrome global not setup. Did the extension preload not get run?`)
    }

    const findTab = (tabId) => {
      const existingTab = this.tabList.find((tab) => tab.id === tabId)
      return existingTab
    }

    const findOrCreateTab = (tabId) => {
      const existingTab = findTab(tabId)
      if (existingTab) return existingTab

      const newTab = { id: tabId }
      this.tabList.push(newTab)
      return newTab
    }

    chrome.tabs.onCreated.addListener((tab) => {
      if (tab.windowId !== this.windowId) return
      const newTab = findOrCreateTab(tab.id)
      Object.assign(newTab, tab)
      this.renderTabs()
    })

    chrome.tabs.onActivated.addListener((activeInfo) => {
      if (activeInfo.windowId !== this.windowId) return

      this.setActiveTab(activeInfo)
    })

    chrome.tabs.onUpdated.addListener((tabId, changeInfo, details) => {
      const tab = findTab(tabId)
      if (!tab) return
      Object.assign(tab, details)
      if (tab.active) {
        this.setActiveTab(tab)
      }
      else
        this.renderTabs()
    })

    chrome.tabs.onRemoved.addListener((tabId) => {
      const tabIndex = this.tabList.findIndex((tab) => tab.id === tabId)
      if (tabIndex > -1) {
        this.tabList.splice(tabIndex, 1)
        this.$.tabList.querySelector(`[data-tab-id="${tabId}"]`).remove()
      }
    })
  }

  setActiveTab(activeTab) {
    this.activeTabId = activeTab?.id || activeTab?.tabId
    this.windowId = activeTab?.windowId || this.windowId
    this.renderTabs()
  }

  renderTabs() {
    let activeFound = this.activeTabId == -1
    let activeTab

    for (let i = 0; i < this.tabList.length; i++) {
      const tab = this.tabList[i]
      const isActiveTab = tab.id === this.activeTabId
      if (this.activeTabId && isActiveTab) {
        tab.active = true
        activeTab = tab
      } else {
        tab.active = false
      }
      activeFound = tab.active || activeFound
      if (!tab.active && i > 0)
        tab.tabPosition = activeFound ? 'after' : 'before'
      this.renderTab(tab)
    }
    this.renderToolbar(activeTab)
  }

  onAddressUrlKeyPress(event) {
    if (event.code === 'Enter') {
      const url = this.$.addressUrl.value
      chrome.tabs.update({ url })
    }
  }

  createTabNode(tab) {
    const tabElem = this.$.tabTemplate.content.cloneNode(true).firstElementChild
    tabElem.dataset.tabId = tab.id

    tabElem.addEventListener('click', () => {
      chrome.tabs.update(tab.id, { active: true })
    })
    tabElem.querySelector('.close').addEventListener('click', () => {
      chrome.tabs.remove(tab.id)
    })

    this.$.tabList.appendChild(tabElem)
    return tabElem
  }

  renderTab(tab) {
    let tabElem = this.$.tabList.querySelector(`[data-tab-id="${tab.id}"]`)
    if (!tabElem) tabElem = this.createTabNode(tab)

    if (tab.active) {
      tabElem.dataset.active = ''
      delete tabElem.dataset.tabPosition
    } else {
      delete tabElem.dataset.active
      tabElem.dataset.tabPosition = tab.tabPosition
    }


    if (tab.url == this.settingsUrl) {
      tabElem.dataset.compact = ''
    } else {
      delete tabElem.dataset.compact
    }
    

    const favicon = tabElem.querySelector('.favicon')
    if (tab.favIconUrl) {
      favicon.src = tab.favIconUrl
    } else {
      delete favicon.src
    }

    tabElem.querySelector('.title').textContent = tab.title
    tabElem.querySelector('.audio').disabled = !tab.audible
  }

  renderToolbar(tab) {
    this.$.addressUrl.value = tab?.url
    // this.$.browserActions.tab = tab.id
    
    if (tab?.url == this.settingsUrl)
      this.$.toolBar.dataset.hidden = ''
    else
      delete this.$.toolBar.dataset.hidden
  }
}

window.webui = new WebUI()
