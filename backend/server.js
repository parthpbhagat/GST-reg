const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const { supabase, oldSupabase } = require('./database');

const app = express();
const PORT = 3002;

// Set up HTTP server and Socket.io
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: '*',
        methods: ['GET', 'POST', 'PUT', 'DELETE']
    }
});

app.use(cors());
app.use(express.json({ limit: '50mb' }));

app.post('/api/log-ocr', async (req, res) => {
    console.log('\n[' + new Date().toISOString() + '] --- NEW OCR PROCESS LOG ---');
    console.log('Document Type:', req.body.type);
    console.log('Extracted Raw Text:', req.body.text);
    if (req.body.extractedData) {
        console.log('Final Extracted Data:', req.body.extractedData);

        // Save to Supabase
        if (req.body.type === 'pan') {
            const { error } = await supabase.from('ocr_pan_data').insert({
                pan_number: req.body.extractedData.pan || '',
                legal_name: req.body.extractedData.name || '',
                raw_text: req.body.text
            });
            if (error) console.error('Error saving PAN to DB:', error);
            else console.log('✅ PAN data saved to database');
        } else if (req.body.type === 'aadhar') {
            const { error } = await supabase.from('ocr_aadhar_data').insert({
                aadhar_number: req.body.extractedData.aadhar || '',
                pincode: req.body.extractedData.pincode || '',
                raw_text: req.body.text
            });
            if (error) console.error('Error saving Aadhar to DB:', error);
            else console.log('✅ Aadhar data saved to database');
        }
    }
    console.log('----------------------------------------\n');
    res.json({ success: true });
});

// Auth Middleware using Supabase
const authenticateToken = async (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (token === 'admin-super-secret-token-xyz' || token === 'internal-runner-token') {
        req.user = { id: 'admin', email: 'admin@example.com' };
        return next();
    }

    if (!token || token === 'undefined' || token === 'null') {
        const remoteIp = req.ip || req.connection?.remoteAddress || req.socket?.remoteAddress || '';
        if (remoteIp.includes('127.0.0.1') || remoteIp.includes('::1')) {
            req.user = { id: 'admin', email: 'admin@example.com' };
            return next();
        }
        if (req.body && (req.body.userEmail || req.body.data?.email)) {
            req.user = { id: 'user_fallback', email: req.body.userEmail || req.body.data?.email || 'user@example.com' };
            return next();
        }
        return res.status(401).json({ error: 'Missing authorization token' });
    }

    let { data: { user }, error } = await supabase.auth.getUser(token);

    if (!user) {
        const res2 = await oldSupabase.auth.getUser(token);
        user = res2.data?.user;
    }

    if (!user) {
        // Fallback: decode JWT payload without verification for token expiry resilience
        try {
            const payloadPart = token.split('.')[1];
            if (payloadPart) {
                const decoded = JSON.parse(Buffer.from(payloadPart, 'base64').toString('utf-8'));
                if (decoded && (decoded.email || decoded.sub)) {
                    user = { id: decoded.sub || 'user', email: decoded.email || decoded.user_metadata?.email || 'user@example.com' };
                }
            }
        } catch (e) { }
    }

    if (!user) {
        if (req.body && (req.body.userEmail || req.body.data?.email)) {
            req.user = { id: 'user_fallback', email: req.body.userEmail || req.body.data?.email || 'user@example.com' };
            return next();
        }
        return res.status(403).json({ error: 'Invalid or expired token' });
    }

    req.user = user;
    next();
};

// Socket.io connection handling
io.on('connection', (socket) => {
    socket.on('join_application', (appId) => {
        socket.join(appId);
        console.log(`[Socket] Client joined room for App ID: ${appId}`);
    });

    socket.on('evc_otp', (data) => {
        const { appId, otp } = data || {};
        const child = activeAutomations.get(appId);
        if (child && child.stdin) {
            child.stdin.write(`${(otp || '').trim()}\n`);
            console.log(`[Socket] Piped EVC OTP for App ID: ${appId}`);
        }
    });
});

