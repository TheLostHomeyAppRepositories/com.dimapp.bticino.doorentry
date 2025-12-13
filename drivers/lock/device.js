'use strict';

const Homey = require('homey');
const { openGate } = require('door-entry');

module.exports = class BticinoGateDevice extends Homey.Device {

  async onInit() {
    this.log('BTicino gate device ready:', this.getName());

    // Initialize the 'locked' capability to true on device init
    this.setCapabilityValue('locked', true).catch(this.error);

    // Register capability listener for 'locked' - when user toggles the lock
    // we use it as a trigger to open the gate via SIP.
    this.registerCapabilityListener('locked', async (value) => {
      this.log('Capability locked changed ->', value);

      // Only trigger openGate when locked is set to false (unlock/open)
      try {
        const gateId = (this.getData && this.getData().id) ? this.getData().id : this.getId();
        const plantId = this.homey.settings.get('plantId');
        const certs = this.homey.settings.get('certificates');
        const sipAccount = this.homey.settings.get('sip_account');

        if (!gateId) throw new Error('Missing gateId for this device');
        if (!plantId) throw new Error('Missing plantId in settings');
        if (!certs || !certs.cert || !certs.key) throw new Error('Missing certificates in settings');
        if (!sipAccount) throw new Error('Missing sip_account in settings');

        this.log('Calling openGate for gateId=', gateId, 'plantId=', plantId);
        await openGate(gateId, plantId, certs.cert, certs.key, sipAccount, { debug: false });
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
   */
  async _ensureSipListenerStarted() {
    try {
      const app = this.homey.app;
      
      if (!app || !app.auth) {
        this.log('App or auth not ready yet');
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
        this.log('SIP Listener could not be started (missing credentials?)');
      }

    } catch (e) {
      this.error('Error ensuring SIP listener:', e && e.message);
    }
  }

  /**
   * onAdded is called when the user adds the device, called just after pairing.
   */
  async onAdded() {
    this.log('BTicino gate device has been added:', this.getName());
    
    // Start the SIP listener now that device is added and credentials should be available
    await this._ensureSipListenerStarted();
  }

  /**
   * onSettings is called when the user updates the device's settings.
   */
  async onSettings({ oldSettings, newSettings, changedKeys }) {
    this.log('BTicino gate device settings changed:', changedKeys);

    // Try to start SIP listener if not already running
    await this._ensureSipListenerStarted();
  }

  /**
   * onDeleted is called when the user deleted the device.
   */
  async onDeleted() {
    this.log('Device deleted, cleaning up timers');
    // Clean up any pending auto-close timeout
    if (this._autoCloseTimeout) {
      clearTimeout(this._autoCloseTimeout);
      this._autoCloseTimeout = null;
    }
  }

};
