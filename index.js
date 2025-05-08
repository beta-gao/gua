const puppeteer = require('puppeteer');
const fs = require('fs');
const { createWorker } = require('tesseract.js');
const Jimp = require('jimp');
const readline = require('readline');

// 🔁 等待日期按钮出现并点击

async function waitForDateAndClickButton(page, targetDate = 'May 24', maxAttempts = 30, interval = 2000) {
    console.log(`🔁 开始轮询并点击日期 "${targetDate}"...`);
    let hasRefreshed = false;
  
    for (let i = 0; i < maxAttempts; i++) {
      try {
        const clicked = await page.evaluate((targetDate) => {
          const items = Array.from(document.querySelectorAll('li.item_date'));
          for (const el of items) {
            if (el.textContent.includes(targetDate)) {
              const btn = el.querySelector('button');
              if (btn) {
                btn.click();
                return true;
              }
            }
          }
          return false;
        }, targetDate);
  
        if (clicked) {
          console.log(`✅ 成功点击 "${targetDate}" 日期按钮`);
          return true;
        }
  
        console.log(`⏳ [${i + 1}/${maxAttempts}] 未找到目标日期，等待 ${interval / 1000}s...`);
        await new Promise(res => setTimeout(res, interval));
  
        // 只在中途刷新一次（作为 fallback）
        if (i === Math.floor(maxAttempts / 2) && !hasRefreshed) {
          hasRefreshed = true;
          console.log(`🔄 尝试 fallback 页面刷新`);
          await page.reload({ waitUntil: 'domcontentloaded' });
          await new Promise(r => setTimeout(r, 500));
        }
  
      } catch (e) {
        console.log(`⚠️ 第 ${i + 1} 次轮询出错: ${e.message}`);
        // 如果出错也只在没刷新过时刷新一次
        if (!hasRefreshed) {
          hasRefreshed = true;
          await page.reload({ waitUntil: 'domcontentloaded' });
          await new Promise(r => setTimeout(r, 500));
        }
      }
    }
  
    console.log("❌ 超出最大轮询次数，未点击成功");
    return false;
  }
  
  
async function waitForPopup(browser, urlPart, interval = 1000) {
  console.log(`🕵️ 正在监听 popup 页面（包含 "${urlPart}" 的窗口）...`);

  let attempt = 0;
  let start = Date.now();
  let popup = null;

  while (!popup) {
    attempt++;
    const target = await browser
      .waitForTarget(t => t.url().includes(urlPart), { timeout: interval })
      .catch(() => null);

    if (target) {
      popup = await target.page();
      const elapsed = Math.round((Date.now() - start) / 1000);
      console.log(`✅ popup 页面已打开！共等待 ${elapsed} 秒（共尝试 ${attempt} 次）`);
      break;
    }

    const elapsed = Math.round((Date.now() - start) / 1000);
    console.log(`⌛ 等待中：第 ${attempt} 次尝试，已等待 ${elapsed} 秒...`);
  }

  await popup.bringToFront();
  return popup;
}

/**
 * 给一个 Puppeteer Page 或 Popup 注册 dialog 处理器，
 * 一旦弹出 alert/confirm，就自动点击「确定」
 * @param {import('puppeteer').Page} page
 */
async function setupDialogHandler(page) {
  page.on('dialog', async dialog => {
    console.log(`⚠️ 弹窗消息: ${dialog.message()}`);
    await dialog.accept();      // 点击「确定」
  });
}


// 🧪 图像预处理（优化：放大图像提高识别准确率）
async function preprocessCaptcha(imagePath) {
  const image = await Jimp.read(imagePath);
  await image
    .greyscale()
    .contrast(1)
    .resize(image.bitmap.width * 2, image.bitmap.height * 2) // ✅ 放大提高识别率
    .writeAsync(imagePath);
}

