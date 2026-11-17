'use strict';

const Homey = require('homey');
const os = require('os');
const path = require('path');
const { BticinoAuthentication } = require('door-entry');

const DEFAULT_PROXY_PORT = 3123;

module.exports = class BticinoApp extends Homey.App {

  /**
   * Clear all saved authentication and connection settings.
   * @private
   * @returns {void}
   */
  _clearSettings() {
    this.homey.settings.unset('token');
    this.homey.settings.unset('sip_account');
    this.homey.settings.unset('certificates');
    this.homey.settings.unset('plantId');
    this.homey.settings.unset('gatewayId');
  }

  /**
   * Mark all EasyKit devices as unavailable with a localized message.
   * @public
   * @async
   * @param {string} [message] - Optional message describing why devices are unavailable.
   * @returns {Promise<void>}
   * @example
   * await app.setDevicesUnavailable('Account disconnected');
   */
  async setDevicesUnavailable(message) {
    try {
      let driver = null;
      try {
        driver = this.homey.drivers.getDriver('easykit');
      } catch (_) {
        // Driver may not be fully initialized during early bootstrap
      }
      if (driver && typeof driver.getDevices === 'function') {
        const unavailableMsg = message || this.homey.__('device.account_disconnected');
        const devices = driver.getDevices();
        this.log(`Marking ${devices.length} EasyKit device(s) as unavailable`);
        for (const device of devices) {
          await device.setUnavailable(unavailableMsg).catch((err) => {
            this.error(`Failed to set device ${device.getName()} unavailable:`, err && err.message);
          });
        }
      }
    } catch (e) {
      this.error('Error in setDevicesUnavailable:', e && e.message);
    }
  }

  /**
   * Mark all EasyKit devices as available.
   * @public
   * @async
   * @returns {Promise<void>}
   * @example
   * await app.setDevicesAvailable();
   */
  async setDevicesAvailable() {
    try {
      let driver = null;
      try {
        driver = this.homey.drivers.getDriver('easykit');
      } catch (_) {
        // Driver may not be fully initialized during early bootstrap
      }
      if (driver && typeof driver.getDevices === 'function') {
        const devices = driver.getDevices();
        this.log(`Marking ${devices.length} EasyKit device(s) as available`);
        for (const device of devices) {
          await device.setAvailable().catch((err) => {
            this.error(`Failed to set device ${device.getName()} available:`, err && err.message);
          });
        }
      }
    } catch (e) {
      this.error('Error in setDevicesAvailable:', e && e.message);
    }
  }

  /**
   * Disconnect account: stop SIP listener, clear credentials, shutdown auth, and mark devices unavailable.
   * @public
   * @async
   * @returns {Promise<{success: boolean}>}
   * @example
   * await app.disconnectAccount();
   */
  async disconnectAccount() {
    this.log('Initiating account disconnect...');
    try {
      // Stop SIP listener
      await this.stopSipListener();

      // Detach handlers from current auth instance
      this._detachSipListenerHandlers();
      this._detachAuthHandlers();

      // Shutdown existing auth instance
      if (this.auth) {
        await this.auth.shutdown();
      }

      // Clear saved settings
      this._clearSettings();

      // Recreate a clean auth instance for subsequent logins
      this.auth = new BticinoAuthentication({
        autoOpenBrowser: false,
        debug: this._getDebugEnabled(),
        proxyHost: this._getLocalIpAddress(),
        proxyPort: DEFAULT_PROXY_PORT,
        successPage: this._generateCloseWindowHtmlContent(this.homey.__('pair.success_message'), 'https://homey.app/img/heading/homey@2x.webp')
      });

      this._attachAuthHandlers(this.auth);
      this._attachSipListenerHandlers();

      // Mark all existing devices as unavailable (without deleting them)
      await this.setDevicesUnavailable(this.homey.__('device.account_disconnected'));

      this.log('Account disconnected successfully and devices marked unavailable');
      return { success: true };
    } catch (e) {
      this.error('Failed to disconnect account:', e && e.message);
      throw e;
    }
  }

  /**
   * Check if the application is currently authenticated and connected to the BTicino SIP service.
   *
   * @public
   * @returns {boolean} True if the SIP listener is active, connected, and registered; false otherwise.
   * @example
   * const isConnected = this.isServiceConnected();
   */
  isServiceConnected() {
    try {
      if (!this.auth || typeof this.auth.isSipListenerConnected !== 'function') {
        return false;
      }
      return this.auth.isSipListenerConnected();
    } catch (e) {
      this.error('Error checking isServiceConnected:', e && e.message);
      return false;
    }
  }

  /**
   * Triggers the doorbell_rang Flow card immediately when someone rings the doorbell.
   * Provides the localized timestamp token without snapshot delay.
   *
   * @public
   * @async
   * @param {Object} [options={}] - Options object.
   * @param {Object} [options.callInfo=null] - Optional SIP call information.
   * @returns {Promise<boolean>} True if trigger fired successfully.
   *
   * @example
   * await app.triggerDoorbellRang();
   */
  async triggerDoorbellRang({ callInfo = null } = {}) {
    try {
      this.log('[BticinoApp:triggerDoorbellRang] Initiating doorbell_rang flow trigger sequence...');

      // Format timestamp using user's locale and timezone
      const userLanguage = this.homey.i18n.getLanguage();
      const userTimezone = await this.homey.clock.getTimezone();
      const callTime = callInfo && callInfo.timestamp ? new Date(callInfo.timestamp) : new Date();
      const formattedTime = callTime.toLocaleString(userLanguage, {
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

      if (this._doorbellTrigger) {
        this.log(`[BticinoApp:triggerDoorbellRang] Flow trigger fired: doorbell_rang at ${formattedTime}`);
        this._doorbellTrigger.trigger(tokens)
          .then(() => {
            this.log(`[BticinoApp:triggerDoorbellRang] Downstream Flow execution completed for doorbell_rang (${formattedTime})`);
          })
          .catch((err) => {
            this.error('[BticinoApp:triggerDoorbellRang] Error during doorbell_rang Flow execution:', err && err.message ? err.message : err);
          });
        return true;
      } else {
        this.error('[BticinoApp:triggerDoorbellRang] _doorbellTrigger card not initialized');
        return false;
      }
    } catch (e) {
      this.error('[BticinoApp:triggerDoorbellRang] Failed to trigger doorbell flow:', e && e.message ? e.message : e);
      return false;
    }
  }

  /**
   * Finds the primary outdoor camera device (channel index 1, or first available camera).
   *
   * @private
   * @returns {Homey.Device|null} The resolved camera device or null.
   *
   * @example
   * const cam = this._findPrimaryOutdoorCamera();
   */
  _findPrimaryOutdoorCamera() {
    let driver = null;
    try {
      driver = this.homey.drivers.getDriver('easykit');
    } catch (_) {}

    if (driver && typeof driver.getDevices === 'function') {
      const devices = driver.getDevices();
      return devices.find((d) => {
        if (typeof d.getClass !== 'function' || d.getClass() !== 'camera') return false;
        const camIdx = Number(d.getSetting('cameraIndex') || d.getStoreValue('cameraIndex') || 1);
        return camIdx === 1;
      }) || devices.find((d) => typeof d.getClass === 'function' && d.getClass() === 'camera') || null;
    }
    return null;
  }

  /**
   * Triggers the doorbell_call_missed Flow card when a doorbell ring was not answered by any device.
   * Emits a clean event providing strictly the localized timestamp token.
   *
   * @public
   * @async
   * @param {Object} [options={}] - Options object.
   * @param {Object} [options.callInfo=null] - Optional SIP call information.
   * @returns {Promise<boolean>} True if trigger fired successfully.
   *
   * @example
   * await app.triggerDoorbellCallMissed();
   */
  async triggerDoorbellCallMissed({ callInfo = null } = {}) {
    try {
      this.log('[BticinoApp:triggerDoorbellCallMissed] Initiating doorbell_call_missed flow trigger sequence...');

      const userLanguage = this.homey.i18n.getLanguage();
      const userTimezone = await this.homey.clock.getTimezone();
      const callTime = callInfo && callInfo.timestamp ? new Date(callInfo.timestamp) : new Date();
      const formattedTime = callTime.toLocaleString(userLanguage, {
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

      if (this._doorbellCallMissedTrigger) {
        this.log(`[BticinoApp:triggerDoorbellCallMissed] Flow trigger fired: doorbell_call_missed at ${formattedTime}`);
        this._doorbellCallMissedTrigger.trigger(tokens)
          .then(() => {
            this.log(`[BticinoApp:triggerDoorbellCallMissed] Downstream Flow execution completed for doorbell_call_missed (${formattedTime})`);
          })
          .catch((err) => {
            this.error('[BticinoApp:triggerDoorbellCallMissed] Error during doorbell_call_missed Flow execution:', err && err.message ? err.message : err);
          });
        return true;
      } else {
        this.error('[BticinoApp:triggerDoorbellCallMissed] _doorbellCallMissedTrigger card not initialized');
        return false;
      }
    } catch (e) {
      this.error('[BticinoApp:triggerDoorbellCallMissed] Failed to trigger doorbell_call_missed flow:', e && e.message ? e.message : e);
      return false;
    }
  }

  /**
   * Simulates a missed doorbell call for test and diagnostic purposes.
   * Emits 'sip:callMissed' on the authentication orchestrator or directly triggers doorbell_call_missed.
   *
   * @public
   * @async
   * @param {Object} [options={}] - Simulation options.
   * @param {string} [options.reason='simulation'] - Reason descriptor for the simulated missed call.
   * @returns {Promise<boolean>} True if the simulation event was triggered successfully.
   *
   * @example
   * await app.simulateMissedCall({ reason: 'diagnostic_test' });
   */
  async simulateMissedCall({ reason = 'simulation' } = {}) {
    this.log(`[BticinoApp:simulateMissedCall] Emitting sip:callMissed event to simulate missed doorbell call (reason: ${reason})...`);
    const timestamp = new Date().toISOString();
    if (this.auth && typeof this.auth.emit === 'function') {
      this.auth.emit('sip:callMissed', {
        reason,
        timestamp
      });
      return true;
    }

    return this.triggerDoorbellCallMissed({
      callInfo: { reason, timestamp }
    });
  }

  _getDebugEnabled() {
    const debugEnabled = this.homey.settings.get('debugEnabled');
    return debugEnabled === true || debugEnabled === 'true';
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
      this.log('[SIP] TLS connection established with server');
    };

    this._onSipRegistered = async () => {
      this.log('[SIP] REGISTER successful - listening for doorbell notifications');
      try {
        if (this._serviceConnectedTrigger) {
          const userLanguage = this.homey.i18n.getLanguage();
          const userTimezone = await this.homey.clock.getTimezone();
          const formattedTime = new Date().toLocaleString(userLanguage, {
            timeZone: userTimezone,
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
          });
          await this._serviceConnectedTrigger.trigger({ timestamp: formattedTime });
          this.log('[Flow] Trigger fired: service_connected at', formattedTime);
        }
      } catch (e) {
        this.error('[Flow] Failed to trigger service_connected flow:', e && e.message);
      }
    };

    this._onSipKeepalive = () => {
      if (this._getDebugEnabled()) {
        this.log('[SIP] Keep-alive confirmed by server');
      }
    };

    this._onSipInvite = async (callInfo) => {
      this.log(`[BticinoApp:_onSipInvite] Incoming INVITE received (doorbell ringing). From: ${callInfo && callInfo.from ? callInfo.from : 'unknown'}`);
      if (callInfo) {
        this.log(`[BticinoApp:_onSipInvite] Call-ID: ${callInfo.callId || 'unknown'}`);
        if (callInfo.body) {
          this.log(`[BticinoApp:_onSipInvite] Incoming INVITE SDP body (${callInfo.body.length} chars):\n${callInfo.body}`);
        } else {
          this.log('[BticinoApp:_onSipInvite] Incoming INVITE contains no SDP body');
        }
      }
      
      try {
        // Extract gatewayId from 'from' field if present and match with saved gatewayId
        const fromMatch = callInfo && callInfo.from ? callInfo.from.match(/@([0-9a-f-]+)\.bs\.iotleg\.com/i) : null;
        const sipGatewayId = fromMatch ? fromMatch[1].toLowerCase() : null;
        const savedGatewayId = (this.homey.settings.get('gatewayId') || '').toLowerCase();
        
        // Filter: only ignore if both are explicitly present and do not match
        if (sipGatewayId && savedGatewayId && sipGatewayId !== savedGatewayId) {
          this.log(`[BticinoApp:_onSipInvite] Ignoring call from different gateway: ${sipGatewayId} (saved: ${savedGatewayId})`);
          return;
        }

        await this.triggerDoorbellRang({ callInfo });
      } catch (e) {
        this.error('[BticinoApp:_onSipInvite] Failed to process doorbell SIP invite:', e && e.message ? e.message : e);
      }
    };

    this._onSipDisconnected = async () => {
      this.log('[SIP] Connection lost (auto-reconnect active)');
      try {
        if (this._serviceDisconnectedTrigger) {
          const userLanguage = this.homey.i18n.getLanguage();
          const userTimezone = await this.homey.clock.getTimezone();
          const formattedTime = new Date().toLocaleString(userLanguage, {
            timeZone: userTimezone,
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
          });
          await this._serviceDisconnectedTrigger.trigger({ timestamp: formattedTime });
          this.log('[Flow] Trigger fired: service_disconnected at', formattedTime);
        }
      } catch (e) {
        this.error('[Flow] Failed to trigger service_disconnected flow:', e && e.message);
      }
    };

    this._onSipError = (err) => {
      this.error('[SIP] Socket error:', err && err.message ? err.message : err);
    };

    this._onSipCertificatesUpdated = (newCerts) => {
      this.log('[SIP] Certificates updated - listener restarted successfully');
    };

    this._onSipCertificateUpdateError = (err) => {
      this.error('[SIP] Certificate update failed:', err && err.message ? err.message : err);
    };

    this._onSipCallMissed = async (callInfo) => {
      this.log(`[BticinoApp:_onSipCallMissed] Doorbell call was missed (unanswered). Reason: ${callInfo && callInfo.reason ? callInfo.reason : 'timeout'}`);
      try {
        await this.triggerDoorbellCallMissed({ callInfo });
      } catch (e) {
        this.error('[BticinoApp:_onSipCallMissed] Error processing missed call flow:', e && e.message ? e.message : e);
      }
    };

    this._onSipCallAnswered = (callInfo) => {
      this.log(`[BticinoApp:_onSipCallAnswered] Doorbell call was answered on another device. Reason: ${callInfo && callInfo.reason ? callInfo.reason : 'cause=200'}`);
    };

    this._onSipCallEnded = (info) => {
      this.log(`[BticinoApp:_onSipCallEnded] SIP call ended by server (${info && info.method ? info.method : 'unknown'}). Gateway 2-wire bus released`);
    };

    // Attach handlers
    this.auth.on('sip:connected', this._onSipConnected);
    this.auth.on('sip:registered', this._onSipRegistered);
    this.auth.on('sip:keepalive', this._onSipKeepalive);
    this.auth.on('sip:invite', this._onSipInvite);
    this.auth.on('sip:callMissed', this._onSipCallMissed);
    this.auth.on('sip:callAnswered', this._onSipCallAnswered);
    this.auth.on('sip:disconnected', this._onSipDisconnected);
    this.auth.on('sip:error', this._onSipError);
    this.auth.on('sip:certificatesUpdated', this._onSipCertificatesUpdated);
    this.auth.on('sip:certificateUpdateError', this._onSipCertificateUpdateError);
    this.auth.on('sip:callEnded', this._onSipCallEnded);
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
    if (this._onSipKeepalive) {
      this.auth.off('sip:keepalive', this._onSipKeepalive);
      this._onSipKeepalive = null;
    }
    if (this._onSipInvite) {
      this.auth.off('sip:invite', this._onSipInvite);
      this._onSipInvite = null;
    }
    if (this._onSipCallMissed) {
      this.auth.off('sip:callMissed', this._onSipCallMissed);
      this._onSipCallMissed = null;
    }
    if (this._onSipCallAnswered) {
      this.auth.off('sip:callAnswered', this._onSipCallAnswered);
      this._onSipCallAnswered = null;
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
    if (this._onSipCallEnded) {
      this.auth.off('sip:callEnded', this._onSipCallEnded);
      this._onSipCallEnded = null;
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
   * @param {Object} [options] - Options for starting the listener
   * @param {boolean} [options.forceRestart=false] - Force stopping and recreating listener with new credentials
   * @returns {Promise<boolean>}
   */
  async startSipListener({ forceRestart = false } = {}) {
    try {
      if (forceRestart) {
        this.log('Force restart requested: stopping existing SIP listener...');
        await this.stopSipListener();
      }

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
      if (!forceRestart && this.auth.hasSipListener()) {
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
          debug: this._getDebugEnabled(),
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
      debug: this._getDebugEnabled(),
      proxyHost: this._getLocalIpAddress(),
      proxyPort: DEFAULT_PROXY_PORT,
      successPage: this._generateCloseWindowHtmlContent(this.homey.__("pair.success_message"), 'https://homey.app/img/heading/homey@2x.webp')
    });

    this._attachAuthHandlers(this.auth);

    // Register Flow trigger cards
    this._doorbellTrigger = this.homey.flow.getTriggerCard('doorbell_rang');
    this._doorbellCallMissedTrigger = this.homey.flow.getTriggerCard('doorbell_call_missed');
    this._serviceConnectedTrigger = this.homey.flow.getTriggerCard('service_connected');
    this._serviceDisconnectedTrigger = this.homey.flow.getTriggerCard('service_disconnected');
    this.log('Flow trigger cards registered: doorbell_rang, doorbell_call_missed, service_connected, service_disconnected');

    // Register Flow condition cards
    this._serviceConnectedCondition = this.homey.flow.getConditionCard('service_is_connected');
    this._serviceConnectedCondition.registerRunListener(async (args, state) => {
      const isConnected = this.isServiceConnected();
      this.log(`[Flow] Condition checked: service_is_connected -> ${isConnected}`);
      return isConnected;
    });
    this.log('Flow condition cards registered: service_is_connected');

    // Register Flow action cards
    this._takeSnapshotAction = this.homey.flow.getActionCard('take_snapshot');
    this._takeSnapshotAction.registerRunListener(async (args) => {
      this.log(`[BticinoApp:takeSnapshotAction] Action take_snapshot executing for device: ${args && args.device ? args.device.getName() : 'unknown'}`);
      if (!args || !args.device) {
        throw new Error(this.homey.__('errors.device_not_found') || 'No device provided');
      }
      if (typeof args.device.getClass !== 'function' || args.device.getClass() !== 'camera') {
        throw new Error(this.homey.__('errors.device_not_camera') || 'Selected device is not a camera');
      }
      if (typeof args.device.captureSnapshot !== 'function') {
        throw new Error(this.homey.__('errors.snapshot_unsupported') || 'Device does not support snapshot capture');
      }

      const updatedSlotImage = await args.device.captureSnapshot({ forceFresh: true });
      const cameraSlotImage = (typeof args.device.getCameraImage === 'function' && args.device.getCameraImage()) || updatedSlotImage;
      if (!cameraSlotImage) {
        throw new Error(this.homey.__('errors.snapshot_empty') || 'Camera image slot not available');
      }

      this.log(`[BticinoApp:takeSnapshotAction] Snapshot captured and camera image slot (${cameraSlotImage.id || 'default'}) updated for ${args.device.getName()}`);
      return { snapshot: cameraSlotImage };
    });

    // Register optional test action card if present in manifest (disabled in production release)
    try {
      this._simulateMissedCallAction = this.homey.flow.getActionCard('simulate_missed_call');
      if (this._simulateMissedCallAction) {
        this._simulateMissedCallAction.registerRunListener(async () => {
          return this.simulateMissedCall({ reason: 'simulation' });
        });
        this.log('[BticinoApp:onInit] Test flow action card registered: simulate_missed_call');
      }
    } catch (_) {
      // Flow card not defined in manifest - test action hidden from end users in production
    }

    this.log('[BticinoApp:onInit] Flow action cards initialized');

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
        await this.setDevicesAvailable();
      } catch (e) {
        this.error('Failed to authenticate/start listener on init:', e && e.message);
        await this.setDevicesUnavailable(this.homey.__("device.account_disconnected"));
      }
    } else {
      this.log('Missing credentials on init - marking devices unavailable');
      await this.setDevicesUnavailable(this.homey.__("device.account_disconnected"));
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