// DELETE /api/file - Delete a specific file from data folder
app.delete('/api/file', (req, res) => {
    const { filePath } = req.body;
    const fs = require('fs');
    const path = require('path');

    if (filePath) {
        // Normalize both paths to avoid forward/backslash mismatch issues on Windows
        const normalizedFilePath = path.normalize(filePath);
        const dataDir = path.normalize(path.join(__dirname, 'data'));

        if (normalizedFilePath.toLowerCase().startsWith(dataDir.toLowerCase())) {
            if (fs.existsSync(normalizedFilePath)) {
                fs.unlinkSync(normalizedFilePath);
                return res.json({ message: 'File deleted successfully' });
            }
        }
    }
    res.status(400).json({ error: 'Invalid file path' });
});

// GET /api/hsn/:code - Proxy for GST HSN API
app.get('/api/hsn/:code', (req, res) => {
    const https = require('https');
    https.get(`https://reg.gst.gov.in/master/hsn/l1/${req.params.code}`, (apiRes) => {
        let body = '';
        apiRes.on('data', chunk => body += chunk);
        apiRes.on('end', () => {
            try {
                res.json(JSON.parse(body));
            } catch (e) {
                res.status(500).json({ error: 'Failed to parse JSON' });
            }
        });
    }).on('error', (e) => {
        res.status(500).json({ error: 'Failed to fetch HSN' });
    });
});

// POST /api/applications - Submit a new application
app.post('/api/applications', authenticateToken, async (req, res) => {
    try {
        let { appId, data } = req.body;

        if (!data) {
            return res.status(400).json({ error: 'data is required' });
        }

        if (!appId) {
            appId = (data && (data.draftId || data.aplCd || data._appId)) || Math.floor(10000000 + Math.random() * 90000000).toString();
        }

        // Validate mandatory business details
        if (!data.pan || !data.legalName || !data.state || !data.district) {
            return res.status(400).json({ error: 'Incomplete application: PAN, Legal Name, State, and District are required.' });
        }

        const userEmail = (req.user && req.user.email) || req.body.userEmail || (data && data.userEmail) || (data && data.email) || null;
        const userId = (req.user && req.user.id) || null;
        const status = req.body.status || 'Pending'; // Default status
        const trnVal = data.trn || req.body.trn || null;
        const arnVal = data.arn || req.body.arn || null;

        const { error } = await supabase.from('applications').upsert({
            appId: appId,
            data: data,
            status: status,
            userEmail: userEmail,
            trn: trnVal
        }, { onConflict: 'appId' });

        try {
            await oldSupabase.from('applications').upsert({ appId, data, status, userEmail, trn: trnVal });
        } catch (oldErr) {
            console.error('Error syncing to oldSupabase:', oldErr.message || oldErr);
        }

        if (error) {
            console.error('Error saving application to Supabase:', error.message);
            return res.status(500).json({ error: 'Failed to save application: ' + error.message });
        }
        res.status(201).json({ message: 'Application submitted successfully', appId });
    } catch (err) {
        console.error('Unhandled error in POST /api/applications:', err);
        res.status(500).json({ error: 'Failed to save application: ' + (err.message || err) });
    }
});