// 🔍 自动识别验证码并填写（包含最多 3 次 retry）
async function handleCaptcha(popup, maxRetries = 3) {
  const { createWorker } = require('tesseract.js');

  // ✅ 新版本：直接在 createWorker() 中传语言与路径
  const worker = await createWorker('eng', 1, {
    langPath: './tessdata'  // 如果你用了本地 eng.traineddata
  });

  await worker.setParameters({
    tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
  });

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    console.log(`🔁 第 ${attempt} 次识别验证码...`);

    try {
      await popup.waitForSelector('#captchaImg', { timeout: 10000 });
      const captchaImg = await popup.$('#captchaImg');
      if (!captchaImg) {
        console.log("❌ 没找到验证码图片 #captchaImg");
        await worker.terminate();
        return false;
      }

      const captchaPath = `captcha_${attempt}.png`;
      await captchaImg.screenshot({ path: captchaPath });

      await preprocessCaptcha(captchaPath);
      console.log("📸 验证码已截图并预处理：", captchaPath);

      const result = await worker.recognize(captchaPath);
      // 识别结果原始文本
const rawText = result.data.text;

// 只保留 A–Z，组成数组
const letters = (rawText.match(/[A-Z]/g) || []);

// 取前 6 个字母，再拼回字符串
const code = letters.slice(0, 6).join('');

console.log("✅ 过滤后取前 6 位：", code);

// 只有长度正好等于 6 才继续
if (code.length === 6) {
  await popup.waitForSelector('#label-for-captcha', { timeout: 5000 });
  await popup.type('#label-for-captcha', code, { delay: 100 });
  await popup.click('#btnComplete');
  console.log("🚀 成功填入 6 位验证码并点击提交！");
  await worker.terminate();
  return true;
} else {
  console.log(`⚠️ 识别到 ${code.length} 位，非 6 位，刷新重试…`);
  const reloadBtn = await popup.$('#btnReload');
  if (reloadBtn) await reloadBtn.click();
  await new Promise(r => setTimeout(r, 1000));
}


      console.log("✅ 识别结果：", code);

      if (code.length >= 4 && code.length <= 6) {
        await popup.waitForSelector('#label-for-captcha', { timeout: 5000 });
        await popup.type('#label-for-captcha', code, { delay: 100 });
        await popup.click('#btnComplete');
        console.log("🚀 成功填入验证码并点击提交！");
        await worker.terminate();
        return true;
      } else {
        console.log("⚠️ 识别结果异常，尝试刷新验证码...");
        const reloadBtn = await popup.$('#btnReload');
        if (reloadBtn) await reloadBtn.click();
        await new Promise(resolve => setTimeout(resolve, 1000));
      }

    } catch (e) {
      console.log(`❌ 处理验证码失败: ${e.message}`);
    }
  }

  await worker.terminate();
  console.log("❌ 验证码识别失败超过最大次数");
  return false;
}

/**
 * 找到 oneStopFrame iframe
 * @param {Page|Popup} popup - Puppeteer 的 Page 或者 Popup 对象
 * @returns {Frame|null}
 */
function getOneStopFrame(popup) {
  return popup.frames().find(f => f.name() === 'oneStopFrame') || null;
}

/**
 * 展开所有折叠的分组（tr[id^="gd"]）
 * @param {Page|Popup} popup
 * @param {Object} options
 * @param {number} [options.delayPerHeader=150] 每个 header 点击的间隔（毫秒）
 * @param {number} [options.baseWait=800] 点击完之后的基础等待时间（毫秒）
 */
async function expandZones(popup, { delayPerHeader = 150, baseWait = 800 } = {}) {
  const frame = getOneStopFrame(popup);
  if (!frame) {
    console.error('❌ 无法找到 iframe "oneStopFrame"');
    return false;
  }

  // 在页面里只点击还没展开的分组头（假设展开后会有 .expanded class）
  await frame.evaluate((delay, expandedClass) => {
    const headers = Array.from(document.querySelectorAll('tr[id^="gd"]'));
    headers.forEach((tr, i) => {
      const isExpanded = tr.classList.contains(expandedClass);
      if (!isExpanded) {
        setTimeout(() => tr.click(), i * delay);
      }
    });
  }, delayPerHeader, 'expanded');

  // 计算实际点击了多少个 header，用于等待足够的时间
  const toExpandCount = await frame.$$eval('tr[id^="gd"]', (els, expandedClass) =>
    els.filter(tr => !tr.classList.contains(expandedClass)).length
  , 'expanded');

  // 等待所有点击执行完毕
  await new Promise(r => setTimeout(r, baseWait + toExpandCount * delayPerHeader));
  console.log(`🔽 已尝试展开 ${toExpandCount} 个分组`);
  return true;
}

/**
 * 在已展开的列表里点击包含关键字的 li
 * @param {Page|Popup} popup
 * @param {string} keyword - 要匹配的文本关键字
 * @returns {boolean} 是否成功点击到对应项
 */
async function clickZoneByKeyword(popup, keyword = seatKeyword) {
  const frame = getOneStopFrame(popup);
  if (!frame) {
    console.error('❌ 无法找到 iframe "oneStopFrame"');
    return false;
  }

  const clicked = await frame.evaluate((kw) => {
    const items = Array.from(document.querySelectorAll('.list_area li'));
    const target = items.find(li => li.textContent.includes(kw));
    if (target) {
      target.click();
      return true;
    }
    return false;
  }, keyword);

  if (clicked) {
    console.log(`✅ 成功点击包含 "${keyword}" 的区域`);
  } else {
    console.warn(`⚠️ 没找到包含 "${keyword}" 的区域`);
  }
  return clicked;
}


