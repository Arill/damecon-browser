const path = require('path')
const fsSync = require('fs')
const fs = fsSync.promises
const { app, session, BrowserWindow, globalShortcut, ipcMain } = require('electron')
const ConfigStore = require('configstore')

const { Tabs } = require('./tabs')
const { ElectronChromeExtensions } = require('electron-chrome-extensions')
const { setupMenu } = require('./menu')
const { buildChromeContextMenu } = require('electron-chrome-context-menu')
const { KC3Updater } = require('./kc3updater.js')

const packageJson = JSON.parse(fsSync.readFileSync('package.json', 'utf8'));
const defaultConfig = {
  window: {
    state: {
      width: 1200,
      height: 800
    }
  },
  kc3kai: {
    update: {
      channel: 'release',
      schedule: 'startup',
      auto: true
    }
  },
  proxy: {
    client: {
      host: '127.0.0.1',
      port: 8081,
      enable: false
    }
  }
}
const config = new ConfigStore(packageJson.name, defaultConfig, {globalConfigPath: true});

app.commandLine.appendSwitch("force-gpu-mem-available-mb", "10000")
app.commandLine.appendSwitch("force-gpu-rasterization")
app.commandLine.appendSwitch("enable-native-gpu-memory-buffers")
app.commandLine.appendSwitch("enable-gpu-memory-buffer-compositor-resources")


if (process.execPath.match(/(damecon(-browser)?|chrome)/)) {
  currPath = path.dirname(process.execPath)
  let p = path.join(currPath, 'userdata')
  app.setPath('userData', p)
} else {
  // app.commandLine.appendSwitch('proxy-server', '192.168.0.123:1235')
}

let webuiExtensionId
let kc3ExtensionId
let kc3StartPageUrl
let newTabUrl
let settingsUrl
const manifestExists = async (dirPath) => {
  if (!dirPath) return false
  const manifestPath = path.join(dirPath, 'manifest.json')
  try {
    return (await fs.stat(manifestPath)).isFile()
  } catch {
    return false
  }
}

async function loadExtensions(session, extensionsPath) {
  const subDirectories = await fs.readdir(extensionsPath, {
    withFileTypes: true,
  })

  const extensionDirectories = await Promise.all(
    subDirectories
      .filter((dirEnt) => dirEnt.isDirectory())
      .map(async (dirEnt) => {
        const extPath = path.join(extensionsPath, dirEnt.name)

        if (await manifestExists(extPath)) {
          return extPath
        }

        const extSubDirs = await fs.readdir(extPath, {
          withFileTypes: true,
        })

        const versionDirPath =
          extSubDirs.length === 1 && extSubDirs[0].isDirectory()
            ? path.join(extPath, extSubDirs[0].name)
            : null

        if (await manifestExists(versionDirPath)) {
          return versionDirPath
        }
      })
  )

  const results = []

  for (const extPath of extensionDirectories.filter(Boolean)) {
    //console.log(`Loading extension from ${extPath}`)
    try {
      const extensionInfo = await session.loadExtension(extPath)
      results.push(extensionInfo)
    } catch (e) {
      console.error(e)
    }
  }

  return results
}

const getParentWindowOfTab = (tab) => {
  switch (tab.getType()) {
    case 'window':
      return BrowserWindow.fromWebContents(tab)
    case 'browserView':
    case 'webview':
      return tab.getOwnerBrowserWindow()
    case 'backgroundPage':
      return BrowserWindow.getFocusedWindow()
    default:
      throw new Error(`Unable to find parent window of '${tab.getType()}'`)
  }
}

class TabbedBrowserWindow {
  constructor(options) {
    this.session = options.session || session.defaultSession
    this.extensions = options.extensions

    // Can't inheret BrowserWindow
    // https://github.com/electron/electron/issues/23#issuecomment-19613241
    this.window = new BrowserWindow(options.window)
    this.id = this.window.id
    this.webContents = this.window.webContents

    const webuiUrl = path.join('chrome-extension://', webuiExtensionId, '/webui.html')
    this.webContents.loadURL(webuiUrl)
    this.webContents.openDevTools({mode: 'right'})

    this.tabs = new Tabs(this.window, { newTabPageUrl: newTabUrl, hideAddressBarFor: options.hideAddressBarFor })


    const self = this

    this.tabs.on('tab-created', function onTabCreated(tab, url) {
      // Track tab that may have been created outside of the extensions API.
      self.extensions.addTab(tab.webContents, tab.window)
    })

    this.tabs.on('tab-navigated', function onTabNavigated(tab, url) {
      if (url === kc3StartPageUrl) {
        tab.webContents.openDevTools({ mode: 'bottom', activate: true })
      }
    })

    this.tabs.on('tab-selected', function onTabSelected(tab) {
      self.extensions.selectTab(tab.webContents)
    })

    this.tabs.on('tabs-hidden', function onTabsHidden(hidden) {
      self.webContents.send('webui-message', {message: 'tabs-hidden', value: hidden})
    })

    queueMicrotask(() => {
      // Create initial tab
      if (options.initialUrls) {
        let initialTabId
        for (let i = 0; i < options.initialUrls.length; i++) {
          const url = options.initialUrls[i]
          const tab = self.tabs.create({
            initialUrl: url,
            activate: i === 0,
            devToolsMode: url == kc3StartPageUrl ? 'bottom' : undefined
          })
          if (i === 0)
            initialTabId = tab.id
        }
        this.tabs.select(initialTabId)
      }
      else {
        const tab = self.tabs.create({
          initialUrl: newTabUrl,
          activate: true,
        })
        this.tabs.select(tab.id)
      }
    })
  }