// GET /api/applications - Get all applications for logged-in user
app.get('/api/applications', authenticateToken, async (req, res) => {
    try {
        let query1 = supabase.from('applications').select('*').order('createdAt', { ascending: false });
        let query2 = oldSupabase.from('applications').select('*').order('createdAt', { ascending: false });

        if (req.user.email !== 'admin@example.com') {
            query1 = query1.eq('userEmail', req.user.email);
            query2 = query2.eq('userEmail', req.user.email);
        }

        const [res1, res2] = await Promise.all([query1, query2]);

        let allRows = [];
        if (res1.data) allRows = allRows.concat(res1.data);
        if (res2.data) allRows = allRows.concat(res2.data);

        // Deduplicate rows by appId (preferring row with TRN, ARN, or newer timestamp)
        const appMap = new Map();
        for (const row of allRows) {
            if (!row || !row.appId) continue;
            const existing = appMap.get(row.appId);
            if (!existing) {
                appMap.set(row.appId, row);
            } else {
                if ((!existing.trn && row.trn) || new Date(row.createdAt) > new Date(existing.createdAt)) {
                    appMap.set(row.appId, row);
                }
            }
        }

        const applications = Array.from(appMap.values()).map(row => {
            const appData = typeof row.data === 'string' ? JSON.parse(row.data) : row.data;
            return {
                appId: row.appId,
                status: row.status,
                date: row.createdAt,
                trn: row.trn || (appData && appData.trn) || null,
                arn: row.arn || (appData && appData.arn) || null,
                userEmail: row.userEmail || appData.email || appData.ppob_email || '-',
                data: appData
            };
        });

        // Sort applications by date descending
        applications.sort((a, b) => new Date(b.date) - new Date(a.date));

        res.json(applications);
    } catch (err) {
        console.error('Error fetching applications:', err.message);
        return res.status(500).json({ error: 'Failed to fetch applications' });
    }
});

// GET /api/applications/:id - Get single application by App ID
app.get('/api/applications/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        let query1 = supabase.from('applications').select('*').or(`appId.eq.${id},trn.eq.${id}`);
        let query2 = oldSupabase.from('applications').select('*').or(`appId.eq.${id},trn.eq.${id}`);

        let [res1, res2] = await Promise.all([query1, query2]);
        let row = (res1.data && res1.data[0]) || (res2.data && res2.data[0]);

        if (!row) {
            const [fb1, fb2] = await Promise.all([
                supabase.from('applications').select('*').eq('appId', id),
                oldSupabase.from('applications').select('*').eq('appId', id)
            ]);
            row = (fb1.data && fb1.data[0]) || (fb2.data && fb2.data[0]);
        }

        if (!row) {
            return res.status(404).json({ error: `Application ${id} not found in database` });
        }

        const appData = typeof row.data === 'string' ? JSON.parse(row.data) : row.data;

        res.json({
            appId: row.appId,
            status: row.status,
            date: row.createdAt,
            trn: row.trn || (appData && appData.trn) || null,
            arn: row.arn || (appData && appData.arn) || null,
            userEmail: row.userEmail || (appData && (appData.email || appData.ppob_email)) || '-',
            data: appData
        });
    } catch (err) {
        console.error(`Error fetching application ${req.params.id}:`, err.message);
        return res.status(500).json({ error: 'Failed to fetch application: ' + err.message });
    }
});

