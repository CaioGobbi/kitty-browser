'use strict';

// Fingerprinting protection, in the spirit of Brave's "farbling": instead of
// hiding APIs (which breaks sites and is itself identifying), readbacks get a
// tiny, per-site, per-session deterministic noise so the same device produces
// different fingerprints on different sites. Also exposes Global Privacy Control.
const { contextBridge, ipcRenderer } = require('electron');

function protect(seed, farble, skip = []) {
  const define = (proto, name, getter) => {
    const desc = Object.getOwnPropertyDescriptor(proto, name);
    if (desc && !desc.configurable) return;
    const get = new Proxy(desc?.get || function () {}, { apply: (target, self) => getter(target, self) });
    Object.defineProperty(proto, name, { get, configurable: true, enumerable: desc ? desc.enumerable : true });
  };

  // Global Privacy Control (https://globalprivacycontrol.org) — matches the Sec-GPC header.
  if (!('globalPrivacyControl' in Navigator.prototype)) define(Navigator.prototype, 'globalPrivacyControl', () => true);
  // Sites (WhatsApp, Gmail…) put an unread count on the Dock icon through the
  // Badging API; the Kitty keeps its icon clean, so the calls do nothing.
  for (const name of ['setAppBadge', 'clearAppBadge']) {
    if (typeof Navigator.prototype[name] === 'function') {
      Navigator.prototype[name] = new Proxy(Navigator.prototype[name], { apply: () => Promise.resolve() });
    }
  }
  if (!farble) return;

  // Proxies keep Function.prototype.toString returning "[native code]".
  const wrap = (proto, name, handler) => {
    const original = proto?.[name];
    if (typeof original !== 'function') return;
    proto[name] = new Proxy(original, { apply: (target, self, args) => handler(target, self, args) });
  };
  const noiseAt = (i) => Math.imul((i + 1) ^ seed, 2654435761) >>> 0;
  // Flips the lowest bit of ~1 in 16 pixels, always the same ones.
  const farbleImage = (pixels) => {
    for (let i = 0; i < pixels.length; i += 4) {
      const n = noiseAt(i >> 2);
      if ((n & 15) === 0) pixels[i + (n >>> 4) % 3] ^= 1;
    }
  };
  // Features turned off for this site (see FINGERPRINT_EXCEPTIONS in privacy.js).
  const on = (feature) => !skip.includes(feature);

  // ---- Canvas: noise on readbacks (getImageData, toDataURL, toBlob).
  if (on('canvas')) {
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
  }

  // ---- WebGL: report a common GPU instead of the exact model.
  if (on('webgl')) {
    for (const proto of [globalThis.WebGLRenderingContext?.prototype, globalThis.WebGL2RenderingContext?.prototype]) {
      wrap(proto, 'getParameter', (target, self, args) => {
        if (args[0] === 37445) return 'Apple Inc.'; // UNMASKED_VENDOR_WEBGL
        if (args[0] === 37446) return 'Apple GPU'; // UNMASKED_RENDERER_WEBGL
        return Reflect.apply(target, self, args);
      });
    }
  }

  // ---- Audio: imperceptible noise on readbacks (each buffer farbled once).
  if (on('audio')) {
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
  }

  // ---- OffscreenCanvas (main thread): same noise as regular canvases.
  if (on('offscreen')) {
    if (globalThis.OffscreenCanvasRenderingContext2D) {
      const offscreenGetImageData = OffscreenCanvasRenderingContext2D.prototype.getImageData;
      wrap(OffscreenCanvasRenderingContext2D.prototype, 'getImageData', (target, self, args) => {
        const image = Reflect.apply(target, self, args);
        farbleImage(image.data);
        return image;
      });
      wrap(globalThis.OffscreenCanvas?.prototype, 'convertToBlob', (target, self, args) => {
        const { width, height } = self;
        if (!width || !height || width * height > 4_000_000) return Reflect.apply(target, self, args);
        const copy = new OffscreenCanvas(width, height);
        const ctx = copy.getContext('2d');
        ctx.drawImage(self, 0, 0);
        const image = Reflect.apply(offscreenGetImageData, ctx, [0, 0, width, height]);
        farbleImage(image.data);
        ctx.putImageData(image, 0, 0);
        return Reflect.apply(target, copy, args);
      });
    }
  }

  // ---- WebGL pixel readback.
  if (on('readpixels')) {
    for (const proto of [globalThis.WebGLRenderingContext?.prototype, globalThis.WebGL2RenderingContext?.prototype]) {
      wrap(proto, 'readPixels', (target, self, args) => {
        Reflect.apply(target, self, args);
        const out = args[6];
        if (out instanceof Uint8Array || out instanceof Uint8ClampedArray) farbleImage(out);
      });
    }
  }

  // ---- Fonts: text measurements get a tiny, consistent offset per font+text,
  // so lists of installed fonts measured on a canvas don't hash the same everywhere.
  if (on('fonts')) {
    const metricsNoise = new WeakMap();
    const textHash = (text) => {
      let h = seed;
      for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
      return h >>> 0;
    };
    wrap(CanvasRenderingContext2D.prototype, 'measureText', (target, self, args) => {
      const metrics = Reflect.apply(target, self, args);
      metricsNoise.set(metrics, ((textHash(`${self.font}|${args[0]}`) % 1000) / 1000 - 0.5) * 0.02);
      return metrics;
    });
    if (globalThis.TextMetrics) {
      for (const name of ['width', 'actualBoundingBoxLeft', 'actualBoundingBoxRight']) {
        define(TextMetrics.prototype, name, (target, self) => Reflect.apply(target, self, []) + (metricsNoise.get(self) || 0));
      }
    }
  }

  // ---- Screen: report the window, not the monitor (size, position, docks and
  // menu bars all identify a setup). Like Firefox's and Brave's protections.
  if (on('screen')) {
    define(Screen.prototype, 'width', () => outerWidth);
    define(Screen.prototype, 'height', () => outerHeight);
    define(Screen.prototype, 'availWidth', () => outerWidth);
    define(Screen.prototype, 'availHeight', () => outerHeight);
    define(Screen.prototype, 'colorDepth', () => 24);
    define(Screen.prototype, 'pixelDepth', () => 24);
    for (const name of ['availLeft', 'availTop']) if (name in Screen.prototype) define(Screen.prototype, name, () => 0);
    for (const name of ['screenX', 'screenY', 'screenLeft', 'screenTop']) {
      const desc = Object.getOwnPropertyDescriptor(window, name);
      if (desc?.configurable) Object.defineProperty(window, name, { get: new Proxy(desc.get, { apply: () => 0 }), configurable: true, enumerable: desc.enumerable });
    }
  }

  // ---- Battery level and charge times are very distinctive: always "plugged in, full".
  if (on('battery')) {
    if (Navigator.prototype.getBattery) {
      wrap(Navigator.prototype, 'getBattery', async () => ({
        charging: true,
        chargingTime: 0,
        dischargingTime: Infinity,
        level: 1,
        onchargingchange: null,
        onchargingtimechange: null,
        ondischargingtimechange: null,
        onlevelchange: null,
        addEventListener() {},
        removeEventListener() {},
        dispatchEvent: () => true,
      }));
    }
  }

  // ---- Keyboard layout map reveals the user's language and layout.
  if (on('keyboard')) {
    if (globalThis.Keyboard?.prototype.getLayoutMap) {
      wrap(Keyboard.prototype, 'getLayoutMap', async () => {
        throw new DOMException('getLayoutMap() não está disponível', 'NotAllowedError');
      });
    }
  }

  // ---- Workers: preloads don't run inside them, so a worker would see the
  // real values (and the mismatch itself is a tell). Workers built from a Blob
  // (what fingerprinting scripts use) get the same protection prepended.
  // Workers loaded from a script URL are left alone: rewriting them would
  // change their location and break relative imports.
  if (on('workers')) {
    const workerShield = (workerSeed) => {
      const def = (proto, name, getter) => {
        const desc = Object.getOwnPropertyDescriptor(proto, name);
        if (!desc?.get || !desc.configurable) return;
        Object.defineProperty(proto, name, { get: new Proxy(desc.get, { apply: (t, s) => getter(t, s) }), configurable: true, enumerable: desc.enumerable });
      };
      const nav = self.WorkerNavigator?.prototype;
      if (nav) {
        def(nav, 'hardwareConcurrency', (t, s) => Math.max(2, Math.min(Reflect.apply(t, s, []) || 4, 2 + (workerSeed % 7))));
        if ('deviceMemory' in nav) def(nav, 'deviceMemory', () => 8);
      }
      const proto = self.OffscreenCanvasRenderingContext2D?.prototype;
      if (proto?.getImageData) {
        const noise = (i) => Math.imul((i + 1) ^ workerSeed, 2654435761) >>> 0;
        proto.getImageData = new Proxy(proto.getImageData, {
          apply(t, s, a) {
            const image = Reflect.apply(t, s, a);
            const px = image.data;
            for (let i = 0; i < px.length; i += 4) {
              const n = noise(i >> 2);
              if ((n & 15) === 0) px[i + (n >>> 4) % 3] ^= 1;
            }
            return image;
          },
        });
      }
    };
    const prelude = `(${workerShield})(${seed});\n`;
    const workerBlobs = new Map();
    const createObjectURL = URL.createObjectURL;
    wrap(URL, 'createObjectURL', (target, self, args) => {
      const url = Reflect.apply(target, self, args);
      if (args[0] instanceof Blob) workerBlobs.set(url, args[0]);
      return url;
    });
    wrap(URL, 'revokeObjectURL', (target, self, args) => {
      workerBlobs.delete(String(args[0]));
      return Reflect.apply(target, self, args);
    });
    for (const name of ['Worker', 'SharedWorker']) {
      const Original = globalThis[name];
      if (!Original) continue;
      globalThis[name] = new Proxy(Original, {
        construct(target, args, newTarget) {
          const blob = workerBlobs.get(String(args[0]));
          if (blob) {
            const shielded = Reflect.apply(createObjectURL, URL, [new Blob([prelude, blob], { type: 'text/javascript' })]);
            return Reflect.construct(target, [shielded, ...args.slice(1)], newTarget);
          }
          return Reflect.construct(target, args, newTarget);
        },
      });
    }
  }

  // ---- Hardware: report a plausible, per-site value instead of the exact one.
  if (on('hardware')) {
    define(Navigator.prototype, 'hardwareConcurrency', (target, self) => {
      const real = Reflect.apply(target, self, []) || 4;
      return Math.max(2, Math.min(real, 2 + (seed % 7)));
    });
    if ('deviceMemory' in Navigator.prototype) define(Navigator.prototype, 'deviceMemory', () => 8);
  }
}

if (/^https?:$/.test(location.protocol)) {
  let config = { enabled: false, seed: 0, skip: [] };
  try {
    config = ipcRenderer.sendSync('kitty:fingerprint', location.href) || config;
  } catch {
    // main process not ready: GPC only
  }
  try {
    contextBridge.executeInMainWorld({ func: protect, args: [config.seed, config.enabled, config.skip || []] });
  } catch {
    // frames that don't allow script execution
  }
}
