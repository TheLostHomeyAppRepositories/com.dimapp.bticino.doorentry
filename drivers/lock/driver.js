'use strict';

const Homey = require('homey');


module.exports = class BticinoLockDriver extends Homey.Driver {

  // add this private method to the class (place it outside/after onPair):
  _attachAuthHandlers(auth, session) {
    // Store bound references for later removal
    this._onDeviceRegistered = async (payload) => {
      try {
        if (payload && payload.result) {
          this.log('ℹ️ Sip Account data saved to Homey settings');
          this.homey.settings.set('sip_account', payload.result);
        } else {
          this.error('❌ deviceRegistered event missing result payload');
        }
      } catch (e) {
        this.error('❌  deviceRegistered handler error:', e && e.message);
      }
    };

    this._onLoginUrlCreated = async ({ state, loginUrl: newLoginUrl }) => {
      try {
        this.log('ℹ️  Login URL (open manually):', newLoginUrl);
        try {
          await session.emit('dataLogin', { loginUrl: newLoginUrl });
        } catch (e) {
          this.warn('⚠️ emit dataLogin error (might be view not open yet):', e && e.message);
        }
      } catch (e) {
        this.error('❌ loginUrl handler error:', e && e.message);
      }
    };

    auth.on('deviceRegistered', this._onDeviceRegistered);
    auth.on('loginUrlCreated', this._onLoginUrlCreated);
  }

  _detachAuthHandlers() {
    if (this.auth) {
      if (this._onDeviceRegistered) {
        this.auth.off('deviceRegistered', this._onDeviceRegistered);
        this._onDeviceRegistered = null;
      }
      if (this._onLoginUrlCreated) {
        this.auth.off('loginUrlCreated', this._onLoginUrlCreated);
        this._onLoginUrlCreated = null;
      }
      this.log('ℹ️ Pairing auth handlers detached');
    }
  }


  async _hasSavedAccountData() {
    // Check that required Homey.settings keys are present and non-empty.
    try {
      const required = ['token', 'sip_account', 'certificates', 'plantId', 'gatewayId'];
      for (const key of required) {
        // Homey.settings.get may be synchronous or return a promise; await is safe in both cases
        const val = await this.homey.settings.get(key);
        if (val === undefined || val === null) {
          this.log(`_hasSavedAccountData: missing setting ${key}`);
          return false;
        }
        // Treat empty string / empty object with no keys as missing
        if (typeof val === 'string' && val.trim() === '') {
          this.log(`_hasSavedAccountData: empty string for ${key}`);
          return false;
        }
        if (typeof val === 'object') {
          // Empty object/array considered missing
          if (Object.keys(val).length === 0) {
            this.log(`_hasSavedAccountData: empty object for ${key}`);
            return false;
          }
        }
      }
      return true;
    } catch (e) {
      this.error('❌ _hasSavedAccountData failed:', e && e.message ? e.message : e);
      return false;
    }
  }

  async onInit() {
    this.log('BTicino lock driver ready');

    this.auth = this.homey.app.auth;
  }

  async onPair(session) {
    this.log('Starting pairing session');

    let plantId = null;

    // API client usable across pairing steps
    const api = this.auth.createApiClient();

    this._attachAuthHandlers(this.auth, session);

    // Cleanup when pairing session ends (success, cancel, or error)
    session.setHandler('disconnect', async () => {
      this.log('ℹ️ Pairing session disconnected, cleaning up...');
      this._detachAuthHandlers();
    });

    // Handle selection emitted by the frontend when a radio is pressed
    session.setHandler('optionSelected', async (data) => {
      try {
        if (data && data.id) {
          plantId = String(data.id);
          this.log('Plant selected during pairing:', plantId);
          return { ok: true };
        }
        return { ok: false };
      } catch (e) {
        this.error('❌ Error handling optionSelected:', e && e.message ? e.message : e);
        return { ok: false };
      }
    });


    // Previously there was a 'confirmOption' handler here; the frontend now calls
    // Homey.showView('register_device') and the driver listens for 'optionSelected'.
    // Removed unused confirmOption handler to avoid duplicate/unused code.

    session.setHandler('showView', async (viewId) => {
      this.log('Pair view requested:', viewId);

      if (viewId === 'check_settings') {
        this.log('Checking for saved account data...');
        const hasData = await this._hasSavedAccountData();
        if (hasData) {
          this.log('Saved account data found; skipping login and plant selection.');
          // proceed directly to register_device view
          try {
            const token = this.homey.settings.get('token');
            this.auth.setInitialTokens(token);

            const result = await this.auth.authenticate();
            if (result && result.tokens) {
              this.log('✅ Token obtained from cache');
              this.log('Access token expires at', result.tokens.expiresAt);

              plantId = this.homey.settings.get('plantId');

              await session.showView('list_lock_devices');
            } else {
              this.log('ℹ️  authenticate() returned with no tokens or from cache.');
            }

          } catch (e) {
            this.error('Could not show register_device view via session.showView():', e && e.message);
          }
        } else {
          this.log('No saved account data; proceeding with normal pairing flow.');
          // proceed to login view
          try {
            await session.showView('bticino_login');
          } catch (e) {
            this.warn('Could not show bticino_login view via session.showView():', e && e.message);
          }
        }
      }

      if (viewId === "bticino_login") {
        this.log('Showing login view to user');

        try {
          const result = await this.auth.authenticate();
          if (result && result.tokens) {
            this.log('✅ Token exchange completed');
            this.log('Access token expires at', result.tokens.expiresAt);

            await session.showView('choose_plant');
          } else {
            this.log('ℹ️  authenticate() returned with no tokens or from cache.');
          }
        } catch (e) {
          this.error('❌ authenticate() failed:', e && e.message ? e.message : e);
        }
      }

      if (viewId === "choose_plant") {
        this.log('Showing plants view to user');

        const api = this.auth.createApiClient();

        // Fetch and list plants from API
        let fetchedPlants = null;
        try {
          this.log('ℹ️  Fetching plants from API...');
          const plants = await api.getPlants();
          fetchedPlants = plants;

          if (!Array.isArray(plants) || plants.length === 0) {
            this.log('ℹ️  No plants returned from the API.');
            return [];
          } else {
            this.log('✅ List of plants found:');
            const seen = new Set();
            const mapped = [];
            for (const p of plants) {
              if (!p || typeof p !== 'object') continue;
              const id = p.id || p.plantId || p._id || null;
              const name = p.name || p.displayName || null;
              if (!id) continue;
              const sid = String(id);
              if (seen.has(sid)) continue;
              seen.add(sid);
              if (name) this.log(` - ${name} (id: ${sid})`);
              else this.log(` - id: ${sid}`);
              mapped.push({ id: sid, label: name || sid });
            }

            // Send mapped plants to the pairing frontend so it can render radio buttons
            try {
              await session.emit('dataOptions', { options: mapped });
            } catch (e) {
              this.warn('⚠️ Failed to emit dataOptions to pairing view:', e && e.message);
            }
          }
        } catch (e) {
          this.error('❌ Error during getPlants():', e && e.message ? e.message : e);
          return [];
        }
      }

      if (viewId === 'register_device') {
        try {
          this.log('ℹ️  Proceeding with device registration; plantId=', plantId);

          // Attempt to determine gatewayId via API helper when plantId is available
          if (plantId) {
            try {
              const gatewayId = await api.getGatewayModuleId(plantId);

              this.log('ℹ️  Starting device registration (this may provision certificates)...', gatewayId);

              const res = await this.auth.registerDevice({ plantId, gatewayId, async: false, clientName: 'LG Homey Pro 2023' });
              this.log('✅ registerDevice completed:', res);

              // Save plantId and gatewayId in Homey settings for later use
              this.homey.settings.set('plantId', plantId);
              this.homey.settings.set('gatewayId', gatewayId);

              session.nextView();
            } catch (e) {
              this.error('❌ Device registration skipped; could not determine gatewayId from plantId: ', e && e.message ? e.message : e);
            }
          } else {
            this.warn('⚠️ register_device view opened but no plantId selected');
          }
        } catch (e) {
          this.error('❌ registerDevice failed:', e && e.message ? e.message : e);
        }

      }
      //return true;
    });

    session.setHandler("list_devices", async () => {
      this.log('onPair - ListDevices called');
      // If plantId is not selected yet, return empty list
      try {
        if (!plantId) {
          this.log('list_devices: no plantId selected yet');
          return [];
        }

        // Use API client to fetch modules for the selected plant
        const modules = await api.getModules(plantId);
        if (!Array.isArray(modules) || modules.length === 0) return [];

        // Filter only lock devices
        const locks = modules.filter(m => m && String(m.device) === 'lock');

        // Map to Homey pairing list format: at minimum provide name and unique data
        const devices = locks.map((m) => {
          const id = m.id || m.entityId || m.internalId || null;
          const name = m.name || m.displayName || id || 'Lock';
          const gatewayId = m.gatewayId || m.parentId || null;

          return {
            name: name,
            data: {
              id: String(id)
            },
            store: {
              gatewayId: gatewayId
            }
          };
        }).filter(d => d.data && d.data.id);

        this.log(`list_devices: returning ${devices.length} lock(s)`);
        return devices;
      } catch (e) {
        this.error('❌ list_devices failed:', e && e.message ? e.message : e);
        return [];
      }
    });
  }
};
