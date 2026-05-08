const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const CERT_TARGETS = [
  {
    cert: path.join(ROOT, 'nginx', 'conf', 'cert.pem'),
    key: path.join(ROOT, 'nginx', 'conf', 'key.pem')
  },
  {
    cert: path.join(ROOT, 'cert.pem'),
    key: path.join(ROOT, 'key.pem')
  }
];

function exists(pair) {
  return fs.existsSync(pair.cert) && fs.existsSync(pair.key);
}

function runOpenSsl(pair, withSan) {
  fs.mkdirSync(path.dirname(pair.cert), { recursive: true });
  const configPath = path.join(ROOT, 'nginx', 'conf', 'openssl-test.cnf');
  fs.writeFileSync(
    configPath,
    [
      '[req]',
      'distinguished_name = dn',
      'prompt = no',
      'x509_extensions = v3_req',
      '[dn]',
      'CN = localhost',
      '[v3_req]',
      'subjectAltName = DNS:localhost,IP:127.0.0.1',
      ''
    ].join('\n')
  );
  const args = [
    'req',
    '-x509',
    '-newkey',
    'rsa:2048',
    '-sha256',
    '-nodes',
    '-days',
    '30',
    '-config',
    configPath,
    '-keyout',
    pair.key,
    '-out',
    pair.cert
  ];
  if (withSan) {
    args.push('-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1');
  }
  return spawnSync('openssl', args, {
    cwd: ROOT,
    encoding: 'utf8',
    windowsHide: true
  });
}

function ensurePair(pair) {
  if (exists(pair)) return false;
  const rootCert = path.join(ROOT, 'cert.pem');
  const rootKey = path.join(ROOT, 'key.pem');
  if ((pair.cert !== rootCert || pair.key !== rootKey) && fs.existsSync(rootCert) && fs.existsSync(rootKey)) {
    fs.mkdirSync(path.dirname(pair.cert), { recursive: true });
    fs.copyFileSync(rootCert, pair.cert);
    fs.copyFileSync(rootKey, pair.key);
    return true;
  }
  const first = runOpenSsl(pair, true);
  if (first.status !== 0) {
    const second = runOpenSsl(pair, false);
    if (second.status !== 0) {
      throw new Error(second.stderr || first.stderr || 'OpenSSL failed to create test certificate');
    }
  }
  return true;
}

function main() {
  const created = [];
  for (const pair of CERT_TARGETS) {
    if (ensurePair(pair)) {
      created.push(path.relative(ROOT, pair.cert), path.relative(ROOT, pair.key));
    }
  }
  if (created.length > 0) {
    console.log(`Generated local self-signed test certificate files: ${created.join(', ')}`);
  } else {
    console.log('Local test certificate files already exist');
  }
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error(`Failed to prepare local test certificate: ${err.message}`);
    process.exit(1);
  }
}

module.exports = { main };
