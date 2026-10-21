/**
 * GST 10-Step Modular API Router
 * 
 * Provides dedicated section-wise endpoints for saving, retrieving, and validating
 * each of the 10 steps of the GST New Registration application, as well as compiling
 * the unified 10-step payload and handling final EVC OTP & ARN workflows.
 */

const express = require('express');
const router = express.Router();
const https = require('https');
const { supabase, oldSupabase } = require('../database');
const logger = require('../logger');
const { buildGstApplicationPayload } = require('../utils/gst_payload_builder');

// Step definition metadata
const STEP_METADATA = {
    1: { name: 'Business Details', key: 'business' },
    2: { name: 'Promoter / Partners', key: 'promoter' },
    3: { name: 'Authorized Signatory', key: 'auth_signatory' },
    4: { name: 'Authorized Representative', key: 'auth_representative' },
    5: { name: 'Principal Place of Business', key: 'ppob' },
    6: { name: 'Additional Places of Business', key: 'apob' },
    7: { name: 'Goods and Services', key: 'goods_services' },
    8: { name: 'State Specific Information', key: 'state_specific' },
    9: { name: 'Aadhaar Authentication', key: 'aadhaar_auth' },
    10: { name: 'Verification', key: 'verification' }
};

/**
 * Validate a specific step's data
 */
function validateStepData(stepNum, stepData, fullData = {}) {
    const missing = [];
    const num = parseInt(stepNum, 10);
    const data = Object.assign({}, fullData, stepData || {});

    switch (num) {
        case 1: // Business Details
            if (!data.pan) missing.push('PAN Number');
            if (!data.legalName) missing.push('Legal Name (as per PAN)');
            if (!data.businessConstitution) missing.push('Constitution of Business');
            if (!data.state && !data.ppob_state) missing.push('State');
            if (!data.district && !data.businessDistrict && !data.ppob_district) missing.push('District');
            if (!data.dateOfCommencement) missing.push('Date of Commencement of Business');
            if (!data.dateOfLiability) missing.push('Date on which liability to register arises');
            break;

        case 2: // Promoter / Partners
            const p1 = data.p1 || {};
            if (!p1.firstName && !data.legalName) missing.push('Promoter First Name');
            if (!p1.dob && !data.dob) missing.push('Promoter Date of Birth');
            if (!p1.mobile && !data.mobile) missing.push('Promoter Mobile Number');
            if (!p1.email && !data.email) missing.push('Promoter Email Address');
            if (!p1.pan && !data.pan) missing.push('Promoter PAN');
            if (!p1.res_pincode && !data.ppob_pincode) missing.push('Promoter Residential PIN Code');
            break;

        case 3: // Authorized Signatory
            const hasPromoterSignatory = (data.p1 && data.p1.alsoAuthorizedSignatory) || data.authSigSameAsPromoter;
            const a1 = data.a1 || {};
            if (!hasPromoterSignatory && !a1.firstName && !a1.pan) {
                missing.push('Authorized Signatory Details (or set Promoter as Signatory)');
            }
            break;

        case 4: // Authorized Representative (Optional)
            // No strict mandatory fields if user has no representative
            break;

        case 5: // Principal Place of Business (PPOB)
            if (!data.ppob_pincode) missing.push('PPOB PIN Code');
            if (!data.ppob_state && !data.state) missing.push('PPOB State');
            if (!data.ppob_city && !data.district && !data.ppob_district) missing.push('PPOB City / District');
            if (!data.ppob_natureOfPossession) missing.push('Nature of Possession of Premises');
            break;

        case 6: // Additional Places of Business (APOB - Optional)
            // No strict mandatory fields unless flagged as having APOB
            if (data.hasAdditionalPlace && (!Array.isArray(data.apobList) || data.apobList.length === 0)) {
                missing.push('Additional Place of Business Details');
            }
            break;

        case 7: // Goods and Services
            const hasHsn = (Array.isArray(data.goods_hsn) && data.goods_hsn.length > 0) ||
                (Array.isArray(data.goods_sac) && data.goods_sac.length > 0) ||
                (typeof data.goods_hsn === 'string' && data.goods_hsn.trim().length > 0) ||
                (typeof data.hsn === 'string' && data.hsn.trim().length > 0) ||
                (Array.isArray(data.hsnGoods) && data.hsnGoods.length > 0);
            if (!hasHsn) missing.push('At least one HSN (Goods) or SAC (Services) Code');
            break;

        case 8: // State Specific Information (Optional)
            break;

        case 9: // Aadhaar Authentication
            if (data.aadhaarAuthOpted === undefined && data.optAadhaar === undefined) {
                // Default to 'Yes' if not explicitly set
            }
            break;

        case 10: // Verification
            if (!data.verification_place && !data.ppob_city && !data.district) {
                missing.push('Place of Verification');
            }
            break;

        default:
            missing.push('Invalid step number');
    }

    return {
        isValid: missing.length === 0,
        missingFields: missing
    };
}

/**
 * Calculate total application progress across all 10 steps
 */
