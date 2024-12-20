const { EventEmitter } = require('events')
const { BrowserView } = require('electron')

const toolbarHeight = 62
const tabBarHeight = 32

class Tab {
  constructor(parentWindow) {
    this.view = new BrowserView()
    this.id = this.view.webContents.id
    this.window = parentWindow
    this.webContents = this.view.webContents
    this.window.addBrowserView(this.view)
  }

  destroy() {
    if (this.destroyed) return

    this.destroyed = true

    this.hide()

    this.window.removeBrowserView(this.view)
    this.window = undefined

    if (this.webContents.isDevToolsOpened()) {
      this.webContents.closeDevTools()
    }

    // TODO: why is this no longer called?
    this.webContents.emit('destroyed')

    this.webContents.destroy()
    this.webContents = undefined

    this.view = undefined
  }

  loadURL(url) {
    return this.view.webContents.loadURL(url)
  }

  show() {
    const [width, height] = this.window.getSize()
    this.view.setBackgroundColor('white');

    const yOffset = this.hideToolbar ? tabBarHeight : toolbarHeight;
    this.view.setBounds({ x: 0, y: yOffset, width: width, height: height - yOffset })
    this.view.setAutoResize({ width: true, height: true })
    // this.window.addBrowserView(this.view)
  }

  hide() {
    this.view.setAutoResize({ width: false, height: false })
    this.view.setBounds({ x: -1000, y: 0, width: 0, height: 0 })
    // TODO: can't remove from window otherwise we lose track of which window it belongs to
    // this.window.removeBrowserView(this.view)
  }

  reload() {
    this.view.webContents.reload()
  }
}

class Tabs extends EventEmitter {
  tabList = []
  selected = null
  newTabPageUrl = null
  hidden = false
  hideAddressBarFor = []

  constructor(browserWindow, options) {
    super()
    this.window = browserWindow
    this.newTabPageUrl = options.newTabPageUrl ?? 'about:blank'
    this.hidden = options?.hidden ?? false
    this.hideAddressBarFor = options?.hideAddressBarFor ?? []
  }

  destroy() {
    this.tabList.forEach((tab) => tab.destroy())
    this.tabList = []

    this.selected = undefined

    if (this.window) {
      this.window.destroy()
      this.window = undefined
    }
  }

  get(tabId) {
    return this.tabList.find((tab) => tab.id === tabId)
  }

  removeExtensionTabs(extensionId) {
    console.log('removing tabs for extension', extensionId)
    console.log('all ids', this.tabList.map((tab) => tab.id));
    const tabs = this.tabList.filter(tab => tab.webContents.getURL().startsWith(`chrome-extension://${extensionId}/`))
    tabs.forEach(tab => tab.destroy())
  }

  create(options) {
    const tab = new Tab(this.window)
    this.tabList.push(tab)
    if (!this.selected)
      this.selected = tab

    
    // added
    if (options && this.hideAddressBarFor.includes(options.initialUrl)) {
      tab.hideToolbar = true
    }

    tab.show()
    const url = options?.initialUrl ?? this.newTabPageUrl
    tab.webContents.loadURL(url)
    tab.webContents.on('did-navigate', (origin, targets) => {
      this.emit('tab-navigated', tab, url)
    })
    
    this.emit('tab-created', tab)
    this.select(tab.id)
    return tab
  }

  remove(tabId) {
    console.log('removing tab with id', tabId)
    const tabIndex = this.tabList.findIndex((tab) => tab.id === tabId)
    if (tabIndex < 0) {
      throw new Error(`Tabs.remove: unable to find tab.id = ${tabId}`)
    }
    const tab = this.tabList[tabIndex]
    this.tabList.splice(tabIndex, 1)
    tab.destroy()
    if (this.selected === tab) {
      this.selected = undefined
      const nextTab = this.tabList[tabIndex] || this.tabList[tabIndex - 1]
      if (nextTab) this.select(nextTab.id)
    }
    this.emit('tab-destroyed', tab)
    if (this.tabList.length === 0) {
      this.destroy()
    }
  }

  select(tabId) {
    const tab = this.get(tabId)
    if (!tab) return
    if (this.selected && this.selected != tab)
      this.selected.hide()
    if (!this.hidden)
      tab.show()
    this.selected = tab
    this.emit('tab-selected', tab)
  }
  deselect() {
    const tab = this.selected
    if (tab) {
      this.emit('tab-deselected', tab)
      tab.hide()
    }
    this.selected = null
  }

  hide() {
    if (this.selected)
      this.deselect()
    this.hidden = true
  }

  show() {
    this.hidden = false
    if (this.selected)
      this.selected.show()
  }
}

exports.Tabs = Tabs
