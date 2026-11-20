const isDev = typeof __DEV__ !== 'undefined' && __DEV__;

export function registerServiceWorker() {
  if (isDev || !('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((error) => {
      console.warn('Service Worker 注册失败：', error);
    });
  });
}

export function createInstaller() {
  const listeners = new Set();
  let deferredPrompt = null;

  const isStandalone = () =>
    window.matchMedia('(display-mode: standalone)').matches ||
    window.matchMedia('(display-mode: fullscreen)').matches ||
    window.navigator.standalone === true;

  const isIOS =
    /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  const notify = () => listeners.forEach((fn) => fn(installer));

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredPrompt = event;
    notify();
  });

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    notify();
  });

  const installer = {
    get canPrompt() {
      return Boolean(deferredPrompt);
    },
    get isStandalone() {
      return isStandalone();
    },
    get isIOS() {
      return isIOS;
    },
    /** @param {(installer: object) => void} fn */
    subscribe(fn) {
      listeners.add(fn);
      fn(installer);
      return () => listeners.delete(fn);
    },
    async install() {
      if (!deferredPrompt) return 'unavailable';
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      deferredPrompt = null;
      notify();
      return outcome;
    },
  };

  return installer;
}