async function waitForUserToContinue() {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question('🔒 输入验证码后按回车继续：', () => {
      rl.close();
      resolve();
    });
  });
}

function getRandomItem(arr) {
  const idx = Math.floor(Math.random() * (arr.length+1));
  return arr[idx];
}

/**
 * 在 oneStopFrame 里自动点座位，选中后立刻点击 “Seat Selection Completed”
 * @param {import('puppeteer').Page} page
 * @param {number} delay  — 两次尝试之间的间隔 (ms)
 * @returns {Promise<boolean>} — 成功返回 true，否则 false
 */
async function autoClickUntilSeatSelectedAndClickNext(page, delay = 100) {
  console.log('🧨 开始在 oneStopFrame 里尝试点击各个 rect');

  const frame = page.frames().find(f => f.name() === 'oneStopFrame');
  if (!frame) {
    console.error('❌ 找不到 oneStopFrame');
    return false;
  }

  const rects = await frame.$$('rect');
  for (let i = 0; i < rects.length; i++) {
    const rect = rects[i];

    // 跳过已经选中的
    const already = await frame.evaluate(el =>
      el.getAttribute('stroke-width') === '2' &&
      el.getAttribute('fill-opacity') === '0.5'
    , rect);
    if (already) {
      console.log(`⏭️ 第 ${i+1} 个已选过，跳过`);
      continue;
    }

    try {
      await rect.click();
      console.log(`🖱️ 点击第 ${i+1} 个 rect`);

      // Node.js 延时，不依赖 Puppeteer API
      await new Promise(res => setTimeout(res, delay));

      // 再检查是否选中
      const nowSelected = await frame.evaluate(el =>
        el.getAttribute('stroke-width') === '2' &&
        el.getAttribute('fill-opacity') === '0.5'
      , rect);
      if (!nowSelected) {
        console.log(`❌ 第 ${i+1} 个点击后仍未选中`);
        continue;
      }

      console.log(`✅ 成功选中第 ${i+1} 个座位，等待按钮激活`);

      // 等待 a#nextTicketSelection 带上“btnOneB”类
      await frame.waitForSelector('#nextTicketSelection.btnOneB', { timeout: 5000 });

      // 直接点击它
      await frame.click('#nextTicketSelection');
      console.log('🎯 已点击 Seat Selection Completed');

      return true;
    } catch (err) {
      console.warn(`⚠️ 第 ${i+1} 个步骤出错：${err.message}`);
    }
  }

  console.error('❌ 尝试完所有 rect，均未成功触发下一步');
  return false;
}




/**
 * 在进入付款页面后，切换到 oneStopFrame 并点击 Next (#nextPayment)
 * @param {import('puppeteer').Page} page
 */
async function clickNextOnPayment(page) {
  // 1. 找到 frame
  const frame = page.frames().find(f => f.name() === 'oneStopFrame');
  if (!frame) {
    throw new Error('找不到 oneStopFrame');
  }

  // 2. 等待 #nextPayment 出现
  await frame.waitForSelector('#nextPayment', { visible: true, timeout: 5000 });
  console.log('✅ 找到 Next 按钮 (#nextPayment)');

  // 3. 直接用 Puppeteer API 点击
  await frame.click('#nextPayment');
  console.log('➡️ 已点击 Next (#nextPayment)');
}

async function waitForNextButtonAndClick(frame, maxAttempts = 20, interval = 500) {
  console.log("🔄 开始轮询 #nextPayment...");
  for (let i = 1; i <= maxAttempts; i++) {
    const success = await frame.evaluate(() => {
      const btn = document.querySelector('#nextPayment');
      if (btn) {
        btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        return true;
      }
      return false;
    });

    if (success) {
      console.log("➡️ 已自动点击 #nextPayment");
      return true;
    } else {
      console.log(`⏳ 第 ${i} 次等待 #nextPayment...`);
      await new Promise(r => setTimeout(r, interval));
    }
  }

  console.log("❌ 超时未能点击 #nextPayment");
  return false;
}



