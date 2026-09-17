const { chromium } = require('playwright');
const http = require('http');

const appId = process.argv[2];
const token = process.argv[3];

if (!appId) {
    console.error('ERROR: No App ID provided');
    process.exit(1);
}

// Helper to log progress to stdout (which the backend will capture and send via Socket.io)
function sendUpdate(status) {
    console.log(`STATUS:${status}`);
}

let globalPage = null;
setInterval(async () => {
    if (globalPage) {
        try {
            const buffer = await globalPage.screenshot({ type: 'jpeg', quality: 30 });
            console.log(`SCREENSHOT:${buffer.toString('base64')}`);
        } catch (e) {
            // Ignore screenshot errors
        }
    }
}, 3000);

process.on('uncaughtException', (err) => {
    console.log(`[Runner Error]: UNCAUGHT EXCEPTION: ${err.stack}`);
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    console.log(`[Runner Error]: UNHANDLED REJECTION: ${reason}`);
    process.exit(1);
});

async function handleLocalityWarning(page) {
    try {
        const warningEl = await page.waitForSelector('text=Locality/Sub-Locality is not matching', { state: 'visible', timeout: 3000 }).catch(() => null);
        if (warningEl) {
            sendUpdate('Handling Locality/Sub-Locality mismatch warning (automatically clicking YES)...');
            
            // Try specific selector first, then text based fallback
            const yesBtn = page.getByRole('button', { name: 'YES', exact: true }).first();
            if (await yesBtn.isVisible({ timeout: 2000 })) {
                await yesBtn.evaluate(b => b.click()).catch(() => yesBtn.click({ force: true }));
            } else {
                // Fallbacks if getByRole fails
                await page.click('button:has-text("YES")').catch(() => {});
            }
            
            await page.waitForTimeout(2000);
        }
    } catch (e) {
        if (e.message && !e.message.includes('Timeout')) {
            console.log(`[Runner Log]: Error in handleLocalityWarning: ${e.message}`);
        }
    }
}

async function clickAndHandleMapError(page, selector, clickOptions = {}, maxRetries = 5) {
    let attempts = 0;
    while (attempts < maxRetries) {
        await page.click(selector, clickOptions);
        await page.waitForTimeout(2000);

        // Check if map error popup appeared (Error Code: REG-MP-408)
        const mapErrorText = await page.locator('text=/REG-MP-408/i').count();
        const mapErrorTextAlt = await page.locator('text=/maps services are currently unavailable/i').count();

        if (mapErrorText > 0 || mapErrorTextAlt > 0) {
            console.log(`[Runner Log]: Map service error detected (Attempt ${attempts + 1}). Clicking CLOSE and retrying...`);
            const closeBtn = page.locator('button', { hasText: 'CLOSE' }).last();
            if (await closeBtn.count() > 0) {
                await closeBtn.click();
                await page.waitForTimeout(1000);
            }
            attempts++;
        } else {
            // No error popup, success!
            break;
        }
    }
    if (attempts === maxRetries) {
        console.log('[Runner Log]: Max retries reached for map service error. Proceeding anyway...');
    }
}

async function saveAndContinueToTab(page, expectedTabName, clickSelector) {
    sendUpdate(`Clicking Save & Continue...`);
    try {
        await clickAndHandleMapError(page, clickSelector || 'button[title="Save & Continue"]');
    } catch (e) {
        sendUpdate(`Warning: Could not click Save & Continue using standard selector. Attempting fallback...`);
        await page.click('button:has-text("Save & Continue")').catch(() => {});
    }

    if (expectedTabName) {
        sendUpdate(`Waiting for '${expectedTabName}' tab...`);
        let isFinished = false;
        try {
            // Race: either the next tab becomes active, OR a validation error appears within 8 seconds
            const result = await Promise.race([
                // Condition 1: Next tab becomes active
                page.waitForFunction((expectedName) => {
                    const activeTabs = Array.from(document.querySelectorAll('li.active a, li.active span, .nav-tabs li.active, .step-wizard .active, .wizard-step.active'));
                    const possibleNames = expectedName.toLowerCase().split('|').map(s => s.trim());
                    for (let tab of activeTabs) {
                        const tabText = tab.innerText ? tab.innerText.toLowerCase() : '';
                        if (possibleNames.some(name => tabText.includes(name))) {
                            return true;
                        }
                    }
                    return false;
                }, expectedTabName, { timeout: 600000 }).then(() => ({ status: 'success' })),

                // Condition 2: Validation errors appear - detect and report them
                (async () => {
                    while (!isFinished) {
                        await new Promise(r => setTimeout(r, 5000)); // wait 5s for page to respond
                        if (isFinished) break;
                        const errors = await page.evaluate(() => {
                            const selectors = [
                                '.text-danger', '.error-msg', '.has-error .help-block',
                                'span[ng-message]', 'div.error-message', '.alert-danger',
                                'p.text-danger', 'small.text-danger', 'label.error'
                            ];
                            const found = [];
                            for (const sel of selectors) {
                                document.querySelectorAll(sel).forEach(el => {
                                    const txt = el.innerText && el.innerText.trim();
                                    if (txt && txt.length > 2 && el.offsetParent !== null) {
                                        found.push(txt);
                                    }
                                });
                            }
                            return [...new Set(found)];
                        }).catch(() => []);
                        if (errors.length > 0) {
                            return { status: 'validation_error', errors };
                        }
                    }
                    return new Promise(() => {}); // never resolve
                })(),
                
                // Condition 3: Proactively handle Locality popup blocking navigation
                (async () => {
                    while (!isFinished) {
                        await new Promise(r => setTimeout(r, 2000));
                        if (isFinished) break;
                        try {
                            const warningEl = await page.$('text=Locality/Sub-Locality is not matching');
                            if (warningEl) {
                                const isVis = await warningEl.isVisible();
                                if (isVis) {
                                    sendUpdate('Handling Locality/Sub-Locality mismatch warning (automatically clicking YES)...');
                                    const yesBtn = page.getByRole('button', { name: 'YES', exact: true }).first();
                                    if (await yesBtn.isVisible({ timeout: 1000 })) {
                                        await yesBtn.evaluate(b => b.click()).catch(() => yesBtn.click({ force: true }));
                                    } else {
                                        await page.click('button:has-text("YES")').catch(() => {});
                                    }
                                }
                            }
                        } catch(e) {}
                    }
                    return new Promise(() => {}); // never resolve
                })()
            ]);
            
            isFinished = true; // Signal background conditions to stop

            if (result && result.status === 'validation_error') {
                sendUpdate(`VALIDATION ERRORS on '${expectedTabName}' tab:`);
                result.errors.forEach(err => sendUpdate(`  ❌ ${err}`));
                sendUpdate(`Please fix these errors and retry.`);
            } else {
                sendUpdate(`'${expectedTabName}' tab is now active! Proceeding...`);
            }
        } catch (e) {
            sendUpdate(`Error: Timed out waiting for '${expectedTabName}' tab.`);
        }
        await page.waitForTimeout(2000);
    } else {
        await page.waitForTimeout(3000);
    }
}

