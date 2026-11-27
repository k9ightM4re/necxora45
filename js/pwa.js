/* NEXORA PWA registration, install prompt, and update handling. */
function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { scope: '/' })
      .then((registration) => {
        registration.addEventListener('updatefound', () => {
          const installing = registration.installing;
          if (!installing) return;
          installing.addEventListener('statechange', () => {
            if (installing.state === 'installed' && navigator.serviceWorker.controller) showUpdateToast();
          });
        });
      })
      .catch(() => {});
  });
}

function showUpdateToast() {
  if (document.getElementById('nx-update-toast')) return;
  const toast = document.createElement('div');
  toast.id = 'nx-update-toast';
  toast.className = 'nx-update-toast';
  const text = document.createElement('span');
  text.textContent = 'A new NEXORA version is ready.';
  const reload = document.createElement('button');
  reload.type = 'button';
  reload.textContent = 'Reload';
  reload.addEventListener('click', () => window.location.reload());
  toast.append(text, reload);
  document.body.appendChild(toast);
}

function initInstallPrompt() {
  let deferred = null;
  const button = document.createElement('button');
  button.type = 'button';
  button.id = 'nx-install-btn';
  button.className = 'nx-install-btn';
  button.textContent = 'Install NEXORA';

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferred = event;
    document.body.appendChild(button);
    requestAnimationFrame(() => button.classList.add('is-visible'));
  });

  window.addEventListener('appinstalled', () => {
    deferred = null;
    button.classList.remove('is-visible');
  });

  button.addEventListener('click', async () => {
    if (!deferred) return;
    deferred.prompt();
    await deferred.userChoice.catch(() => {});
    deferred = null;
    button.classList.remove('is-visible');
  });

  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
  const standalone = navigator.standalone === true;
  if (isIOS && !standalone && !sessionStorage.getItem('nx-ios-hint-dismissed')) {
    const hint = document.createElement('div');
    hint.className = 'nx-ios-hint';
    const text = document.createElement('span');
    text.textContent = 'Install NEXORA: tap Share, then Add to Home Screen.';
    const close = document.createElement('button');
    close.type = 'button';
    close.setAttribute('aria-label', 'Dismiss install hint');
    close.textContent = '×';
    close.addEventListener('click', () => {
      hint.remove();
      sessionStorage.setItem('nx-ios-hint-dismissed', '1');
    });
    hint.append(text, close);
    document.body.appendChild(hint);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  registerServiceWorker();
  initInstallPrompt();
});
