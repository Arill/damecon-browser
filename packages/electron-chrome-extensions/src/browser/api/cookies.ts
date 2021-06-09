import { ExtensionContext } from '../context'
import { ExtensionEvent } from '../router'

enum CookieStoreID {
  Default = '0',
  Incognito = '1',
}

const createCookieDetails = (cookie: Electron.Cookie): chrome.cookies.Cookie => ({
  ...cookie,
  domain: cookie.domain || '',
  hostOnly: Boolean(cookie.hostOnly),
  session: Boolean(cookie.session),
  path: cookie.path || '',
  httpOnly: Boolean(cookie.httpOnly),
  secure: Boolean(cookie.secure),
  storeId: CookieStoreID.Default,
})

export class CookiesAPI {
  private get cookies() {
    return this.ctx.session.cookies
  }

  constructor(private ctx: ExtensionContext) {
    const handle = this.ctx.router.apiHandler(this.ctx)
    handle('cookies.get', this.get.bind(this))
    handle('cookies.getAll', this.getAll.bind(this))
    handle('cookies.set', this.set.bind(this))
    handle('cookies.remove', this.remove.bind(this))
    handle('cookies.getAllCookieStores', this.getAllCookieStores.bind(this))
  }

  private async get(
    event: ExtensionEvent,
    details: chrome.cookies.Details
  ): Promise<chrome.cookies.Cookie | null> {
    // TODO: storeId
    const cookies = await this.cookies.get({
      url: details.url,
      name: details.name,
    })

    // TODO: If more than one cookie of the same name exists for the given URL,
    // the one with the longest path will be returned. For cookies with the
    // same path length, the cookie with the earliest creation time will be returned.
    return cookies.length > 0 ? createCookieDetails(cookies[0]) : null
  }

  private async getAll(
    event: ExtensionEvent,
    details: chrome.cookies.GetAllDetails
  ): Promise<chrome.cookies.Cookie[]> {
    // TODO: storeId
    const cookies = await this.cookies.get({
      url: details.url,
      name: details.name,
      domain: details.domain,
      path: details.path,
      secure: details.secure,
      session: details.session,
    })

    return cookies.map(createCookieDetails)
  }

  private async set(
    event: ExtensionEvent,
    details: chrome.cookies.SetDetails
  ): Promise<chrome.cookies.Cookie | null> {
    await this.cookies.set(details)
    const cookies = await this.cookies.get(details)
    return cookies.length > 0 ? createCookieDetails(cookies[0]) : null
  }

  private async remove(
    event: ExtensionEvent,
    details: chrome.cookies.Details
  ): Promise<chrome.cookies.Details | null> {
    try {
      await this.cookies.remove(details.url, details.name)
    } catch {
      return null
    }
    return details
  }

  private async getAllCookieStores(event: ExtensionEvent): Promise<chrome.cookies.CookieStore[]> {
    const tabIds = Array.from(this.ctx.store.tabs)
      .map((tab) => (tab.isDestroyed() ? undefined : tab.id))
      .filter(Boolean) as number[]
    return [{ id: CookieStoreID.Default, tabIds }]
  }
}
