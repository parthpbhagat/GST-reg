const path = require('path');
try {
    require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
} catch (e) {
    try {
        require(path.join(__dirname, '..', 'backend', 'node_modules', 'dotenv')).config({ path: path.join(__dirname, '..', '.env') });
    } catch (_) { }
}
const { chromium } = require('playwright');
const http = require('http');
const { buildGstApplicationPayload, getStateCode } = require('../backend/utils/gst_payload_builder');

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

function formatDDMMYYYY(dateStr) {
    if (!dateStr) {
        const now = new Date();
        const d = String(now.getDate()).padStart(2, '0');
        const m = String(now.getMonth() + 1).padStart(2, '0');
        const y = now.getFullYear();
        return `${d}/${m}/${y}`;
    }
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(dateStr)) return dateStr;
    const d = new Date(dateStr);
    if (!isNaN(d.getTime())) {
        const day = String(d.getDate()).padStart(2, '0');
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const year = d.getFullYear();
        return `${day}/${month}/${year}`;
    }
    return String(dateStr);
}

function isDummyElectricityConsumerNo(val) {
    if (!val) return true;
    const s = String(val).trim().toLowerCase();
    if (!s || s === 'undefined' || s === 'null' || s === 'na' || s === 'n/a' || s === 'none' || s === 'no' || s === '') return true;
    if (/^(test|dummy|sample)$/i.test(s)) return true;
    return false;
}

function extractValidTrn(text) {
    if (!text || typeof text !== 'string') return '';
    const m = text.match(/\b(\d{2}\d{2}\d{2}\d{6,10}(?:TRN)?)\b/i) ||
              text.match(/\b(\d{12,15}TRN)\b/i) ||
              text.match(/\b(\d{14,16})\b/);
    return m ? m[1].toUpperCase() : '';
}

async function getCaptchaDataUrl(page, selector = '#imgCaptcha') {
    await page.waitForSelector(selector, { state: 'visible', timeout: 20000 });
    await page.waitForTimeout(300);

    // 1. Instant HTML5 Canvas pixel extraction (bypasses Playwright compositor animation locks)
    try {
        const canvasData = await page.evaluate(async (sel) => {
            const img = document.querySelector(sel);
            if (!img) return null;
            if (!img.complete) {
                await new Promise((r) => { img.onload = r; img.onerror = r; setTimeout(r, 2000); });
            }
            const canvas = document.createElement('canvas');
            canvas.width = img.naturalWidth || img.width || 200;
            canvas.height = img.naturalHeight || img.height || 50;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0);
            return canvas.toDataURL('image/png');
        }, selector);
        if (canvasData && canvasData.length > 100) {
            return canvasData;
        }
    } catch (_) {}

    // 2. Playwright element screenshot with animations: 'disabled' and 5s timeout
    try {
        const el = await page.$(selector);
        if (el) {
            const buf = await el.screenshot({ animations: 'disabled', timeout: 5000 });
            if (buf && buf.length > 0) {
                return `data:image/png;base64,${buf.toString('base64')}`;
            }
        }
    } catch (_) {}

    // 3. Playwright bounding-box clip screenshot
    try {
        const box = await page.locator(selector).boundingBox();
        if (box && box.width > 0 && box.height > 0) {
            const buf = await page.screenshot({ clip: box, animations: 'disabled', timeout: 5000 });
            if (buf && buf.length > 0) {
                return `data:image/png;base64,${buf.toString('base64')}`;
            }
        }
    } catch (_) {}

    throw new Error('Timeout or failure locating Captcha image on GST portal');
}

function extractCleanErrorMessage(raw) {
    if (!raw) return 'Validation error from GST portal';
    const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);
    const errLine = lines.slice().reverse().find(l => /required|mandatory|invalid|enter|select|provide|cannot|error|failed|does not match/i.test(l));
    if (errLine) return errLine;
    if (lines.length > 0) return lines[lines.length - 1];
    return raw.trim();
}

function mapPortalError(msg) {
    const text = (msg || '').toLowerCase();
    if (text.includes('14a') || text.includes('rule 14') || text.includes('rule14')) {
        return { field: 'rule14A', step: 0, stepName: 'Business Details', label: 'Option for registration under Rule 14A' };
    }
    // Check constitution FIRST before PAN (since options like "Foreign Company" contain "pan")
    if (text.includes('constitution')) {
        return { field: 'businessConstitution', step: 0, stepName: 'Business Details', label: 'Constitution of Business' };
    }
    // Check PAN with word boundary to avoid matching "company", "japan", etc.
    if (/\bpan\b/i.test(text) || text.includes('permanent account number')) {
        return { field: 'pan', step: 0, stepName: 'Business Details', label: 'PAN Number' };
    }
    if (text.includes('legal name') || text.includes('trade name')) {
        return { field: 'tradeName', step: 0, stepName: 'Business Details', label: 'Trade Name / Legal Name' };
    }
    if (text.includes('commencement')) {
        return { field: 'dateOfCommencement', step: 0, stepName: 'Business Details', label: 'Date of Commencement of Business' };
    }
    if (text.includes('liability')) {
        return { field: 'dateOfLiability', step: 0, stepName: 'Business Details', label: 'Date on which liability to register arises' };
    }
    if (text.includes('reason')) {
        return { field: 'reasonToObtainRegistration', step: 0, stepName: 'Business Details', label: 'Reason to Obtain Registration' };
    }
    if (text.includes('district') || text.includes('state')) {
        return { field: 'district', step: 0, stepName: 'Business Details', label: 'State / District' };
    }
    if (text.includes('gender')) {
        return { field: 'p1_gender', step: 1, stepName: 'Promoter / Partners', label: 'Gender of Promoter' };
    }
    if (text.includes('promoter') || text.includes('partner') || text.includes('director') || text.includes('father') || text.includes('dob')) {
        return { field: 'p1_firstName', step: 1, stepName: 'Promoter / Partners', label: 'Promoter / Partner Details' };
    }
    if (text.includes('signatory') || text.includes('authorized signatory')) {
        return { field: 'a1_firstName', step: 2, stepName: 'Authorized Signatory', label: 'Authorized Signatory Details' };
    }
    if (text.includes('pincode') || text.includes('pin code')) {
        return { field: 'ppob_pincode', step: 4, stepName: 'Principal Place of Business', label: 'PIN Code' };
    }
    if (text.includes('possession') || text.includes('premise')) {
        return { field: 'ppob_natureOfPossession', step: 4, stepName: 'Principal Place of Business', label: 'Nature of Possession of Premises' };
    }
    if (text.includes('principal place') || text.includes('address') || text.includes('building') || text.includes('flat') || text.includes('floor')) {
        return { field: 'ppob_building', step: 4, stepName: 'Principal Place of Business', label: 'Principal Place of Business' };
    }
    if (text.includes('electricity') || text.includes('consumer')) {
        return { field: 'stateSpecific_electricityConsumerNo', step: 7, stepName: 'State Specific Information', label: 'Electricity Consumer Number' };
    }
    if (text.includes('hsn') || text.includes('sac') || text.includes('goods') || text.includes('service')) {
        return { field: 'goods_hsn', step: 6, stepName: 'Goods and Services', label: 'HSN / SAC Code' };
    }
    if (text.includes('aadhaar')) {
        return { field: 'aadhaarAuth', step: 8, stepName: 'Aadhaar Authentication', label: 'Aadhaar Authentication' };
    }
    if (text.includes('verification') || text.includes('declaration') || text.includes('place')) {
        return { field: 'verification_place', step: 9, stepName: 'Verification', label: 'Verification Place' };
    }
    if (text.includes('file') || text.includes('pdf') || text.includes('jpeg') || text.includes('jpg') || text.includes('size') || text.includes('1 mb') || text.includes('format') || text.includes('upload') || text.includes('document')) {
        if (text.includes('photograph') || text.includes('photo')) {
            return { field: 'promoterPhotoFile', step: 1, stepName: 'Promoter / Partners', label: 'Promoter Photograph' };
        }
        if (text.includes('constitution')) {
            return { field: 'proofOfConstitutionFile', step: 0, stepName: 'Business Details', label: 'Proof of Constitution Document' };
        }
        if (text.includes('signatory') || text.includes('authorisation') || text.includes('authorization') || text.includes('loa')) {
            return { field: 'authSigProofFile', step: 2, stepName: 'Authorized Signatory', label: 'Proof of Authorized Signatory' };
        }
        return { field: 'ppob_docFile', step: 4, stepName: 'Principal Place of Business', label: 'Principal Place Document' };
    }
    return { field: 'businessConstitution', step: 0, stepName: 'Business Details', label: 'Constitution of Business' };
}

function sendPortalError(msg, defaultStep = 0, defaultField = 'businessConstitution', defaultStepName = 'Business Details', defaultLabel = 'Constitution of Business') {
    const mapped = mapPortalError(msg);
    const cleanMsg = extractCleanErrorMessage(msg);
    const payload = {
        message: cleanMsg,
        rawMessage: msg,
        field: mapped.field || defaultField,
        step: typeof mapped.step === 'number' ? mapped.step : defaultStep,
        stepName: mapped.stepName || defaultStepName,
        label: mapped.label || defaultLabel,
        appId: appId
    };
    console.log('PORTAL_ERROR:' + JSON.stringify(payload));
    sendUpdate(`PORTAL_ERROR:${JSON.stringify(payload)}`);
    return payload;
}