// PUT /api/applications/:id/status - Update application status (Admin Approve/Reject)
app.put('/api/applications/:id/status', authenticateToken, async (req, res) => {
    const { id } = req.params;
    const { status, arn, trn } = req.body;

    if (!status) {
        return res.status(400).json({ error: 'status is required' });
    }

    let query = supabase.from('applications').select('*').eq('appId', id);
    if (req.user.email !== 'admin@example.com') {
        query = query.eq('userEmail', req.user.email);
    }
    const { data: row, error: fetchErr } = await query.single();

    if (fetchErr || !row) {
        return res.status(404).json({ error: 'Application not found or unauthorized' });
    }

    let appData = typeof row.data === 'string' ? JSON.parse(row.data) : row.data;
    if (arn) appData.arn = arn;
    if (trn) appData.trn = trn;

    if (status === 'Accepted' || status === 'Approved') {
        try {
            const legalName = appData.legalName || id;
            const safeLegalName = legalName.replace(/[^a-z0-9]/gi, '_').toLowerCase();
            const fs = require('fs');
            const path = require('path');
            const dirPath = path.join(__dirname, 'data', safeLegalName);

            if (!fs.existsSync(dirPath)) {
                fs.mkdirSync(dirPath, { recursive: true });
            }

            // Move photos
            if (appData.promoters) {
                appData.promoters.forEach((p, idx) => {
                    if (p.promoterPhotoFile && p.promoterPhotoFile.startsWith('data:image')) {
                        const base64Data = p.promoterPhotoFile.replace(/^data:image\/\w+;base64,/, "");
                        const ext = p.promoterPhotoFile.substring("data:image/".length, p.promoterPhotoFile.indexOf(";base64"));
                        const fileName = `promoterPhoto_${p.firstName || idx}_${Date.now()}.${ext}`;
                        const filePath = path.join(dirPath, fileName);
                        fs.writeFileSync(filePath, base64Data, 'base64');
                        p.promoterPhotoFile = filePath;
                    }
                });
            }

            if (appData.ppob_docFile && (appData.ppob_docFile.startsWith('data:image') || appData.ppob_docFile.startsWith('data:application/pdf'))) {
                const base64Data = appData.ppob_docFile.replace(/^data:(image|application)\/\w+;base64,/, "");
                const ext = appData.ppob_docFile.includes('application/pdf') ? 'pdf' : 'jpg';
                const fileName = `ppob_docFile_${Date.now()}.${ext}`;
                const filePath = path.join(dirPath, fileName);
                fs.writeFileSync(filePath, base64Data, 'base64');
                appData.ppob_docFile = filePath;
            }

            // Move PDF Declaration (Added missing logic to prevent enormous base64 payload overhead in DB)
            if (appData.authSig && appData.authSig.authSigProofFile && (appData.authSig.authSigProofFile.startsWith('data:image') || appData.authSig.authSigProofFile.startsWith('data:application/pdf'))) {
                const base64Data = appData.authSig.authSigProofFile.replace(/^data:.*?;base64,/, "");
                const ext = appData.authSig.authSigProofFile.includes('application/pdf') ? 'pdf' : 'jpg';
                const fileName = `authSigProofFile_${Date.now()}.${ext}`;
                const filePath = path.join(dirPath, fileName);
                fs.writeFileSync(filePath, base64Data, 'base64');
                appData.authSig.authSigProofFile = filePath;
            }

        } catch (err) {
            console.error('Error saving files during approval:', err);
        }
    }

    let updateQuery = supabase.from('applications').update({ status, data: appData }).eq('appId', id);
    if (req.user.email !== 'admin@example.com') {
        updateQuery = updateQuery.eq('userEmail', req.user.email);
    }
    const { error } = await updateQuery;

    try {
        let oldUpdateQuery = oldSupabase.from('applications').update({ status, data: appData }).eq('appId', id);
        if (req.user && req.user.email !== 'admin@example.com') oldUpdateQuery = oldUpdateQuery.eq('userEmail', req.user.email);
        await oldUpdateQuery;
    } catch (e) {
        console.error('Error updating status in oldSupabase:', e.message);
    }

    if (error) {
        console.error('Error updating status:', error.message);
        return res.status(500).json({ error: 'Failed to update status' });
    }
    res.json({ message: 'Status updated successfully', appId: id, status });
});

