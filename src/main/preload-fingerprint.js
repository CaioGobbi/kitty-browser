'use strict';

// Fingerprinting protection, in the spirit of Brave's "farbling": instead of
// hiding APIs (which breaks sites and is itself identifying), readbacks get a
// tiny, per-site, per-session deterministic noise so the same device produces
// different fingerprints on different sites. Also exposes Global Privacy Control.
const { contextBridge, ipcRenderer } = require('electron');

function protect(seed, farble) {
  const define = (proto, name, getter) => {
    const desc = Object.getOwnPropertyDescriptor(proto, name);
    if (desc && !desc.configurable) return;
    const get = new Proxy(desc?.get || function () {}, { apply: (target, self) => getter(target, self) });
    Object.defineProperty(proto, name, { get, configurable: true, enumerable: desc ? desc.enumerable : true });
  };

  // Global Privacy Control (https://globalprivacycontrol.org) — matches the Sec-GPC header.
  if (!('globalPrivacyControl' in Navigator.prototype)) define(Navigator.prototype, 'globalPrivacyControl', () => true);
  if (!farble) return;

  // Proxies keep Function.prototype.toString returning "[native code]".
  const wrap = (proto, name, handler) => {
    const original = proto?.[name];
    if (typeof original !== 'function') return;
    proto[name] = new Proxy(original, { apply: (target, self, args) => handler(target, self, args) });
  };
  const noiseAt = (i) => Math.imul((i + 1) ^ seed, 2654435761) >>> 0;

  // ---- Canvas: flip the lowest bit of ~1 in 16 pixels, always the same ones.
  const farbleImage = (pixels) => {
    for (let i = 0; i < pixels.length; i += 4) {
      const n = noiseAt(i >> 2);
      if ((n & 15) === 0) pixels[i + (n >>> 4) % 3] ^= 1;
    }
  };
  const getImageData = CanvasRenderingContext2D.prototype.getImageData;
  wrap(CanvasRenderingContext2D.prototype, 'getImageData', (target, self, args) => {
    const image = Reflect.apply(target, self, args);
    farbleImage(image.data);
    return image;
  });
  const farbledCopy = (canvas) => {
    const { width, height } = canvas;
    if (!width || !height || width * height > 4_000_000) return canvas;
    const copy = document.createElement('canvas');
    copy.width = width;
    copy.height = height;
    const ctx = copy.getContext('2d');
    ctx.drawImage(canvas, 0, 0);
    const image = Reflect.apply(getImageData, ctx, [0, 0, width, height]);
    farbleImage(image.data);
    ctx.putImageData(image, 0, 0);
    return copy;
  };
  for (const name of ['toDataURL', 'toBlob']) {
    wrap(HTMLCanvasElement.prototype, name, (target, self, args) => Reflect.apply(target, farbledCopy(self), args));
  }

  // ---- WebGL: report a common GPU instead of the exact model.
  for (const proto of [globalThis.WebGLRenderingContext?.prototype, globalThis.WebGL2RenderingContext?.prototype]) {
    wrap(proto, 'getParameter', (target, self, args) => {
      if (args[0] === 37445) return 'Apple Inc.'; // UNMASKED_VENDOR_WEBGL
      if (args[0] === 37446) return 'Apple GPU'; // UNMASKED_RENDERER_WEBGL
      return Reflect.apply(target, self, args);
    });
  }

  // ---- Audio: imperceptible noise on readbacks (each buffer farbled once).
  const farbled = new WeakSet();
  wrap(globalThis.AudioBuffer?.prototype, 'getChannelData', (target, self, args) => {
    const channel = Reflect.apply(target, self, args);
    if (!farbled.has(channel)) {
      farbled.add(channel);
      for (let i = 0; i < channel.length; i += 97) channel[i] += ((noiseAt(i) & 255) - 128) * 1e-7;
    }
    return channel;
  });
  wrap(globalThis.AnalyserNode?.prototype, 'getFloatFrequencyData', (target, self, args) => {
    Reflect.apply(target, self, args);
    const out = args[0];
    for (let i = 0; i < out.length; i++) out[i] += ((noiseAt(i) & 255) - 128) * 1e-4;
  });

  // ---- Hardware: report a plausible, per-site value instead of the exact one.
  define(Navigator.prototype, 'hardwareConcurrency', (target, self) => {
    const real = Reflect.apply(target, self, []) || 4;
    return Math.max(2, Math.min(real, 2 + (seed % 7)));
  });
  if ('deviceMemory' in Navigator.prototype) define(Navigator.prototype, 'deviceMemory', () => 8);
}

if (/^https?:$/.test(location.protocol)) {
  let config = { enabled: false, seed: 0 };
  try {
    config = ipcRenderer.sendSync('kitty:fingerprint', location.href) || config;
  } catch {
    // main process not ready: GPC only
  }
  try {
    contextBridge.executeInMainWorld({ func: protect, args: [config.seed, config.enabled] });
  } catch {
    // frames that don't allow script execution
  }
}