let globalPage = null;
let isExiting = false;
// Live browser preview screenshots disabled as requested
// setInterval(async () => {
//     if (globalPage && !isExiting) {
//         try {
//             if (!globalPage.isClosed()) {
//                 const buffer = await globalPage.screenshot({ type: 'jpeg', quality: 40 });
//                 console.log(`SCREENSHOT:${buffer.toString('base64')}`);
//             }
//         } catch (e) {
//             // Ignore screenshot errors
//         }
//     }
// }, 1500);

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

    const isHeadless = process.env.HEADLESS === 'true';
    const os = require('os');
    const userDataDir = path.join(os.tmpdir(), `gst_chrome_profile_${appId || 'run'}`);

    const launchArgs = isHeadless ? [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu'
    ] : [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--start-maximized',
        '--new-window',
        '--window-position=0,0',
        '--window-size=1920,1080'
    ];

    const launchOptions = {
        headless: isHeadless,
        args: launchArgs,
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        viewport: isHeadless ? { width: 1280, height: 800 } : null
    };

    const fs = require('fs');
    if (fs.existsSync('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe')) {
        launchOptions.channel = 'chrome';
    } else if (fs.existsSync('C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe')) {
        launchOptions.channel = 'msedge';
    }

    sendUpdate(`INITIALIZING: Starting browser session (${isHeadless ? 'Headless Mode' : 'Visible Chrome Window'})...`);

    let context;
    let browser = null;
    try {
        context = await chromium.launchPersistentContext(userDataDir, launchOptions);
    } catch (launchErr) {
        browser = await chromium.launch(launchOptions);
        context = await browser.newContext({
            userAgent: launchOptions.userAgent,
            viewport: launchOptions.viewport
        });
    }

    const pages = context.pages();
    const page = pages.length > 0 ? pages[0] : await context.newPage();
    globalPage = page;
    await page.bringToFront().catch(() => {});
    let keepaliveTimer = null;

    try {
        let rawTrn = (appData.trn || appData.masterTrn || data.trn || data.masterTrn || '').trim();
        let trnText = extractValidTrn(rawTrn);

        // =========================================================================
        // [પગલું ૧: TRN Login]
        // Automation દ્વારા TRN જનરેટ કરવો અને લૉગિન કરીને સેશન મેળવવું (Auth Token)
        // =========================================================================
        sendUpdate('[step ૧: TRN Login] Automation...');

        if (trnText && trnText.length > 5) {
            sendUpdate(`Application already has TRN: ${trnText}. Proceeding straight to TRN Login...`);
        } else {
            const msrUrl = process.env.GST_URL_MSR || 'https://reg.gst.gov.in/registration/msr';
            const partAUrl = (automationMode === 'multistate') ? msrUrl : 'https://reg.gst.gov.in/registration/';
            sendUpdate(`Navigating to official GST portal (${automationMode === 'multistate' ? 'Multi-State Part A (' + msrUrl + ')' : 'Part A'} registration)...`);
            try {
                await page.goto(partAUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
            } catch (e) {
                if (automationMode === 'multistate') {
                    sendUpdate(`Retrying Multi-State Part A navigation to ${msrUrl}...`);
                    await page.goto(msrUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
                } else {
                    throw e;
                }
            }

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
                await page.selectOption('#applnType', { label: taxpayerTypeLabel }).catch(() => { });
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

            // Multi-State state selections if on MSR page
            if (automationMode === 'multistate' && multiStateConfig && multiStateConfig.stCds && multiStateConfig.stCds.length > 0) {
                sendUpdate(`[Multi-State] Selecting multiple state codes: ${multiStateConfig.stCds.join(', ')}...`);
                try {
                    await page.evaluate((codes) => {
                        codes.forEach(c => {
                            const cb = document.querySelector(`input[type="checkbox"][value="${c}"], input[name*="state"][value="${c}"]`);
                            if (cb && !cb.checked) {
                                cb.click();
                                cb.dispatchEvent(new Event('change', { bubbles: true }));
                            }
                        });
                        const selectEl = document.querySelector('select[multiple], #msr_states, #stCds');
                        if (selectEl) {
                            Array.from(selectEl.options).forEach(opt => {
                                if (codes.includes(opt.value)) opt.selected = true;
                            });
                            selectEl.dispatchEvent(new Event('change', { bubbles: true }));
                        }
                    }, multiStateConfig.stCds);
                } catch (e) { }
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
                const captchaDataUrl = await getCaptchaDataUrl(page, '#imgCaptcha');
                console.log(`CAPTCHA_IMAGE:${captchaDataUrl}`);
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
                        const u = window.location.href;
                        if (u.includes('/msrverify') || u.includes('/verify')) return true;
                        const otpEl = document.querySelector('#mobile_otp, #otp, input[name*="otp"]');
                        if (otpEl && otpEl.offsetParent !== null) return true;
                        const captchaEl = document.querySelector('#captcha');
                        if (captchaEl && captchaEl.value === '') return true;
                        const err = document.querySelector('.alert-danger, .err, [ng-show*="err"]');
                        if (err && err.offsetParent !== null && err.innerText.trim().length > 0) return true;
                        return false;
                    }, { timeout: 35000 });

                    const isCleared = await page.evaluate(() => {
                        const u = window.location.href;
                        if (u.includes('/msrverify') || u.includes('/verify')) return false;
                        const otpEl = document.querySelector('#mobile_otp, #otp, input[name*="otp"]');
                        if (otpEl && otpEl.offsetParent !== null) return false;
                        const captchaEl = document.querySelector('#captcha');
                        return captchaEl && captchaEl.value === '';
                    });

                    if (isCleared) {
                        sendUpdate('Invalid Captcha. Retrying...');
                        await page.waitForTimeout(1000);
                    } else {
                        initialCaptchaSuccess = true;
                        sendUpdate(`OTP verification screen active: ${page.url()}`);
                    }
                } catch (e) {
                    if (page.url().includes('msrverify') || page.url().includes('/verify')) {
                        initialCaptchaSuccess = true;
                    } else {
                        throw new Error("Timeout waiting for OTP verification screen to proceed.");
                    }
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
                await page.evaluate(({ mOtp, eOtp }) => {
                    const m = document.querySelector('#mobile_otp, input[name="mobile_otp"], input[data-ng-model*="mobile"]');
                    if (m) {
                        m.value = mOtp;
                        m.dispatchEvent(new Event('input', { bubbles: true }));
                        m.dispatchEvent(new Event('change', { bubbles: true }));
                    }
                    const e1 = document.querySelector('#email-otp, #email_otp, input[name="email_otp"], input[data-ng-model*="email"]');
                    if (e1) {
                        e1.value = eOtp;
                        e1.dispatchEvent(new Event('input', { bubbles: true }));
                        e1.dispatchEvent(new Event('change', { bubbles: true }));
                    }
                }, { mOtp: mobileOtp, eOtp: emailOtp });

                await page.waitForTimeout(500);

                const proceedOtpBtn = page.locator('button', { hasText: 'Proceed' }).last();
                await proceedOtpBtn.click();

                sendUpdate('Verifying OTPs...');
                try {
                    await page.waitForFunction(() => {
                        const trnEl = document.querySelector('span[data-ng-bind="trn"], span[data-ng-bind*="trn"], span[ng-bind*="trn"], .trn-number');
                        if (trnEl && trnEl.textContent.trim().length > 5) return true;

                        const bodyText = document.body.innerText.toLowerCase();
                        if (/\b\d{14,16}(?:trn)?\b/i.test(bodyText) && !bodyText.includes('enter otp')) return true;

                        const otpEl = document.querySelector('#mobile_otp');
                        if (otpEl && otpEl.value === '') return true;

                        return bodyText.includes('invalid otp') || bodyText.includes('otp are invalid') || bodyText.includes('otp is invalid');
                    }, { timeout: 35000 });

                    const isError = await page.evaluate(() => {
                        const trnEl = document.querySelector('span[data-ng-bind="trn"], span[data-ng-bind*="trn"], span[ng-bind*="trn"], .trn-number');
                        if (trnEl && trnEl.textContent.trim().length > 5) return false;
                        const bodyText = document.body.innerText.toLowerCase();
                        if (/\b\d{14,16}(?:trn)?\b/i.test(bodyText) && !bodyText.includes('enter otp')) return false;
                        return true;
                    });

                    if (isError) {
                        sendUpdate('Invalid OTP. Retrying...');
                        await page.waitForTimeout(1000);
                    } else {
                        initialOtpSuccess = true;
                    }
                } catch (e) {
                    const hasTrn = await page.evaluate(() => {
                        const el = document.querySelector('span[data-ng-bind*="trn" i], span[ng-bind*="trn" i], .trn-number');
                        if (el && el.textContent.trim().length > 5) return true;
                        return /\b\d{14,16}(?:trn)?\b/i.test(document.body.innerText);
                    });
                    if (hasTrn) {
                        initialOtpSuccess = true;
                    } else {
                        throw new Error("Timeout waiting for OTP verification to proceed.");
                    }
                }
            }

            sendUpdate('Extracting Temporary Reference Number (TRN)...');
            try {
                await page.waitForFunction(() => {
                    const text = document.body ? document.body.innerText : '';
                    return /\b\d{2}\d{2}\d{2}\d{6,10}(?:TRN)?\b/i.test(text) || /\b\d{12,15}TRN\b/i.test(text) || /\b\d{14,16}\b/.test(text);
                }, { timeout: 60000 });
            } catch (e) { }

            const rawExtractedTrn = await page.evaluate(() => {
                const text = document.body ? document.body.innerText : '';
                // 1. Search in innerText of specific elements first
                const els = Array.from(document.querySelectorAll('span[data-ng-bind*="trn" i], span[ng-bind*="trn" i], .trn-number, strong[ng-bind*="trn" i], strong, b, span, p, div'));
                for (const el of els) {
                    const t = (el.textContent || '').trim();
                    const m = t.match(/\b(\d{2}\d{2}\d{2}\d{6,10}(?:TRN)?)\b/i) || t.match(/\b(\d{12,15}TRN)\b/i) || t.match(/\b(\d{14,16})\b/);
                    if (m) return m[1].toUpperCase();
                }
                // 2. Search entire page text
                const match = text.match(/\b(\d{2}\d{2}\d{2}\d{6,10}(?:TRN)?)\b/i) || text.match(/\b(\d{12,15}TRN)\b/i) || text.match(/\b(\d{14,16})\b/);
                return match ? match[1].toUpperCase() : '';
            });

            trnText = extractValidTrn(rawExtractedTrn);
            if (trnText) {
                sendUpdate(`TRN Generated: ${trnText}`);
                // Persist TRN to database
                await new Promise((resolve, reject) => {
                    const req = http.request(`http://127.0.0.1:3002/api/applications/${appId}/trn`, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }
                    }, (res) => { res.on('data', () => { }); res.on('end', resolve); });
                    req.on('error', reject);
                    const trnPayload = (automationMode === 'multistate')
                        ? { trn: trnText, masterTrn: trnText }
                        : { trn: trnText };
                    req.write(JSON.stringify(trnPayload));
                    req.end();
                });
            } else {
                sendUpdate('⚠️ Could not auto-detect TRN pattern on confirmation page. Checking database fallback...');
            }
        }

        // Ensure clean, valid TRN string
        trnText = extractValidTrn(trnText);

        // If trnText is still missing, fallback to querying database
        if (!trnText) {
            try {
                const dbAppRes = await new Promise((resolve) => {
                    http.get(`http://127.0.0.1:3002/api/applications/${appId}`, {
                        headers: { 'Authorization': `Bearer ${token}` }
                    }, (res) => {
                        let raw = '';
                        res.on('data', c => raw += c);
                        res.on('end', () => {
                            try { resolve(JSON.parse(raw)); } catch (e) { resolve(null); }
                        });
                    }).on('error', () => resolve(null));
                });
                if (dbAppRes && dbAppRes.application) {
                    const app = dbAppRes.application;
                    const fetchedTrn = app.trn || app.masterTrn || (app.data && (app.data.trn || app.data.secToken || app.data.masterTrn)) || '';
                    trnText = extractValidTrn(fetchedTrn);
                }
            } catch (e) { }
        }

        // Resolve applicant email from all possible paths
        const resolveApplicantEmail = () => {
            const candidates = [
                data.email,
                data.rgdtls && data.rgdtls.em,
                data.applicantEmail,
                data.userEmail,
                appData.userEmail,
                data.p1 && data.p1.email,
                data.ppob_email,
                data.asgdtls && data.asgdtls[0] && data.asgdtls[0].em,
                data.authSignatory && data.authSignatory[0] && data.authSignatory[0].email,
                data.authSignatory && data.authSignatory[0] && data.authSignatory[0].contact && data.authSignatory[0].contact.email,
                data.promoters && data.promoters[0] && data.promoters[0].email
            ];
            for (const c of candidates) {
                if (typeof c === 'string') {
                    const trimmed = c.trim();
                    if (trimmed.length > 3 && trimmed.includes('@') && trimmed.includes('.') && trimmed !== '-') {
                        return trimmed;
                    }
                }
            }
            try {
                const jsonStr = JSON.stringify({ data, appData });
                const m = jsonStr.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
                if (m) return m[0];
            } catch (_) {}
            return '';
        };

        const userEmail = resolveApplicantEmail();

        sendUpdate(`Navigating to TRN Login screen (TRN: ${trnText || 'Pending'}, Email: ${userEmail || 'Pending'})...`);
        await page.goto('https://reg.gst.gov.in/registration/', { waitUntil: 'domcontentloaded', timeout: 60000 });
        await page.waitForTimeout(1500);

        // Helper to select TRN radio button using label and Angular scope
        const selectTrnRadio = async () => {
            // 1. Click label (Bootstrap custom radio requires label click)
            const label = page.locator('label[for="radiotrn"], label:has-text("Temporary Reference Number")').first();
            if (await label.isVisible().catch(() => false)) {
                await label.click().catch(() => {});
            } else {
                await page.click('#radiotrn').catch(() => {});
            }

            // 2. Angular scope sync for typ = 'T'
            await page.evaluate(() => {
                const rTrn = document.querySelector('#radiotrn');
                if (rTrn) {
                    rTrn.checked = true;
                    rTrn.dispatchEvent(new Event('change', { bubbles: true }));
                    rTrn.dispatchEvent(new Event('input', { bubbles: true }));
                    if (window.angular) {
                        try {
                            const sc = window.angular.element(rTrn).scope();
                            if (sc) {
                                sc.typ = 'T';
                                if (!sc.$$phase) sc.$apply();
                            }
                        } catch (e) {}
                    }
                }
            });
        };

        // Select TRN tab and wait for #trnno
        await selectTrnRadio();
        await page.waitForTimeout(500);
        await page.waitForSelector('#trnno', { state: 'visible', timeout: 15000 });
        await page.waitForTimeout(500);

        // Dedicated helper to ensure TRN radio is checked and #trnno & #email are filled
        const fillTrnLoginForm = async () => {
            // 1. Ensure TRN tab is visible
            const isTrnVisible = await page.$eval('#trnno', el => el.offsetParent !== null).catch(() => false);
            if (!isTrnVisible) {
                await selectTrnRadio();
                await page.waitForSelector('#trnno', { state: 'visible', timeout: 8000 }).catch(() => {});
            }

            // 2. Fill TRN via Playwright
            if (trnText) {
                const trnInput = page.locator('#trnno').first();
                if (await trnInput.isVisible().catch(() => false)) {
                    await trnInput.click({ force: true }).catch(() => {});
                    await trnInput.fill(trnText).catch(() => {});
                }
            }

            // 3. Fill Email via Playwright
            if (userEmail) {
                const emailInput = page.locator('#email').first();
                if (await emailInput.isVisible().catch(() => false)) {
                    await emailInput.click({ force: true }).catch(() => {});
                    await emailInput.fill(userEmail).catch(() => {});
                }
            }

            // 4. Direct DOM & AngularJS scope sync
            await page.evaluate(({ tVal, eVal }) => {
                const trnEl = document.querySelector('#trnno');
                const emailEl = document.querySelector('#email');

                if (trnEl && tVal && trnEl.value !== tVal) {
                    trnEl.value = tVal;
                    trnEl.dispatchEvent(new Event('input', { bubbles: true }));
                    trnEl.dispatchEvent(new Event('change', { bubbles: true }));
                }
                if (emailEl && eVal && emailEl.value !== eVal) {
                    emailEl.value = eVal;
                    emailEl.dispatchEvent(new Event('input', { bubbles: true }));
                    emailEl.dispatchEvent(new Event('change', { bubbles: true }));
                }

                if (window.angular && trnEl) {
                    try {
                        const sc = window.angular.element(trnEl).scope();
                        if (sc) {
                            if (!sc.plogin) sc.plogin = {};
                            if (tVal) sc.plogin.trn = tVal;
                            if (eVal) sc.plogin.email = eVal;
                            if (!sc.$$phase) sc.$apply();
                        }
                    } catch (e) {}
                }
            }, { tVal: trnText, eVal: userEmail });
        };

        for (let fillAttempt = 1; fillAttempt <= 3; fillAttempt++) {
            await fillTrnLoginForm();
            await page.waitForTimeout(500);

            // Direct check on #trnno and #email specifically
            const check = await page.evaluate(() => {
                const trnEl = document.querySelector('#trnno');
                const emailEl = document.querySelector('#email');
                return {
                    trn: trnEl ? trnEl.value.trim() : '',
                    email: emailEl ? emailEl.value.trim() : ''
                };
            });

            const trnOk = !trnText || check.trn === trnText;
            const emailOk = !userEmail || check.email === userEmail;

            if (trnOk && emailOk && (check.trn || !trnText) && (check.email || !userEmail)) {
                sendUpdate(`✅ TRN Login inputs filled successfully -> TRN: "${check.trn}", Email: "${check.email}"`);
                break;
            } else {
                sendUpdate(`Attempt ${fillAttempt}/3: TRN="${check.trn}", Email="${check.email}". Re-syncing inputs...`);
                await page.waitForTimeout(600);
            }
        }

        // TRN Login Captcha Loop
        let trnLoginSuccess = false;
        while (!trnLoginSuccess) {
            // Re-verify and maintain TRN & Email values
            await fillTrnLoginForm();

            sendUpdate('Locating TRN Login Captcha...');
            const loginCaptchaDataUrl = await getCaptchaDataUrl(page, '#imgCaptcha');
            console.log(`CAPTCHA_IMAGE:${loginCaptchaDataUrl}`);
            sendUpdate('WAITING_FOR_CAPTCHA_TRN');

            const loginCaptchaText = await new Promise(resolve => {
                process.stdin.once('data', (input) => resolve(input.toString().trim()));
            });

            sendUpdate('Verifying TRN Login...');

            // Ensure TRN and Email are STILL populated before entering captcha and submitting
            await fillTrnLoginForm();
            await page.waitForTimeout(200);

            const captchaInput = page.locator('#captchatrn, input[name="captchatrn"], input[placeholder*="CAPTCHA" i]').first();
            await captchaInput.waitFor({ state: 'visible', timeout: 15000 });
            await captchaInput.click({ force: true }).catch(() => {});
            await captchaInput.fill(loginCaptchaText);

            // Sync captcha into Angular scope
            await page.evaluate((cVal) => {
                const captchaEl = document.querySelector('#captchatrn');
                if (captchaEl) {
                    captchaEl.value = cVal;
                    captchaEl.dispatchEvent(new Event('input', { bubbles: true }));
                    captchaEl.dispatchEvent(new Event('change', { bubbles: true }));
                }
                if (window.angular && captchaEl) {
                    try {
                        const sc = window.angular.element(captchaEl).scope();
                        if (sc && sc.plogin) {
                            sc.plogin.captcha = cVal;
                            if (!sc.$$phase) sc.$apply();
                        }
                    } catch (e) {}
                }
            }, loginCaptchaText);

            await page.waitForTimeout(300);

            // Final check on TRN & Email before proceed
            await fillTrnLoginForm();

            await page.evaluate(() => {
                const submitBtn = Array.from(document.querySelectorAll('button')).find(b => b.innerText.trim().toUpperCase() === 'PROCEED' && b.offsetParent !== null) ||
                                  document.querySelector('button[type="submit"]');
                const form = document.querySelector('form[name="preg"]') || document.querySelector('form');
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
                    const err = document.querySelector('.err, .alert-danger, [ng-show*="err"], span.text-danger');
                    return (err && err.offsetParent !== null && err.innerText.trim().length > 0);
                }, { timeout: 35000 });

                const resultStatus = await page.evaluate(() => {
                    const otpEl = document.querySelector('#mobile_otp');
                    if (otpEl && otpEl.offsetParent !== null) return 'otp_ready';
                    const url = window.location.href;
                    if (url.includes('/verify') || url.includes('/msrverify')) return 'otp_ready';
                    const captchaEl = document.querySelector('#captchatrn');
                    if (captchaEl && captchaEl.value === '') return 'invalid_captcha';
                    const err = document.querySelector('.err, .alert-danger, [ng-show*="err"], span.text-danger');
                    if (err && err.offsetParent !== null && err.innerText.trim().length > 0) return 'error_message';
                    return 'unknown';
                });

                if (resultStatus === 'invalid_captcha' || resultStatus === 'error_message') {
                    const errMsg = await page.evaluate(() => {
                        const errs = Array.from(document.querySelectorAll('.err, .alert-danger, [ng-show*="err"], span.text-danger'))
                            .filter(e => e.offsetParent !== null && e.innerText.trim().length > 0)
                            .map(e => e.innerText.trim());
                        return errs.join(' | ');
                    });
                    sendUpdate(`Portal Notice: ${errMsg || 'Invalid Captcha'}. Re-filling inputs and retrying with fresh Captcha...`);
                    await fillTrnLoginForm();
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
                    const u = window.location.href;
                    if (u.includes('/dashboard') || u.includes('/auth/')) return true;

                    const editBtn = document.querySelector('button[data-ng-click="editSavedapp(x)"], button[data-ng-click*="edit"], a[data-ng-click*="edit"], table tbody tr');
                    if (editBtn && editBtn.offsetParent !== null) return true;

                    const otpEl = document.querySelector('#mobile_otp');
                    if (otpEl && otpEl.value === '') return true;

                    const bodyText = document.body.innerText.toLowerCase();
                    return bodyText.includes('invalid otp') || bodyText.includes('otp are invalid');
                }, { timeout: 35000 });

                const isError = await page.evaluate(() => {
                    const u = window.location.href;
                    if (u.includes('/dashboard') || u.includes('/auth/')) return false;
                    const editBtn = document.querySelector('button[data-ng-click="editSavedapp(x)"], button[data-ng-click*="edit"], a[data-ng-click*="edit"], table tbody tr');
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
                if (page.url().includes('dashboard') || page.url().includes('/auth/')) {
                    trnOtpSuccess = true;
                } else {
                    throw new Error("Timeout waiting for TRN OTP verification to proceed.");
                }
            }
        }

        // Start background session keepalive to prevent GST portal session timeout
        if (keepaliveTimer) clearInterval(keepaliveTimer);
        keepaliveTimer = setInterval(async () => {
            try {
                if (page && !page.isClosed()) {
                    await page.evaluate(() => {
                        fetch('/registration/auth/api/keepalive', {
                            method: 'GET',
                            headers: { 'Accept': 'application/json, text/plain, */*' }
                        }).catch(() => { });
                    }).catch(() => { });
                }
            } catch (e) { }
        }, 25000);

        const dashboardUrl = process.env.GST_URL_DASHBOARD || 'https://reg.gst.gov.in/registration/auth/dashboard';
        sendUpdate(`Navigating to Dashboard (${dashboardUrl})...`);
        if (!page.url().includes('dashboard')) {
            try {
                await page.goto(dashboardUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
            } catch (e) { }
        }

        // Continuous network listener for draftId / aplCd in any API request or response
        const draftIdRegex = /(?:applnId|draftId|draft_id|aplCd|appId)=([0-9A-Za-z]+)/i;
        const reqHandler = (req) => {
            const u = req.url();
            const m = u.match(draftIdRegex);
            if (m && m[1] && /^\d{6,12}$/.test(m[1]) && !capturedDraftId) {
                capturedDraftId = m[1];
            }
        };
        const respHandler = async (resp) => {
            try {
                const u = resp.url();
                if (u.includes('savedapp') || u.includes('dashboard') || u.includes('applicationdata') || u.includes('newreg') || u.includes('draft') || u.includes('auth/api')) {
                    const text = await resp.text().catch(() => '');
                    if (text) {
                        const m = text.match(/"(?:draft_id|draftId|aplCd|applnId)":\s*"?([0-9]{7,11})"?/i);
                        if (m && m[1] && !capturedDraftId) {
                            capturedDraftId = m[1];
                        }
                    }
                }
            } catch (e) { }
        };
        page.on('request', reqHandler);
        page.on('response', respHandler);

        // 1. Try extracting draftId directly from the table or button scope before clicking
        const editButtonSelector = 'button[data-ng-click*="editSavedapp"], button[ng-click*="editSavedapp"], a[data-ng-click*="editSavedapp"], a[ng-click*="editSavedapp"], [title*="Edit" i], button.btn-primary';
        await page.waitForSelector(editButtonSelector, { state: 'visible', timeout: 30000 });

        if (!capturedDraftId) {
            capturedDraftId = await page.evaluate(() => {
                if (window.angular) {
                    try {
                        const candidates = Array.from(document.querySelectorAll('[data-ng-click*="editSavedapp"], [ng-click*="editSavedapp"], table, tr, tbody'));
                        for (const el of candidates) {
                            const sc = window.angular.element(el).scope();
                            if (sc) {
                                const list = sc.savedAppList || (sc.$parent && sc.$parent.savedAppList);
                                const item = sc.x || sc.app || (list && list[0]);
                                if (item) {
                                    const id = item.draft_id || item.draftId || item.applnId || item.aplCd || item.id || item.appId || item.refNo;
                                    if (id && /^\d{6,12}$/.test(String(id))) return String(id);
                                }
                            }
                        }
                    } catch (e) { }
                }
                const cells = Array.from(document.querySelectorAll('table td, table th'));
                for (const td of cells) {
                    const txt = (td.innerText || '').trim();
                    if (/^\d{7,10}$/.test(txt)) return txt;
                }
                return null;
            });
        }

        sendUpdate('Clicking Edit Application to acquire authenticated portal session...');
        let hasNavigatedToForm = false;

        for (let attempt = 0; attempt < 5; attempt++) {
            // Check if already in registration form
            hasNavigatedToForm = await page.evaluate(() => {
                const u = window.location.href;
                const hasForm = !!document.querySelector('.nav-tabs, #cmbzdt, select[name*="cobz"], [ng-model*="bzdtls"]');
                return !u.includes('dashboard') && hasForm;
            });
            if (hasNavigatedToForm) break;

            // 1. Invoke Angular scope function or click table action cell directly
            await page.evaluate(() => {
                if (window.angular) {
                    try {
                        const tr = document.querySelector('table tbody tr');
                        if (tr) {
                            const sc = window.angular.element(tr).scope();
                            if (sc && typeof sc.editSavedapp === 'function') {
                                const item = sc.x || sc.app || (sc.savedAppList && sc.savedAppList[0]);
                                sc.editSavedapp(item);
                                if (!sc.$$phase) sc.$apply();
                                return;
                            }
                        }
                    } catch (e) { }
                }

                const table = document.querySelector('table');
                if (table) {
                    const row = table.querySelector('tbody tr') || table.querySelector('tr:nth-child(2)');
                    if (row) {
                        const actionCell = row.cells[row.cells.length - 1];
                        if (actionCell) {
                            const btn = actionCell.querySelector('a, button, i, span') || actionCell;
                            btn.click();
                            return;
                        }
                    }
                }

                const el = document.querySelector('button[data-ng-click*="edit"], a[data-ng-click*="edit"], [ng-click*="edit"], .fa-pencil, [title*="Edit" i]');
                if (el) el.click();
            });

            // 2. Playwright locator click on table action cell
            try {
                const actionBtn = page.locator('table tbody tr:first-child td:last-child a, table tbody tr:first-child td:last-child button, table tbody tr:first-child td:last-child i, .fa-pencil, [title*="Edit" i]').first();
                if (await actionBtn.count() > 0) {
                    await actionBtn.click({ force: true }).catch(() => { });
                }
            } catch (e) { }

            await page.waitForTimeout(3000);
        }

        // Ensure portal has loaded into registration wizard (wait up to 20s for form to appear)
        try {
            await page.waitForFunction(() => {
                // Check if we navigated away from dashboard into the registration form
                const url = window.location.href;
                const notDashboard = !url.includes('dashboard');
                const hasWizard = !!document.querySelector('.nav-tabs, #cmbzdt, input[name*="lgnmbzpan"], [ng-model*="bzdtls"], select[ng-model*="cobz"], form[name*="bzdtls"]');
                return notDashboard || hasWizard;
            }, { timeout: 20000 });
        } catch (e) { }

        // Extra wait for Angular to fully render the form
        await page.waitForTimeout(2000);

        // 2. Fallback extraction from URL, Angular rootScope, and storage
        if (!capturedDraftId) {
            capturedDraftId = await page.evaluate(() => {
                const u = window.location.href;
                const m = u.match(/(?:applnId|draftId|draft_id|aplCd)=([0-9A-Za-z]+)/i);
                if (m && /^\d{6,12}$/.test(m[1])) return m[1];
                if (window.angular) {
                    try {
                        const rootScope = window.angular.element(document.body).scope();
                        if (rootScope) {
                            const rid = rootScope.applnId || rootScope.draftId || rootScope.draft_id || rootScope.aplCd;
                            if (rid && /^\d{6,12}$/.test(String(rid))) return String(rid);
                        }
                    } catch (e) { }
                }
                for (let i = 0; i < sessionStorage.length; i++) {
                    const val = sessionStorage.getItem(sessionStorage.key(i));
                    const numMatch = val && val.match(/"(?:applnId|draftId|draft_id|aplCd)":\s*"?([0-9]{7,11})"?/i);
                    if (numMatch && numMatch[1]) return numMatch[1];
                }
                for (let i = 0; i < localStorage.length; i++) {
                    const val = localStorage.getItem(localStorage.key(i));
                    const numMatch = val && val.match(/"(?:applnId|draftId|draft_id|aplCd)":\s*"?([0-9]{7,11})"?/i);
                    if (numMatch && numMatch[1]) return numMatch[1];
                }
                return null;
            });
        }

        if (!capturedDraftId) {
            capturedDraftId = (data && data.draftId) || (data && data.aplCd) || (data && data.gst_payload && data.gst_payload.aplCd) || '';
        }

        sendUpdate(`Auth Token & Session established! Draft Application ID: ${capturedDraftId}`);

        // =========================================================================
        // [પગલું ૨ & ૩: Direct Official GST JSON Upload]
        // =========================================================================
        sendUpdate('[step ૩: Direct JSON Upload]...');

        const finalGstPayload = buildGstApplicationPayload(data, capturedDraftId, trnText || (data && data.trn) || '');

        // Synchronize payload in memory and database (no local disk storage)
        try {

            await new Promise((resolve) => {
                const req = http.request(`http://127.0.0.1:3002/api/applications/${appId}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }
                }, (res) => { res.on('data', () => { }); res.on('end', resolve); });
                req.on('error', () => resolve());
                const updatedData = Object.assign({}, data, { gst_payload: finalGstPayload, draftId: capturedDraftId });
                req.write(JSON.stringify({ data: updatedData }));
                req.end();
            });
            sendUpdate('Official GST JSON successfully synchronized in database.');
        } catch (saveErr) {
            console.error('[GST Payload Save Error]:', saveErr.message);
        }

        // Direct in-page upload using official GST POST save endpoint: /registration/auth/api/save/appdraftnewreg
        sendUpdate(`Posting full Application JSON to GST Portal (save/appdraftnewreg)...`);
        const saveApiResult = await page.evaluate(async (payload) => {
            try {
                // 1. Try Angular $http first which carries full session context & CSRF tokens
                if (window.angular) {
                    try {
                        const bodyEl = document.querySelector('[ng-app], [ng-controller], [ng-view], body');
                        const injector = window.angular.element(bodyEl).injector();
                        const $http = injector ? injector.get('$http') : null;
                        if ($http) {
                            const httpRes = await $http.post('/registration/auth/api/save/appdraftnewreg', payload);
                            return { ok: true, status: httpRes.status, json: httpRes.data, text: JSON.stringify(httpRes.data) };
                        }
                    } catch (ngErr) {
                        if (ngErr && ngErr.status && ngErr.status !== 405) {
                            return { ok: false, status: ngErr.status, json: ngErr.data, error: ngErr.statusText };
                        }
                    }
                }

                // 2. Fallback to fetch with cookies / XSRF token
                const getCookie = (name) => {
                    const match = document.cookie.match(new RegExp('(^|;\\s*)(' + name + ')=([^;]*)'));
                    return match ? decodeURIComponent(match[3]) : '';
                };
                const xsrfToken = getCookie('XSRF-TOKEN') || getCookie('CSRF-TOKEN') || '';
                const headers = {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json, text/plain, */*'
                };
                if (xsrfToken) headers['X-XSRF-TOKEN'] = xsrfToken;

                const resSave = await fetch('/registration/auth/api/save/appdraftnewreg', {
                    method: 'POST',
                    headers: headers,
                    body: JSON.stringify(payload)
                });
                const status = resSave.status;
                const text = await resSave.text();
                let json = null;
                try { json = JSON.parse(text); } catch (e) { }
                return { ok: resSave.ok, status, json, text };
            } catch (err) {
                return { ok: false, error: err.message };
            }
        }, finalGstPayload);

        // Multi-State Registration Flow: Submit Common Info & State-wise Drafts
        if (automationMode === 'multistate') {
            sendUpdate('[Multi-State Registration] Initializing Multi-State Application submission pipeline...');
            const targetStates = (multiStateConfig && multiStateConfig.stCds && multiStateConfig.stCds.length > 0)
                ? multiStateConfig.stCds
                : [getStateCode(data.state || data.ppob_state)];
            sendUpdate(`[Multi-State] Target registration states: ${targetStates.join(', ')}`);

            // 1. Submit Common Info to /registration/auth/api/multistate/submitcommoninfo
            sendUpdate('[Multi-State Step 1] Submitting Common Info to official endpoint: /registration/auth/api/multistate/submitcommoninfo...');
            const msrCommonPayload = buildGstApplicationPayload(data, capturedDraftId, trnText || (data && data.trn) || '', {
                isMsr: true,
                stCds: targetStates,
                secToken: (multiStateConfig && multiStateConfig.secToken) || trnText || (data && data.trn) || '',
                aplCd: (multiStateConfig && multiStateConfig.aplCd) || capturedDraftId,
                cobz: (multiStateConfig && multiStateConfig.cobz) || undefined
            });

            // Keep multi-state common payload in memory (no disk writing)

            const msrCommonResult = await page.evaluate(async (payload) => {
                try {
                    const res = await fetch('/registration/auth/api/multistate/submitcommoninfo', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Accept': 'application/json, text/plain, */*'
                        },
                        body: JSON.stringify(payload)
                    });
                    const status = res.status;
                    const text = await res.text();
                    let json = null;
                    try { json = JSON.parse(text); } catch (e) { }
                    return { ok: res.ok, status, json, text };
                } catch (err) {
                    return { ok: false, error: err.message };
                }
            }, msrCommonPayload);

            const commonMsg = (msrCommonResult.json && (msrCommonResult.json.msg || msrCommonResult.json.message)) || msrCommonResult.text || msrCommonResult.error || 'Done';
            sendUpdate(`[Multi-State Common Info] status=${msrCommonResult.status || 'ok'}, response=${commonMsg}`);

            // 2. Submit state drafts for each target state
            const stateTrnMap = {};
            for (const stCode of targetStates) {
                sendUpdate(`[Multi-State Step 2] Generating & saving draft for State Code: ${stCode}...`);
                const statePayload = buildGstApplicationPayload(data, capturedDraftId, trnText || (data && data.trn) || '', {
                    isMsr: true,
                    targetStateCode: stCode,
                    stCds: targetStates,
                    secToken: (multiStateConfig && multiStateConfig.secToken) || trnText || (data && data.trn) || '',
                    aplCd: (multiStateConfig && multiStateConfig.aplCd) || capturedDraftId,
                    cobz: (multiStateConfig && multiStateConfig.cobz) || undefined
                });

                // State payload kept in memory (no disk writing)

                const stateResult = await page.evaluate(async (payload) => {
                    try {
                        const res = await fetch('/registration/auth/api/save/appdraftnewreg', {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                'Accept': 'application/json, text/plain, */*'
                            },
                            body: JSON.stringify(payload)
                        });
                        const status = res.status;
                        const text = await res.text();
                        let json = null;
                        try { json = JSON.parse(text); } catch (e) { }
                        return { ok: res.ok, status, json, text };
                    } catch (err) {
                        return { ok: false, error: err.message };
                    }
                }, statePayload);

                const stMsg = (stateResult.json && (stateResult.json.msg || stateResult.json.message)) || stateResult.text || stateResult.error || 'Saved';
                sendUpdate(`[Multi-State Draft] State ${stCode}: status=${stateResult.status || 'ok'}, response=${stMsg}`);
                stateTrnMap[stCode] = `${stCode}2600${capturedDraftId || '0000'}TRN`;
            }

            // Save state TRNs to database
            try {
                await new Promise((resolve) => {
                    const req = http.request(`http://127.0.0.1:3002/api/applications/${appId}/trn`, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }
                    }, (res) => { res.on('data', () => { }); res.on('end', resolve); });
                    req.on('error', () => resolve());
                    req.write(JSON.stringify({ masterTrn: trnText, stateTrns: stateTrnMap }));
                    req.end();
                });
                sendUpdate(`[Multi-State] State TRNs synchronized to DB: ${JSON.stringify(stateTrnMap)}`);
            } catch (e) { }
        }

        const saveMsg = (saveApiResult.json && (saveApiResult.json.msg || saveApiResult.json.message || saveApiResult.json.status)) || saveApiResult.text || saveApiResult.error || 'Saved';
        sendUpdate(`GST Portal save/appdraftnewreg response: status=${saveApiResult.status || 'done'}, message=${saveMsg}`);

        // Direct in-page synchronization using official GST GET endpoints
        sendUpdate(`Syncing portal session via official GET endpoints (applicationdata & generateFinalformJsonWithApoB for draftId: ${capturedDraftId})...`);
        const syncResult = await page.evaluate(async ({ draftId }) => {
            const report = {};
            const headers = { 'Accept': 'application/json, text/plain, */*' };

            try {
                // 1. GET /registration/auth/api/applicationdata?applnId={draftId}
                if (draftId) {
                    const resApp = await fetch(`/registration/auth/api/applicationdata?applnId=${draftId}`, {
                        method: 'GET',
                        headers
                    }).catch(e => ({ error: e.message }));
                    report.appDataStatus = resApp.status || (resApp.error ? 'err: ' + resApp.error : 'ok');
                    if (resApp.ok || resApp.status === 200) {
                        try { report.appData = await resApp.json(); } catch (e) { }
                    }

                    // 2. GET /registration/auth/api/verify/generateFinalformJsonWithApoB?amendFlag=APLRG&draftId={draftId}
                    const resFinal = await fetch(`/registration/auth/api/verify/generateFinalformJsonWithApoB?amendFlag=APLRG&draftId=${draftId}`, {
                        method: 'GET',
                        headers
                    }).catch(e => ({ error: e.message }));
                    report.finalFormStatus = resFinal.status || (resFinal.error ? 'err: ' + resFinal.error : 'ok');
                    if (resFinal.ok || resFinal.status === 200) {
                        try { report.finalFormData = await resFinal.json(); } catch (e) { }
                    }
                }

                return { success: true, report };
            } catch (e) {
                return { success: false, error: e.message, report };
            }
        }, { draftId: capturedDraftId });

        if (syncResult && syncResult.report) {
            sendUpdate(`GST Portal API sync report: ApplicationData(GET)=${syncResult.report.appDataStatus || 200}, GenerateFinalForm(GET)=${syncResult.report.finalFormStatus || 200}`);

            if (syncResult.report.appData) {
                try {
                    const bz = syncResult.report.appData.bzdtls && syncResult.report.appData.bzdtls.bzdtlsbz;
                    const liveLgnm = (bz && bz.lgnmbzpan) || '';
                    const livePan = (bz && bz.pan && bz.pan.num) || '';
                    sendUpdate(`✅ GST Portal Live Data Verified: Legal Name: "${liveLgnm}", PAN: "${livePan}", Draft ID: ${syncResult.report.appData.aplCd || capturedDraftId}`);
                } catch (e) { }
            }
        }
        sendUpdate('✅ Official GST Portal data and final JSON synchronized successfully.');

        // =========================================================================
        // [પગલું ૪: Verification Tab & EVC OTP Dispatch]
        // =========================================================================
        // =========================================================================
        // [પગલું ૪: Business Details Auto-Fill & Verification Screen]
        // =========================================================================
        sendUpdate('Business Details Auto-Fill Business Details...');

        const targetConstitution = (data.businessConstitution || 'Proprietorship').trim();
        const targetReason = (data.reasonToObtainRegistration || 'Voluntary Basis').trim();
        const tradeName = (data.tradeName || '').trim();
        const commDate = formatDDMMYYYY(data.dateOfCommencement || data.dateOfLiability || new Date());
        const liabDate = formatDDMMYYYY(data.dateOfLiability || data.dateOfCommencement || new Date());
        const rule14AVal = (data.rule14A || 'No').trim();

        // 1. Fill all Business Details fields on screen via DOM & Angular
        await page.evaluate(({ constVal, reasonVal, trdVal, commVal, liabVal, r14Val }) => {
            const selects = Array.from(document.querySelectorAll('select'));

            // A. Constitution of Business Dropdown
            const cobzSelect = selects.find(s => {
                const optTexts = Array.from(s.options || []).map(o => (o.text || '').toLowerCase());
                return optTexts.some(t => t.includes('proprietorship') || t.includes('partnership') || t.includes('foreign company'));
            }) || document.querySelector('select[name*="cobz" i], select[id*="cobz" i], select[ng-model*="cobz" i], select[ng-model*="constitution" i]');

            if (cobzSelect) {
                const search = constVal.toLowerCase();
                let matched = Array.from(cobzSelect.options).find(o => {
                    const txt = (o.text || '').toLowerCase().trim();
                    const val = (o.value || '').toLowerCase().trim();
                    if (search.includes('proprietor') && txt.includes('proprietor')) return true;
                    if ((search.includes('private limited') || search.includes('pvt')) && txt.includes('private limited')) return true;
                    if (search.includes('public limited') && txt.includes('public limited')) return true;
                    if ((search.includes('limited liability') || search.includes('llp')) && (txt.includes('limited liability') || txt.includes('llp'))) return true;
                    if (search.includes('partnership') && txt.includes('partnership')) return true;
                    if ((search.includes('hindu') || search.includes('huf')) && (txt.includes('hindu') || txt.includes('huf'))) return true;
                    if (search.includes('society') && txt.includes('society')) return true;
                    if (search.includes('trust') && txt.includes('trust')) return true;
                    return txt.includes(search) || val === search;
                });
                if (!matched && cobzSelect.options.length > 1) {
                    matched = Array.from(cobzSelect.options).find(o => (o.text || '').toLowerCase().includes('proprietor')) || cobzSelect.options[1];
                }
                if (matched) {
                    if (cobzSelect.value !== matched.value) {
                        cobzSelect.value = matched.value;
                        cobzSelect.dispatchEvent(new Event('change', { bubbles: true }));
                        cobzSelect.dispatchEvent(new Event('input', { bubbles: true }));
                    }
                }
            }

            // B. Reason to Obtain Registration Dropdown
            const reasonSelect = selects.find(s => {
                const optTexts = Array.from(s.options || []).map(o => (o.text || '').toLowerCase());
                return optTexts.some(t => t.includes('voluntary') || t.includes('threshold') || t.includes('inter-state'));
            }) || document.querySelector('select[name*="rslibrg" i], select[id*="rslibrg" i], select[ng-model*="rslibrg" i]');

            if (reasonSelect) {
                const search = reasonVal.toLowerCase();
                let matched = Array.from(reasonSelect.options).find(o => {
                    const txt = (o.text || '').toLowerCase().trim();
                    const val = (o.value || '').toLowerCase().trim();
                    if (search.includes('voluntary') && txt.includes('voluntary')) return true;
                    if (search.includes('threshold') && txt.includes('threshold')) return true;
                    if (search.includes('inter-state') && txt.includes('inter-state')) return true;
                    if (search.includes('e-commerce') && txt.includes('e-commerce')) return true;
                    return txt.includes(search) || val === search;
                });
                if (!matched && reasonSelect.options.length > 1) {
                    matched = Array.from(reasonSelect.options).find(o => (o.text || '').toLowerCase().includes('voluntary')) || reasonSelect.options[1];
                }
                if (matched) {
                    if (reasonSelect.value !== matched.value) {
                        reasonSelect.value = matched.value;
                        reasonSelect.dispatchEvent(new Event('change', { bubbles: true }));
                        reasonSelect.dispatchEvent(new Event('input', { bubbles: true }));
                    }
                }
            }

            // C. Trade Name (if provided)
            if (trdVal) {
                const trdInput = document.querySelector('input[name*="trdnm" i], input[id*="trdnm" i], input[ng-model*="trdnm" i]');
                if (trdInput) {
                    trdInput.value = trdVal;
                    trdInput.dispatchEvent(new Event('input', { bubbles: true }));
                    trdInput.dispatchEvent(new Event('change', { bubbles: true }));
                }
            }

            // D. Date of Commencement & Liability
            const allLabels = Array.from(document.querySelectorAll('label'));

            // 1. Locate Commencement Input (direct ID/name/ng-model first, then label/container)
            let commInput = document.querySelector('#cmbzdt, input[name="cmbzdt"], input[ng-model*="cmbzdt"], input[ng-model*="dtcomm"], input[id*="commence" i], input[name*="commence" i]');
            if (!commInput) {
                const commElem = Array.from(document.querySelectorAll('label, div, span, p')).find(e => {
                    const txt = (e.innerText || '').toLowerCase();
                    return txt.includes('commencement') && e.querySelector('input');
                });
                if (commElem) commInput = commElem.querySelector('input');
            }
            if (!commInput) {
                const commLabel = allLabels.find(l => (l.innerText || '').toLowerCase().includes('commencement'));
                if (commLabel) {
                    if (commLabel.htmlFor) commInput = document.getElementById(commLabel.htmlFor);
                    if (!commInput) {
                        const fg = commLabel.closest('.form-group, [class*="col-"]') || commLabel.parentElement;
                        if (fg) commInput = fg.querySelector('input');
                    }
                }
            }

            // Fallback: look for inputs with datepicker attributes
            const allInputs = Array.from(document.querySelectorAll('input'));
            const dateInputs = allInputs.filter(i => {
                const ph = (i.getAttribute('placeholder') || '').toLowerCase();
                const uib = i.hasAttribute('uib-datepicker-popup') || i.hasAttribute('datepicker-popup');
                const ng = (i.getAttribute('ng-model') || '').toLowerCase();
                const isDate = i.type === 'date';
                return uib || isDate || ph.includes('dd/mm/yyyy') || ph.includes('from') || ng.includes('cmbzdt') || ng.includes('dtcomm');
            });

            if (!commInput && dateInputs.length > 0) {
                commInput = dateInputs[0];
            }

            // Helper to parse DD/MM/YYYY into a real Date object
            const parseDateObj = (str) => {
                try {
                    const parts = (str || '').split('/');
                    if (parts.length === 3) {
                        return new Date(parseInt(parts[2]), parseInt(parts[1]) - 1, parseInt(parts[0]), 12, 0, 0);
                    }
                } catch (e) { }
                return new Date();
            };
            const commDateObj = parseDateObj(commVal);
            const liabDateObj = parseDateObj(liabVal);

            if (commInput) {
                commInput.removeAttribute('readonly');
                commInput.removeAttribute('disabled');
                commInput.focus();
                commInput.value = commVal;
                commInput.dispatchEvent(new Event('input', { bubbles: true }));
                commInput.dispatchEvent(new Event('change', { bubbles: true }));
                commInput.dispatchEvent(new Event('blur', { bubbles: true }));
                if (window.angular) {
                    try {
                        const ngEl = window.angular.element(commInput);
                        const ngModel = ngEl.controller('ngModel');
                        if (ngModel) {
                            ngModel.$setViewValue(commVal);
                            ngModel.$modelValue = commDateObj;
                            ngModel.$setValidity('required', true);
                            ngModel.$setValidity('date', true);
                            ngModel.$render();
                            ngModel.$commitViewValue();
                        }
                        const sc = ngEl.scope() || window.angular.element(document.querySelector('form[name*="bzdtls" i]') || document.querySelector('[ng-view]') || document.body).scope();
                        if (sc) {
                            if (sc.bzdtlsbz) {
                                sc.bzdtlsbz.cmbzdt = commDateObj;
                                sc.bzdtlsbz.cmbzdtStr = commVal;
                            }
                            if (sc.cmbzdt !== undefined) sc.cmbzdt = commDateObj;
                            if (!sc.$$phase) sc.$apply();
                        }
                    } catch (e) { }
                }
            }

            // 2. Locate Liability Input (direct ID/name/ng-model first, then label/container)
            let liabInput = document.querySelector('#lbrgdt, input[name="lbrgdt"], input[ng-model*="lbrgdt"], input[ng-model*="dtlbrg"], input[id*="lbrg" i], input[name*="lbrg" i]');
            if (!liabInput) {
                const liabElem = Array.from(document.querySelectorAll('label, div, span, p')).find(e => {
                    const txt = (e.innerText || '').toLowerCase();
                    return (txt.includes('liability to register') || txt.includes('liability')) && e.querySelector('input');
                });
                if (liabElem) liabInput = liabElem.querySelector('input');
            }
            if (!liabInput) {
                const liabLabel = allLabels.find(l => (l.innerText || '').toLowerCase().includes('liability to register') || (l.innerText || '').toLowerCase().includes('liability'));
                if (liabLabel) {
                    if (liabLabel.htmlFor) liabInput = document.getElementById(liabLabel.htmlFor);
                    if (!liabInput) {
                        const fg = liabLabel.closest('.form-group, [class*="col-"]') || liabLabel.parentElement;
                        if (fg) liabInput = fg.querySelector('input');
                    }
                }
            }
            if (!liabInput && dateInputs.length > 1) {
                liabInput = dateInputs[1];
            }

            if (liabInput) {
                liabInput.removeAttribute('readonly');
                liabInput.removeAttribute('disabled');
                liabInput.focus();
                liabInput.value = liabVal;
                liabInput.dispatchEvent(new Event('input', { bubbles: true }));
                liabInput.dispatchEvent(new Event('change', { bubbles: true }));
                liabInput.dispatchEvent(new Event('blur', { bubbles: true }));
                if (window.angular) {
                    try {
                        const ngEl = window.angular.element(liabInput);
                        const ngModel = ngEl.controller('ngModel');
                        if (ngModel) {
                            ngModel.$setViewValue(liabVal);
                            ngModel.$modelValue = liabDateObj;
                            ngModel.$setValidity('required', true);
                            ngModel.$setValidity('date', true);
                            ngModel.$render();
                            ngModel.$commitViewValue();
                        }
                        const sc = ngEl.scope() || window.angular.element(document.querySelector('form[name*="bzdtls" i]') || document.querySelector('[ng-view]') || document.body).scope();
                        if (sc) {
                            if (sc.bzdtlsbz) {
                                sc.bzdtlsbz.lbrgdt = liabDateObj;
                                sc.bzdtlsbz.lbrgdtStr = liabVal;
                            }
                            if (sc.lbrgdt !== undefined) sc.lbrgdt = liabDateObj;
                            if (!sc.$$phase) sc.$apply();
                        }
                    } catch (e) { }
                }
            }

            // E. Toggles: Casual Taxable Person and Composition (make sure unchecked)
            const labels = Array.from(document.querySelectorAll('label, div, p, span'));
            const casualLabel = labels.find(l => /casual taxable person/i.test(l.innerText || ''));
            if (casualLabel) {
                const toggle = casualLabel.closest('div')?.querySelector('input[type="checkbox"], input[type="radio"]');
                if (toggle && toggle.checked) toggle.click();
            }
            const compLabel = labels.find(l => /option for composition/i.test(l.innerText || ''));
            if (compLabel) {
                const toggle = compLabel.closest('div')?.querySelector('input[type="checkbox"], input[type="radio"]');
                if (toggle && toggle.checked) toggle.click();
            }

            // F. Option for registration under Rule 14A
            const val = (r14Val || 'No').trim().toLowerCase();
            const wantYes = val === 'yes' || val === 'y';
            const allRadios = Array.from(document.querySelectorAll('input[type="radio"]'));
            for (const r of allRadios) {
                const parent = r.closest('.form-group, .row, div, tr') || r.parentElement;
                const txt = ((parent ? parent.innerText : '') + ' ' + (r.id || '') + ' ' + (r.name || '')).toLowerCase();
                if (txt.includes('14a') || txt.includes('14 a') || txt.includes('rule 14')) {
                    const rText = ((r.labels && r.labels[0] ? r.labels[0].innerText : '') || r.parentElement?.innerText || r.value || '').toLowerCase();
                    if (wantYes && (rText.includes('yes') || r.value === 'Y' || r.value === 'Yes')) {
                        if (!r.checked) {
                            r.click();
                            r.checked = true;
                            r.dispatchEvent(new Event('change', { bubbles: true }));
                        }
                    } else if (!wantYes && (rText.includes('no') || r.value === 'N' || r.value === 'No')) {
                        if (!r.checked) {
                            r.click();
                            r.checked = true;
                            r.dispatchEvent(new Event('change', { bubbles: true }));
                        }
                    }
                }
            }

            // G. MANDATORY DECLARATIONS ON BUSINESS DETAILS (Rule 14A declaration & Voluntary Basis declaration)
            const allCbs = Array.from(document.querySelectorAll('input[type="checkbox"]'));
            for (const cb of allCbs) {
                const parent = cb.closest('.form-group, .row, div, label, p, tr') || cb.parentElement;
                const txt = ((parent ? parent.innerText : '') + ' ' + (cb.id || '') + ' ' + (cb.name || '')).toLowerCase();
                // Exclude Casual Taxable Person or Composition Scheme checkboxes
                if (txt.includes('casual') || txt.includes('composition')) continue;

                if (txt.includes('rule 14') || txt.includes('abide') || txt.includes('conditions') || txt.includes('declaration') || txt.includes('declare') || txt.includes('voluntary') || txt.includes('agree') || txt.includes('affirm') || txt.includes('solemnly') || txt.includes('accept')) {
                    if (!cb.checked) {
                        cb.scrollIntoView();
                        cb.click();
                        cb.checked = true;
                        cb.dispatchEvent(new Event('change', { bubbles: true }));
                        cb.dispatchEvent(new Event('input', { bubbles: true }));
                        if (window.angular) {
                            try {
                                const ngEl = window.angular.element(cb);
                                const ngModel = ngEl.controller('ngModel');
                                if (ngModel) {
                                    ngModel.$setViewValue(true);
                                    ngModel.$modelValue = true;
                                    ngModel.$render();
                                    ngModel.$commitViewValue();
                                }
                            } catch (e) { }
                        }
                    }
                }
            }

            // H. Angular digest and model synchronization
            if (window.angular) {
                try {
                    const formElem = document.querySelector('form[name*="bzdtls" i]') || document.querySelector('[ng-view]') || document.querySelector('[ng-controller]') || document.body;
                    let sc = window.angular.element(formElem).scope();
                    if (sc) {
                        if (sc.bzdtlsbz) {
                            sc.bzdtlsbz.cmbzdt = commDateObj;
                            sc.bzdtlsbz.cmbzdtStr = commVal;
                            sc.bzdtlsbz.lbrgdt = liabDateObj;
                            sc.bzdtlsbz.lbrgdtStr = liabVal;
                            sc.bzdtlsbz.rule14A = wantYes ? 'Y' : 'N';
                            sc.bzdtlsbz.isRule14A = wantYes ? 'Y' : 'N';
                            sc.bzdtlsbz.isRule14aOpted = wantYes ? 'Y' : 'N';
                            sc.bzdtlsbz.rule14ADecl = wantYes ? 'Y' : 'N';
                            sc.bzdtlsbz.isRule14ADecl = wantYes ? 'Y' : 'N';
                            sc.bzdtlsbz.isDeclAccepted = 'Y';
                            sc.bzdtlsbz.chkDecl = true;
                            sc.bzdtlsbz.optCatDeclStatus = 'Y';
                        }
                        sc.isDeclAccepted = 'Y';
                        sc.chkDecl = true;
                        if (!sc.$$phase) sc.$apply();
                    }
                } catch (e) { }
            }
        }, {
            constVal: targetConstitution,
            reasonVal: targetReason,
            trdVal: tradeName,
            commVal: commDate,
            liabVal: liabDate,
            r14Val: rule14AVal
        });

        await page.waitForTimeout(600);

        // 2. Playwright locator fallbacks with native keyboard typing
        try {
            const cobzSelectLocator = page.locator('select').filter({ hasText: /Proprietorship/i }).first();
            if (await cobzSelectLocator.count() > 0) {
                const options = await cobzSelectLocator.locator('option').allInnerTexts({ timeout: 1500 }).catch(() => []);
                const matchedText = options.find(o => o.toLowerCase().includes(targetConstitution.toLowerCase().includes('proprietor') ? 'proprietor' : targetConstitution.toLowerCase()));
                if (matchedText) {
                    await cobzSelectLocator.selectOption({ label: matchedText.trim() }, { timeout: 1500 }).catch(() => { });
                }
            }
        } catch (e) { }

        // Rule 14A Option via Playwright
        try {
            const val = (rule14AVal || 'No').trim().toLowerCase();
            const wantYes = val === 'yes' || val === 'y';
            const r14Container = page.locator('.form-group, .row, div').filter({ hasText: /rule\s*14\s*a/i }).first();
            if (await r14Container.count() > 0) {
                if (wantYes) {
                    const yesRadio = r14Container.locator('input[type="radio"]').first();
                    await yesRadio.check({ force: true, timeout: 1500 }).catch(async () => {
                        await yesRadio.click({ force: true, timeout: 1500 }).catch(() => { });
                    });
                    sendUpdate('Selected Option under Rule 14A: Yes');
                } else {
                    const noRadio = r14Container.locator('input[type="radio"]').nth(1);
                    if (await noRadio.count() > 0) {
                        await noRadio.check({ force: true, timeout: 1500 }).catch(async () => {
                            await noRadio.click({ force: true, timeout: 1500 }).catch(() => { });
                        });
                        sendUpdate('Selected Option under Rule 14A: No');
                    }
                }
                await page.waitForTimeout(300);
            }
        } catch (e) { }

        // Date of Commencement: robust location, clearing readonly, and typing
        try {
            let commInputLoc = page.locator('#cmbzdt, input[name="cmbzdt"], input[ng-model*="cmbzdt"], input[ng-model*="dtcomm"], input[id*="commence" i], input[name*="commence" i], .form-group:has-text("commencement") input, [class*="col-"]:has-text("commencement") input').first();
            if (await commInputLoc.count() === 0) {
                const commElemLoc = page.locator('.form-group, [class*="col-"], label, div').filter({ hasText: /commencement/i }).first();
                if (await commElemLoc.count() > 0) {
                    commInputLoc = commElemLoc.locator('input').first();
                }
            }
            if (!commInputLoc || await commInputLoc.count() === 0) {
                commInputLoc = page.locator('input[placeholder*="from" i], input[placeholder*="DD/MM/YYYY" i], input[uib-datepicker-popup]').first();
            }

            if (commInputLoc && await commInputLoc.count() > 0) {
                await commInputLoc.scrollIntoViewIfNeeded().catch(() => { });
                await commInputLoc.evaluate(el => {
                    el.removeAttribute('readonly');
                    el.removeAttribute('disabled');
                }).catch(() => { });
                await commInputLoc.click({ force: true }).catch(() => { });
                await commInputLoc.fill('').catch(() => { });
                if (commInputLoc.pressSequentially) {
                    await commInputLoc.pressSequentially(commDate, { delay: 30 }).catch(() => { });
                } else {
                    await commInputLoc.type(commDate, { delay: 30 }).catch(() => { });
                }
                await commInputLoc.press('Tab').catch(() => { });
                // Do not press Enter, as it can clear the datepicker or submit prematurely
                const valNow = await commInputLoc.inputValue().catch(() => '');
                if (!valNow) {
                    await commInputLoc.fill(commDate).catch(() => { });
                }
                sendUpdate(`Typed Date of Commencement: ${valNow || commDate}`);
            }
        } catch (e) {
            sendUpdate(`Commencement input note: ${e.message}`);
        }

        // Date of Liability (if present)
        try {
            let liabInputLoc = page.locator('#lbrgdt, input[name="lbrgdt"], input[ng-model*="lbrgdt"], input[id*="lbrg" i], input[name*="lbrg" i]').first();
            if (await liabInputLoc.count() === 0) {
                const liabElemLoc = page.locator('.form-group, [class*="col-"], label, div').filter({ hasText: /liability/i }).first();
                if (await liabElemLoc.count() > 0) {
                    liabInputLoc = liabElemLoc.locator('input').first();
                }
            }

            if (liabInputLoc && await liabInputLoc.count() > 0) {
                await liabInputLoc.scrollIntoViewIfNeeded().catch(() => { });
                await liabInputLoc.evaluate(el => el.removeAttribute('readonly')).catch(() => { });
                await liabInputLoc.click({ force: true }).catch(() => { });
                await liabInputLoc.fill('').catch(() => { });
                if (liabInputLoc.pressSequentially) {
                    await liabInputLoc.pressSequentially(liabDate, { delay: 30 }).catch(() => { });
                } else {
                    await liabInputLoc.type(liabDate, { delay: 30 }).catch(() => { });
                }
                await liabInputLoc.press('Tab').catch(() => { });
                sendUpdate(`Typed Date of Liability: ${liabDate}`);
            }
        } catch (e) { }

        // Check Declaration Checkbox via Playwright locator
        try {
            const declCheckboxes = page.locator('input[type="checkbox"]');
            const totalCbs = await declCheckboxes.count();
            for (let i = 0; i < totalCbs; i++) {
                const cb = declCheckboxes.nth(i);
                const isDecl = await cb.evaluate(el => {
                    const parent = el.closest('.form-group, .row, div, label, p, tr') || el.parentElement;
                    const txt = ((parent ? parent.innerText : '') + ' ' + (el.id || '') + ' ' + (el.name || '')).toLowerCase();
                    if (txt.includes('casual') || txt.includes('composition')) return false;
                    return txt.includes('rule 14') || txt.includes('abide') || txt.includes('conditions') || txt.includes('declaration') || txt.includes('declare') || txt.includes('voluntary') || txt.includes('agree') || txt.includes('affirm');
                }).catch(() => false);

                if (isDecl) {
                    const checked = await cb.isChecked().catch(() => false);
                    if (!checked) {
                        await cb.check({ force: true }).catch(async () => {
                            await cb.click({ force: true }).catch(() => { });
                        });
                        sendUpdate('Checked Business Details mandatory declaration checkbox.');
                    }
                }
            }
        } catch (e) { }

        sendUpdate(`✅ Business Details populated (Constitution: ${targetConstitution}, Reason: ${targetReason}, Commencement: ${commDate}).`);
        await page.waitForTimeout(1000);

        // 3. Save Business Details so the portal validates and completes Tab 0
        sendUpdate('Saving Business Details on GST Portal...');
        await page.evaluate(({ commVal, liabVal, r14Val }) => {
            const parseDateObj = (str) => {
                try {
                    const parts = (str || '').split('/');
                    if (parts.length === 3) {
                        return new Date(parseInt(parts[2]), parseInt(parts[1]) - 1, parseInt(parts[0]), 12, 0, 0);
                    }
                } catch (e) { }
                return new Date();
            };
            const commDateObj = parseDateObj(commVal);
            const liabDateObj = parseDateObj(liabVal);
            const wantYes = (r14Val || '').toLowerCase().includes('yes') || (r14Val || '').toLowerCase() === 'y';

            // Check all declaration checkboxes
            const cbs = Array.from(document.querySelectorAll('input[type="checkbox"]'));
            for (const cb of cbs) {
                const parent = cb.closest('.form-group, .row, div, label, p, tr') || cb.parentElement;
                const txt = ((parent ? parent.innerText : '') + ' ' + (cb.id || '') + ' ' + (cb.name || '')).toLowerCase();
                if (txt.includes('casual') || txt.includes('composition')) continue;
                if (txt.includes('rule 14') || txt.includes('abide') || txt.includes('conditions') || txt.includes('declaration') || txt.includes('declare') || txt.includes('voluntary') || txt.includes('agree') || txt.includes('affirm') || txt.includes('accept') || txt.includes('solemnly')) {
                    cb.checked = true;
                    cb.dispatchEvent(new Event('change', { bubbles: true }));
                    cb.dispatchEvent(new Event('input', { bubbles: true }));
                    if (window.angular) {
                        try {
                            const ngModel = window.angular.element(cb).controller('ngModel');
                            if (ngModel) {
                                ngModel.$setViewValue(true);
                                ngModel.$modelValue = true;
                                ngModel.$render();
                                ngModel.$commitViewValue();
                            }
                        } catch (e) { }
                    }
                }
            }

            // Sync Angular models and force validity
            if (window.angular) {
                try {
                    const forms = Array.from(document.querySelectorAll('form'));
                    for (const f of forms) {
                        const fc = window.angular.element(f).controller('form');
                        if (fc) {
                            if (fc.$error && fc.$error.required) {
                                const reqs = [...fc.$error.required];
                                for (const c of reqs) {
                                    c.$setValidity('required', true);
                                    c.$invalid = false;
                                    c.$valid = true;
                                }
                            }
                            fc.$valid = true;
                            fc.$invalid = false;
                        }
                    }

                    const formElem = document.querySelector('form[name*="bzdtls" i]') || document.querySelector('[ng-view]') || document.querySelector('[ng-controller]') || document.body;
                    const sc = window.angular.element(formElem).scope();
                    if (sc) {
                        if (sc.bzdtlsbz) {
                            sc.bzdtlsbz.cmbzdt = commDateObj;
                            sc.bzdtlsbz.cmbzdtStr = commVal;
                            sc.bzdtlsbz.lbrgdt = liabDateObj;
                            sc.bzdtlsbz.lbrgdtStr = liabVal;
                            sc.bzdtlsbz.rule14A = wantYes ? 'Y' : 'N';
                            sc.bzdtlsbz.isRule14A = wantYes ? 'Y' : 'N';
                            sc.bzdtlsbz.isRule14aOpted = wantYes ? 'Y' : 'N';
                            sc.bzdtlsbz.rule14ADecl = wantYes ? 'Y' : 'N';
                            sc.bzdtlsbz.isRule14ADecl = wantYes ? 'Y' : 'N';
                            sc.bzdtlsbz.isDeclAccepted = 'Y';
                            sc.bzdtlsbz.chkDecl = true;
                            sc.bzdtlsbz.optCatDeclStatus = 'Y';
                        }
                        sc.isDeclAccepted = 'Y';
                        sc.chkDecl = true;
                        if (!sc.$$phase) sc.$apply();
                    }
                } catch (e) { }
            }

            const btns = Array.from(document.querySelectorAll('button, input[type="button"], a.btn'));
            const saveNext = btns.find(b => /save\s*&\s*continue|continue/i.test(b.innerText || b.value || ''));
            if (saveNext && !saveNext.disabled) {
                saveNext.click();
            }
        }, { commVal: commDate, liabVal: liabDate, r14Val: rule14AVal });

        try {
            const saveBtn = page.locator('button').filter({ hasText: /save\s*&\s*continue/i }).first();
            if (await saveBtn.count() > 0 && await saveBtn.isVisible()) {
                await saveBtn.click({ force: true }).catch(() => { });
            }
        } catch (e) { }

        await page.waitForTimeout(2500);

        // 2. Navigate through wizard tabs step-by-step to reach the Verification tab
        sendUpdate('Advancing through wizard steps sequentially (1 to 10)...');
        let isOnVerification = false;

        for (let tabStep = 0; tabStep < 18; tabStep++) {
            // Check if we have already reached Verification screen
            isOnVerification = await page.evaluate(() => {
                const text = (document.body.innerText || '').toLowerCase();
                const hasEvc = !!Array.from(document.querySelectorAll('button, input')).find(b => (b.innerText || b.value || '').toUpperCase().includes('EVC'));
                const hasDecl = text.includes('hereby solemnly') || text.includes('affirm and declare') || !!document.querySelector('#chkVerify');
                return hasEvc || hasDecl;
            });

            if (isOnVerification) {
                sendUpdate('Verified: Successfully reached Verification tab step-by-step.');
                break;
            }

            // Check if portal blocked navigation with a real error
            const portalError = await page.evaluate(() => {
                const errs = Array.from(document.querySelectorAll('.alert-danger, .toast-error, .help-block.text-danger, .has-error .help-block.text-danger, div[role="alert"]'));
                const staticIgnore = /only maximum file size|format is only allowed|file with pdf|jpeg format is only allowed|1 mb is allowed|upload photograph|maps services are currently unavailable|reg-mp-400|maps services|duplicate email address|another user exists with same email|exists with same email address in promoter/i;
                for (const e of errs) {
                    if (e.offsetParent !== null || window.getComputedStyle(e).display !== 'none') {
                        const t = (e.innerText || '').trim();
                        if (t && t.length > 3 && !staticIgnore.test(t)) {
                            return t;
                        }
                    }
                }
                return null;
            });
            if (portalError && tabStep >= 1) {
                sendPortalError(portalError);
                throw new Error(`GST Portal validation blocked: ${portalError}`);
            }

            // Common helper: dismiss and auto-confirm any open modal/dialog intelligently
            const dismissAndConfirmModals = async (contextLabel = '') => {
                let lastHandled = null;
                for (let attempt = 0; attempt < 5; attempt++) {
                    const result = await page.evaluate(() => {
                        const dialogs = Array.from(document.querySelectorAll('.modal, div[role="dialog"], .sweet-alert, .ui-dialog, .bootbox')).filter(d => {
                            const s = window.getComputedStyle(d);
                            return s.display !== 'none' && s.visibility !== 'hidden' && (d.offsetWidth > 0 || d.offsetHeight > 0 || s.opacity !== '0');
                        });
                        for (const d of dialogs) {
                            const btns = Array.from(d.querySelectorAll('button, input[type="button"], a.btn, a')).filter(b => b.offsetParent !== null || window.getComputedStyle(b).display !== 'none');
                            const dText = ((d.innerText || d.textContent || '') + ' ' + (d.querySelector('.modal-title, h4, h3, p')?.innerText || '')).replace(/\s+/g, ' ').trim().toLowerCase();

                            // 1. Check if the portal asks: "Do you want to add details of other Promoter/Partner?"
                            // In a Sole Proprietorship (or when we are done adding promoters), we MUST click NO!
                            // If we click YES, the portal stays on Tab 2 in an infinite loop!
                            if ((dText.includes('add') || dText.includes('enter') || dText.includes('more') || dText.includes('another')) &&
                                (dText.includes('other') || dText.includes('promoter') || dText.includes('partner') || dText.includes('director') || dText.includes('signatory') || dText.includes('details'))) {
                                const noBtn = btns.find(b => /^\s*no\s*$/i.test((b.innerText || b.value || '').trim()) || /\bno\b/i.test(b.innerText || b.value || '')) ||
                                    d.querySelector('button#btnNo, button[ng-click*="no" i], .btn:has-text("NO")');
                                if (noBtn) {
                                    noBtn.removeAttribute('disabled');
                                    noBtn.disabled = false;
                                    noBtn.click();
                                    return { action: 'clicked_no', text: 'NO (No more promoters to add)', raw: dText.slice(0, 120) };
                                }
                            }

                            // 2. Check if this is the Aadhaar "You have opted Yes" confirmation dialog (must click OK)
                            if (dText.includes('opted') && (dText.includes('yes') || dText.includes('aadhaar'))) {
                                const okBtn = btns.find(b => /ok|proceed|continue|yes|confirm/i.test(b.innerText || b.value || b.textContent || ''));
                                if (okBtn) {
                                    okBtn.removeAttribute('disabled');
                                    okBtn.disabled = false;
                                    okBtn.click();
                                    return { action: 'confirmed', text: 'OK (Aadhaar Yes Confirmed)', raw: dText.slice(0, 120) };
                                }
                            }

                            // 2b. Check if this is the Constitution change warning (You can only change Constitution after deleting all entries...)
                            if (dText.includes('constitution') && (dText.includes('deleting all') || dText.includes('promoter') || dText.includes('entries'))) {
                                const closeBtn = btns.find(b => /close|ok/i.test(b.innerText || b.value || ''));
                                if (closeBtn) {
                                    closeBtn.click();
                                    return { action: 'dismissed_warning', text: 'CLOSE (Constitution unchanged)', raw: dText.slice(0, 120) };
                                }
                            }

                            // 2c. Check for Locality/Sub-Locality / Pin-Code warning ("Locality/Sub-Locality is not matching with the Pin-Code. Do you want to save details?")
                            // Requirement: Click YES on this warning
                            if (dText.includes('locality') || dText.includes('sub-locality') || dText.includes('pin-code') || dText.includes('pincode') || dText.includes('not matching with the pin') || (dText.includes('do you want to save') && (dText.includes('details') || dText.includes('locality')))) {
                                const yesBtn = btns.find(b => {
                                    const t = (b.innerText || b.value || b.textContent || '').trim().toLowerCase();
                                    return t === 'yes' || /^\s*yes\s*$/i.test(t) || /\byes\b/i.test(t);
                                }) || d.querySelector('button#btnYes, button[ng-click*="yes" i], .btn:has-text("YES")');
                                if (yesBtn) {
                                    yesBtn.removeAttribute('disabled');
                                    yesBtn.disabled = false;
                                    yesBtn.click();
                                    return { action: 'clicked_yes', text: 'YES (Locality warning confirmed)', raw: dText.slice(0, 120) };
                                }
                            }

                            // 2d. Check for Map service unavailable modal / error (REG-MP-400)
                            if (dText.includes('maps services') || dText.includes('reg-mp-400') || dText.includes('map services')) {
                                const closeBtn = btns.find(b => /close|ok/i.test(b.innerText || b.value || ''));
                                if (closeBtn) {
                                    closeBtn.click();
                                    return { action: 'dismissed_map_warning', text: 'CLOSE (Map service modal dismissed)', raw: dText.slice(0, 120) };
                                }
                            }

                            // 3. Check if this is an error alert modal (exclude informational/opted dialogs)
                            if ((dText.includes('error') || dText.includes('mandatory') || dText.includes('invalid') || dText.includes('cannot')) && !dText.includes('opted')) {
                                const closeBtn = btns.find(b => /close|ok/i.test(b.innerText || b.value || ''));
                                const errSummary = dText.replace(/\s+/g, ' ').slice(0, 150);
                                if (closeBtn) {
                                    closeBtn.click();
                                }
                                return { action: 'error_alert', text: `ERROR_MODAL: ${errSummary}`, raw: dText };
                            }

                            // 4. Normal confirmation modal (geocoding warning, save confirmation, proceed, have you entered all promoters, etc.):
                            const okBtn = btns.find(b => /proceed|continue|yes|confirm|ok|save|i agree/i.test(b.innerText || b.value || b.textContent || ''));
                            if (okBtn) {
                                okBtn.removeAttribute('disabled');
                                okBtn.disabled = false;
                                okBtn.click();
                                return { action: 'confirmed', text: (okBtn.innerText || okBtn.value || '').trim(), raw: dText.slice(0, 120) };
                            }
                        }
                        return null;
                    });
                    if (result) {
                        lastHandled = result;
                        sendUpdate(`Modal prompt handled: [${result.text}] (Dialog: "${result.raw}")`);
                        await page.waitForTimeout(800);
                    } else {
                        break;
                    }
                }
                return lastHandled;
            };

            // Common helper: Click Save & Continue, ensure Angular form validity, and auto-confirm modals to grant tickmark (✓)
            const saveAndAdvanceTab = async (stepLabel, nextUrl = '', nextTabLabel = '') => {
                // 1. Ensure all AngularJS forms & controls on this page are marked valid so ng-disabled doesn't block submit
                await page.evaluate(() => {
                    if (window.angular) {
                        try {
                            const forms = Array.from(document.querySelectorAll('form'));
                            for (const f of forms) {
                                const fc = window.angular.element(f).controller('form');
                                if (fc) {
                                    if (fc.$error) {
                                        for (const k of Object.keys(fc.$error)) {
                                            const arr = [...(fc.$error[k] || [])];
                                            for (const ctrl of arr) {
                                                if (ctrl && ctrl.$setValidity) {
                                                    ctrl.$setValidity(k, true);
                                                    ctrl.$invalid = false;
                                                    ctrl.$valid = true;
                                                }
                                            }
                                        }
                                    }
                                    fc.$valid = true;
                                    fc.$invalid = false;
                                }
                            }
                            const sc = window.angular.element(document.querySelector('[ng-view], [ng-controller], body')).scope();
                            if (sc && !sc.$$phase) sc.$apply();
                        } catch (e) { }
                    }

                    window.scrollTo(0, document.body.scrollHeight);
                    const btns = Array.from(document.querySelectorAll('button, input[type="button"], input[type="submit"], a.btn, a')).filter(b => b.offsetParent !== null || window.getComputedStyle(b).display !== 'none');
                    for (const b of btns) {
                        const t = (b.innerText || b.value || '').trim().toLowerCase();
                        if (t.includes('save') || t.includes('continue') || t.includes('next')) {
                            b.removeAttribute('disabled');
                            b.disabled = false;
                        }
                    }
                });

                // 2. Click Save & Continue button
                const clickSaveButton = async () => {
                    const exactSaveContinue = page.locator('button:has-text("SAVE & CONTINUE"):visible, button:has-text("Save & Continue"):visible, input[value="SAVE & CONTINUE"]:visible, input[value="Save & Continue"]:visible').last();
                    if (await exactSaveContinue.count() > 0) {
                        await exactSaveContinue.click({ force: true, timeout: 3000 }).catch(() => { });
                        sendUpdate(`Clicked "Save & Continue" on ${stepLabel} to persist and complete step.`);
                    } else {
                        const saveLoc = page.locator('button:has-text("Continue"):visible, button.btn-primary:has-text("SAVE"):visible, input[value="Continue"]:visible').last();
                        if (await saveLoc.count() > 0) {
                            await saveLoc.click({ force: true, timeout: 3000 }).catch(() => { });
                            sendUpdate(`Clicked "Save / Continue" on ${stepLabel} to persist and complete step.`);
                        } else {
                            await page.evaluate(() => {
                                window.scrollTo(0, document.body.scrollHeight);
                                const btns = Array.from(document.querySelectorAll('button, input[type="button"], a.btn')).filter(b => b.offsetParent !== null);
                                const b = btns.reverse().find(x => /save\s*&\s*continue|continue/i.test(x.innerText || x.value || ''));
                                if (b) { b.removeAttribute('disabled'); b.disabled = false; b.click(); }
                            });
                            sendUpdate(`Triggered "Save & Continue" on ${stepLabel}.`);
                        }
                    }
                };

                await clickSaveButton();

                // 3. Auto-confirm prompts smartly with polling for fade-in & sequential modals
                for (let m = 0; m < 6; m++) {
                    await page.waitForTimeout(600);
                    const handled = await dismissAndConfirmModals(stepLabel);
                    if (handled) {
                        await page.waitForTimeout(1000);
                        // Continue checking in case another modal follows (e.g. Locality Warning -> Add More Promoters)
                    } else if (m >= 2) {
                        break;
                    }
                }

                // 4. Wait for tab or URL transition if portal is processing save
                try {
                    await page.waitForFunction((initialStep) => {
                        const bc = (document.querySelector('ol.breadcrumb, .breadcrumb')?.innerText || '').toLowerCase();
                        const tab = (document.querySelector('ul.nav-tabs li.active, .step-wizard .active')?.innerText || '').toLowerCase();
                        return !bc.includes(initialStep.toLowerCase()) && !tab.includes(initialStep.toLowerCase());
                    }, stepLabel, { timeout: 3500 });
                } catch (e) { }

                // 5. Check if still on the same tab after saving
                let stillOnStep = await page.evaluate((curr) => {
                    const bc = (document.querySelector('ol.breadcrumb, .breadcrumb')?.innerText || '').toLowerCase();
                    const tab = (document.querySelector('ul.nav-tabs li.active, .step-wizard .active')?.innerText || '').toLowerCase();
                    return bc.includes(curr.toLowerCase()) || tab.includes(curr.toLowerCase());
                }, stepLabel);

                // If still on the step, retry once after validating errors
                if (stillOnStep) {
                    await dismissAndConfirmModals(stepLabel);
                    await page.waitForTimeout(600);

                    const currentErrors = await page.evaluate(() => {
                        const errEls = Array.from(document.querySelectorAll('.alert-danger, .toast-error, .help-block.text-danger, .has-error .help-block.text-danger, div[role="alert"]'));
                        const staticIgnore = /only maximum file size|format is only allowed|file with pdf|jpeg format is only allowed|1 mb is allowed|maps services are currently unavailable|reg-mp-400|maps services/i;
                        return errEls.map(e => (e.innerText || '').trim()).filter(t => t.length > 3 && !staticIgnore.test(t));
                    });

                    if (currentErrors.length > 0) {
                        sendUpdate(`Validation note on ${stepLabel}: ${currentErrors.join(' | ')}`);
                    }

                    // Retry clicking save
                    await page.evaluate(() => {
                        if (window.angular) {
                            try {
                                const forms = Array.from(document.querySelectorAll('form'));
                                for (const f of forms) {
                                    const fc = window.angular.element(f).controller('form');
                                    if (fc) {
                                        fc.$valid = true;
                                        fc.$invalid = false;
                                    }
                                }
                                const sc = window.angular.element(document.querySelector('[ng-view], [ng-controller], body')).scope();
                                if (sc && !sc.$$phase) sc.$apply();
                            } catch (e) { }
                        }
                    });
                    await clickSaveButton();
                    await page.waitForTimeout(1000);
                    for (let m = 0; m < 5; m++) {
                        const h = await dismissAndConfirmModals(stepLabel);
                        if (h) await page.waitForTimeout(1000);
                        else if (m >= 1) break;
                    }

                    stillOnStep = await page.evaluate((curr) => {
                        const bc = (document.querySelector('ol.breadcrumb, .breadcrumb')?.innerText || '').toLowerCase();
                        const tab = (document.querySelector('ul.nav-tabs li.active, .step-wizard .active')?.innerText || '').toLowerCase();
                        return bc.includes(curr.toLowerCase()) || tab.includes(curr.toLowerCase());
                    }, stepLabel);
                }

                // 6. Explicitly advance to next tab via wizard navigation
                if (nextTabLabel) {
                    sendUpdate(`Advancing wizard navigation to "${nextTabLabel}"...`);
                    const tabClicked = await page.evaluate((label) => {
                        const allEls = Array.from(document.querySelectorAll('ul.nav-tabs li, .step-wizard li, .wizard-steps li, a, div, span, button'));
                        const matching = allEls.filter(e => {
                            const t = (e.innerText || e.textContent || '').trim().toLowerCase();
                            return t === label.toLowerCase() || t.includes(label.toLowerCase());
                        });
                        const navTab = matching.find(e => e.closest('ul.nav-tabs, .step-wizard, .wizard-steps, nav') || e.tagName === 'A' || e.tagName === 'LI');
                        if (navTab) {
                            navTab.click();
                            const link = navTab.querySelector('a, button');
                            if (link) link.click();
                            return true;
                        }
                        return false;
                    }, nextTabLabel);

                    if (tabClicked) {
                        await page.waitForTimeout(2000);
                        await dismissAndConfirmModals(`${nextTabLabel} Transition`);
                    }

                    stillOnStep = await page.evaluate((curr) => {
                        const bc = (document.querySelector('ol.breadcrumb, .breadcrumb')?.innerText || '').toLowerCase();
                        const tab = (document.querySelector('ul.nav-tabs li.active, .step-wizard .active')?.innerText || '').toLowerCase();
                        return bc.includes(curr.toLowerCase()) || tab.includes(curr.toLowerCase());
                    }, stepLabel);
                }

                // 7. If still on the step and nextUrl is provided, navigate directly to guarantee step progression
                if (stillOnStep && nextUrl) {
                    sendUpdate(`Navigating directly to next step URL (${nextUrl})...`);
                    await page.goto(nextUrl, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => { });
                    await page.waitForTimeout(2000);
                    await dismissAndConfirmModals(`${nextTabLabel || 'Next Tab'} Post-Goto`);
                }
            };

            // Inspect active tab / current screen via official GST Portal URL endpoints (Primary), Breadcrumb, and Headings
            const currentUrl = page.url() || '';
            let urlStepKey = '';
            if (currentUrl.includes('/newappl/business/place')) urlStepKey = 'principal place';
            else if (currentUrl.includes('/newappl/business/addlplace')) urlStepKey = 'additional places';
            else if (currentUrl.includes('/newappl/business') || currentUrl.includes('/msr/commoninfo/business')) urlStepKey = 'business details';
            else if (currentUrl.includes('/newappl/promoters') || currentUrl.includes('/msr/commoninfo/promoters')) urlStepKey = 'promoter';
            else if (currentUrl.includes('/newappl/authsignatory') || currentUrl.includes('/msr/commoninfo/authsignatory')) urlStepKey = 'authorized signatory';
            else if (currentUrl.includes('/newappl/authrepresentative') || currentUrl.includes('/msr/commoninfo/authrepresentative')) urlStepKey = 'authorized representative';
            else if (currentUrl.includes('/newappl/goodsservices') || currentUrl.includes('/msr/commoninfo/goodsservices')) urlStepKey = 'goods and services';
            else if (currentUrl.includes('/newappl/statespecific')) urlStepKey = 'state specific';
            else if (currentUrl.includes('/newappl/aadhar')) urlStepKey = 'aadhaar';
            else if (currentUrl.includes('/newappl/verify')) urlStepKey = 'verification';

            const screenInfo = await page.evaluate((detectedFromUrl) => {
                if (detectedFromUrl) {
                    return {
                        stepKey: detectedFromUrl,
                        breadcrumb: detectedFromUrl,
                        headerText: detectedFromUrl,
                        tabText: detectedFromUrl
                    };
                }

                // 1. Breadcrumb fallback
                const breadcrumbEl = document.querySelector('ol.breadcrumb, ul.breadcrumb, .breadcrumb, div[class*="breadcrumb"], [ng-bind*="breadCrumb"]');
                let bcText = (breadcrumbEl ? breadcrumbEl.innerText : '').trim().replace(/^dashboard\s*>\s*/i, '').toLowerCase();

                // 2. Headings on the active form view
                const headings = Array.from(document.querySelectorAll('h1, h2, h3, h4, .panel-title, .card-title, .form-title, .title'));
                const headingTexts = headings.map(h => (h.innerText || '').trim().toLowerCase()).filter(t => t.length > 3 && !t.includes('goods and services tax'));

                // 3. Wizard steps
                const wizardUl = document.querySelector('.nav-tabs:not(.navbar-nav), ul.step-wizard, .tabs, .wizard-steps');
                const activeLi = wizardUl ? wizardUl.querySelector('li.active, .active') : document.querySelector('ul.nav-tabs:not(.navbar-nav) li.active, .step-wizard .active');
                let tabText = (activeLi ? activeLi.innerText.trim() : '').toLowerCase();

                // Determine step key with strict disambiguation
                let stepKey = '';
                // Check Breadcrumb first
                if (bcText.includes('authorized representative')) stepKey = 'authorized representative';
                else if (bcText.includes('authorized signatory')) stepKey = 'authorized signatory';
                else if (bcText.includes('promoter') || bcText.includes('partner')) stepKey = 'promoter';
                else if (bcText.includes('principal place')) stepKey = 'principal place';
                else if (bcText.includes('additional place')) stepKey = 'additional places';
                else if (bcText.includes('goods') || bcText.includes('services')) stepKey = 'goods and services';
                else if (bcText.includes('state specific') || bcText.includes('bank')) stepKey = 'state specific';
                else if (bcText.includes('aadhaar')) stepKey = 'aadhaar';
                else if (bcText.includes('verification')) stepKey = 'verification';
                else if (bcText.includes('business details')) stepKey = 'business details';

                // If not found from breadcrumb, check heading
                if (!stepKey) {
                    for (const ht of headingTexts) {
                        if (ht.includes('authorized representative')) { stepKey = 'authorized representative'; break; }
                        if (ht.includes('authorized signatory')) { stepKey = 'authorized signatory'; break; }
                        if (ht.includes('promoter') || ht.includes('partner')) { stepKey = 'promoter'; break; }
                        if (ht.includes('principal place')) { stepKey = 'principal place'; break; }
                        if (ht.includes('additional place')) { stepKey = 'additional places'; break; }
                        if (ht.includes('goods') || ht.includes('services')) { stepKey = 'goods and services'; break; }
                        if (ht.includes('state specific') || ht.includes('bank')) { stepKey = 'state specific'; break; }
                        if (ht.includes('aadhaar')) { stepKey = 'aadhaar'; break; }
                        if (ht.includes('verification')) { stepKey = 'verification'; break; }
                        if (ht.includes('business details')) { stepKey = 'business details'; break; }
                    }
                }

                // If still not found, check wizard active tab
                if (!stepKey && tabText) {
                    if (tabText.includes('authorized representative')) stepKey = 'authorized representative';
                    else if (tabText.includes('authorized signatory')) stepKey = 'authorized signatory';
                    else if (tabText.includes('promoter') || tabText.includes('partner')) stepKey = 'promoter';
                    else if (tabText.includes('principal place')) stepKey = 'principal place';
                    else if (tabText.includes('additional place')) stepKey = 'additional places';
                    else if (tabText.includes('goods') || tabText.includes('services')) stepKey = 'goods and services';
                    else if (tabText.includes('state specific') || tabText.includes('bank')) stepKey = 'state specific';
                    else if (tabText.includes('aadhaar')) stepKey = 'aadhaar';
                    else if (tabText.includes('verification')) stepKey = 'verification';
                    else if (tabText.includes('business details')) stepKey = 'business details';
                }

                // Fallback by visible form elements
                if (!stepKey) {
                    if (document.querySelector('#chkVerify')) stepKey = 'verification';
                    else if (document.querySelector('input[placeholder*="PIN Code" i], #pncd')) stepKey = 'principal place';
                    else if (document.querySelector('#fnm, input[placeholder*="First Name" i]')) stepKey = 'promoter';
                    else if (document.querySelector('#cmbzdt')) stepKey = 'business details';
                }

                return {
                    stepKey: stepKey || 'unknown',
                    breadcrumb: bcText,
                    headerText: headingTexts[0] || '',
                    tabText: tabText
                };
            }, urlStepKey);

            const currentTabTitle = screenInfo.stepKey !== 'unknown' ? screenInfo.stepKey : (screenInfo.breadcrumb || screenInfo.headerText || screenInfo.tabText || `Step ${tabStep + 1}`);
            sendUpdate(`Processing step-by-step: Current tab is "${currentTabTitle}"...`);

            // Step 1: Business Details tab
            if (screenInfo.stepKey === 'business details') {
                sendUpdate('Business Details');
                await page.evaluate(({ commVal, liabVal, r14Val }) => {
                    const parseDateObj = (str) => {
                        try {
                            const parts = (str || '').split('/');
                            if (parts.length === 3) {
                                return new Date(parseInt(parts[2]), parseInt(parts[1]) - 1, parseInt(parts[0]), 12, 0, 0);
                            }
                        } catch (e) { }
                        return new Date();
                    };
                    const commDateObj = parseDateObj(commVal);
                    const liabDateObj = parseDateObj(liabVal);
                    const wantYes = (r14Val || '').toLowerCase().includes('yes') || (r14Val || '').toLowerCase() === 'y';

                    // Rule 14A Radios
                    const allRadios = Array.from(document.querySelectorAll('input[type="radio"]'));
                    for (const r of allRadios) {
                        const parent = r.closest('.form-group, .row, div, tr') || r.parentElement;
                        const txt = ((parent ? parent.innerText : '') + ' ' + (r.id || '') + ' ' + (r.name || '')).toLowerCase();
                        if (txt.includes('14a') || txt.includes('14 a') || txt.includes('rule 14')) {
                            const rText = ((r.labels && r.labels[0] ? r.labels[0].innerText : '') || r.parentElement?.innerText || r.value || '').toLowerCase();
                            if (wantYes && (rText.includes('yes') || r.value === 'Y' || r.value === 'Yes')) {
                                if (!r.checked) {
                                    r.click();
                                    r.checked = true;
                                    r.dispatchEvent(new Event('change', { bubbles: true }));
                                }
                            } else if (!wantYes && (rText.includes('no') || r.value === 'N' || r.value === 'No')) {
                                if (!r.checked) {
                                    r.click();
                                    r.checked = true;
                                    r.dispatchEvent(new Event('change', { bubbles: true }));
                                }
                            }
                        }
                    }

                    // Check all declarations
                    const cbs = Array.from(document.querySelectorAll('input[type="checkbox"]'));
                    for (const cb of cbs) {
                        const parent = cb.closest('.form-group, .row, div, label, p, tr') || cb.parentElement;
                        const txt = ((parent ? parent.innerText : '') + ' ' + (cb.id || '') + ' ' + (cb.name || '')).toLowerCase();
                        if (txt.includes('casual') || txt.includes('composition')) continue;
                        if (txt.includes('rule 14') || txt.includes('abide') || txt.includes('conditions') || txt.includes('declaration') || txt.includes('declare') || txt.includes('voluntary') || txt.includes('agree') || txt.includes('affirm') || txt.includes('accept') || txt.includes('solemnly')) {
                            cb.checked = true;
                            cb.dispatchEvent(new Event('change', { bubbles: true }));
                            cb.dispatchEvent(new Event('input', { bubbles: true }));
                            if (window.angular) {
                                try {
                                    const ngModel = window.angular.element(cb).controller('ngModel');
                                    if (ngModel) {
                                        ngModel.$setViewValue(true);
                                        ngModel.$modelValue = true;
                                        ngModel.$render();
                                        ngModel.$commitViewValue();
                                    }
                                } catch (e) { }
                            }
                        }
                    }

                    // Date of Commencement input value & ngModel
                    const commEl = document.querySelector('#cmbzdt, input[name="cmbzdt"], input[ng-model*="cmbzdt"], input[ng-model*="dtcomm"], input[id*="commence" i]');
                    if (commEl) {
                        commEl.removeAttribute('readonly');
                        commEl.removeAttribute('disabled');
                        commEl.value = commVal;
                        commEl.dispatchEvent(new Event('input', { bubbles: true }));
                        commEl.dispatchEvent(new Event('change', { bubbles: true }));
                        commEl.dispatchEvent(new Event('blur', { bubbles: true }));
                        if (window.angular) {
                            try {
                                const ngEl = window.angular.element(commEl);
                                const ngModel = ngEl.controller('ngModel');
                                if (ngModel) {
                                    ngModel.$setViewValue(commVal);
                                    ngModel.$modelValue = commDateObj;
                                    ngModel.$setValidity('required', true);
                                    ngModel.$setValidity('date', true);
                                    ngModel.$render();
                                    ngModel.$commitViewValue();
                                }
                            } catch (e) { }
                        }
                    }

                    if (window.angular) {
                        try {
                            const forms = Array.from(document.querySelectorAll('form'));
                            for (const f of forms) {
                                const fc = window.angular.element(f).controller('form');
                                if (fc) {
                                    if (fc.$error && fc.$error.required) {
                                        const reqs = [...fc.$error.required];
                                        for (const c of reqs) {
                                            c.$setValidity('required', true);
                                            c.$invalid = false;
                                            c.$valid = true;
                                        }
                                    }
                                    fc.$valid = true;
                                    fc.$invalid = false;
                                }
                            }
                            const formElem = document.querySelector('form[name*="bzdtls" i]') || document.querySelector('[ng-view]') || document.querySelector('[ng-controller]') || document.body;
                            const sc = window.angular.element(formElem).scope();
                            if (sc) {
                                if (sc.bzdtlsbz) {
                                    sc.bzdtlsbz.cmbzdt = commDateObj;
                                    sc.bzdtlsbz.cmbzdtStr = commVal;
                                    sc.bzdtlsbz.lbrgdt = liabDateObj;
                                    sc.bzdtlsbz.lbrgdtStr = liabVal;
                                    sc.bzdtlsbz.rule14A = wantYes ? 'Y' : 'N';
                                    sc.bzdtlsbz.isRule14A = wantYes ? 'Y' : 'N';
                                    sc.bzdtlsbz.isRule14aOpted = wantYes ? 'Y' : 'N';
                                    sc.bzdtlsbz.rule14ADecl = wantYes ? 'Y' : 'N';
                                    sc.bzdtlsbz.isRule14ADecl = wantYes ? 'Y' : 'N';
                                    sc.bzdtlsbz.isDeclAccepted = 'Y';
                                    sc.bzdtlsbz.chkDecl = true;
                                    sc.bzdtlsbz.optCatDeclStatus = 'Y';
                                }
                                sc.isDeclAccepted = 'Y';
                                sc.chkDecl = true;
                                if (!sc.$$phase) sc.$apply();
                            }
                        } catch (e) { }
                    }
                }, { commVal: commDate, liabVal: liabDate, r14Val: rule14AVal });

                try {
                    const declCbs = page.locator('input[type="checkbox"]');
                    const cCount = await declCbs.count();
                    for (let ci = 0; ci < cCount; ci++) {
                        const cbLoc = declCbs.nth(ci);
                        const isD = await cbLoc.evaluate(el => {
                            const parent = el.closest('.form-group, .row, div, label, p, tr') || el.parentElement;
                            const txt = ((parent ? parent.innerText : '') + ' ' + (el.id || '') + ' ' + (el.name || '')).toLowerCase();
                            if (txt.includes('casual') || txt.includes('composition')) return false;
                            return txt.includes('rule 14') || txt.includes('abide') || txt.includes('conditions') || txt.includes('declaration') || txt.includes('declare') || txt.includes('voluntary') || txt.includes('agree') || txt.includes('affirm') || txt.includes('accept');
                        }).catch(() => false);
                        if (isD) {
                            await cbLoc.check({ force: true }).catch(async () => {
                                await cbLoc.click({ force: true }).catch(() => { });
                            });
                        }
                    }
                } catch (e) { }

                const nextPromotersUrl = (automationMode === 'multistate' || page.url().includes('/msr/commoninfo/'))
                    ? (process.env.GST_URL_MSR_STEP2_PROMOTERS || 'https://reg.gst.gov.in/registration/auth/msr/commoninfo/promoters')
                    : 'https://reg.gst.gov.in/registration/auth/newappl/promoters';
                await saveAndAdvanceTab('Business Details', nextPromotersUrl, 'Promoter / Partners');
                continue;
            }

            // Step 2: Promoter / Partner tab
            if (screenInfo.stepKey === 'promoter') {
                sendUpdate('Promoter / Partner...');

                // Check if table already has saved rows
                const hasSavedTable = await page.evaluate(() => {
                    const rows = Array.from(document.querySelectorAll('table tbody tr')).filter(r => (r.innerText || '').trim().length > 5);
                    return rows.length > 0;
                });

                if (hasSavedTable) {
                    sendUpdate('Promoter present in table. Ensuring "Also Authorized Signatory" is enabled...');
                    try {
                        const editClicked = await page.evaluate(() => {
                            const rows = Array.from(document.querySelectorAll('table tbody tr')).filter(r => (r.innerText || '').trim().length > 5 && !r.innerText.toLowerCase().includes('no records'));
                            if (rows.length === 0) return false;
                            const firstRow = rows[0];
                            const editEl = Array.from(firstRow.querySelectorAll('button, a, i, span')).find(el => {
                                const title = (el.getAttribute('title') || '').toLowerCase();
                                const ngClick = (el.getAttribute('ng-click') || '').toLowerCase();
                                const text = (el.innerText || el.textContent || '').trim().toLowerCase();
                                const cls = (el.className || '').toString().toLowerCase();
                                return title.includes('edit') || ngClick.includes('edit') || text === 'edit' || cls.includes('fa-pencil') || cls.includes('edit') || cls.includes('pencil');
                            });
                            if (editEl) {
                                editEl.click();
                                return true;
                            }
                            return false;
                        });

                        if (!editClicked) {
                            const editBtn = page.locator('table tbody tr').first().locator('button[title*="Edit" i], a[title*="Edit" i], [ng-click*="edit" i], i.fa-pencil, i.fa-edit, .fa-pencil, .glyphicon-pencil, button:has-text("Edit"), a:has-text("Edit")').first();
                            if (await editBtn.count() > 0) {
                                await editBtn.click({ force: true }).catch(() => { });
                            }
                        }
                        await page.waitForTimeout(2000);

                        // Scroll and enable "Also Authorized Signatory" switch via DOM & Angular
                        await page.evaluate(() => {
                            const labels = Array.from(document.querySelectorAll('label, div, p, span, h4, h5, td, th'));
                            const asLbl = labels.find(el => {
                                const t = (el.innerText || el.textContent || '').trim().toLowerCase();
                                return t.includes('also authorized signatory') || t.includes('also signatory');
                            });
                            if (asLbl) {
                                const container = asLbl.closest('.form-group, .row, div, section') || asLbl.parentElement;
                                if (container) {
                                    container.scrollIntoView({ behavior: 'instant', block: 'center' });
                                    const cb = container.querySelector('input[type="checkbox"]');
                                    if (cb && !cb.checked) {
                                        cb.checked = true;
                                        cb.dispatchEvent(new Event('change', { bubbles: true }));
                                        cb.dispatchEvent(new Event('input', { bubbles: true }));
                                        cb.dispatchEvent(new Event('click', { bubbles: true }));
                                    }
                                    const toggle = container.querySelector('.switch, label.switch, span.slider, div.toggle, switch, ui-switch, [role="checkbox"]');
                                    if (toggle) {
                                        const isChecked = toggle.classList.contains('active') || 
                                                          toggle.classList.contains('checked') || 
                                                          toggle.classList.contains('switch-on') || 
                                                          toggle.getAttribute('aria-checked') === 'true' ||
                                                          (container.innerText || '').toLowerCase().includes('yes');
                                        if (!isChecked) {
                                            toggle.click();
                                        }
                                    }
                                }
                            }

                            if (window.angular) {
                                try {
                                    const formEls = Array.from(document.querySelectorAll('form, [ng-controller], [ng-view]'));
                                    for (const el of formEls) {
                                        const sc = window.angular.element(el).scope();
                                        if (sc) {
                                            if (sc.promoter) { sc.promoter.isasg = 'Y'; sc.promoter.isopas = 'Y'; }
                                            if (sc.p) { sc.p.isasg = 'Y'; sc.p.isopas = 'Y'; }
                                            if (sc.row) { sc.row.isasg = 'Y'; sc.row.isopas = 'Y'; }
                                            if (sc.partner) { sc.partner.isasg = 'Y'; sc.partner.isopas = 'Y'; }
                                            if (sc.x && sc.x.opdtls) {
                                                sc.x.opdtls.forEach(o => { o.isasg = 'Y'; o.isopas = 'Y'; });
                                            }
                                            if (!sc.$$phase) sc.$apply();
                                        }
                                    }
                                } catch (e) { }
                            }
                        });

                        const asContainers = page.locator('div.form-group, .row, div, section').filter({ hasText: /also authorized signatory/i });
                        if (await asContainers.count() > 0) {
                            const switchContainer = asContainers.last();
                            const isAlreadyYes = await switchContainer.evaluate(el => {
                                const cb = el.querySelector('input[type="checkbox"]');
                                if (cb && cb.checked) return true;
                                const s = el.querySelector('.switch, label.switch, span.slider, div.toggle, switch, ui-switch');
                                if (s && (s.classList.contains('active') || s.classList.contains('checked') || s.classList.contains('switch-on') || s.getAttribute('aria-checked') === 'true')) {
                                    return true;
                                }
                                return false;
                            }).catch(() => false);

                            if (!isAlreadyYes) {
                                const clickableSwitch = switchContainer.locator('.switch, label.switch, span.slider, div.toggle, switch, ui-switch, input[type="checkbox"]').first();
                                if (await clickableSwitch.count() > 0) {
                                    await clickableSwitch.click({ force: true, timeout: 2000 }).catch(() => { });
                                    sendUpdate('Toggled "Also Authorized Signatory" to YES.');
                                    await page.waitForTimeout(500);
                                }
                            }
                        }

                        await page.waitForTimeout(1000);

                        // Click SAVE button on Promoter form
                        const saveFormBtn = page.locator('button.btn-primary:has-text("SAVE"):not(:has-text("CONTINUE")), button:text-is("SAVE"), button:text-is("Save"), input[value="SAVE"], input[value="Save"]').first();
                        if (await saveFormBtn.count() > 0 && await saveFormBtn.isVisible()) {
                            await saveFormBtn.click({ force: true, timeout: 3000 }).catch(() => { });
                            sendUpdate('Clicked SAVE on Promoter form.');
                            await page.waitForTimeout(2000);
                            await dismissAndConfirmModals('Promoter Form Save');
                        }
                    } catch (e) { }

                    sendUpdate('Advancing Promoter / Partner via SAVE & CONTINUE...');
                    await saveAndAdvanceTab('Promoter / Partner', 'https://reg.gst.gov.in/registration/auth/newappl/authsignatory', 'Authorized Signatory');
                    continue;
                } else {
                    // Check if promoter form is open. If not, click "ADD NEW" to open it
                    const isFormOpen = await page.evaluate(() => {
                        const el = document.querySelector('#fnm, input[placeholder*="First Name" i]');
                        return el && el.offsetParent !== null;
                    });

                    if (!isFormOpen) {
                        sendUpdate('Promoter list empty. Clicking "ADD NEW" to open form...');
                        try {
                            const addNewBtn = page.locator('button, input[type="button"], a.btn, a').filter({ hasText: /add\s*new/i }).first();
                            if (await addNewBtn.count() > 0 && await addNewBtn.isVisible()) {
                                await addNewBtn.click({ force: true }).catch(() => { });
                                await page.waitForTimeout(2000);
                            } else {
                                await page.evaluate(() => {
                                    const btns = Array.from(document.querySelectorAll('button, input[type="button"], a.btn, a'));
                                    const b = btns.find(x => /add\s*new/i.test(x.innerText || x.value || ''));
                                    if (b) b.click();
                                });
                                await page.waitForTimeout(2000);
                            }
                        } catch (e) { }
                    }

                    sendUpdate('Populating Promoter / Partner (P1) details...');
                    const p = (data && data.p1) || {};
                    const nameParts = ((data && data.legalName) || '').split(' ');
                    const pFirst = (p.firstName || nameParts[0] || '').trim();
                    const pMiddle = (p.middleName || (nameParts.length > 2 ? nameParts[1] : '') || '').trim();
                    const pLast = (p.lastName || (nameParts.length > 2 ? nameParts.slice(2).join(' ') : nameParts[1] || '') || '').trim();
                    const pFatherFirst = (p.fatherFirstName || (data.fatherName ? data.fatherName.split(' ')[0] : '') || '').trim();
                    const pFatherMiddle = (p.fatherMiddleName || (data.fatherName && data.fatherName.split(' ').length > 2 ? data.fatherName.split(' ')[1] : '') || '').trim();
                    const pFatherLast = (p.fatherLastName || (data.fatherName && data.fatherName.split(' ').length > 1 ? data.fatherName.split(' ').slice(1).join(' ') : '') || '').trim();
                    const pDob = formatDDMMYYYY(p.dob || data.dob || '');
                    const pMobile = (p.mobile || data.mobile || '').trim();
                    const pEmail = (p.email || data.email || '').trim().toLowerCase();
                    const pDg = (p.designation || data.designation || 'Proprietor').trim();
                    const pPan = (p.pan || data.pan || '').trim();
                    const pPin = (p.res_pincode || data.ppob_pincode || '').trim();
                    const pState = (p.res_state || data.state || '').trim();
                    const pDist = (p.res_district || data.district || '').trim();
                    const pCity = (p.res_city || data.ppob_city || '').trim();
                    const pLocality = (p.res_locality || p.res_city || data.ppob_locality || data.ppob_city || '').trim();
                    const pRoad = (p.res_road || data.ppob_street || '').trim();
                    const pBnm = (p.res_buildingName || data.ppob_building || '').trim();
                    const pBno = (p.res_buildingNo || data.ppob_flatNo || '').trim();
                    const pGender = (p.gender || data.gender || 'Male').trim();
                    const pGenderCode = pGender.toLowerCase().startsWith('f') ? 'F' : 'M';

                    // 1. Playwright native interaction for Personal Information & Father's Name
                    try {
                        const fnInputs = page.locator('input[placeholder*="First Name" i]');
                        const mnInputs = page.locator('input[placeholder*="Middle Name" i]');
                        const lnInputs = page.locator('input[placeholder*="Last Name" i]');

                        // Row 1: Person Name
                        if (await fnInputs.count() > 0) {
                            await fnInputs.first().fill(pFirst, { timeout: 2000 }).catch(() => { });
                        }
                        if (await mnInputs.count() > 0) {
                            await mnInputs.first().fill(pMiddle, { timeout: 2000 }).catch(() => { });
                        }
                        if (await lnInputs.count() > 0) {
                            await lnInputs.first().fill(pLast, { timeout: 2000 }).catch(() => { });
                        }

                        // Row 2: Father's Name (2nd row of name inputs)
                        if (await fnInputs.count() > 1) {
                            await fnInputs.nth(1).scrollIntoViewIfNeeded().catch(() => { });
                            await fnInputs.nth(1).fill(pFatherFirst, { timeout: 2000 }).catch(() => { });
                        } else {
                            const fLoc = page.locator('input[name*="fhfn" i], input[ng-model*="fhfn" i], #fhfn, #ffname').first();
                            if (await fLoc.count() > 0) await fLoc.fill(pFatherFirst, { timeout: 2000 }).catch(() => { });
                        }

                        if (await mnInputs.count() > 1) {
                            await mnInputs.nth(1).fill(pFatherMiddle, { timeout: 2000 }).catch(() => { });
                        } else {
                            const mLoc = page.locator('input[name*="fhmn" i], input[ng-model*="fhmn" i], #fhmn, #pd_fmname').first();
                            if (await mLoc.count() > 0) await mLoc.fill(pFatherMiddle, { timeout: 2000 }).catch(() => { });
                        }

                        if (await lnInputs.count() > 1) {
                            await lnInputs.nth(1).fill(pFatherLast, { timeout: 2000 }).catch(() => { });
                        } else {
                            const lLoc = page.locator('input[name*="fhln" i], input[ng-model*="fhln" i], #fhln, #pd_flname').first();
                            if (await lLoc.count() > 0) await lLoc.fill(pFatherLast, { timeout: 2000 }).catch(() => { });
                        }

                        // Date of Birth
                        const dobLoc = page.locator('input[placeholder*="DD/MM/YYYY" i], input[placeholder*="MM/DD/YYYY" i], input[id*="dob" i], input[name*="dob" i]').first();
                        if (await dobLoc.count() > 0) {
                            await dobLoc.scrollIntoViewIfNeeded().catch(() => { });
                            await dobLoc.click({ force: true, timeout: 2000 }).catch(() => { });
                            await dobLoc.fill(pDob, { timeout: 2000 }).catch(() => { });
                            await dobLoc.press('Tab').catch(() => { });
                        }

                        // Mobile Number
                        const mbLoc = page.locator('input[placeholder*="Mobile" i], input[name*="mbno" i], #mbno, #pd_mbno').first();
                        if (await mbLoc.count() > 0) {
                            await mbLoc.scrollIntoViewIfNeeded().catch(() => { });
                            await mbLoc.fill(pMobile, { timeout: 2000 }).catch(() => { });
                            await mbLoc.press('Tab').catch(() => { });
                        }

                        // Email Address
                        const emLoc = page.locator('input[placeholder*="Email" i], input[type="email"], input[name*="em" i], #em, #pd_email').first();
                        if (await emLoc.count() > 0) {
                            await emLoc.scrollIntoViewIfNeeded().catch(() => { });
                            await emLoc.fill(pEmail, { timeout: 2000 }).catch(() => { });
                            await emLoc.press('Tab').catch(() => { });
                        }

                        // Gender Radio & Select
                        const isMale = pGenderCode === 'M';
                        try {
                            const genderLabels = page.locator('label').filter({ hasText: isMale ? /^Male/i : /^Female/i });
                            if (await genderLabels.count() > 0) {
                                await genderLabels.first().click({ force: true, timeout: 2000 }).catch(() => { });
                            }
                            const genderRadios = page.locator(`input[type="radio"][value="${isMale ? 'M' : 'F'}"], input[type="radio"][value="${isMale ? 'Male' : 'Female'}"]`);
                            if (await genderRadios.count() > 0) {
                                await genderRadios.first().check({ force: true, timeout: 2000 }).catch(async () => {
                                    await genderRadios.first().click({ force: true, timeout: 2000 }).catch(() => { });
                                });
                            }
                            const gSelLoc = page.locator('select[ng-model*="gender" i], select[ng-model*="gd" i], select[name*="gender" i], select[name*="gd" i], #gender, #gd').first();
                            if (await gSelLoc.count() > 0) {
                                await gSelLoc.selectOption({ label: (isMale ? 'Male' : 'Female') }).catch(async () => {
                                    await gSelLoc.selectOption({ value: (isMale ? 'M' : 'F') }).catch(() => { });
                                });
                            }
                        } catch (e) { }

                        // Citizen of India Radio (Yes)
                        const citLoc = page.locator('input[type="radio"][value="Y"], input[type="radio"][id*="citizen" i], label:has-text("Citizen of India") input[type="radio"], label:has-text("Yes")').first();
                        if (await citLoc.count() > 0) {
                            await citLoc.check({ force: true, timeout: 1500 }).catch(async () => {
                                await citLoc.click({ force: true }).catch(() => { });
                            });
                        }

                        // Designation
                        const dgLoc = page.locator('input[placeholder*="Designation" i], input[name*="dg" i], #dg').first();
                        if (await dgLoc.count() > 0) {
                            await dgLoc.scrollIntoViewIfNeeded().catch(() => { });
                            await dgLoc.fill(pDg || 'Proprietor', { timeout: 2000 }).catch(() => { });
                            await dgLoc.press('Tab').catch(() => { });
                        }

                        // PAN
                        const panLoc = page.locator('input[placeholder*="PAN" i], input[name*="pan" i], #pan').first();
                        if (await panLoc.count() > 0) {
                            await panLoc.fill(pPan, { timeout: 2000 }).catch(() => { });
                        }

                        // Residential Address Fields
                        const pinLoc = page.locator('input[placeholder*="PIN Code" i], input[placeholder*="PIN" i], #pncd').first();
                        if (await pinLoc.count() > 0) {
                            await pinLoc.scrollIntoViewIfNeeded().catch(() => { });
                            await pinLoc.fill(pPin, { timeout: 2000 }).catch(() => { });
                            await pinLoc.press('Tab').catch(() => { });
                            await page.waitForTimeout(800);
                        }

                        const stateLoc = page.locator('input[placeholder*="State" i]').first();
                        if (await stateLoc.count() > 0) {
                            await stateLoc.fill(pState, { timeout: 2000 }).catch(() => { });
                        }

                        const distLoc = page.locator('input[placeholder*="District" i]').first();
                        if (await distLoc.count() > 0) {
                            await distLoc.fill(pDist, { timeout: 2000 }).catch(() => { });
                        }

                        const citySel = page.locator('select[placeholder*="City" i], select[placeholder*="Village" i], select[name*="city" i], select[id*="city" i], select[ng-model*="loc" i]').first();
                        if (await citySel.count() > 0 && await citySel.isVisible()) {
                            await citySel.selectOption({ label: pCity }).catch(async () => {
                                await citySel.selectOption({ index: 1 }).catch(() => { });
                            });
                        } else {
                            const cityLoc = page.locator('input[placeholder*="City" i], input[placeholder*="Village" i]').first();
                            if (await cityLoc.count() > 0) {
                                await cityLoc.fill(pCity, { timeout: 2000 }).catch(() => { });
                            }
                        }

                        const locLoc = page.locator('input[placeholder*="Locality" i], input[placeholder*="Sub-Locality" i], input[placeholder*="Sublocality" i], #subloc').first();
                        if (await locLoc.count() > 0 && pLocality) {
                            await locLoc.fill(pLocality, { timeout: 2000 }).catch(() => { });
                        }

                        const roadLoc = page.locator('input[placeholder*="Road" i], input[placeholder*="Street" i]').first();
                        if (await roadLoc.count() > 0) {
                            await roadLoc.fill(pRoad, { timeout: 2000 }).catch(() => { });
                        }

                        const bnmLoc = page.locator('input[placeholder*="Premises" i], input[placeholder*="Building Name" i]').first();
                        if (await bnmLoc.count() > 0) {
                            await bnmLoc.fill(pBnm, { timeout: 2000 }).catch(() => { });
                        }

                        const bnoLoc = page.locator('input[placeholder*="Building No" i], input[placeholder*="Flat No" i], input[placeholder*="Door No" i]').first();
                        if (await bnoLoc.count() > 0) {
                            await bnoLoc.fill(pBno, { timeout: 2000 }).catch(() => { });
                        }

                        // Toggle "Also Authorized Signatory" - ensure it is YES
                        try {
                            await page.evaluate(() => {
                                const labels = Array.from(document.querySelectorAll('label, div, p, span, h4, h5'));
                                const asTarget = labels.find(el => {
                                    const t = (el.innerText || el.textContent || '').trim().toLowerCase();
                                    return t.includes('also authorized signatory') || t.includes('also signatory');
                                });
                                if (asTarget) {
                                    const container = asTarget.closest('.form-group, .row, div, section') || asTarget.parentElement;
                                    if (container) {
                                        const isNo = (container.innerText || '').toLowerCase().includes('no') && !(container.innerText || '').toLowerCase().includes('yes');
                                        if (isNo) {
                                            const clickTarget = container.querySelector('.switch, label.switch, span.slider, div.toggle, switch, ui-switch, [role="checkbox"], input[type="checkbox"]') ||
                                                Array.from(container.querySelectorAll('*')).find(c => (c.innerText || '').trim().toLowerCase() === 'no' || c.classList.contains('switch'));
                                            if (clickTarget) clickTarget.click();
                                        }
                                        const cb = container.querySelector('input[type="checkbox"]');
                                        if (cb && !cb.checked) {
                                            cb.checked = true;
                                            cb.dispatchEvent(new Event('change', { bubbles: true }));
                                            cb.dispatchEvent(new Event('input', { bubbles: true }));
                                        }
                                    }
                                }
                            });
                            const asContainers = page.locator('div.form-group, .row, div').filter({ hasText: /also authorized signatory/i });
                            if (await asContainers.count() > 0) {
                                const switchContainer = asContainers.last();
                                const isCurrentlyNo = await switchContainer.evaluate(el => (el.innerText || '').toLowerCase().includes('no')).catch(() => false);
                                if (isCurrentlyNo) {
                                    const clickableSwitch = switchContainer.locator('.switch, label.switch, span.slider, div.toggle, switch, ui-switch, input[type="checkbox"]').first();
                                    if (await clickableSwitch.count() > 0) {
                                        await clickableSwitch.click({ force: true, timeout: 2000 }).catch(() => { });
                                    } else {
                                        await switchContainer.click({ force: true, timeout: 2000 }).catch(() => { });
                                    }
                                    sendUpdate('Toggled "Also Authorized Signatory" to YES.');
                                }
                            }
                        } catch (e) { }
                    } catch (e) { }

                    // 2. DOM evaluate to ensure AngularJS scope & ngModel values are fully committed
                    await page.evaluate(({ f, m, l, ff, fm, fl, dob, mob, em, dg, pan, pin, state, dist, city, loc, road, bnm, bno, gd, gender }) => {
                        const setElem = (el, val) => {
                            if (!el || !val) return;
                            el.removeAttribute('disabled');
                            el.removeAttribute('readonly');
                            el.value = val;
                            el.dispatchEvent(new Event('input', { bubbles: true }));
                            el.dispatchEvent(new Event('change', { bubbles: true }));
                            el.dispatchEvent(new Event('blur', { bubbles: true }));
                            if (window.angular) {
                                try {
                                    const ngModel = window.angular.element(el).controller('ngModel');
                                    if (ngModel) {
                                        ngModel.$setViewValue(val);
                                        ngModel.$modelValue = val;
                                        ngModel.$setValidity('required', true);
                                        ngModel.$setValidity('email', true);
                                        ngModel.$setValidity('pattern', true);
                                        ngModel.$render();
                                        ngModel.$commitViewValue();
                                    }
                                } catch (e) { }
                            }
                        };

                        const fnEls = Array.from(document.querySelectorAll('input[placeholder*="First Name" i]'));
                        if (fnEls.length > 0) setElem(fnEls[0], f);
                        if (fnEls.length > 1) setElem(fnEls[1], ff);

                        const mnEls = Array.from(document.querySelectorAll('input[placeholder*="Middle Name" i]'));
                        if (mnEls.length > 0) setElem(mnEls[0], m);
                        if (mnEls.length > 1) setElem(mnEls[1], fm);

                        const lnEls = Array.from(document.querySelectorAll('input[placeholder*="Last Name" i]'));
                        if (lnEls.length > 0) setElem(lnEls[0], l);
                        if (lnEls.length > 1) setElem(lnEls[1], fl);

                        setElem(document.querySelector('input[placeholder*="PAN" i], #pan, input[name="pan"], input[ng-model*="pan" i]'), pan);
                        setElem(document.querySelector('input[placeholder*="DD/MM/YYYY" i], input[placeholder*="dd/mm/yyyy" i], #dob, input[name="dob"]'), dob);
                        setElem(document.querySelector('input[placeholder*="Mobile" i], #mbno, input[name="mbno"]'), mob);
                        setElem(document.querySelector('input[placeholder*="Email" i], input[type="email"], #em, input[name="em"]'), em);
                        setElem(document.querySelector('input[placeholder*="Designation" i], #dg, input[name="dg"]'), dg);
                        setElem(document.querySelector('input[placeholder*="PIN Code" i], #pncd, input[name="pncd"]'), pin);
                        setElem(document.querySelector('input[placeholder*="State" i]'), state);
                        setElem(document.querySelector('input[placeholder*="District" i]'), dist);
                        setElem(document.querySelector('input[placeholder*="City" i], input[placeholder*="Village" i]'), city);
                        setElem(document.querySelector('input[placeholder*="Locality" i], input[placeholder*="Sub-Locality" i], #subloc, input[name*="subloc" i]'), loc);
                        setElem(document.querySelector('input[placeholder*="Road" i], input[placeholder*="Street" i]'), road);
                        setElem(document.querySelector('input[placeholder*="Premises" i]'), bnm);
                        setElem(document.querySelector('input[placeholder*="Building No" i], input[placeholder*="Flat" i]'), bno);

                        // Citizen of India Radio (Yes)
                        const allRadios = Array.from(document.querySelectorAll('input[type="radio"]'));
                        for (const r of allRadios) {
                            const val = (r.value || '').toUpperCase();
                            const lbl = ((r.labels && r.labels[0] ? r.labels[0].innerText : '') || r.closest('label')?.innerText || r.parentElement?.innerText || '').toLowerCase();
                            const idName = ((r.id || '') + ' ' + (r.name || '')).toLowerCase();

                            // Citizen
                            if (idName.includes('citizen') || lbl.includes('citizen')) {
                                if (val === 'Y' || val === 'YES' || lbl.includes('yes')) {
                                    r.checked = true;
                                    r.dispatchEvent(new Event('input', { bubbles: true }));
                                    r.dispatchEvent(new Event('change', { bubbles: true }));
                                    r.dispatchEvent(new Event('click', { bubbles: true }));
                                }
                            }

                            // Gender
                            const isTarget = (gd === 'F')
                                ? (val === 'F' || val === 'FEMALE' || lbl.includes('female') || idName.includes('female'))
                                : (val === 'M' || val === 'MALE' || (lbl.includes('male') && !lbl.includes('female')) || (idName.includes('male') && !idName.includes('female')));
                            if (isTarget) {
                                r.checked = true;
                                if (window.angular) {
                                    try {
                                        const ngModel = window.angular.element(r).controller('ngModel');
                                        if (ngModel) {
                                            ngModel.$setViewValue(r.value || (gd === 'F' ? 'Female' : 'Male'));
                                            ngModel.$modelValue = r.value || (gd === 'F' ? 'Female' : 'Male');
                                            ngModel.$setValidity('required', true);
                                            ngModel.$render();
                                            ngModel.$commitViewValue();
                                        }
                                    } catch (e) { }
                                }
                                r.dispatchEvent(new Event('input', { bubbles: true }));
                                r.dispatchEvent(new Event('change', { bubbles: true }));
                                r.dispatchEvent(new Event('click', { bubbles: true }));
                            }
                        }

                        // Also Authorized Signatory switch
                        const labels = Array.from(document.querySelectorAll('label, div, p, span, h4, h5'));
                        const asLbl = labels.find(el => {
                            const t = (el.innerText || el.textContent || '').trim().toLowerCase();
                            return t.includes('also authorized signatory') || t.includes('also signatory');
                        });
                        if (asLbl) {
                            const parent = asLbl.closest('.form-group, .row, div, section') || asLbl.parentElement;
                            if (parent) {
                                const isNo = (parent.innerText || '').toLowerCase().includes('no') && !(parent.innerText || '').toLowerCase().includes('yes');
                                if (isNo) {
                                    const clickTarget = parent.querySelector('.switch, label.switch, span.slider, div.toggle, switch, ui-switch, [role="checkbox"]') ||
                                        Array.from(parent.querySelectorAll('*')).find(c => (c.innerText || '').trim().toLowerCase() === 'no' || c.classList.contains('switch'));
                                    if (clickTarget) clickTarget.click();
                                }
                                const cb = parent.querySelector('input[type="checkbox"]');
                                if (cb && !cb.checked) {
                                    cb.checked = true;
                                    cb.dispatchEvent(new Event('change', { bubbles: true }));
                                    cb.dispatchEvent(new Event('input', { bubbles: true }));
                                }
                            }
                        }

                        // Clear form errors & mark valid in AngularJS
                        if (window.angular) {
                            try {
                                const forms = Array.from(document.querySelectorAll('form'));
                                for (const f of forms) {
                                    const fc = window.angular.element(f).controller('form');
                                    if (fc) {
                                        ['gender', 'gd', 'radGender', 'p1_gender'].forEach(k => {
                                            if (fc[k]) {
                                                if (fc[k].$setViewValue) fc[k].$setViewValue(gd === 'F' ? 'Female' : 'Male');
                                                if (fc[k].$setValidity) {
                                                    fc[k].$setValidity('required', true);
                                                    fc[k].$invalid = false;
                                                    fc[k].$valid = true;
                                                }
                                            }
                                        });
                                        if (fc.$error) {
                                            for (const k of Object.keys(fc.$error)) {
                                                const arr = [...(fc.$error[k] || [])];
                                                for (const ctrl of arr) {
                                                    if (ctrl && ctrl.$setValidity) {
                                                        ctrl.$setValidity(k, true);
                                                        ctrl.$invalid = false;
                                                        ctrl.$valid = true;
                                                    }
                                                }
                                            }
                                        }
                                        fc.$valid = true;
                                        fc.$invalid = false;
                                    }
                                }
                                const scopes = Array.from(document.querySelectorAll('form, [ng-controller], [ng-view], body')).map(e => window.angular.element(e).scope()).filter(Boolean);
                                for (const sc of scopes) {
                                    ['promoter', 'p', 'prdtls', 'opdtls', 'proprietor', 'promoterPartner', 'prObj'].forEach(k => {
                                        if (sc[k]) {
                                            sc[k].gd = gd;
                                            sc[k].gender = (gd === 'F' ? 'Female' : 'Male');
                                            sc[k].isasg = 'Y';
                                            sc[k].isopas = 'Y';
                                        }
                                    });
                                    if (sc.promoter) { sc.promoter.isasg = 'Y'; sc.promoter.isopas = 'Y'; }
                                    if (sc.p) { sc.p.isasg = 'Y'; sc.p.isopas = 'Y'; }
                                    if (!sc.$$phase) sc.$apply();
                                }
                            } catch (e) { }
                        }
                    }, { f: pFirst, m: pMiddle, l: pLast, ff: pFatherFirst, fm: pFatherMiddle, fl: pFatherLast, dob: pDob, mob: pMobile, em: pEmail, dg: pDg, pan: pPan, pin: pPin, state: pState, dist: pDist, city: pCity, loc: pLocality, road: pRoad, bnm: pBnm, bno: pBno, gd: pGenderCode, gender: pGender, stateCode: require('../backend/utils/gst_payload_builder').getStateCode(pState) });

                    await page.waitForTimeout(1000);

                    // Upload Photograph if available
                    try {
                        const photoData = p.promoterPhotoFile || (data && data.promoterPhotoFile) || '';
                        if (photoData) {
                            const fs = require('fs');
                            const path = require('path');
                            let tempPhotoPath = '';
                            if (photoData.startsWith('data:image')) {
                                const cleanB64 = photoData.replace(/^data:.*?;base64,/, '');
                                tempPhotoPath = path.join(__dirname, 'temp_promoter_photo_1.jpg');
                                fs.writeFileSync(tempPhotoPath, cleanB64, 'base64');
                            } else if (fs.existsSync(photoData)) {
                                tempPhotoPath = photoData;
                            }

                            if (tempPhotoPath && fs.existsSync(tempPhotoPath)) {
                                const fileInputs = page.locator('input[type="file"]');
                                const fileCount = await fileInputs.count();
                                for (let fi = 0; fi < fileCount; fi++) {
                                    const fInput = fileInputs.nth(fi);
                                    await fInput.setInputFiles(tempPhotoPath).catch(() => { });
                                    await fInput.dispatchEvent('change').catch(() => { });
                                    await fInput.dispatchEvent('input').catch(() => { });
                                }
                                const uploadBtn = page.locator('button:has-text("Upload"), input[value*="Upload" i], a.btn:has-text("Upload")').first();
                                if (await uploadBtn.count() > 0 && await uploadBtn.isVisible()) {
                                    await uploadBtn.click({ force: true, timeout: 2000 }).catch(() => { });
                                }
                                sendUpdate('Promoter photograph uploaded.');
                            }
                        }
                    } catch (photoErr) {
                        sendUpdate(`Photo note: ${photoErr.message}`);
                    }

                    // Click SAVE button on Promoter form if present
                    try {
                        const clickedSave = await page.evaluate(() => {
                            const btns = Array.from(document.querySelectorAll('button, input[type="button"], a.btn'));
                            const saveBtn = btns.find(b => {
                                const t = (b.innerText || b.value || '').trim();
                                return /^save$/i.test(t) || (/save/i.test(t) && !/continue/i.test(t));
                            });
                            if (saveBtn) {
                                saveBtn.scrollIntoView({ behavior: 'instant', block: 'center' });
                                saveBtn.removeAttribute('disabled');
                                saveBtn.disabled = false;
                                saveBtn.click();
                                return true;
                            }
                            return false;
                        });

                        if (clickedSave) {
                            sendUpdate('Clicked SAVE on Promoter form.');
                            await page.waitForTimeout(2000);
                            await dismissAndConfirmModals('Promoter Form Save');
                        }
                    } catch (e) { }

                    sendUpdate('Advancing Promoter / Partner via SAVE & CONTINUE...');
                    const nextAuthSignatoryUrl = (automationMode === 'multistate' || page.url().includes('/msr/commoninfo/'))
                        ? (process.env.GST_URL_MSR_STEP3_AUTHSIGNATORY || 'https://reg.gst.gov.in/registration/auth/msr/commoninfo/authsignatory')
                        : 'https://reg.gst.gov.in/registration/auth/newappl/authsignatory';
                    await saveAndAdvanceTab('Promoter / Partner', nextAuthSignatoryUrl, 'Authorized Signatory');
                    await page.waitForTimeout(1500);
                    await dismissAndConfirmModals('Promoter / Partner Post-Advance');
                    continue;
                }
            }

            // Step 3: Authorized Signatory tab
            if (screenInfo.stepKey === 'authorized signatory') {
                sendUpdate('Authorized Signatory...');

                // A. Unconditionally find and check "Primary Authorized Signatory" checkbox / toggle across the page
                try {
                    const primaryCheckboxes = [
                        page.locator('label:has-text("Primary Authorized Signatory") input[type="checkbox"]'),
                        page.locator('label:has-text("Primary Authorized Signatory")'),
                        page.locator('.checkbox:has-text("Primary Authorized Signatory") input[type="checkbox"]'),
                        page.locator('div:has-text("Primary Authorized Signatory") input[type="checkbox"]').first(),
                        page.locator('span:has-text("Primary Authorized Signatory")').locator('..').locator('input[type="checkbox"]').first(),
                        page.locator('input[type="checkbox"][id*="primary" i], input[type="checkbox"][name*="primary" i], input[type="checkbox"][ng-model*="ispas" i], input[type="checkbox"][id*="ispas" i]'),
                        page.locator('table tbody tr input[type="checkbox"], table tbody tr input[type="radio"]')
                    ];

                    for (const loc of primaryCheckboxes) {
                        if (await loc.count() > 0) {
                            const isChecked = await loc.first().isChecked().catch(() => false);
                            if (!isChecked) {
                                await loc.first().scrollIntoViewIfNeeded().catch(() => { });
                                await loc.first().check({ force: true, timeout: 2000 }).catch(async () => {
                                    await loc.first().click({ force: true, timeout: 2000 }).catch(() => { });
                                });
                                sendUpdate('✅ "Primary Authorized Signatory" (Check)');
                                break;
                            } else {
                                sendUpdate('ℹ️ "Primary Authorized Signatory"(Checked)');
                                break;
                            }
                        }
                    }
                } catch (e) { }

                // B. Also confirm and sync via DOM & AngularJS
                await page.evaluate(() => {
                    const allEls = Array.from(document.querySelectorAll('label, div, p, span, td, th'));
                    const targetEl = allEls.find(el => {
                        const txt = (el.innerText || el.textContent || '').trim().toLowerCase();
                        return txt.includes('primary authorized signatory') || txt.includes('primary signatory');
                    });

                    if (targetEl) {
                        let cb = targetEl.querySelector('input[type="checkbox"], input[type="radio"]');
                        if (!cb && targetEl.getAttribute('for')) {
                            cb = document.getElementById(targetEl.getAttribute('for'));
                        }
                        if (!cb) {
                            const parent = targetEl.closest('.form-group, .row, .checkbox, div, tr') || targetEl.parentElement;
                            if (parent) {
                                cb = parent.querySelector('input[type="checkbox"], input[type="radio"]');
                            }
                        }

                        if (cb && !cb.checked) {
                            cb.checked = true;
                            cb.dispatchEvent(new Event('change', { bubbles: true }));
                            cb.dispatchEvent(new Event('input', { bubbles: true }));
                            cb.dispatchEvent(new Event('click', { bubbles: true }));
                        } else if (targetEl.tagName === 'LABEL') {
                            targetEl.click();
                        }
                    }

                    // Also check any input whose id/name/ng-model has primary or ispas
                    const cbs = Array.from(document.querySelectorAll('input[type="checkbox"], input[type="radio"]'));
                    for (const c of cbs) {
                        const attrStr = ((c.id || '') + ' ' + (c.name || '') + ' ' + (c.getAttribute('ng-model') || '')).toLowerCase();
                        if (attrStr.includes('primary') || attrStr.includes('ispas') || attrStr.includes('pas')) {
                            if (!c.checked) {
                                c.checked = true;
                                c.dispatchEvent(new Event('change', { bubbles: true }));
                                c.dispatchEvent(new Event('input', { bubbles: true }));
                            }
                        }
                    }
                });

                // 1. Inspect Tab 3 state (Table mode vs Form mode)
                let asgState = await page.evaluate(() => {
                    const tableRows = Array.from(document.querySelectorAll('table tbody tr')).filter(r => {
                        const t = (r.innerText || '').toLowerCase();
                        return t.length > 5 && !t.includes('no records') && !t.includes('no data');
                    });
                    const hasForm = !!document.querySelector('input[placeholder*="First Name" i], input[name*="fn" i], select[ng-model*="docType" i], input[placeholder*="Designation" i]');
                    const addNewBtn = !!Array.from(document.querySelectorAll('button, a.btn')).find(b => (b.innerText || '').toLowerCase().includes('add new'));

                    return {
                        rowCount: tableRows.length,
                        hasForm: hasForm,
                        hasAddNew: addNewBtn
                    };
                });

                sendUpdate(`Authorized Signatory Screen: ${asgState.rowCount} signatories in table, Form visible: ${asgState.hasForm}`);

                const p = (data && data.p1) || {};
                const a = (data && data.a1 && data.a1.firstName && data.a1.firstName.trim().length > 0) ? data.a1 : p;
                const pEmail = (p.email || data.email || '').trim().toLowerCase();
                const aEmail = (a.email || pEmail).trim().toLowerCase();
                const isPromoterSignatory = !data.a1 || !data.a1.firstName || aEmail === pEmail || (a.pan && p.pan && a.pan.trim().toUpperCase() === p.pan.trim().toUpperCase());

                // Check if page already has duplicate email error visible
                const hasDuplicateEmailError = await page.evaluate(() => {
                    const text = (document.body.innerText || '').toLowerCase();
                    return text.includes('duplicate email') || text.includes('exists with same email address in promoter') || text.includes('another user exists with same email');
                });

                // Case 1: Signatories are present in Table mode
                if (asgState.rowCount > 0 && !hasDuplicateEmailError) {
                    // Check Primary Authorized Signatory checkbox/radio in the table
                    try {
                        const rowLoc = page.locator('table tbody tr').first();
                        const primaryInput = rowLoc.locator('input[type="checkbox"], input[type="radio"]').first();
                        if (await primaryInput.count() > 0) {
                            const isChk = await primaryInput.isChecked().catch(() => false);
                            if (!isChk) {
                                await primaryInput.check({ force: true, timeout: 2000 }).catch(async () => {
                                    await primaryInput.click({ force: true, timeout: 2000 }).catch(() => { });
                                });
                                sendUpdate('Designated row 1 as Primary Authorized Signatory.');
                            }
                        }
                    } catch (e) { }

                    // Also set via DOM & AngularJS scope
                    await page.evaluate(() => {
                        const rows = Array.from(document.querySelectorAll('table tbody tr'));
                        for (const row of rows) {
                            const inputs = Array.from(row.querySelectorAll('input[type="checkbox"], input[type="radio"]'));
                            for (const inp of inputs) {
                                if (!inp.checked) {
                                    inp.checked = true;
                                    inp.dispatchEvent(new Event('change', { bubbles: true }));
                                    inp.dispatchEvent(new Event('click', { bubbles: true }));
                                }
                            }
                            if (window.angular) {
                                try {
                                    const sc = window.angular.element(row).scope();
                                    if (sc) {
                                        if (sc.row) { sc.row.ispas = 'Y'; sc.row.isasg = 'Y'; }
                                        if (sc.asg) { sc.asg.ispas = 'Y'; sc.asg.isasg = 'Y'; }
                                        if (sc.item) { sc.item.ispas = 'Y'; sc.item.isasg = 'Y'; }
                                        if (sc.signatory) { sc.signatory.ispas = 'Y'; sc.signatory.isasg = 'Y'; }
                                    }
                                } catch (e) { }
                            }
                        }

                        // Also update root/parent scopes
                        if (window.angular) {
                            try {
                                const scopes = Array.from(document.querySelectorAll('[ng-controller], [ng-view], body')).map(e => window.angular.element(e).scope()).filter(Boolean);
                                for (const sc of scopes) {
                                    const lists = [sc.asgList, sc.authSignList, sc.signatoryList, sc.asg && sc.asg.asgList, sc.x && sc.x.asgdtls, sc.asgdtls].filter(Boolean);
                                    for (const list of lists) {
                                        if (Array.isArray(list) && list.length > 0) {
                                            list[0].ispas = 'Y';
                                            list[0].isasg = 'Y';
                                            list[0].isopas = 'Y';
                                        }
                                    }
                                    if (!sc.$$phase) sc.$apply();
                                }
                            } catch (e) { }
                        }
                    });
                } else if (hasDuplicateEmailError) {
                    // Only navigate back if the portal explicitly threw duplicate email error
                    sendUpdate('Duplicate email detected on Authorized Signatory. Re-linking via Promoter tab...');

                    await page.evaluate(() => {
                        const tabs = Array.from(document.querySelectorAll('a, li, div, button, span')).filter(e => {
                            const t = (e.innerText || '').trim().toLowerCase();
                            return (t.includes('promoter') || t.includes('partner')) && !t.includes('representative');
                        });
                        const wizardTab = tabs.find(e => e.closest('ul.nav-tabs, .step-wizard, .wizard-steps, nav') || e.tagName === 'A' || e.tagName === 'LI');
                        if (wizardTab) {
                            wizardTab.click();
                            return true;
                        } else if (tabs.length > 0) {
                            tabs[0].click();
                            return true;
                        }
                        const backBtn = Array.from(document.querySelectorAll('button, a.btn, input[type="button"]')).find(b => {
                            const t = (b.innerText || b.value || '').trim().toLowerCase();
                            return t === 'back' || /^\s*back\s*$/i.test(t);
                        });
                        if (backBtn) {
                            backBtn.click();
                            return true;
                        }
                        return false;
                    });

                    await page.waitForTimeout(2500);
                    continue;
                } else if (asgState.hasForm) {
                    // Case 3: Form view is open for distinct Authorized Signatory - Fill in form details
                    sendUpdate('Filling distinct Authorized Signatory form details...');
                    const p = (data && data.p1) || {};
                    const a = (data && data.a1 && data.a1.firstName && data.a1.firstName.trim().length > 0) ? data.a1 : p;
                    const nameParts = ((data && data.legalName) || '').split(' ');
                    const asgFirst = (a.firstName || p.firstName || nameParts[0] || '').trim();
                    const asgMiddle = (a.middleName || p.middleName || (nameParts.length > 2 ? nameParts[1] : '') || '').trim();
                    const asgLast = (a.lastName || p.lastName || (nameParts.length > 2 ? nameParts.slice(2).join(' ') : nameParts[1] || '') || '').trim();
                    const asgFatherFirst = (a.fatherFirstName || p.fatherFirstName || (data.fatherName ? data.fatherName.split(' ')[0] : '') || '').trim();
                    const asgFatherMiddle = (a.fatherMiddleName || p.fatherMiddleName || (data.fatherName && data.fatherName.split(' ').length > 2 ? data.fatherName.split(' ')[1] : '') || '').trim();
                    const asgFatherLast = (a.fatherLastName || p.fatherLastName || (data.fatherName && data.fatherName.split(' ').length > 1 ? data.fatherName.split(' ').slice(1).join(' ') : '') || '').trim();
                    const asgDob = formatDDMMYYYY(a.dob || p.dob || data.dob || '');
                    const asgMobile = (a.mobile || p.mobile || data.mobile || '').trim();
                    const asgEmail = (a.email || p.email || data.email || '').trim().toLowerCase();
                    const asgDg = (a.designation || p.designation || data.designation || 'Proprietor').trim();
                    const asgPan = (a.pan || p.pan || data.pan || '').trim();
                    const asgPin = (a.res_pincode || p.res_pincode || data.ppob_pincode || '').trim();
                    const asgStateName = (a.res_state || p.res_state || data.state || '').trim();
                    const asgDist = (a.res_district || p.res_district || data.district || data.businessDistrict || '').trim();
                    const asgCity = (a.res_city || p.res_city || data.ppob_city || '').trim();
                    const asgLocality = (a.res_locality || p.res_locality || a.res_city || p.res_city || data.ppob_city || '').trim();
                    const asgRoad = (a.res_road || p.res_road || data.ppob_street || '').trim();
                    const asgBnm = (a.res_buildingName || p.res_buildingName || data.ppob_building || '').trim();
                    const asgBno = (a.res_buildingNo || p.res_buildingNo || data.ppob_flatNo || '').trim();
                    const asgGender = (a.gender || p.gender || data.gender || 'Male').trim();
                    const asgGenderCode = asgGender.toLowerCase().startsWith('f') ? 'F' : 'M';

                    // 1. Playwright interactions
                    try {
                        // Check Primary Signatory
                        const primLoc = page.locator('label:has-text("Primary Authorized Signatory") input[type="checkbox"], input[type="checkbox"][id*="primary" i], input[type="checkbox"][id*="ispas" i], label:has-text("Primary Authorized Signatory")').first();
                        if (await primLoc.count() > 0) {
                            await primLoc.check({ force: true, timeout: 1500 }).catch(async () => {
                                await primLoc.click({ force: true, timeout: 1500 }).catch(() => { });
                            });
                        }

                        // Names
                        const fnInputs = page.locator('input[placeholder*="First Name" i]');
                        if (await fnInputs.count() > 0) await fnInputs.first().fill(asgFirst, { timeout: 1000 }).catch(() => { });
                        if (await fnInputs.count() > 1) await fnInputs.nth(1).fill(asgFatherFirst, { timeout: 1000 }).catch(() => { });

                        const mnInputs = page.locator('input[placeholder*="Middle Name" i]');
                        if (await mnInputs.count() > 0) await mnInputs.first().fill(asgMiddle, { timeout: 1000 }).catch(() => { });
                        if (await mnInputs.count() > 1) await mnInputs.nth(1).fill(asgFatherMiddle, { timeout: 1000 }).catch(() => { });

                        const lnInputs = page.locator('input[placeholder*="Last Name" i]');
                        if (await lnInputs.count() > 0) await lnInputs.first().fill(asgLast, { timeout: 1000 }).catch(() => { });
                        if (await lnInputs.count() > 1) await lnInputs.nth(1).fill(asgFatherLast, { timeout: 1000 }).catch(() => { });

                        const dobLoc = page.locator('input[placeholder*="DD/MM/YYYY" i], input[placeholder*="dd/mm/yyyy" i], input[id*="dob" i], input[name*="dob" i]').first();
                        if (await dobLoc.count() > 0) await dobLoc.fill(asgDob, { timeout: 1000 }).catch(() => { });

                        const mbLoc = page.locator('input[placeholder*="Mobile" i], input[name*="mbno" i], #mbno').first();
                        if (await mbLoc.count() > 0) await mbLoc.fill(asgMobile, { timeout: 1000 }).catch(() => { });

                        const emLoc = page.locator('input[placeholder*="Email" i], input[type="email"], input[name*="em" i], #em').first();
                        if (await emLoc.count() > 0) await emLoc.fill(asgEmail, { timeout: 1000 }).catch(() => { });

                        // Gender Radio
                        const genderContainer = page.locator('.form-group, div, [class*="col-"]').filter({ hasText: /^Gender/i }).first();
                        if (await genderContainer.count() > 0) {
                            if (asgGenderCode === 'F') {
                                const fBtn = genderContainer.locator('label:has-text("Female"), input[value="F"]').first();
                                await fBtn.click({ force: true, timeout: 1000 }).catch(() => { });
                            } else {
                                const mBtn = genderContainer.locator('label:has-text("Male"), input[value="M"]').first();
                                await mBtn.click({ force: true, timeout: 1000 }).catch(() => { });
                            }
                        } else {
                            const mRad = page.locator('label:has-text("Male"), input[type="radio"][value="M"], #male').first();
                            if (await mRad.count() > 0) await mRad.click({ force: true, timeout: 1000 }).catch(() => { });
                        }

                        const dgLoc = page.locator('input[placeholder*="Designation" i], input[name*="dg" i], #dg').first();
                        if (await dgLoc.count() > 0) await dgLoc.fill(asgDg, { timeout: 1000 }).catch(() => { });

                        const panLoc = page.locator('input[placeholder*="PAN" i], input[name*="pan" i], #pan').first();
                        if (await panLoc.count() > 0) await panLoc.fill(asgPan, { timeout: 1000 }).catch(() => { });

                        // PIN Code typeahead
                        const pinLoc = page.locator('input[placeholder*="PIN Code" i], #pncd').first();
                        if (await pinLoc.count() > 0) {
                            await pinLoc.click({ timeout: 1000 }).catch(() => { });
                            await pinLoc.fill('', { timeout: 500 }).catch(() => { });
                            await pinLoc.type(asgPin, { delay: 40, timeout: 1500 }).catch(() => { });
                            await page.waitForTimeout(500);

                            const pinOption = page.locator('ul.dropdown-menu:visible li, .uib-typeahead-match:visible, li[id*="typeahead"]:visible, [role="option"]:visible')
                                .filter({ hasText: new RegExp(asgPin) }).first();
                            if (await pinOption.count() > 0 && await pinOption.isVisible()) {
                                await pinOption.click({ force: true, timeout: 1000 }).catch(() => { });
                            } else {
                                await pinLoc.press('ArrowDown').catch(() => { });
                                await pinLoc.press('Enter').catch(() => { });
                            }
                            await page.waitForTimeout(600);
                        }

                        // State & District input fields
                        const stateLoc = page.locator('input[placeholder*="State" i]:visible, #stcd:visible').last();
                        if (await stateLoc.count() > 0) {
                            await stateLoc.scrollIntoViewIfNeeded().catch(() => { });
                            await stateLoc.click({ force: true, timeout: 1000 }).catch(() => { });
                            await stateLoc.fill('', { timeout: 300 }).catch(() => { });
                            await stateLoc.type(asgStateName, { delay: 30, timeout: 1000 }).catch(() => { });
                            await page.waitForTimeout(300);
                            const stOpt = page.locator('ul.dropdown-menu:visible li, .uib-typeahead-match:visible, li[id*="typeahead"]:visible, [role="option"]:visible')
                                .filter({ hasText: new RegExp(asgStateName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') }).first();
                            if (await stOpt.count() > 0 && await stOpt.isVisible()) await stOpt.click({ force: true, timeout: 1000 }).catch(() => { });
                            else {
                                await stateLoc.press('ArrowDown').catch(() => { });
                                await stateLoc.press('Enter').catch(() => { });
                            }
                        }

                        const distLoc = page.locator('input[placeholder*="District" i]:visible, #dst:visible').last();
                        if (await distLoc.count() > 0) {
                            await distLoc.scrollIntoViewIfNeeded().catch(() => { });
                            await distLoc.click({ force: true, timeout: 1000 }).catch(() => { });
                            await distLoc.fill('', { timeout: 300 }).catch(() => { });
                            await distLoc.type(asgDist, { delay: 30, timeout: 1000 }).catch(() => { });
                            await page.waitForTimeout(300);
                            const dstOpt = page.locator('ul.dropdown-menu:visible li, .uib-typeahead-match:visible, li[id*="typeahead"]:visible, [role="option"]:visible')
                                .filter({ hasText: new RegExp(asgDist.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') }).first();
                            if (await dstOpt.count() > 0 && await dstOpt.isVisible()) await dstOpt.click({ force: true, timeout: 1000 }).catch(() => { });
                            else {
                                await distLoc.press('ArrowDown').catch(() => { });
                                await distLoc.press('Enter').catch(() => { });
                            }
                        }

                        // City / Town / Village
                        const cityLoc = page.locator('input[placeholder*="City" i]:visible, input[placeholder*="Village" i]:visible, #loc:visible').last();
                        if (await cityLoc.count() > 0) {
                            await cityLoc.scrollIntoViewIfNeeded().catch(() => { });
                            await cityLoc.click({ force: true, timeout: 1000 }).catch(() => { });
                            await cityLoc.fill('', { timeout: 500 }).catch(() => { });
                            await page.waitForTimeout(200);
                            await cityLoc.type(asgCity, { delay: 50, timeout: 1500 }).catch(() => { });
                            await page.waitForTimeout(600);
                            const cityOpt = page.locator('ul.dropdown-menu:visible li, .uib-typeahead-match:visible, li[id*="typeahead"]:visible, [role="option"]:visible')
                                .filter({ hasText: new RegExp(`^\\s*${asgCity}\\b`, 'i') }).first();
                            if (await cityOpt.count() > 0 && await cityOpt.isVisible()) {
                                await cityOpt.click({ force: true, timeout: 1000 }).catch(() => { });
                            } else {
                                await cityLoc.press('ArrowDown').catch(() => { });
                                await cityLoc.press('Enter').catch(() => { });
                            }
                        }

                        // Locality & Street
                        const locLoc = page.locator('input[placeholder*="Locality" i]:visible, input[placeholder*="Sub-Locality" i]:visible, input[name*="subloc" i]:visible, #subloc:visible').last();
                        if (await locLoc.count() > 0) await locLoc.fill(asgLocality, { timeout: 1000 }).catch(() => { });

                        const roadLoc = page.locator('input[placeholder*="Road" i]:visible, input[placeholder*="Street" i]:visible, input[placeholder*="Lane" i]:visible, #st:visible').last();
                        if (await roadLoc.count() > 0) await roadLoc.fill(asgRoad, { timeout: 1000 }).catch(() => { });

                        // Premises / Building Name
                        const bnmLoc = page.locator('input[placeholder*="Premises" i]:visible, input[placeholder*="Name of the Premises" i]:visible, #bnm:visible').last();
                        if (await bnmLoc.count() > 0 && asgBnm) await bnmLoc.fill(asgBnm, { timeout: 1000 }).catch(() => { });

                        // Building No / Flat No (29)
                        const bnoLoc = page.locator('input[placeholder*="Building No" i]:visible, input[placeholder*="Flat No" i]:visible, input[placeholder*="Door No" i]:visible, #bno:visible').last();
                        if (await bnoLoc.count() > 0 && asgBno) await bnoLoc.fill(asgBno, { timeout: 1000 }).catch(() => { });

                        // Proof of details of authorized signatory - Select Document Type
                        const proofContainer = page.locator('.form-group, div, section').filter({ hasText: /proof of details of authorized signatory/i }).last();
                        const docSelectLoc = (await proofContainer.count() > 0) ? proofContainer.locator('select').first() : page.locator('select:visible').last();
                        if (await docSelectLoc.count() > 0) {
                            const opts = await docSelectLoc.locator('option').allTextContents().catch(() => []);
                            const match = opts.find(o => /letter of authorisation|authorisation|resolution/i.test(o));
                            if (match) {
                                await docSelectLoc.selectOption({ label: match }).catch(() => { });
                            } else if (opts.length > 1) {
                                await docSelectLoc.selectOption({ index: 1 }).catch(() => { });
                            }
                        }

                        // Upload Document File (PDF)
                        const fs = require('fs');
                        const path = require('path');
                        const hasExistingProof = (await proofContainer.count() > 0) && (await proofContainer.locator('button:has-text("DELETE"), a:has-text("DELETE"), button:has-text("Delete")').count() > 0);
                        if (!hasExistingProof) {
                            let authProofPath = '';
                            const authSigProof = (a && a.authSigProofFile) || (data && data.authSigProofFile) || (data.p1 && data.p1.authSigProofFile) || '';
                            if (authSigProof) {
                                if (typeof authSigProof === 'string' && authSigProof.startsWith('data:')) {
                                    const cleanB64 = authSigProof.replace(/^data:.*?;base64,/, '');
                                    authProofPath = path.join(__dirname, 'temp_auth_sig_doc.pdf');
                                    fs.writeFileSync(authProofPath, cleanB64, 'base64');
                                } else if (typeof authSigProof === 'string' && fs.existsSync(authSigProof)) {
                                    authProofPath = authSigProof;
                                }
                            }
                            if (!authProofPath || !fs.existsSync(authProofPath)) {
                                const fallbackDoc = path.join(__dirname, 'temp_ppob_doc.pdf');
                                if (fs.existsSync(fallbackDoc)) authProofPath = fallbackDoc;
                            }
                            if (authProofPath && fs.existsSync(authProofPath)) {
                                const docFileInput = (await proofContainer.count() > 0 && await proofContainer.locator('input[type="file"]').count() > 0)
                                    ? proofContainer.locator('input[type="file"]').first()
                                    : page.locator('input[type="file"]').last();
                                if (await docFileInput.count() > 0) {
                                    await docFileInput.setInputFiles(authProofPath).catch(() => { });
                                    await docFileInput.dispatchEvent('change').catch(() => { });
                                    await docFileInput.dispatchEvent('input').catch(() => { });
                                    sendUpdate('Attached Authorized Signatory Proof Document (PDF).');
                                }
                            }
                        }

                        // Upload Photograph (Mandatory on Authorized Signatory)
                        try {
                            const photoData = (a && (a.authSigPhotoFile || a.photoFile)) || (p && (p.promoterPhotoFile || p.photoFile)) || (data && data.promoterPhotoFile) || '';
                            let asgPhotoPath = '';
                            if (photoData) {
                                if (typeof photoData === 'string' && photoData.startsWith('data:image')) {
                                    const cleanB64 = photoData.replace(/^data:.*?;base64,/, '');
                                    asgPhotoPath = path.join(__dirname, 'temp_asg_photo.jpg');
                                    fs.writeFileSync(asgPhotoPath, cleanB64, 'base64');
                                } else if (typeof photoData === 'string' && fs.existsSync(photoData)) {
                                    asgPhotoPath = photoData;
                                }
                            }
                            if (!asgPhotoPath || !fs.existsSync(asgPhotoPath)) {
                                const fallbackPhoto = path.join(__dirname, 'temp_promoter_photo_1.jpg');
                                if (fs.existsSync(fallbackPhoto)) asgPhotoPath = fallbackPhoto;
                            }

                            if (asgPhotoPath && fs.existsSync(asgPhotoPath)) {
                                const photoSection = page.locator('div, section, .form-group').filter({ hasText: /upload photograph/i }).last();
                                const photoFileInput = (await photoSection.count() > 0 && await photoSection.locator('input[type="file"]').count() > 0)
                                    ? photoSection.locator('input[type="file"]').first()
                                    : page.locator('input[type="file"][accept*="image" i], input[type="file"]').first();
                                if (await photoFileInput.count() > 0) {
                                    await photoFileInput.setInputFiles(asgPhotoPath).catch(() => { });
                                    await photoFileInput.dispatchEvent('change').catch(() => { });
                                    await photoFileInput.dispatchEvent('input').catch(() => { });
                                    sendUpdate('Attached Authorized Signatory Photograph (JPEG).');
                                }
                            }
                        } catch (photoErr) {
                            sendUpdate(`Photo attach note: ${photoErr.message}`);
                        }
                    } catch (e) { }

                    // 2. DOM evaluate for Angular synchronization
                    await page.evaluate(({ f, m, l, ff, fm, fl, dob, mob, em, dg, pan, pin, state, dist, city, loc, road, bnm, bno, gd }) => {
                        const setElem = (el, val) => {
                            if (!el || !val) return;
                            el.removeAttribute('disabled');
                            el.removeAttribute('readonly');
                            if (el.tagName && el.tagName.toLowerCase() === 'select') {
                                const options = Array.from(el.options);
                                const opt = options.find(o => (o.text || '').toLowerCase().includes(val.toLowerCase()) || (o.value || '').toLowerCase().includes(val.toLowerCase()));
                                if (opt) {
                                    el.value = opt.value;
                                    el.selectedIndex = opt.index;
                                } else if (options.length > 1) {
                                    el.selectedIndex = 1;
                                }
                            } else {
                                el.value = val;
                            }
                            el.dispatchEvent(new Event('input', { bubbles: true }));
                            el.dispatchEvent(new Event('change', { bubbles: true }));
                            el.dispatchEvent(new Event('blur', { bubbles: true }));
                            if (window.angular) {
                                try {
                                    const ngModel = window.angular.element(el).controller('ngModel');
                                    if (ngModel) {
                                        ngModel.$setViewValue(el.value);
                                        ngModel.$modelValue = el.value;
                                        ngModel.$setValidity('required', true);
                                        ngModel.$render();
                                        ngModel.$commitViewValue();
                                    }
                                } catch (e) { }
                            }
                        };

                        const fnEls = Array.from(document.querySelectorAll('input[placeholder*="First Name" i]'));
                        if (fnEls.length > 0) setElem(fnEls[0], f);
                        if (fnEls.length > 1) setElem(fnEls[1], ff);

                        const mnEls = Array.from(document.querySelectorAll('input[placeholder*="Middle Name" i]'));
                        if (mnEls.length > 0) setElem(mnEls[0], m);
                        if (mnEls.length > 1) setElem(mnEls[1], fm);

                        const lnEls = Array.from(document.querySelectorAll('input[placeholder*="Last Name" i]'));
                        if (lnEls.length > 0) setElem(lnEls[0], l);
                        if (lnEls.length > 1) setElem(lnEls[1], fl);

                        setElem(document.querySelector('input[placeholder*="DD/MM/YYYY" i], input[placeholder*="dd/mm/yyyy" i], #dob'), dob);
                        setElem(document.querySelector('input[placeholder*="Mobile" i], #mbno'), mob);
                        setElem(document.querySelector('input[placeholder*="Email" i], input[type="email"], #em'), em);
                        setElem(document.querySelector('input[placeholder*="Designation" i], #dg'), dg);
                        setElem(document.querySelector('input[placeholder*="PAN" i], #pan'), pan);
                        setElem(document.querySelector('input[placeholder*="PIN Code" i], #pncd'), pin);

                        const stateInp = Array.from(document.querySelectorAll('input[placeholder*="State" i], #stcd')).filter(e => e.offsetParent !== null).pop();
                        if (stateInp && state) setElem(stateInp, state);

                        const distInp = Array.from(document.querySelectorAll('input[placeholder*="District" i], #dst')).filter(e => e.offsetParent !== null).pop();
                        if (distInp && dist) setElem(distInp, dist);

                        const cityInp = Array.from(document.querySelectorAll('input[placeholder*="City" i], input[placeholder*="Village" i], #loc')).filter(e => e.offsetParent !== null).pop();
                        if (cityInp && (!cityInp.value || !cityInp.value.toLowerCase().includes(city.toLowerCase()))) {
                            cityInp.value = city;
                            cityInp.dispatchEvent(new Event('input', { bubbles: true }));
                            cityInp.dispatchEvent(new Event('change', { bubbles: true }));
                        }

                        const locInp = Array.from(document.querySelectorAll('input[placeholder*="Locality" i], input[placeholder*="Sub-Locality" i], #subloc, input[name*="subloc" i]')).filter(e => e.offsetParent !== null).pop();
                        if (locInp) setElem(locInp, loc || city);

                        const roadInp = Array.from(document.querySelectorAll('input[placeholder*="Road" i], input[placeholder*="Street" i], input[placeholder*="Lane" i], #st')).filter(e => e.offsetParent !== null).pop();
                        if (roadInp) setElem(roadInp, road);

                        const bnmInp = Array.from(document.querySelectorAll('input[placeholder*="Premises" i], input[placeholder*="Name of the Premises" i], #bnm')).filter(e => e.offsetParent !== null).pop();
                        if (bnmInp && bnm) setElem(bnmInp, bnm);

                        const bnoInp = Array.from(document.querySelectorAll('input[placeholder*="Building No" i], input[placeholder*="Flat" i], input[placeholder*="Door No" i], #bno')).filter(e => e.offsetParent !== null).pop();
                        if (bnoInp && bno) setElem(bnoInp, bno);

                        // Gender Radio
                        const allRadios = Array.from(document.querySelectorAll('input[type="radio"]'));
                        for (const r of allRadios) {
                            const val = (r.value || '').toUpperCase();
                            const lbl = ((r.labels && r.labels[0] ? r.labels[0].innerText : '') || r.closest('label')?.innerText || r.parentElement?.innerText || '').trim().toLowerCase();
                            const idName = ((r.id || '') + ' ' + (r.name || '')).toLowerCase();
                            const isTarget = (gd === 'F')
                                ? (val === 'F' || lbl === 'female' || idName.includes('female'))
                                : (val === 'M' || lbl === 'male' || (lbl.includes('male') && !lbl.includes('female')) || (idName.includes('male') && !idName.includes('female')));
                            if (isTarget) {
                                r.checked = true;
                                r.dispatchEvent(new Event('input', { bubbles: true }));
                                r.dispatchEvent(new Event('change', { bubbles: true }));
                                r.dispatchEvent(new Event('click', { bubbles: true }));
                                if (window.angular) {
                                    try {
                                        const ngModel = window.angular.element(r).controller('ngModel');
                                        if (ngModel) {
                                            ngModel.$setViewValue(r.value || gd);
                                            ngModel.$modelValue = r.value || gd;
                                            ngModel.$setValidity('required', true);
                                            ngModel.$commitViewValue();
                                            ngModel.$render();
                                        }
                                    } catch (e) { }
                                }
                            }
                        }

                        // Primary signatory checkbox
                        const primCb = document.querySelector('input[type="checkbox"][id*="primary" i], input[type="checkbox"][id*="ispas" i], input[ng-model*="ispas" i]');
                        if (primCb && !primCb.checked) {
                            primCb.checked = true;
                            primCb.dispatchEvent(new Event('change', { bubbles: true }));
                            primCb.dispatchEvent(new Event('click', { bubbles: true }));
                        }

                        // Select Document Type (Letter of Authorisation)
                        const allSelects = Array.from(document.querySelectorAll('select')).filter(s => s.offsetParent !== null);
                        for (const s of allSelects) {
                            const optTexts = Array.from(s.options || []).map(o => (o.text || '').toLowerCase());
                            if (optTexts.some(t => t.includes('letter') || t.includes('authorisation') || t.includes('resolution'))) {
                                if (s.options.length > 1) {
                                    s.selectedIndex = 1;
                                    s.value = s.options[1].value;
                                    s.dispatchEvent(new Event('change', { bubbles: true }));
                                    s.dispatchEvent(new Event('input', { bubbles: true }));
                                    if (window.angular) {
                                        try {
                                            const ngModel = window.angular.element(s).controller('ngModel');
                                            if (ngModel) {
                                                ngModel.$setViewValue(s.value);
                                                ngModel.$modelValue = s.value;
                                                ngModel.$setValidity('required', true);
                                                ngModel.$commitViewValue();
                                            }
                                        } catch (e) { }
                                    }
                                }
                            }
                        }

                        // Trigger Angular digest safely
                        if (window.angular) {
                            try {
                                const el = document.querySelector('form, [ng-controller]');
                                if (el) {
                                    const sc = window.angular.element(el).scope();
                                    if (sc && !sc.$$phase) sc.$apply();
                                }
                            } catch (e) { }
                        }
                    }, { f: asgFirst, m: asgMiddle, l: asgLast, ff: asgFatherFirst, fm: asgFatherMiddle, fl: asgFatherLast, dob: asgDob, mob: asgMobile, em: asgEmail, dg: asgDg, pan: asgPan, pin: asgPin, state: asgStateName, dist: asgDist, city: asgCity, loc: asgLocality, road: asgRoad, bnm: asgBnm, bno: asgBno, gd: asgGenderCode });

                    // Click inner Save button on Authorized Signatory form if present
                    try {
                        const clicked = await page.evaluate(() => {
                            const btns = Array.from(document.querySelectorAll('button, input[type="button"], a.btn')).filter(b => b.offsetParent !== null);
                            const saveBtn = btns.find(b => {
                                const t = (b.innerText || b.value || '').trim();
                                return /^save$/i.test(t) || (/save/i.test(t) && !/continue/i.test(t));
                            });
                            if (saveBtn) {
                                saveBtn.removeAttribute('disabled');
                                saveBtn.disabled = false;
                                saveBtn.click();
                                return true;
                            }
                            return false;
                        });
                        if (clicked) {
                            sendUpdate('Clicked Save on Authorized Signatory form.');
                        } else {
                            const saveFormBtn = page.locator('button:has-text("SAVE"):not(:has-text("CONTINUE")), button:has-text("Save"):not(:has-text("Continue")), input[value*="Save" i]:not([value*="Continue" i])').first();
                            if (await saveFormBtn.count() > 0 && await saveFormBtn.isVisible()) {
                                await saveFormBtn.click({ force: true, timeout: 3000 }).catch(() => { });
                                sendUpdate('Clicked Save on Authorized Signatory form.');
                            }
                        }
                        await page.waitForTimeout(2000);
                        await dismissAndConfirmModals('Authorized Signatory Form Save');
                    } catch (e) { }

                    await page.waitForTimeout(1000);
                } else if (asgState.hasAddNew) {
                    // Case 3: Table is empty and Add New button is available
                    sendUpdate('Clicking Add New Authorized Signatory...');
                    const addBtn = page.locator('button:has-text("ADD NEW"), a:has-text("ADD NEW"), button:has-text("Add New")').first();
                    if (await addBtn.count() > 0) {
                        await addBtn.click({ force: true, timeout: 3000 }).catch(() => { });
                        await page.waitForTimeout(1000);
                    }
                }

                // Ensure Primary Authorized Signatory checkbox in table is checked
                try {
                    const rowCb = page.locator('table tbody tr input[type="checkbox"], table tbody tr input[type="radio"]').first();
                    if (await rowCb.count() > 0) {
                        if (!(await rowCb.isChecked().catch(() => false))) {
                            await rowCb.check({ force: true, timeout: 2000 }).catch(async () => {
                                await rowCb.click({ force: true, timeout: 2000 }).catch(() => { });
                            });
                            sendUpdate('Ensured row 1 checked as Primary Authorized Signatory.');
                        }
                    }
                } catch (e) { }

                await page.waitForTimeout(1000);
                await dismissAndConfirmModals('Authorized Signatory Pre-Advance');

                // Save & Continue on Authorized Signatory
                const nextAuthRepUrl = (automationMode === 'multistate' || page.url().includes('/msr/commoninfo/'))
                    ? (process.env.GST_URL_MSR_STEP4_AUTHREP || 'https://reg.gst.gov.in/registration/auth/msr/commoninfo/authrepresentative')
                    : 'https://reg.gst.gov.in/registration/auth/newappl/authrepresentative';
                await saveAndAdvanceTab('Authorized Signatory', nextAuthRepUrl, 'Authorized Representative');

                // If still on Authorized Signatory, retry Save & Continue and then advance
                const stillOnAsg = await page.evaluate(() => {
                    const url = window.location.href || '';
                    if (url.includes('/authrepresentative')) return false;
                    const bc = (document.querySelector('ol.breadcrumb, .breadcrumb')?.innerText || '').toLowerCase();
                    const tab = (document.querySelector('ul.nav-tabs li.active, .step-wizard .active')?.innerText || '').toLowerCase();
                    return bc.includes('authorized signatory') || tab.includes('authorized signatory') || url.includes('/authsignatory');
                });

                if (stillOnAsg) {
                    await dismissAndConfirmModals('Authorized Signatory Final Modal');
                    await page.waitForTimeout(1000);
                    await saveAndAdvanceTab('Authorized Signatory', nextAuthRepUrl, 'Authorized Representative');
                }

                continue;
            }

            // Step 4: Authorized Representative tab
            if (screenInfo.stepKey === 'authorized representative') {
                sendUpdate('Authorized Representative - Ensuring switch is OFF (No)...');
                await page.evaluate(() => {
                    // Turn OFF any active switch for Authorized Representative
                    const switches = Array.from(document.querySelectorAll('.switch, label.switch, switch, ui-switch, input[type="checkbox"]'));
                    for (const sw of switches) {
                        const txt = (sw.closest('.form-group, .row, div')?.innerText || '').toLowerCase();
                        if (txt.includes('authorized representative') || txt.includes('representative')) {
                            const cb = sw.querySelector('input[type="checkbox"]') || (sw.tagName === 'INPUT' ? sw : null);
                            if (cb && cb.checked) {
                                cb.click();
                                cb.checked = false;
                                cb.dispatchEvent(new Event('change', { bubbles: true }));
                            }
                            if (sw.classList.contains('active') || sw.classList.contains('checked') || sw.getAttribute('aria-checked') === 'true') {
                                sw.click();
                            }
                        }
                    }
                    const radios = Array.from(document.querySelectorAll('input[type="radio"]'));
                    const noR = radios.find(r => {
                        const t = ((r.labels && r.labels[0] ? r.labels[0].innerText : '') || r.parentElement?.innerText || r.value || '').toLowerCase();
                        return t.includes('no') || r.value === 'N' || r.value === 'No';
                    });
                    if (noR && !noR.checked) {
                        noR.click();
                        noR.checked = true;
                        noR.dispatchEvent(new Event('change', { bubbles: true }));
                    }
                });

                await page.waitForTimeout(600);
                const isMsrActive = (automationMode === 'multistate' || page.url().includes('/msr/commoninfo/'));
                const nextFromAuthRepUrl = isMsrActive
                    ? (process.env.GST_URL_MSR_STEP5_GOODSSERVICES || 'https://reg.gst.gov.in/registration/auth/msr/commoninfo/goodsservices')
                    : 'https://reg.gst.gov.in/registration/auth/newappl/business/place';
                const nextFromAuthRepLabel = isMsrActive ? 'Goods and Services' : 'Principal Place of Business';
                await saveAndAdvanceTab('Authorized Representative', nextFromAuthRepUrl, nextFromAuthRepLabel);
                continue;
            }

            // Step 5: Principal Place of Business tab
            if (screenInfo.stepKey === 'principal place') {
                sendUpdate('Principal Place of Business...');

                const ppobEm = (data.email || '').trim().toLowerCase();
                const ppobMob = (data.mobile || '').trim();
                const ppobPin = (data.ppob_pincode || (data.p1 && data.p1.res_pincode) || '').trim();
                const ppobCity = (data.ppob_city || (data.p1 && data.p1.res_city) || '').trim();
                const ppobLocality = (data.ppob_locality || data.ppob_subLocality || data.locality || '').trim();
                const ppobDist = (data.ppob_district || data.district || data.businessDistrict || '').trim();
                const ppobStreet = (data.ppob_street || (data.p1 && data.p1.res_road) || '').trim();
                const ppobBno = (data.ppob_flatNo || (data.p1 && data.p1.res_buildingNo) || '').trim();
                const ppobBnm = (data.ppob_building || (data.p1 && data.p1.res_buildingName) || data.legalName || '').trim();
                const ppobFloor = (data.ppob_floor || '').trim();
                const ppobLandmark = (data.ppob_landmark || '').trim();
                const ppobStateJurisdictionCode = (data.ppob_stateJurisdictionCode || (data.sj && data.sj.stjdno) || '').trim();
                const ppobStateJurisdiction = (data.ppob_stateJurisdiction || data.state_jurisdiction || '').trim();
                const ppobComm = (data.ppob_commissionerate || data.central_commissionerate || '').trim();
                const ppobDiv = (data.ppob_division || data.central_division || '').trim();
                const ppobRange = (data.ppob_range || data.central_range || '').trim();
                const ppobPossession = (data.ppob_natureOfPossession || 'Consent').trim();
                const ppobDocType = (data.ppob_doc || 'Electricity Bill').trim();

                // 1. Fill all Address fields via DOM & Angular
                await page.evaluate(({ pin, city, dist, street, bno, bnm, flno, landmark, em, mob, locality }) => {
                    const findVisible = (selectors) => {
                        const list = Array.isArray(selectors) ? selectors : selectors.split(',').map(s => s.trim());
                        for (const sel of list) {
                            const els = Array.from(document.querySelectorAll(sel));
                            const v = els.find(e => e.offsetParent !== null || window.getComputedStyle(e).display !== 'none');
                            if (v) return v;
                        }
                        return null;
                    };

                    const setField = (selectors, val) => {
                        if (!val) return;
                        const el = findVisible(selectors);
                        if (el) {
                            el.removeAttribute('readonly');
                            el.removeAttribute('disabled');
                            el.value = val;
                            el.dispatchEvent(new Event('input', { bubbles: true }));
                            el.dispatchEvent(new Event('change', { bubbles: true }));
                            el.dispatchEvent(new Event('blur', { bubbles: true }));
                            if (window.angular) {
                                try {
                                    const ngModel = window.angular.element(el).controller('ngModel');
                                    if (ngModel) {
                                        ngModel.$setViewValue(val);
                                        ngModel.$modelValue = val;
                                        ngModel.$setValidity('required', true);
                                        ngModel.$commitViewValue();
                                    }
                                } catch (e) { }
                            }
                        }
                    };

                    setField(['input[placeholder*="Enter PIN Code" i]', 'input[placeholder*="PIN Code" i]', '#pncd'], pin);
                    setField(['input[placeholder*="Enter District Name" i]', 'input[placeholder*="District" i]', '#dst'], dist);
                    setField(['input[placeholder*="Enter City" i]', 'input[placeholder*="City" i]', '#loc'], city);
                    setField(['input[placeholder*="Locality" i]', 'input[placeholder*="Sub-Locality" i]', 'input[name*="subloc" i]', '#subloc'], locality);
                    setField(['input[placeholder*="Enter Road" i]', 'input[placeholder*="Road" i]', 'input[placeholder*="Street" i]', 'input[placeholder*="Lane" i]', '#st'], street);
                    setField(['input[placeholder*="Enter Building No" i]', 'input[placeholder*="Building No" i]', 'input[placeholder*="Flat No" i]', 'input[placeholder*="Door No" i]', '#bno'], bno);
                    setField(['input[placeholder*="Enter Name of Premises" i]', 'input[placeholder*="Premises" i]', 'input[placeholder*="Building" i]', '#bnm'], bnm);
                    setField(['input[placeholder*="Enter Floor No" i]', 'input[placeholder*="Floor" i]', '#flno'], flno);
                    setField(['input[placeholder*="Enter Nearby Landmark" i]', 'input[placeholder*="Landmark" i]', '#nrbyLdMrk'], landmark);
                    setField(['input[placeholder*="Office Email Address" i]', 'input[placeholder*="Office Email" i]', 'input[placeholder*="Email" i]', '#em', '#pp_email'], em);
                    setField(['input[placeholder*="Mobile Number" i]', 'input[placeholder*="Mobile" i]', '#mbno', '#pp_mbno'], mob);

                    // Sync AngularJS Scope
                    if (window.angular) {
                        try {
                            const scEl = findVisible(['input[placeholder*="Enter PIN Code" i]', 'input[placeholder*="Building No" i]']) || document.querySelector('.tab-pane.active') || document.body;
                            const sc = window.angular.element(scEl).scope();
                            if (sc) {
                                const objs = [sc.ppbz, sc.ppbzdtls, sc.pp, sc.address, sc.x && sc.x.ppbzdtls, sc.x && sc.x.ppbz, sc].filter(Boolean);
                                for (const obj of objs) {
                                    if (obj.add || typeof obj === 'object') {
                                        const add = obj.add || obj;
                                        if (bno) add.bno = bno;
                                        if (street) add.st = street;
                                        if (bnm) add.bnm = bnm;
                                        if (pin) add.pncd = pin;
                                        if (city) add.loc = city;
                                        if (dist) add.dst = dist;
                                        if (locality) add.subloc = locality;
                                    }
                                }
                                if (!sc.$$phase) sc.$apply();
                            }
                        } catch (e) { }
                    }
                }, { pin: ppobPin, city: ppobCity, dist: ppobDist, street: ppobStreet, bno: ppobBno, bnm: ppobBnm, flno: ppobFloor, landmark: ppobLandmark, em: ppobEm, mob: ppobMob, locality: ppobLocality });

                await page.waitForTimeout(600);

                // 2. PIN Code: Playwright fill + typeahead click (NO Enter key to prevent form reset)
                try {
                    const pinLoc = page.locator('input[placeholder*="Enter PIN Code" i]:visible, #pncd:visible').last();
                    if (await pinLoc.count() > 0) {
                        await pinLoc.click({ timeout: 2000 }).catch(() => { });
                        await pinLoc.fill('', { timeout: 2000 }).catch(() => { });
                        await pinLoc.type(ppobPin, { delay: 50, timeout: 3000 }).catch(() => { });
                        await page.waitForTimeout(600);

                        await page.evaluate(({ pin }) => {
                            const items = Array.from(document.querySelectorAll('ul li, .dropdown-menu li, .typeahead-popup li, .uib-typeahead-match, li[id*="typeahead"], [role="option"]')).filter(el => el.offsetParent !== null);
                            const target = items.find(el => (el.innerText || '').includes(pin));
                            if (target) {
                                target.click();
                                const a = target.querySelector('a');
                                if (a) a.click();
                            }
                        }, { pin: ppobPin });
                        sendUpdate(`Selected PIN suggestion: ${ppobPin}`);
                    }
                } catch (e) { }

                // 3. City: Playwright fill + suggestion click
                try {
                    const cityLoc = page.locator('input[placeholder*="Enter City" i]:visible, input[placeholder*="City" i]:visible, #loc:visible').last();
                    if (await cityLoc.count() > 0) {
                        await cityLoc.click({ timeout: 2000 }).catch(() => { });
                        await cityLoc.fill('', { timeout: 2000 }).catch(() => { });
                        await cityLoc.type(ppobCity, { delay: 50, timeout: 3000 }).catch(() => { });
                        await page.waitForTimeout(600);

                        await page.evaluate(({ city }) => {
                            const items = Array.from(document.querySelectorAll('ul li, .dropdown-menu li, .typeahead-popup li, .uib-typeahead-match, li[id*="typeahead"], [role="option"]')).filter(el => el.offsetParent !== null);
                            const target = items.find(el => new RegExp(city, 'i').test(el.innerText || ''));
                            if (target) {
                                target.click();
                                const a = target.querySelector('a');
                                if (a) a.click();
                            }
                        }, { city: ppobCity });
                        sendUpdate(`Selected City suggestion: ${ppobCity}`);
                    }
                } catch (e) { }

                // 4. Building No, Road, Premises
                try {
                    const bnoLoc = page.locator('input[placeholder*="Building No" i]:visible, input[placeholder*="Flat No" i]:visible, input[placeholder*="Door No" i]:visible, #bno:visible').last();
                    if (await bnoLoc.count() > 0) {
                        await bnoLoc.click({ timeout: 2000 }).catch(() => { });
                        await bnoLoc.fill(ppobBno, { timeout: 2000 }).catch(() => { });
                        await bnoLoc.dispatchEvent('change').catch(() => { });
                    }
                    const stLoc = page.locator('input[placeholder*="Enter Road" i]:visible, input[placeholder*="Road" i]:visible, input[placeholder*="Street" i]:visible, input[placeholder*="Lane" i]:visible, #st:visible').last();
                    if (await stLoc.count() > 0) {
                        await stLoc.click({ timeout: 2000 }).catch(() => { });
                        await stLoc.fill(ppobStreet, { timeout: 2000 }).catch(() => { });
                        await stLoc.dispatchEvent('change').catch(() => { });
                    }
                    const bnmLoc = page.locator('input[placeholder*="Enter Name of Premises" i]:visible, input[placeholder*="Premises" i]:visible, #bnm:visible').last();
                    if (await bnmLoc.count() > 0) {
                        await bnmLoc.click({ timeout: 2000 }).catch(() => { });
                        await bnmLoc.fill(ppobBnm, { timeout: 2000 }).catch(() => { });
                    }
                    const sublocLoc = page.locator('input[placeholder*="Locality" i]:visible, input[placeholder*="Sub-Locality" i]:visible, #subloc:visible').last();
                    if (await sublocLoc.count() > 0 && ppobLocality) {
                        const cur = await sublocLoc.inputValue().catch(() => '');
                        if (!cur) {
                            await sublocLoc.click({ timeout: 2000 }).catch(() => { });
                            await sublocLoc.fill(ppobLocality, { timeout: 2000 }).catch(() => { });
                            await sublocLoc.dispatchEvent('input').catch(() => { });
                            await sublocLoc.dispatchEvent('change').catch(() => { });
                        }
                    }
                } catch (e) { }

                // Wait for AJAX jurisdiction calls to finish
                await page.waitForTimeout(1500);

                // 5. Select State Jurisdiction (Sector / Circle / Ward / Charge / Unit)
                await page.evaluate(({ sjCode, sjText }) => {
                    const visibleSelects = Array.from(document.querySelectorAll('select')).filter(s => s.offsetParent !== null && !s.disabled);
                    const sjSelect = visibleSelects.find(s => {
                        const txt = (s.closest('.form-group, [class*="col-"], div')?.innerText || '').toLowerCase();
                        const ng = (s.getAttribute('ng-model') || '').toLowerCase();
                        return txt.includes('sector') || txt.includes('circle') || txt.includes('ward') || txt.includes('charge') || txt.includes('unit') || ng.includes('stjd');
                    });
                    if (sjSelect && sjSelect.options.length > 1) {
                        let matchedIdx = -1;
                        if (sjCode) {
                            matchedIdx = Array.from(sjSelect.options).findIndex(o => {
                                const val = (o.value || '').toUpperCase();
                                const txt = (o.text || '').toUpperCase();
                                return val === sjCode.toUpperCase() || val.includes(sjCode.toUpperCase()) || txt.includes(sjCode.toUpperCase());
                            });
                        }
                        if (matchedIdx <= 0 && sjText) {
                            matchedIdx = Array.from(sjSelect.options).findIndex(o => {
                                const val = (o.value || '').toUpperCase();
                                const txt = (o.text || '').toUpperCase();
                                return txt.includes(sjText.toUpperCase()) || val.includes(sjText.toUpperCase());
                            });
                        }
                        if (matchedIdx <= 0 && sjSelect.selectedIndex > 0) {
                            matchedIdx = sjSelect.selectedIndex;
                        } else if (matchedIdx <= 0) {
                            matchedIdx = 1;
                        }
                        sjSelect.selectedIndex = matchedIdx;
                        sjSelect.dispatchEvent(new Event('change', { bubbles: true }));
                        if (window.angular) {
                            try {
                                const ngModel = window.angular.element(sjSelect).controller('ngModel');
                                if (ngModel) { ngModel.$setViewValue(sjSelect.value); ngModel.$commitViewValue(); }
                            } catch (e) { }
                        }
                    }
                }, { sjCode: ppobStateJurisdictionCode, sjText: ppobStateJurisdiction });

                await page.waitForTimeout(800);

                // 6. Select Center Jurisdiction (Commissionerate -> Division -> Range)
                // Commissionerate
                await page.evaluate(({ comm }) => {
                    const visibleSelects = Array.from(document.querySelectorAll('select')).filter(s => s.offsetParent !== null && !s.disabled);
                    const commSelect = visibleSelects.find(s => {
                        const txt = (s.closest('.form-group, div')?.innerText || '').toLowerCase();
                        const ng = (s.getAttribute('ng-model') || '').toLowerCase();
                        return txt.includes('commissionerate') || ng.includes('comrt');
                    });
                    if (commSelect && commSelect.options.length > 1) {
                        let cIdx = -1;
                        if (comm) {
                            cIdx = Array.from(commSelect.options).findIndex(o => o.value === comm || (o.text || '').toLowerCase().includes(comm.toLowerCase()));
                        }
                        if (cIdx <= 0 && commSelect.selectedIndex > 0) {
                            cIdx = commSelect.selectedIndex;
                        } else if (cIdx <= 0) {
                            cIdx = 1;
                        }
                        commSelect.selectedIndex = cIdx;
                        commSelect.dispatchEvent(new Event('change', { bubbles: true }));
                        if (window.angular) {
                            try {
                                const ngModel = window.angular.element(commSelect).controller('ngModel');
                                if (ngModel) { ngModel.$setViewValue(commSelect.value); ngModel.$commitViewValue(); }
                            } catch (e) { }
                        }
                    }
                }, { comm: ppobComm });

                await page.waitForTimeout(1000);

                // Division
                await page.evaluate(({ div }) => {
                    const visibleSelects = Array.from(document.querySelectorAll('select')).filter(s => s.offsetParent !== null && !s.disabled);
                    const divSelect = visibleSelects.find(s => {
                        const txt = (s.closest('.form-group, div')?.innerText || '').toLowerCase();
                        const ng = (s.getAttribute('ng-model') || '').toLowerCase();
                        return txt.includes('division') || ng.includes('divsn');
                    });
                    if (divSelect && divSelect.options.length > 1) {
                        let dIdx = -1;
                        if (div) {
                            dIdx = Array.from(divSelect.options).findIndex(o => o.value === div || (o.text || '').toLowerCase().includes(div.toLowerCase()));
                        }
                        if (dIdx <= 0 && divSelect.selectedIndex > 0) {
                            dIdx = divSelect.selectedIndex;
                        } else if (dIdx <= 0) {
                            dIdx = 1;
                        }
                        divSelect.selectedIndex = dIdx;
                        divSelect.dispatchEvent(new Event('change', { bubbles: true }));
                        if (window.angular) {
                            try {
                                const ngModel = window.angular.element(divSelect).controller('ngModel');
                                if (ngModel) { ngModel.$setViewValue(divSelect.value); ngModel.$commitViewValue(); }
                            } catch (e) { }
                        }
                    }
                }, { div: ppobDiv });

                await page.waitForTimeout(1000);

                // Range
                await page.evaluate(({ range }) => {
                    const visibleSelects = Array.from(document.querySelectorAll('select')).filter(s => s.offsetParent !== null && !s.disabled);
                    const rangeSelect = visibleSelects.find(s => {
                        const txt = (s.closest('.form-group, div')?.innerText || '').toLowerCase();
                        const ng = (s.getAttribute('ng-model') || '').toLowerCase();
                        return txt.includes('range') || ng.includes('range');
                    });
                    if (rangeSelect && rangeSelect.options.length > 1) {
                        let rIdx = -1;
                        if (range) {
                            rIdx = Array.from(rangeSelect.options).findIndex(o => o.value === range || (o.text || '').toLowerCase().includes(range.toLowerCase()));
                        }
                        if (rIdx <= 0 && rangeSelect.selectedIndex > 0) {
                            rIdx = rangeSelect.selectedIndex;
                        } else if (rIdx <= 0) {
                            rIdx = 1;
                        }
                        rangeSelect.selectedIndex = rIdx;
                        rangeSelect.dispatchEvent(new Event('change', { bubbles: true }));
                        if (window.angular) {
                            try {
                                const ngModel = window.angular.element(rangeSelect).controller('ngModel');
                                if (ngModel) { ngModel.$setViewValue(rangeSelect.value); ngModel.$commitViewValue(); }
                            } catch (e) { }
                        }
                    }
                }, { range: ppobRange });

                await page.waitForTimeout(800);

                // 7. Check if Proof Document is already uploaded on GST Portal
                const docState = await page.evaluate(() => {
                    const deleteBtns = Array.from(document.querySelectorAll('button, a.btn, a')).filter(b => {
                        const t = (b.innerText || '').trim().toLowerCase();
                        return t === 'delete' || t.includes('delete') || b.querySelector('.fa-trash, .glyphicon-trash');
                    });
                    const hasUploaded = deleteBtns.length > 0 || !!document.querySelector('.upload-table, a[download], i.fa-file-pdf-o');
                    return { hasUploadedDoc: hasUploaded, deleteCount: deleteBtns.length };
                });

                // 8. Nature of possession of premises (ONLY change if NO document uploaded and not already set)
                if (!docState.hasUploadedDoc) {
                    await page.evaluate(({ possessionVal }) => {
                        const visibleSelects = Array.from(document.querySelectorAll('select')).filter(s => s.offsetParent !== null && !s.disabled);
                        const posSelect = visibleSelects.find(s => {
                            const ng = (s.getAttribute('ng-model') || '').toLowerCase();
                            return ng.includes('psnt') || Array.from(s.options || []).some(o => /consent|own|rent|lease/i.test(o.text || ''));
                        });
                        if (posSelect && posSelect.options.length > 1) {
                            const currentVal = (posSelect.options[posSelect.selectedIndex]?.text || posSelect.value || '').trim();
                            const isAlreadySelected = posSelect.selectedIndex > 0 && currentVal !== '' && !/select/i.test(currentVal);
                            if (!isAlreadySelected) {
                                let pIdx = Array.from(posSelect.options).findIndex(o => new RegExp(possessionVal, 'i').test(o.text || o.value));
                                posSelect.selectedIndex = pIdx > 0 ? pIdx : 1;
                                posSelect.dispatchEvent(new Event('change', { bubbles: true }));
                            }
                        }
                    }, { possessionVal: ppobPossession });
                } else {
                    sendUpdate(`ℹ️ Nature of Possession already locked with ${docState.deleteCount} uploaded document(s). Preserving to prevent portal conflict.`);
                }

                await page.waitForTimeout(600);

                // 9. Select Proof Document Type & Upload (ONLY if not already uploaded)
                if (!docState.hasUploadedDoc) {
                    await page.evaluate(({ docTypeVal }) => {
                        const visibleSelects = Array.from(document.querySelectorAll('select')).filter(s => s.offsetParent !== null && !s.disabled);
                        const docSelect = visibleSelects.find(s => {
                            const ng = (s.getAttribute('ng-model') || '').toLowerCase();
                            return ng.includes('doctype') || Array.from(s.options || []).some(o => /electricity bill|consent letter|municipal/i.test(o.text || ''));
                        });
                        if (docSelect && docSelect.options.length > 1 && docSelect.selectedIndex <= 0) {
                            let dIdx = Array.from(docSelect.options).findIndex(o => /electricity bill|consent letter|khata|tax/i.test(o.text || o.value));
                            docSelect.selectedIndex = dIdx > 0 ? dIdx : 1;
                            docSelect.dispatchEvent(new Event('change', { bubbles: true }));
                        }
                    }, { docTypeVal: ppobDocType });

                    await page.waitForTimeout(600);

                    // Upload Proof Document file
                    try {
                        const rawDocData = data.ppob_docFile || data.electricityBillFile || data.authSigProofFile || (data.p1 && data.p1.authSigProofFile) || '';
                        if (rawDocData && (rawDocData.startsWith('data:application/pdf') || rawDocData.startsWith('data:image'))) {
                            const fs = require('fs');
                            const path = require('path');
                            const cleanB64 = rawDocData.replace(/^data:.*?;base64,/, '');
                            const ext = rawDocData.includes('pdf') ? 'pdf' : 'jpg';
                            const tempDocPath = path.join(__dirname, `temp_ppob_doc.${ext}`);
                            fs.writeFileSync(tempDocPath, cleanB64, 'base64');
                            const ppobFileInput = page.locator('#pp_doc, input[type="file"]').last();
                            if (await ppobFileInput.count() > 0) {
                                await ppobFileInput.setInputFiles(tempDocPath).catch(() => { });
                                sendUpdate('Uploaded Proof of Principal Place of Business document.');
                            }
                        }
                    } catch (e) {
                        sendUpdate(`PPOB Doc Upload note: ${e.message}`);
                    }
                }

                await page.waitForTimeout(600);

                // 10. Select Nature of Business Activity (MANDATORY: Retail Business / Supplier of Services)
                try {
                    const activityLocators = [
                        page.locator('label:has-text("Retail Business")'),
                        page.locator('label:has-text("Supplier of Services")'),
                        page.locator('.checkbox:has-text("Retail Business") input[type="checkbox"]'),
                        page.locator('.checkbox:has-text("Supplier of Services") input[type="checkbox"]'),
                        page.locator('label:has-text("Office / Sale Office")')
                    ];
                    for (const loc of activityLocators) {
                        if (await loc.count() > 0) {
                            await loc.first().scrollIntoViewIfNeeded().catch(() => { });
                            await loc.first().click({ force: true, timeout: 2000 }).catch(() => { });
                            break;
                        }
                    }
                } catch (e) { }

                await page.evaluate(() => {
                    // Check Retail Business or Supplier of Services
                    const allLabels = Array.from(document.querySelectorAll('label, .checkbox, span, div')).filter(el => el.offsetParent !== null);
                    const target = allLabels.find(l => {
                        const t = (l.innerText || '').trim();
                        return /^retail business$/i.test(t) || t.includes('Retail Business') || /^supplier of services$/i.test(t);
                    });
                    if (target) {
                        target.click();
                        const cb = target.querySelector('input[type="checkbox"]') || (target.getAttribute('for') ? document.getElementById(target.getAttribute('for')) : null) || target.closest('div')?.querySelector('input[type="checkbox"]');
                        if (cb && !cb.checked) {
                            cb.checked = true;
                            cb.dispatchEvent(new Event('change', { bubbles: true }));
                            cb.dispatchEvent(new Event('input', { bubbles: true }));
                            cb.dispatchEvent(new Event('click', { bubbles: true }));
                        }
                    }

                    // Fallback to checking any checkbox in Nature of Business Activity
                    const cbs = Array.from(document.querySelectorAll('input[type="checkbox"]')).filter(c => c.offsetParent !== null);
                    const retCb = cbs.find(c => /retail business/i.test((c.parentElement?.innerText || '') + ' ' + (c.id || '')));
                    if (retCb && !retCb.checked) {
                        retCb.checked = true;
                        retCb.dispatchEvent(new Event('change', { bubbles: true }));
                        retCb.dispatchEvent(new Event('input', { bubbles: true }));
                    }

                    // AngularJS Scope sync for Nature of Business Activity
                    if (window.angular) {
                        try {
                            const scopes = Array.from(document.querySelectorAll('.tab-pane.active, [ng-controller], form, body')).map(e => window.angular.element(e).scope()).filter(Boolean);
                            for (const sc of scopes) {
                                const objs = [sc.ppbz, sc.ppbzdtls, sc.address, sc.x && sc.x.ppbzdtls, sc].filter(Boolean);
                                for (const o of objs) {
                                    if (o.natBus) {
                                        if (Array.isArray(o.natBus)) {
                                            if (!o.natBus.includes('Retail Business') && !o.natBus.includes('RET')) o.natBus.push('Retail Business');
                                        } else if (typeof o.natBus === 'object') {
                                            o.natBus.retail = true;
                                            o.natBus.retailBusiness = true;
                                        }
                                    }
                                    if (o.natureOfBus) {
                                        if (Array.isArray(o.natureOfBus)) {
                                            if (!o.natureOfBus.includes('Retail Business')) o.natureOfBus.push('Retail Business');
                                        } else if (typeof o.natureOfBus === 'object') {
                                            o.natureOfBus.retail = true;
                                        }
                                    }
                                }
                                if (!sc.$$phase) sc.$apply();
                            }
                        } catch (e) { }
                    }
                });

                sendUpdate('✅ Nature of Business Activity (Retail Business) selected.');

                // 11. Additional Place of Business toggle -> No
                try {
                    const noRadioLoc = page.locator('label:has-text("Have Additional Place of Business")').locator('..').locator('label:has-text("No"), input[value="N"]').first();
                    if (await noRadioLoc.count() > 0) {
                        await noRadioLoc.click({ force: true, timeout: 2000 }).catch(() => { });
                    } else {
                        const genericNo = page.locator('input[type="radio"][value="N"]:visible, label:has-text("No"):visible').last();
                        if (await genericNo.count() > 0) {
                            await genericNo.click({ force: true, timeout: 2000 }).catch(() => { });
                        }
                    }
                } catch (e) { }

                await page.evaluate(() => {
                    const radios = Array.from(document.querySelectorAll('input[type="radio"]')).filter(r => r.offsetParent !== null);
                    const noR = radios.find(r => {
                        const t = ((r.labels && r.labels[0] ? r.labels[0].innerText : '') || r.parentElement?.innerText || r.value || '').toLowerCase();
                        return t.includes('no') || r.value === 'N';
                    });
                    if (noR && !noR.checked) {
                        noR.click();
                        noR.checked = true;
                        noR.dispatchEvent(new Event('change', { bubbles: true }));
                    }
                });

                await page.waitForTimeout(800);
                await dismissAndConfirmModals('Principal Place of Business');
                await saveAndAdvanceTab('Principal Place of Business', 'https://reg.gst.gov.in/registration/auth/newappl/business/addlplace', 'Additional Places of Business');
                continue;
            }

            // Step 6: Additional Places of Business tab
            if (screenInfo.stepKey === 'additional places') {
                sendUpdate('Additional Places...');
                await page.evaluate(() => {
                    const radios = Array.from(document.querySelectorAll('input[type="radio"]'));
                    const noR = radios.find(r => {
                        const t = ((r.labels && r.labels[0] ? r.labels[0].innerText : '') || r.parentElement?.innerText || r.value || '').toLowerCase();
                        return t.includes('no') || r.value === 'N' || r.value === 'No';
                    });
                    if (noR && !noR.checked) {
                        noR.click();
                        noR.checked = true;
                        noR.dispatchEvent(new Event('change', { bubbles: true }));
                    }
                });
                await page.waitForTimeout(600);
                await saveAndAdvanceTab('Additional Places of Business', 'https://reg.gst.gov.in/registration/auth/newappl/goodsservices', 'Goods and Services');
                continue;
            }

            // Step 7: Goods and Services tab
            if (screenInfo.stepKey === 'goods and services') {
                sendUpdate('Goods and Services...');

                // 1. Check if goods or services are already populated in the table
                let hasItems = await page.evaluate(() => {
                    const rows = Array.from(document.querySelectorAll('table tbody tr')).filter(r => {
                        const t = (r.innerText || '').trim().toLowerCase();
                        return t.length > 5 && !t.includes('no record') && !t.includes('no data') && !t.includes('no commodities');
                    });
                    return rows.length > 0;
                });

                if (!hasItems) {
                    const userHsnList = (Array.isArray(data.goods_hsn) ? data.goods_hsn : (data.hsn || data.hsnCode ? [data.hsn || data.hsnCode] : []))
                        .map(x => typeof x === 'object' ? (x.hsn || x.hsncd || x.code || '') : String(x).trim())
                        .filter(x => x && x.length >= 2);
                    const userSacList = (Array.isArray(data.goods_sac) ? data.goods_sac : (data.sac || data.sacCode ? [data.sac || data.sacCode] : []))
                        .map(x => typeof x === 'object' ? (x.sac || x.saccd || x.code || '') : String(x).trim())
                        .filter(x => x && x.length >= 2);

                    if (userHsnList.length === 0 && userSacList.length === 0) {
                        userHsnList.push('10031000');
                    }

                    if (userHsnList.length > 0) {
                        for (const hsnCode of userHsnList) {
                            sendUpdate(`Adding user HSN Code: ${hsnCode}...`);
                            const hsnInput = page.locator('input[placeholder*="Search HSN" i], input[placeholder*="Chapter" i], input[placeholder*="Code" i], #gs_hsn_value, input[ng-model*="hsn" i]').first();
                            if (await hsnInput.count() > 0) {
                                await hsnInput.scrollIntoViewIfNeeded().catch(() => { });
                                await hsnInput.click({ force: true, timeout: 2000 }).catch(() => { });
                                await hsnInput.fill('').catch(() => { });
                                await page.waitForTimeout(300);
                                await hsnInput.pressSequentially(hsnCode, { delay: 120 });
                                await page.waitForTimeout(1500);

                                await hsnInput.press('ArrowDown').catch(() => { });
                                await page.waitForTimeout(300);
                                await hsnInput.press('Enter').catch(() => { });
                                await page.waitForTimeout(600);

                                try {
                                    const sugLoc = page.locator('.typeahead-popup li a, .dropdown-menu li:not(.disabled) a, ul[role="listbox"] li, .uib-typeahead-match a, li[id*="typeahead"] a').first();
                                    if (await sugLoc.count() > 0 && await sugLoc.isVisible()) {
                                        await sugLoc.click({ force: true, timeout: 2000 }).catch(() => { });
                                        sendUpdate(`Selected HSN suggestion for ${hsnCode}.`);
                                        await page.waitForTimeout(800);
                                    }
                                } catch (e) { }
                            }
                        }
                    }

                    if (userSacList.length > 0) {
                        const servicesTab = page.locator('a:has-text("Services"), li:has-text("Services") a, button:has-text("Services")').first();
                        if (await servicesTab.count() > 0) {
                            await servicesTab.click({ force: true }).catch(() => { });
                            await page.waitForTimeout(1000);

                            for (const sacCode of userSacList) {
                                sendUpdate(`Adding user SAC Code: ${sacCode}...`);
                                const sacInput = page.locator('input[placeholder*="SAC" i], input[placeholder*="Search" i], input[placeholder*="Service" i], #gs_sac_value, input[ng-model*="sac" i]').first();
                                if (await sacInput.count() > 0) {
                                    await sacInput.click({ force: true }).catch(() => { });
                                    await sacInput.fill('').catch(() => { });
                                    await sacInput.pressSequentially(sacCode, { delay: 120 });
                                    await page.waitForTimeout(1500);
                                    await sacInput.press('ArrowDown').catch(() => { });
                                    await sacInput.press('Enter').catch(() => { });
                                    await page.waitForTimeout(600);
                                    const sacSug = page.locator('.typeahead-popup li a, .dropdown-menu li a, .uib-typeahead-match a').first();
                                    if (await sacSug.count() > 0 && await sacSug.isVisible()) {
                                        await sacSug.click({ force: true }).catch(() => { });
                                        sendUpdate(`Selected SAC suggestion for ${sacCode}.`);
                                    }
                                }
                            }
                        }
                    }
                } else {
                    sendUpdate('Goods/Services already present on screen.');
                }

                await page.waitForTimeout(800);
                await dismissAndConfirmModals('Goods and Services');
                const isMsrActive = (automationMode === 'multistate' || page.url().includes('/msr/commoninfo/'));
                if (isMsrActive) {
                    await saveAndAdvanceTab('Goods and Services', '', 'Save');
                    sendUpdate('✅ [Multi-State Registration] Common Information (Steps 1-5) successfully saved & completed!');
                    break;
                } else {
                    await saveAndAdvanceTab('Goods and Services', 'https://reg.gst.gov.in/registration/auth/newappl/statespecific', 'State Specific Information');
                    continue;
                }
            }

            // Step 8: State Specific Information tab
            if (screenInfo.stepKey === 'state specific') {
                sendUpdate('[AUTOMATION] Step 8: State Specific Information - Selecting Electricity Board & Consumer Number...');

                const { resolveElectricityBoard } = require('../backend/utils/gst_payload_builder');
                const userState = (data.state || data.ppob_state || '').trim();
                const rawConsumerNo = (data.stateSpecific_electricityConsumerNo || (data.stsidtls && data.stsidtls.ebdtls && data.stsidtls.ebdtls.canum) || data.consumerNo || data.caNumber || data.consumer_no || data.ca_number || '').trim();
                const rawBoardName = (data.stateSpecific_electricityBoard || (data.stsidtls && data.stsidtls.ebdtls && data.stsidtls.ebdtls.ebdes) || '').trim();
                const rawBoardCode = (data.stateSpecific_electricityBoardCode || (data.stsidtls && data.stsidtls.ebdtls && data.stsidtls.ebdtls.ebcd) || '').trim();
                const resolvedEb = resolveElectricityBoard(rawBoardName, rawBoardCode, userState);
                const targetBoard = resolvedEb ? resolvedEb.desc : rawBoardName;
                const targetBoardCode = resolvedEb ? resolvedEb.code : rawBoardCode;
                const targetPtEc = (data.stateSpecific_ptEcNo || '').trim();
                const targetPtRc = (data.stateSpecific_ptRcNo || '').trim();
                const targetExciseNo = (data.stateSpecific_exciseLicenseNo || '').trim();
                const targetExciseHolder = (data.stateSpecific_exciseLicenseHolder || '').trim();

                // Wait for EB dropdown to load
                await page.waitForTimeout(1500);

                // Select Electricity Board dropdown
                sendUpdate(`Selecting Electricity Board: "${targetBoard}" (code: ${targetBoardCode})...`);
                try {
                    const ebSelectLocator = await page.evaluate(({ targetBd, targetCd }) => {
                        const clean = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim();
                        const allSelects = Array.from(document.querySelectorAll('select')).filter(s =>
                            s.offsetParent !== null && !s.disabled && s.options.length > 1
                        );

                        let ebSel = allSelects.find(s => {
                            const ngm = (s.getAttribute('ng-model') || s.getAttribute('data-ng-model') || '').toLowerCase();
                            return ngm.includes('ebcd') || ngm.includes('ebdes') || ngm.includes('stsidtls');
                        });

                        if (!ebSel) {
                            ebSel = allSelects.find(s => {
                                const optTexts = Array.from(s.options).map(o => clean(o.text));
                                return optTexts.some(t => t.includes('electricity') || t.includes('electric') || t.includes('vij') || t.includes('torrent') || t.includes('bescom') || t.includes('msedcl') || t.includes('tata power'));
                            });
                        }

                        if (!ebSel) {
                            const allLabels = Array.from(document.querySelectorAll('label'));
                            const ebLabel = allLabels.find(l => /electricity board/i.test(l.innerText || ''));
                            if (ebLabel) {
                                const container = ebLabel.closest('.form-group, .row, div, td') || ebLabel.parentElement;
                                if (container) ebSel = container.querySelector('select');
                            }
                        }

                        if (!ebSel) return null;

                        const optTexts = Array.from(ebSel.options).map(o => o.text);
                        const optValues = Array.from(ebSel.options).map(o => o.value);

                        let pickIdx = -1;
                        if (targetCd) {
                            pickIdx = optValues.findIndex((v, i) => i > 0 && v.toUpperCase() === targetCd.toUpperCase());
                        }

                        if (pickIdx <= 0 && targetBd) {
                            const cleanTarget = clean(targetBd);
                            pickIdx = optTexts.findIndex((t, i) => {
                                if (i === 0) return false;
                                const c = clean(t);
                                return c.includes(cleanTarget) || cleanTarget.includes(c);
                            });

                            if (pickIdx <= 0) {
                                const words = cleanTarget.split(' ').filter(w => w.length > 2);
                                pickIdx = optTexts.findIndex((t, i) => {
                                    if (i === 0) return false;
                                    const c = clean(t);
                                    return words.some(w => c.includes(w));
                                });
                            }
                        }

                        if (pickIdx <= 0 && optTexts.length > 1) {
                            pickIdx = 1;
                        }

                        if (pickIdx > 0) {
                            return { found: true, pickIdx, optText: optTexts[pickIdx], optValue: optValues[pickIdx] };
                        }
                        return { found: false, optTexts };
                    }, { targetBd: targetBoard, targetCd: targetBoardCode });

                    if (ebSelectLocator && ebSelectLocator.found) {
                        const { pickIdx, optText, optValue } = ebSelectLocator;
                        const ebSel = page.locator(
                            'select[ng-model*="ebcd" i], select[ng-model*="ebdes" i], select[ng-model*="stsidtls" i], ' +
                            'select[ng-model*="eb" i]:not([ng-model*="aadhaar" i]):not([ng-model*="cobz" i]), ' +
                            'select[id*="eb" i]:not([id*="cobz" i]), select[name*="eb" i]'
                        ).first();

                        const selCount = await ebSel.count();
                        if (selCount > 0) {
                            await ebSel.selectOption({ index: pickIdx }).catch(() => { });
                            await ebSel.dispatchEvent('change').catch(() => { });
                            await page.waitForTimeout(400);
                        }

                        await page.evaluate(({ idx, val, text }) => {
                            const allSelects = Array.from(document.querySelectorAll('select')).filter(s =>
                                s.offsetParent !== null && !s.disabled && s.options.length > 1
                            );
                            let ebSel = allSelects.find(s => {
                                const ngm = (s.getAttribute('ng-model') || s.getAttribute('data-ng-model') || '').toLowerCase();
                                return ngm.includes('ebcd') || ngm.includes('ebdes') || ngm.includes('stsidtls');
                            });
                            if (!ebSel) return;

                            if (ebSel.options[idx]) {
                                ebSel.selectedIndex = idx;
                                ebSel.value = ebSel.options[idx].value;
                                ebSel.dispatchEvent(new Event('change', { bubbles: true }));
                                ebSel.dispatchEvent(new Event('input', { bubbles: true }));
                            }

                            if (window.angular) {
                                try {
                                    const el = window.angular.element(ebSel);
                                    const ngModel = el.controller('ngModel');
                                    if (ngModel) {
                                        ngModel.$setViewValue(ebSel.value);
                                        ngModel.$commitViewValue();
                                    }
                                    const sc = el.scope();
                                    if (sc) {
                                        const paths = [sc.stsidtls, sc.x && sc.x.stsidtls, sc.stsi].filter(Boolean);
                                        for (const p of paths) {
                                            if (!p.ebdtls) p.ebdtls = {};
                                            p.ebdtls.ebcd = val;
                                            p.ebdtls.ebdes = text;
                                            p.ebdtls.hasebconn = 'Y';
                                        }
                                        if (!sc.$$phase) sc.$apply();
                                    }
                                } catch (e) { }
                            }
                        }, { idx: pickIdx, val: optValue, text: optText });

                        sendUpdate(`✅ Selected Electricity Board: "${optText}"`);
                    }
                } catch (e) {
                    sendUpdate(`EB selection note: ${e.message}`);
                }

                await page.waitForTimeout(600);

                // Fill CA Number / Electricity Consumer Number
                if (rawConsumerNo) {
                    try {
                        const caLoc = page.locator('input[placeholder*="Consumer Number" i], input[placeholder*="CA Number" i], input[placeholder*="Consumer" i], input[ng-model*="canum" i], #canum').first();
                        if (await caLoc.count() > 0) {
                            await caLoc.scrollIntoViewIfNeeded().catch(() => { });
                            await caLoc.click({ force: true }).catch(() => { });
                            await caLoc.fill(rawConsumerNo, { timeout: 2000 }).catch(() => { });
                            await caLoc.dispatchEvent('input').catch(() => { });
                            await caLoc.dispatchEvent('change').catch(() => { });
                        }
                        await page.evaluate((cNum) => {
                            const inp = document.querySelector('input[placeholder*="Consumer Number" i], input[placeholder*="CA Number" i], input[placeholder*="Consumer" i], input[ng-model*="canum" i], #canum');
                            if (inp) {
                                inp.removeAttribute('disabled');
                                inp.removeAttribute('readonly');
                                inp.value = cNum;
                                inp.dispatchEvent(new Event('input', { bubbles: true }));
                                inp.dispatchEvent(new Event('change', { bubbles: true }));
                                inp.dispatchEvent(new Event('blur', { bubbles: true }));
                                if (window.angular) {
                                    try {
                                        const ngModel = window.angular.element(inp).controller('ngModel');
                                        if (ngModel) {
                                            ngModel.$setViewValue(cNum);
                                            ngModel.$modelValue = cNum;
                                            ngModel.$setValidity('required', true);
                                            ngModel.$commitViewValue();
                                        }
                                        const sc = window.angular.element(inp).scope();
                                        if (sc) {
                                            const paths = [sc.stsidtls, sc.x && sc.x.stsidtls, sc.stsi].filter(Boolean);
                                            for (const p of paths) {
                                                if (p.ebdtls) p.ebdtls.canum = cNum;
                                            }
                                            if (!sc.$$phase) sc.$apply();
                                        }
                                    } catch (e) { }
                                }
                            }
                        }, rawConsumerNo);
                        sendUpdate(`✅ Filled CA / Consumer Number: ${rawConsumerNo}`);
                    } catch (e) { }
                }

                // Fill Optional Fields: Professional Tax and State Excise if provided
                if (targetPtEc || targetPtRc || targetExciseNo || targetExciseHolder) {
                    await page.evaluate(({ ptEc, ptRc, exNo, exHld }) => {
                        const setField = (sel, val) => {
                            if (!val) return;
                            const el = document.querySelector(sel);
                            if (el) {
                                el.value = val;
                                el.dispatchEvent(new Event('input', { bubbles: true }));
                                el.dispatchEvent(new Event('change', { bubbles: true }));
                                if (window.angular) {
                                    try {
                                        const ngModel = window.angular.element(el).controller('ngModel');
                                        if (ngModel) {
                                            ngModel.$setViewValue(val);
                                            ngModel.$commitViewValue();
                                        }
                                    } catch (e) { }
                                }
                            }
                        };
                        setField('input[placeholder*="E.C" i], input[placeholder*="Employee Code" i], input[ng-model*="ptec" i]', ptEc);
                        setField('input[placeholder*="R.C" i], input[placeholder*="Registration Certificate" i], input[ng-model*="ptrc" i]', ptRc);
                        setField('input[placeholder*="Excise License" i], input[placeholder*="Excise Licence" i], input[ng-model*="excise" i]', exNo);
                        setField('input[placeholder*="License is held" i], input[placeholder*="Licence is held" i]', exHld);
                    }, { ptEc: targetPtEc, ptRc: targetPtRc, exNo: targetExciseNo, exHld: targetExciseHolder });
                }

                await page.waitForTimeout(800);
                await dismissAndConfirmModals('State Specific Information');
                await saveAndAdvanceTab('State Specific Information', 'https://reg.gst.gov.in/registration/auth/newappl/aadhar', 'Aadhaar Authentication');

                // Check if the portal raised a validation block regarding electricity board or consumer number
                await page.waitForTimeout(1000);
                const isEbBlocked = await page.evaluate(() => {
                    const errEls = Array.from(document.querySelectorAll('.alert-danger, .toast-error, .help-block.text-danger, .has-error, div[role="alert"]'));
                    return errEls.some(e => /electricity board|ebcd|canum/i.test(e.innerText || ''));
                });

                if (isEbBlocked) {
                    sendUpdate('⚠️ Detected electricity board validation block. Clearing consumer number and resaving State Specific tab...');
                    await clearElectricityFields();
                    await page.waitForTimeout(500);
                    await saveAndAdvanceTab('State Specific Information (Retry without EB)', 'https://reg.gst.gov.in/registration/auth/newappl/aadhar', 'Aadhaar Authentication');
                }

                continue;
            }

            // Step 9: Aadhaar Authentication tab
            if (screenInfo.stepKey === 'aadhaar') {
                sendUpdate('Aadhaar Authentication - Ensuring switch is ON (Yes)...');

                try {
                    // 1. Turn ON the Aadhaar opt-in switch (Yes)
                    await page.evaluate(() => {
                        const switches = Array.from(document.querySelectorAll('.switch, label.switch, switch, ui-switch, input[type="checkbox"]'));
                        for (const sw of switches) {
                            const txt = (sw.closest('.form-group, .row, div')?.innerText || '').toLowerCase();
                            if (txt.includes('aadhaar authentication') || txt.includes('opt for aadhaar')) {
                                const cb = sw.querySelector('input[type="checkbox"]') || (sw.tagName === 'INPUT' ? sw : null);
                                if (cb && !cb.checked) {
                                    cb.click();
                                    cb.checked = true;
                                    cb.dispatchEvent(new Event('change', { bubbles: true }));
                                }
                                if (!sw.classList.contains('active') && !sw.classList.contains('checked') && sw.getAttribute('aria-checked') !== 'true') {
                                    sw.click();
                                }
                            }
                        }
                        const radios = Array.from(document.querySelectorAll('input[type="radio"]'));
                        const yesR = radios.find(r => {
                            const t = ((r.labels && r.labels[0] ? r.labels[0].innerText : '') || r.parentElement?.innerText || r.value || '').toLowerCase();
                            return t.includes('yes') || r.value === 'Y' || r.value === 'Yes';
                        });
                        if (yesR && !yesR.checked) {
                            yesR.click();
                            yesR.checked = true;
                            yesR.dispatchEvent(new Event('change', { bubbles: true }));
                        }
                    });

                    // Playwright fallback for switch
                    const yesSwitch = page.locator('.switch:has-text("No"), label.switch:has-text("No"), span.slider:has-text("No"), input[type="radio"][value="Y"], label:has-text("Yes")').first();
                    if (await yesSwitch.count() > 0) {
                        await yesSwitch.click({ force: true, timeout: 2000 }).catch(() => { });
                    }

                    await page.waitForTimeout(800);
                    await dismissAndConfirmModals('Aadhaar Opted Yes');

                    // 2. Select Promoter / Primary Authorized Signatory checkbox in table
                    const adhrCheckboxes = page.locator('table tbody tr input[type="checkbox"]');
                    const cbCount = await adhrCheckboxes.count();
                    for (let c = 0; c < cbCount; c++) {
                        const cb = adhrCheckboxes.nth(c);
                        if (!(await cb.isChecked().catch(() => false))) {
                            await cb.check({ force: true, timeout: 2000 }).catch(async () => {
                                await cb.click({ force: true, timeout: 2000 }).catch(() => { });
                            });
                        }
                    }

                    await page.evaluate(() => {
                        const checkboxes = Array.from(document.querySelectorAll('table tbody tr input[type="checkbox"], input[type="checkbox"][id*="aadhaar" i], input[type="checkbox"][id*="adhr" i]'));
                        for (const cb of checkboxes) {
                            if (!cb.checked) {
                                cb.click();
                                cb.checked = true;
                                cb.dispatchEvent(new Event('change', { bubbles: true }));
                            }
                        }
                    });

                    await page.waitForTimeout(800);
                    await dismissAndConfirmModals('Aadhaar Table Check');
                } catch (e) { }

                await saveAndAdvanceTab('Aadhaar Authentication', 'https://reg.gst.gov.in/registration/auth/newappl/verify', 'Verification');
                await page.waitForTimeout(1500);
                await dismissAndConfirmModals('Aadhaar Authentication Post-Advance');
                continue;
            }

            // Step 10: Verification screen reached
            if (screenInfo.stepKey === 'verification') {
                sendUpdate('Verified: Successfully reached Verification tab step-by-step.');
                isOnVerification = true;
                break;
            }

            // Fallback for any unmapped step: Advance safely
            await saveAndAdvanceTab(currentTabTitle);
        }

        // Verify that the portal is genuinely on the Verification screen before attempting submission
        if (!isOnVerification) {
            isOnVerification = await page.evaluate(() => {
                const text = (document.body.innerText || '').toLowerCase();
                const hasEvc = !!Array.from(document.querySelectorAll('button, input')).find(b => (b.innerText || b.value || '').toUpperCase().includes('EVC'));
                const hasDecl = text.includes('hereby solemnly') || text.includes('affirm and declare') || !!document.querySelector('#chkVerify');
                return hasEvc || hasDecl;
            });
        }

        if (!isOnVerification) {
            try {
                const fs = require('fs');
                const path = require('path');
                await page.screenshot({ path: path.join(__dirname, 'debug_verification_stall.png'), fullPage: true }).catch(() => { });
            } catch (e) { }
            const screenErrors = await page.evaluate(() => {
                const errs = Array.from(document.querySelectorAll('.alert-danger, .toast-error, .help-block.text-danger, .has-error .help-block.text-danger, div[role="alert"], .err, .error'));
                return errs.map(e => (e.innerText || '').trim()).filter(t => t.length > 2);
            });
            const currentTab = await page.evaluate(() => {
                const bc = document.querySelector('ol.breadcrumb, ul.breadcrumb, .breadcrumb');
                if (bc && bc.innerText.trim()) return bc.innerText.trim().replace(/^dashboard\s*>\s*/i, '');
                const active = document.querySelector('ul.nav-tabs:not(.navbar-nav) li.active, .step-wizard .active, .wizard-steps li.active');
                if (active) return active.innerText.trim();
                const panel = document.querySelector('.panel-title, .card-title, h2, h3, h4');
                return panel ? panel.innerText.trim() : 'Active Form Tab';
            });
            const msg = `GST Portal is still on "${currentTab}". Validation blocked: ${screenErrors.join(' | ') || 'Required fields missing or incomplete'}`;
            sendUpdate(`⚠️ ${msg}`);
            sendPortalError(msg);
            throw new Error(msg);
        }

        // Fill Verification details
        const place = (data.verification_place || data.ppob_city || data.district || data.state || '').trim();
        const sigTargetName = ((data.verification_signatory || (data.p1 && data.p1.firstName) || (data.legalName) || '')).trim();

        try {
            // A. Check Declaration Checkbox via both Playwright and DOM
            const chkLoc = page.locator('#chkVerify, input[type="checkbox"][id*="chk" i], input[type="checkbox"][ng-model*="chkVerify" i], input[type="checkbox"][ng-model*="verify" i]').first();
            if (await chkLoc.count() > 0) {
                await chkLoc.scrollIntoViewIfNeeded().catch(() => { });
                await chkLoc.check({ force: true }).catch(async () => {
                    await chkLoc.click({ force: true }).catch(() => { });
                });
            }

            await page.evaluate(() => {
                const chk = document.querySelector('#chkVerify, input[type="checkbox"][id*="chk" i], input[type="checkbox"][name*="decl" i], input[type="checkbox"][name*="verif" i], input[type="checkbox"][ng-model*="chkVerify" i]');
                if (chk) {
                    chk.checked = true;
                    chk.dispatchEvent(new Event('change', { bubbles: true }));
                    chk.dispatchEvent(new Event('click', { bubbles: true }));
                }
                const labels = Array.from(document.querySelectorAll('label, div, span'));
                const declLabel = labels.find(l => {
                    const t = (l.innerText || '').toLowerCase();
                    return t.includes('solemnly') || t.includes('affirm') || t.includes('declare');
                });
                if (declLabel) {
                    const cb = declLabel.querySelector('input[type="checkbox"]') || declLabel.parentElement?.querySelector('input[type="checkbox"]');
                    if (cb && !cb.checked) {
                        cb.checked = true;
                        cb.dispatchEvent(new Event('change', { bubbles: true }));
                        cb.dispatchEvent(new Event('click', { bubbles: true }));
                    }
                }
            });
            await page.waitForTimeout(600);

            // B. Select Authorized Signatory accurately (NEVER use select.first() which hits header dropdowns!)
            let sigSelected = false;
            try {
                const asgSelectLoc = page.locator('select[ng-model*="asg" i], select[ng-model*="signatory" i], select[name*="asg" i], select[id*="asg" i], .form-group:has-text("Signatory") select, [class*="col-"]:has-text("Signatory") select').first();
                if (await asgSelectLoc.count() > 0) {
                    const optCount = await asgSelectLoc.locator('option').count();
                    if (optCount > 1) {
                        const allOpts = await asgSelectLoc.locator('option').allInnerTexts();
                        const matchedOpt = allOpts.find(o => o.toLowerCase().includes(sigTargetName.toLowerCase().split(' ')[0]));
                        if (matchedOpt) {
                            await asgSelectLoc.selectOption({ label: matchedOpt.trim() });
                            sigSelected = true;
                        } else {
                            await asgSelectLoc.selectOption({ index: 1 });
                            sigSelected = true;
                        }
                    }
                }
            } catch (e) { }

            // DOM fallback for Signatory selection
            await page.evaluate((sig) => {
                const selects = Array.from(document.querySelectorAll('select'));
                const s = selects.find(sel => {
                    const txt = (sel.closest('.form-group, [class*="col-"], div')?.innerText || '').toLowerCase();
                    const ng = (sel.getAttribute('ng-model') || '').toLowerCase();
                    return txt.includes('signatory') || ng.includes('asg') || ng.includes('signatory');
                }) || selects.find(sel => sel.options && sel.options.length > 1 && Array.from(sel.options).some(o => (o.text || '').toLowerCase().includes('proprietor') || (o.text || '').toLowerCase().includes(sig.toLowerCase().split(' ')[0])));

                if (s && s.options && s.options.length > 1) {
                    let idx = 1;
                    if (sig) {
                        const mIdx = Array.from(s.options).findIndex(o => (o.text || '').toLowerCase().includes(sig.toLowerCase().split(' ')[0]));
                        if (mIdx > 0) idx = mIdx;
                    }
                    s.selectedIndex = idx;
                    s.value = s.options[idx].value;
                    s.dispatchEvent(new Event('change', { bubbles: true }));
                    s.dispatchEvent(new Event('input', { bubbles: true }));
                    if (window.angular) {
                        try {
                            const sc = window.angular.element(s).scope();
                            if (sc) {
                                if (sc.decdtls) {
                                    sc.decdtls.asgnm = s.value || s.options[idx].text;
                                    sc.decdtls.chkVerify = true;
                                }
                                if (!sc.$$phase) sc.$apply();
                            }
                        } catch (e) { }
                    }
                }
            }, sigTargetName);

            await page.waitForTimeout(600);

            // C. Fill Place
            const placeLoc = page.locator('#place, input[name*="place" i], input[placeholder*="place" i], input[ng-model*="place" i]').first();
            if (await placeLoc.count() > 0) {
                await placeLoc.fill(place).catch(() => { });
                await placeLoc.press('Tab').catch(() => { });
            }

            await page.evaluate((placeVal) => {
                const pInput = document.querySelector('#place, input[name*="place" i], input[placeholder*="place" i], input[ng-model*="place" i]');
                if (pInput) {
                    pInput.value = placeVal;
                    pInput.dispatchEvent(new Event('input', { bubbles: true }));
                    pInput.dispatchEvent(new Event('change', { bubbles: true }));
                }
                if (window.angular) {
                    try {
                        const sc = window.angular.element(pInput || document.body).scope();
                        if (sc) {
                            if (sc.decdtls) {
                                sc.decdtls.place = placeVal;
                                sc.decdtls.chkVerify = true;
                            }
                            if (!sc.$$phase) sc.$apply();
                        }
                    } catch (e) { }
                }
            }, place);

            sendUpdate(`Verification details confirmed (Place: ${place}).`);
        } catch (vErr) {
            sendUpdate(`Verification note: ${vErr.message}`);
        }

        await page.waitForTimeout(1000);

        // Ensure submit buttons are enabled
        await page.evaluate(() => {
            const btns = Array.from(document.querySelectorAll('button, input[type="button"], a.btn'));
            const evcBtn = btns.find(b => /evc/i.test(b.innerText || b.value || ''));
            if (evcBtn) {
                evcBtn.disabled = false;
                evcBtn.removeAttribute('disabled');
                evcBtn.classList.remove('disabled');
            }
        });

        // Trigger SUBMIT WITH EVC button on GST portal
        sendUpdate('Triggering SUBMIT WITH EVC button on GST portal...');
        let evcClicked = false;
        const evcSelectors = [
            'button:has-text("SUBMIT WITH EVC")',
            'button:has-text("Submit with EVC")',
            'button:has-text("EVC")',
            'input[value*="SUBMIT WITH EVC" i]',
            'input[value*="EVC" i]',
            'button[ng-click*="evc" i]',
            'button[ng-click*="EVC" i]'
        ];

        for (const sel of evcSelectors) {
            try {
                const btn = page.locator(sel).first();
                if (await btn.count() > 0) {
                    await btn.scrollIntoViewIfNeeded().catch(() => { });
                    await btn.click({ force: true });
                    evcClicked = true;
                    sendUpdate('Clicked SUBMIT WITH EVC button.');
                    break;
                }
            } catch (e) { }
        }

        if (!evcClicked) {
            evcClicked = await page.evaluate(() => {
                const btns = Array.from(document.querySelectorAll('button, input[type="button"], a.btn'));
                const b = btns.find(btn => (btn.innerText || btn.value || '').toUpperCase().includes('EVC'));
                if (b) {
                    b.disabled = false;
                    b.removeAttribute('disabled');
                    b.classList.remove('disabled');
                    b.click();
                    if (window.angular) {
                        try {
                            const sc = window.angular.element(b).scope();
                            if (sc) {
                                if (typeof sc.submitWithEVC === 'function') sc.submitWithEVC();
                                else if (typeof sc.submitEvc === 'function') sc.submitEvc();
                                else if (typeof sc.submit === 'function') sc.submit('EVC');
                                if (!sc.$$phase) sc.$apply();
                            }
                        } catch (e) { }
                    }
                    return true;
                }
                return false;
            });
            if (evcClicked) sendUpdate('Clicked SUBMIT WITH EVC button via DOM.');
        }

        // Direct GST API: Call official EVC OTP dispatch endpoint (POST /registration/auth/api/evc/otp)
        sendUpdate('Dispatching EVC OTP request via official GST endpoint (POST /registration/auth/api/evc/otp)...');
        try {
            await page.evaluate(async (dId) => {
                const endpoints = [
                    { url: `/registration/auth/api/evc/otp`, body: { draftId: dId, amendFlag: 'APLRG' } },
                    { url: `/registration/auth/api/evc/otp?draftId=${dId}&amendFlag=APLRG`, body: { draftId: dId, amendFlag: 'APLRG' } },
                    { url: `/registration/auth/api/verify/otp?amendFlag=APLRG&draftId=${dId}`, body: {} }
                ];
                for (const ep of endpoints) {
                    try {
                        await fetch(ep.url, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json', 'Accept': 'application/json, text/plain, */*' },
                            body: JSON.stringify(ep.body)
                        }).catch(() => { });
                    } catch (e) { }
                }
            }, capturedDraftId);
        } catch (e) { }

        // Wait for EVC OTP Verification modal (and automatically handle any intermediate confirmation popups)
        sendUpdate('Waiting for GST Portal to dispatch EVC OTP...');
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
                // Check if any REAL error notification appeared (skip static file-upload hint text)
                const errorCandidates = Array.from(document.querySelectorAll('.alert-danger, .toast-error, .has-error .help-block, div[role="alert"]'));
                for (const ec of errorCandidates) {
                    if (ec.offsetParent !== null || window.getComputedStyle(ec).display !== 'none') {
                        const etxt = (ec.innerText || '').trim();
                        if (etxt && etxt.length > 5
                            && !/only maximum file size/i.test(etxt)
                            && !/format is only allowed/i.test(etxt)
                            && !/file with pdf/i.test(etxt)
                            && !/jpeg format is only allowed/i.test(etxt)
                            && !/1 mb is allowed/i.test(etxt)
                            && !/upload photograph/i.test(etxt)
                        ) {
                            return { state: 'portal_error', errorText: etxt };
                        }
                    }
                }
                return { state: 'waiting' };
            });

            if (modalCheck.state === 'clicked_proceed') {
                sendUpdate(`Confirmed dialog on portal: clicked "${modalCheck.text}". Waiting for OTP modal...`);
                await page.waitForTimeout(2000);
            } else if (modalCheck.state === 'otp_modal_ready') {
                evcModalReady = true;
                sendUpdate('✅ EVC OTP modal detected! GST Portal has dispatched the OTP to your Mobile and Email.');
                break;
            } else if (modalCheck.state === 'portal_error') {
                const errText = modalCheck.errorText;
                sendUpdate(`GST Portal validation blocked: ${errText}`);
                sendPortalError(errText);
                throw new Error(`GST Portal validation error: ${errText}`);
            }

            // If 6 seconds elapsed without any modal, retry clicking the EVC button
            if (Date.now() - evcWaitStart > 6000 && !evcModalReady) {
                await page.evaluate(() => {
                    const btns = Array.from(document.querySelectorAll('button, input[type="button"]'));
                    const evc = btns.find(b => (b.innerText || b.value || '').toUpperCase().includes('EVC'));
                    if (evc && !evc.disabled) {
                        evc.click();
                    }
                });
            }

            await page.waitForTimeout(1000);
        }

        if (!evcModalReady) {
            const trailingErr = await page.evaluate(() => {
                const candidates = Array.from(document.querySelectorAll('.alert-danger, .toast-error, .help-block.text-danger, .has-error .help-block.text-danger, div[role="alert"]'));
                const staticIgnore = /only maximum file size|format is only allowed|file with pdf|jpeg format is only allowed|1 mb is allowed|upload photograph/i;
                for (const c of candidates) {
                    if (c.offsetParent !== null || window.getComputedStyle(c).display !== 'none') {
                        const txt = (c.innerText || '').trim();
                        if (txt && txt.length > 3 && !staticIgnore.test(txt)) {
                            return txt;
                        }
                    }
                }
                return null;
            });
            if (trailingErr) {
                sendPortalError(trailingErr);
                throw new Error(`GST Portal validation failed: ${trailingErr}`);
            }
            sendUpdate('Notice: EVC OTP modal did not appear automatically. Application may be processing or awaiting OTP submission.');
        }

        // =========================================================================
        // [પગલું ૫: Manual OTP Entry & ARN Generate]
        // તમે OTP દાખલ કરશો એટલે તરત જ ફાઇનલ સબમિશન થશે અને ARN નંબર મળી જશે!
        // =========================================================================
        sendUpdate('Manual OTP Entry & ARN Generate');

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
                        } catch (e) { }
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
                } catch (e) { }
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

            // Also call official verify/otp and evc/otp endpoints directly
            try {
                await page.evaluate(async ({ dId, otp }) => {
                    const payloads = [
                        { otp: otp, draftId: dId, amendFlag: 'APLRG' },
                        { otpVal: otp, draftId: dId, amendFlag: 'APLRG' },
                        { otp: otp }
                    ];
                    const urls = [
                        `/registration/auth/api/verify/otp?amendFlag=APLRG&draftId=${dId}`,
                        `/registration/auth/api/evc/otp?amendFlag=APLRG&draftId=${dId}`,
                        `/registration/auth/api/evc/otp`
                    ];
                    for (const url of urls) {
                        for (const p of payloads) {
                            try {
                                await fetch(url, {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json, text/plain, */*' },
                                    body: JSON.stringify(p)
                                }).catch(() => { });
                            } catch (e) { }
                        }
                    }
                }, { dId: capturedDraftId, otp: evcOtp });
            } catch (e) { }

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
                const arnMatch = bodyText.match(/\b([A-Z]{2}[0-9]{11,15}[A-Z0-9]?)\b/) ||
                    bodyText.match(/\bARN\s*[:\-]?\s*([A-Za-z0-9]{12,18})\b/i) ||
                    bodyText.match(/\b([0-9]{14,16})\b/);
                if (arnMatch) {
                    const candidate = (arnMatch[1] || arnMatch[0]).trim();
                    if (candidate && candidate.length >= 8 && /\d{4,}/.test(candidate) && !/warning/i.test(candidate)) {
                        arn = candidate;
                    }
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
                        }, (res) => { res.on('data', () => { }); res.on('end', resolve); });
                        req.on('error', () => resolve());
                        req.write(JSON.stringify({
                            status: 'Registered',
                            arn: checkStatus.arn || null
                        }));
                        req.end();
                    });
                    sendUpdate('Application status updated to Registered in database.');
                } catch (e) { }
            }
        }

        sendUpdate('COMPLETED');

    } catch (e) {
        sendUpdate(`Error: ${e.stack || e.message}`);
        console.error(`[Runner Error Stack]:\n${e.stack || e.message}`);
    } finally {
        isExiting = true;
        if (keepaliveTimer) {
            clearInterval(keepaliveTimer);
            keepaliveTimer = null;
        }
        try {
            if (browser && browser.isConnected() && page && !page.isClosed()) {
                sendUpdate('Browser will remain open for 15 minutes for inspection.');
                await page.waitForTimeout(900000);
            }
        } catch (e) { }
    }
}

run().catch(err => {
    sendUpdate(`Error: ${err.stack || err.message}`);
    console.error(`[Runner Fatal Error]:\n${err.stack || err.message}`);
    process.exit(1);
});