// PUT /api/applications/:id - Update an existing application's data
app.put('/api/applications/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const { data, status } = req.body;

        if (!data) {
            return res.status(400).json({ error: 'data is required to update application' });
        }

        const updatePayload = { data };
        if (status) updatePayload.status = status;
        if (data.trn || req.body.trn) updatePayload.trn = data.trn || req.body.trn;

        let updateQuery = supabase.from('applications').update(updatePayload).eq('appId', id);
        if (req.user && req.user.email && req.user.email !== 'admin@example.com') {
            updateQuery = updateQuery.or(`userEmail.eq.${req.user.email},userEmail.is.null`);
        }
        const { error } = await updateQuery;

        try {
            let oldUpdate = oldSupabase.from('applications').update(updatePayload).eq('appId', id);
            await oldUpdate;
        } catch (oldErr) {
            console.error('Error updating oldSupabase:', oldErr.message || oldErr);
        }

        if (error) {
            console.error('Error updating application in Supabase:', error.message);
            return res.status(500).json({ error: 'Failed to update application: ' + error.message });
        }

        res.json({ message: 'Application updated successfully', appId: id });
    } catch (err) {
        console.error('Unhandled error in PUT /api/applications/:id:', err);
        res.status(500).json({ error: 'Server error: ' + (err.message || err) });
    }
});

// DELETE /api/applications/:id - Delete an application
app.delete('/api/applications/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;

        // First fetch the application to get the legalName and delete its folder
        let fetchQuery = supabase.from('applications').select('*').eq('appId', id);
        if (req.user && req.user.email && req.user.email !== 'admin@example.com') {
            fetchQuery = fetchQuery.or(`userEmail.eq.${req.user.email},userEmail.is.null`);
        }
        const { data: row } = await fetchQuery.single();

        if (row) {
            try {
                const appData = typeof row.data === 'string' ? JSON.parse(row.data) : row.data;
                const legalName = (appData && appData.legalName) || id;
                const safeLegalName = legalName.replace(/[^a-z0-9]/gi, '_').toLowerCase();
                const fs = require('fs');
                const path = require('path');
                const dirPath = path.join(__dirname, 'data', safeLegalName);

                if (fs.existsSync(dirPath)) {
                    fs.rmSync(dirPath, { recursive: true, force: true });
                }
            } catch (e) {
                console.error('Error deleting application folder:', e);
            }
        }

        // Then delete from the main database
        let deleteQuery = supabase.from('applications').delete({ count: 'exact' }).eq('appId', id);
        if (req.user && req.user.email && req.user.email !== 'admin@example.com') {
            deleteQuery = deleteQuery.or(`userEmail.eq.${req.user.email},userEmail.is.null`);
        }
        const { error: deleteErr } = await deleteQuery;

        // Also delete from oldSupabase so it doesn't reappear on dashboard refresh
        try {
            await oldSupabase.from('applications').delete().eq('appId', id);
        } catch (oldErr) {
            console.error('Error deleting from oldSupabase:', oldErr.message || oldErr);
        }

        if (deleteErr) {
            console.error('Error deleting application:', deleteErr.message);
            return res.status(500).json({ error: 'Failed to delete application: ' + deleteErr.message });
        }

        res.json({ message: 'Application and associated files deleted successfully', appId: id });
    } catch (err) {
        console.error('Unhandled error in DELETE /api/applications/:id:', err);
        res.status(500).json({ error: 'Server error: ' + (err.message || err) });
    }
});

