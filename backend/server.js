const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const db = require('./database');

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

// Auth Middleware using Supabase
const authenticateToken = async (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: 'Missing authorization token' });
    }

    const { data: { user }, error } = await db.auth.getUser(token);
    
    if (error || !user) {
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
            try {
                if (fs.existsSync(normalizedFilePath)) {
                    fs.unlinkSync(normalizedFilePath);
                    console.log(`[DELETE] Successfully deleted file from data folder: ${normalizedFilePath}`);
                }
            } catch (e) {
                console.error('Error deleting file:', e);
            }
        } else {
            console.warn(`[DELETE] Security block: Path ${normalizedFilePath} is outside data folder.`);
        }
    }
    res.json({ success: true });
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
    const { appId, data } = req.body;
    
    if (!appId || !data) {
        return res.status(400).json({ error: 'appId and data are required' });
    }

    const userEmail = req.user.email || req.body.userEmail || data.userEmail || null;
    const userId = req.user.id;
    const status = 'Pending'; // Default status

    const { error } = await db.from('applications').upsert({
        appId: appId,
        data: data,
        status: status,
        userEmail: userEmail,
        user_id: userId // MUST ADD THIS COLUMN IN SUPABASE!
    }, { onConflict: 'appId' });

    if (error) {
        console.error('Error saving application:', error.message);
        return res.status(500).json({ error: 'Failed to save application' });
    }
    res.status(201).json({ message: 'Application submitted successfully', appId });
});

// GET /api/applications - Get all applications for logged-in user
app.get('/api/applications', authenticateToken, async (req, res) => {
    const { data: rows, error } = await db.from('applications')
        .select('*')
        .eq('user_id', req.user.id)
        .order('createdAt', { ascending: false });

    if (error) {
        console.error('Error fetching applications:', error.message);
        return res.status(500).json({ error: 'Failed to fetch applications' });
    }
    
    const applications = rows.map(row => ({
        appId: row.appId,
        status: row.status,
        date: row.createdAt,
        trn: row.trn,
        data: typeof row.data === 'string' ? JSON.parse(row.data) : row.data
    }));

    res.json(applications);
});

// PUT /api/applications/:id/status - Update application status (Admin Approve/Reject)
app.put('/api/applications/:id/status', authenticateToken, async (req, res) => {
    const { id } = req.params;
    const { status } = req.body;

    if (!status) {
        return res.status(400).json({ error: 'status is required' });
    }

    const { data: row, error: fetchErr } = await db.from('applications').select('*').eq('appId', id).eq('user_id', req.user.id).single();

    if (fetchErr || !row) {
        return res.status(404).json({ error: 'Application not found' });
    }

    let appData = typeof row.data === 'string' ? JSON.parse(row.data) : row.data;
    
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

            function processFiles(obj, parentKey = '') {
                let updated = false;
                for (let key in obj) {
                    if (typeof obj[key] === 'string' && obj[key].startsWith('data:')) {
                        const matches = obj[key].match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
                        if (matches && matches.length === 3) {
                            const mimeType = matches[1];
                            const base64Data = matches[2];
                            let ext = mimeType.split('/')[1] || 'bin';
                            if (ext === 'jpeg') ext = 'jpg';
                            if (ext === 'vnd.openxmlformats-officedocument.wordprocessingml.document') ext = 'docx';
                            
                            let prefix = parentKey ? `${parentKey}_` : '';
                            let fileName;
                            if (key === 'promoterPhotoFile' && obj.firstName) {
                                const safeFirstName = obj.firstName.replace(/[^a-zA-Z0-9]/g, '_');
                                fileName = `promoterPhoto_${safeFirstName}.${ext}`;
                            } else {
                                fileName = `${prefix}${key}.${ext}`;
                            }
                            console.log(`[DEBUG processFiles] key: ${key}, parentKey: '${parentKey}', obj.firstName: '${obj.firstName}', prefix: '${prefix}', fileName: ${fileName}`);
                            let filePath = path.join(dirPath, fileName);
                            
                            if (fs.existsSync(filePath)) {
                                if (key === 'promoterPhotoFile' && obj.firstName) {
                                    const safeFirstName = obj.firstName.replace(/[^a-zA-Z0-9]/g, '_');
                                    fileName = `promoterPhoto_${safeFirstName}_${Date.now()}.${ext}`;
                                } else {
                                    fileName = `${prefix}${key}_${Date.now()}.${ext}`;
                                }
                                filePath = path.join(dirPath, fileName);
                            }
                            
                            fs.writeFileSync(filePath, Buffer.from(base64Data, 'base64'));
                            
                            // Save the full absolute file path in the database
                            obj[key] = filePath;
                            updated = true;
                        }
                    } else if (typeof obj[key] === 'object' && obj[key] !== null) {
                        if (processFiles(obj[key], Array.isArray(obj) ? parentKey : key)) {
                            updated = true;
                        }
                    }
                }
                return updated;
            }

            processFiles(appData);
        } catch (e) {
            console.error('Error processing application documents:', e);
        }
    }

    const { error: updateErr } = await db.from('applications').update({ status, data: appData }).eq('appId', id);

    if (updateErr) {
        console.error('Error updating status:', updateErr.message);
        return res.status(500).json({ error: 'Failed to update status' });
    }
    res.json({ message: 'Status updated successfully', appId: id, status });
});