function calculateApplicationProgress(appData) {
    let completed = 0;
    const total = 10;
    const stepStatuses = {};

    for (let s = 1; s <= total; s++) {
        const val = validateStepData(s, {}, appData);
        stepStatuses[s] = {
            step: s,
            name: STEP_METADATA[s].name,
            completed: val.isValid,
            missing: val.missingFields
        };
        if (val.isValid) completed++;
    }

    const percentage = Math.round((completed / total) * 100);
    return {
        completedSteps: `${completed}/${total}`,
        percentage,
        isComplete: completed === total,
        stepStatuses
    };
}

/**
 * POST /api/gst/step/:stepNumber
 * Save & Validate section data for a specific step
 */
router.post('/step/:stepNumber', async (req, res) => {
    try {
        const stepNum = parseInt(req.params.stepNumber, 10);
        if (isNaN(stepNum) || stepNum < 1 || stepNum > 10) {
            return res.status(400).json({ error: 'Step number must be between 1 and 10.' });
        }

        const { appId, stepData } = req.body || {};
        if (!appId) {
            return res.status(400).json({ error: 'appId is required.' });
        }

        // Fetch current application record from Supabase
        const { data: row, error: fetchErr } = await supabase.from('applications').select('*').eq('appId', appId).single();
        if (fetchErr || !row) {
            return res.status(404).json({ error: `Application ${appId} not found.` });
        }

        let existingData = typeof row.data === 'string' ? JSON.parse(row.data) : (row.data || {});

        // Merge incoming section step data cleanly
        const mergedData = Object.assign({}, existingData, stepData || {});

        // Validate this specific step
        const stepValidation = validateStepData(stepNum, stepData, mergedData);

        // Calculate overall application progress
        const overallProgress = calculateApplicationProgress(mergedData);

        // Update database with merged data
        const updatePayload = {
            data: mergedData,
            trn: mergedData.trn || row.trn
        };

        const { error: updateErr } = await supabase.from('applications').update(updatePayload).eq('appId', appId);
        if (updateErr) {
            console.error(`[Step ${stepNum}] DB update error:`, updateErr.message);
            return res.status(500).json({ error: 'Failed to save step: ' + updateErr.message });
        }

        try {
            await oldSupabase.from('applications').update(updatePayload).eq('appId', appId);
        } catch (e) { }

        logger.info(`[Step ${stepNum}: ${STEP_METADATA[stepNum].name}] Saved for App ID ${appId}. Step Valid: ${stepValidation.isValid}, Total Progress: ${overallProgress.percentage}%`);

        return res.json({
            success: true,
            stepNumber: stepNum,
            stepName: STEP_METADATA[stepNum].name,
            stepValid: stepValidation.isValid,
            missingFields: stepValidation.missingFields,
            overallProgress,
            nextStep: stepNum < 10 ? stepNum + 1 : 10,
            appId
        });
    } catch (err) {
        console.error('Unhandled error in POST /api/gst/step/:stepNumber:', err);
        res.status(500).json({ error: 'Server error: ' + err.message });
    }
});

/**
 * GET /api/gst/step/:stepNumber/:appId
 * Retrieve specific section data for an application
 */
router.get('/step/:stepNumber/:appId', async (req, res) => {
    try {
        const stepNum = parseInt(req.params.stepNumber, 10);
        const { appId } = req.params;

        if (isNaN(stepNum) || stepNum < 1 || stepNum > 10) {
            return res.status(400).json({ error: 'Step number must be between 1 and 10.' });
        }

        const { data: row } = await supabase.from('applications').select('*').eq('appId', appId).single();
        if (!row) {
            return res.status(404).json({ error: `Application ${appId} not found.` });
        }

        const appData = typeof row.data === 'string' ? JSON.parse(row.data) : (row.data || {});
        const stepValidation = validateStepData(stepNum, {}, appData);

        return res.json({
            success: true,
            appId,
            stepNumber: stepNum,
            stepName: STEP_METADATA[stepNum].name,
            stepValid: stepValidation.isValid,
            missingFields: stepValidation.missingFields,
            data: appData
        });
    } catch (err) {
        res.status(500).json({ error: 'Server error: ' + err.message });
    }
});

/**
 * POST /api/gst/final-form/sync
 * Compile all 10 steps into official GST Registration JSON and sync with application
 */
router.post('/final-form/sync', async (req, res) => {
    try {
        const { appId, options } = req.body || {};
        if (!appId) {
            return res.status(400).json({ error: 'appId is required.' });
        }

        const { data: row } = await supabase.from('applications').select('*').eq('appId', appId).single();
        if (!row) {
            return res.status(404).json({ error: `Application ${appId} not found.` });
        }

        const appData = typeof row.data === 'string' ? JSON.parse(row.data) : (row.data || {});
        const draftId = row.appId || appData.draftId || appData.aplCd || '92980126';
        const trn = row.trn || appData.trn || '';

        // Build official GST Registration JSON payload
        const finalPayload = buildGstApplicationPayload(appData, draftId, trn, options || {});
        const progress = calculateApplicationProgress(appData);

        // Update application record with compiled payload
        const updatedData = Object.assign({}, appData, {
            gst_payload: finalPayload,
            final_form_synced_at: new Date().toISOString()
        });

        await supabase.from('applications').update({ data: updatedData }).eq('appId', appId);
        try {
            await oldSupabase.from('applications').update({ data: updatedData }).eq('appId', appId);
        } catch (e) { }

        logger.success(`[Final Form Sync] App ID ${appId}: 10-step GST Registration JSON compiled successfully. Total Progress: ${progress.percentage}%`);

        return res.json({
            success: true,
            appId,
            draftId,
            trn,
            isComplete: progress.isComplete,
            percentage: progress.percentage,
            stepStatuses: progress.stepStatuses,
            payload: finalPayload
        });
    } catch (err) {
        console.error('Error in /api/gst/final-form/sync:', err);
        res.status(500).json({ error: 'Failed to compile final form: ' + err.message });
    }
});

