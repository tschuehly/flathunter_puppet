import Telegrambot from "node-telegram-bot-api";
import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import Datastore from "nedb";
import UserAgent from 'user-agents';
import ProxyVerifier from 'proxy-verifier'
import {launch} from "puppeteer";

const {NodeSSH} = require('node-ssh')

const token = '695605161:AAH3xZLT4u97ONTqQU2yk7ELv-kBK_grby4'
const bot = new Telegrambot(token,{polling: true})
puppeteer.use(StealthPlugin())

const PROXY_IP = 'windscribe'; //windscribe for docker localhosyt for local
const PROXY_PORT = 1080;
const PROXY_PROTOCOL = 'socks5'
const HEADLESS_MODE = true;
const POLLING_RATE = 50 // in seconds
const REPEAT_BEFORE_VPN_RECONNECT = [20,15,23,26,12,18,19];
const proxy = {
    ipAddress: PROXY_IP,
    port: PROXY_PORT,
    protocol: PROXY_PROTOCOL
};

const proxyString = '--proxy-server=' + proxy.protocol + '://' + proxy.ipAddress + ':' + proxy.port;

const db = new Datastore({filename: './immo.db', autoload: true});
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
    ProxyVerifier.testAll(proxy, {}, async function (error, result) {
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

function getIp(body) {
    let splittedBody = body.split('{')
    splittedBody = splittedBody[1].split('}')
    console.log(splittedBody[0]);
}

let count = 0;

function testSSH() {
    ssh.connect({
        host: PROXY_IP,
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
                }

            });
        return ssh;
    });
}

async function launchPuppeteer() {
    await testSSH();
    puppeteer.launch({
        headless: HEADLESS_MODE,
        args: ['--no-sandbox',
            proxyString
        ],

    })
        .then(async browser => {
            try {
                console.log('Running ..');
                const page = await browser.newPage();
                page.setDefaultTimeout(60000);
                let userAgentString = await browser.userAgent();
                console.log(userAgentString);
                await page.setUserAgent(userAgent.toString());
                await page.goto('https://api.ipify.org/?format=json');
                getIp(await page.content());
                await page.goto('https://www.immobilienscout24.de/Suche/radius/wohnung-kaufen?centerofsearchaddress=Stuttgart;;;;;&price=-120000.0&geocoordinates=48.77899;9.17686;50.0&sorting=2')
                do {
                    count++;
                    console.log(count + ' try');
                    let datetime = getDatetime()
                    const selector = '.result-list-entry__data > a';
                    try {
                        await page.waitForSelector(selector);
                    } catch (err) {
                        console.log('Error occured');
                        console.log(err)
                        await page.setViewport({width: 800, height: 1300})
                        let pathString: string = './err/err_immoscout_' + datetime + '.png';
                        await page.screenshot({path: pathString});
                        userAgentString = await userAgent().toString();
                        await page.setUserAgent(userAgentString);
                        console.log('New User Agent: ' + userAgentString);
                        bot.sendMessage(787255477, 'Error occured');
                        bot.sendPhoto(787255477, pathString);
                        continue;
                    }
                    let links = await page.$$eval(selector, (anchors) => anchors.map((link) => (link as HTMLLinkElement).href));
                    let newListing = false;
                    links.forEach(href => {
                        db.findOne({link: href}, function (err, doc) {
                            if (!doc) {
                                newListing = true;
                                db.insert({link: href})
                                console.log('Found new listing');
                                bot.sendMessage(787255477, 'Found new listing: ' + href.toString());
                            }
                        });
                    })
                    if (!newListing) {
                        console.log('No new listing found');
                    }


                    let timeout: number = (Math.floor(Math.random() * 10) + POLLING_RATE) * 1000;
                    console.log('Wait for ' + timeout + ' ms');
                    await page.waitForTimeout(timeout)
                    userAgentString = await userAgent().toString();
                    await page.setUserAgent(userAgentString);
                    let reconnect: number = Math.floor(Math.random() * Math.floor(7));
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
                    } else {
                        await page.reload()
                        console.log('page refreshed');
                    }

                } while (1)

            } catch (e) {
                console.log(e);
            } finally {
                await browser.close
            }
        })
}

async function switchVPNServer() {

}



