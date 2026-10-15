const fs = require('fs');
const path = require('path');

const logsDir = path.join(__dirname, 'logs');
if (!fs.existsSync(logsDir)) {
    try {
        fs.mkdirSync(logsDir, { recursive: true });
    } catch (e) {}
}

const systemLogFile = path.join(logsDir, 'system_activity.log');
const errorLogFile = path.join(logsDir, 'error.log');

// ANSI Color Codes for Terminal Output
const colors = {
    reset: '\x1b[0m',
    bold: '\x1b[1m',
    dim: '\x1b[2m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    cyan: '\x1b[36m',
    white: '\x1b[37m',
    gray: '\x1b[90m',
    bgRed: '\x1b[41m\x1b[37m',
    bgBlue: '\x1b[44m\x1b[37m'
};

function stripAnsi(str) {
    return String(str).replace(/\x1b\[[0-9;]*m/g, '');
}

function getTimestamp() {
    const now = new Date();
    const d = now.toISOString().replace('T', ' ').substring(0, 19);
    return d;
}

function appendToFile(filePath, text) {
    try {
        fs.appendFileSync(filePath, stripAnsi(text) + '\n', 'utf-8');
    } catch (e) {
        // Safe failover
    }
}

const logger = {
    info(msg, meta = '') {
        const time = getTimestamp();
        const metaStr = meta ? ` ${colors.gray}${typeof meta === 'object' ? JSON.stringify(meta) : meta}${colors.reset}` : '';
        const line = `${colors.gray}[${time}]${colors.reset} ${colors.cyan}[INFO]${colors.reset} ${msg}${metaStr}`;
        console.log(line);
        appendToFile(systemLogFile, line);
    },

    success(msg, meta = '') {
        const time = getTimestamp();
        const metaStr = meta ? ` ${colors.gray}${typeof meta === 'object' ? JSON.stringify(meta) : meta}${colors.reset}` : '';
        const line = `${colors.gray}[${time}]${colors.reset} ${colors.green}[SUCCESS]${colors.reset} ${msg}${metaStr}`;
        console.log(line);
        appendToFile(systemLogFile, line);
    },

    warn(msg, meta = '') {
        const time = getTimestamp();
        const metaStr = meta ? ` ${colors.gray}${typeof meta === 'object' ? JSON.stringify(meta) : meta}${colors.reset}` : '';
        const line = `${colors.gray}[${time}]${colors.reset} ${colors.yellow}[WARN]${colors.reset} ${msg}${metaStr}`;
        console.warn(line);
        appendToFile(systemLogFile, line);
    },

    error(msg, err = null) {
        const time = getTimestamp();
        let details = '';
        if (err) {
            details = err.stack ? `\n${colors.dim}${err.stack}${colors.reset}` : ` ${err.message || String(err)}`;
        }
        const line = `${colors.gray}[${time}]${colors.reset} ${colors.bgRed} ERROR ${colors.reset} ${colors.red}${msg}${details}${colors.reset}`;
        console.error(line);
        appendToFile(systemLogFile, line);
        appendToFile(errorLogFile, line);
    },

    http(req, res, durationMs) {
        const time = getTimestamp();
        const status = res.statusCode;
        const color = status >= 500 ? colors.red : (status >= 400 ? colors.yellow : (status >= 300 ? colors.cyan : colors.green));
        const methodColor = req.method === 'GET' ? colors.cyan : (req.method === 'POST' ? colors.green : (req.method === 'PUT' ? colors.yellow : colors.magenta));
        const line = `${colors.gray}[${time}]${colors.reset} ${colors.blue}[HTTP]${colors.reset} ${methodColor}${req.method}${colors.reset} ${req.originalUrl || req.url} ${color}${status}${colors.reset} ${colors.gray}(${durationMs}ms)${colors.reset}`;
        console.log(line);
        appendToFile(systemLogFile, line);
    },

    runner(appId, type, msg) {
        const time = getTimestamp();
        const appLabel = appId ? `${colors.magenta}[RUNNER:${appId}]${colors.reset}` : `${colors.magenta}[RUNNER]${colors.reset}`;

        let typeBadge = `${colors.cyan}[${type}]${colors.reset}`;
        if (type.includes('ERROR') || type.includes('FAIL')) {
            typeBadge = `${colors.red}${colors.bold}[${type}]${colors.reset}`;
        } else if (type.includes('CAPTCHA') || type.includes('OTP') || type.includes('ACTION')) {
            typeBadge = `${colors.yellow}${colors.bold}[${type}]${colors.reset}`;
        } else if (type.includes('SUCCESS') || type.includes('COMPLETED') || type.includes('DONE')) {
            typeBadge = `${colors.green}${colors.bold}[${type}]${colors.reset}`;
        }

        const line = `${colors.gray}[${time}]${colors.reset} ${appLabel} ${typeBadge} ${msg}`;
        if (type.includes('ERROR')) {
            console.error(line);
        } else {
            console.log(line);
        }

        appendToFile(systemLogFile, line);
        if (appId) {
            const appLogFile = path.join(logsDir, `automation_${appId}.log`);
            appendToFile(appLogFile, line);
        }
    },

    frontend(level, msg, location = '', stack = '') {
        const time = getTimestamp();
        const locStr = location ? ` ${colors.gray}(${location})${colors.reset}` : '';
        const stackStr = stack ? `\n${colors.dim}${stack}${colors.reset}` : '';
        const line = `${colors.gray}[${time}]${colors.reset} ${colors.bgRed} CLIENT ${colors.reset} ${colors.red}[${level.toUpperCase()}]${colors.reset} ${msg}${locStr}${stackStr}`;
        console.error(line);
        appendToFile(systemLogFile, line);
        appendToFile(errorLogFile, line);
    }
};

module.exports = logger;