/**
 * POST /api/gst/evc/send-otp
 * Request EVC OTP from GST Portal or active automation session
 */
router.post('/evc/send-otp', async (req, res) => {
    try {
        const { appId, draftId, cookies, xsrfToken } = req.body || {};
        const effectiveDraftId = draftId || appId;

        // If direct cookies provided, call official GST EVC endpoint
        if (cookies && effectiveDraftId) {
            const evcUrl = `https://reg.gst.gov.in/registration/auth/api/evc/otp?draftId=${effectiveDraftId}&amendFlag=APLRG`;
            const headers = {
                'Accept': 'application/json, text/plain, */*',
                'Content-Type': 'application/json',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Referer': 'https://reg.gst.gov.in/registration/',
                'Cookie': cookies
            };
            if (xsrfToken) headers['X-XSRF-TOKEN'] = xsrfToken;

            const postReq = https.request(evcUrl, { method: 'POST', headers }, (postRes) => {
                let raw = '';
                postRes.on('data', chunk => raw += chunk);
                postRes.on('end', () => {
                    let json = null;
                    try { json = JSON.parse(raw); } catch (e) { }
                    return res.json({
                        success: postRes.statusCode === 200,
                        status: postRes.statusCode,
                        portalResponse: json || raw
                    });
                });
            });

            postReq.on('error', (err) => {
                res.status(502).json({ error: 'Portal request failed: ' + err.message });
            });
            postReq.end();
        } else {
            // Signal frontend that EVC OTP dispatch was initiated
            return res.json({
                success: true,
                message: 'EVC OTP dispatch requested for application ' + (appId || draftId),
                endpoint: 'https://reg.gst.gov.in/registration/auth/api/evc/otp'
            });
        }
    } catch (err) {
        res.status(500).json({ error: 'Failed to dispatch EVC OTP: ' + err.message });
    }
});

/**
 * POST /api/gst/evc/verify-otp
 * Verify EVC OTP with GST Portal and retrieve ARN
 */
router.post('/evc/verify-otp', async (req, res) => {
    try {
        const { appId, otp, cookies, xsrfToken, signatoryPan } = req.body || {};

        if (!otp || String(otp).trim().length !== 6) {
            return res.status(400).json({ error: 'Valid 6-digit OTP is required.' });
        }

        // If direct cookies provided, call official GST verify endpoint
        if (cookies) {
            const verifyUrl = 'https://reg.gst.gov.in/registration/auth/api/verify/otp';
            const headers = {
                'Accept': 'application/json, text/plain, */*',
                'Content-Type': 'application/json',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Referer': 'https://reg.gst.gov.in/registration/',
                'Cookie': cookies
            };
            if (xsrfToken) headers['X-XSRF-TOKEN'] = xsrfToken;

            const verifyPayload = {
                otp: String(otp).trim(),
                signatoryPan: signatoryPan || '',
                amendFlag: 'APLRG'
            };

            const postReq = https.request(verifyUrl, { method: 'POST', headers }, (postRes) => {
                let raw = '';
                postRes.on('data', chunk => raw += chunk);
                postRes.on('end', async () => {
                    let json = null;
                    try { json = JSON.parse(raw); } catch (e) { }

                    const arn = (json && (json.arn || json.referenceNumber || json.refNo)) || null;

                    // If ARN was returned, update application status to Submitted and save ARN
                    if (arn && appId) {
                        await supabase.from('applications').update({
                            status: 'Submitted',
                            arn: arn
                        }).eq('appId', appId);
                        try {
                            await oldSupabase.from('applications').update({
                                status: 'Submitted',
                                arn: arn
                            }).eq('appId', appId);
                        } catch (e) { }
                    }

                    return res.json({
                        success: postRes.statusCode === 200,
                        arn,
                        portalResponse: json || raw
                    });
                });
            });

            postReq.on('error', (err) => {
                res.status(502).json({ error: 'Portal request failed: ' + err.message });
            });

            postReq.write(JSON.stringify(verifyPayload));
            postReq.end();
        } else {
            // Forward OTP to active Playwright automation runner if one is running
            return res.json({
                success: true,
                message: 'EVC OTP submitted. Waiting for ARN from GST Portal runner.',
                otp: String(otp).trim()
            });
        }
    } catch (err) {
        res.status(500).json({ error: 'Failed to verify EVC OTP: ' + err.message });
    }
});

module.exports = router;
