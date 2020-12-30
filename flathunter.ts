import Telegrambot from "node-telegram-bot-api";
import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import Datastore from "nedb";
import UserAgent from 'user-agents';
import ProxyVerifier from 'proxy-verifier'
const {NodeSSH} = require('node-ssh')

const token = '695605161:AAH3xZLT4u97ONTqQU2yk7ELv-kBK_grby4'
const bot = new Telegrambot(token,{polling: true})
puppeteer.use(StealthPlugin())

const PROXY_IP = 'localhost';//windscribe for docker localhost for local
const PROXY_PORT = 1080;
const PROXY_PROTOCOL = 'socks5'


const proxy = {
    ipAddress: PROXY_IP,
    port: PROXY_PORT,
    protocol: PROXY_PROTOCOL
};

const proxyString = '--proxy-server='+proxy.protocol+'://'+proxy.ipAddress+':'+proxy.port;

const db = new Datastore({ filename: './immo.db', autoload: true });
const userAgent = new UserAgent()
const ssh = new NodeSSH();



let retries = 20;
testProxy(launchPuppeteer);

function testProxy(callback){
    console.log('Testing Proxy, ' + retries + ' retries left');
    if(retries == 0){
        throw "Could not connect to proxy";
    }
    retries = retries - 1;
    ProxyVerifier.testAll(proxy,{}, async function(error, result) {
        if (error) {
            // Some unusual error occurred.
        } else {
            console.log(result);
            if(result.tunnel.ok === true){
                console.log('Proxy good')
                callback();
            }else {
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
        + (currentdate.getMonth()+1)  + "."
        + currentdate.getDate() + "_"
        + currentdate.getHours() + "-"
        + currentdate.getMinutes() + "-"
        + currentdate.getSeconds();
    console.log('DateTime: '+datetime);
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
        host: 'localhost',
        username: 'flathunter',
        password: '36jqU7w8AWejGcGyQKvYXxyU1cNpIB9QCSstR2XIPKiU5txSTwWnkYMQ'
    }).then(function() {
        console.log('Connected to SSH')
    });
}
function launchPuppeteer(){
    testSSH();

    puppeteer.launch({
        headless: true,
        args:['--no-sandbox',
            proxyString
        ],

    })
        .then(async browser => {
            console.log('Running ..');
            const page = await browser.newPage();
            page.setDefaultTimeout(60000);
            let userAgentString = await browser.userAgent();
            console.log(userAgentString);
            await page.setUserAgent(userAgent.toString());
            await page.goto('https://api.ipify.org/?format=json');
            getIp(await page.content());
            await page.goto('https://www.immobilienscout24.de/Suche/radius/wohnung-kaufen?centerofsearchaddress=Stuttgart;;;;;&price=-120000.0&geocoordinates=48.77899;9.17686;50.0&sorting=2')
            do{
                count++;
                console.log(count + ' try');
                let datetime = getDatetime()
                const selector = '.result-list-entry__data > a';
                try{
                    await page.waitForSelector(selector);
                }catch (err){
                    console.log('Error occured');
                    await page.setViewport({ width: 800, height: 800 })
                    let pathString: string =  './err/err_immoscout_'+datetime+'.png';
                    await page.screenshot({path:pathString});
                    userAgentString = await userAgent().toString();
                    await page.setUserAgent(userAgentString);
                    console.log('New User Agent: ' + userAgentString);
                    bot.sendMessage(787255477,'Error occured');
                    bot.sendPhoto(787255477,pathString);
                    continue;
                }
                let links = await page.$$eval(selector, (anchors) => anchors.map((link) => (link as HTMLLinkElement).href));
                let newListing = false;
                links.forEach(href => {
                    db.findOne({link:href},function (err,doc){
                        if(!doc){
                            newListing = true;
                            db.insert({link:href})
                            console.log('Found new listing');
                            bot.sendMessage(787255477,'Found new listing: ' + href.toString());
                        }
                    });
                })
                if(!newListing){
                    console.log('No new listing found');
                }
                let timeout: number = (Math.floor(Math.random() * 10) + 10) * 1000;
                console.log('Wait for ' + timeout+' ms');
                await page.waitForTimeout(timeout)
                userAgentString = await userAgent().toString();
                await page.setUserAgent(userAgentString);
                await page.reload()

                console.log('page refreshed');
                if(count == 2){
                    console.log('Count is now at 2');
                }
            }while (1)
        })
}





