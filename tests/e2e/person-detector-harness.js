import { PersonDetector } from '../../src/input/person-detector.js';

const output = document.getElementById('result');
const fixture = document.getElementById('fixture');
try {
  const moduleResponse = await fetch('../../vendor/mediapipe/vision_bundle.mjs');
  const moduleText = await moduleResponse.text();
  const detector = new PersonDetector(320, 180);
  const ok = await detector.initialize();
  output.textContent = JSON.stringify({
    ok,
    module: {
      status: moduleResponse.status,
      type: moduleResponse.headers.get('content-type'),
      bytes: moduleText.length,
      prefix: moduleText.slice(0, 24),
    },
    detector: detector.snapshot(),
  });
  fixture.addEventListener('change', async () => {
    const file = fixture.files?.[0];
    if (!file) return;
    const bitmap = await createImageBitmap(file);
    const canvas = document.createElement('canvas');
    canvas.width = 320;
    canvas.height = 180;
    const context = canvas.getContext('2d');
    context.fillStyle = '#000';
    context.fillRect(0, 0, canvas.width, canvas.height);
    const scale = Math.min(canvas.width / bitmap.width, canvas.height / bitmap.height);
    const width = bitmap.width * scale;
    const height = bitmap.height * scale;
    context.drawImage(bitmap, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height);
    bitmap.close();
    const result = detector.process(context.getImageData(0, 0, canvas.width, canvas.height), performance.now());
    output.textContent = JSON.stringify({ ok: true, detector: detector.snapshot(), detections: result.components }, null, 2);
    document.documentElement.dataset.status = result.components.length ? 'detected' : 'empty';
  });
  document.documentElement.dataset.status = ok ? 'passed' : 'failed';
} catch (error) {
  output.textContent = JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) });
  document.documentElement.dataset.status = 'failed';
}