  destroy() {
    this.tabs.destroy()
    this.window.destroy()
  }

  getFocusedTab() {
    return this.tabs.selected
  }
}

class Browser {
  windows = []

  constructor() {
    app.whenReady().then(this.init.bind(this))

    app.on('window-all-closed', () => {
      if (process.platform !== 'darwin') {
        this.destroy()
      }
    })

    app.on('web-contents-created', this.onWebContentsCreated.bind(this))
  }

  destroy() {
    app.quit()
  }

  getFocusedWindow() {
    return this.windows.find((w) => w.window.isFocused()) || this.windows[0]
  }

  getWindowFromBrowserWindow(window) {
    return !window.isDestroyed() ? this.windows.find((win) => win.id === window.id) : null
  }

  getWindowFromWebContents(webContents) {
    let window

    if (this.popup && webContents === this.popup.browserWindow?.webContents) {
      window = this.popup.parent
    } else {
      window = getParentWindowOfTab(webContents)
    }

    return window ? this.getWindowFromBrowserWindow(window) : null
  }

  processes = {};
  onProcessStarted(name) {
    console.log(`Process started: ${name}`)
    /*
    let process = this.processes[name]
    if (process) throw new Error(`Process '${name}' already in progress.`);
    this.processes[name] = new ProgressBar({
      indeterminate: false,
      text: name,
      detail: 'Please wait...',
      maxValue: 1.001, // prevent it from closing automatically when it reaches 100%
      browserWindow: {
        parent: this.progressBarParent
      }
    });/**/
  }
  onProcessProgress(name, phase, current, total) {
    if (total && total >= current) {
      const progressFormatted = new Intl.NumberFormat(undefined, { maximumSignificantDigits: 3 }).format(current / total * 100);
      console.log(`Process progress: ${name} (${phase}) - ${current}/${total} (${progressFormatted}%)`)
    }
    else {
      console.log(`Process progress: ${name} - waiting...`)
    }
    /*
    let process = this.processes[name]
    if (!process) return;
    if (total && total >= current) {
      process.detail = `${phase}: ${current} of ${total} (${progressFormatted}%)...`;
      process.value = current / total;
    } else {
      process.detail = 'Just a moment.';
      process.value = 0;
    }/**/
  }
  onProcessCompleted(name) {
    console.log(`Process completed: ${name}`)
    /*
    let process = this.processes[name]
    if (!process) return;
    process.setCompleted();
    process.close();
    delete this.processes[name];
    /**/
  }

  async init() {
    this.initSession()
    setupMenu(this)

    app.on("browser-window-focus", () => {
      globalShortcut.registerAll(["CommandOrControl+W"], () => { return; });
    });
    app.on("browser-window-blur", () => {
      globalShortcut.unregisterAll();
    });

    const browserPreload = path.join(__dirname, '../preload.js')
    this.session.setPreloads([browserPreload])

    this.extensions = new ElectronChromeExtensions({
      session: this.session,

      createTab: (details) => {
        const win =
          typeof details.windowId === 'number' &&
          this.windows.find((w) => w.id === details.windowId)

        if (!win) {
          throw new Error(`Unable to find windowId=${details.windowId}`)
        }

        const tab = win.tabs.create()


        if (details.url) tab.loadURL(details.url || newTabUrl)
        if (typeof details.active === 'boolean' ? details.active : true) win.tabs.select(tab.id)

        return [tab.webContents, tab.window]
      },
      selectTab: (tab, browserWindow) => {
        const win = this.getWindowFromBrowserWindow(browserWindow)
        win?.tabs.select(tab.id)
      },
      deselect: (browserWindow) => {
        const win = this.getWindowFromBrowserWindow(browserWindow)
        win?.tabs.select(tab.id)
      },
      removeTab: (tab, browserWindow) => {
        const win = this.getWindowFromBrowserWindow(browserWindow)
        win?.tabs.remove(tab.id)
      },

      createWindow: (details) => {
        const win = this.createWindow(details)
        // if (details.active) tabs.select(tab.id)
        return win.window
      },
      removeWindow: (browserWindow) => {
        const win = this.getWindowFromBrowserWindow(browserWindow)
        win?.destroy()
      },
    })

    this.extensions.on('browser-action-popup-created', (popup) => {
      this.popup = popup
    })

    // extension containing window chrome UI
    const webuiExtension = await this.session.loadExtension(path.join(__dirname, 'ui'))
    webuiExtensionId = webuiExtension.id
    
    // initial window creation
    const webuiBase = 'chrome-extension://' + webuiExtensionId
    newTabUrl = webuiBase + '/new-tab.html'
    settingsUrl = webuiBase + '/settings.html'
    const win = this.createWindow({ initialUrls: [settingsUrl], hideAddressBarFor: [settingsUrl] })
    const extensionsPath = path.join(__dirname, '../../../extensions')
    const kc3Path = path.join(extensionsPath, 'kc3kai')

    ipcMain.handle('webui-message', async (ev, message, data) => {
      console.log('main.js received message', message, data)
      if (message == 'get-config-item') {
        return config.get(data.value);
      }
      else if (message == 'get-config') {
        return config.all;
      }
      else if (message == 'set-config-item') {
        return config.set(data.key, data.value);
      }
      else if (message == 'kc3-doupdate') {
        await this.updateKc3(kc3Path);
      }
    })

      await this.updateKc3(kc3Path);
      await this.checkStartKc3(win, extensionsPath, kc3Path);
    
    const installedExtensions = await loadExtensions(this.session, extensionsPath)

    win.tabs.show()
  }

