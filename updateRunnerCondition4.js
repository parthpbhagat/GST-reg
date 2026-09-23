const fs = require('fs');
let content = fs.readFileSync('automation/runner.js', 'utf8');

const searchStr = `        } else {
            sendUpdate('Condition 2: Promoter(s) are Also Authorized Signatory. Processing existing records...');

            let promoterAuthSigs = [];`;

const insertIdx = content.indexOf(searchStr);
if (insertIdx === -1) {
    console.error("Could not find start block");
    process.exit(1);
}

// Find the end of Condition 3
const endSearchStr = `                }
            }
        }`;
        
// The problem is finding the correct endSearchStr. Let's find "PRINCIPAL PLACE OF BUSINESS (PPOB)"
const ppobStr = `        // ============================================
        // PRINCIPAL PLACE OF BUSINESS (PPOB)
        // ============================================`;

const ppobIdx = content.indexOf(ppobStr);
if (ppobIdx === -1) {
    console.error("Could not find PPOB block");
    process.exit(1);
}

const replacement = `        } else {
            let promoterAuthSigs = [];
            for (let i = 1; i <= 10; i++) {
                if (data[\`p\${i}\`] && data[\`p\${i}\`].alsoAuthorizedSignatory) {
                    promoterAuthSigs.push(data[\`p\${i}\`]);
                }
            }

            let hasPureAuthSigs = false;
            for (let i = 1; i <= 10; i++) {
                if (data[\`a\${i}\`] && Object.keys(data[\`a\${i}\`]).length > 0) {
                    hasPureAuthSigs = true;
                    break;
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
                        const base64Data = pData.authSigProofFile.replace(/^data:(image|application)\\/\\w+;base64,/, "");
                        const fs = require('fs');
                        const path = require('path');
                        const ext = pData.authSigProofFile.includes('application/pdf') ? 'pdf' : 'jpg';
                        const tempFilePath = path.join(__dirname, \`temp_auth_sig_proof_0.\${ext}\`);
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
                    await page.waitForTimeout(2000);
                }

                if (hasPureAuthSigs) {
                    sendUpdate('Additional pure Authorized Signatories exist. Clicking ADD NEW on form...');
                    try {
                        await page.click('#newRegForm > div:nth-child(5) > div:nth-child(9) > div > button:nth-child(3)');
                        await page.waitForTimeout(2000);
                        await handleLocalityWarning(page);
                    } catch (e) {
                        sendUpdate('Warning: Could not click ADD NEW button on form');
                    }
                    await fillAllAuthSigs(data);
                } else {
                    sendUpdate('No additional Authorized Signatories. Clicking Save & Continue...');
                    try {
                        await page.waitForSelector('button[title="Save & Continue"]', { state: 'visible', timeout: 10000 });
                        await clickAndHandleMapError(page, 'button[title="Save & Continue"]');
                        await handleLocalityWarning(page);

                        sendUpdate('Clicking Save & Continue again to skip Authorized Representative page...');
                        await page.waitForSelector('button[title="Save & Continue"]', { state: 'visible', timeout: 10000 });
                        await clickAndHandleMapError(page, 'button[title="Save & Continue"]');
                        await handleLocalityWarning(page);
                    } catch(e) {}
                }
            } else {
                sendUpdate('Condition 2: Multiple Promoters are Authorized Signatories. Editing from list...');
                for (let idx = 0; idx < promoterAuthSigs.length; idx++) {
                    const pData = promoterAuthSigs[idx];
                    sendUpdate(\`Processing Promoter Auth Sig \${idx + 1}...\`);

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
                        sendUpdate(\`Warning: Could not click EDIT button \${idx + 1}\`);
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
                            const base64Data = pData.authSigProofFile.replace(/^data:(image|application)\\/\\w+;base64,/, "");
                            const fs = require('fs');
                            const path = require('path');
                            const ext = pData.authSigProofFile.includes('application/pdf') ? 'pdf' : 'jpg';
                            const tempFilePath = path.join(__dirname, \`temp_auth_sig_proof_\${idx}.\${ext}\`);
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
                        await page.waitForTimeout(2000);
                    }

                    sendUpdate('Clicking Save button...');
                    try {
                        try {
                            await page.click('#newRegForm > div:nth-child(5) > div:nth-child(8) > div > button.btn.btn-primary', { timeout: 2000 });
                        } catch (e) {
                            await page.locator('button:has-text("Save"), button:has-text("SAVE")').last().click({ timeout: 5000 });
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
                        await page.waitForSelector('button[title="Save & Continue"]', { state: 'visible', timeout: 10000 });
                        await clickAndHandleMapError(page, 'button[title="Save & Continue"]');
                        await handleLocalityWarning(page);

                        sendUpdate('Clicking Save & Continue again to skip Authorized Representative page...');
                        await page.waitForSelector('button[title="Save & Continue"]', { state: 'visible', timeout: 10000 });
                        await clickAndHandleMapError(page, 'button[title="Save & Continue"]');
                        await handleLocalityWarning(page);
                    } catch (e) {
                        sendUpdate(\`Warning: Could not skip Auth Sig pages: \${e.message}\`);
                    }
                }
            }
        }
`;

content = content.slice(0, insertIdx) + replacement + "\\n" + content.slice(ppobIdx);
fs.writeFileSync('automation/runner.js', content, 'utf8');
console.log('Successfully updated runner.js');
