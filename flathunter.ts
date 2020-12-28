import Telegrambot from "node-telegram-bot-api";
import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import Datastore from "nedb";
import UserAgent from 'user-agents';

const token = '695605161:AAH3xZLT4u97ONTqQU2yk7ELv-kBK_grby4'
const bot = new Telegrambot(token,{polling: true})
puppeteer.use(StealthPlugin())


const db = new Datastore({ filename: './immo.db', autoload: true });
const userAgent = new UserAgent()

puppeteer.launch({
    headless: false,
    args:['--no-sandbox',
        '--proxy-server=socks5://192.168.178.41:62085'],

})
  .then(async browser => {
    console.log('Running tests..')
    const page = await browser.newPage()
    page.setDefaultTimeout(60000);
    let userAgentString = await browser.userAgent();
    console.log(userAgentString);
    await page.setUserAgent(userAgent.toString());
    await page.goto('https://www.immobilienscout24.de/Suche/radius/wohnung-kaufen?centerofsearchaddress=Stuttgart;;;;;&price=-120000.0&geocoordinates=48.77899;9.17686;50.0&sorting=2')
    do{
        var currentdate = new Date();
        var datetime = currentdate.getFullYear() + "."
            + (currentdate.getMonth()+1)  + "."
            + currentdate.getDate() + "_"
            + currentdate.getHours() + "-"
            + currentdate.getMinutes() + "-"
            + currentdate.getSeconds();
        console.log('DateTime: '+datetime);
        const selector = '.result-list-entry__data > a';
        await page.setViewport({ width: 800, height: 800 })
        await page.screenshot({path: './img/immoscout_'+datetime+'.png'});

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
        let timeout: number = (Math.floor(Math.random() * 10) + 90) * 1000;
        console.log('Wait for ' + timeout+' ms');
        await page.waitForTimeout(timeout)
        userAgentString = await userAgent().toString();
        await page.setUserAgent(userAgentString);
        await page.reload()

        console.log('page refreshed');
    }while (1)
})