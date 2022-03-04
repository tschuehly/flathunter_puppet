import Telegrambot from "node-telegram-bot-api";
import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import AsyncNedb from 'nedb-async'
import UserAgent from 'user-agents';
import ProxyVerifier from 'proxy-verifier'
import ConfigModule from "config";
import {Browser, Page} from "puppeteer";

const fetch = require('node-fetch');
const {NodeSSH} = require('node-ssh')
import {timeout, TimeoutError} from 'promise-timeout';

const fs = require("fs"); // Or `import fs from "fs";` with ESM
if (!fs.existsSync('./log')) {
    fs.mkdirSync('./log');
}
import 'loud-rejection/register';

const logger = require('simple-node-logger').createSimpleLogger({
    logFilePath: './log/log.txt',
    timestampFormat: 'YYYY-MM-DD HH:mm:ss.SSS'
});
//TODO: Rolling Logger?
const config = ConfigModule.get("flathunter")
const immoScoutLinks: string[] = config.SEARCH_URL_ARRAY
const bot = new Telegrambot(config.TELEGRAM_TOKEN, {polling: true})
puppeteer.use(StealthPlugin())

const REPEAT_BEFORE_VPN_RECONNECT = [9, 12, 11, 10, 8, 13];

const proxyString = '--proxy-server=' + config.proxy.protocol + '://' + config.proxy.ipAddress + ':' + config.proxy.port;

let DB = new AsyncNedb({filename: './data/immo.db', autoload: true});
DB.asyncLoadDatabase().then()
const userAgent = new UserAgent()
const ssh = new NodeSSH();

launch()
    .then()
    .catch(e =>
        logger.error(e))

let count = 0;

async function launch() {
    try {
        while (1) {
            let windscribeWorks = await testWindscribe()
            logger.info(windscribeWorks ? 'Windscribe is working' : 'Windscribe is not working')
            if (!windscribeWorks) throw 'Could not connect to Windscribe, exiting the programm'
            // let proxyWorks = await testProxy()
            // logger.info(proxyWorks ? 'Proxy is working' : 'Proxy is not working')
            // if (!proxyWorks) throw 'Could not connect to Proxy, exiting the programm'
            let browser: Browser
            for (let retries = 1; retries < 10; retries++) {
                browser = await getBrowser();
                if(browser){break}
            }
            logger.info(browser ? 'Proxy is working' : 'Proxy is not working')
            if(!browser) throw 'Could not connect to Proxy, exiting the programm'
            await launchPuppeteer(browser)
            await switchVpnCloseBrowser(browser)
        }
    } catch (e) {
        logger.error(e)
        await bot.sendMessage(config.ERROR_CHAT_ID, `launcherror: ${e}`);
        process.exit(1)
    }


}

async function getBrowser(): Promise<Browser> {
    return new Promise(async (resolve) => {
        let browser: Browser
            try {
                browser = await puppeteer.launch({
                    headless: config.HEADLESS_MODE,
                    args: ['--no-sandbox', proxyString],
                })
                let page =  await browser.newPage()
                await page.goto("https://api.ipify.org?format=json")
                logger.info("Browser works")
                resolve(browser)
            } catch (e) {
                await browser.close()
                logger.error(e)
                await sleep(10000)
            }
        resolve(null)
    })
}

async function testProxy() {
    return new Promise(async resolve => {
        logger.info('Testing Proxy');
        let proxyGood: boolean = false;
        for (let retries = 1; retries < 10; retries++) {
            logger.info(retries + '. proxytest');
            try {
                proxyGood = await timeout(new Promise(resolve => {
                    ProxyVerifier.testAll(config.proxy, {}, function (error, result) {
                        if (result) {
                            logger.info(result)
                        }
                        if (error) {
                            logger.error(error)
                        }
                        if (result.tunnel.ok === true) {
                            resolve(true)
                        } else {
                            resolve(false)
                        }
                    })
                }), 3000)
            } catch (e) {
                logger.error(e)
            }
            if (proxyGood) {
                resolve(true)
                break
            } else {
                await sleep(5000)
            }
        }
        resolve(false)
    })

}


function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function getDatetime() {
    var currentdate = new Date();
    var datetime = currentdate.getFullYear() + "."
        + (currentdate.getMonth() + 1) + "."
        + currentdate.getDate() + "_"
        + currentdate.getHours() + "-"
        + currentdate.getMinutes() + "-"
        + currentdate.getSeconds();
    logger.info('DateTime: ' + datetime);
    return datetime;
}

async function testWindscribe() {
    return new Promise(async (resolve) => {
        try {
            logger.info('Testing SSH');
            let windscribeGood = false;
            for (let retries = 1; retries < 20; retries++) {
                logger.info(retries + '. windscribetest');
                windscribeGood = await new Promise(async resolve => {
                    try {
                        await ssh.connect({
                            host: config.get('proxy.ipAddress'),
                            port: 22,
                            username: config.WINDSCRIBE_USERNAME,
                            password: config.WINDSCRIBE_PW
                        })
                        logger.info('Connected to SSH')
                        logger.info('Testing Windscribe')
                        let result = await ssh.execCommand('windscribe status', {cwd: '/home/wss'}).catch(reason => resolve(false))
                        if (result.stdout.includes('DISCONNECTED')) {
                            logger.error("VPN : " + result.stdout)
                            resolve(false)
                        } else if (result.stdout.includes('CONNECTED --')) {
                            resolve(true)
                        } else {
                            logger.info('Windscribe did not start yet')
                            resolve(false)
                        }
                    } catch (e) {
                        logger.error(e + "")
                        resolve(false)
                    }
                });
                if (windscribeGood) {
                    resolve(true)
                    break
                } else {
                    logger.info('Sleeping')
                    await sleep(5000)
                }
                if (retries == 7 || 13) {
                    await ssh.execCommand('windscribe connect de', {cwd: '/home/wss'})
                        .catch(e => logger.error("7: " + e))
                }
            }
            resolve(false)
        } catch (e) {
            resolve(false)
        }
    })

}

