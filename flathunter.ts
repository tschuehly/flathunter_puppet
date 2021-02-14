import Telegrambot from "node-telegram-bot-api";
import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import AsyncNedb from 'nedb-async'
import UserAgent from 'user-agents';
import ProxyVerifier from 'proxy-verifier'
import ConfigModule from "config";
import {Browser, Page} from "puppeteer";

const {NodeSSH} = require('node-ssh')
const fs = require("fs"); // Or `import fs from "fs";` with ESM
if (!fs.existsSync('./log')){
    fs.mkdirSync('./log');
}
const logger = require('simple-node-logger').createSimpleLogger('./log/log.txt');

const config = ConfigModule.get("flathunter")
const immoScoutLinks: string[] = config.SEARCH_URL_ARRAY
const bot = new Telegrambot(config.TELEGRAM_TOKEN, {polling: true})
puppeteer.use(StealthPlugin())

const REPEAT_BEFORE_VPN_RECONNECT = [9, 12, 11, 10, 15, 13];

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
        let windscribeWorks = await testWindscribe()
        logger.info(windscribeWorks ? 'Windscribe is working' : 'Windscribe is not working')
        if (!windscribeWorks) throw 'Could not connect to Windscribe, exiting the programm'
        let proxyWorks = await testProxy()
        logger.info(proxyWorks ? 'Proxy is working' : 'Proxy is not working')
        if (!proxyWorks) throw 'Could not connect to Proxy, exiting the programm'
        await launchPuppeteer()
    } catch (e) {
        logger.error(e)
        await bot.sendMessage(config.ERROR_CHAT_ID, e);
        process.exit(1)
    }


}


async function testProxy() {
    return new Promise(async resolve => {
        logger.info('Testing Proxy');
        let proxyGood: boolean = false;
        for (let retries = 1; retries < 10; retries++) {
            logger.info(`${retries}. try`)
            proxyGood = await new Promise(async resolve => {
                ProxyVerifier.testAll(config.proxy, {}, function (error, result) {
                    logger.info(result)
                    if (result.tunnel.ok === true) {
                        resolve(true)
                    } else {
                        resolve(false)
                    }
                })
            })
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
    return new Promise(async resolve => {
        logger.info('Testing SSH');
        let windscribeGood = false;
        await ssh.connect({
            host: config.get('proxy.ipAddress'),
            port: 22,
            username: 'flathunter',
            password: '36jqU7w8AWejGcGyQKvYXxyU1cNpIB9QCSstR2XIPKiU5txSTwWnkYMQ'
        })
        logger.info('Connected to SSH')
        logger.info('Testing Windscribe')
        for (let retries = 1; retries < 10; retries++) {
            logger.info(`${retries}. try`)
            windscribeGood = await new Promise(async resolve => {
                let result = await ssh.execCommand('windscribe status', {cwd: '/home/wss'})

                if(result.stdout.includes('DISCONNECTED')){
                    logger.error("VPN : " + result.stdout)
                    resolve(false)
                } else if(result.stdout.includes('CONNECTED --')){
                    logger.info(result)
                    resolve(true)
                }else{
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
            if(retries == 5){
                await ssh.execCommand('windscribe connect de', {cwd: '/home/wss'})
            }
        }
        resolve(false)
    })
}

interface SearchResult {
    title: string;
    url: string;
    price: string;
    squareMeter: string;
    roomNumber: string;
    location: string;
}

async function switchVpnCloseBrowser(browser: Browser){
    logger.info('Switching VPN Server');
    await ssh.execCommand('windscribe connect de', {cwd: '/home/wss'})
        .then(function (result) {
            logger.info(result.stdout);
            if (result.stdout.includes('DISCONNECTED')) {
                logger.error("VPN Error")
            } else {
                logger.info('Windscribe reconnected and SSH is working');
            }
        });
    logger.info('Closing Browser');
    await browser.close();
}

async function extractSearchResults(page: Page): Promise<SearchResult[]> {
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
                        if (data.length == 3) {
                            result.price = data.item(0).textContent.replace('Kaufpreis', ' Kaufpreis')
                            result.squareMeter = data.item(1).textContent.replace('Wohnfläche', ' Wohnfläche')
                            result.roomNumber = (data.item(2) as HTMLElement).getElementsByClassName("onlySmall")[0].textContent
                        }
                        return result;
                    })
            )
}
async function launchPuppeteer() {
    const browser: Browser = await puppeteer.launch({
        headless: config.HEADLESS_MODE,
        args: ['--no-sandbox', proxyString],
    })
    try {
        logger.info('Running ..');
        const page = await browser.newPage()
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
                    await page.setViewport({width: 800, height: 1300})
                    let pathString: string = './err/err_immoscout_' + datetime + '.png';
                    await page.screenshot({path: pathString});
                    await bot.sendMessage(config.ERROR_CHAT_ID, 'IP was blacklisted');
                    await bot.sendPhoto(config.ERROR_CHAT_ID, pathString);
                    await switchVpnCloseBrowser(browser)
                    launch()
                    return
                }
                let listings: SearchResult[] = await extractSearchResults(page)
                let newListing = false;
                let newListingCount = 0;
                for (let listing of listings) {
                    await DB.asyncFindOne(listing).then(async function (doc) {
                        if (!doc) {
                            newListing = true;
                            await DB.asyncInsert(listing);
                            newListingCount++;
                            let listingMsg =  `${listing.title}
                                        ${listing.roomNumber}
                                        ${listing.squareMeter}
                                        ${listing.price}
                                        ${listing.url}
                                        ${listing.location}`
                            await bot.sendMessage(config.CHAT_ID, listingMsg);
                        }
                    })
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

            if (count % REPEAT_BEFORE_VPN_RECONNECT[reconnect] == 0) {
                await switchVpnCloseBrowser(browser)
                launch()
                return
            } else {
                await page.reload()
                logger.info('page refreshed');
            }

        } while (1)

    } catch (err) {
        logger.error('2: ' + err);
        await bot.sendMessage(config.ERROR_CHAT_ID, `error: ${err}`);
        logger.info('Closing Browser');
        await browser.close();
        launch();
        return;
    }
}



