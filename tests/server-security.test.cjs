const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createServer } = require('../server');

test('development server serves project assets and blocks traversal', async () => {
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const request = path => new Promise((resolve, reject) => {
    http.get({ hostname: '127.0.0.1', port, path }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode, mime: response.headers['content-type'], body: Buffer.concat(chunks) }));
    }).on('error', reject);
  });
  try {
    for (const [path, mime] of [
      ['/', 'text/html'], ['/index.html?view=main', 'text/html'],
      ['/app.js', 'application/javascript'], ['/styles.css', 'text/css'],
      ['/filterbank-processor.js', 'application/javascript'],
      ['/dynamic-eq-core.mjs', 'application/javascript'],
      ['/assets/samples/145_LOOP.wav', 'audio/wav']
    ]) {
      const result = await request(path);
      assert.equal(result.status, 200, path);
      assert.ok(result.mime.startsWith(mime), path);
      assert.ok(result.body.length > 0, path);
    }
    for (const path of [
      '/../package.json', '/../../outside.txt', '/%2e%2e/package.json',
      '/%2e%2e%2fpackage.json', '/..%5cpackage.json', '/%2e%2e%5cpackage.json'
    ]) {
      const result = await request(path);
      assert.equal(result.status, 403, path);
    }
    assert.equal((await request('/%ZZ')).status, 400);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