  async updateKc3(kc3Path) {
    let kc3updater = new KC3Updater({
      onProcessStarted: this.onProcessStarted.bind(this),
      onProcessProgress: this.onProcessProgress.bind(this),
      onProcessCompleted: this.onProcessCompleted.bind(this)
    })
    await kc3updater.update(kc3Path)
  }

  async checkStartKc3(win, extensionsPath, kc3Path) {
    const kc3SrcPath = path.join(kc3Path, 'src')

    // once we're updated and kc3 is loaded, remove the default new tab page
    // and open the kc3 start page + strat room
    const kc3 = await this.session.loadExtension(kc3SrcPath)
    const installedExtensions = await loadExtensions(this.session, extensionsPath)
    if (kc3) {
      console.log('KC3Kai loaded!')

      // store the initial tab so we can remove it
      const initialTab = win.tabs.selected;

      // open KC3 start page
      kc3ExtensionId = kc3.id
      kc3StartPageUrl = 'chrome-extension://' + kc3ExtensionId + '/pages/game/direct.html'
      const startTab = win.tabs.create({ initialUrl: kc3StartPageUrl })
      
      // TODO: make strat room auto-open optional
      const kc3StratRoomUrl = 'chrome-extension://' + kc3ExtensionId + '/pages/strategy/strategy.html'
      win.tabs.create({ initialUrl: kc3StratRoomUrl })

      initialTab.destroy()
      win.tabs.select(startTab.id)
    }
  }

  initSession() {
    this.session = session.defaultSession

    // Remove Electron and App details to closer emulate Chrome's UA
    const userAgent = this.session
      .getUserAgent()
      .replace(/\sElectron\/\S+/, '')
      .replace(new RegExp(`\\s${app.getName()}/\\S+`), '')
    this.session.setUserAgent(userAgent)
  }

  createWindow(options) {
    const windowState = config.get('window.state');

    const win = new TabbedBrowserWindow({
      ...options,
      extensions: this.extensions,
      window: {
        width: windowState?.width || defaultConfig.window.state.width,
        height: windowState?.height || defaultConfig.window.state.height,
        frame: false,
        webPreferences: {
          contextIsolation: true
          //, enableRemoteModule: true
        },
        icon: path.join(__dirname, 'icon.ico')
      },
    })
    win.window.on('resize', () => {
      const size = win.window.getSize()
      config.set('window.state.width', size[0]);
      config.set('window.state.height', size[1]);
    })

    this.windows.push(win)

    if (process.env.SHELL_DEBUG) {
      win.webContents.openDevTools({ mode: 'detach' })
    }

    return win
  }

  async onWebContentsCreated(event, webContents) {
    const type = webContents.getType()
    const url = webContents.getURL()
    // console.log(`'web-contents-created' event [type:${type}, url:${url}]`)

    if (process.env.SHELL_DEBUG && webContents.getType() === 'backgroundPage') {
      webContents.openDevTools({ mode: 'detach', activate: true })
    }

    webContents.setWindowOpenHandler((details) => {
      switch (details.disposition) {
        case 'foreground-tab':
        case 'background-tab':
        case 'new-window': {
          // setWindowOpenHandler doesn't yet support creating BrowserViews
          // instead of BrowserWindows. For now, we're opting to break
          // window.open until a fix is available.
          // https://github.com/electron/electron/issues/33383
          queueMicrotask(() => {
            const win = this.getWindowFromWebContents(webContents)
            // don't open a tab by default
            //const tab = win.tabs.create()
            //tab.loadURL(details.url)
          })

          return { action: 'deny' }
        }
        default:
          return { action: 'allow' }
      }
    })

    webContents.on('context-menu', (event, params) => {
      const menu = buildChromeContextMenu({
        params,
        webContents,
        extensionMenuItems: this.extensions.getContextMenuItems(webContents, params),
        openLink: (url, disposition) => {
          const win = this.getFocusedWindow()

          switch (disposition) {
            case 'new-window':
              this.createWindow({ initialUrl: url })
              break
            default:
              const tab = win.tabs.create()
              tab.loadURL(url)
          }
        },
      })

      menu.popup()
    })
  }
}

module.exports = Browser
