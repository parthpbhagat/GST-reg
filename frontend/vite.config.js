const { defineConfig } = require('vite');

// Vite Terminal Logger Plugin
function terminalLoggerPlugin() {
  return {
    name: 'terminal-logger',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        // Intercept client-logs posted by frontend browser
        if (req.url === '/api/client-logs' && req.method === 'POST') {
          let body = '';
          req.on('data', chunk => { body += chunk; });
          req.on('end', () => {
            try {
              const data = JSON.parse(body);
              const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
              const loc = data.location ? ` (${data.location})` : '';
              console.error(`\x1b[90m[${now}]\x1b[0m \x1b[41m\x1b[37m FRONTEND ERROR \x1b[0m \x1b[31m${data.message}\x1b[0m\x1b[90m${loc}\x1b[0m`);
              if (data.stack) {
                console.error(`\x1b[90m${data.stack}\x1b[0m`);
              }
            } catch (e) {}
            res.statusCode = 204;
            res.end();
          });
          return;
        }
        next();
      });
    }
  };
}

module.exports = defineConfig({
  plugins: [terminalLoggerPlugin()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    cors: true
  },
  preview: {
    host: '0.0.0.0',
    port: 5173
  },
  build: {
    cssMinify: false
  }
});
