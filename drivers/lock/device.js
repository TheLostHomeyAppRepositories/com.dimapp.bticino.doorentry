'use strict';

const Homey = require('homey');
const { openGate } = require('door-entry/lib/sip/BticinoControls');

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
