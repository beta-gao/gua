const puppeteer = require('puppeteer');
const fs = require('fs');

(async () => {
  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: null,
    args: ['--start-maximized']
  });

  const page = await browser.newPage();
  await page.goto('https://gmember.melon.com/login/login_form.htm?langCd=EN&redirectUrl=https://tkglobal.melon.com/main/index.htm?langCd=EN', { waitUntil: 'networkidle2' });

  console.log("🔑 请手动登录账号，然后回到控制台按一次回车");

  // 等你手动登录之后，在控制台按回车
  await new Promise(resolve => {
    process.stdin.once('data', () => resolve());
  });

  const cookies = await page.cookies();
  fs.writeFileSync('./melon_cookies.json', JSON.stringify(cookies, null, 2));

  console.log("✅ 登录成功，Cookie 已保存到 melon_cookies.json！");
  await browser.close();
})();