async function run() {
    sendUpdate('INITIALIZING: Starting headless browser...');

    // Fetch data from backend API
    const appData = await new Promise((resolve, reject) => {
        http.get('http://127.0.0.1:3002/api/applications', { headers: { 'Authorization': `Bearer ${token}` } }, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                console.log(`[Runner Log]: /api/applications response body: ${body}`);
                const apps = JSON.parse(body);
                const app = apps.find(a => a.appId === appId);
                if (app) resolve(app);
                else reject(new Error('App not found'));
            });
        }).on('error', reject);
    });
    
    const data = appData.data;

    sendUpdate('Navigating to official GST portal...');

    // Launch headless browser
    const browser = await chromium.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    const context = await browser.newContext();
    const page = await context.newPage();
    globalPage = page;

    try {
        await page.goto('https://reg.gst.gov.in/registration/', { waitUntil: 'domcontentloaded' });

        let trnText = '';
        
        if (appData.trn && appData.trn.trim().length > 5) {
            trnText = appData.trn;
            sendUpdate(`Application already has TRN: ${trnText}. Skipping Part A...`);
        } else {
            sendUpdate('Injecting form payload data...');

            // Wait for first field to be ready
            await page.waitForSelector('#applnType');

        // Full taxpayer type mapping for all GST portal dropdown options
        // Portal #applnType dropdown options from regindex1.0.js / preregtypes.json:
        //   APLRG  → Taxpayer (Regular + Composition)
        //   APLTD  → Tax Deductor (TDS)
        //   APLTC  → Tax Collector (TCS)
        //   APLNR  → Non-Resident Taxable Person
        //   APLUN  → UN Body / Embassy / Other Notified Person
        //   APLEM  → Embassy / High Commission
        //   APLOT  → Other Notified Persons
        //   REGOI  → Online Services (OIDAR)
        //   RTTR1  → GST Practitioner
        let taxpayerTypeLabel = data.taxpayerType || '';
        let taxpayerTypeValue = null;

        const taxpayerTypeMap = {
            'taxpayer': 'APLRG',
            'regular': 'APLRG',
            'composition': 'APLRG',
            'regular taxpayer': 'APLRG',
            'composition taxpayer': 'APLRG',
            'tax deductor': 'APLTD',
            'tds': 'APLTD',
            'deductor': 'APLTD',
            'tax collector': 'APLTC',
            'tcs': 'APLTC',
            'collector': 'APLTC',
            'non-resident taxable person': 'APLNR',
            'non resident taxable person': 'APLNR',
            'nrtp': 'APLNR',
            'non-resident': 'APLNR',
            'un body': 'APLUN',
            'un body / embassy': 'APLUN',
            'un': 'APLUN',
            'embassy': 'APLEM',
            'high commission': 'APLEM',
            'embassy / high commission': 'APLEM',
            'other notified person': 'APLOT',
            'other notified': 'APLOT',
            'oidar': 'REGOI',
            'online services': 'REGOI',
            'online information': 'REGOI',
            'gst practitioner': 'RTTR1',
            'practitioner': 'RTTR1'
        };

        const normalizedType = taxpayerTypeLabel.toLowerCase().trim();
        taxpayerTypeValue = taxpayerTypeMap[normalizedType] || null;

        // Try to select by value first (most reliable), fall back to label
        try {
            if (taxpayerTypeValue) {
                await page.selectOption('#applnType', { value: taxpayerTypeValue });
                sendUpdate(`Selected taxpayer type by value: ${taxpayerTypeValue} (from "${taxpayerTypeLabel}")`);
            } else {
                await page.selectOption('#applnType', { label: taxpayerTypeLabel });
                sendUpdate(`Selected taxpayer type by label: ${taxpayerTypeLabel}`);
            }
        } catch (e) {
            sendUpdate(`Warning: Could not select taxpayer type "${taxpayerTypeLabel}". Trying partial match...`);
            try {
                const options = await page.$$eval('#applnType option', opts => opts.map(o => ({ value: o.value, text: o.innerText.trim() })));
                const match = options.find(o => o.text.toLowerCase().includes(normalizedType) || normalizedType.includes(o.text.toLowerCase()));
                if (match && match.value) {
                    await page.selectOption('#applnType', { value: match.value });
                    sendUpdate(`Selected taxpayer type by partial match: ${match.text}`);
                }
            } catch (e2) {
                sendUpdate(`Warning: Could not select taxpayer type at all. Please select manually.`);
            }
        }

        // Select State
        try {
            await page.selectOption('#applnState', { label: data.state });
        } catch (e) {
            sendUpdate(`Warning: Could not select state "${data.state}" by label, trying partial match...`);
            try {
                const stateOptions = await page.$$eval('#applnState option', opts => opts.map(o => ({ value: o.value, text: o.innerText.trim() })));
                const stateMatch = stateOptions.find(o => o.text.toUpperCase().includes(data.state.toUpperCase()) || data.state.toUpperCase().includes(o.text.toUpperCase()));
                if (stateMatch && stateMatch.value) {
                    await page.selectOption('#applnState', { value: stateMatch.value });
                    sendUpdate(`Selected state by partial match: ${stateMatch.text}`);
                }
            } catch (e2) {
                sendUpdate(`Warning: Could not select state. Please select manually.`);
            }
        }

        // Wait for district dropdown to populate based on state selection (network request)
        await page.waitForTimeout(3000);

        // District selection with robust fuzzy fallback (same as PPOB selectDropdownRobust)
        if (data.district) {
            try {
                await page.selectOption('#applnDistr', { label: data.district });
                sendUpdate(`Selected district: ${data.district}`);
            } catch (err) {
                sendUpdate(`Warning: Exact district match failed for "${data.district}", trying fuzzy match...`);
                try {
                    const distOptions = await page.$$eval('#applnDistr option', opts => opts.map(o => ({ value: o.value, text: o.innerText.trim() })));
                    const distMatch = distOptions.find(o => o.text.toUpperCase().includes(data.district.toUpperCase()) || data.district.toUpperCase().includes(o.text.toUpperCase()));
                    if (distMatch && distMatch.value) {
                        await page.selectOption('#applnDistr', { value: distMatch.value });
                        sendUpdate(`Selected district by fuzzy match: ${distMatch.text}`);
                    } else {
                        sendUpdate(`Warning: Could not find district "${data.district}" in dropdown. Please select manually.`);
                    }
                } catch (e2) {
                    sendUpdate(`Warning: District selection failed. Please select manually.`);
                }
            }
        }

        await page.fill('#bnm', data.legalName);
        await page.fill('#pan_card', data.pan);
        await page.fill('#email', data.email);
        await page.fill('#mobile', data.mobile);

        let initialCaptchaSuccess = false;
        while (!initialCaptchaSuccess) {
            // As requested: capture captcha image AFTER filling mobile number
            sendUpdate('Locating Captcha Image...');
            const captchaEl = await page.waitForSelector('#imgCaptcha', { state: 'visible' });

            // Wait a brief moment to ensure image is fully loaded
            await page.waitForTimeout(500);

            const captchaBuffer = await captchaEl.screenshot();
            const base64Image = captchaBuffer.toString('base64');

            // Emit image to backend
            console.log(`CAPTCHA_IMAGE:data:image/png;base64,${base64Image}`);
            sendUpdate('WAITING_FOR_CAPTCHA');

            // Wait for user input from stdin (backend pipes this when user clicks Verify)
            const captchaText = await new Promise(resolve => {
                process.stdin.once('data', (input) => {
                    resolve(input.toString().trim());
                });
            });

            sendUpdate('Verifying Captcha/OTP...');
            await page.fill('#captcha', captchaText);

            // Click Proceed button
            const proceedBtn = page.locator('button', { hasText: 'Proceed' }).last();
            await proceedBtn.click();

            // Phase 2: OTP Verification
            sendUpdate('Waiting for OTP verification screen...');
            try {
                // Wait for success or clear
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

        let initialOtpSuccess = false;
        while (!initialOtpSuccess) {
            sendUpdate('WAITING_FOR_OTP');

            // Wait for user input from stdin (backend pipes this when user submits OTPs)
            const otpsStr = await new Promise(resolve => {
                process.stdin.once('data', (input) => {
                    resolve(input.toString().trim());
                });
            });

            const [mobileOtp, emailOtp] = otpsStr.split(',');

            sendUpdate('Submitting OTPs...');
            // Robustly clear existing values before filling
            // GST portal uses #email-otp (with hyphen) as confirmed from portal source
            await page.evaluate(() => {
                const m = document.querySelector('#mobile_otp');
                if (m) m.value = '';
                // Try both possible selectors for email OTP field
                const e1 = document.querySelector('#email-otp');
                if (e1) e1.value = '';
                const e2 = document.querySelector('#email_otp');
                if (e2) e2.value = '';
            });
            await page.fill('#mobile_otp', mobileOtp);
            // Try both possible email OTP selectors
            const emailOtpFilled = await page.locator('#email-otp').count() > 0
                ? page.fill('#email-otp', emailOtp)
                : page.fill('#email_otp', emailOtp).catch(() => page.fill('#email-otp', emailOtp).catch(() => {}));
            await emailOtpFilled;

            // Click Proceed button on OTP page (use .last() to ensure we click the active one)
            const proceedOtpBtn = page.locator('button', { hasText: 'Proceed' }).last();
            await proceedOtpBtn.click();

            sendUpdate('Verifying OTPs...');
            try {
                // Wait for success or clear
                await page.waitForFunction(() => {
                    const trnEl = document.querySelector('span[data-ng-bind="trn"]');
                    if (trnEl && trnEl.textContent.trim().length > 5) return true;

                    const otpEl = document.querySelector('#mobile_otp');
                    if (otpEl && otpEl.value === '') return true;

                    const bodyText = document.body.innerText.toLowerCase();
                    if (bodyText.includes('invalid otp') || bodyText.includes('otp are invalid') || bodyText.includes('otp is invalid')) {
                        return true;
                    }
                    return false;
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
        // GST portal spans might fail visibility checks if initially empty, wait for attached and wait for text
        const trnLocator = page.locator('span[data-ng-bind="trn"]');
        await trnLocator.waitFor({ state: 'attached', timeout: 60000 });

        // Wait until it actually has text (TRN is 15 chars)
        await page.waitForFunction(() => {
            const el = document.querySelector('span[data-ng-bind="trn"]');
            return el && el.textContent.trim().length > 5;
        }, { timeout: 60000 });

        trnText = await trnLocator.textContent();

        sendUpdate(`TRN Generated: ${trnText}`);

        // Save TRN via API
        await new Promise((resolve, reject) => {
            const req = http.request(`http://127.0.0.1:3002/api/applications/${appId}/trn`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }
            }, (res) => {
                res.on('data', () => { });
                res.on('end', resolve);
            });
            req.on('error', reject);
            req.write(JSON.stringify({ trn: trnText }));
            req.end();
        });
        
        } // End of Part A else block

        // Go directly to TRN Login by reloading the registration page and clicking the TRN radio button
        sendUpdate('Navigating to TRN Login screen...');
        await page.goto('https://reg.gst.gov.in/registration/', { waitUntil: 'domcontentloaded' });
        await page.click('#radiotrn');

        await page.waitForSelector('#trnno', { state: 'visible', timeout: 30000 });
        await page.fill('#trnno', trnText);
        
        // Attempt to fill Email Address on TRN login screen (new portal update)
        try {
            sendUpdate('Checking for Email Address field on TRN login...');
            // Try common selectors for the email field
            const emailLocators = [
                page.locator('#email'),
                page.locator('#trn_email'),
                page.getByRole('textbox', { name: /Email/i }),
                page.locator('label').filter({ hasText: /Email/i }).locator('..').locator('input')
            ];
            
            let emailFilled = false;
            for (const loc of emailLocators) {
                if (await loc.count() > 0 && await loc.first().isVisible()) {
                    await loc.first().fill(data.email);
                    emailFilled = true;
                    sendUpdate('Successfully filled Email Address on TRN login.');
                    break;
                }
            }
            if (!emailFilled) {
                sendUpdate('Could not find Email field, skipping (might not be required).');
            }
        } catch (e) {
            console.error('Error filling TRN email:', e);
        }

        let trnLoginSuccess = false;
        while (!trnLoginSuccess) {
            sendUpdate('Locating TRN Login Captcha...');
            const loginCaptchaEl = await page.waitForSelector('#imgCaptcha', { state: 'visible' });
            await page.waitForTimeout(500); // ensure image is loaded

            const loginCaptchaBuffer = await loginCaptchaEl.screenshot();
            const loginBase64 = loginCaptchaBuffer.toString('base64');

            // Emit image to backend
            console.log(`CAPTCHA_IMAGE:data:image/png;base64,${loginBase64}`);
            sendUpdate('WAITING_FOR_CAPTCHA_TRN');

            // Wait for captcha input
            const loginCaptchaText = await new Promise(resolve => {
                process.stdin.once('data', (input) => {
                    resolve(input.toString().trim());
                });
            });

            sendUpdate('Verifying TRN Login...');
            await page.fill('#captchatrn', loginCaptchaText);

            // Click Proceed button for TRN Login
            const proceedTrnBtn = page.locator('button', { hasText: 'Proceed' }).last();
            await proceedTrnBtn.click();

            sendUpdate('Waiting for TRN Login OTP verification screen...');
            try {
                // Wait for success or clear
                await page.waitForFunction(() => {
                    const otpEl = document.querySelector('#mobile_otp');
                    const captchaEl = document.querySelector('#captchatrn');
                    if (otpEl && otpEl.offsetParent !== null) return true;
                    if (captchaEl && captchaEl.value === '') return true;
                    return false;
                }, { timeout: 30000 });

                const isCleared = await page.evaluate(() => {
                    const captchaEl = document.querySelector('#captchatrn');
                    return captchaEl && captchaEl.value === '';
                });

                if (isCleared) {
                    sendUpdate('Invalid Captcha. Retrying...');
                    await page.waitForTimeout(1000);
                } else {
                    trnLoginSuccess = true;
                }
            } catch (e) {
                throw new Error("Timeout waiting for TRN Login to proceed.");
            }
        }

        let trnOtpSuccess = false;
        while (!trnOtpSuccess) {
            sendUpdate('WAITING_FOR_TRN_OTP');

            // Wait for user input from stdin (backend pipes this when user submits the single TRN OTP)
            const trnOtp = await new Promise(resolve => {
                process.stdin.once('data', (input) => {
                    resolve(input.toString().trim());
                });
            });

            sendUpdate('Submitting TRN Login OTP...');
            await page.evaluate((otpVal) => {
                const m = document.querySelector('#mobile_otp');
                if (m) {
                    m.value = otpVal;
                    m.dispatchEvent(new Event('input', { bubbles: true }));
                    m.dispatchEvent(new Event('change', { bubbles: true }));
                }
                
                // Also close any potential error modals or toasts that might be blocking the view
                const closeBtns = document.querySelectorAll('button.close, .close-modal');
                closeBtns.forEach(btn => btn.click());
            }, trnOtp);

            // Wait a moment for framework to register the input
            await page.waitForTimeout(500);

            // Click Proceed button via evaluate to bypass overlays
            await page.evaluate(() => {
                const btn = document.querySelector('button[type="submit"].btn-primary');
                if (btn) btn.click();
            });

            sendUpdate('Verifying TRN OTP...');
            try {
                await page.waitForFunction(() => {
                    // Success condition: edit button appears
                    const editBtn = document.querySelector('button[data-ng-click="editSavedapp(x)"]');
                    if (editBtn && editBtn.offsetParent !== null) return true;

                    // Failure condition 1: OTP field is cleared
                    const otpEl = document.querySelector('#mobile_otp');
                    if (otpEl && otpEl.value === '') return true;

                    // Failure condition 2: "invalid" message appears
                    const bodyText = document.body.innerText.toLowerCase();
                    if (bodyText.includes('invalid otp') || bodyText.includes('otp are invalid') || bodyText.includes('otp is invalid')) {
                        return true;
                    }

                    return false;
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

        sendUpdate('Navigating to Dashboard...');

        // Wait for the Edit button to appear on the Dashboard
        const editButtonSelector = 'button[data-ng-click="editSavedapp(x)"]';
        await page.waitForSelector(editButtonSelector, { state: 'visible', timeout: 30000 });

        sendUpdate('Clicking Edit Application...');
        await page.click(editButtonSelector);

        // Wait for the form filling page to load
        await page.waitForTimeout(5000);

        sendUpdate('Filling Business Details tab...');

        if (data.tradeName) {
            sendUpdate('Filling Trade Name...');
            await page.fill('#tnm', data.tradeName, { timeout: 3000 }).catch(() => sendUpdate('Trade Name is read-only or disabled.'));
        }

        if (data.businessConstitution) {
            sendUpdate('Selecting Business Constitution...');
            try {
                await page.selectOption('#bd_ConstBuss', { label: data.businessConstitution });
            } catch (e) {
                sendUpdate(`Warning: Could not select Business Constitution: ${data.businessConstitution}`);
            }
        }

        if (data.businessDistrict) {
            sendUpdate('Selecting Business District...');
            try {
                await page.selectOption('#dst', { label: data.businessDistrict });
            } catch (e) {
                sendUpdate(`Warning: Could not select Business District: ${data.businessDistrict}`);
            }
        }
        if (data.rule14A) {
            sendUpdate('Selecting Rule 14A option...');
            const isYes = (typeof data.rule14A === 'string' && data.rule14A.toLowerCase() === 'yes') || data.rule14A === true || data.rule14A === 'Y';
            const radioValue = isYes ? 'Y' : 'N';
            try {
                await page.check(`input[name="bd_optCat"][value="${radioValue}"]`);
                if (isYes) {
                    try {
                        const checkbox = page.locator('#optCat_declaration');
                        if (await checkbox.count() > 0) {
                            await checkbox.check();
                            sendUpdate('Checked optCat_declaration for Rule 14A');
                        }
                    } catch (e2) {
                        sendUpdate('Warning: Could not check optCat_declaration');
                    }
                }
            } catch (e) {
                sendUpdate('Warning: Could not select Rule 14A');
            }
        }

        function convertDateToDDMMYYYY(dateStr) {
            if (!dateStr) return dateStr;
            const parts = dateStr.includes('-') ? dateStr.split('-') : dateStr.split('/');
            if (parts.length === 3) {
                if (parts[0].length === 4) {
                    // Format: YYYY-MM-DD or YYYY/MM/DD
                    return `${parts[2]}/${parts[1]}/${parts[0]}`;
                } else if (parts[2].length === 4) {
                    // Format: DD-MM-YYYY or DD/MM/YYYY
                    return `${parts[0]}/${parts[1]}/${parts[2]}`;
                }
            }
            return dateStr;
        }

        async function handleDocumentLegibilityModal(page) {
            try {
                // The popup might take a few seconds to appear after upload
                const continueBtn = page.getByRole('button', { name: 'CONTINUE', exact: true }).first();
                // Wait up to 5 seconds for the popup
                await continueBtn.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
                
                if (await continueBtn.isVisible()) {
                    sendUpdate('Handling document legibility warning popup (clicking Continue)...');
                    // Use evaluate to click it directly to bypass any pointer-events issues
                    await continueBtn.evaluate(b => b.click()).catch(async () => {
                        await continueBtn.click({ force: true });
                    });
                    await page.waitForTimeout(1500);
                }
            } catch(e) {}
        }

        async function robustFillPincode(page, selector, pincode) {
            if (!pincode) return;
            try {
                // Focus and clear bypassing actionability checks
                await page.evaluate((sel) => {
                    const el = document.querySelector(sel);
                    if (el) { el.focus(); el.value = ''; }
                }, selector);
                
                // Use keyboard.type to bypass strict pointer-events checks of page.type()
                await page.keyboard.type(pincode, { delay: 30 });
                
                // Wait for the dropdown list to appear
                try {
                    await page.waitForSelector(`ul li:has-text("${pincode}")`, { timeout: 4000 });
                } catch(e) {}
                
                const firstOptionLoc = page.locator(`ul li:has-text("${pincode}")`).first();
                let optionText = '';
                try { optionText = await firstOptionLoc.textContent({ timeout: 2000 }); } catch (e) {}
                
                if (optionText && optionText.includes(pincode)) {
                    await firstOptionLoc.evaluate(el => el.click()).catch(() => firstOptionLoc.click({ force: true }));
                    sendUpdate(`Pincode ${pincode} verified and selected.`);
                } else {
                    sendUpdate(`Pincode glitch detected. Clearing and retrying once...`);
                    
                    await page.evaluate((sel) => {
                        const el = document.querySelector(sel);
                        if (el) { el.focus(); el.value = ''; }
                    }, selector);
                    
                    await page.waitForTimeout(500);
                    await page.keyboard.type(pincode, { delay: 50 });
                    
                    try {
                        await page.waitForSelector(`ul li:has-text("${pincode}")`, { timeout: 4000 });
                        const retryOption = page.locator(`ul li:has-text("${pincode}")`).first();
                        if (await retryOption.count() > 0) {
                            await retryOption.evaluate(el => el.click()).catch(() => retryOption.click({ force: true, timeout: 2000 }));
                            sendUpdate(`Pincode ${pincode} verified and selected on retry.`);
                        }
                    } catch(e) {
                        sendUpdate(`Pincode autocomplete did not load. Continuing with manual input.`);
                        await page.keyboard.press('Tab');
                    }
                }
                await page.waitForTimeout(1000);
            } catch (e) {
                sendUpdate(`Warning: Could not fill pincode ${pincode}: ${e.message}`);
            }
        }

        if (data.dateOfCommencement) {
            sendUpdate('Filling Date of Commencement...');
            await page.fill('#bd_cmbz', convertDateToDDMMYYYY(data.dateOfCommencement), { timeout: 3000 }).catch(() => sendUpdate('Date of Commencement is read-only or disabled.'));
        }

        if (data.dateOfLiability) {
            sendUpdate('Filling Date of Liability...');
            await page.fill('#lib', convertDateToDDMMYYYY(data.dateOfLiability), { timeout: 3000 }).catch(() => sendUpdate('Date of Liability is read-only or disabled.'));
        }

        if ((data.reasonToObtainRegistration || data.reasonToObtain)) {
            sendUpdate('Selecting Reason to Obtain Registration...');
            try {
                await page.selectOption('#bd_rsl', { label: (data.reasonToObtainRegistration || data.reasonToObtain) });
            } catch (e) {
                sendUpdate(`Warning: Could not select Reason: ${(data.reasonToObtainRegistration || data.reasonToObtain)}`);
            }
        }



        if (data.existingRegistrations && Array.isArray(data.existingRegistrations) && data.existingRegistrations.length > 0) {
            for (const [index, reg] of data.existingRegistrations.entries()) {
                sendUpdate(`Processing Existing Registration Entry ${index + 1}...`);

                if (reg.type) {
                    sendUpdate(`Selecting Existing Registration Type: ${reg.type}`);
                    try {
                        await page.selectOption('#exty', { label: reg.type });
                    } catch (e) {
                        sendUpdate(`Warning: Could not select Type: ${reg.type}`);
                    }
                }

                if (reg.no) {
                    sendUpdate(`Filling Existing Registration No: ${reg.no}`);
                    await page.fill('#exno', reg.no);
                }

                if (reg.date) {
                    sendUpdate(`Filling Existing Registration Date: ${reg.date}`);
                    try {
                        const dateVal = convertDateToDDMMYYYY(reg.date);
                        await page.click('#exdt');
                        await page.waitForTimeout(200);
                        await page.locator('#exdt').selectText().catch(() => { });
                        await page.locator('#exdt').pressSequentially(dateVal, { delay: 80 });
                        await page.keyboard.press('Tab');
                        await page.waitForTimeout(500);
                    } catch (e) {
                        sendUpdate(`Warning: Could not fill Registration Date: ${e.message}`);
                    }
                }

                // Click Add button AFTER all fields (type, no, date) are filled
                sendUpdate('Clicking Add button for existing registration...');
                try {
                    await page.locator(
                        '#newRegForm > fieldset > div:nth-child(3) > div:nth-child(9) > div > div.col-xs-12.col-sm-3.pull-right > button.btn.btn-primary.rowtp-mar'
                    ).click();
                    await page.waitForTimeout(1000);
                } catch (e) {
                    sendUpdate('Warning: Could not click Add button');
                }
            } // end for loop
        } // end if existingRegistrations

        if (data.businessConstitution && data.businessConstitution.toLowerCase().trim() !== 'proprietorship' && data.businessConstitution.toLowerCase().trim() !== 'sole proprietorship') {
            if (data.proofOfConstitutionType) {
                sendUpdate('Selecting Proof of Constitution Type...');
                try {
                    await page.selectOption('#bd_up_type', { label: data.proofOfConstitutionType });
                } catch (e) {
                    sendUpdate(`Warning: Could not select Proof of Constitution Type: ${data.proofOfConstitutionType}`);
                }
            }

            if (data.proofOfConstitutionFile) {
                sendUpdate('Uploading Proof of Constitution...');
                let filePathToUpload = data.proofOfConstitutionFile;

                if (data.proofOfConstitutionFile.startsWith('data:image') || data.proofOfConstitutionFile.startsWith('data:application/pdf')) {
                    const base64Data = data.proofOfConstitutionFile.replace(/^data:.*?;base64,/, "");
                    const fs = require('fs');
                    const path = require('path');
                    const ext = data.proofOfConstitutionFile.includes('application/pdf') ? 'pdf' : 'jpg';
                    const tempFilePath = path.join(__dirname, `temp_proof_constitution.${ext}`);
                    fs.writeFileSync(tempFilePath, base64Data, 'base64');
                    filePathToUpload = tempFilePath;
                }

                try {
                    // Properly intercept the file system dialog popup
                    const [fileChooser] = await Promise.all([
                        page.waitForEvent('filechooser', { timeout: 10000 }),
                        page.click('#bd_upload')
                    ]);
                    await fileChooser.setFiles(filePathToUpload);
                } catch (uploadErr) {
                    sendUpdate('Warning: Intercept failed for Constitution Proof, attempting direct input assignment...');
                    await page.setInputFiles('#bd_upload', filePathToUpload).catch(() => { });
                }
                await handleDocumentLegibilityModal(page);
            }
        }

        if (data.documentForTradeNameFile) {
            sendUpdate('Uploading Document for Trade Name...');
            let filePathToUpload = data.documentForTradeNameFile;
            
            if (data.documentForTradeNameFile.startsWith('data:image') || data.documentForTradeNameFile.startsWith('data:application/pdf')) {
                const base64Data = data.documentForTradeNameFile.replace(/^data:.*?;base64,/, "");
                const fs = require('fs');
                const path = require('path');
                const ext = data.documentForTradeNameFile.includes('application/pdf') ? 'pdf' : 'jpg';
                const tempFilePath = path.join(__dirname, `temp_tradename.${ext}`);
                fs.writeFileSync(tempFilePath, base64Data, 'base64');
                filePathToUpload = tempFilePath;
            }
            
            try {
                // Wait for the upload inputs and try to use the last one (since trade name upload is second)
                const fileInputs = page.locator('input[type="file"]');
                const count = await fileInputs.count();
                if (count > 1) {
                    await fileInputs.nth(1).setInputFiles(filePathToUpload);
                } else if (count > 0) {
                    await fileInputs.last().setInputFiles(filePathToUpload);
                }
            } catch (e) {
                sendUpdate('Warning: Could not upload Trade Name Document');
            }
            await handleDocumentLegibilityModal(page);
        }

        await page.waitForTimeout(2000);
        await saveAndContinueToTab(page, 'Promoter', '#newRegForm button.btn.btn-primary:has-text("Save & Continue")');

        // ============================================
        // PROMOTER / PARTNER DETAILS - MULTIPLE PROMOTERS
        // Supports p1 to p10
        // ============================================

        async function fillPromoterDetails(promoter, promoterIndex) {
            sendUpdate(`Filling Promoter ${promoterIndex} Details...`);

            try {
                if (promoter.firstName) await page.fill('#fnm', promoter.firstName);
                if (promoter.middleName) await page.fill('#pd_mname', promoter.middleName);
                if (promoter.lastName) await page.fill('#pd_lname', promoter.lastName);

                if (promoter.fatherFirstName) await page.fill('#ffname', promoter.fatherFirstName);
                if (promoter.fatherMiddleName) await page.fill('#pd_fmname', promoter.fatherMiddleName);
                if (promoter.fatherLastName) await page.fill('#pd_flname', promoter.fatherLastName);

                if (promoter.dob) await page.fill('#dob', convertDateToDDMMYYYY(promoter.dob));

                if (promoter.gender) {
                    try {
                        const gender = promoter.gender.toLowerCase();
                        if (gender === 'male') await page.click('#radiomale');
                        else if (gender === 'female') await page.click('#radiofemale');
                        else await page.click('#radiotrans');
                    } catch (e) {
                        sendUpdate(`Warning: Could not select gender for Promoter ${promoterIndex}`);
                    }
                }

                if (promoter.mobile) await page.fill('#mbno', promoter.mobile);
                if (promoter.email) await page.fill('#pd_email', promoter.email);
                if (promoter.designation) await page.fill('#dg', promoter.designation);
                if (promoter.din) await page.fill('#din', promoter.din);
                if (promoter.pan) await page.fill('#pan', promoter.pan);
                if (promoter.passport) await page.fill('#ppno', promoter.passport);

                if (promoter.res_country) {
                    try {
                        await page.selectOption('select[name="pd_cntry"]', { label: promoter.res_country });
                    } catch (e) {
                        sendUpdate(`Warning: Could not select promoter country for Promoter ${promoterIndex}`);
                    }
                }

                if (promoter.res_pincode) {
                    await robustFillPincode(page, '#pncd', promoter.res_pincode);
                }

                if (promoter.res_locality) await page.type('#pd_locality', promoter.res_locality, { delay: 30 });

                if (promoter.res_road) {
                    try {
                        await page.type('#pd_road', promoter.res_road, { delay: 30 });
                        await page.waitForTimeout(2000);
                        await page.locator(`ul li:has-text("${promoter.res_road}")`).first().click({ timeout: 5000 }).catch(() => { });
                        await page.waitForTimeout(1000);
                    } catch (e) {
                        sendUpdate(`Warning: Could not fill road/street for Promoter ${promoterIndex}`);
                    }
                }

                if (promoter.res_buildingName) {
                    try {
                        await page.type('#pd_bdname', promoter.res_buildingName, { delay: 30 });
                        await page.waitForTimeout(2000);
                        await page.locator(`ul li:has-text("${promoter.res_buildingName}")`).first().click({ timeout: 5000 }).catch(() => { });
                        await page.waitForTimeout(1000);
                    } catch (e) {
                        sendUpdate(`Warning: Could not fill building name for Promoter ${promoterIndex}`);
                    }
                }

                if (promoter.res_buildingNo) {
                    try {
                        await page.type('#pd_bdnum', promoter.res_buildingNo, { delay: 30 });
                        await page.waitForTimeout(2000);
                        await page.locator(`ul li:has-text("${promoter.res_buildingNo}")`).first().click({ timeout: 5000 }).catch(() => { });
                        await page.waitForTimeout(1000);
                    } catch (e) {
                        sendUpdate(`Warning: Could not fill building number for Promoter ${promoterIndex}`);
                    }
                }

                if (promoter.res_floor) await page.type('#pd_flrnum', promoter.res_floor, { delay: 30 });
                if (promoter.res_landmark) await page.type('#pd_landmark', promoter.res_landmark, { delay: 30 });

                if (promoter.promoterPhotoFile) {
                    sendUpdate(`Uploading Promoter ${promoterIndex} Photo...`);

                    let filePathToUpload = promoter.promoterPhotoFile;

                    if (promoter.promoterPhotoFile.startsWith('data:image')) {
                        const base64Data = promoter.promoterPhotoFile.replace(/^data:.*?;base64,/, "");
                        const fs = require('fs');
                        const path = require('path');

                        const tempFilePath = path.join(
                            __dirname,
                            `temp_promoter_photo_${promoterIndex}.jpg`
                        );

                        fs.writeFileSync(tempFilePath, base64Data, 'base64');
                        filePathToUpload = tempFilePath;
                    }

                    try {
                        // First try: direct setInputFiles (most reliable)
                        const uploadInput = page.locator('#pd_upload');
                        const isVisible = await uploadInput.count() > 0;
                        if (isVisible) {
                            await page.evaluate(() => {
                                const el = document.querySelector('#pd_upload');
                                if (el) el.removeAttribute('style');
                            });
                            await uploadInput.setInputFiles(filePathToUpload).catch(async () => {
                                // Second try: filechooser event
                                sendUpdate(`Warning: Direct upload failed for Promoter ${promoterIndex} photo, trying filechooser...`);
                                const [fileChooser] = await Promise.all([
                                    page.waitForEvent('filechooser', { timeout: 8000 }),
                                    page.click('#pd_upload')
                                ]);
                                await fileChooser.setFiles(filePathToUpload);
                            });
                        }
                    } catch (uploadErr) {
                        sendUpdate(`Warning: Could not upload Promoter ${promoterIndex} photo: ${uploadErr.message}`);
                    }
                    await handleDocumentLegibilityModal(page);
                }

                // NOTE: The alsoAuthorizedSignatory click is handled ONLY by clickAlsoAuthorizedSignatoryIfNeeded()
                // to prevent double-clicking. Do NOT click it here as well.

                sendUpdate(`Promoter ${promoterIndex} details filled successfully.`);
            } catch (e) {
                sendUpdate(`Warning: Promoter ${promoterIndex} filling had issue: ${e.message}`);
            }
        }

        async function clickAlsoAuthorizedSignatoryIfNeeded(promoterIndex, promoter) {
            // Only click if this promoter is explicitly marked as alsoAuthorizedSignatory
            const shouldClick = promoter && (
                String(promoter.alsoAuthorizedSignatory).toLowerCase() === 'yes' ||
                promoter.alsoAuthorizedSignatory === true ||
                promoter.alsoAuthorizedSignatory === 'true'
            );

            if (shouldClick) {
                sendUpdate(`Clicking Also Authorized Signatory for Promoter ${promoterIndex}...`);
                try {
                    // Check if already checked to prevent double-click
                    const isChecked = await page.isChecked('#pri_auth').catch(() => false);
                    if (!isChecked) {
                        // Try label click first (most reliable)
                        await page.locator('label[for="pri_auth"]').click({ timeout: 3000 })
                            .catch(() => page.click('#pri_auth', { force: true, timeout: 2000 })
                            .catch(() => sendUpdate('Warning: Could not check #pri_auth')));
                    } else {
                        sendUpdate(`Promoter ${promoterIndex} Already Authorized Signatory checkbox already checked.`);
                    }
                } catch (e) {
                    sendUpdate(`Warning: Could not click Also Authorized Signatory: ${e.message}`);
                }
                await page.waitForTimeout(500);
            }
        }

        async function fillAllPromoters(data) {
            let filledAnyPromoter = false;

            for (let i = 1; i <= 10; i++) {
                const promoter = data[`p${i}`];

                if (!promoter) {
                    if (i === 1) {
                        sendUpdate('Warning: Promoter p1 data not found.');
                    }
                    break;
                }

                filledAnyPromoter = true;

                await fillPromoterDetails(promoter, i);

                // Keep your existing primary authorized signatory checkbox logic.
                // Usually this is applicable for p1.
                await clickAlsoAuthorizedSignatoryIfNeeded(i, promoter);

                const nextPromoter = data[`p${i + 1}`];

                if (nextPromoter && i < 10) {
                    sendUpdate(`Promoter ${i + 1} found. Clicking Add New...`);

                    try {
                        // Wait for button to appear and be stable
                        const addNewBtnSelector = 'button[data-ng-click="addPromoter(\'savenew\')"]';
                        await page.waitForSelector(addNewBtnSelector, { state: 'visible', timeout: 15000 });
                        await page.waitForTimeout(1000);
                        await clickAndHandleMapError(page, addNewBtnSelector);
                        await handleLocalityWarning(page);
                        await page.waitForTimeout(2000);
                    } catch (e) {
                        sendUpdate(`Warning: Could not click Add New after Promoter ${i}: ${e.message}`);
                        // Don't break - try to continue with Save & Continue instead
                        sendUpdate('Attempting Save & Continue as fallback...');
                        await saveAndContinueToTab(page, 'Authorized Signatory', 'button[title="Save & Continue"]').catch(() => {});
                        break;
                    }
                } else {
                    sendUpdate('No more promoters found.');
                    await saveAndContinueToTab(page, 'Authorized Signatory', 'button[title="Save & Continue"]');
                    await handleLocalityWarning(page);

                    break;
                }
            }

            if (filledAnyPromoter) {
                await handleLocalityWarning(page);
            }
        }

        // Call multiple promoter filling
        await fillAllPromoters(data);
        // ============================================
        // AUTHORIZED SIGNATORY DETAILS
        // ============================================
        async function fillAuthSigDetails(authSig, i) {
            sendUpdate(`Filling Authorized Signatory ${i} Details...`);

            if (authSig.primary) {
                sendUpdate('Checking Primary Auth Sig box...');
                try {
                    await page.click('#auth_prim');
                    await page.waitForTimeout(1000);

                } catch (e) {
                    sendUpdate('Warning: Could not check #auth_prim');
                }
            }

            if (authSig.firstName) await page.fill('#fnm', authSig.firstName).catch(() => { });
            if (authSig.middleName) await page.fill('#as_mname', authSig.middleName).catch(() => { });
            if (authSig.lastName) await page.fill('#as_lname', authSig.lastName).catch(() => { });
            if (authSig.fatherFirstName) await page.fill('#ffname', authSig.fatherFirstName).catch(() => { });
            if (authSig.fatherMiddleName) await page.fill('#as_fmname', authSig.fatherMiddleName).catch(() => { });
            if (authSig.fatherLastName) await page.fill('#as_flname', authSig.fatherLastName).catch(() => { });

            if (authSig.dob) {
                await page.fill('#dob', convertDateToDDMMYYYY(authSig.dob)).catch(() => { });
            }

            if (authSig.gender) {
                const gender = authSig.gender.toLowerCase();
                if (gender === 'male') await page.click('#radiomale').catch(() => { });
                else if (gender === 'female') await page.click('#radiofemale').catch(() => { });
                else await page.click('#radiotrans').catch(() => { });
            }

            if (authSig.mobile) await page.fill('#mbno', authSig.mobile).catch(() => { });
            if (authSig.email) await page.fill('#em', authSig.email).catch(() => { });
            if (authSig.designation) await page.fill('#dg', authSig.designation).catch(() => { });
            if (authSig.din) await page.fill('#din', authSig.din).catch(() => { });
            if (authSig.pan) await page.fill('#pan', authSig.pan).catch(() => { });
            if (authSig.passport) await page.fill('#ppno', authSig.passport).catch(() => { });

            if (authSig.res_country) {
                try {
                    await page.selectOption('#cnty', { label: authSig.res_country });
                } catch (e) {
                    sendUpdate('Warning: Could not select Auth Sig country');
                }
            }

            if (authSig.res_pincode) {
                await robustFillPincode(page, '#pncd', authSig.res_pincode);
            }

            if (authSig.res_locality) await page.type('#as_locality', authSig.res_locality, { delay: 30 }).catch(() => { });

            if (authSig.res_road) {
                await page.type('#st', authSig.res_road, { delay: 30 }).catch(() => { });
                await page.waitForTimeout(2000);
                await page.locator(`ul li:has-text("${authSig.res_road}")`).first().click({ timeout: 5000 }).catch(() => { });
                await page.waitForTimeout(1000);
            }

            if (authSig.res_buildingName) {
                await page.type('#as_bdname', authSig.res_buildingName, { delay: 30 }).catch(() => { });
                await page.waitForTimeout(2000);
                await page.locator(`ul li:has-text("${authSig.res_buildingName}")`).first().click({ timeout: 5000 }).catch(() => { });
                await page.waitForTimeout(1000);
            }

            if (authSig.res_buildingNo) {
                await page.type('#bno', authSig.res_buildingNo, { delay: 30 }).catch(() => { });
                await page.waitForTimeout(2000);
                await page.locator(`ul li:has-text("${authSig.res_buildingNo}")`).first().click({ timeout: 5000 }).catch(() => { });
                await page.waitForTimeout(1000);
            }

            if (authSig.res_floor) await page.type('#as_flrnum', authSig.res_floor, { delay: 30 }).catch(() => { });
            if (authSig.res_landmark) await page.type('#pd_landmark', authSig.res_landmark, { delay: 30 }).catch(() => { });

            if (authSig.authSigProofType) {
                try {
                    await page.waitForSelector('#as_up_type', { state: 'visible', timeout: 5000 });
                    await page.selectOption('#as_up_type', { label: authSig.authSigProofType });
                } catch (e) {
                    sendUpdate('Warning: Could not select authSigProofType');
                }
            }

            if (authSig.authSigProofFile) {
                sendUpdate('Uploading Authorized Signatory Proof...');
                let filePathToUpload = authSig.authSigProofFile;
                if (authSig.authSigProofFile.startsWith('data:image') || authSig.authSigProofFile.startsWith('data:application/pdf')) {
                    const base64Data = authSig.authSigProofFile.replace(/^data:.*?;base64,/, "");
                    const fs = require('fs');
                    const path = require('path');
                    const ext = authSig.authSigProofFile.includes('application/pdf') ? 'pdf' : 'jpg';
                    const tempFilePath = path.join(__dirname, `temp_auth_sig_proof.${ext}`);
                    fs.writeFileSync(tempFilePath, base64Data, 'base64');
                    filePathToUpload = tempFilePath;
                }

                try {
                    await page.waitForSelector('#as_upload_sign', { state: 'attached', timeout: 5000 });
                    await page.waitForTimeout(1000);
                    const [fileChooser] = await Promise.all([
                        page.waitForEvent('filechooser', { timeout: 10000 }),
                        page.click('#as_upload_sign')
                    ]);
                    await fileChooser.setFiles(filePathToUpload);
                } catch (uploadErr) {
                    sendUpdate('Warning: Intercept failed for Auth Sig Proof, attempting direct input assignment...');
                    await page.setInputFiles('#as_upload_sign', filePathToUpload).catch(() => { });
                }
                await handleDocumentLegibilityModal(page);
            }

            if (authSig.authSigPhotoFile) {
                sendUpdate('Uploading Authorized Signatory Photo...');
                let filePathToUpload = authSig.authSigPhotoFile;
                if (authSig.authSigPhotoFile.startsWith('data:image')) {
                    const base64Data = authSig.authSigPhotoFile.replace(/^data:.*?;base64,/, "");
                    const fs = require('fs');
                    const path = require('path');
                    const tempFilePath = path.join(__dirname, 'temp_auth_sig_photo.jpg');
                    fs.writeFileSync(tempFilePath, base64Data, 'base64');
                    filePathToUpload = tempFilePath;
                }

                try {
                    const [fileChooser] = await Promise.all([
                        page.waitForEvent('filechooser', { timeout: 10000 }),
                        page.click('#as_upload_photo')
                    ]);
                    await fileChooser.setFiles(filePathToUpload);
                } catch (uploadErr) {
                    sendUpdate('Warning: Intercept failed for Auth Sig Photo, attempting direct input assignment...');
                    await page.setInputFiles('#as_upload_photo', filePathToUpload).catch(() => { });
                }
                await handleDocumentLegibilityModal(page);
            }
        }

        async function fillAllAuthSigs(data) {
            let filledAnyAuthSig = false;

            for (let i = 1; i <= 10; i++) {
                const authSig = data[`a${i}`];

                if (!authSig) {
                    if (i === 1) {
                        sendUpdate('Warning: Authorized Signatory a1 data not found.');
                    }
                    break;
                }

                filledAnyAuthSig = true;
                await fillAuthSigDetails(authSig, i);

                // Check if there is a next signatory
                if (data[`a${i + 1}`]) {
                    sendUpdate(`More Authorized Signatories exist. Clicking Add New after a${i}...`);
                    try {
                        const addBtn = page.locator('button').filter({ hasText: /ADD NEW/i }).first();
                        if (await addBtn.isVisible({ timeout: 2000 })) {
                            await addBtn.click();
                        } else {
                            await page.click('#newRegForm > div:nth-child(5) > div:nth-child(9) > div > button:nth-child(3)');
                        }
                        await page.waitForTimeout(2000);
                        await handleLocalityWarning(page);
                    } catch (e) {
                        sendUpdate(`Warning: Could not click Add New after Authorized Signatory ${i}: ${e.message}`);
                        break;
                    }
                } else {
                    sendUpdate('No more Authorized Signatories found.');
                    await saveAndContinueToTab(page, 'Authorized Representative', 'button[title="Save & Continue"]');
                    await handleLocalityWarning(page);

                    sendUpdate('Skipping Authorized Representative page...');
                    await saveAndContinueToTab(page, 'Principal Place of Business', 'button[title="Save & Continue"]');
                    await handleLocalityWarning(page);
                    break;
                }
            }
        }

        let hasPromoterAuthSig = false;
        for (let i = 1; i <= 10; i++) {
            if (data[`p${i}`] && data[`p${i}`].alsoAuthorizedSignatory) {
                hasPromoterAuthSig = true;
                break;
            }
        }

        if (!hasPromoterAuthSig) {
            sendUpdate('Condition 1: No promoter is Also Authorized Signatory. Filling Auth Sig details from scratch...');
            await fillAllAuthSigs(data);
        } else {
            let promoterAuthSigs = [];
            for (let i = 1; i <= 10; i++) {
                if (data[`p${i}`] && data[`p${i}`].alsoAuthorizedSignatory) {
                    promoterAuthSigs.push(data[`p${i}`]);
                }
            }

            // Only count as "pure" auth sig if it's a genuinely DIFFERENT person from all promoters
            let hasPureAuthSigs = false;
            const promoterEmails = new Set();
            const promoterNames = new Set();
            for (let i = 1; i <= 10; i++) {
                const p = data[`p${i}`];
                if (p) {
                    if (p.email) promoterEmails.add(p.email.toLowerCase().trim());
                    const fullName = `${p.firstName||''} ${p.lastName||''}`.toLowerCase().trim();
                    if (fullName) promoterNames.add(fullName);
                }
            }
            for (let i = 1; i <= 10; i++) {
                const a = data[`a${i}`];
                if (a && Object.keys(a).length > 0) {
                    const aEmail = (a.email || '').toLowerCase().trim();
                    const aName = `${a.firstName||''} ${a.lastName||''}`.toLowerCase().trim();
                    // Only pure if email and name don't match any promoter
                    const isDuplicate = (aEmail && promoterEmails.has(aEmail)) || (aName && promoterNames.has(aName));
                    if (!isDuplicate) {
                        hasPureAuthSigs = true;
                        break;
                    }
                }
            }

            if (promoterAuthSigs.length === 1) {
                sendUpdate('Condition 4: Only 1 promoter is Authorized Signatory. Editing directly on form...');
                const pData = promoterAuthSigs[0];

                if (pData.primary) {
                    sendUpdate('Checking Primary Auth Sig box...');
                    try {
                        await page.click('#auth_prim');
                        await page.waitForTimeout(1000);
                    } catch (e) {
                        sendUpdate('Warning: Could not check #auth_prim');
                    }
                }

                if (pData.authSigProofType) {
                    sendUpdate('Selecting Authorized Signatory Proof Type...');
                    try {
                        await page.waitForSelector('#as_up_type', { state: 'visible', timeout: 8000 });
                        // Try by label first, fallback to value match
                        const selectSuccess = await page.evaluate((label) => {
                            const sel = document.querySelector('#as_up_type');
                            if (!sel) return false;
                            const opt = Array.from(sel.options).find(o =>
                                o.text.toLowerCase().includes(label.toLowerCase()) ||
                                o.value.toLowerCase().includes(label.toLowerCase())
                            );
                            if (opt) { sel.value = opt.value; sel.dispatchEvent(new Event('change', { bubbles: true })); return true; }
                            return false;
                        }, pData.authSigProofType);
                        if (!selectSuccess) {
                            await page.selectOption('#as_up_type', { label: pData.authSigProofType });
                        }
                        await page.waitForTimeout(500);
                    } catch (e) {
                        sendUpdate(`Warning: Could not select authSigProofType: ${e.message}`);
                    }
                }

                if (pData.authSigProofFile) {
                    sendUpdate('Uploading Authorized Signatory Proof...');
                    let filePathToUpload = pData.authSigProofFile;
                    if (pData.authSigProofFile.startsWith('data:image') || pData.authSigProofFile.startsWith('data:application/pdf')) {
                        const base64Data = pData.authSigProofFile.replace(/^data:.*?;base64,/, "");
                        const fs = require('fs');
                        const path = require('path');
                        const ext = pData.authSigProofFile.includes('application/pdf') ? 'pdf' : 'jpg';
                        const tempFilePath = path.join(__dirname, `temp_auth_sig_proof_0.${ext}`);
                        fs.writeFileSync(tempFilePath, base64Data, 'base64');
                        filePathToUpload = tempFilePath;
                    }

                    try {
                        await page.waitForSelector('#as_upload_sign', { state: 'attached', timeout: 8000 });
                        await page.waitForTimeout(500);
                        // Direct setInputFiles is most reliable - removes event dependency
                        await page.evaluate(() => {
                            const el = document.querySelector('#as_upload_sign');
                            if (el) el.removeAttribute('style');
                        });
                        await page.locator('#as_upload_sign').setInputFiles(filePathToUpload).catch(async () => {
                            sendUpdate('Warning: Direct upload failed for Auth Sig Proof, trying filechooser...');
                            const [fileChooser] = await Promise.all([
                                page.waitForEvent('filechooser', { timeout: 8000 }),
                                page.click('#as_upload_sign')
                            ]);
                            await fileChooser.setFiles(filePathToUpload);
                        });
                    } catch (uploadErr) {
                        sendUpdate(`Warning: Could not upload Auth Sig Proof: ${uploadErr.message}`);
                    }
                    await page.waitForTimeout(2000);
                }

                if (hasPureAuthSigs) {
                    sendUpdate('Additional pure Authorized Signatories exist. Clicking ADD NEW on form...');
                    try {
                        const addBtn = page.locator('button').filter({ hasText: /ADD NEW/i }).first();
                        if (await addBtn.isVisible({ timeout: 2000 })) {
                            await addBtn.click();
                        } else {
                            await page.click('#newRegForm > div:nth-child(5) > div:nth-child(9) > div > button:nth-child(3)');
                        }
                        await page.waitForTimeout(2000);
                        await handleLocalityWarning(page);
                    } catch (e) {
                        sendUpdate('Warning: Could not click ADD NEW button on form');
                    }
                    await fillAllAuthSigs(data);
                } else {
                    sendUpdate('No additional Authorized Signatories.');
                    try {
                        await saveAndContinueToTab(page, 'Authorized Representative', 'button[title="Save & Continue"]');
                        await handleLocalityWarning(page);

                        sendUpdate('Skipping Authorized Representative page...');
                        await saveAndContinueToTab(page, 'Principal Place of Business', 'button[title="Save & Continue"]');
                        await handleLocalityWarning(page);
                    } catch (e) { }
                }
            } else {
                sendUpdate('Condition 2: Multiple Promoters are Authorized Signatories. Editing from list...');
                for (let idx = 0; idx < promoterAuthSigs.length; idx++) {
                    const pData = promoterAuthSigs[idx];
                    sendUpdate(`Processing Promoter Auth Sig ${idx + 1}...`);

                    try {
                        const editButtons = page.locator('table tbody tr td button').filter({ hasText: /edit/i });
                        if (await editButtons.count() === 0) {
                            const fallbackBtns = page.locator('table tbody tr td button.btn-primary');
                            await fallbackBtns.nth(idx).click({ timeout: 5000 });
                        } else {
                            await editButtons.nth(idx).click({ timeout: 5000 });
                        }
                        await page.waitForTimeout(2000);
                    } catch (e) {
                        sendUpdate(`Warning: Could not click EDIT button ${idx + 1}`);
                    }

                    if (pData.primary) {
                        sendUpdate('Checking Primary Auth Sig box...');
                        try {
                            await page.click('#auth_prim');
                            await page.waitForTimeout(1000);
                        } catch (e) {
                            sendUpdate('Warning: Could not check #auth_prim');
                        }
                    }

                    if (pData.authSigProofType) {
                        sendUpdate('Selecting Authorized Signatory Proof Type...');
                        try {
                            await page.waitForSelector('#as_up_type', { state: 'visible', timeout: 5000 });
                            await page.selectOption('#as_up_type', { label: pData.authSigProofType });
                            await page.waitForTimeout(500);
                        } catch (e) {
                            sendUpdate('Warning: Could not select authSigProofType');
                        }
                    }

                    if (pData.authSigProofFile) {
                        sendUpdate('Uploading Authorized Signatory Proof...');
                        let filePathToUpload = pData.authSigProofFile;
                        if (pData.authSigProofFile.startsWith('data:image') || pData.authSigProofFile.startsWith('data:application/pdf')) {
                            const base64Data = pData.authSigProofFile.replace(/^data:.*?;base64,/, "");
                            const fs = require('fs');
                            const path = require('path');
                            const ext = pData.authSigProofFile.includes('application/pdf') ? 'pdf' : 'jpg';
                            const tempFilePath = path.join(__dirname, `temp_auth_sig_proof_${idx}.${ext}`);
                            fs.writeFileSync(tempFilePath, base64Data, 'base64');
                            filePathToUpload = tempFilePath;
                        }

                        try {
                            await page.waitForSelector('#as_upload_sign', { state: 'attached', timeout: 5000 });
                            await page.waitForTimeout(1000);
                            const [fileChooser] = await Promise.all([
                                page.waitForEvent('filechooser', { timeout: 10000 }),
                                page.click('#as_upload_sign')
                            ]);
                            await fileChooser.setFiles(filePathToUpload);
                        } catch (uploadErr) {
                            sendUpdate('Warning: Intercept failed for Auth Sig Proof, attempting direct input assignment...');
                            await page.setInputFiles('#as_upload_sign', filePathToUpload).catch(() => { });
                        }
                        await handleDocumentLegibilityModal(page);
                    }

                    sendUpdate('Clicking Save button...');
                    try {
                        // Use text-based selector instead of fragile nth-child CSS path
                        const savedClicked = await page.locator('button:has-text("Save")').last().click({ timeout: 3000 })
                            .then(() => true)
                            .catch(async () => {
                                // Fallback: try the specific CSS path
                                try {
                                    await page.click('#newRegForm > div:nth-child(5) > div:nth-child(8) > div > button.btn.btn-primary', { timeout: 2000 });
                                    return true;
                                } catch (e) {
                                    return false;
                                }
                            });
                        if (!savedClicked) {
                            sendUpdate('Warning: Could not find Save button for Auth Sig. Please click manually.');
                        }
                        await page.waitForTimeout(2000);
                        await handleLocalityWarning(page);
                    } catch (e) {
                        sendUpdate('Warning: Could not click save button');
                    }
                }

                if (hasPureAuthSigs) {
                    sendUpdate('Condition 3: Additional pure Authorized Signatories (a1, a2...) exist. Clicking ADD NEW on list...');
                    try {
                        const addNewBtn = page.locator('button').filter({ hasText: /ADD NEW/i }).first();
                        await addNewBtn.click({ timeout: 4000 });
                        await page.waitForTimeout(2000);
                    } catch (e) {
                        sendUpdate('Warning: Could not click ADD NEW button on Authorized Signatory list page');
                    }
                    await fillAllAuthSigs(data);
                } else {
                    sendUpdate('No additional Authorized Signatories. Skipping Auth Sig list page...');
                    try {
                        await saveAndContinueToTab(page, 'Authorized Representative', 'button[title="Save & Continue"]');
                        await handleLocalityWarning(page);

                        sendUpdate('Skipping Authorized Representative page...');
                        await saveAndContinueToTab(page, 'Principal Place of Business', 'button[title="Save & Continue"]');
                        await handleLocalityWarning(page);
                    } catch (e) {
                        sendUpdate(`Warning: Could not skip Auth Sig pages: ${e.message}`);
                    }
                }
            }
        }
        // ============================================
        // PRINCIPAL PLACE OF BUSINESS (PPOB)
        // ============================================
        sendUpdate('Filling Principal Place of Business Details...');
        try {
            await page.waitForSelector('#pncd', { state: 'visible', timeout: 15000 });

            if (data.ppob_pincode) {
                await robustFillPincode(page, '#pncd', data.ppob_pincode);
            }

            if (data.ppob_city) {
                sendUpdate('Filling City in Principal Place of Business...');
                // Try multiple possible selectors for city field
                const citySelectors = ['#loc', '#bp_cty', '#city', 'input[placeholder*="City"]', 'input[placeholder*="Town"]', '#ppbzdtls_city'];
                let cityFilled = false;
                for (const sel of citySelectors) {
                    try {
                        const cityInput = page.locator(sel).first();
                        if (await cityInput.count() > 0 && await cityInput.isVisible({ timeout: 2000 })) {
                            await cityInput.click({ timeout: 2000 });
                            await page.keyboard.press('Control+A');
                            await page.keyboard.press('Backspace');
                            await cityInput.fill('');
                            await page.waitForTimeout(300);
                            await cityInput.type(data.ppob_city, { delay: 30 });
                            await page.waitForTimeout(2000);
                            // Try clicking autocomplete option if it appears
                            await page.locator(`ul li:has-text("${data.ppob_city}")`).first().click({ timeout: 3000 }).catch(() => {});
                            await page.waitForTimeout(500);
                            cityFilled = true;
                            sendUpdate(`City '${data.ppob_city}' filled using selector '${sel}'.`);
                            break;
                        }
                    } catch (e) { /* try next selector */ }
                }
                if (!cityFilled) {
                    sendUpdate('Warning: Could not find city field. Continuing...');
                }
            }

            if (data.ppob_locality) {
                try {
                    // Try multiple selectors for locality
                    for (const sel of ['#ppbzdtls_locality', '#locality', '#loc_sbloc', 'input[placeholder*="Locality"]']) {
                        if (await page.locator(sel).count() > 0) {
                            await page.locator(sel).first().fill('');
                            await page.locator(sel).first().type(data.ppob_locality, { delay: 30 });
                            sendUpdate(`Locality filled.`);
                            break;
                        }
                    }
                } catch (e) { sendUpdate('Warning: Could not fill locality field'); }
            }

            if (data.ppob_street) {
                try {
                    for (const sel of ['#st', '#street', '#rd', 'input[placeholder*="Road"]', 'input[placeholder*="Street"]']) {
                        if (await page.locator(sel).count() > 0) {
                            await page.locator(sel).first().fill('');
                            await page.locator(sel).first().type(data.ppob_street, { delay: 30 });
                            await page.waitForTimeout(1500);
                            await page.locator(`ul li`).first().click({ timeout: 3000 }).catch(() => {});
                            sendUpdate(`Street filled.`);
                            break;
                        }
                    }
                } catch (e) { sendUpdate('Warning: Could not fill street field'); }
            }

            if (data.ppob_building) {
                try {
                    for (const sel of ['#bp_bdname', '#bdname', '#building', 'input[placeholder*="Building"]', 'input[placeholder*="Premises"]']) {
                        if (await page.locator(sel).count() > 0) {
                            await page.locator(sel).first().fill('');
                            await page.locator(sel).first().type(data.ppob_building, { delay: 30 });
                            await page.waitForTimeout(1500);
                            await page.locator(`ul li`).first().click({ timeout: 3000 }).catch(() => {});
                            sendUpdate(`Building filled.`);
                            break;
                        }
                    }
                } catch (e) { sendUpdate('Warning: Could not fill building field'); }
            }

            if (data.ppob_flatNo) {
                try {
                    for (const sel of ['#bno', '#flatno', '#flat', 'input[placeholder*="Flat"]', 'input[placeholder*="Door"]']) {
                        if (await page.locator(sel).count() > 0) {
                            await page.locator(sel).first().fill('');
                            await page.locator(sel).first().type(data.ppob_flatNo, { delay: 30 });
                            await page.waitForTimeout(1000);
                            await page.locator(`ul li`).first().click({ timeout: 2000 }).catch(() => {});
                            sendUpdate(`Flat No filled.`);
                            break;
                        }
                    }
                } catch (e) { sendUpdate('Warning: Could not fill flat no field'); }
            }

            if (data.ppob_floor) {
                try {
                    for (const sel of ['#bp_flrnum', '#flrnum', '#floor', 'input[placeholder*="Floor"]']) {
                        if (await page.locator(sel).count() > 0) {
                            await page.locator(sel).first().fill(data.ppob_floor);
                            sendUpdate(`Floor filled.`);
                            break;
                        }
                    }
                } catch (e) { sendUpdate('Warning: Could not fill floor field'); }
            }

            if (data.ppob_landmark) {
                try {
                    for (const sel of ['#ppbzdtls_landmark', '#landmark', 'input[placeholder*="Landmark"]']) {
                        if (await page.locator(sel).count() > 0) {
                            await page.locator(sel).first().fill(data.ppob_landmark);
                            sendUpdate(`Landmark filled.`);
                            break;
                        }
                    }
                } catch (e) { sendUpdate('Warning: Could not fill landmark field'); }
            }

            const selectDropdownRobust = async (selector, text) => {
                if (!text) return;
                try {
                    // Wait up to 10s for the dropdown to actually fetch and populate its options
                    await page.waitForFunction(`document.querySelector('${selector}') && document.querySelector('${selector}').options.length > 1`, null, { timeout: 10000 }).catch(() => { });

                    // Try exact label match (fast timeout)
                    await page.selectOption(selector, { label: text }, { timeout: 2000 });
                } catch (e1) {
                    try {
                        // Try exact value match (fast timeout)
                        await page.selectOption(selector, text, { timeout: 2000 });
                    } catch (e2) {
                        try {
                            // Fallback: Partial text match (e.g., if option is "GANDHINAGAR (12)")
                            const options = await page.$$eval(`${selector} option`, opts => opts.map(o => ({ value: o.value, text: o.innerText })));
                            const match = options.find(o => o.text && o.text.toUpperCase().includes(text.toUpperCase()));
                            if (match && match.value) {
                                await page.selectOption(selector, match.value, { timeout: 2000 });
                            }
                        } catch (e3) { }
                    }
                }
                // Wait for the next dependent dropdown to start fetching
                await page.waitForTimeout(1500);
            };

            if (data.ppob_stateJurisdiction) await selectDropdownRobust('#stj', data.ppob_stateJurisdiction);
            if (data.ppob_commissionerate) await selectDropdownRobust('#comcd', data.ppob_commissionerate);
            if (data.ppob_division) await selectDropdownRobust('#divcd', data.ppob_division);
            if (data.ppob_range) await selectDropdownRobust('#rgcd', data.ppob_range);

            if (data.ppob_natureOfPossession) {
                await page.selectOption('#bp_buss_poss', { label: data.ppob_natureOfPossession }).catch(() => page.selectOption('#bp_buss_poss', data.ppob_natureOfPossession).catch(() => { }));
                await page.waitForTimeout(500);
            }

            if (data.ppob_doc) {
                await page.selectOption('#bp_up_type', { label: data.ppob_doc }).catch(() => page.selectOption('#bp_up_type', data.ppob_doc).catch(() => { }));
                await page.waitForTimeout(500);
            }

            if (data.ppob_docFile) {
                sendUpdate('Uploading PPOB Document...');
                let filePathToUpload = data.ppob_docFile;
                if (data.ppob_docFile.startsWith('data:image') || data.ppob_docFile.startsWith('data:application/pdf')) {
                    const base64Data = data.ppob_docFile.replace(/^data:.*?;base64,/, "");
                    const fs = require('fs');
                    const path = require('path');
                    const ext = data.ppob_docFile.includes('application/pdf') ? 'pdf' : 'jpg';
                    const tempFilePath = path.join(__dirname, `temp_ppob_doc.${ext}`);
                    fs.writeFileSync(tempFilePath, base64Data, 'base64');
                    filePathToUpload = tempFilePath;
                }

                try {
                    const [fileChooser] = await Promise.all([
                        page.waitForEvent('filechooser', { timeout: 10000 }),
                        page.click('#bp_upload')
                    ]);
                    await fileChooser.setFiles(filePathToUpload);
                } catch (uploadErr) {
                    sendUpdate('Warning: Intercept failed for PPOB Document, attempting direct input assignment...');
                    await page.setInputFiles('#bp_upload', filePathToUpload).catch(() => { });
                }
                await handleDocumentLegibilityModal(page);
            }

            if (data.ppob_natureOfBusiness) {
                const nob = data.ppob_natureOfBusiness;
                const checkNob = async (flag, selector) => {
                    if (flag) {
                        await page.locator(selector).check().catch(() => page.locator(selector).click({ force: true }).catch(() => { }));
                    }
                };

                await checkNob(nob.factoryManufacturing, '#bp_ck_FMF');
                await checkNob(nob.retailBusiness, '#bp_ck_RBU');
                await checkNob(nob.bondedWarehouse, '#bp_ck_BWH');
                await checkNob(nob.leasingBusiness, '#bp_ck_LBU');
                await checkNob(nob.worksContract, '#bp_ck_WCO');
                await checkNob(nob.eouStpEhtp, '#bp_ck_ESE');
                await checkNob(nob.import, '#bp_ck_IMP');
                await checkNob(nob.officeSaleOffice, '#bp_ck_OSO');
                await checkNob(nob.warehouseDepot, '#bp_ck_WHD');
                await checkNob(nob.others, '#bp_ck_OTH');
                await checkNob(nob.export, '#bp_ck_EXP');
                await checkNob(nob.supplierOfServices, '#bp_ck_SOS');
                await checkNob(nob.recipientOfGoodsOrServices, '#bp_ck_SRE');
                await checkNob(nob.wholesaleBusiness, '#bp_ck_WBU');

                if (nob.others && nob.othersText) {
                    try {
                        await page.waitForTimeout(500);
                        await page.fill('#bp_otherntbz', nob.othersText);
                    } catch (e) {
                        sendUpdate('Warning: Could not fill "Others" text box in Nature of Business.');
                    }
                }
            }

            await page.waitForTimeout(2000);

            await saveAndContinueToTab(page, 'Additional Places of Business', 'button[title="Save & Continue"]');

            await handleLocalityWarning(page);
        } catch (e) {
            sendUpdate('Warning: Principal Place of Business section not found or failed to fill.');
        }
        // Click intermediate CONTINUE button if it exists
        try {
            const continueBtn = page.locator('#newRegForm > div > div.row.next-tab-nav > div > button:nth-child(3)');
            if (await continueBtn.isVisible({ timeout: 2000 })) {
                sendUpdate('Clicking intermediate CONTINUE button...');
                await continueBtn.click();
                await page.waitForTimeout(1000);
            }
        } catch (e) {
            // Ignore if not present
        }

        // ============================================
        // GOODS / SERVICES
        // ============================================
        sendUpdate('Processing Goods / Services Details...');
        if (data.goods_hsn && Array.isArray(data.goods_hsn) && data.goods_hsn.length > 0) {
            for (let i = 0; i < data.goods_hsn.length; i++) {
                const rawHsn = data.goods_hsn[i];
                const match = rawHsn.toString().match(/\d+/);
                const hsn = match ? match[0] : rawHsn.toString();
                sendUpdate(`Filling HSN ${i + 1}/${data.goods_hsn.length}: ${hsn}`);

                const hsnInput = page.locator('#gs_hsn_value').first();

                // Wait for input to be ready
                try {
                    await hsnInput.waitFor({ state: 'visible', timeout: 5000 });
                } catch (e) {
                    sendUpdate(`Warning: HSN input not visible, retrying...`);
                    await page.waitForTimeout(500);
                }

                // Clear and type the HSN code
                await hsnInput.click({ timeout: 2000 });
                await hsnInput.fill('');
                await hsnInput.type(hsn, { delay: 10 });

                // Wait for dropdown to appear and click first item
                try {
                    const dropdownItem = page.locator('ul.ui-autocomplete li:visible, .ui-menu-item:visible').first();
                    await dropdownItem.waitFor({ state: 'visible', timeout: 5000 });
                    await dropdownItem.click({ force: true });
                } catch (e) {
                    sendUpdate(`HSN dropdown item not found, trying keyboard...`);
                    await hsnInput.focus();
                    await page.waitForTimeout(200);
                    await page.keyboard.press('ArrowDown');
                    await page.waitForTimeout(100);
                    await page.keyboard.press('Enter');
                }

                // Wait for the page to process the selection before next iteration
                await page.waitForTimeout(500);
                sendUpdate(`HSN ${hsn} added successfully.`);
            }
        }

        if (data.goods_sac && Array.isArray(data.goods_sac) && data.goods_sac.length > 0) {
            sendUpdate('Switching to Services tab...');
            try {
                await page.getByRole('tab', { name: 'Services', exact: true }).click({ timeout: 1000 }).catch(async () => {
                    await page.locator('text="Services"').last().click({ timeout: 1000 }).catch(() => { });
                });
                await page.waitForTimeout(1000);
            } catch (e) {
                sendUpdate('Warning: Could not click Services tab');
            }

            for (let i = 0; i < data.goods_sac.length; i++) {
                const rawSac = data.goods_sac[i];
                const match = rawSac.toString().match(/\d+/);
                const sac = match ? match[0] : rawSac.toString();
                sendUpdate(`Filling SAC ${i + 1}/${data.goods_sac.length}: ${sac}`);

                // Find the SAC input - check multiple possible selectors
                let sacInputSelector = '#gs_sac_value';
                const potentialSelectors = ['#gs_sac_value', '#sac_value', '#sac', '#search_sac', '#gs_sac', 'input[placeholder*="Service Classification"]', 'input[placeholder*="SAC"]', '#gs_hsn_value'];
                for (const sel of potentialSelectors) {
                    if (await page.locator(sel).count() > 0) {
                        sacInputSelector = sel;
                        break;
                    }
                }

                const inputLoc = page.locator(sacInputSelector).first();

                // Wait for the input to be ready/enabled before typing
                try {
                    await inputLoc.waitFor({ state: 'visible', timeout: 5000 });
                } catch (e) {
                    sendUpdate(`Warning: SAC input not visible, retrying...`);
                    await page.waitForTimeout(500);
                }

                // Clear and type the SAC code
                try {
                    await inputLoc.click({ timeout: 2000 });
                    await inputLoc.fill('');
                    await inputLoc.type(sac, { delay: 10 });
                } catch (e) {
                    sendUpdate('Warning: Could not fill SAC input ' + sacInputSelector);
                    continue;
                }

                // Wait for dropdown to appear and click the first item
                try {
                    const dropdownItem = page.locator('ul.ui-autocomplete li:visible, .ui-menu-item:visible').first();
                    await dropdownItem.waitFor({ state: 'visible', timeout: 5000 });
                    await dropdownItem.click({ force: true });
                } catch (e) {
                    sendUpdate(`SAC dropdown item not found, trying keyboard...`);
                    try { await inputLoc.focus({ timeout: 500 }); } catch (err) { }
                    await page.waitForTimeout(200);
                    await page.keyboard.press('ArrowDown');
                    await page.waitForTimeout(100);
                    await page.keyboard.press('Enter');
                }

                // Wait for the page to process the selection before next iteration
                await page.waitForTimeout(500);
                sendUpdate(`SAC ${sac} added successfully.`);
            }
        }



        await saveAndContinueToTab(page, 'State Specific', 'button[title="Save & Continue"]');

        // ============================================
        // STATE SPECIFIC INFORMATION
        // ============================================
        try {
            sendUpdate('Filling State Specific Information...');
            // ===============================
            // State Specific Information
            // ===============================

            // Electricity Board - dropdown/autocomplete
            if (data.stateSpecific_electricityBoard) {
                sendUpdate(`Selecting Electricity Board: ${data.stateSpecific_electricityBoard}`);
                try {
                    const ebcdLocator = page.locator('#ebcd');
                    if (await ebcdLocator.count() > 0 && await ebcdLocator.isVisible({ timeout: 2000 })) {
                        await page.selectOption('#ebcd', { label: data.stateSpecific_electricityBoard });
                    } else {
                        sendUpdate('Electricity Board field not visible. Skipping.');
                    }
                } catch (e) {
                    sendUpdate(`Warning: Could not select Electricity Board: ${data.stateSpecific_electricityBoard}`);
                }
            }

            // Electricity Consumer Number
            if (data.stateSpecific_electricityConsumerNo) {
                sendUpdate(`Filling Electricity Consumer No: ${data.stateSpecific_electricityConsumerNo}`);
                try {
                    const canumLocator = page.locator('#canum');
                    if (await canumLocator.count() > 0 && await canumLocator.isVisible({ timeout: 2000 })) {
                        await canumLocator.fill(data.stateSpecific_electricityConsumerNo);
                    } else {
                        sendUpdate('Electricity Consumer No field not visible. Skipping.');
                    }
                } catch (e) {
                    sendUpdate(`Warning: Could not fill Electricity Consumer No: ${e.message}`);
                }
            }

            // PT EC Number
            if (data.stateSpecific_ptEcNo) {
                sendUpdate(`Filling PT EC No: ${data.stateSpecific_ptEcNo}`);
                try {
                    const ecTaxLocator = page.locator('#ec_tax');
                    if (await ecTaxLocator.count() > 0 && await ecTaxLocator.isVisible({ timeout: 2000 })) {
                        await ecTaxLocator.fill(data.stateSpecific_ptEcNo);
                    } else {
                        sendUpdate('PT EC No field not visible. Skipping.');
                    }
                } catch (e) {
                    sendUpdate(`Warning: Could not fill PT EC No: ${e.message}`);
                }
            }

            // PT RC Number
            if (data.stateSpecific_ptRcNo) {
                sendUpdate(`Filling PT RC No: ${data.stateSpecific_ptRcNo}`);
                await page.fill('#rc_tax', data.stateSpecific_ptRcNo);
            }

            // Excise License Number
            if (data.stateSpecific_exciseLicenseNo) {
                sendUpdate(`Filling Excise License No: ${data.stateSpecific_exciseLicenseNo}`);
                await page.fill('#lic_no', data.stateSpecific_exciseLicenseNo);
            }

            // Excise License Holder
            if (data.stateSpecific_exciseLicenseHolder) {
                sendUpdate(`Filling Excise License Holder: ${data.stateSpecific_exciseLicenseHolder}`);
                await page.fill('#per_lic_no', data.stateSpecific_exciseLicenseHolder);
            }

            await page.waitForTimeout(1000);

            await page.waitForTimeout(1000);

            // Save & Continue for State Specific section
            const stateSpecificSaveBtn = page.locator('#newRegForm > div.row.next-tab-nav > div > div > button');
            if (await stateSpecificSaveBtn.isVisible({ timeout: 5000 })) {
                await saveAndContinueToTab(page, 'Verification|Aadhaar Authentication', '#newRegForm > div.row.next-tab-nav > div > div > button');
            } else {
                await saveAndContinueToTab(page, 'Verification|Aadhaar Authentication', 'button[title="Save & Continue"]');
            }

        } catch (e) {
            sendUpdate(`Warning: State Specific section failed: ${e.message}`);
        }

        // ============================================
        // VERIFICATION DETAILS (or Aadhaar Auth)
        // ============================================
        sendUpdate('Checking if Aadhaar Authentication page is reached...');
        await page.waitForTimeout(2000);

        const isAadhaarPage = await page.evaluate(() => {
            const activeTabs = Array.from(document.querySelectorAll('li.active a, li.active span, .nav-tabs li.active, .step-wizard .active, .wizard-step.active'));
            for (let tab of activeTabs) {
                if (tab.innerText && tab.innerText.toLowerCase().includes('aadhaar')) {
                    return true;
                }
            }
            const text = document.body.innerText.toLowerCase();
            return text.includes('aadhaar authentication') || 
                   text.includes('aadhar authentication') || 
                   text.includes('authentication for aadhaar');
        });

        if (isAadhaarPage) {
            sendUpdate('Aadhaar Authentication page reached. Automating...');
            try {
                // Click YES / Agree button on Aadhaar Auth page
                const yesBtnSelectors = [
                    'label:has-text("Yes")',
                    'label:has-text("YES")',
                    'input[value="Y"]',
                    'input[value="YES"]',
                    'input[value="Yes"]',
                    'button:has-text("YES")',
                    'button:has-text("Yes")'
                ];
                let aadhaarYesClicked = false;
                for (const sel of yesBtnSelectors) {
                    try {
                        const btn = page.locator(sel).first();
                        if (await btn.count() > 0 && await btn.isVisible({ timeout: 2000 })) {
                            await btn.click({ force: true });
                            aadhaarYesClicked = true;
                            sendUpdate('Clicked YES on Aadhaar Authentication page.');
                            break;
                        }
                    } catch (e) {}
                }
                if (!aadhaarYesClicked) {
                    sendUpdate('Could not auto-click YES on Aadhaar page. Please click manually.');
                }

                await page.waitForTimeout(3000);

                // Check if OTP is required
                const otpInputVisible = await page.locator('#otp, input[name="otp"], input[placeholder*="OTP" i]').first().isVisible({ timeout: 5000 }).catch(() => false);
                if (otpInputVisible) {
                    sendUpdate('WAITING_FOR_AADHAAR_OTP');
                    const aadhaarOtp = await new Promise(resolve => {
                        process.stdin.once('data', (input) => {
                            resolve(input.toString().trim());
                        });
                    });
                    sendUpdate('Submitting Aadhaar OTP...');
                    await page.locator('#otp, input[name="otp"], input[placeholder*="OTP" i]').first().fill(aadhaarOtp);
                    await page.locator('button[type="submit"], button:has-text("Validate"), button:has-text("Verify"), button:has-text("Proceed")').last().click().catch(() => {});
                    await page.waitForTimeout(3000);
                    sendUpdate('Aadhaar OTP submitted. Proceeding to Verification...');
                } else {
                    sendUpdate('No OTP required for Aadhaar. Proceeding...');
                }
                
                // Crucial step: MUST click Save & Continue to go to Verification tab
                await saveAndContinueToTab(page, 'Verification', 'button[title="Save & Continue"]');

                // After Aadhaar Auth, check if Verification tab is now active
                await page.waitForTimeout(2000);
                const isVerificationPage = await page.evaluate(() => {
                    const activeTabs = Array.from(document.querySelectorAll('li.active a, li.active span, .nav-tabs li.active'));
                    for (let tab of activeTabs) {
                        if (tab.innerText && tab.innerText.toLowerCase().includes('verification')) return true;
                    }
                    return document.body.innerText.toLowerCase().includes('declaration') &&
                           document.body.innerText.toLowerCase().includes('authorized signatory');
                });

                if (isVerificationPage) {
                    sendUpdate('Verification tab reached. Filling verification details...');
                    try {
                        const checkbox = page.locator('input[type="checkbox"]').first();
                        await checkbox.check().catch(() => checkbox.evaluate(el => el.click()).catch(() => checkbox.click({ force: true })));
                        await page.waitForTimeout(1000);

                        const authSigDropdown = page.locator('select').first();
                        const optionsCount = await authSigDropdown.locator('option').count();
                        if (optionsCount > 1) {
                            await authSigDropdown.selectOption({ index: 1 });
                        }
                        await page.waitForTimeout(1000);

                        const place = data.ppob_city || data.ppob_district || 'City';
                        await page.fill('#place', place).catch(() => {});

                        sendUpdate('Verification details filled. Please review and click SUBMIT WITH DSC or SUBMIT WITH EVC.');
                    } catch (e) {
                        sendUpdate(`Warning: Verification auto-fill failed: ${e.message}`);
                    }
                } else {
                    sendUpdate('Please complete remaining steps (Verification) manually in the browser.');
                }

            } catch (e) {
                sendUpdate(`Warning: Aadhaar Authentication automation failed: ${e.message}. Please complete manually.`);
            }
        } else {
            sendUpdate('Processing Verification Details...');
            try {
                sendUpdate('Checking declaration...');
                // GST verification checkbox
                const checkbox = page.locator('input[type="checkbox"]').first();
                await checkbox.check().catch(() => checkbox.evaluate(el => el.click()).catch(() => checkbox.click({ force: true })));
                
                await page.waitForTimeout(1000);
                sendUpdate('Selecting Authorized Signatory...');
                // The select dropdown for Auth Sig
                const authSigDropdown = page.locator('select').first();
                const optionsCount = await authSigDropdown.locator('option').count();
                if (optionsCount > 1) {
                    await authSigDropdown.selectOption({ index: 1 });
                }
                
                await page.waitForTimeout(1000);
                sendUpdate('Entering Place...');
                const place = data.ppob_city || data.ppob_district || 'City';
                await page.fill('#place', place).catch(async () => {
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
                
                sendUpdate('Verification details filled successfully.');
                await page.waitForTimeout(2000);
                sendUpdate('Please review and click SUBMIT WITH DSC or SUBMIT WITH EVC on the portal.');
            } catch (e) {
                sendUpdate(`Warning: Verification section failed: ${e.message}`);
            }
        }

        // Clean up all temporary files created during this automation run
        sendUpdate('Cleaning up temporary files...');
        try {
            const fs = require('fs');
            const path = require('path');
            const tempFiles = [
                'temp_proof_constitution.pdf',
                'temp_proof_constitution.jpg',
                'temp_auth_sig_proof.pdf',
                'temp_auth_sig_proof.jpg',
                'temp_auth_sig_photo.jpg',
                'temp_ppob_doc.pdf',
                'temp_ppob_doc.jpg',
                'temp_auth_sig_proof_0.pdf',
                'temp_auth_sig_proof_0.jpg',
            ];
            // Also clean promoter photos (temp_promoter_photo_1.jpg ... temp_promoter_photo_10.jpg)
            for (let i = 1; i <= 10; i++) {
                tempFiles.push(`temp_promoter_photo_${i}.jpg`);
            }
            // Also clean indexed auth sig proofs
            for (let i = 0; i <= 9; i++) {
                tempFiles.push(`temp_auth_sig_proof_${i}.pdf`);
                tempFiles.push(`temp_auth_sig_proof_${i}.jpg`);
            }
            for (const fname of tempFiles) {
                const fpath = path.join(__dirname, fname);
                if (fs.existsSync(fpath)) {
                    fs.unlinkSync(fpath);
                    console.log(`[Cleanup] Deleted temp file: ${fname}`);
                }
            }
        } catch (cleanupErr) {
            console.log(`[Cleanup] Warning: Could not clean up temp files: ${cleanupErr.message}`);
        }

        sendUpdate('COMPLETED');

    } catch (e) {
        sendUpdate(`Error: ${e.stack || e.message}`);
        console.error(`[Runner Error Stack]:\n${e.stack || e.message}`);
    } finally {
        try {
            if (browser && browser.isConnected()) {
                // Keep the browser open for 30 minutes so the user can manually interact
                sendUpdate('Browser will remain open for 30 minutes for manual interaction.');
                await page.waitForTimeout(1800000);
            }
        } catch (e) {}
    }
}

run().catch(err => {
    sendUpdate(`Error: ${err.stack || err.message}`);
    console.error(`[Runner Fatal Error]:\n${err.stack || err.message}`);
    process.exit(1);
});