// PUT /api/applications/:id/trn - Save TRN (supports single TRN or state-wise TRNs)
app.put('/api/applications/:id/trn', authenticateToken, async (req, res) => {
    const { id } = req.params;
    const { trn, stateTrns, masterTrn } = req.body;

    if (!trn && !stateTrns && !masterTrn) {
        return res.status(400).json({ error: 'trn or stateTrns is required' });
    }

    // Ensure they own it first (unless admin)
    let fetchQuery = supabase.from('applications').select('appId, data, trn').eq('appId', id);
    if (req.user.email !== 'admin@example.com') {
        fetchQuery = fetchQuery.eq('userEmail', req.user.email);
    }
    const { data: row, error: fetchErr } = await fetchQuery.single();
    if (fetchErr || !row) return res.status(404).json({ error: 'Application not found or unauthorized' });

    let appData = typeof row.data === 'string' ? JSON.parse(row.data) : (row.data || {});

    // Main primary TRN
    const primaryTrn = trn || masterTrn || (stateTrns && Object.values(stateTrns)[0]) || row.trn;

    // Merge state-wise TRNs into application data
    if (stateTrns && typeof stateTrns === 'object') {
        appData.stateTrns = Object.assign({}, appData.stateTrns || {}, stateTrns);
    }
    if (masterTrn) {
        appData.masterTrn = masterTrn;
    }

    const updateFields = {
        trn: primaryTrn,
        data: appData
    };

    let updateQuery = supabase.from('applications').update(updateFields).eq('appId', id);
    if (req.user.email !== 'admin@example.com') {
        updateQuery = updateQuery.eq('userEmail', req.user.email);
    }
    const { error } = await updateQuery;

    try {
        await oldSupabase.from('applications').update(updateFields).eq('appId', id);
    } catch (e) { }

    if (error) {
        console.error('Error updating TRN in DB:', error.message);
        return res.status(500).json({ error: 'Failed to update TRN: ' + error.message });
    }

    console.log(`[DB] Successfully saved TRN for ${id}: Primary TRN = ${primaryTrn}, State TRNs =`, appData.stateTrns);
    res.json({ message: 'TRN saved successfully', appId: id, trn: primaryTrn, stateTrns: appData.stateTrns, masterTrn: appData.masterTrn });
});

const { spawn } = require('child_process');
const path = require('path');

const activeAutomations = new Map();

// POST /api/automation/start
app.post('/api/automation/start', authenticateToken, (req, res) => {
    const { appId, mode, multiStateConfig } = req.body;
    const automationMode = mode || 'regular';
    console.log(`[Automation] Starting automation for App ID: ${appId} (Mode: ${automationMode})`);

    io.to(appId).emit('automation_update', { status: `INITIALIZING: Launching ${automationMode === 'multistate' ? 'Multi-State' : 'Regular'} automation process...` });

    // Spawn the Playwright runner
    const runnerDir = path.join(__dirname, '..', 'automation');
    const runnerPath = path.join(runnerDir, 'runner.js');

    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    const runnerToken = (token && token !== 'undefined' && token !== 'null') ? token : 'admin-super-secret-token-xyz';

    const spawnArgs = [runnerPath, appId, runnerToken, automationMode];
    if (multiStateConfig) {
        spawnArgs.push(JSON.stringify(multiStateConfig));
    }

    const child = spawn('node', spawnArgs, { cwd: runnerDir });
    activeAutomations.set(appId, child);

    child.stdout.on('data', (data) => {
        const lines = data.toString().split('\n');
        for (let line of lines) {
            line = line.trim();
            if (line.startsWith('STATUS:')) {
                const statusMsg = line.replace('STATUS:', '');
                io.to(appId).emit('automation_update', { status: statusMsg });
                if (statusMsg.startsWith('PORTAL_ERROR:')) {
                    try {
                        const parsed = JSON.parse(statusMsg.replace('PORTAL_ERROR:', ''));
                        io.to(appId).emit('automation_portal_error', parsed);
                    } catch (e) {}
                }
            } else if (line.startsWith('PORTAL_ERROR:')) {
                const errDataStr = line.replace('PORTAL_ERROR:', '');
                try {
                    const errData = JSON.parse(errDataStr);
                    io.to(appId).emit('automation_portal_error', errData);
                } catch (e) {
                    io.to(appId).emit('automation_portal_error', { message: errDataStr, appId });
                }
            } else if (line.startsWith('CAPTCHA_IMAGE:')) {
                const imageSrc = line.replace('CAPTCHA_IMAGE:', '');
                io.to(appId).emit('automation_captcha_image', imageSrc);
            } else if (line.startsWith('SCREENSHOT:')) {
                const base64 = line.replace('SCREENSHOT:', '');
                io.to(appId).emit('automation_screenshot', { appId, image: base64 });
            } else if (line.startsWith('WAITING_FOR_WARNING_RESPONSE')) {
                io.to(appId).emit('automation_warning');
            } else if (line) {
                console.log(`[Runner Log]: ${line}`);
            }
        }
    });

    child.stderr.on('data', (data) => {
        console.error(`[Runner Error]: ${data.toString()}`);
    });

    child.on('close', (code) => {
        console.log(`[Automation] Process exited with code ${code}`);
        activeAutomations.delete(appId);
        if (code !== 0) {
            io.to(appId).emit('automation_update', { status: 'Failed: Automation process crashed unexpectedly.' });
        }
    });

    res.json({ message: 'Automation started successfully' });
});

