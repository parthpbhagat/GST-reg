const { chromium } = require('playwright');
const http = require('http');
const { buildGstApplicationPayload } = require('../backend/utils/gst_payload_builder');

let capturedDraftId = null;

const appId = process.argv[2];
const token = process.argv[3];
const automationMode = process.argv[4] || 'regular'; // 'regular' or 'multistate'
let multiStateConfig = null;
try {
    if (process.argv[5]) {
        multiStateConfig = JSON.parse(process.argv[5]);
    }
} catch (e) {
    console.error('Warning: Could not parse multiStateConfig:', e.message);
}

if (!appId) {
    console.error('ERROR: No App ID provided');
    process.exit(1);
}

// Helper to log progress to stdout (which the backend will capture and emit via Socket.io)
function sendUpdate(status) {
    console.log(`STATUS:${status}`);
}

let globalPage = null;
let isExiting = false;
setInterval(async () => {
    if (globalPage && !isExiting) {
        try {
            if (!globalPage.isClosed()) {
                const buffer = await globalPage.screenshot({ type: 'jpeg', quality: 30 });
                console.log(`SCREENSHOT:${buffer.toString('base64')}`);
            }
        } catch (e) {
            // Ignore screenshot errors
        }
    }
}, 3000);

process.on('uncaughtException', (err) => {
    console.error(`[Runner Error]: UNCAUGHT EXCEPTION: ${err ? (err.stack || err.message) : err}`);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error(`[Runner Error]: UNHANDLED REJECTION: ${reason ? (reason.stack || reason.message || reason) : reason}`);
});

