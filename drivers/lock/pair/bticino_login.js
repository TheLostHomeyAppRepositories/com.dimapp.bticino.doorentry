 'use strict';

(function () {
  // Minimal pairing view script: only keep what's needed for the simplified view.
  const openBtn = document.getElementById('open-link');

  let loginUrl = null;

  // Receive login URL from driver when available
  if (typeof Homey !== 'undefined' && Homey && typeof Homey.on === 'function') {
    Homey.on('dataLogin', function (data) {
      loginUrl = data && data.loginUrl ? data.loginUrl : null;
      if (openBtn) openBtn.disabled = !loginUrl;
    });
  }

  // Request driver to prepare login (if driver expects it)
  async function prepareLogin() {
    if (typeof Homey === 'undefined' || !Homey || typeof Homey.emit !== 'function') return;
    try {
      const response = await Homey.emit('prepare_login');
      if (response && response.url) {
        loginUrl = response.url;
        if (openBtn) openBtn.disabled = false;
      } else {
        if (openBtn) openBtn.disabled = true;
      }
    } catch (e) {
      if (openBtn) openBtn.disabled = true;
    }
  }

  if (openBtn) {
    openBtn.addEventListener('click', () => {
      if (!loginUrl) return;
      try {
        if (Homey && Homey.popup) Homey.popup(loginUrl);
        else window.open(loginUrl, '_blank', 'noopener');
      } catch (e) {
        window.open(loginUrl, '_blank', 'noopener');
      }
    });
  }

  // Kick off preparation so driver can create the login URL
  prepareLogin();
})();
