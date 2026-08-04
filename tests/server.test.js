import test from 'node:test';
import assert from 'node:assert/strict';
import { createAppServer } from '../server.js';

async function withServer(callback) {
  const server = createAppServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try { await callback(`http://127.0.0.1:${port}`); }
  finally { await new Promise((resolve) => server.close(resolve)); }
}

test('health and static files expose production headers', async () => {
  await withServer(async (base) => {
    const health = await fetch(`${base}/health`);
    assert.equal(health.status, 200);
    const payload = await health.json();
    assert.equal(payload.ok, true);
    assert.equal(payload.version, '5.0.0-v5-full-keyframes');
    const page = await fetch(`${base}/`);
    assert.equal(page.status, 200);
    assert.match(page.headers.get('content-security-policy'), /default-src 'self'/);
    assert.match(await page.text(), /src\/main\.js/);
    const head = await fetch(`${base}/config/scene.json`, { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.equal(await head.text(), '');
    const audio = await fetch(`${base}/assets/audio/voice-00-dan-tranh.ogg`, { method: 'HEAD' });
    assert.equal(audio.status, 200);
    assert.equal(audio.headers.get('content-type'), 'audio/ogg');
    const audition = await fetch(`${base}/assets/audio-auditions/03-guzheng.ogg`, { method: 'HEAD' });
    assert.equal(audition.status, 200);
    assert.equal(audition.headers.get('content-type'), 'audio/ogg');
  });
});

test('server returns readable 404 and rejects unsupported methods', async () => {
  await withServer(async (base) => {
    const missing = await fetch(`${base}/does-not-exist`);
    assert.equal(missing.status, 404);
    assert.match(await missing.text(), /未找到文件/);
    const post = await fetch(`${base}/`, { method: 'POST' });
    assert.equal(post.status, 405);
    assert.equal(post.headers.get('allow'), 'GET, HEAD');
  });
});
