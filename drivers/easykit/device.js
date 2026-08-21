'use strict';

const Homey = require('homey');
const { openGate } = require('door-entry');

/**
 * BticinoGateDevice
 * Represents an EasyKit lock / gate device in Homey.
 * Provides the 'locked' capability with auto-close timer support and SIP actuation.
 * 
 * @class BticinoGateDevice
 * @extends {Homey.Device}
 */
module.exports = class BticinoGateDevice extends Homey.Device {

  /**
   * Check if all required credentials and settings are present.
   * @private
   * @returns {boolean} True if credentials are fully configured
   */
  _hasRequiredCredentials() {
    const token = this.homey.settings.get('token');
    const sipAccount = this.homey.settings.get('sip_account');
    const certs = this.homey.settings.get('certificates');
    const plantId = this.homey.settings.get('plantId');

    if (!token || !sipAccount || !certs || !plantId) {
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
   * Initialize the device, register capability listeners and ensure SIP listener is active.
   * @public
   * @async
   * @returns {Promise<void>}
   */
  async onInit() {
    this.log('BTicino gate device ready:', this.getName());

    // Check account status and set initial availability
    if (!this._hasRequiredCredentials()) {
      this.log('Device credentials missing, marking device as unavailable');
      await this.setUnavailable(this.homey.__('device.account_disconnected')).catch(this.error);
    } else {
      await this.setAvailable().catch(this.error);
    }

    // Initialize the 'locked' capability to true on device init
    await this.setCapabilityValue('locked', true).catch(this.error);

    // Register capability listener for 'locked' - when user toggles the lock
    // we use it as a trigger to open the gate via SIP.
    this.registerCapabilityListener('locked', async (value) => {
      this.log('Capability locked changed ->', value);

      // Only trigger openGate when locked is set to false (unlock/open)
      try {
        if (!this._hasRequiredCredentials()) {
          await this.setUnavailable(this.homey.__('device.account_disconnected')).catch(this.error);
          throw new Error('Account disconnected or missing credentials');
        }

        const gateId = (this.getData && this.getData().id) ? this.getData().id : this.getId();
        const plantId = this.homey.settings.get('plantId');
        const certs = this.homey.settings.get('certificates');
        const sipAccount = this.homey.settings.get('sip_account');

        if (!gateId) throw new Error('Missing gateId for this device');

        // Get debug setting from app
        const debugEnabled = this.homey.settings.get('debugEnabled') === true;

        this.log('Calling openGate for gateId=', gateId, 'plantId=', plantId);
        await openGate(gateId, plantId, certs.cert, certs.key, sipAccount, { debug: debugEnabled });
        this.log('openGate completed successfully');

        // Check autoClose setting and schedule capability reset if enabled
        const autoClose = this.getSetting('autoClose') || false;
        if (autoClose) {
          const delaySeconds = this.getSetting('autoCloseDelay') || 30;
          const delayMs = delaySeconds * 1000;
          this.log(`Auto-close enabled: will reset locked to true after ${delaySeconds} seconds`);

          // Clear any existing timeout to avoid multiple timers
          if (this._autoCloseTimeout) {
            clearTimeout(this._autoCloseTimeout);
          }

          // Schedule the reset of locked capability
          this._autoCloseTimeout = setTimeout(() => {
            this.log('Auto-close timeout elapsed, resetting locked to true');
            this.setCapabilityValue('locked', true)
              .catch((err) => this.error('Failed to reset locked capability during auto-close:', err));
            this._autoCloseTimeout = null;
          }, delayMs);
        }

      } catch (err) {
        this.error('openGate failed:', err && err.message ? err.message : err);
        // Revert capability to true since the action failed
        await this.setCapabilityValue('locked', true).catch(this.error);
      }
    });

    // Try to start SIP listener if not already running
    await this._ensureSipListenerStarted();
  }

  /**
   * Ensure the SIP listener is started.
   * This is called on device init and onAdded to make sure
   * the listener is running when at least one device exists.
   * @private
   * @async
   * @returns {Promise<void>}
   */
  async _ensureSipListenerStarted() {
    try {
      const app = this.homey.app;
      
      if (!app || !app.auth) {
        this.log('App or auth not ready yet');
        return;
      }

      // Check if credentials are present
      if (!this._hasRequiredCredentials()) {
        this.log('Missing credentials for SIP listener');
        return;
      }

      // Check if listener already exists and is connected
      if (app.auth.hasSipListener() && app.auth.isSipListenerConnected()) {
        this.log('SIP Listener already running');
        return;
      }

      // Try to start the listener
      this.log('Ensuring SIP listener is started...');
      const started = await app.startSipListener();
      
      if (started) {
        this.log('SIP Listener confirmed running');
      } else {
        this.log('SIP Listener could not be started');
      }

    } catch (e) {
      this.error('Error ensuring SIP listener:', e && e.message);
    }
  }

  /**
   * onAdded is called when the user adds the device, called just after pairing.
   * @public
   * @async
   * @returns {Promise<void>}
   */
  async onAdded() {
    this.log('BTicino gate device has been added:', this.getName());
    await this.setAvailable().catch(this.error);
    await this._ensureSipListenerStarted();
  }

  /**
   * onSettings is called when the user updates the device's settings.
   * @public
   * @async
   * @param {Object} context - Settings context
   * @param {Object} context.oldSettings - Previous settings values
   * @param {Object} context.newSettings - Updated settings values
   * @param {string[]} context.changedKeys - List of keys that changed
   * @returns {Promise<void>}
   */
  async onSettings({ oldSettings, newSettings, changedKeys }) {
    this.log('BTicino gate device settings changed:', changedKeys);
    await this._ensureSipListenerStarted();
  }

  /**
   * onDeleted is called when the user deletes the device.
   * @public
   * @async
   * @returns {Promise<void>}
   */
  async onDeleted() {
    this.log('Device deleted, cleaning up timers');
    if (this._autoCloseTimeout) {
      clearTimeout(this._autoCloseTimeout);
      this._autoCloseTimeout = null;
    }
  }

};