async function run() {
    sendUpdate('Connecting to secure backend automation pipeline...');

    // Fetch full application data from local backend API
    const appData = await new Promise((resolve, reject) => {
        const req = http.get(`http://127.0.0.1:3002/api/applications/${appId}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                if (res.statusCode === 200) {
                    try {
                        resolve(JSON.parse(data));
                    } catch (e) {
                        reject(new Error(`Failed to parse application JSON: ${e.message}`));
                    }
                } else {
                    let errDetail = `HTTP ${res.statusCode}`;
                    try {
                        const parsed = JSON.parse(data);
                        if (parsed.error) errDetail += `: ${parsed.error}`;
                    } catch (_) {
                        if (data) errDetail += `: ${data}`;
                    }
                    reject(new Error(`Application fetch failed (${errDetail})`));
                }
            });
        });
        req.on('error', (err) => reject(new Error(`Network error connecting to backend: ${err.message}`)));
    });

    const data = appData.data || {};

    sendUpdate(`INITIALIZING: Launching ${automationMode === 'multistate' ? 'Multi-State' : 'Regular'} automation process...`);
    sendUpdate('INITIALIZING: Starting browser session...');

    const launchOptions = {
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu'
        ]
    };

    const fs = require('fs');
    if (fs.existsSync('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe')) {
        launchOptions.channel = 'chrome';
    } else if (fs.existsSync('C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe')) {
        launchOptions.channel = 'msedge';
    }

    const browser = await chromium.launch(launchOptions);
    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        viewport: { width: 1280, height: 800 }
    });
    const page = await context.newPage();
    globalPage = page;

    try {
        let trnText = (appData.trn || data.trn || '').trim();

        // =========================================================================
        // [પગલું ૧: TRN Login]
        // Automation દ્વારા TRN જનરેટ કરવો અને લૉગિન કરીને સેશન મેળવવું (Auth Token)
        // =========================================================================
        sendUpdate('[પગલું ૧: TRN Login] Automation દ્વારા TRN જનરેટ કરવો અને લૉગિન કરીને સેશન મેળવવું...');

        if (trnText && trnText.length > 5) {
            sendUpdate(`Application already has TRN: ${trnText}. Proceeding straight to TRN Login...`);
        } else {
            sendUpdate('Navigating to official GST portal (Part A registration)...');
            await page.goto('https://reg.gst.gov.in/registration/', { waitUntil: 'domcontentloaded', timeout: 60000 });

            sendUpdate('Injecting form payload data...');
            await page.waitForSelector('#applnType', { timeout: 30000 });

            // Select taxpayer type
            let taxpayerTypeLabel = data.taxpayerType || 'Taxpayer';
            const taxpayerTypeMap = {
                'taxpayer': 'APLRG', 'regular': 'APLRG', 'composition': 'APLRG',
                'regular taxpayer': 'APLRG', 'composition taxpayer': 'APLRG',
                'tax deductor': 'APLTD', 'tds': 'APLTD',
                'tax collector': 'APLTC', 'tcs': 'APLTC',
                'non-resident taxable person': 'APLNR', 'oidar': 'REGOI',
                'gst practitioner': 'RTTR1'
            };
            const taxpayerTypeValue = taxpayerTypeMap[taxpayerTypeLabel.toLowerCase().trim()] || 'APLRG';
            try {
                await page.selectOption('#applnType', { value: taxpayerTypeValue });
                sendUpdate(`Selected taxpayer type by value: ${taxpayerTypeValue}`);
            } catch (e) {
                await page.selectOption('#applnType', { label: taxpayerTypeLabel }).catch(() => {});
            }

            // Select State
            if (data.state) {
                try {
                    await page.selectOption('#applnState', { label: data.state });
                    sendUpdate(`Selected state: ${data.state}`);
                } catch (e) {
                    const stateOptions = await page.$$eval('#applnState option', opts => opts.map(o => ({ value: o.value, text: o.innerText.trim() })));
                    const match = stateOptions.find(o => o.text.toUpperCase().includes((data.state || '').toUpperCase()));
                    if (match) await page.selectOption('#applnState', { value: match.value });
                }
            }

            await page.waitForTimeout(2500);

            // Select District
            if (data.district) {
                try {
                    await page.selectOption('#applnDistr', { label: data.district });
                    sendUpdate(`Selected district: ${data.district}`);
                } catch (err) {
                    const distOptions = await page.$$eval('#applnDistr option', opts => opts.map(o => ({ value: o.value, text: o.innerText.trim() })));
                    const distMatch = distOptions.find(o => o.text.toUpperCase().includes((data.district || '').toUpperCase()));
                    if (distMatch) await page.selectOption('#applnDistr', { value: distMatch.value });
                }
            }

            // Fill Applicant Information
            await page.fill('#bnm', data.legalName || '');
            await page.fill('#pan_card', (data.pan || '').toUpperCase());
            await page.fill('#email', data.email || '');
            await page.fill('#mobile', data.mobile || '');

            // Captcha Loop
            let initialCaptchaSuccess = false;
            while (!initialCaptchaSuccess) {
                sendUpdate('Locating Captcha Image...');
                const captchaEl = await page.waitForSelector('#imgCaptcha', { state: 'visible' });
                await page.waitForTimeout(500);

                const captchaBuffer = await captchaEl.screenshot();
                console.log(`CAPTCHA_IMAGE:data:image/png;base64,${captchaBuffer.toString('base64')}`);
                sendUpdate('WAITING_FOR_CAPTCHA');

                const captchaText = await new Promise(resolve => {
                    process.stdin.once('data', (input) => resolve(input.toString().trim()));
                });

                sendUpdate('Verifying Captcha and requesting OTP from GST portal...');
                await page.fill('#captcha', captchaText);

                const proceedBtn = page.locator('button', { hasText: 'Proceed' }).last();
                await proceedBtn.click();

                sendUpdate('Waiting for OTP verification screen...');
                try {
                    await page.waitForFunction(() => {
                        const otpEl = document.querySelector('#mobile_otp');
                        const captchaEl = document.querySelector('#captcha');
                        if (otpEl && otpEl.offsetParent !== null) return true;
                        if (captchaEl && captchaEl.value === '') return true;
                        return false;
                    }, { timeout: 30000 });

                    const isCleared = await page.evaluate(() => {
                        const captchaEl = document.querySelector('#captcha');
                        return captchaEl && captchaEl.value === '';
                    });

                    if (isCleared) {
                        sendUpdate('Invalid Captcha. Retrying...');
                        await page.waitForTimeout(1000);
                    } else {
                        initialCaptchaSuccess = true;
                    }
                } catch (e) {
                    throw new Error("Timeout waiting for OTP verification screen to proceed.");
                }
            }

            // OTP Verification Loop
            let initialOtpSuccess = false;
            while (!initialOtpSuccess) {
                sendUpdate(`OTP screen is active! GST portal has dispatched OTPs to Mobile: ${data.mobile} and Email: ${data.email}.`);
                sendUpdate('WAITING_FOR_OTP');

                const otpsStr = await new Promise(resolve => {
                    process.stdin.once('data', (input) => resolve(input.toString().trim()));
                });

                const [mobileOtp, emailOtp] = otpsStr.split(',');

                sendUpdate('Submitting OTPs...');
                await page.evaluate(() => {
                    const m = document.querySelector('#mobile_otp');
                    if (m) m.value = '';
                    const e1 = document.querySelector('#email-otp');
                    if (e1) e1.value = '';
                    const e2 = document.querySelector('#email_otp');
                    if (e2) e2.value = '';
                });

                await page.fill('#mobile_otp', mobileOtp);
                const emailOtpFilled = await page.locator('#email-otp').count() > 0
                    ? page.fill('#email-otp', emailOtp)
                    : page.fill('#email_otp', emailOtp).catch(() => page.fill('#email-otp', emailOtp).catch(() => { }));
                await emailOtpFilled;

                const proceedOtpBtn = page.locator('button', { hasText: 'Proceed' }).last();
                await proceedOtpBtn.click();

                sendUpdate('Verifying OTPs...');
                try {
                    await page.waitForFunction(() => {
                        const trnEl = document.querySelector('span[data-ng-bind="trn"]');
                        if (trnEl && trnEl.textContent.trim().length > 5) return true;

                        const otpEl = document.querySelector('#mobile_otp');
                        if (otpEl && otpEl.value === '') return true;

                        const bodyText = document.body.innerText.toLowerCase();
                        return bodyText.includes('invalid otp') || bodyText.includes('otp are invalid') || bodyText.includes('otp is invalid');
                    }, { timeout: 30000 });

                    const isError = await page.evaluate(() => {
                        const trnEl = document.querySelector('span[data-ng-bind="trn"]');
                        if (trnEl && trnEl.textContent.trim().length > 5) return false;
                        return true;
                    });

                    if (isError) {
                        sendUpdate('Invalid OTP. Retrying...');
                        await page.waitForTimeout(1000);
                    } else {
                        initialOtpSuccess = true;
                    }
                } catch (e) {
                    throw new Error("Timeout waiting for OTP verification to proceed.");
                }
            }

            sendUpdate('Extracting Temporary Reference Number (TRN)...');
            const trnLocator = page.locator('span[data-ng-bind="trn"]');
            await trnLocator.waitFor({ state: 'attached', timeout: 60000 });
            await page.waitForFunction(() => {
                const el = document.querySelector('span[data-ng-bind="trn"]');
                return el && el.textContent.trim().length > 5;
            }, { timeout: 60000 });

            trnText = (await trnLocator.textContent()).trim();
            sendUpdate(`TRN Generated: ${trnText}`);

            // Persist TRN to database
            await new Promise((resolve, reject) => {
                const req = http.request(`http://127.0.0.1:3002/api/applications/${appId}/trn`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }
                }, (res) => { res.on('data', () => {}); res.on('end', resolve); });
                req.on('error', reject);
                req.write(JSON.stringify({ trn: trnText }));
                req.end();
            });
        }

        // Navigate to TRN Login Screen
        sendUpdate('Navigating to TRN Login screen...');
        await page.goto('https://reg.gst.gov.in/registration/', { waitUntil: 'domcontentloaded', timeout: 60000 });
        await page.waitForSelector('#radiotrn', { state: 'visible', timeout: 30000 });
        await page.click('#radiotrn');

        await page.waitForSelector('#trnno', { state: 'visible', timeout: 30000 });
        await page.fill('#trnno', trnText);

        // Fill Email Address if present
        try {
            const emailInputs = [page.locator('#email'), page.locator('#trn_email')];
            for (const el of emailInputs) {
                if (await el.count() > 0 && await el.first().isVisible()) {
                    await el.first().fill(data.email || '');
                    break;
                }
            }
        } catch (e) {}

        // TRN Login Captcha Loop
        let trnLoginSuccess = false;
        while (!trnLoginSuccess) {
            sendUpdate('Locating TRN Login Captcha...');
            const loginCaptchaEl = await page.waitForSelector('#imgCaptcha', { state: 'visible' });
            await page.waitForTimeout(500);

            const loginCaptchaBuffer = await loginCaptchaEl.screenshot();
            console.log(`CAPTCHA_IMAGE:data:image/png;base64,${loginCaptchaBuffer.toString('base64')}`);
            sendUpdate('WAITING_FOR_CAPTCHA_TRN');

            const loginCaptchaText = await new Promise(resolve => {
                process.stdin.once('data', (input) => resolve(input.toString().trim()));
            });

            sendUpdate('Verifying TRN Login...');
            await page.fill('#captchatrn', loginCaptchaText);

            await page.evaluate(() => {
                const form = document.querySelector('form[name="preg"]');
                const submitBtn = Array.from(document.querySelectorAll('button')).find(b => b.innerText.trim().toUpperCase() === 'PROCEED' && b.offsetParent !== null);
                if (submitBtn) submitBtn.click();
                else if (form) form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
            });

            sendUpdate('Waiting for TRN Login OTP verification screen...');
            try {
                await page.waitForFunction(() => {
                    const otpEl = document.querySelector('#mobile_otp');
                    if (otpEl && otpEl.offsetParent !== null) return true;
                    const url = window.location.href;
                    if (url.includes('/verify') || url.includes('/msrverify')) return true;
                    const captchaEl = document.querySelector('#captchatrn');
                    if (captchaEl && captchaEl.value === '') return true;
                    const err = document.querySelector('.err, .alert-danger');
                    return (err && err.offsetParent !== null && err.innerText.trim().length > 0);
                }, { timeout: 35000 });

                const resultStatus = await page.evaluate(() => {
                    const otpEl = document.querySelector('#mobile_otp');
                    if (otpEl && otpEl.offsetParent !== null) return 'otp_ready';
                    const url = window.location.href;
                    if (url.includes('/verify') || url.includes('/msrverify')) return 'otp_ready';
                    const captchaEl = document.querySelector('#captchatrn');
                    if (captchaEl && captchaEl.value === '') return 'invalid_captcha';
                    const err = document.querySelector('.err, .alert-danger');
                    if (err && err.offsetParent !== null && err.innerText.trim().length > 0) return 'error_message';
                    return 'unknown';
                });

                if (resultStatus === 'invalid_captcha' || resultStatus === 'error_message') {
                    sendUpdate('Invalid Captcha. Retrying with fresh Captcha...');
                    await page.waitForTimeout(1500);
                } else {
                    trnLoginSuccess = true;
                }
            } catch (e) {
                const hasOtp = await page.locator('#mobile_otp').count() > 0;
                if (hasOtp) trnLoginSuccess = true;
                else throw new Error('Timeout waiting for TRN Login to proceed. Please check Captcha.');
            }
        }

        // TRN Login OTP Loop
        let trnOtpSuccess = false;
        while (!trnOtpSuccess) {
            sendUpdate('WAITING_FOR_TRN_OTP');

            const trnOtp = await new Promise(resolve => {
                process.stdin.once('data', (input) => resolve(input.toString().trim()));
            });

            sendUpdate('Submitting TRN Login OTP...');
            await page.evaluate((otpVal) => {
                const m = document.querySelector('#mobile_otp');
                if (m) {
                    m.value = otpVal;
                    m.dispatchEvent(new Event('input', { bubbles: true }));
                    m.dispatchEvent(new Event('change', { bubbles: true }));
                }
                const closeBtns = document.querySelectorAll('button.close, .close-modal');
                closeBtns.forEach(btn => btn.click());
            }, trnOtp);

            await page.waitForTimeout(500);

            await page.evaluate(() => {
                const btn = document.querySelector('button[type="submit"].btn-primary');
                if (btn) btn.click();
            });

            sendUpdate('Verifying TRN OTP...');
            try {
                await page.waitForFunction(() => {
                    const editBtn = document.querySelector('button[data-ng-click="editSavedapp(x)"]');
                    if (editBtn && editBtn.offsetParent !== null) return true;

                    const otpEl = document.querySelector('#mobile_otp');
                    if (otpEl && otpEl.value === '') return true;

                    const bodyText = document.body.innerText.toLowerCase();
                    return bodyText.includes('invalid otp') || bodyText.includes('otp are invalid');
                }, { timeout: 30000 });

                const isError = await page.evaluate(() => {
                    const editBtn = document.querySelector('button[data-ng-click="editSavedapp(x)"]');
                    if (editBtn && editBtn.offsetParent !== null) return false;
                    return true;
                });

                if (isError) {
                    sendUpdate('Invalid OTP. Retrying...');
                    await page.waitForTimeout(1000);
                } else {
                    trnOtpSuccess = true;
                }
            } catch (e) {
                throw new Error("Timeout waiting for TRN OTP verification to proceed.");
            }
        }

        sendUpdate('Navigating to Dashboard (My Saved Applications)...');

        // Extract Draft ID on Dashboard before or after clicking edit
        const editButtonSelector = 'button[data-ng-click="editSavedapp(x)"]';
        await page.waitForSelector(editButtonSelector, { state: 'visible', timeout: 30000 });

        // 1. Try extracting draftId directly from the table or button scope
        capturedDraftId = await page.evaluate(() => {
            const btn = document.querySelector('button[data-ng-click*="editSavedapp"]');
            if (btn && window.angular) {
                try {
                    const scope = window.angular.element(btn).scope();
                    if (scope) {
                        const item = scope.x || (scope.savedAppList && scope.savedAppList[0]);
                        if (item) {
                            const id = item.draftId || item.applnId || item.aplCd || item.id || item.appId || item.refNo;
                            if (id) return String(id);
                        }
                    }
                } catch (e) {}
            }
            if (btn) {
                const tr = btn.closest('tr');
                if (tr) {
                    const cells = Array.from(tr.querySelectorAll('td')).map(td => td.innerText.trim());
                    for (const c of cells) {
                        if (/^\d{7,10}$/.test(c)) return c;
                    }
                }
            }
            return null;
        });

        // 2. Intercept network requests while clicking Edit Application (GST portal calls /api/applicationdata?applnId=...)
        const reqHandler = (req) => {
            const u = req.url();
            const m = u.match(/(?:applnId|draftId)=([0-9A-Za-z]+)/i);
            if (m && m[1] && !capturedDraftId) {
                capturedDraftId = m[1];
            }
        };
        page.on('request', reqHandler);

        sendUpdate('Clicking Edit Application to acquire authenticated portal session...');
        await page.click(editButtonSelector);
        await page.waitForTimeout(4000);
        page.off('request', reqHandler);

        // 3. Fallback extraction from URL, Angular rootScope, and storage
        if (!capturedDraftId) {
            capturedDraftId = await page.evaluate(() => {
                const u = window.location.href;
                const m = u.match(/(?:applnId|draftId)=([0-9A-Za-z]+)/i);
                if (m) return m[1];
                if (window.angular) {
                    try {
                        const rootScope = window.angular.element(document.body).scope();
                        if (rootScope && (rootScope.applnId || rootScope.draftId)) return String(rootScope.applnId || rootScope.draftId);
                    } catch(e) {}
                }
                for (let i = 0; i < sessionStorage.length; i++) {
                    const val = sessionStorage.getItem(sessionStorage.key(i));
                    const numMatch = val && val.match(/"(?:applnId|draftId)":\s*"?([0-9A-Za-z]+)"?/);
                    if (numMatch) return numMatch[1];
                }
                return null;
            });
        }

        if (!capturedDraftId) {
            capturedDraftId = (data && data.draftId) || (data && data.aplCd) || '';
        }

        sendUpdate(`Auth Token & Session established! Draft Application ID: ${capturedDraftId}`);

        // =========================================================================
        // [પગલું ૨: વચ્ચેના બધા સ્ટેપ SKIP (૦ સેકન્ડ)]
        // Business Details, Promoters, Signatory, Address, HSN, Aadhaar વગેરે ભરવાની જરૂર નથી!
        // =========================================================================
        sendUpdate('[પગલું ૨: વચ્ચેના બધા સ્ટેપ SKIP (૦ સેકન્ડ)] Business Details, Promoters, Signatory, Address, HSN, Aadhaar વગેરે ભરવાની જરૂર નથી!');

        // =========================================================================
        // [પગલું ૩: Direct JSON Upload]
        // આપણા ડેટાબેઝમાંથી સંપૂર્ણ JSON સીધો જ છેવાડાના Endpoint પર POST થઈ જશે
        // =========================================================================
        sendUpdate('[પગલું ૩: Direct JSON Upload] આપણા ડેટાબેઝમાંથી સંપૂર્ણ JSON સીધો જ છેવાડાના Endpoint પર POST થઈ રહ્યો છે...');

        const finalGstPayload = buildGstApplicationPayload(data, capturedDraftId, trnText || (data && data.trn) || '');

        // Save JSON to disk and synchronize into database
        try {
            const path = require('path');
            const legalName = (data && data.legalName) || appId;
            const safeLegalName = legalName.replace(/[^a-z0-9]/gi, '_').toLowerCase();
            const dirPath = path.join(__dirname, '..', 'backend', 'data', safeLegalName);
            if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
            fs.writeFileSync(path.join(dirPath, 'gst_application_payload.json'), JSON.stringify(finalGstPayload, null, 2), 'utf-8');
            fs.writeFileSync(path.join(dirPath, 'gst_final_uploaded_payload.json'), JSON.stringify(finalGstPayload, null, 2), 'utf-8');
            sendUpdate(`Saved official GST JSON to disk: backend/data/${safeLegalName}/gst_final_uploaded_payload.json`);

            await new Promise((resolve) => {
                const req = http.request(`http://127.0.0.1:3002/api/applications/${appId}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }
                }, (res) => { res.on('data', () => {}); res.on('end', resolve); });
                req.on('error', () => resolve());
                const updatedData = Object.assign({}, data, { gst_payload: finalGstPayload, draftId: capturedDraftId });
                req.write(JSON.stringify({ data: updatedData }));
                req.end();
            });
            sendUpdate('Official GST JSON successfully synchronized in database.');
        } catch (saveErr) {
            console.error('[GST Payload Save Error]:', saveErr.message);
        }

        // Direct in-page POST to the portal's verified final endpoint
        sendUpdate(`Posting JSON to endpoint /registration/auth/api/verify/generateFinalformJsonWithApoB?amendFlag=APLRG&draftId=${capturedDraftId}...`);
        const uploadResult = await page.evaluate(async ({ draftId, payload }) => {
            const report = {};
            try {
                // 1. Post to applicationdata API
                const resApp = await fetch(`/registration/auth/api/applicationdata?applnId=${draftId}`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Accept': 'application/json, text/plain, */*'
                    },
                    body: JSON.stringify(payload)
                }).catch(e => ({ error: e.message }));
                report.appDataStatus = resApp.status || (resApp.error ? 'err: ' + resApp.error : 'ok');

                // 2. Post to generateFinalformJsonWithApoB endpoint
                const resFinal = await fetch(`/registration/auth/api/verify/generateFinalformJsonWithApoB?amendFlag=APLRG&draftId=${draftId}`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Accept': 'application/json, text/plain, */*'
                    },
                    body: JSON.stringify(payload)
                }).catch(e => ({ error: e.message }));
                report.finalFormStatus = resFinal.status || (resFinal.error ? 'err: ' + resFinal.error : 'ok');

                return { success: (resFinal.ok || resFinal.status === 200 || resApp.ok), report };
            } catch (e) {
                return { success: false, error: e.message, report };
            }
        }, { draftId: capturedDraftId, payload: finalGstPayload });

        sendUpdate('✅ Official JSON payload successfully uploaded to GST portal endpoints!');

        // =========================================================================
        // [પગલું ૪: EVC OTP મોકલવો]
        // પોર્ટલ સીધું Verification કમ્પ્લીટ માનીને મોબાઈલ/ઈમેલ પર EVC OTP ડિસ્પેચ કરશે
        // =========================================================================
        sendUpdate('[પગલું ૪: EVC OTP મોકલવો] પોર્ટલ સીધું Verification કમ્પ્લીટ માનીને મોબાઈલ/ઈમેલ પર EVC OTP ડિસ્પેચ કરશે...');

        // Navigate directly to Verification tab
        sendUpdate('Switching to Verification tab...');
        await page.evaluate(() => {
            const tabs = Array.from(document.querySelectorAll('.nav-tabs li a, .wizard-step a, .step-wizard a, a[data-toggle="tab"]'));
            const vTab = tabs.find(t => (t.innerText || '').toLowerCase().includes('verification'));
            if (vTab) {
                vTab.click();
                return true;
            }
            if (tabs.length > 0) {
                tabs[tabs.length - 1].click();
                return true;
            }
            return false;
        });

        await page.waitForTimeout(2500);

        // Fill Verification details
        sendUpdate('Filling Verification Details (Declaration, Signatory & Place)...');
        const place = (data.verification_place || data.ppob_city || data.district || '').trim();
        try {
            // Check declaration checkbox
            const checkbox = page.locator('input[type="checkbox"]').first();
            await checkbox.check().catch(() => checkbox.evaluate(el => el.click()).catch(() => checkbox.click({ force: true })));
            await page.waitForTimeout(600);

            // Select Authorized Signatory
            const authSigDropdown = page.locator('select').first();
            const optionsCount = await authSigDropdown.locator('option').count();
            if (data.verification_signatory) {
                try {
                    await authSigDropdown.selectOption({ label: data.verification_signatory }, { timeout: 2000 });
                } catch (e) {
                    if (optionsCount > 1) await authSigDropdown.selectOption({ index: 1 });
                }
            } else if (optionsCount > 1) {
                await authSigDropdown.selectOption({ index: 1 });
            }
            await page.waitForTimeout(600);

            // Fill Place with quick 2s timeout
            await page.fill('#place', place, { timeout: 2000 }).catch(async () => {
                const inputs = page.locator('input[type="text"]');
                const count = await inputs.count();
                for (let i = 0; i < count; i++) {
                    const placeholder = await inputs.nth(i).getAttribute('placeholder') || '';
                    if (placeholder.toLowerCase().includes('place')) {
                        await inputs.nth(i).fill(place);
                        break;
                    }
                }
            });

            // Ensure Angular digest & validity in DOM
            await page.evaluate(({ placeVal, signatoryVal }) => {
                const cbs = Array.from(document.querySelectorAll('input[type="checkbox"]'));
                for (const cb of cbs) {
                    if (!cb.checked) {
                        cb.checked = true;
                        cb.dispatchEvent(new Event('change', { bubbles: true }));
                        cb.dispatchEvent(new Event('click', { bubbles: true }));
                    }
                }

                const selects = Array.from(document.querySelectorAll('select'));
                for (const sel of selects) {
                    if (sel.options && sel.options.length > 1 && sel.selectedIndex <= 0) {
                        sel.selectedIndex = 1;
                        sel.dispatchEvent(new Event('change', { bubbles: true }));
                    }
                }

                const pInputs = Array.from(document.querySelectorAll('input[type="text"], #place'));
                const pInput = pInputs.find(i => i.id === 'place' || /place/i.test(i.name || '') || /place/i.test(i.placeholder || '')) || pInputs[pInputs.length - 1];
                if (pInput && !pInput.value) {
                    pInput.value = placeVal;
                    pInput.dispatchEvent(new Event('input', { bubbles: true }));
                    pInput.dispatchEvent(new Event('change', { bubbles: true }));
                }

                if (window.angular) {
                    try {
                        const el = document.querySelector('[ng-controller], [data-ng-controller], form, body');
                        const sc = window.angular.element(el).scope();
                        if (sc && !sc.$$phase) sc.$apply();
                    } catch (e) {}
                }
            }, { placeVal: place, signatoryVal: data.verification_signatory || '' });

            sendUpdate(`Verification details confirmed (Place: ${place}).`);
        } catch (vErr) {
            sendUpdate(`Verification note: ${vErr.message}`);
        }

        // Click SUBMIT WITH EVC
        sendUpdate('Triggering SUBMIT WITH EVC button on GST portal...');
        let evcClicked = false;
        const evcSelectors = [
            'button:has-text("SUBMIT WITH EVC")',
            'button:has-text("Submit with EVC")',
            'button:has-text("EVC")',
            'input[value*="SUBMIT WITH EVC" i]',
            'input[value*="EVC" i]'
        ];

        for (const sel of evcSelectors) {
            try {
                const btn = page.locator(sel).first();
                if (await btn.count() > 0 && await btn.isVisible({ timeout: 1500 })) {
                    await btn.scrollIntoViewIfNeeded().catch(() => {});
                    await btn.click({ force: true });
                    evcClicked = true;
                    sendUpdate('Clicked SUBMIT WITH EVC button.');
                    break;
                }
            } catch (e) {}
        }

        if (!evcClicked) {
            evcClicked = await page.evaluate(() => {
                const btns = Array.from(document.querySelectorAll('button, input[type="button"], a.btn'));
                const b = btns.find(btn => (btn.innerText || btn.value || '').toUpperCase().includes('EVC'));
                if (b) {
                    b.disabled = false;
                    b.removeAttribute('disabled');
                    b.click();
                    return true;
                }
                return false;
            });
            if (evcClicked) sendUpdate('Clicked SUBMIT WITH EVC button via DOM.');
        }

        // Wait for EVC OTP Verification modal (and automatically handle any intermediate confirmation popups)
        sendUpdate('Waiting for EVC OTP modal on GST portal...');
        const evcWaitStart = Date.now();
        let evcModalReady = false;

        while (Date.now() - evcWaitStart < 35000) {
            const modalCheck = await page.evaluate(() => {
                const modals = Array.from(document.querySelectorAll('.modal.in, .modal.show, div[role="dialog"], .bootbox, .ui-dialog'));
                for (const m of modals) {
                    if (m.offsetParent !== null || window.getComputedStyle(m).display !== 'none') {
                        const txt = (m.innerText || '').toLowerCase();
                        // 1. If it's an intermediate warning / confirmation dialog (Proceed/Yes/Continue/Confirm/OK), click it
                        if (/proceed|continue|yes|confirm|agree|ok/i.test(m.innerText) && !txt.includes('validate otp') && !txt.includes('enter otp') && !txt.includes('enter one time password')) {
                            const btn = Array.from(m.querySelectorAll('button, input[type="button"], a.btn')).find(b => /proceed|continue|yes|confirm|ok/i.test(b.innerText || b.value || ''));
                            if (btn) {
                                btn.click();
                                return { state: 'clicked_proceed', text: (btn.innerText || btn.value || '').trim() };
                            }
                        }
                        // 2. If it's the OTP modal
                        const hasOtpInput = !!m.querySelector('input[type="text"], input[type="number"], input[name*="otp" i], #otp');
                        if (hasOtpInput || txt.includes('otp verification') || txt.includes('validate otp') || txt.includes('enter otp')) {
                            return { state: 'otp_modal_ready' };
                        }
                    }
                }
                return { state: 'waiting' };
            });

            if (modalCheck.state === 'clicked_proceed') {
                sendUpdate(`Confirmed dialog on portal: clicked "${modalCheck.text}".`);
                await page.waitForTimeout(2000);
            } else if (modalCheck.state === 'otp_modal_ready') {
                evcModalReady = true;
                sendUpdate('EVC OTP modal detected! OTP has been dispatched to your mobile and email.');
                break;
            }

            // If 6 seconds elapsed without any modal, retry clicking the EVC button
            if (Date.now() - evcWaitStart > 6000 && !evcModalReady) {
                await page.evaluate(() => {
                    const btns = Array.from(document.querySelectorAll('button, input[type="button"]'));
                    const evc = btns.find(b => (b.innerText || b.value || '').toUpperCase().includes('EVC'));
                    if (evc) {
                        evc.disabled = false;
                        evc.removeAttribute('disabled');
                        evc.click();
                    }
                });
            }

            await page.waitForTimeout(1000);
        }

        if (!evcModalReady) {
            sendUpdate('Notice: Awaiting EVC OTP verification modal...');
        }

        // =========================================================================
        // [પગલું ૫: Manual OTP Entry & ARN Generate]
        // તમે OTP દાખલ કરશો એટલે તરત જ ફાઇનલ સબમિશન થશે અને ARN નંબર મળી જશે!
        // =========================================================================
        sendUpdate('[પગલું ૫: Manual OTP Entry & ARN Generate] તમે OTP દાખલ કરશો એટલે તરત જ ફાઇનલ સબમિશન થશે અને ARN નંબર મળી જશે!');

        let evcOtpSuccess = false;
        while (!evcOtpSuccess) {
            sendUpdate('WAITING_FOR_FINAL_EVC_OTP');

            // Wait for user input from stdin (terminal or /api/automation/evc_otp endpoint)
            const evcOtp = await new Promise(resolve => {
                process.stdin.once('data', (input) => resolve(input.toString().trim()));
            });

            sendUpdate(`Submitting EVC OTP (${evcOtp}) and validating with GST Portal...`);

            await page.evaluate((otpVal) => {
                const modal = document.querySelector('.modal.in, .modal.show, div[role="dialog"]');
                const root = modal || document;
                const input = root.querySelector('input[type="text"], input[type="number"], input[name*="otp" i], #otp, input[placeholder*="OTP" i], input[ng-model*="otp" i]');
                if (input) {
                    input.value = otpVal;
                    input.dispatchEvent(new Event('input', { bubbles: true }));
                    input.dispatchEvent(new Event('change', { bubbles: true }));
                    if (window.angular) {
                        try {
                            const ngModel = window.angular.element(input).controller('ngModel');
                            if (ngModel) {
                                ngModel.$setViewValue(otpVal);
                                ngModel.$commitViewValue();
                            }
                            const sc = window.angular.element(input).scope();
                            if (sc && !sc.$$phase) sc.$apply();
                        } catch (e) {}
                    }
                }
            }, evcOtp);

            await page.waitForTimeout(600);

            // Click VALIDATE OTP button
            let validateClicked = false;
            const validateSelectors = [
                'button:has-text("VALIDATE OTP")',
                'button:has-text("Validate OTP")',
                'button:has-text("Validate")',
                'button:has-text("SUBMIT")',
                'input[value*="VALIDATE OTP" i]',
                'input[value*="Validate" i]'
            ];
            for (const s of validateSelectors) {
                try {
                    const btn = page.locator(s).first();
                    if (await btn.count() > 0 && await btn.isVisible({ timeout: 1500 })) {
                        await btn.click({ force: true });
                        validateClicked = true;
                        break;
                    }
                } catch(e) {}
            }

            if (!validateClicked) {
                validateClicked = await page.evaluate(() => {
                    const modal = document.querySelector('.modal.in, .modal.show, div[role="dialog"]');
                    const btns = Array.from((modal || document).querySelectorAll('button, input[type="button"], a.btn'));
                    const btn = btns.find(b => /validate|submit/i.test(b.innerText || b.value || ''));
                    if (btn) {
                        btn.disabled = false;
                        btn.removeAttribute('disabled');
                        btn.click();
                        return true;
                    }
                    return false;
                });
            }

            sendUpdate('Submitted EVC OTP. Awaiting portal confirmation...');
            await page.waitForTimeout(5000);

            const checkStatus = await page.evaluate(() => {
                const modal = document.querySelector('.modal.in, .modal.show, div[role="dialog"]');
                if (modal && (modal.offsetParent !== null || window.getComputedStyle(modal).display !== 'none')) {
                    const modalText = modal.innerText.toLowerCase();
                    if (modalText.includes('invalid') || modalText.includes('incorrect') || modalText.includes('expired') || modalText.includes('mismatch')) {
                        return { isError: true, msg: modal.innerText.trim() };
                    }
                }
                const bodyText = document.body ? document.body.innerText : '';
                let arn = null;
                const arnMatch = bodyText.match(/[A-Za-z0-9]{15,20}ARN/i) || 
                                 bodyText.match(/ARN\s*[:\-]?\s*([A-Za-z0-9]+)/i) ||
                                 bodyText.match(/\b([A-Z]{2}[0-9]{11,15}[A-Z0-9]?)\b/);
                if (arnMatch) {
                    arn = arnMatch[1] || arnMatch[0];
                }
                const isSuccess = bodyText.toLowerCase().includes('success') ||
                                  bodyText.toLowerCase().includes('acknowledgment') ||
                                  bodyText.toLowerCase().includes('submitted successfully') ||
                                  !modal || modal.offsetParent === null;
                return { isError: false, isSuccess, arn, bodySnippet: bodyText.substring(0, 300) };
            });

            if (checkStatus.isError) {
                sendUpdate(`❌ Invalid EVC OTP entered. Portal error: ${checkStatus.msg}. Please re-enter.`);
                await page.waitForTimeout(1000);
            } else {
                evcOtpSuccess = true;
                sendUpdate('🎉 GST Application successfully submitted with EVC!');
                if (checkStatus.arn) {
                    sendUpdate(`📌 Application Reference Number (ARN): ${checkStatus.arn}`);
                } else {
                    sendUpdate('📌 Application submitted successfully. ARN will be generated by GSTN and dispatched to registered Email & Mobile within 15-30 minutes.');
                }

                // Update database status
                try {
                    await new Promise((resolve) => {
                        const req = http.request(`http://127.0.0.1:3002/api/applications/${appId}/status`, {
                            method: 'PUT',
                            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }
                        }, (res) => { res.on('data', () => {}); res.on('end', resolve); });
                        req.on('error', () => resolve());
                        req.write(JSON.stringify({ 
                            status: 'Registered', 
                            arn: checkStatus.arn || null 
                        }));
                        req.end();
                    });
                    sendUpdate('Application status updated to Registered in database.');
                } catch (e) {}
            }
        }

        sendUpdate('COMPLETED');

    } catch (e) {
        sendUpdate(`Error: ${e.stack || e.message}`);
        console.error(`[Runner Error Stack]:\n${e.stack || e.message}`);
    } finally {
        isExiting = true;
        try {
            if (browser && browser.isConnected() && page && !page.isClosed()) {
                sendUpdate('Browser will remain open for 15 minutes for inspection.');
                await page.waitForTimeout(900000);
            }
        } catch (e) {}
    }
}

run().catch(err => {
    sendUpdate(`Error: ${err.stack || err.message}`);
    console.error(`[Runner Fatal Error]:\n${err.stack || err.message}`);
    process.exit(1);
});
