'use strict';

const Homey = require('homey');
const os = require('os');
const BticinoAuthentication = require('door-entry/lib/auth/BticinoAuthentication');

const DEFAULT_PROXY_PORT = 3123;
const DEBUG = false;

module.exports = class BticinoApp extends Homey.App {

  _clearSettings() {
    this.homey.settings.unset('token');
    this.homey.settings.unset('sip_account');
    this.homey.settings.unset('certificates');
    this.homey.settings.unset('plantId');
    this.homey.settings.unset('gatewayId');
  }

  _getLocalIpAddress() {
    const ifaces = os.networkInterfaces();
    for (const name of Object.keys(ifaces)) {
      for (const iface of ifaces[name]) {
        if (iface.family === 'IPv4' && !iface.internal) return iface.address;
      }
    }
    return null;
  }

  _attachAuthHandlers(auth) {
    // Store bound references for later removal
    this._onTokenCreated = (token, meta) => {
      try {
        this.log('Tokens received and saved in Homey settings. Access (short) =', token.b2cAccessToken.slice(0, 40), 'meta=', meta);
        this.homey.settings.set('token', token);
      } catch (e) {
        this.error('❌ tokenCreated handler error:', e && e.message);
      }
    };

    this._onCertificatesCreated = (info) => {
      try {
        if (!info || !info.certPEM || !info.privateKeyPem) {
          this.error('❌ certificatesCreated event missing cert or key');
          return;
        }
        const bundle = { cert: info.certPEM, key: info.privateKeyPem };
        this.log('ℹ️ Saved certificate bundle to Homey settings.');
        this.homey.settings.set('certificates', bundle);
      } catch (e) {
        this.error('❌ certificatesCreated handler error:', e && e.message);
      }
    };

    auth.on('tokenCreated', this._onTokenCreated);
    auth.on('certificatesCreated', this._onCertificatesCreated);
  }

  _detachAuthHandlers() {
    if (this.auth) {
      if (this._onTokenCreated) {
        this.auth.off('tokenCreated', this._onTokenCreated);
        this._onTokenCreated = null;
      }
      if (this._onCertificatesCreated) {
        this.auth.off('certificatesCreated', this._onCertificatesCreated);
        this._onCertificatesCreated = null;
      }
      this.log('ℹ️ Auth handlers detached');
    }
  }

  _generateCloseWindowHtmlContent(message, imageUrl) {
    const imageHtml = imageUrl
      ? `
    <div class="image-container">
        <img src="${imageUrl}" alt="Immagine personalizzata">
    </div>`
      : '';

    return `
      <!DOCTYPE html>
      <html lang="it">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Messaggio personalizzato</title>
            <style>
                body {
                    font-family: Arial, sans-serif;
                    display: flex;
                    flex-direction: column;
                    justify-content: center;
                    align-items: center;
                    height: 100vh;
                    margin: 0;
                    background-color: #f0f0f0;
                }
                .image-container {
                    margin-bottom: 20px;
                }
                img {
                    max-width: 100%;
                    height: auto;
                }
                .message {
                    font-size: 24px;
                    color: #333;
                    text-align: center;
                }
            </style>
        </head>
        <body>
            ${imageHtml}
            <div class="message">
                ${message}
            </div>
        </body>
      </html>
    `;
  }


  /**
   * onInit is called when the app is initialized.
   */
  async onInit() {
    this.log('MyApp has been initialized');

    //this._clearSettings();

    this.auth = new BticinoAuthentication({
      autoOpenBrowser: false,
      debug: DEBUG,
      proxyHost: this._getLocalIpAddress(),
      proxyPort: DEFAULT_PROXY_PORT,
      successPage: this._generateCloseWindowHtmlContent(this.homey.__("pair.success_message"), 'https://homey.app/img/heading/homey@2x.webp')
    });

    this._attachAuthHandlers(this.auth);
  }

  /**
   * onUninit is called when the app is destroyed.
   * This is the place to clean up event listeners and resources.
   */
  async onUninit() {
    this.log('ℹ️ App is being destroyed, cleaning up...');
    this._detachAuthHandlers();
  }

};