let locations = ["fr","nl","de","ch","gb"]
let locationCount = 0
async function switchVpnCloseBrowser(browser: Browser) {
    logger.info('Switching VPN Server to '+ locations[locationCount]);
    await ssh.execCommand('windscribe connect '+ locations[locationCount], {cwd: '/home/wss'})
        .then(function (result) {
            if (result.stdout.includes('DISCONNECTED')) {
                logger.error("VPN Error")
            } else {
                logger.info('Windscribe reconnected and SSH is working');
            }
        });
    locationCount += 1
    if(locationCount == 5){
        locationCount = 0
    }
    logger.info('Closing Browser');
    await browser.close();
}

async function extractSearchResults(page: Page): Promise<SearchResult[]> {
    //page.on('console', consoleObj => console.log(consoleObj.text()));
    return await page.$$eval("div .result-list-entry__data",
        elements => elements.filter(function (el) {
            return el.getElementsByTagName("a").length !== 0
        }).map(
            (el) => {
                let result = {} as SearchResult
                result.url = el.getElementsByTagName("a")[0].href
                result.title = el.getElementsByTagName("h5")[0].textContent;
                if (result.title.startsWith("NEU")) {
                    result.title = result.title.replace("NEU", "")
                }
                result.location = el.getElementsByClassName("result-list-entry__address")[0].textContent;
                let data = el.getElementsByClassName("grid grid-flex gutter-horizontal-l gutter-vertical-s")[0].childNodes
                for (let item of data.values()) {
                    let itemText = (item as HTMLElement).textContent
                    console.log() //TODO: differantiate between kauf und miete
                    if (itemText.includes("Kaufpreis")) {
                        result.price = itemText.replace('Kaufpreis', ' Kaufpreis')
                    } else if (itemText.includes("Wohnfläche")) {
                        result.squareMeter = itemText.replace('Wohnfläche', ' Wohnfläche')
                    } else if (itemText.includes("Zi.")) {
                        result.roomNumber = (item as HTMLElement).getElementsByClassName("onlySmall")[0].textContent
                    } else if (itemText.includes("Grundstück")) {
                        result.squareMeter = itemText.replace('Grundstück', ' Grundstück')
                    }
                }
                return result;
            })
    )
}

async function launchPuppeteer(browser: Browser) {
    try {
        logger.info('Running ..');
        const page = await browser.newPage()
        await page.goto("https://api.ipify.org?format=json")
        await page.content();
        let ip = await page.evaluate(() =>  {
            return document.querySelector("body").innerText
        });
        console.log(ip)

        await page.setUserAgent(userAgent.toString())
        page.setDefaultTimeout(60000)
        let reconnect: number = Math.floor(Math.random() * Math.floor(6))
        do {
            count++;
            logger.info(count + '. scrape');
            for (let link of immoScoutLinks) {
                await page.goto(link);
                let datetime = getDatetime()
                const selector = '.result-list-entry__data';
                try {
                    await page.waitForSelector(selector);
                } catch (err) {
                    logger.error('1: ' + err)
                    await switchVpnCloseBrowser(browser)
                    return
                }
                let listings: SearchResult[] = await extractSearchResults(page)
                let newListing = false;
                let newListingCount = 0;
                for (let listing of listings) {
                    const doc = await DB.asyncFindOne(listing)
                    if (!doc) {
                        newListing = true;
                        await DB.asyncInsert(listing);
                        newListingCount++;
                        let {title, roomNumber, squareMeter, price, url, location} = {...listing}
                        let msg = `${title ? title + "\n" : ""}` +
                            `${roomNumber ? roomNumber + "\n" : ""}` +
                            `${squareMeter ? squareMeter + "\n" : ""}` +
                            `${price ? price + "\n" : ""}` +
                            `${location ? location + "\n" : ""}` +
                            `${url ? url + "\n" : ""}`
                        logger.info(msg)
                        await bot.sendMessage(config.CHAT_ID, msg);
                        await bot.sendMessage(config.CHAT_ID2, msg);
                    }
                }
                if (!newListing) {
                    logger.info('No new listing');
                } else {
                    logger.info('Found ' + newListingCount + ' new Listings')
                }
            }
            let timeout: number = (Math.floor(Math.random() * 10) + config.POLLING_RATE) * 1000;
            logger.info('Wait for ' + timeout + ' ms');
            await page.waitForTimeout(timeout)
            return
            // if (count % REPEAT_BEFORE_VPN_RECONNECT[reconnect] == 0) {
            //     await switchVpnCloseBrowser(browser)
                // return
            // }
        } while (1)

    } catch (err) {
        logger.error('2: ' + err);
        logger.info('Closing Browser');
        await browser.close();
        return
    }
}

interface SearchResult {
    title: string;
    url: string;
    price: string;
    squareMeter: string;
    roomNumber: string;
    location: string;
    plotSize: string;
}

