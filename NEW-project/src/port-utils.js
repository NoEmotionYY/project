/**
 * 端口检测工具：检测端口是否被占用，自动寻找可用端口
 */
const net = require('net');

function checkPortAvailable(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', (err) => {
      resolve(err.code !== 'EADDRINUSE');
    });
    server.once('listening', () => {
      server.close(() => resolve(true));
    });
    server.listen(port, '127.0.0.1');
  });
}

function checkPortAvailableDual(port) {
  // 同时检查 127.0.0.1 和 0.0.0.0，确保端口真正可用
  return new Promise((resolve) => {
    const check = (host, cb) => {
      const server = net.createServer();
      server.once('error', (err) => cb(err.code !== 'EADDRINUSE'));
      server.once('listening', () => server.close(() => cb(true)));
      server.listen(port, host);
    };
    check('127.0.0.1', (ok1) => {
      if (!ok1) return resolve(false);
      check('0.0.0.0', (ok2) => resolve(ok2));
    });
  });
}

async function findAvailablePort(startPort, maxTry = 100) {
  for (let i = 0; i < maxTry; i++) {
    const port = startPort + i;
    if (await checkPortAvailableDual(port)) {
      return port;
    }
  }
  throw new Error(`无法找到可用端口（尝试范围 ${startPort}-${startPort + maxTry - 1}）`);
}

module.exports = { checkPortAvailable, findAvailablePort };
