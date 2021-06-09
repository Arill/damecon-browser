import { app, session as electronSession } from 'electron'
import { EventEmitter } from 'events'
import path from 'path'
import { promises as fs } from 'fs'

import { BrowserActionAPI } from './api/browser-action'
import { TabsAPI } from './api/tabs'
import { WindowsAPI } from './api/windows'
import { WebNavigationAPI } from './api/web-navigation'
import { ExtensionStore } from './store'
import { ContextMenusAPI } from './api/context-menus'
import { RuntimeAPI } from './api/runtime'
import { CookiesAPI } from './api/cookies'
import { NotificationsAPI } from './api/notifications'
import { ChromeExtensionImpl } from './impl'
import { CommandsAPI } from './api/commands'
import { ExtensionContext } from './context'
import { ExtensionRouter } from './router'

export interface ChromeExtensionOptions extends ChromeExtensionImpl {
  session?: Electron.Session

  /**
   * Path to electron-chrome-extensions module files. Might be needed if
   * JavaScript bundlers like Webpack are used in your build process.
   */
  modulePath?: string
}

const sessionMap = new WeakMap<Electron.Session, ElectronChromeExtensions>()

/**
 * Provides an implementation of various Chrome extension APIs to a session.
 */
export class ElectronChromeExtensions extends EventEmitter {
  /** Retrieve an instance of this class associated with the given session. */
  static fromSession(session: Electron.Session) {
    return sessionMap.get(session)
  }

  private ctx: ExtensionContext
  private modulePath: string

  private browserAction: BrowserActionAPI
  private contextMenus: ContextMenusAPI
  private commands: CommandsAPI
  private cookies: CookiesAPI
  private notifications: NotificationsAPI
  private runtime: RuntimeAPI
  private tabs: TabsAPI
  private webNavigation: WebNavigationAPI
  private windows: WindowsAPI

  constructor(opts?: ChromeExtensionOptions) {
    super()

    const { session = electronSession.defaultSession, modulePath, ...impl } = opts || {}

    if (sessionMap.has(session)) {
      throw new Error(`Extensions instance already exists for the given session`)
    }

    sessionMap.set(session, this)

    const store = new ExtensionStore(impl)

    this.ctx = {
      emit: this.emit.bind(this),
      router: ExtensionRouter.get(),
      session,
      store,
    }

    this.modulePath = modulePath || path.join(__dirname, '..')

    this.browserAction = new BrowserActionAPI(this.ctx)
    this.contextMenus = new ContextMenusAPI(this.ctx)
    this.commands = new CommandsAPI(this.ctx)
    this.cookies = new CookiesAPI(this.ctx)
    this.notifications = new NotificationsAPI(this.ctx)
    this.runtime = new RuntimeAPI(this.ctx)
    this.tabs = new TabsAPI(this.ctx)
    this.webNavigation = new WebNavigationAPI(this.ctx)
    this.windows = new WindowsAPI(this.ctx)

    app.on('web-contents-created', this.onWebContentsCreated)

    this.prependPreload()
  }

  private async prependPreload() {
    const { session } = this.ctx
    let preloads = session.getPreloads()

    const preloadPath = path.join(this.modulePath, 'dist/preload.js')

    const preloadIndex = preloads.indexOf(preloadPath)
    if (preloadIndex > -1) {
      preloads.splice(preloadIndex, 1)
    }

    preloads = [preloadPath, ...preloads]
    session.setPreloads(preloads)

    let preloadExists = false
    try {
      const stat = await fs.stat(preloadPath)
      preloadExists = stat.isFile()
    } catch {}

    if (!preloadExists) {
      console.error(
        `Unable to access electron-chrome-extensions preload file (${preloadPath}). Consider configuring the 'modulePath' constructor option.`
      )
    }
  }

  private onWebContentsCreated = (event: Electron.Event, webContents: Electron.WebContents) => {
    if (webContents.session !== this.ctx.session) return

    if (webContents.getType() === 'backgroundPage') {
      this.addExtensionHost(webContents)
    }
  }

  /** Add webContents to be tracked as a tab. */
  addTab(tab: Electron.WebContents, window: Electron.BrowserWindow) {
    this.ctx.store.addTab(tab, window)
  }

  /** Notify extension system that the active tab has changed. */
  selectTab(tab: Electron.WebContents) {
    if (this.ctx.store.tabs.has(tab)) {
      this.tabs.onActivated(tab.id)
    }
  }

  /**
   * Add webContents to be tracked as an extension host which will receive
   * extension events when a chrome-extension:// resource is loaded.
   *
   * This is usually reserved for extension background pages and popups, but
   * can also be used in other special cases.
   */
  addExtensionHost(host: Electron.WebContents) {
    this.ctx.store.addExtensionHost(host)
  }

  /**
   * Get collection of menu items managed by the `chrome.contextMenus` API.
   * @see https://developer.chrome.com/extensions/contextMenus
   */
  getContextMenuItems(webContents: Electron.WebContents, params: Electron.ContextMenuParams) {
    return this.contextMenus.buildMenuItemsForParams(webContents, params)
  }

  /**
   * Add extensions to be visible as an extension action button.
   *
   * @deprecated Not needed in Electron >=12.
   */
  addExtension(extension: Electron.Extension) {
    this.browserAction.processExtension(this.ctx.session, extension)
  }

  /**
   * Remove extensions from the list of visible extension action buttons.
   *
   * @deprecated Not needed in Electron >=12.
   */
  removeExtension(extension: Electron.Extension) {
    this.browserAction.removeActions(this.ctx.session, extension.id)
  }
}

/**
 * @deprecated Use `ElectronChromeExtensions` instead.
 */
export const Extensions = ElectronChromeExtensions