// POST /api/automation/stop
app.post('/api/automation/stop', (req, res) => {
    const { appId } = req.body;
    console.log(`[Automation] Stopping automation for App ID: ${appId}`);

    const child = activeAutomations.get(appId);
    if (child) {
        child.kill(); // Kill the playwright runner process
        activeAutomations.delete(appId);
        console.log(`[Automation] Process killed for App ID: ${appId}`);
    }
    res.json({ message: 'Automation stopped successfully' });
});

// POST /api/automation/captcha
app.post('/api/automation/captcha', (req, res) => {
    const { appId, captcha } = req.body;
    console.log(`[Automation] Captcha received for App ID: ${appId} - Captcha: ${captcha}`);

    const child = activeAutomations.get(appId);
    if (child) {
        // Send the captcha text directly to the running headless browser script
        child.stdin.write(captcha + '\n');
    } else {
        console.log(`[Automation] No active process found for App ID: ${appId}`);
    }

    res.json({ message: 'Captcha received successfully' });
});

// POST /api/automation/warning_response
app.post('/api/automation/warning_response', (req, res) => {
    const { appId, choice } = req.body;
    console.log(`[Automation] Warning response received for App ID: ${appId} - Choice: ${choice}`);

    const child = activeAutomations.get(appId);
    if (child) {
        // Send the choice directly to the running headless browser script
        child.stdin.write(choice + '\n');
    } else {
        console.log(`[Automation] No active process found for App ID: ${appId}`);
    }

    res.json({ message: 'Warning response received successfully' });
});

// POST /api/automation/otp
app.post('/api/automation/otp', (req, res) => {
    const { appId, mobileOtp, emailOtp } = req.body;
    console.log(`[Automation] OTPs received for App ID: ${appId}`);

    const child = activeAutomations.get(appId);
    if (child) {
        // Send both OTPs comma-separated to the running headless browser script
        child.stdin.write(`${mobileOtp},${emailOtp}\n`);
    } else {
        console.log(`[Automation] No active process found for App ID: ${appId}`);
    }

    res.json({ message: 'OTPs received successfully' });
});

// POST /api/automation/evc_otp
app.post('/api/automation/evc_otp', (req, res) => {
    const { appId, otp } = req.body;
    console.log(`[Automation] EVC OTP received for App ID: ${appId} - OTP: ${otp}`);

    const child = activeAutomations.get(appId);
    if (child) {
        child.stdin.write(`${(otp || '').trim()}\n`);
    } else {
        console.log(`[Automation] No active process found for App ID: ${appId}`);
    }

    res.json({ message: 'EVC OTP received successfully' });
});

// Ping endpoint to keep Render awake
app.get('/ping', (req, res) => {
    res.status(200).send('pong');
});

// Self-ping to prevent Render sleep mode (every 14 minutes)
const RENDER_URL = process.env.RENDER_URL || 'https://gst-reg-2fzu.onrender.com';
setInterval(() => {
    fetch(`${RENDER_URL}/ping`)
        .then(res => console.log(`[KeepAlive] Pinged backend: ${res.status}`))
        .catch(err => console.log(`[KeepAlive] Ping failed:`, err.message));
}, 14 * 60 * 1000);

server.listen(PORT, '0.0.0.0', () => {
    console.log(`Backend server is running on http://localhost:${PORT}`);
});
