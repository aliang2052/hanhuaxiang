import test from 'node:test';
import assert from 'node:assert/strict';
import { CameraController } from '../../src/input/camera-controller.js';

class FakeTrack extends EventTarget {
  constructor(id) {
    super();
    this.id = id;
    this.stopped = false;
  }

  stop() {
    this.stopped = true;
  }
}

function makeStream(id) {
  const track = new FakeTrack(id);
  return {
    id,
    track,
    getTracks: () => [track],
    getVideoTracks: () => [track],
  };
}

class FakeVideo extends EventTarget {
  constructor({ readyState = 2, playError = null } = {}) {
    super();
    this.readyState = readyState;
    this.playError = playError;
    this.srcObject = null;
    this.videoWidth = 1280;
    this.videoHeight = 720;
    this.playCalls = 0;
  }

  async play() {
    this.playCalls += 1;
    if (this.playError) throw this.playError;
  }
}

function fakeCanvas() {
  return {
    width: 0,
    height: 0,
    getContext() {
      return {
        save() {}, restore() {}, clearRect() {}, translate() {}, scale() {}, drawImage() {},
        getImageData() { return { width: 1, height: 1, data: new Uint8ClampedArray(4) }; },
      };
    },
  };
}

function namedError(name, message = name) {
  const error = new Error(message);
  error.name = name;
  return error;
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

async function waitFor(predicate, timeoutMs = 600) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 4));
  }
  throw new Error('Timed out waiting for camera state');
}

function makeController(video, mediaDevices, overrides = {}) {
  return new CameraController(video, 16, 9, mediaDevices, {
    canvas: fakeCanvas(),
    reconnectBaseMs: 5,
    reconnectMaxMs: 12,
    videoTimeoutMs: 25,
    ...overrides,
  });
}

test('disconnect keeps retrying through two transient failures and succeeds on the third attempt', async () => {
  const streams = [makeStream('initial'), makeStream('recovered')];
  let call = 0;
  const mediaDevices = {
    async getUserMedia() {
      call += 1;
      if (call === 1) return streams[0];
      if (call === 2) throw namedError('NotReadableError');
      if (call === 3) throw namedError('AbortError');
      return streams[1];
    },
  };
  const controller = makeController(new FakeVideo(), mediaDevices);
  assert.equal(await controller.start(), true);
  streams[0].track.dispatchEvent(new Event('ended'));
  await waitFor(() => controller.state === 'live' && controller.getUserMediaCalls === 4);
  assert.equal(streams[0].track.stopped, true);
  assert.equal(controller.stream, streams[1]);
  assert.equal(controller.reconnectAttempts, 0, 'successful recovery resets the consecutive counter');
  assert.equal(controller.reconnectFailuresTotal, 2);
  assert.equal(controller.reconnectSuccesses, 1);
  controller.stop();
});

test('permanent permission denial stops the reconnect loop', async () => {
  const first = makeStream('initial');
  let call = 0;
  const mediaDevices = {
    async getUserMedia() {
      call += 1;
      if (call === 1) return first;
      throw namedError('NotAllowedError');
    },
  };
  const controller = makeController(new FakeVideo(), mediaDevices);
  assert.equal(await controller.start(), true);
  first.track.dispatchEvent(new Event('ended'));
  await waitFor(() => controller.state === 'error');
  await new Promise((resolve) => setTimeout(resolve, 45));
  assert.equal(controller.getUserMediaCalls, 2);
  assert.equal(controller.reconnectTimer, 0);
  controller.stop();
});

test('generation cancellation prevents an old pending request from polluting a new hardware selection', async () => {
  const firstDeferred = deferred();
  const secondDeferred = deferred();
  let call = 0;
  const mediaDevices = {
    getUserMedia() {
      call += 1;
      return call === 1 ? firstDeferred.promise : secondDeferred.promise;
    },
  };
  const video = new FakeVideo();
  const controller = makeController(video, mediaDevices);
  const oldStart = controller.start();
  controller.stop();
  const newStart = controller.start();
  const oldStream = makeStream('old');
  const newStream = makeStream('new');
  firstDeferred.resolve(oldStream);
  assert.equal(await oldStart, false);
  assert.equal(oldStream.track.stopped, true);
  secondDeferred.resolve(newStream);
  assert.equal(await newStart, true);
  assert.equal(controller.stream, newStream);
  assert.equal(video.srcObject, newStream);
  assert.equal(controller.getUserMediaCalls, 2);
  controller.stop();
});

test('video readiness timeout stops every acquired track and clears srcObject', async () => {
  const stream = makeStream('timeout');
  const video = new FakeVideo({ readyState: 0 });
  const controller = makeController(video, { getUserMedia: async () => stream }, { videoTimeoutMs: 12 });
  assert.equal(await controller.start(), false);
  assert.ok(['error', 'reconnecting'].includes(controller.state));
  assert.equal(stream.track.stopped, true);
  assert.equal(controller.stream, null);
  assert.equal(controller.track, null);
  assert.equal(video.srcObject, null);
  controller.stop();
});


test('video play rejection also releases the acquired stream', async () => {
  const stream = makeStream('play-failure');
  const controller = makeController(
    new FakeVideo({ readyState: 2, playError: namedError('AbortError', 'play failed') }),
    { getUserMedia: async () => stream },
  );
  assert.equal(await controller.start(), false);
  assert.equal(stream.track.stopped, true);
  assert.equal(controller.stream, null);
  assert.equal(controller.track, null);
  assert.equal(controller.video.srcObject, null);
  controller.stop();
});

test('parallel starts in one generation share a single getUserMedia request', async () => {
  const request = deferred();
  const mediaDevices = { getUserMedia: () => request.promise };
  const controller = makeController(new FakeVideo(), mediaDevices);
  const starts = [controller.start(), controller.start(), controller.start()];
  request.resolve(makeStream('shared'));
  assert.deepEqual(await Promise.all(starts), [true, true, true]);
  assert.equal(controller.getUserMediaCalls, 1);
  controller.stop();
});
