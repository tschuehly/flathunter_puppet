import Telegrambot from "node-telegram-bot-api";
import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import NeDB from "nedb";
import UserAgent from 'user-agents';
import ProxyVerifier from 'proxy-verifier'
import ConfigModule from "config";

const {NodeSSH} = require('node-ssh')

const config = ConfigModule.get("flathunter")
const immoScoutLinks: string[] = config.SEARCH_URL_ARRAY
const bot = new Telegrambot(config.TELEGRAM_TOKEN, {polling: true})
puppeteer.use(StealthPlugin())
const REPEAT_BEFORE_VPN_RECONNECT = [9, 12, 11, 10, 15, 13];

const proxyString = '--proxy-server=' + config.proxy.protocol + '://' + config.proxy.ipAddress + ':' + config.proxy.port;

let DB = new NeDB({filename: './data/immo.db', autoload: true});
DB.loadDatabase();
const userAgent = new UserAgent()
const ssh = new NodeSSH();


let retries = 20;
testProxy(launchPuppeteer);

function testProxy(callback) {
    console.log('Testing Proxy, ' + retries + ' retries left');
    if (retries == 0) {
        throw "Could not connect to proxy";
    }
    retries = retries - 1;
    ProxyVerifier.testAll(config.proxy, {}, async function (error, result) {
        if (error) {
            // Some unusual error occurred.
        } else {
            console.log(result);
            if (result.tunnel.ok === true) {
                console.log('Proxy good')
                callback();
            } else {
                await sleep(5000);
                testProxy(launchPuppeteer);
            }
            // The result object will contain success/error information.
        }
    });
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
    console.log('DateTime: ' + datetime);
    return datetime;
}

let count = 0;

function testSSH() {
    ssh.connect({
        host: config.get('proxy.ipAddress'),
        port: 22,
        username: 'flathunter',
        password: '36jqU7w8AWejGcGyQKvYXxyU1cNpIB9QCSstR2XIPKiU5txSTwWnkYMQ'
    }).then(function () {
        console.log('Connected to SSH')
        ssh.execCommand('windscribe status', {cwd: '/home/wss'})
            .then(function (result) {
                if (result.stderr) {
                    console.log('STDERR: ' + result.stderr + ' END OF STDERR')
                } else {
                    if (result.stdout.includes('CONNECTED')) {
                        console.log('Windscribe connected and SSH is working');
                    }
                    return ssh;
                }

            });

    });
}

class SearchResult {
    title: string;
    url: string;
    price: string;
    squareMeter: string;
    roomNumber: string;
    location: string;
}

async function launchPuppeteer() {
    await testSSH();
    puppeteer.launch({
        headless: config.HEADLESS_MODE,
        args: ['--no-sandbox',
            proxyString
        ],

    })
        .then(async browser => {
            try {
                console.log('Running ..');
                const page = await browser.newPage();
                page.setDefaultTimeout(60000);
                let reconnect: number = Math.floor(Math.random() * Math.floor(6));
                await page.setUserAgent(userAgent.toString());


                do {
                    count++;
                    console.log(count + ' try');
                    for (let link of immoScoutLinks) {
                        await page.goto(link);
                        let datetime = getDatetime()
                        const selector = '.result-list-entry__data';
                        try {
                            await page.waitForSelector(selector);
                        } catch (err) {
                            console.log('Error occured');
                            console.log(err)
                            await page.setViewport({width: 800, height: 1300})
                            let pathString: string = './err/err_immoscout_' + datetime + '.png';
                            await page.screenshot({path: pathString});
                            bot.sendMessage(config.ERROR_CHAT_ID, 'IP was blacklisted');
                            bot.sendPhoto(config.ERROR_CHAT_ID, pathString);
                            console.log('Switching VPN Server');
                            await ssh.execCommand('windscribe connect de', {cwd: '/home/wss'})
                                .then(function (result) {
                                    console.log(result.stdout);
                                    if (result.stdout.includes('Connected to')) {
                                        console.log('Windscribe reconnected and SSH is working');
                                    }
                                });
                            console.log('Closing Browser');
                            await page.close();
                            await browser.close();
                            launchPuppeteer();
                            return;
                        }
                        let listings: SearchResult[] = await page.$$eval("div .result-list-entry__data",
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
                                    result.price = data.item(0).textContent.replace('Kaufpreis', ' Kaufpreis')
                                    result.squareMeter = data.item(1).textContent.replace('Wohnfläche', ' Wohnfläche')
                                    result.roomNumber = (data.item(2) as HTMLElement).getElementsByClassName("onlySmall")[0].textContent
                                    return result;
                                })
                        );

                        let newListing = false;
                        let newListingCount = 0;
                        listings.forEach(listing => {
                            DB.findOne(listing, function (err, doc) {
                                if (!doc) {
                                    newListing = true;
                                    console.log("Found new Listing")
                                    DB.insert(listing);
                                    newListingCount++;
                                    let listingMsg = listing.title + '\n' + listing.roomNumber + '\n' + listing.squareMeter + '\n' + listing.price + '\n' + listing.url + '\n' + listing.location + '\n';
                                    bot.sendMessage(config.CHAT_ID, listingMsg);
                                }
                            })

                        });
                        if (!newListing) {
                            console.log('No new listing');
                        } else {
                            console.log('Found ' + newListingCount + ' new Listings')
                        }

                        await page.waitForTimeout(2000)
                    }

                    let timeout: number = (Math.floor(Math.random() * 10) + config.POLLING_RATE) * 1000;
                    console.log('Wait for ' + timeout + ' ms');
                    await page.waitForTimeout(timeout)

                    if (count % REPEAT_BEFORE_VPN_RECONNECT[reconnect] == 0) {
                        console.log('Switching VPN Server');
                        await ssh.execCommand('windscribe connect de', {cwd: '/home/wss'})
                            .then(function (result) {
                                console.log(result.stdout);
                                if (result.stdout.includes('Connected to')) {
                                    console.log('Windscribe reconnected and SSH is working');
                                }
                            });
                        console.log('Closing Browser');
                        await page.close();
                        await browser.close();
                        launchPuppeteer();
                        return;
                    }

                } while (1)

            } catch (e) {
                console.log(e);
                bot.sendMessage(787255477, 'Error occured');
                console.log('Closing Browser');
                await browser.close();
                launchPuppeteer();
                return;
            } finally {
                await browser.close
            }
        })
}