// DELETE /api/applications/:id - Delete an application
app.delete('/api/applications/:id', authenticateToken, async (req, res) => {
    const { id } = req.params;

    // First fetch the application to get the legalName and delete its folder
            if (fs.existsSync(dirPath)) {
                fs.rmSync(dirPath, { recursive: true, force: true });
            }
        } catch (e) {
            console.error('Error deleting application folder:', e);
        }
    }

    // Then delete from the database
    const { error: deleteErr, count } = await db.from('applications').delete({ count: 'exact' }).eq('appId', id);

    if (deleteErr) {
        console.error('Error deleting application:', deleteErr.message);
        return res.status(500).json({ error: 'Failed to delete application' });
    }
    if (count === 0) {
        return res.status(404).json({ error: 'Application not found' });
    }
    res.json({ message: 'Application and associated files deleted successfully', appId: id });
});

// PUT /api/applications/:id/trn - Save TRN
app.put('/api/applications/:id/trn', authenticateToken, async (req, res) => {
    const { id } = req.params;
    const { trn } = req.body;

    if (!trn) return res.status(400).json({ error: 'trn is required' });

    // Ensure they own it first
    const { data: row, error: fetchErr } = await db.from('applications').select('appId').eq('appId', id).eq('user_id', req.user.id).single();
    if (fetchErr || !row) return res.status(404).json({ error: 'Application not found or unauthorized' });

    const { error } = await db.from('applications').update({ trn }).eq('appId', id);
    
    if (error) {
        console.error('Error updating TRN:', error.message);
        return res.status(500).json({ error: 'Failed to update TRN' });
    }
    res.json({ message: 'TRN saved successfully', appId: id, trn });
});

const { spawn } = require('child_process');
const path = require('path');

const activeAutomations = new Map();

// POST /api/automation/start
app.post('/api/automation/start', (req, res) => {
    const { appId } = req.body;
    console.log(`[Automation] Starting automation for App ID: ${appId}`);
    
    io.to(appId).emit('automation_update', { status: 'INITIALIZING: Launching secure automation process...' });

    // Spawn the Playwright runner
    const runnerDir = path.join(__dirname, '..', 'automation');
    const runnerPath = path.join(runnerDir, 'runner.js');
    const child = spawn('node', [runnerPath, appId], { cwd: runnerDir });
    activeAutomations.set(appId, child);

    child.stdout.on('data', (data) => {
        const lines = data.toString().split('\n');
        for (let line of lines) {
            line = line.trim();
            if (line.startsWith('STATUS:')) {
                const statusMsg = line.replace('STATUS:', '');
                io.to(appId).emit('automation_update', { status: statusMsg });
            } else if (line.startsWith('CAPTCHA_IMAGE:')) {
                const imageSrc = line.replace('CAPTCHA_IMAGE:', '');
                io.to(appId).emit('automation_captcha_image', imageSrc);
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

server.listen(PORT, () => {
    console.log(`Backend server is running on http://localhost:${PORT}`);
});
