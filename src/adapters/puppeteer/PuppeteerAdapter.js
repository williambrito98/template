const puppeteer = require('puppeteer')
const { readdirSync } = require('fs')
const { setTimeout } = require('timers/promises')
const { getEnv, getEnvBrowser } = require('../../utils/env')
const DownloadTimeoutError = require('../../errors/browser/DownloadTimeoutError')
const { exec } = require('child_process')
const get = require('../../utils/request/get')
const BrowserConnectionError = require('../../errors/browser/BrowserConnectionError')

class PuppeteerAdapter {
    /**
      * @param config {import('puppeteer-core').LaunchOptions & import('puppeteer-core').BrowserConnectOptions & import('puppeteer-core').BrowserLaunchArgumentOptions}
      * @returns {import('puppeteer-core').Browser}
      */
    async handleBrowser(config) {
        if (global.browser) return global.browser
        if (getEnvBrowser().CREATE_BROWSER_BY_WS_ENDPOINT) {
            const chromeCommandStart = this.#getChromeCommandStart()
            exec(chromeCommandStart)
            await setTimeout(5000)
            const chromeDebugData = await get(getEnvBrowser().CHROME_REMOTE_DEBUGGING_URL)
            const webSocketDebuggerUrl = chromeDebugData?.data?.webSocketDebuggerUrl
            if (!webSocketDebuggerUrl) {
                throw new BrowserConnectionError('Não foi possível obter o webSocketDebuggerUrl')
            }
            global.browser = await puppeteer.connect({
                browserWSEndpoint: webSocketDebuggerUrl,
                ...config
            })

            return global.browser
        }
        global.browser = await puppeteer.launch(config)
        return global.browser
    }

    /**
      * @param config {import('puppeteer-core').LaunchOptions & import('puppeteer-core').BrowserConnectOptions & import('puppeteer-core').BrowserLaunchArgumentOptions}
      * @param browser {import('puppeteer-core').Browser}
      * @returns {import('puppeteer-core').Page}
      */
    async handlePage(browser, config) {
        const page = await browser.newPage()

        page.setDefaultTimeout(config.defaultTimeout)
        page.setDefaultNavigationTimeout(config.defaultNavigationTimeout)

        await page.setViewport(config.defaultViewport)

        config.pathDownload ? await this.setDownloadDirectory(config.pathDownload, page) : ''

        page.setDownloadDirectory = this.setDownloadDirectory
        page.waitForDownload = this.waitForDownload
        page.clearAllCookies = this.clearAllCookies

        return page
    }

    /**
     *
     * @param path  {string}
     * @param page  {import('puppeteer-core').Page}
     */
    async setDownloadDirectory(path, page) {
        const client = await page.target().createCDPSession()
        await client.send('Page.setDownloadBehavior', {
            downloadPath: path,
            behavior: 'allow'
        })
    }

    async clearAllCookies(page) {
        const client = await page.target().createCDPSession()
        await client.send('Network.clearBrowserCookies')
    }

    async waitForDownload(pathDownload, limit = 0) {
        if (limit >= 60000) {
            throw new DownloadTimeoutError('Limite para o download excedido')
        }
        const string = readdirSync(pathDownload).join('')
        if (!string.includes('crdownload')) {
            if (getEnv('FILE_NAME_DOWNLOAD') && !string.includes(getEnv('FILE_NAME_DOWNLOAD'))) {
                await setTimeout(1500)
                return await this.waitForDownload(pathDownload, limit + 1500)
            }
        }

        return true
    }

    #getChromeCommandStart() {
        if (process.platform === 'win32') {
            return ''
        }
        return `${getEnv('EXECUTABLE_PATH')} --remote-debugging-port=${getEnv('CHROME_REMOTE_DEBUGGING_PORT')}`
    }
}

module.exports = PuppeteerAdapter
