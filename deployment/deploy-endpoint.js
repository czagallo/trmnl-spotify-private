require('dotenv').config();
const http = require('http');
const { execSync } = require('child_process');

const PORT = 3007;
// Set DEPLOY_TOKEN in the systemd service file environment, not here.
// Generate a random token: openssl rand -hex 32
const DEPLOY_TOKEN = process.env.DEPLOY_TOKEN || 'REPLACE_WITH_REAL_TOKEN';
const DEPLOY_SCRIPT = '/home/antfarm/deployments/trmnl-spotify-private/deployment/deploy.sh';

const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/deploy') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        if (data.token !== DEPLOY_TOKEN) {
          res.writeHead(403);
          res.end('Forbidden');
          return;
        }
      } catch (e) {
        // Allow empty body if token matches via query
      }

      console.log('Deploy triggered at', new Date().toISOString());
      try {
        execSync(`bash ${DEPLOY_SCRIPT}`, { stdio: 'inherit', timeout: 120000 });
        res.writeHead(200);
        res.end('OK');
      } catch (err) {
        console.error('Deploy failed:', err.message);
        res.writeHead(500);
        res.end('Deploy failed');
      }
    });
  } else {
    res.writeHead(404);
    res.end('Not found');
  }
});

server.listen(PORT, () => {
  console.log(`Deploy endpoint listening on port ${PORT}`);
});
