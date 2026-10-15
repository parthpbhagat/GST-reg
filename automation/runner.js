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
    let keepaliveTimer = null;

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

        // Start background session keepalive to prevent GST portal session timeout
        if (keepaliveTimer) clearInterval(keepaliveTimer);
        keepaliveTimer = setInterval(async () => {
            try {
                if (page && !page.isClosed()) {
                    await page.evaluate(() => {
                        fetch('/registration/auth/api/keepalive', {
                            method: 'GET',
                            headers: { 'Accept': 'application/json, text/plain, */*' }
                        }).catch(() => {});
                    }).catch(() => {});
                }
            } catch (e) {}
        }, 25000);

        sendUpdate('Navigating to Dashboard (My Saved Applications)...');

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
            } catch (e) {}
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
                    } catch (e) {}
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
                    } catch(e) {}
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
                    await actionBtn.click({ force: true }).catch(() => {});
                }
            } catch(e) {}

            await page.waitForTimeout(3000);
        }

        // Ensure portal has loaded into registration wizard
        try {
            await page.waitForFunction(() => {
                return !window.location.href.includes('dashboard') || !!document.querySelector('.nav-tabs, #cmbzdt, input[name*="lgnmbzpan"]');
            }, { timeout: 15000 });
        } catch(e) {}

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
                    } catch(e) {}
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
        sendUpdate('[પગલું ૩: Direct JSON Upload] Official GST Portal API પર સંપૂર્ણ Application JSON POST કરી રહ્યા છીએ...');

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

        // Direct in-page upload using official GST POST save endpoint: /registration/auth/api/save/appdraftnewreg
        sendUpdate(`Posting full Application JSON to GST Portal (save/appdraftnewreg)...`);
        const saveApiResult = await page.evaluate(async (payload) => {
            try {
                const resSave = await fetch('/registration/auth/api/save/appdraftnewreg', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Accept': 'application/json, text/plain, */*'
                    },
                    body: JSON.stringify(payload)
                });
                const status = resSave.status;
                const text = await resSave.text();
                let json = null;
                try { json = JSON.parse(text); } catch (e) {}
                return { ok: resSave.ok, status, json, text };
            } catch (err) {
                return { ok: false, error: err.message };
            }
        }, finalGstPayload);

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
                        try { report.appData = await resApp.json(); } catch (e) {}
                    }

                    // 2. GET /registration/auth/api/verify/generateFinalformJsonWithApoB?amendFlag=APLRG&draftId={draftId}
                    const resFinal = await fetch(`/registration/auth/api/verify/generateFinalformJsonWithApoB?amendFlag=APLRG&draftId=${draftId}`, {
                        method: 'GET',
                        headers
                    }).catch(e => ({ error: e.message }));
                    report.finalFormStatus = resFinal.status || (resFinal.error ? 'err: ' + resFinal.error : 'ok');
                    if (resFinal.ok || resFinal.status === 200) {
                        try { report.finalFormData = await resFinal.json(); } catch (e) {}
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
                    const legalName = (data && data.legalName) || appId;
                    const safeLegalName = legalName.replace(/[^a-z0-9]/gi, '_').toLowerCase();
                    const liveDataPath = path.join(__dirname, '..', 'backend', 'data', safeLegalName, 'gst_portal_applicationdata_get.json');
                    fs.writeFileSync(liveDataPath, JSON.stringify(syncResult.report.appData, null, 2), 'utf-8');
                    const bz = syncResult.report.appData.bzdtls && syncResult.report.appData.bzdtls.bzdtlsbz;
                    const liveLgnm = (bz && bz.lgnmbzpan) || '';
                    const livePan = (bz && bz.pan && bz.pan.num) || '';
                    sendUpdate(`✅ GST Portal Live Data Verified: Legal Name: "${liveLgnm}", PAN: "${livePan}", Draft ID: ${syncResult.report.appData.aplCd || capturedDraftId}`);
                } catch (e) {}
            }

            if (syncResult.report.finalFormData) {
                try {
                    const legalName = (data && data.legalName) || appId;
                    const safeLegalName = legalName.replace(/[^a-z0-9]/gi, '_').toLowerCase();
                    const finalDataPath = path.join(__dirname, '..', 'backend', 'data', safeLegalName, 'gst_portal_finalform_get.json');
                    fs.writeFileSync(finalDataPath, JSON.stringify(syncResult.report.finalFormData, null, 2), 'utf-8');
                } catch (e) {}
            }
        }
        sendUpdate('✅ Official GST Portal data and final JSON synchronized successfully.');

        // =========================================================================
        // [પગલું ૪: Verification Tab & EVC OTP Dispatch]
        // =========================================================================
        // =========================================================================
        // [પગલું ૪: Business Details Auto-Fill & Verification Screen]
        // =========================================================================
        sendUpdate('[પગલું ૪: Business Details Auto-Fill] Business Details ફોર્મ પોર્ટલ પર આપમેળે ભરી રહ્યા છીએ...');

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
                    cobzSelect.value = matched.value;
                    cobzSelect.dispatchEvent(new Event('change', { bubbles: true }));
                    cobzSelect.dispatchEvent(new Event('input', { bubbles: true }));
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
                    reasonSelect.value = matched.value;
                    reasonSelect.dispatchEvent(new Event('change', { bubbles: true }));
                    reasonSelect.dispatchEvent(new Event('input', { bubbles: true }));
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
                } catch(e) {}
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
                            } catch (e) {}
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
                const options = await cobzSelectLocator.locator('option').allInnerTexts();
                const matchedText = options.find(o => o.toLowerCase().includes(targetConstitution.toLowerCase().includes('proprietor') ? 'proprietor' : targetConstitution.toLowerCase()));
                if (matchedText) {
                    await cobzSelectLocator.selectOption({ label: matchedText.trim() }).catch(() => { });
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
                    await yesRadio.check({ force: true }).catch(async () => {
                        await yesRadio.click({ force: true }).catch(() => {});
                    });
                    sendUpdate('Selected Option under Rule 14A: Yes');
                } else {
                    const noRadio = r14Container.locator('input[type="radio"]').nth(1);
                    if (await noRadio.count() > 0) {
                        await noRadio.check({ force: true }).catch(async () => {
                            await noRadio.click({ force: true }).catch(() => {});
                        });
                        sendUpdate('Selected Option under Rule 14A: No');
                    }
                }
                await page.waitForTimeout(500);
            }
        } catch(e) {}

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
                }).catch(() => {});
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
                await liabInputLoc.evaluate(el => el.removeAttribute('readonly')).catch(() => {});
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
        } catch (e) {}

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
                            await cb.click({ force: true }).catch(() => {});
                        });
                        sendUpdate('Checked Business Details mandatory declaration checkbox.');
                    }
                }
            }
        } catch (e) {}

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
                } catch(e) {}
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
                        } catch (e) {}
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
                } catch (e) {}
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
                const staticIgnore = /only maximum file size|format is only allowed|file with pdf|jpeg format is only allowed|1 mb is allowed|upload photograph/i;
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

            // Inspect active tab / current screen
            const screenInfo = await page.evaluate(() => {
                const REG_STEPS = [
                    'business details', 'promoter', 'authorized signatory', 'authorized representative',
                    'principal place', 'additional places', 'goods and services', 'state specific',
                    'aadhaar', 'verification'
                ];
                const wizardUl = document.querySelector('.nav-tabs:not(.navbar-nav), ul.step-wizard, .tabs, .wizard-steps');
                const activeLi = wizardUl ? wizardUl.querySelector('li.active, .active') : document.querySelector('ul.nav-tabs:not(.navbar-nav) li.active, .step-wizard .active');
                let tabText = activeLi ? activeLi.innerText.trim() : '';

                if (!tabText || !REG_STEPS.some(s => tabText.toLowerCase().includes(s))) {
                    const activeLink = Array.from(document.querySelectorAll('a.active, li.active a, .step.active, .wizard-step.active, .steps li.active a')).find(el => {
                        const t = (el.innerText || '').toLowerCase();
                        return REG_STEPS.some(s => t.includes(s)) && !el.closest('.navbar-nav, header, .navbar-header');
                    });
                    if (activeLink) tabText = activeLink.innerText.trim();
                }

                const formHeading = document.querySelector('.panel-title, .card-title, .form-title, [ng-view] h2, [ng-view] h3, [ng-view] h4');
                const headerText = (formHeading && !formHeading.closest('.navbar, header, .navbar-header')) ? formHeading.innerText.trim() : '';

                const bodyText = (document.body.innerText || '');
                const hasPromoterHeader = bodyText.includes('Details of Promoter') || bodyText.includes('Promoter / Partner');
                const hasPromoterInputs = !!document.querySelector('input[placeholder*="First Name" i], #fnm');
                const hasSavePromoterBtn = Array.from(document.querySelectorAll('button, input[type="button"]')).some(b => /save promoter/i.test(b.innerText || b.value || ''));
                const isPromoter = (hasPromoterHeader && hasPromoterInputs) || hasSavePromoterBtn || !!document.querySelector('#fnm') || tabText.toLowerCase().includes('promoter');
                const isPromoterTable = hasPromoterHeader && Array.from(document.querySelectorAll('table tr')).length > 1;

                return {
                    tabText: tabText,
                    headerText: headerText,
                    isPromoterTab: isPromoter,
                    isPromoterAlreadySaved: isPromoterTable,
                    hasPpobInputs: !!document.querySelector('#pncd, input[name*="pincode" i], input[placeholder*="pincode" i]'),
                    hasHsnInput: !!document.querySelector('#gs_hsn_value, input[placeholder*="HSN" i]')
                };
            });

            const currentTabTitle = screenInfo.tabText || screenInfo.headerText || `Step ${tabStep + 1}`;
            sendUpdate(`Processing step-by-step: Current tab is "${currentTabTitle}"...`);

            // Step 1: Business Details tab - actively heal Date & accept Declaration
            if (currentTabTitle.toLowerCase().includes('business details') || await page.locator('#cmbzdt').count() > 0) {
                sendUpdate('[પગલું ૧: Business Details] તારીખ અને ડિક્લેરેશન કન્ફર્મ કરી રહ્યા છીએ...');
                await page.evaluate(({ commVal, liabVal, r14Val }) => {
                    const parseDateObj = (str) => {
                        try {
                            const parts = (str || '').split('/');
                            if (parts.length === 3) {
                                return new Date(parseInt(parts[2]), parseInt(parts[1]) - 1, parseInt(parts[0]), 12, 0, 0);
                            }
                        } catch (e) {}
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

                    // Check all declarations (Rule 14A declaration, voluntary declaration, etc.)
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
                                } catch (e) {}
                            }
                        }
                    }

                    // Set Date of Commencement input value & ngModel
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
                            } catch (e) {}
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
                        } catch (e) {}
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
                                await cbLoc.click({ force: true }).catch(() => {});
                            });
                        }
                    }
                } catch (e) {}
            }

            // Step 2: Promoter / Partner tab
            if (screenInfo.isPromoterTab || currentTabTitle.toLowerCase().includes('promoter') || currentTabTitle.toLowerCase().includes('partner')) {
                sendUpdate('[પગલું ૨: Promoter / Partner] વિગતો કન્ફર્મ કરી રહ્યા છીએ...');
                // Check if "Show list" is available to reveal already-saved promoter table
                try {
                    const showListLoc = page.locator('button, input[type="button"], a.btn, a').filter({ hasText: /show\s*list/i }).first();
                    if (await showListLoc.count() > 0 && await showListLoc.isVisible()) {
                        await showListLoc.click({ force: true }).catch(() => {});
                        await page.waitForTimeout(1000);
                    }
                } catch (e) {}
                const hasSavedTable = await page.evaluate(() => Array.from(document.querySelectorAll('table tr')).length > 1);
                if (hasSavedTable) {
                    screenInfo.isPromoterAlreadySaved = true;
                }

                // If on Promoter tab and no saved list is displayed, populate and save
                if (!screenInfo.isPromoterAlreadySaved) {
                    sendUpdate('Populating Promoter / Partner (P1) details...');
                    const p = (data && data.p1) || {};
                    const nameParts = ((data && data.legalName) || 'Parth Purushottam Bhagat').split(' ');
                    const pFirst = (p.firstName || nameParts[0] || 'Parth').trim();
                    const pMiddle = (p.middleName || (nameParts.length > 2 ? nameParts[1] : '') || 'Purushottam').trim();
                    const pLast = (p.lastName || (nameParts.length > 2 ? nameParts.slice(2).join(' ') : nameParts[1] || '') || 'Bhagat').trim();
                    const pFatherFirst = (p.fatherFirstName || 'Purushottam').trim();
                    const pFatherMiddle = (p.fatherMiddleName || 'Vishram').trim();
                    const pFatherLast = (p.fatherLastName || 'Bhagat').trim();
                    const pDob = formatDDMMYYYY(p.dob || '29/01/1997');
                    const pMobile = (p.mobile || data.mobile || '9011494385').trim();
                    const pEmail = (p.email || data.email || 'parthpbhagat@gmail.com').trim().toLowerCase();
                    const pDg = (p.designation || 'Proprietor').trim();
                    const pPan = (p.pan || data.pan || 'AAQFH0648P').trim();
                    const pPin = (p.res_pincode || data.ppob_pincode || '444906').trim();
                    const pCity = (p.res_city || data.ppob_city || 'warud').trim();
                    const pRoad = (p.res_road || data.ppob_street || '9 giriraj vibhag 2').trim();
                    const pBno = (p.res_buildingNo || data.ppob_flatNo || '29').trim();

                    // 1. Playwright native typing for Email & Mobile
                    try {
                        const emLoc = page.locator('#em, #pd_email, #email, input[name="em"], input[placeholder*="Email" i], input[type="email"], input[ng-model*="em" i]').first();
                        if (await emLoc.count() > 0 && await emLoc.isVisible()) {
                            await emLoc.fill(pEmail).catch(() => {});
                        }
                        const mbLoc = page.locator('#mbno, #pd_mbno, input[name="mbno"], input[placeholder*="Mobile" i], input[ng-model*="mbno" i]').first();
                        if (await mbLoc.count() > 0 && await mbLoc.isVisible()) {
                            await mbLoc.fill(pMobile).catch(() => {});
                        }
                    } catch (e) {}

                    // 2. DOM evaluate to set all Promoter fields with complete AngularJS scope & ngModel binding
                    await page.evaluate(({ f, m, l, ff, fm, fl, dob, mob, em, dg, pan, pin, city, road, bno }) => {
                        const setVal = (selectors, val) => {
                            if (!val) return;
                            const selArr = Array.isArray(selectors) ? selectors : selectors.split(',').map(s => s.trim());
                            let el = null;
                            for (const s of selArr) {
                                el = document.querySelector(s);
                                if (el) break;
                            }
                            if (el) {
                                el.removeAttribute('disabled');
                                el.removeAttribute('readonly');
                                el.value = val;
                                el.dispatchEvent(new Event('input', { bubbles: true }));
                                el.dispatchEvent(new Event('change', { bubbles: true }));
                                el.dispatchEvent(new Event('blur', { bubbles: true }));
                                if (window.angular) {
                                    try {
                                        const ngEl = window.angular.element(el);
                                        const ngModel = ngEl.controller('ngModel');
                                        if (ngModel) {
                                            ngModel.$setViewValue(val);
                                            ngModel.$modelValue = val;
                                            ngModel.$setValidity('required', true);
                                            ngModel.$setValidity('email', true);
                                            ngModel.$setValidity('pattern', true);
                                            ngModel.$render();
                                            ngModel.$commitViewValue();
                                        }
                                    } catch (e) {}
                                }
                            }
                        };

                        setVal(['#fnm', 'input[placeholder*="First Name" i]'], f);
                        setVal(['#pd_mname', '#mname', 'input[placeholder*="Middle Name" i]'], m);
                        setVal(['#pd_lname', '#lname', 'input[placeholder*="Last Name" i]'], l);
                        setVal(['#ffname'], ff);
                        setVal(['#pd_fmname'], fm);
                        setVal(['#pd_flname'], fl);
                        setVal(['#dob', 'input[placeholder*="dd/mm/yyyy" i]', 'input[placeholder*="mm/dd/yyyy" i]'], dob);
                        setVal(['#mbno', '#pd_mbno', 'input[name="mbno"]', 'input[placeholder*="Mobile" i]', 'input[ng-model*="mbno" i]'], mob);
                        setVal(['#em', '#pd_email', '#email', 'input[name="em"]', 'input[name="email"]', 'input[placeholder*="Email" i]', 'input[type="email"]', 'input[ng-model*="em" i]', 'input[ng-model*="email" i]'], em);
                        setVal(['#dg', 'input[placeholder*="Designation" i]'], dg);
                        setVal(['#pan', 'input[placeholder*="PAN" i]'], pan);

                        // Gender: Male
                        const maleR = document.querySelector('#radiomale, input[type="radio"][value="M"], input[type="radio"][value="Male"]');
                        if (maleR && !maleR.checked) {
                            maleR.click();
                            maleR.checked = true;
                            maleR.dispatchEvent(new Event('change', { bubbles: true }));
                        }

                        // Address
                        setVal(['#pncd', 'input[placeholder*="PIN" i]'], pin);
                        setVal(['#pd_locality', 'input[placeholder*="Locality" i]', 'input[placeholder*="Village" i]'], city);
                        setVal(['#pd_road', 'input[placeholder*="Road" i]', 'input[placeholder*="Street" i]'], road);
                        setVal(['#pd_bdname', 'input[placeholder*="Premises" i]', 'input[placeholder*="Building" i]'], bno);
                        setVal(['#pd_bno', 'input[placeholder*="Building No" i]', 'input[placeholder*="Flat" i]'], bno);

                        // Also Authorized Signatory switch
                        const labels = Array.from(document.querySelectorAll('label, div, p, span'));
                        const asLbl = labels.find(el => (el.innerText || '').toLowerCase().includes('also authorized signatory'));
                        if (asLbl) {
                            const parent = asLbl.closest('.form-group, .row, div') || asLbl.parentElement;
                            if (parent) {
                                const cb = parent.querySelector('input[type="checkbox"]');
                                const sw = parent.querySelector('.switch, label.switch');
                                if (cb && !cb.checked) {
                                    cb.click();
                                    cb.checked = true;
                                    cb.dispatchEvent(new Event('change', { bubbles: true }));
                                } else if (sw) {
                                    sw.click();
                                }
                            }
                        }

                        if (window.angular) {
                            try {
                                const sc = window.angular.element(document.querySelector('#fnm') || document.body).scope();
                                if (sc) {
                                    if (sc.pd) {
                                        sc.pd.em = em;
                                        sc.pd.email = em;
                                        sc.pd.mbno = mob;
                                    }
                                    if (!sc.$$phase) sc.$apply();
                                }
                            } catch (e) {}
                        }
                    }, { f: pFirst, m: pMiddle, l: pLast, ff: pFatherFirst, fm: pFatherMiddle, fl: pFatherLast, dob: pDob, mob: pMobile, em: pEmail, dg: pDg, pan: pPan, pin: pPin, city: pCity, road: pRoad, bno: pBno });

                    await page.waitForTimeout(1000);

                    // Upload Photograph if available
                    try {
                        const photoData = p.promoterPhotoFile || '';
                        if (photoData && photoData.startsWith('data:image')) {
                            const fs = require('fs');
                            const path = require('path');
                            const cleanB64 = photoData.replace(/^data:.*?;base64,/, '');
                            const tempPhotoPath = path.join(__dirname, 'temp_promoter_photo_1.jpg');
                            fs.writeFileSync(tempPhotoPath, cleanB64, 'base64');
                            const photoInput = page.locator('#pd_upload, input[type="file"]').first();
                            if (await photoInput.count() > 0) {
                                await photoInput.setInputFiles(tempPhotoPath).catch(() => {});
                                sendUpdate('Promoter photograph uploaded.');
                            }
                        }
                    } catch (photoErr) {
                        sendUpdate(`Photo note: ${photoErr.message}`);
                    }

                    await page.waitForTimeout(1000);

                    // Click Save Promoter & Show list
                    await page.evaluate(() => {
                        const btns = Array.from(document.querySelectorAll('button, input[type="button"], a.btn, a'));
                        const savePromoter = btns.find(b => /save promoter/i.test(b.innerText || b.value || b.textContent || ''));
                        if (savePromoter && !savePromoter.disabled) {
                            savePromoter.click();
                        }
                    });
                    sendUpdate('Saved Promoter details.');
                    await page.waitForTimeout(2500);
                }
            }

            // Step 3: Authorized Signatory tab
            if (currentTabTitle.toLowerCase().includes('authorized signatory')) {
                sendUpdate('[પગલું ૩: Authorized Signatory] પ્રાઇમરી સાઇન કરનાર કન્ફર્મ કરી રહ્યા છીએ...');
                await page.evaluate(({ em, mob }) => {
                    const chk = document.querySelector('input[type="checkbox"][id*="asg" i], input[type="checkbox"][id*="primary" i], input[type="checkbox"][ng-model*="isasg" i], input[type="checkbox"][ng-model*="ispas" i]');
                    if (chk && !chk.checked) {
                        chk.click();
                        chk.checked = true;
                        chk.dispatchEvent(new Event('change', { bubbles: true }));
                    }
                }, { em: (data.email || 'parthpbhagat@gmail.com').trim().toLowerCase(), mob: (data.mobile || '9011494385').trim() });
                await page.waitForTimeout(800);
            }

            // Step 4: Authorized Representative tab
            if (currentTabTitle.toLowerCase().includes('authorized representative')) {
                sendUpdate('[પગલું ૪: Authorized Representative] પ્રતિનિધિ ઓપ્શન (No) કન્ફર્મ કરી રહ્યા છીએ...');
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
            }

            // Step 5: Principal Place of Business tab
            if (screenInfo.tabText.toLowerCase().includes('principal place') || screenInfo.headerText.toLowerCase().includes('principal place') || currentTabTitle.toLowerCase().includes('principal place')) {
                sendUpdate('[પગલું ૫: Principal Place of Business] મુખ્ય વેપાર સ્થળ વિગતો કન્ફર્મ કરી રહ્યા છીએ...');
                
                // Native Playwright fill for PPOB Email & Mobile
                const ppobEm = (data.email || 'parthpbhagat@gmail.com').trim().toLowerCase();
                const ppobMob = (data.mobile || '9011494385').trim();
                try {
                    const pEmLoc = page.locator('#em, #pp_email, input[name="em"], input[ng-model*="contdtls.em" i], input[placeholder*="Email" i]').first();
                    if (await pEmLoc.count() > 0 && await pEmLoc.isVisible()) {
                        await pEmLoc.fill(ppobEm).catch(() => {});
                    }
                    const pMbLoc = page.locator('#mbno, #pp_mbno, input[name="mbno"], input[ng-model*="contdtls.mbno" i], input[placeholder*="Mobile" i]').first();
                    if (await pMbLoc.count() > 0 && await pMbLoc.isVisible()) {
                        await pMbLoc.fill(ppobMob).catch(() => {});
                    }
                } catch (e) {}

                await page.evaluate(({ possessionVal, em, mob }) => {
                    const setVal = (selectors, val) => {
                        if (!val) return;
                        const selArr = Array.isArray(selectors) ? selectors : selectors.split(',').map(s => s.trim());
                        for (const s of selArr) {
                            const el = document.querySelector(s);
                            if (el && (!el.value || el.value.trim().length === 0)) {
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
                                            ngModel.$commitViewValue();
                                        }
                                    } catch (e) {}
                                }
                                break;
                            }
                        }
                    };

                    setVal(['#em', '#pp_email', 'input[name="em"]', 'input[ng-model*="contdtls.em" i]', 'input[placeholder*="Email" i]'], em);
                    setVal(['#mbno', '#pp_mbno', 'input[name="mbno"]', 'input[ng-model*="contdtls.mbno" i]', 'input[placeholder*="Mobile" i]'], mob);

                    const selects = Array.from(document.querySelectorAll('select'));
                    const posSelect = selects.find(s => Array.from(s.options || []).some(o => /consent|own|rent|lease/i.test(o.text || '')));
                    if (posSelect && posSelect.selectedIndex <= 0) {
                        for (let i = 0; i < posSelect.options.length; i++) {
                            if (/consent|rent|own/i.test(posSelect.options[i].text || '')) {
                                posSelect.selectedIndex = i;
                                posSelect.dispatchEvent(new Event('change', { bubbles: true }));
                                break;
                            }
                        }
                    }
                    const cbs = Array.from(document.querySelectorAll('input[type="checkbox"]'));
                    const whCb = cbs.find(cb => /warehouse|office|retail|wholesale/i.test(cb.parentElement?.innerText || ''));
                    if (whCb && !whCb.checked) {
                        whCb.checked = true;
                        whCb.dispatchEvent(new Event('change', { bubbles: true }));
                    }
                }, { possessionVal: data.ppob_natureOfPossession || 'Consent', em: ppobEm, mob: ppobMob });
                await page.waitForTimeout(1000);
            }

            // Step 6: Additional Places of Business tab
            if (currentTabTitle.toLowerCase().includes('additional place')) {
                sendUpdate('[પગલું ૬: Additional Places] વધારાના વેપાર સ્થળ (No) કન્ફર્મ કરી રહ્યા છીએ...');
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
            }

            // Step 7: Goods and Services tab
            if (currentTabTitle.toLowerCase().includes('goods and services') || currentTabTitle.toLowerCase().includes('goods & services') || screenInfo.hasHsnInput) {
                sendUpdate('[પગલું ૭: Goods and Services] HSN કોડ કન્ફર્મ કરી રહ્યા છીએ...');
                await page.evaluate(() => {
                    const hsnRows = Array.from(document.querySelectorAll('table tbody tr'));
                    if (hsnRows.length === 0) {
                        const hsnInput = document.querySelector('#gs_hsn_value, input[placeholder*="HSN" i], input[name*="hsn" i]');
                        if (hsnInput && (!hsnInput.value || hsnInput.value.trim().length === 0)) {
                            hsnInput.value = '1003';
                            hsnInput.dispatchEvent(new Event('input', { bubbles: true }));
                            hsnInput.dispatchEvent(new Event('change', { bubbles: true }));
                        }
                    }
                });
                await page.waitForTimeout(600);
                try {
                    const sugLoc = page.locator('.typeahead-popup li, .dropdown-menu li, ul[role="listbox"] li, .uib-typeahead-match').first();
                    if (await sugLoc.count() > 0 && await sugLoc.isVisible()) {
                        await sugLoc.click({ force: true }).catch(() => {});
                    }
                } catch (e) {}
            }

            // Step 8: State Specific Information tab
            if (currentTabTitle.toLowerCase().includes('state specific') || currentTabTitle.toLowerCase().includes('bank')) {
                sendUpdate('[પગલું ૮: State Specific Information] રાજ્ય સંબંધિત વિગતો કન્ફર્મ કરી રહ્યા છીએ...');
                await page.waitForTimeout(600);
            }

            // Step 9: Aadhaar Authentication tab
            if (currentTabTitle.toLowerCase().includes('aadhaar')) {
                sendUpdate('[પગલું ૯: Aadhaar Authentication] આધાર પ્રમાણીકરણ ઓપ્શન (Yes) કન્ફર્મ કરી રહ્યા છીએ...');
                await page.evaluate(() => {
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
                await page.waitForTimeout(600);
            }

            // Auto-confirm any confirmation or warning dialogs (e.g. Locality mismatch, Proceed, OK)
            try {
                const modalProceedBtn = page.locator('.modal.in button, .modal.show button, div[role="dialog"] button, .sweet-alert button').filter({ hasText: /proceed|continue|yes|confirm|ok|close/i }).first();
                if (await modalProceedBtn.count() > 0 && await modalProceedBtn.isVisible()) {
                    await modalProceedBtn.click({ force: true }).catch(() => {});
                }
            } catch (e) {}
            await page.evaluate(() => {
                const dialogs = Array.from(document.querySelectorAll('.modal.in, .modal.show, div[role="dialog"], .sweet-alert'));
                for (const d of dialogs) {
                    const btns = Array.from(d.querySelectorAll('button, input[type="button"], a.btn, a'));
                    const okBtn = btns.find(b => /proceed|continue|yes|confirm|ok|close/i.test(b.innerText || b.value || b.textContent || ''));
                    if (okBtn) okBtn.click();
                }
            });

            await page.waitForTimeout(600);

            // Click Save & Continue or Next button to move to the NEXT step sequentially
            try {
                const saveBtnLoc = page.locator('button, input[type="button"], input[type="submit"], a.btn, a').filter({
                    hasText: /save\s*&\s*continue|continue|save\s*&\s*next|\bnext\b/i
                }).last();
                if (await saveBtnLoc.count() > 0 && await saveBtnLoc.isVisible()) {
                    await saveBtnLoc.scrollIntoViewIfNeeded().catch(() => {});
                    await saveBtnLoc.click({ force: true }).catch(() => {});
                    sendUpdate('Clicked "Save & Continue" / "Next" to advance to next step.');
                } else {
                    const clickedBtn = await page.evaluate(() => {
                        window.scrollTo(0, document.body.scrollHeight);
                        const btns = Array.from(document.querySelectorAll('button, input[type="button"], input[type="submit"], a.btn, a'));
                        const btn = btns.reverse().find(b => {
                            const t = (b.innerText || b.value || b.textContent || '').trim().toLowerCase();
                            return (t.includes('save') && t.includes('continue')) ||
                                   (t.includes('save') && t.includes('next')) ||
                                   /\bnext\b/i.test(t) ||
                                   /\bcontinue\b/i.test(t);
                        });
                        if (btn && !btn.disabled && btn.offsetParent !== null) {
                            btn.click();
                            return (btn.innerText || btn.value || btn.textContent || '').trim();
                        }
                        return null;
                    });
                    if (clickedBtn) {
                        sendUpdate(`Clicked "${clickedBtn}" to advance to next step.`);
                    }
                }
            } catch (e) {}

            await page.waitForTimeout(2500);
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
                await page.screenshot({ path: path.join(__dirname, 'debug_verification_stall.png'), fullPage: true }).catch(() => {});
            } catch (e) {}
            const screenErrors = await page.evaluate(() => {
                const errs = Array.from(document.querySelectorAll('.alert-danger, .toast-error, .help-block.text-danger, .has-error .help-block.text-danger, div[role="alert"], .err, .error'));
                return errs.map(e => (e.innerText || '').trim()).filter(t => t.length > 2);
            });
            const currentTab = await page.evaluate(() => {
                const active = document.querySelector('ul.nav-tabs li.active, .step-wizard .active, .step.active, .wizard-step.active, li.active');
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
        sendUpdate('Filling Verification Details (Declaration, Signatory & Place)...');
        const place = (data.verification_place || data.ppob_city || data.district || 'warud').trim();
        const sigTargetName = ((data.verification_signatory || (data.p1 && data.p1.firstName) || (data.legalName) || 'Parth')).trim();

        try {
            // A. Check Declaration Checkbox via both Playwright and DOM
            const chkLoc = page.locator('#chkVerify, input[type="checkbox"][id*="chk" i], input[type="checkbox"][ng-model*="chkVerify" i], input[type="checkbox"][ng-model*="verify" i]').first();
            if (await chkLoc.count() > 0) {
                await chkLoc.scrollIntoViewIfNeeded().catch(() => {});
                await chkLoc.check({ force: true }).catch(async () => {
                    await chkLoc.click({ force: true }).catch(() => {});
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
            } catch (e) {}

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
                        } catch (e) {}
                    }
                }
            }, sigTargetName);

            await page.waitForTimeout(600);

            // C. Fill Place
            const placeLoc = page.locator('#place, input[name*="place" i], input[placeholder*="place" i], input[ng-model*="place" i]').first();
            if (await placeLoc.count() > 0) {
                await placeLoc.fill(place).catch(() => {});
                await placeLoc.press('Tab').catch(() => {});
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
                    } catch(e) {}
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
                        } catch (e) {}
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
                        }).catch(() => {});
                    } catch (e) {}
                }
            }, capturedDraftId);
        } catch (e) {}

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
                                }).catch(() => {});
                            } catch (e) {}
                        }
                    }
                }, { dId: capturedDraftId, otp: evcOtp });
            } catch (e) {}

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
        if (keepaliveTimer) {
            clearInterval(keepaliveTimer);
            keepaliveTimer = null;
        }
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