async function startMelonBot({ url, prodId, targetDate, langCd = 'EN', seatKeywords}) {
  // 启动浏览器（puppeteer-core 用户需指定 executablePath）
  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: null,
    args: ['--start-maximized'],
    // executablePath: '/path/to/Chrome'
  });

  const page = await browser.newPage();
  // 加载登录态 Cookie
  const cookies = JSON.parse(fs.readFileSync('./melon_cookies.json', 'utf8'));
  await page.setCookie(...cookies);

  // —— 单次 goto + retry 机制 ——
  try {
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
  } catch (err) {
    console.warn('第一次 page.goto 失败，重试：', err.message);
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
  }
  console.log('🍈 页面加载完成');

  // —— 延后开启资源拦截 ——
  await page.setRequestInterception(true);
  page.on('request', req =>
    ['image', 'stylesheet', 'font'].includes(req.resourceType())
      ? req.abort()
      : req.continue()
  );

  // —— 选日期 ——
  const dateClicked = await waitForDateAndClickButton(page, targetDate);
  if (!dateClicked) {
    console.log('❌ 日期点击失败，结束流程');
    await browser.close();
    return;
  }

  await page.waitForSelector('li.item_time', { timeout: 5000 });
  await page.evaluate(() => {
    document.querySelector('li.item_time')?.classList.add('on');
  });
  await new Promise(res => setTimeout(res, 300));

  // —— 调用 reservationInit ——
  await page.waitForFunction(() => {
    return typeof ProductServiceApp !== 'undefined' &&
           ProductServiceApp.reservationModule &&
           typeof ProductServiceApp.reservationModule().reservationInit === 'function';
  }, { timeout: 5000 });

  await page.evaluate(({ prodId, langCd }) => {
    ProductServiceApp.reservationModule().reservationInit({
      prodId,
      prodTypeCode: 'PT0001',
      langCd
    });
  }, { prodId, langCd });
  console.log('🎟️ 已调用 reservationInit，进入购票流程！');

  // —— 等待选座弹窗 ——
  const popup = await waitForPopup(browser, 'onestop.htm', 1000);
  await popup.screenshot({ path: 'popup_debug.png' });
  fs.writeFileSync('popup_dump.html', await popup.content(), 'utf8');
  
  setupDialogHandler(popup);

  // —— 验证码 & 区域展开 ——
  const passed = await handleCaptcha(popup);
  if (!passed) {
    console.log('❌ 验证码处理失败，结束流程');
    await browser.close();
    return;
  }

  // 1. 先展开所有分区
  const expanded = await expandZones(popup);
  if (!expanded) {
    console.log('❌ 分区展开失败，结束流程');
    await browser.close();
    return;
  }
  const seatKeyword = seatKeywords[0];
  // 2. 再根据关键字点击对应区块
  const zoneClicked = await clickZoneByKeyword(popup, seatKeyword);
  if (!zoneClicked) {
    console.log('❌ 指定区域点击失败，结束流程');
    await browser.close();
    return;
  }  

  // 无限重试选座
  while (true) {
    // 尝试自动选座
    const seatSuccess = await autoClickUntilSeatSelectedAndClickNext(popup);
    if (seatSuccess) {
      console.log('✅ 自动选座成功，跳出循环');
      break;
    }

    // 如果失败，先重选区
    console.warn('⚠️ 自动选座失败，重新选区并重试');

    const zoneClicked = await clickZoneByKeyword(popup, getRandomItem(seatKeywords));
    if (!zoneClicked) {
      console.error('❌ 指定区域点击失败，退出流程');
      await browser.close();
      return;
    }

    // （可选）给一点小延迟，防止循环太快
    await new Promise(r => setTimeout(r, 100));
  }


    // —— STEP2 完成 … ——  
  console.log("✅ STEP2 完成，准备进入 STEP3 付款页面");

  // 给页面一点时间，让 iframe 重新 load
  await new Promise(res => setTimeout(res, 1000));

  // 重新拿到 oneStopFrame（内容已经切换到 STEP3）
  const payFrame = popup.frames().find(f => f.name() === 'oneStopFrame');
  if (!payFrame) {
    console.error("❌ 找不到 oneStopFrame 来点击付款 Next");
    await browser.close();
    return;
  }

  try {
    // 在 frame 内等待 #nextPayment 出现（扩大超时时间以防慢加载）
    await payFrame.waitForSelector('#nextPayment', { visible: true, timeout: 15000 });
    console.log("✅ 找到 #nextPayment 按钮");

    // 直接在 frame 里点击
    await payFrame.click('#nextPayment');
    console.log("➡️ 已点击 Next (#nextPayment)");
  } catch (err) {
    console.error("❌ STEP3 点击 Next 失败：", err);
    await browser.close();
    return;
  }


  // —— 后续：填写支付表单 & 提交订单 ——
}


// ✅ 启动
startMelonBot({
  url: 'https://tkglobal.melon.com/performance/index.htm?langCd=EN&prodId=211217',
  prodId: '211217',
  targetDate: 'May 24',
  langCd: 'EN',
  seatKeywords: ['207','407','311','403']
});
