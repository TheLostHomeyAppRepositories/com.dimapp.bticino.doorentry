'use strict';

const Homey = require('homey');
const os = require('os');
const { BticinoAuthentication } = require('door-entry');

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
        this.error('tokenCreated handler error:', e && e.message);
      }
    };

    this._onCertificatesCreated = (info) => {
      try {
        if (!info || !info.certPEM || !info.privateKeyPem) {
          this.error('certificatesCreated event missing cert or key');
          return;
        }
        const bundle = { cert: info.certPEM, key: info.privateKeyPem };
        this.log('Saved certificate bundle to Homey settings.');
        this.homey.settings.set('certificates', bundle);
      } catch (e) {
        this.error('certificatesCreated handler error:', e && e.message);
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
      this.log('Auth handlers detached');
    }
  }

  _attachSipListenerHandlers() {
    if (!this.auth) return;

    // SIP listener event handlers
    this._onSipConnected = () => {
      this.log('SIP Listener connected to server');
    };

    this._onSipRegistered = () => {
      this.log('SIP Listener registered - listening for doorbell');
    };

    this._onSipInvite = async (callInfo) => {
      this.log('Doorbell rang!', callInfo);
      
      // Trigger the Flow card
      try {
        // Extract gatewayId from the 'from' field
        const fromMatch = callInfo.from.match(/@([0-9a-f-]+)\.bs\.iotleg\.com/);
        
        if (!fromMatch || !fromMatch[1]) {
          this.log('Could not extract gatewayId from SIP message');
          return;
        }
        
        const sipGatewayId = fromMatch[1];
        const savedGatewayId = this.homey.settings.get('gatewayId');
        
        // Filter: only trigger if gatewayId matches
        if (sipGatewayId !== savedGatewayId) {
          this.log(`Ignoring call from different gateway: ${sipGatewayId} (saved: ${savedGatewayId})`);
          return;
        }
        
        this.log('Gateway ID matched, triggering flow');
        
        // Get user's language and timezone from Homey settings
        const userLanguage = this.homey.i18n.getLanguage();
        const userTimezone = await this.homey.clock.getTimezone();
        this.log(`User language: ${userLanguage}, timezone: ${userTimezone}`);
        
        // Format timestamp using user's locale and timezone
        const formattedTime = new Date(callInfo.timestamp).toLocaleString(userLanguage, {
          timeZone: userTimezone,
          day: '2-digit',
          month: '2-digit',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit'
        });
        
        const tokens = {
          timestamp: formattedTime
        };
        
        await this._doorbellTrigger.trigger(tokens);
        this.log('Flow trigger fired successfully:', tokens);
      } catch (e) {
        this.error('Failed to trigger doorbell flow:', e && e.message);
      }
    };

    this._onSipDisconnected = () => {
      this.log('SIP Listener disconnected (will auto-reconnect if enabled)');
    };

    this._onSipError = (err) => {
      this.error('SIP Listener error:', err && err.message);
    };

    this._onSipCertificatesUpdated = (newCerts) => {
      this.log('SIP Listener certificates updated - listener restarted automatically');
    };

    this._onSipCertificateUpdateError = (err) => {
      this.error('SIP certificate update failed:', err && err.message);
    };

    // Attach handlers
    this.auth.on('sip:connected', this._onSipConnected);
    this.auth.on('sip:registered', this._onSipRegistered);
    this.auth.on('sip:invite', this._onSipInvite);
    this.auth.on('sip:disconnected', this._onSipDisconnected);
    this.auth.on('sip:error', this._onSipError);
    this.auth.on('sip:certificatesUpdated', this._onSipCertificatesUpdated);
    this.auth.on('sip:certificateUpdateError', this._onSipCertificateUpdateError);
  }

  _detachSipListenerHandlers() {
    if (!this.auth) return;

    if (this._onSipConnected) {
      this.auth.off('sip:connected', this._onSipConnected);
      this._onSipConnected = null;
    }
    if (this._onSipRegistered) {
      this.auth.off('sip:registered', this._onSipRegistered);
      this._onSipRegistered = null;
    }
    if (this._onSipInvite) {
      this.auth.off('sip:invite', this._onSipInvite);
      this._onSipInvite = null;
    }
    if (this._onSipDisconnected) {
      this.auth.off('sip:disconnected', this._onSipDisconnected);
      this._onSipDisconnected = null;
    }
    if (this._onSipError) {
      this.auth.off('sip:error', this._onSipError);
      this._onSipError = null;
    }
    if (this._onSipCertificatesUpdated) {
      this.auth.off('sip:certificatesUpdated', this._onSipCertificatesUpdated);
      this._onSipCertificatesUpdated = null;
    }
    if (this._onSipCertificateUpdateError) {
      this.auth.off('sip:certificateUpdateError', this._onSipCertificateUpdateError);
      this._onSipCertificateUpdateError = null;
    }

    this.log('SIP listener handlers detached');
  }

  /**
   * Check if all required credentials are available for SIP listener
   */
  _hasRequiredCredentials() {
    const token = this.homey.settings.get('token');
    const sipAccount = this.homey.settings.get('sip_account');
    const certs = this.homey.settings.get('certificates');

    if (!token || !sipAccount || !certs) {
      return false;
    }

    if (!certs.cert || !certs.key) {
      return false;
    }

    if (!sipAccount.sipUri || !sipAccount.sipPassword) {
      return false;
    }

    return true;
  }

  /**
   * Start the SIP listener for doorbell notifications
   */
  async startSipListener() {
    try {
      // Prevent multiple concurrent connection attempts
      if (this._sipConnecting) {
        this.log('SIP connection already in progress, waiting...');
        // Wait a bit and check again
        await new Promise(resolve => setTimeout(resolve, 1000));
        if (this.auth.isSipListenerConnected()) {
          return true;
        }
      }

      // Check if listener already exists
      if (this.auth.hasSipListener()) {
        this.log('SIP Listener already exists');
        
        // Check if it's connected
        if (this.auth.isSipListenerConnected()) {
          this.log('SIP Listener is already connected and registered');
          return true;
        } else {
          this.log('SIP Listener exists but not connected - reconnecting...');
          this._sipConnecting = true;
          try {
            const listener = this.auth.getSipListener();
            await listener.connect();
            await listener.register();
            return true;
          } finally {
            this._sipConnecting = false;
          }
        }
      }

      // Check credentials
      if (!this._hasRequiredCredentials()) {
        this.log('Missing credentials for SIP listener - skipping');
        return false;
      }

      const sipAccount = this.homey.settings.get('sip_account');
      const certs = this.homey.settings.get('certificates');

      this.log('Creating new SIP listener...');

      this._sipConnecting = true;
      try {
        // Create the listener using factory method
        const listener = this.auth.createSipListener(sipAccount, certs, {
          debug: DEBUG,
          keepAlive: true,
          autoReconnect: true
        });

        // Connect and register
        this.log('Starting SIP listener...');
        await listener.connect();
        await listener.register();

        this.log('SIP Listener started successfully');
        return true;
      } finally {
        this._sipConnecting = false;
      }

    } catch (e) {
      this.error('Failed to start SIP listener:', e && e.message);
      this._sipConnecting = false;
      return false;
    }
  }

  /**
   * Stop the SIP listener
   */
  async stopSipListener() {
    try {
      if (this.auth && this.auth.hasSipListener()) {
        const listener = this.auth.getSipListener();
        await listener.disconnect();
        this.log('SIP Listener stopped');
      }
    } catch (e) {
      this.error('Error stopping SIP listener:', e && e.message);
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

    // Register Flow trigger card
    this._doorbellTrigger = this.homey.flow.getTriggerCard('doorbell_rang');
    this.log('Flow trigger card registered: doorbell_rang');

    // Attach SIP listener event handlers
    this._attachSipListenerHandlers();

    // Try to start SIP listener if credentials are available
    // This handles app restart scenario
    if (this._hasRequiredCredentials()) {
      this.log('Credentials found, attempting to start SIP listener...');
      
      // Authenticate first to ensure tokens are valid
      try {
        const token = this.homey.settings.get('token');
        this.auth.setInitialTokens(token);
        await this.auth.authenticate();
        
        // Start the listener
        await this.startSipListener();
      } catch (e) {
        this.error('Failed to authenticate/start listener on init:', e && e.message);
      }
    }
  }

  /**
   * onUninit is called when the app is destroyed.
   * This is the place to clean up event listeners and resources.
   */
  async onUninit() {
    this.log('App is being destroyed, cleaning up...');
    
    // Stop SIP listener
    await this.stopSipListener();
    
    // Detach handlers
    this._detachSipListenerHandlers();
    this._detachAuthHandlers();
    
    // Shutdown auth
    if (this.auth) {
      await this.auth.shutdown();
    }
  }

};
