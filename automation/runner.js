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
            const partAUrl = (automationMode === 'multistate') ? 'https://reg.gst.gov.in/registration/msr' : 'https://reg.gst.gov.in/registration/';
            sendUpdate(`Navigating to official GST portal (${automationMode === 'multistate' ? 'Multi-State Part A' : 'Part A'} registration)...`);
            try {
                await page.goto(partAUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
            } catch (e) {
                if (automationMode === 'multistate') {
                    sendUpdate('Fallback navigating to standard registration URL...');
                    await page.goto('https://reg.gst.gov.in/registration/', { waitUntil: 'domcontentloaded', timeout: 60000 });
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
                } catch (e) {}
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
                const trnPayload = (automationMode === 'multistate') 
                    ? { trn: trnText, masterTrn: trnText } 
                    : { trn: trnText };
                req.write(JSON.stringify(trnPayload));
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

            try {
                const path = require('path');
                const legalName = (data && data.legalName) || appId;
                const safeLegalName = legalName.replace(/[^a-z0-9]/gi, '_').toLowerCase();
                const dirPath = path.join(__dirname, '..', 'backend', 'data', safeLegalName);
                if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
                fs.writeFileSync(path.join(dirPath, 'gst_multistate_common_payload.json'), JSON.stringify(msrCommonPayload, null, 2), 'utf-8');
            } catch (e) {}

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
                    try { json = JSON.parse(text); } catch (e) {}
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

                try {
                    const path = require('path');
                    const legalName = (data && data.legalName) || appId;
                    const safeLegalName = legalName.replace(/[^a-z0-9]/gi, '_').toLowerCase();
                    const dirPath = path.join(__dirname, '..', 'backend', 'data', safeLegalName);
                    fs.writeFileSync(path.join(dirPath, `gst_multistate_state_${stCode}_payload.json`), JSON.stringify(statePayload, null, 2), 'utf-8');
                } catch (e) {}

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
                        try { json = JSON.parse(text); } catch (e) {}
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
                    }, (res) => { res.on('data', () => {}); res.on('end', resolve); });
                    req.on('error', () => resolve());
                    req.write(JSON.stringify({ masterTrn: trnText, stateTrns: stateTrnMap }));
                    req.end();
                });
                sendUpdate(`[Multi-State] State TRNs synchronized to DB: ${JSON.stringify(stateTrnMap)}`);
            } catch (e) {}
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

            // Common helper: dismiss and auto-confirm any open modal/dialog intelligently
            const dismissAndConfirmModals = async (contextLabel = '') => {
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
                            if (dText.includes('add') && (dText.includes('other') || dText.includes('more') || dText.includes('promoter') || dText.includes('partner') || dText.includes('director'))) {
                                const noBtn = btns.find(b => /^\s*no\s*$/i.test((b.innerText || b.value || '').trim()) || /\bno\b/i.test(b.innerText || b.value || ''));
                                if (noBtn) {
                                    noBtn.removeAttribute('disabled');
                                    noBtn.disabled = false;
                                    noBtn.click();
                                    return { action: 'clicked_no', text: 'NO (No more promoters to add)', raw: dText.slice(0, 120) };
                                }
                            }

                            // 2. Check if this is an error alert modal
                            if (dText.includes('error') || dText.includes('mandatory') || dText.includes('invalid') || dText.includes('required') || dText.includes('cannot') || dText.includes('failed')) {
                                const closeBtn = btns.find(b => /close|ok/i.test(b.innerText || b.value || ''));
                                const errSummary = dText.replace(/\s+/g, ' ').slice(0, 150);
                                if (closeBtn) {
                                    closeBtn.click();
                                }
                                return { action: 'error_alert', text: `ERROR_MODAL: ${errSummary}`, raw: dText };
                            }

                            // 3. Normal confirmation modal (geocoding warning, save confirmation, proceed, have you entered all promoters, etc.):
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
                        sendUpdate(`Modal prompt handled: [${result.text}] (Dialog: "${result.raw}")`);
                        await page.waitForTimeout(800);
                    } else {
                        break;
                    }
                }
            };

            // Common helper: Click Save & Continue and auto-confirm modals to grant tickmark (✓)
            const saveAndAdvanceTab = async (stepLabel) => {
                // Ensure buttons enabled
                await page.evaluate(() => {
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

                // Click Save & Continue button with highest priority on exact SAVE & CONTINUE
                const exactSaveContinue = page.locator('button:has-text("SAVE & CONTINUE"):visible, button:has-text("Save & Continue"):visible, input[value="SAVE & CONTINUE"]:visible, input[value="Save & Continue"]:visible').last();
                if (await exactSaveContinue.count() > 0) {
                    await exactSaveContinue.click({ force: true, timeout: 3000 }).catch(() => {});
                    sendUpdate(`Clicked "Save & Continue" on ${stepLabel} to persist and complete step.`);
                } else {
                    const saveLoc = page.locator('button:has-text("Continue"):visible, button.btn-primary:has-text("SAVE"):visible, input[value="Continue"]:visible').last();
                    if (await saveLoc.count() > 0) {
                        await saveLoc.click({ force: true, timeout: 3000 }).catch(() => {});
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

                // Auto-confirm prompts smartly
                await dismissAndConfirmModals(stepLabel);
                await page.waitForTimeout(2000);

                // Check and log any visible validation errors on this step
                const currentErrors = await page.evaluate(() => {
                    const errEls = Array.from(document.querySelectorAll('.alert-danger, .toast-error, .help-block.text-danger, .has-error .help-block.text-danger, div[role="alert"]'));
                    const staticIgnore = /only maximum file size|format is only allowed|file with pdf|jpeg format is only allowed|1 mb is allowed|upload photograph/i;
                    return errEls.map(e => (e.innerText || '').trim()).filter(t => t.length > 3 && !staticIgnore.test(t));
                });
                if (currentErrors.length > 0) {
                    sendUpdate(`Validation note on ${stepLabel}: ${currentErrors.join(' | ')}`);
                }
            };

            // Inspect active tab / current screen via Breadcrumb, Heading, and Form Content
            const screenInfo = await page.evaluate(() => {
                // 1. Breadcrumb: The most reliable indicator on the GST portal
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
            });

            const currentTabTitle = screenInfo.stepKey !== 'unknown' ? screenInfo.stepKey : (screenInfo.breadcrumb || screenInfo.headerText || screenInfo.tabText || `Step ${tabStep + 1}`);
            sendUpdate(`Processing step-by-step: Current tab is "${currentTabTitle}"...`);

            // Step 1: Business Details tab
            if (screenInfo.stepKey === 'business details' || currentTabTitle.includes('business details') || await page.locator('#cmbzdt').count() > 0) {
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
                                } catch (e) {}
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

                await saveAndAdvanceTab('Business Details');
                continue;
            }

            // Step 2: Promoter / Partner tab
            if (screenInfo.stepKey === 'promoter') {
                sendUpdate('[પગલું ૨: Promoter / Partner] વિગતો કન્ફર્મ કરી રહ્યા છીએ...');

                // Check if table already has saved rows
                const hasSavedTable = await page.evaluate(() => {
                    const rows = Array.from(document.querySelectorAll('table tbody tr')).filter(r => (r.innerText || '').trim().length > 5);
                    return rows.length > 0;
                });

                if (hasSavedTable) {
                    sendUpdate('Promoter already present in table. Advancing via "SAVE & CONTINUE"...');
                    await saveAndAdvanceTab('Promoter / Partner');
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
                                await addNewBtn.click({ force: true }).catch(() => {});
                                await page.waitForTimeout(2000);
                            } else {
                                await page.evaluate(() => {
                                    const btns = Array.from(document.querySelectorAll('button, input[type="button"], a.btn, a'));
                                    const b = btns.find(x => /add\s*new/i.test(x.innerText || x.value || ''));
                                    if (b) b.click();
                                });
                                await page.waitForTimeout(2000);
                            }
                        } catch (e) {}
                    }

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
                    const pState = (p.res_state || data.state || 'Maharashtra').trim();
                    const pDist = (p.res_district || data.district || 'Amravati').trim();
                    const pCity = (p.res_city || data.ppob_city || 'warud').trim();
                    const pRoad = (p.res_road || data.ppob_street || '9 giriraj vibhag 2').trim();
                    const pBnm = (p.res_buildingName || data.ppob_building || 'Parth P Bhagat').trim();
                    const pBno = (p.res_buildingNo || data.ppob_flatNo || '29').trim();
                    const pGender = (p.gender || data.gender || 'Male').trim();
                    const pGenderCode = pGender.toLowerCase().startsWith('f') ? 'F' : 'M';

                    // 1. Playwright native interaction for Personal Information & Father's Name
                    try {
                        const fnInputs = page.locator('input[placeholder*="First Name" i]');
                        const mnInputs = page.locator('input[placeholder*="Middle Name" i]');
                        const lnInputs = page.locator('input[placeholder*="Last Name" i]');

                        // Row 1: Person Name
                        if (await fnInputs.count() > 0) {
                            const val = await fnInputs.first().inputValue().catch(() => '');
                            if (!val) await fnInputs.first().fill(pFirst, { timeout: 2000 }).catch(() => {});
                        }
                        if (await mnInputs.count() > 0) {
                            const val = await mnInputs.first().inputValue().catch(() => '');
                            if (!val) await mnInputs.first().fill(pMiddle, { timeout: 2000 }).catch(() => {});
                        }
                        if (await lnInputs.count() > 0) {
                            const val = await lnInputs.first().inputValue().catch(() => '');
                            if (!val) await lnInputs.first().fill(pLast, { timeout: 2000 }).catch(() => {});
                        }

                        // Row 2: Father's Name (2nd row of name inputs)
                        if (await fnInputs.count() > 1) {
                            await fnInputs.nth(1).scrollIntoViewIfNeeded().catch(() => {});
                            await fnInputs.nth(1).fill(pFatherFirst, { timeout: 2000 }).catch(() => {});
                        } else {
                            const fLoc = page.locator('input[name*="fhfn" i], input[ng-model*="fhfn" i], #fhfn, #ffname').first();
                            if (await fLoc.count() > 0) await fLoc.fill(pFatherFirst, { timeout: 2000 }).catch(() => {});
                        }

                        if (await mnInputs.count() > 1) {
                            await mnInputs.nth(1).fill(pFatherMiddle, { timeout: 2000 }).catch(() => {});
                        } else {
                            const mLoc = page.locator('input[name*="fhmn" i], input[ng-model*="fhmn" i], #fhmn, #pd_fmname').first();
                            if (await mLoc.count() > 0) await mLoc.fill(pFatherMiddle, { timeout: 2000 }).catch(() => {});
                        }

                        if (await lnInputs.count() > 1) {
                            await lnInputs.nth(1).fill(pFatherLast, { timeout: 2000 }).catch(() => {});
                        } else {
                            const lLoc = page.locator('input[name*="fhln" i], input[ng-model*="fhln" i], #fhln, #pd_flname').first();
                            if (await lLoc.count() > 0) await lLoc.fill(pFatherLast, { timeout: 2000 }).catch(() => {});
                        }

                        // Date of Birth
                        const dobLoc = page.locator('input[placeholder*="DD/MM/YYYY" i], input[placeholder*="MM/DD/YYYY" i], input[id*="dob" i], input[name*="dob" i]').first();
                        if (await dobLoc.count() > 0) {
                            await dobLoc.scrollIntoViewIfNeeded().catch(() => {});
                            await dobLoc.click({ force: true, timeout: 2000 }).catch(() => {});
                            await dobLoc.fill(pDob, { timeout: 2000 }).catch(() => {});
                            await dobLoc.press('Tab').catch(() => {});
                        }

                        // Mobile Number
                        const mbLoc = page.locator('input[placeholder*="Mobile" i], input[name*="mbno" i], #mbno, #pd_mbno').first();
                        if (await mbLoc.count() > 0) {
                            await mbLoc.scrollIntoViewIfNeeded().catch(() => {});
                            await mbLoc.fill(pMobile, { timeout: 2000 }).catch(() => {});
                            await mbLoc.press('Tab').catch(() => {});
                        }

                        // Email Address
                        const emLoc = page.locator('input[placeholder*="Email" i], input[type="email"], input[name*="em" i], #em, #pd_email').first();
                        if (await emLoc.count() > 0) {
                            await emLoc.scrollIntoViewIfNeeded().catch(() => {});
                            await emLoc.fill(pEmail, { timeout: 2000 }).catch(() => {});
                            await emLoc.press('Tab').catch(() => {});
                        }

                        // Gender Radio
                        const genderSelector = (pGenderCode === 'F') 
                            ? 'label:has-text("Female"), input[type="radio"][value="F"], input[name="gender"][value="F"]'
                            : 'label:has-text("Male"), input[type="radio"][value="M"], input[name="gender"][value="M"]';
                        const gLoc = page.locator(genderSelector).first();
                        if (await gLoc.count() > 0) {
                            await gLoc.click({ force: true, timeout: 2000 }).catch(() => {});
                        }

                        // Designation
                        const dgLoc = page.locator('input[placeholder*="Designation" i], input[name*="dg" i], #dg').first();
                        if (await dgLoc.count() > 0) {
                            await dgLoc.scrollIntoViewIfNeeded().catch(() => {});
                            await dgLoc.fill(pDg || 'Proprietor', { timeout: 2000 }).catch(() => {});
                            await dgLoc.press('Tab').catch(() => {});
                        }

                        // PAN
                        const panLoc = page.locator('input[placeholder*="PAN" i], input[name*="pan" i], #pan').first();
                        if (await panLoc.count() > 0) {
                            const pVal = await panLoc.inputValue().catch(() => '');
                            if (!pVal) await panLoc.fill(pPan, { timeout: 2000 }).catch(() => {});
                        }

                        // Residential Address Fields
                        const pinLoc = page.locator('input[placeholder*="PIN Code" i], input[placeholder*="PIN" i], #pncd').first();
                        if (await pinLoc.count() > 0) {
                            await pinLoc.scrollIntoViewIfNeeded().catch(() => {});
                            await pinLoc.fill(pPin, { timeout: 2000 }).catch(() => {});
                            await pinLoc.press('Tab').catch(() => {});
                        }

                        const stateLoc = page.locator('input[placeholder*="State" i]').first();
                        if (await stateLoc.count() > 0) {
                            await stateLoc.fill(pState, { timeout: 2000 }).catch(() => {});
                        }

                        const distLoc = page.locator('input[placeholder*="District" i]').first();
                        if (await distLoc.count() > 0) {
                            await distLoc.fill(pDist, { timeout: 2000 }).catch(() => {});
                        }

                        const cityLoc = page.locator('input[placeholder*="City" i], input[placeholder*="Village" i]').first();
                        if (await cityLoc.count() > 0) {
                            await cityLoc.fill(pCity, { timeout: 2000 }).catch(() => {});
                        }

                        const roadLoc = page.locator('input[placeholder*="Road" i], input[placeholder*="Street" i]').first();
                        if (await roadLoc.count() > 0) {
                            await roadLoc.fill(pRoad, { timeout: 2000 }).catch(() => {});
                        }

                        const bnmLoc = page.locator('input[placeholder*="Premises" i], input[placeholder*="Building Name" i]').first();
                        if (await bnmLoc.count() > 0) {
                            await bnmLoc.fill(pBnm, { timeout: 2000 }).catch(() => {});
                        }

                        const bnoLoc = page.locator('input[placeholder*="Building No" i], input[placeholder*="Flat No" i], input[placeholder*="Door No" i]').first();
                        if (await bnoLoc.count() > 0) {
                            await bnoLoc.fill(pBno, { timeout: 2000 }).catch(() => {});
                        }

                        // Toggle "Also Authorized Signatory" - verify state before click to prevent toggling off
                        const asContainers = page.locator('div.form-group, .row, div').filter({ hasText: /also authorized signatory/i });
                        if (await asContainers.count() > 0) {
                            const asSwitch = asContainers.last().locator('.switch, label.switch, input[type="checkbox"], span.slider, div.toggle').first();
                            if (await asSwitch.count() > 0) {
                                const isChecked = await asContainers.last().locator('input[type="checkbox"]').first().isChecked().catch(() => false);
                                if (!isChecked) {
                                    await asSwitch.click({ force: true, timeout: 2000 }).catch(() => {});
                                }
                            }
                        }
                    } catch (e) {}

                    // 2. DOM evaluate to ensure AngularJS scope & ngModel values are fully committed
                    await page.evaluate(({ f, m, l, ff, fm, fl, dob, mob, em, dg, pan, pin, state, dist, city, road, bnm, bno, gd, gender }) => {
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
                                } catch (e) {}
                            }
                        };

                        const fnEls = Array.from(document.querySelectorAll('input[placeholder*="First Name" i]'));
                        if (fnEls.length > 0 && !fnEls[0].value) setElem(fnEls[0], f);
                        if (fnEls.length > 1) setElem(fnEls[1], ff);

                        const mnEls = Array.from(document.querySelectorAll('input[placeholder*="Middle Name" i]'));
                        if (mnEls.length > 0 && !mnEls[0].value) setElem(mnEls[0], m);
                        if (mnEls.length > 1) setElem(mnEls[1], fm);

                        const lnEls = Array.from(document.querySelectorAll('input[placeholder*="Last Name" i]'));
                        if (lnEls.length > 0 && !lnEls[0].value) setElem(lnEls[0], l);
                        if (lnEls.length > 1) setElem(lnEls[1], fl);

                        setElem(document.querySelector('input[placeholder*="DD/MM/YYYY" i], input[placeholder*="dd/mm/yyyy" i], #dob, input[name="dob"]'), dob);
                        setElem(document.querySelector('input[placeholder*="Mobile" i], #mbno, input[name="mbno"]'), mob);
                        setElem(document.querySelector('input[placeholder*="Email" i], input[type="email"], #em, input[name="em"]'), em);
                        setElem(document.querySelector('input[placeholder*="Designation" i], #dg, input[name="dg"]'), dg);
                        setElem(document.querySelector('input[placeholder*="PIN Code" i], #pncd, input[name="pncd"]'), pin);
                        setElem(document.querySelector('input[placeholder*="State" i]'), state);
                        setElem(document.querySelector('input[placeholder*="District" i]'), dist);
                        setElem(document.querySelector('input[placeholder*="City" i], input[placeholder*="Village" i]'), city);
                        setElem(document.querySelector('input[placeholder*="Road" i], input[placeholder*="Street" i]'), road);
                        setElem(document.querySelector('input[placeholder*="Premises" i]'), bnm);
                        setElem(document.querySelector('input[placeholder*="Building No" i], input[placeholder*="Flat" i]'), bno);

                        // Gender Radio
                        const allRadios = Array.from(document.querySelectorAll('input[type="radio"]'));
                        const rad = allRadios.find(r => {
                            const val = (r.value || '').toUpperCase();
                            const lbl = ((r.labels && r.labels[0] ? r.labels[0].innerText : '') || r.parentElement?.innerText || '').toLowerCase();
                            if (gd === 'F') return val === 'F' || lbl.includes('female');
                            return (val === 'M' || lbl.includes('male')) && !lbl.includes('female');
                        });
                        if (rad) {
                            rad.checked = true;
                            rad.dispatchEvent(new Event('change', { bubbles: true }));
                            rad.dispatchEvent(new Event('click', { bubbles: true }));
                            const l = rad.closest('label') || document.querySelector(`label[for="${rad.id}"]`);
                            if (l) l.click();
                        }

                        // Also Authorized Signatory switch (ensure turned ON without double-clicking)
                        const labels = Array.from(document.querySelectorAll('label, div, p, span'));
                        const asLbl = labels.find(el => (el.innerText || '').toLowerCase().includes('also authorized signatory'));
                        if (asLbl) {
                            const parent = asLbl.closest('.form-group, .row, div') || asLbl.parentElement;
                            if (parent) {
                                const cb = parent.querySelector('input[type="checkbox"]');
                                const sw = parent.querySelector('.switch, label.switch, span.slider, div.toggle');
                                const isAlreadyOn = (cb && cb.checked) || (sw && (sw.classList.contains('active') || sw.classList.contains('checked') || sw.getAttribute('aria-checked') === 'true'));
                                if (!isAlreadyOn) {
                                    if (cb) {
                                        cb.checked = true;
                                        cb.dispatchEvent(new Event('change', { bubbles: true }));
                                        cb.dispatchEvent(new Event('input', { bubbles: true }));
                                    } else if (sw) {
                                        sw.click();
                                    }
                                }
                            }
                        }

                        // AngularJS scope models & form validation reset
                        if (window.angular) {
                            try {
                                const forms = Array.from(document.querySelectorAll('form'));
                                for (const frm of forms) {
                                    const fc = window.angular.element(frm).controller('form');
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

                                const scopes = Array.from(document.querySelectorAll('form, [ng-controller], [ng-view], [ui-view], body')).map(e => window.angular.element(e).scope()).filter(Boolean);
                                for (const sc of scopes) {
                                    const targets = [sc.op, sc.pd, sc.promoter, sc.proprietor, sc.opdtls, sc.p, sc.x].filter(Boolean);
                                    for (const t of targets) {
                                        t.fn = f;
                                        t.mn = m;
                                        t.ln = l;
                                        t.fhfn = ff;
                                        t.fhmn = fm;
                                        t.fhln = fl;
                                        t.dob = dob;
                                        t.gd = gd;
                                        t.gender = gender;
                                        t.mbno = mob;
                                        t.em = em;
                                        t.email = em;
                                        t.dg = dg;
                                        t.pan = pan;
                                        t.isasg = 'Y';
                                        t.isopas = 'Y';
                                        if (!t.rsad) t.rsad = {};
                                        t.rsad.pncd = pin;
                                        t.rsad.stcd = '27';
                                        t.rsad.dst = dist;
                                        t.rsad.loc = city;
                                        t.rsad.st = road;
                                        t.rsad.bnm = bnm;
                                        t.rsad.bno = bno;
                                    }
                                    if (!sc.$$phase) sc.$apply();
                                }
                            } catch (e) {}
                        }
                    }, { f: pFirst, m: pMiddle, l: pLast, ff: pFatherFirst, fm: pFatherMiddle, fl: pFatherLast, dob: pDob, mob: pMobile, em: pEmail, dg: pDg, pan: pPan, pin: pPin, state: pState, dist: pDist, city: pCity, road: pRoad, bnm: pBnm, bno: pBno, gd: pGenderCode, gender: pGender });

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
                                    await fInput.setInputFiles(tempPhotoPath).catch(() => {});
                                    await fInput.dispatchEvent('change').catch(() => {});
                                    await fInput.dispatchEvent('input').catch(() => {});
                                }
                                sendUpdate('Promoter photograph uploaded.');
                            }
                        }
                    } catch (photoErr) {
                        sendUpdate(`Photo note: ${photoErr.message}`);
                    }

                    await page.waitForTimeout(1000);

                    sendUpdate('Saved Promoter details.');
                    await page.waitForTimeout(2000);
                    await dismissAndConfirmModals();

                    // Advance to next tab via SAVE & CONTINUE
                    await saveAndAdvanceTab('Promoter / Partner');
                    continue;
                }
            }

            // Step 3: Authorized Signatory tab
            if (screenInfo.stepKey === 'authorized signatory') {
                sendUpdate('[પગલું ૩: Authorized Signatory] પ્રાઇમરી સાઇન કરનાર કન્ફર્મ કરી રહ્યા છીએ...');

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
                                await loc.first().scrollIntoViewIfNeeded().catch(() => {});
                                await loc.first().check({ force: true, timeout: 2000 }).catch(async () => {
                                    await loc.first().click({ force: true, timeout: 2000 }).catch(() => {});
                                });
                                sendUpdate('✅ "Primary Authorized Signatory" ચેકબોક્સ સફળતાપૂર્વક ટીક (Check) કર્યું.');
                                break;
                            } else {
                                sendUpdate('ℹ️ "Primary Authorized Signatory" ચેકબોક્સ પહેલેથી ટીક (Checked) છે.');
                                break;
                            }
                        }
                    }
                } catch (e) {}

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
                const asgState = await page.evaluate(({ em, mob }) => {
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
                }, { em: (data.email || 'parthpbhagat@gmail.com').trim().toLowerCase(), mob: (data.mobile || '9011494385').trim() });

                sendUpdate(`Authorized Signatory Screen: ${asgState.rowCount} signatories in table, Form visible: ${asgState.hasForm}`);

                // Case 1: Signatories are present in Table mode
                if (asgState.rowCount > 0) {
                    // Check Primary Authorized Signatory checkbox/radio in the table
                    try {
                        const rowLoc = page.locator('table tbody tr').first();
                        const primaryInput = rowLoc.locator('input[type="checkbox"], input[type="radio"]').first();
                        if (await primaryInput.count() > 0) {
                            const isChk = await primaryInput.isChecked().catch(() => false);
                            if (!isChk) {
                                await primaryInput.check({ force: true, timeout: 2000 }).catch(async () => {
                                    await primaryInput.click({ force: true, timeout: 2000 }).catch(() => {});
                                });
                                sendUpdate('Designated row 1 as Primary Authorized Signatory.');
                            }
                        }
                    } catch (e) {}

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
                                } catch (e) {}
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
                            } catch (e) {}
                        }
                    });
                } else if (asgState.hasForm) {
                    // Case 2: Form view is open - Fill in Authorized Signatory details
                    sendUpdate('Filling Authorized Signatory form details...');
                    const pFirst = (data.p1 && data.p1.firstName) || 'Parth';
                    const pMiddle = (data.p1 && data.p1.middleName) || 'Purushottam';
                    const pLast = (data.p1 && data.p1.lastName) || 'Bhagat';
                    const pMobile = (data.mobile || '9011494385').trim();
                    const pEmail = (data.email || 'parthpbhagat@gmail.com').trim().toLowerCase();

                    await page.evaluate(({ f, m, l, mob, em }) => {
                        const setVal = (el, val) => {
                            if (!el || !val) return;
                            el.value = val;
                            el.dispatchEvent(new Event('input', { bubbles: true }));
                            el.dispatchEvent(new Event('change', { bubbles: true }));
                        };
                        const fn = document.querySelector('input[placeholder*="First Name" i], #fn, #fnm');
                        const mn = document.querySelector('input[placeholder*="Middle Name" i], #mn');
                        const ln = document.querySelector('input[placeholder*="Last Name" i], #ln, #lnm');
                        if (fn && !fn.value) setVal(fn, f);
                        if (mn && !mn.value) setVal(mn, m);
                        if (ln && !ln.value) setVal(ln, l);

                        // Check primary signatory checkbox/radio
                        const prim = document.querySelector('input[type="checkbox"][id*="primary" i], input[type="radio"][id*="primary" i], input[id*="ispas" i]');
                        if (prim && !prim.checked) {
                            prim.checked = true;
                            prim.dispatchEvent(new Event('change', { bubbles: true }));
                        }
                    }, { f: pFirst, m: pMiddle, l: pLast, mob: pMobile, em: pEmail });

                    // Click Save button on form
                    const saveFormBtn = page.locator('button.btn-primary:has-text("SAVE"), button:has-text("Save Details"), button:has-text("SAVE")').first();
                    if (await saveFormBtn.count() > 0) {
                        await saveFormBtn.click({ force: true, timeout: 3000 }).catch(() => {});
                        sendUpdate('Saved Authorized Signatory form.');
                        await page.waitForTimeout(1500);
                    }
                } else if (asgState.hasAddNew) {
                    // Case 3: Table is empty and Add New button is available
                    sendUpdate('Clicking Add New Authorized Signatory...');
                    const addBtn = page.locator('button:has-text("ADD NEW"), a:has-text("ADD NEW"), button:has-text("Add New")').first();
                    if (await addBtn.count() > 0) {
                        await addBtn.click({ force: true, timeout: 3000 }).catch(() => {});
                        await page.waitForTimeout(1000);
                    }
                }

                await page.waitForTimeout(800);
                await dismissAndConfirmModals('Authorized Signatory');

                // Save & Continue on Authorized Signatory
                await saveAndAdvanceTab('Authorized Signatory');

                // Fallback check: If the page didn't advance, attempt direct navigation to Tab 4 (Authorized Representative) in the wizard
                const stillOnAsg = await page.evaluate(() => {
                    const bc = (document.querySelector('ol.breadcrumb, .breadcrumb')?.innerText || '').toLowerCase();
                    const tab = (document.querySelector('ul.nav-tabs li.active, .step-wizard .active')?.innerText || '').toLowerCase();
                    return bc.includes('authorized signatory') || tab.includes('authorized signatory');
                });

                if (stillOnAsg) {
                    sendUpdate('Attempting direct navigation to Tab 4 (Authorized Representative)...');
                    await page.evaluate(() => {
                        const tabs = Array.from(document.querySelectorAll('ul.nav-tabs:not(.navbar-nav) li a, ul.step-wizard li a, .wizard-steps li a, .tabs a'));
                        const tab4 = tabs.find(t => (t.innerText || '').toLowerCase().includes('authorized representative'));
                        if (tab4) {
                            tab4.click();
                        }
                    });
                    await page.waitForTimeout(1500);
                    await dismissAndConfirmModals('Tab 4 Navigation');
                }

                continue;
            }

            // Step 4: Authorized Representative tab
            if (screenInfo.stepKey === 'authorized representative') {
                sendUpdate('[પગલું ૪: Authorized Representative] પ્રતિનિધિ ઓપ્શન (No) કન્ફર્મ કરી રહ્યા છીએ...');
                await page.evaluate(() => {
                    const radios = Array.from(document.querySelectorAll('input[type="radio"]'));
                    const noR = radios.find(r => {
                        const t = ((r.labels && r.labels[0] ? r.labels[0].innerText : '') || r.parentElement?.innerText || r.value || '').toLowerCase();
                        return t.includes('no') || r.value === 'N' || r.value === 'No';
                    });
                    if (noR) {
                        noR.removeAttribute('disabled');
                        noR.click();
                        noR.checked = true;
                        noR.dispatchEvent(new Event('change', { bubbles: true }));
                        noR.dispatchEvent(new Event('input', { bubbles: true }));
                    }
                });

                try {
                    const noRadioLoc = page.locator('input[type="radio"][value="N"], input[type="radio"][value="No"], label:has-text("No")').first();
                    if (await noRadioLoc.count() > 0) {
                        await noRadioLoc.click({ force: true }).catch(() => {});
                    }
                } catch (e) {}

                await page.waitForTimeout(600);
                await saveAndAdvanceTab('Authorized Representative');
                continue;
            }

            // Step 5: Principal Place of Business tab
            if (screenInfo.stepKey === 'principal place') {
                sendUpdate('[પગલું ૫: Principal Place of Business] મુખ્ય વેપાર સ્થળ વિગતો કન્ફર્મ કરી રહ્યા છીએ...');

                const ppobEm = (data.email || 'parthpbhagat@gmail.com').trim().toLowerCase();
                const ppobMob = (data.mobile || '9011494385').trim();
                const ppobPin = (data.ppob_pincode || (data.p1 && data.p1.res_pincode) || '444906').trim();
                const ppobCity = (data.ppob_city || (data.p1 && data.p1.res_city) || 'warud').trim();
                const ppobDist = (data.ppob_district || data.district || data.businessDistrict || 'Amravati').trim();
                const ppobStreet = (data.ppob_street || (data.p1 && data.p1.res_road) || 'ntr road').trim();
                const ppobBno = (data.ppob_flatNo || (data.p1 && data.p1.res_buildingNo) || '29').trim();
                const ppobBnm = (data.ppob_building || (data.p1 && data.p1.res_buildingName) || data.legalName || 'Parth P Bhagat').trim();
                const ppobFloor = (data.ppob_floor || '').trim();
                const ppobLandmark = (data.ppob_landmark || '').trim();
                const ppobStateJurisdiction = (data.ppob_stateJurisdiction || data.state_jurisdiction || 'AMRAVATI_701').trim();
                const ppobComm = (data.ppob_commissionerate || data.central_commissionerate || 'VH').trim();
                const ppobDiv = (data.ppob_division || data.central_division || 'VH03').trim();
                const ppobRange = (data.ppob_range || data.central_range || 'VH0302').trim();
                const ppobPossession = (data.ppob_natureOfPossession || 'Consent').trim();
                const ppobDocType = (data.ppob_doc || 'Electricity Bill').trim();

                // 1. Fill all Address fields via DOM & Angular
                await page.evaluate(({ pin, city, dist, street, bno, bnm, flno, landmark, em, mob }) => {
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
                                } catch (e) {}
                            }
                        }
                    };

                    setField(['input[placeholder*="Enter PIN Code" i]', 'input[placeholder*="PIN Code" i]', '#pncd'], pin);
                    setField(['input[placeholder*="Enter District Name" i]', 'input[placeholder*="District" i]', '#dst'], dist);
                    setField(['input[placeholder*="Enter City" i]', 'input[placeholder*="City" i]', '#loc'], city);
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
                                        add.bno = bno;
                                        add.st = street;
                                        add.bnm = bnm;
                                        add.pncd = pin;
                                        add.loc = city;
                                        add.dst = dist;
                                        add.stcd = '27';
                                    }
                                }
                                if (!sc.$$phase) sc.$apply();
                            }
                        } catch (e) {}
                    }
                }, { pin: ppobPin, city: ppobCity, dist: ppobDist, street: ppobStreet, bno: ppobBno, bnm: ppobBnm, flno: ppobFloor, landmark: ppobLandmark, em: ppobEm, mob: ppobMob });

                await page.waitForTimeout(600);

                // 2. PIN Code: Playwright fill + typeahead click (NO Enter key to prevent form reset)
                try {
                    const pinLoc = page.locator('input[placeholder*="Enter PIN Code" i]:visible, #pncd:visible').last();
                    if (await pinLoc.count() > 0) {
                        await pinLoc.click({ timeout: 2000 }).catch(() => {});
                        await pinLoc.fill('', { timeout: 2000 }).catch(() => {});
                        await pinLoc.type(ppobPin, { delay: 50, timeout: 3000 }).catch(() => {});
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
                } catch (e) {}

                // 3. City: Playwright fill + suggestion click
                try {
                    const cityLoc = page.locator('input[placeholder*="Enter City" i]:visible, input[placeholder*="City" i]:visible, #loc:visible').last();
                    if (await cityLoc.count() > 0) {
                        await cityLoc.click({ timeout: 2000 }).catch(() => {});
                        await cityLoc.fill('', { timeout: 2000 }).catch(() => {});
                        await cityLoc.type(ppobCity, { delay: 50, timeout: 3000 }).catch(() => {});
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
                } catch (e) {}

                // 4. Building No, Road, Premises
                try {
                    const bnoLoc = page.locator('input[placeholder*="Building No" i]:visible, input[placeholder*="Flat No" i]:visible, input[placeholder*="Door No" i]:visible, #bno:visible').last();
                    if (await bnoLoc.count() > 0) {
                        await bnoLoc.click({ timeout: 2000 }).catch(() => {});
                        await bnoLoc.fill(ppobBno, { timeout: 2000 }).catch(() => {});
                        await bnoLoc.dispatchEvent('change').catch(() => {});
                    }
                    const stLoc = page.locator('input[placeholder*="Enter Road" i]:visible, input[placeholder*="Road" i]:visible, input[placeholder*="Street" i]:visible, input[placeholder*="Lane" i]:visible, #st:visible').last();
                    if (await stLoc.count() > 0) {
                        await stLoc.click({ timeout: 2000 }).catch(() => {});
                        await stLoc.fill(ppobStreet, { timeout: 2000 }).catch(() => {});
                        await stLoc.dispatchEvent('change').catch(() => {});
                    }
                    const bnmLoc = page.locator('input[placeholder*="Enter Name of Premises" i]:visible, input[placeholder*="Premises" i]:visible, #bnm:visible').last();
                    if (await bnmLoc.count() > 0) {
                        await bnmLoc.click({ timeout: 2000 }).catch(() => {});
                        await bnmLoc.fill(ppobBnm, { timeout: 2000 }).catch(() => {});
                    }
                } catch (e) {}

                // Wait for AJAX jurisdiction calls to finish
                await page.waitForTimeout(1500);

                // 5. Select State Jurisdiction (Sector / Circle / Ward / Charge / Unit)
                await page.evaluate(({ sjCode }) => {
                    const visibleSelects = Array.from(document.querySelectorAll('select')).filter(s => s.offsetParent !== null && !s.disabled);
                    const sjSelect = visibleSelects.find(s => {
                        const txt = (s.closest('.form-group, [class*="col-"], div')?.innerText || '').toLowerCase();
                        const ng = (s.getAttribute('ng-model') || '').toLowerCase();
                        return txt.includes('sector') || txt.includes('circle') || txt.includes('ward') || txt.includes('charge') || txt.includes('unit') || ng.includes('stjd');
                    });
                    if (sjSelect && sjSelect.options.length > 1) {
                        let matchedIdx = Array.from(sjSelect.options).findIndex(o => 
                            (o.value || '').toUpperCase().includes(sjCode.toUpperCase()) || 
                            (o.text || '').toUpperCase().includes('AMRAVATI') || 
                            (o.text || '').toUpperCase().includes('701')
                        );
                        sjSelect.selectedIndex = matchedIdx > 0 ? matchedIdx : 1;
                        sjSelect.dispatchEvent(new Event('change', { bubbles: true }));
                        if (window.angular) {
                            try {
                                const ngModel = window.angular.element(sjSelect).controller('ngModel');
                                if (ngModel) { ngModel.$setViewValue(sjSelect.value); ngModel.$commitViewValue(); }
                            } catch (e) {}
                        }
                    }
                }, { sjCode: ppobStateJurisdiction });

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
                        let cIdx = Array.from(commSelect.options).findIndex(o => o.value === comm || o.text.includes(comm) || o.text.includes('NAGPUR') || o.text.includes('AMRAVATI'));
                        commSelect.selectedIndex = cIdx > 0 ? cIdx : 1;
                        commSelect.dispatchEvent(new Event('change', { bubbles: true }));
                        if (window.angular) {
                            try {
                                const ngModel = window.angular.element(commSelect).controller('ngModel');
                                if (ngModel) { ngModel.$setViewValue(commSelect.value); ngModel.$commitViewValue(); }
                            } catch (e) {}
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
                        let dIdx = Array.from(divSelect.options).findIndex(o => o.value === div || o.text.includes(div) || o.text.includes('AMRAVATI') || o.text.includes('WARUD'));
                        divSelect.selectedIndex = dIdx > 0 ? dIdx : 1;
                        divSelect.dispatchEvent(new Event('change', { bubbles: true }));
                        if (window.angular) {
                            try {
                                const ngModel = window.angular.element(divSelect).controller('ngModel');
                                if (ngModel) { ngModel.$setViewValue(divSelect.value); ngModel.$commitViewValue(); }
                            } catch (e) {}
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
                        let rIdx = Array.from(rangeSelect.options).findIndex(o => o.value === range || o.text.includes(range) || o.text.includes('WARUD') || o.text.includes('AMRAVATI'));
                        rangeSelect.selectedIndex = rIdx > 0 ? rIdx : 1;
                        rangeSelect.dispatchEvent(new Event('change', { bubbles: true }));
                        if (window.angular) {
                            try {
                                const ngModel = window.angular.element(rangeSelect).controller('ngModel');
                                if (ngModel) { ngModel.$setViewValue(rangeSelect.value); ngModel.$commitViewValue(); }
                            } catch (e) {}
                        }
                    }
                }, { range: ppobRange });

                await page.waitForTimeout(800);

                // 7. Select Nature of possession of premises
                await page.evaluate(({ possessionVal }) => {
                    const visibleSelects = Array.from(document.querySelectorAll('select')).filter(s => s.offsetParent !== null && !s.disabled);
                    const posSelect = visibleSelects.find(s => {
                        const ng = (s.getAttribute('ng-model') || '').toLowerCase();
                        return ng.includes('psnt') || Array.from(s.options || []).some(o => /consent|own|rent|lease/i.test(o.text || ''));
                    });
                    if (posSelect && posSelect.options.length > 1) {
                        let pIdx = Array.from(posSelect.options).findIndex(o => new RegExp(possessionVal, 'i').test(o.text || o.value));
                        posSelect.selectedIndex = pIdx > 0 ? pIdx : 1;
                        posSelect.dispatchEvent(new Event('change', { bubbles: true }));
                    }
                }, { possessionVal: ppobPossession });

                await page.waitForTimeout(600);

                // 8. Select Proof Document Type
                await page.evaluate(({ docTypeVal }) => {
                    const visibleSelects = Array.from(document.querySelectorAll('select')).filter(s => s.offsetParent !== null && !s.disabled);
                    const docSelect = visibleSelects.find(s => {
                        const ng = (s.getAttribute('ng-model') || '').toLowerCase();
                        return ng.includes('doctype') || Array.from(s.options || []).some(o => /electricity bill|consent letter|municipal/i.test(o.text || ''));
                    });
                    if (docSelect && docSelect.options.length > 1) {
                        let dIdx = Array.from(docSelect.options).findIndex(o => /electricity bill|consent letter|khata|tax/i.test(o.text || o.value));
                        docSelect.selectedIndex = dIdx > 0 ? dIdx : 1;
                        docSelect.dispatchEvent(new Event('change', { bubbles: true }));
                    }
                }, { docTypeVal: ppobDocType });

                await page.waitForTimeout(600);

                // 9. Upload Proof Document file
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
                            await ppobFileInput.setInputFiles(tempDocPath).catch(() => {});
                            sendUpdate('Uploaded Proof of Principal Place of Business document.');
                        }
                    }
                } catch (e) {
                    sendUpdate(`PPOB Doc Upload note: ${e.message}`);
                }

                await page.waitForTimeout(600);

                // 10. Select Nature of Business Activity (Retail Business)
                await page.evaluate(() => {
                    const cbs = Array.from(document.querySelectorAll('input[type="checkbox"]')).filter(c => c.offsetParent !== null);
                    const bwhCb = cbs.find(cb => /bonded warehouse/i.test(cb.parentElement?.innerText || ''));
                    if (bwhCb && bwhCb.checked) {
                        bwhCb.click();
                    }
                    const retailCb = cbs.find(cb => /retail business/i.test(cb.parentElement?.innerText || ''));
                    if (retailCb && !retailCb.checked) {
                        retailCb.click();
                        retailCb.checked = true;
                        retailCb.dispatchEvent(new Event('change', { bubbles: true }));
                    }
                });

                // 11. Additional Place of Business toggle -> No
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
                await saveAndAdvanceTab('Principal Place of Business');
                continue;
            }

            // Step 6: Additional Places of Business tab
            if (screenInfo.stepKey === 'additional places') {
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
                await saveAndAdvanceTab('Additional Places of Business');
                continue;
            }

            // Step 7: Goods and Services tab
            if (screenInfo.stepKey === 'goods and services') {
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
                await page.waitForTimeout(600);
                await saveAndAdvanceTab('Goods and Services');
                continue;
            }

            // Step 8: State Specific Information tab
            if (screenInfo.stepKey === 'state specific') {
                sendUpdate('[પગલું ૮: State Specific Information] રાજ્ય સંબંધિત વિગતો કન્ફર્મ કરી રહ્યા છીએ...');
                await page.waitForTimeout(600);
                await saveAndAdvanceTab('State Specific Information');
                continue;
            }

            // Step 9: Aadhaar Authentication tab
            if (screenInfo.stepKey === 'aadhaar') {
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
                await saveAndAdvanceTab('Aadhaar Authentication');
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
