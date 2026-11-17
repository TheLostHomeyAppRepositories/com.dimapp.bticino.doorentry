'use strict';

const Homey = require('homey');


module.exports = class BticinoLockDriver extends Homey.Driver {

  // add this private method to the class (place it outside/after onPair):
  _attachAuthHandlers(auth, session) {
    // Store bound references for later removal
    this._onDeviceRegistered = async (payload) => {
      try {
        if (payload && payload.result) {
          this.log('[Driver] SIP Account data saved to Homey settings');
          this.homey.settings.set('sip_account', payload.result);
        } else {
          this.error('[Driver] deviceRegistered event missing result payload');
        }
      } catch (e) {
        this.error('[Driver] deviceRegistered handler error:', e && e.message);
      }
    };

    this._onLoginUrlCreated = async ({ state, loginUrl: newLoginUrl }) => {
      try {
        this.log('[Driver] Login URL created:', newLoginUrl);
        try {
          await session.emit('dataLogin', { loginUrl: newLoginUrl });
        } catch (e) {
          this.warn('[Driver] emit dataLogin error (view might not be open yet):', e && e.message);
        }
      } catch (e) {
        this.error('[Driver] loginUrl handler error:', e && e.message);
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
      this.log('[Driver] Pairing auth handlers detached');
    }
  }


  /**
   * Format plant objects with module counts and activation dates for pairing/repair UI.
   * @private
   * @param {Array<Object>} plants - List of plants returned by API
   * @param {Array<Object>} [modules] - List of modules returned by API
   * @returns {Array<{id: string, label: string, title: string, subtitle: string|null, count: number}>}
   * @example
   * const options = this._formatPlantsOptions(plants, modules);
   */
  _formatPlantsOptions(plants, modules = []) {
    if (!Array.isArray(plants) || plants.length === 0) {
      return [];
    }

    const userLanguage = this.homey.i18n.getLanguage();
    const modulesList = Array.isArray(modules) ? modules : [];

    const mapped = plants.map((p) => {
      const id = String(p.id || p.plantId || p._id || '');
      const name = p.name || p.displayName || id;

      // Count modules belonging to this plant
      const plantModules = modulesList.filter((m) => m && (
        String(m.plantId) === id ||
        String(m.plant_id) === id ||
        (m.plant && String(m.plant.id) === id)
      ));
      const count = plantModules.length;

      // Format device count label
      let countLabel = '';
      if (count === 1) {
        countLabel = this.homey.__('pair.choose_plant.devices_singular') || '1 device';
      } else if (count > 1) {
        const pluralTpl = this.homey.__('pair.choose_plant.devices_plural') || '__count__ devices';
        countLabel = pluralTpl.replace('__count__', String(count));
      } else {
        countLabel = this.homey.__('pair.choose_plant.no_devices') || '0 devices';
      }

      const title = `${name} (${countLabel})`;

      // Format activation date if present
      let subtitle = null;
      if (p.activationDate) {
        try {
          const date = new Date(p.activationDate);
          if (!isNaN(date.getTime())) {
            const formattedDate = date.toLocaleDateString(userLanguage, {
              day: '2-digit',
              month: '2-digit',
              year: 'numeric'
            });
            const activatedLabel = this.homey.__('pair.choose_plant.activated_on') || 'Activated on';
            subtitle = `${activatedLabel}: ${formattedDate}`;
          }
        } catch (_) {}
      }

      return {
        id,
        label: title,
        title,
        subtitle,
        count
      };
    });

    // Sort: plants with devices (count > 0) first, then by count descending
    mapped.sort((a, b) => b.count - a.count);

    return mapped;
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
      this.error('[Driver] _hasSavedAccountData failed:', e && e.message ? e.message : e);
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
      this.log('[Pairing] Session disconnected, cleaning up handlers...');
      this._detachAuthHandlers();
    });

    // Handle selection emitted by the frontend when a radio is pressed
    session.setHandler('optionSelected', async (data) => {
      try {
        if (data && data.id) {
          plantId = String(data.id);
          this.log('[Pairing] Plant selected:', plantId);
          return { ok: true };
        }
        return { ok: false };
      } catch (e) {
        this.error('[Pairing] Error handling optionSelected:', e && e.message ? e.message : e);
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
              this.log('[Pairing] Token obtained from cache');
              this.log('[Pairing] Access token expires at', result.tokens.expiresAt);

              plantId = this.homey.settings.get('plantId');

              await session.showView('list_lock_devices');
            } else {
              this.log('[Pairing] authenticate() returned with no tokens or from cache');
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
            this.log('[Pairing] Token exchange completed');
            this.log('[Pairing] Access token expires at', result.tokens.expiresAt);

            await session.showView('choose_plant');
          } else {
            this.log('[Pairing] authenticate() returned with no tokens or from cache');
          }
        } catch (e) {
          this.error('[Pairing] authenticate() failed:', e && e.message ? e.message : e);
        }
      }

      if (viewId === "choose_plant") {
        this.log('Showing plants view to user');

        const api = this.auth.createApiClient();

        try {
          this.log('[Pairing] Fetching plants and modules from API...');
          const [plants, modules] = await Promise.all([
            api.getPlants().catch((err) => {
              this.error('[Pairing] Error fetching plants:', err && err.message);
              return [];
            }),
            api.getModules().catch((err) => {
              this.warn('[Pairing] Could not fetch modules for plant mapping:', err && err.message);
              return [];
            })
          ]);

          const mapped = this._formatPlantsOptions(plants, modules);
          this.log(`[Pairing] Formatted ${mapped.length} plant option(s) for UI`);

          await session.emit('dataOptions', { options: mapped });
        } catch (e) {
          this.error('[Pairing] Error during choose_plant handling:', e && e.message ? e.message : e);
        }
      }

      if (viewId === 'register_device') {
        try {
          this.log('[Pairing] Proceeding with device registration; plantId=', plantId);

          // Attempt to determine gatewayId via API helper when plantId is available
          if (plantId) {
            try {
              const gatewayId = await api.getGatewayModuleId(plantId);

              this.log('[Pairing] Starting device registration (this may provision certificates)...', gatewayId);

              const res = await this.auth.registerDevice({ plantId, gatewayId, async: false, clientName: 'LG Homey Pro 2023' });
              this.log('[Pairing] registerDevice completed:', res);

              // Save plantId and gatewayId in Homey settings for later use
              this.homey.settings.set('plantId', plantId);
              this.homey.settings.set('gatewayId', gatewayId);

              session.nextView();
            } catch (e) {
              this.error('[Pairing] Device registration skipped; could not determine gatewayId from plantId:', e && e.message ? e.message : e);
            }
          } else {
            this.warn('[Pairing] register_device view opened but no plantId selected');
          }
        } catch (e) {
          this.error('[Pairing] registerDevice failed:', e && e.message ? e.message : e);
        }

      }
      //return true;
    });

    session.setHandler("list_devices", async () => {
      this.log('[BticinoLockDriver:list_devices] Discovery requested by user');
      // If plantId is not selected yet, return empty list
      try {
        if (!plantId) {
          this.log('[BticinoLockDriver:list_devices] No plantId selected yet');
          return [];
        }

        // Use API client to fetch modules for the selected plant
        const modules = await api.getModules(plantId);
        if (!Array.isArray(modules) || modules.length === 0) return [];

        // 1. Discover lock / gate modules
        const lockModules = modules.filter(m => m && String(m.device) === 'lock');
        const locks = lockModules.map((m) => {
          const id = m.id || m.entityId || m.internalId || null;
          const name = m.name || m.displayName || id || 'Lock';
          const gatewayId = m.gatewayId || m.parentId || null;

          return {
            name: name,
            icon: '/lock.svg',
            data: {
              id: String(id),
              deviceType: 'lock'
            },
            store: {
              gatewayId: gatewayId,
              deviceType: 'lock',
              moduleId: String(id)
            },
            settings: {
              moduleId: String(id),
              cameraIndex: '0'
            }
          };
        }).filter(d => d.data && d.data.id);

        // 2. Discover camera modules (device: 'audioVideoTerminal' and deviceType === 'EU')
        const cameraModules = modules.filter(m => {
          if (!m || String(m.device) !== 'audioVideoTerminal') return false;
          // Ignore Internal Units (IU) - they are indoor intercom stations without camera sensors
          if (m.deviceType === 'IU') return false;
          return true;
        });

        const cameras = [];
        const fallbackCameraName = this.homey.__('pair.default_camera_name') || 'Telecamera';

        for (const m of cameraModules) {
          const id = m.id || m.entityId || m.internalId || null;
          if (!id) continue;

          let visibleCount = 1;
          try {
            const privAddr = (m.tags || []).find(t => t && t.key === 'PrivateAddress');
            if (privAddr && privAddr.value) {
              const parsed = typeof privAddr.value === 'string' ? JSON.parse(privAddr.value) : privAddr.value;
              if (parsed && parsed.visible !== undefined) {
                const parsedVisible = parseInt(parsed.visible, 10);
                if (!isNaN(parsedVisible) && parsedVisible > 0) {
                  visibleCount = parsedVisible;
                }
              }
            }
          } catch (_) {}

          const gatewayId = m.gatewayId || m.parentId || null;
          const rawName = (m.name || m.displayName || '').trim();
          const cameraModuleName = rawName || fallbackCameraName;

          for (let camIdx = 1; camIdx <= visibleCount; camIdx++) {
            const deviceId = camIdx === 1 ? String(id) : `${id}_cam${camIdx}`;
            const devName = visibleCount > 1
              ? `${cameraModuleName} ${camIdx}`
              : cameraModuleName;

            cameras.push({
              name: devName,
              icon: '/camera.svg',
              data: {
                id: deviceId,
                deviceType: 'camera'
              },
              store: {
                gatewayId: gatewayId,
                deviceType: 'camera',
                moduleId: String(id),
                cameraId: String(id),
                cameraIndex: camIdx,
                deviceModuleType: m.deviceType || 'EU'
              },
              settings: {
                moduleId: String(id),
                cameraIndex: String(camIdx)
              }
            });
          }
        }

        const allDevices = [...locks, ...cameras];
        this.log(`[BticinoLockDriver:list_devices] Discovered ${locks.length} lock(s) and ${cameras.length} camera(s) (total: ${allDevices.length})`);
        return allDevices;
      } catch (e) {
        this.error('[BticinoLockDriver:list_devices] Discovery failed:', e && e.message ? e.message : e);
        return [];
      }
    });
  }

  /**
   * onRepair is called when the user initiates repair for an EasyKit device.
   * Reconnects the BTicino account, acquires fresh tokens and certificates,
   * and restores all EasyKit devices to the available state without breaking Flows.
   * @public
   * @async
   * @param {Object} session - PairSocket repair session
   * @param {Homey.Device} device - Device being repaired
   * @returns {Promise<void>}
   */
  async onRepair(session, device) {
    this.log('Starting repair session for device:', device ? device.getName() : 'unknown');

    // Ensure driver always uses the current active authentication instance
    this.auth = this.homey.app.auth;

    let plantId = null;
    const api = this.auth.createApiClient();

    this._attachAuthHandlers(this.auth, session);

    // Cleanup when repair session ends
    session.setHandler('disconnect', async () => {
      this.log('[Repair] Session disconnected, cleaning up handlers...');
      this._detachAuthHandlers();
    });

    // Handle plant selection
    session.setHandler('optionSelected', async (data) => {
      try {
        if (data && data.id) {
          plantId = String(data.id);
          this.log('[Repair] Plant selected:', plantId);
          return { ok: true };
        }
        return { ok: false };
      } catch (e) {
        this.error('[Repair] Error handling optionSelected:', e && e.message ? e.message : e);
        return { ok: false };
      }
    });

    // Handle view navigation during repair
    session.setHandler('showView', async (viewId) => {
      this.log('[Repair] View requested:', viewId);

      if (viewId === 'bticino_login') {
        this.log('[Repair] Showing login view to user');
        try {
          const result = await this.auth.authenticate();
          if (result && result.tokens) {
            this.log('[Repair] Token exchange completed');
            await session.showView('choose_plant');
          }
        } catch (e) {
          this.error('[Repair] authenticate() failed:', e && e.message ? e.message : e);
        }
      }

      if (viewId === 'choose_plant') {
        this.log('[Repair] Showing plants view to user');
        try {
          const [plants, modules] = await Promise.all([
            api.getPlants().catch((err) => {
              this.error('[Repair] Error fetching plants:', err && err.message);
              return [];
            }),
            api.getModules().catch((err) => {
              this.warn('[Repair] Could not fetch modules:', err && err.message);
              return [];
            })
          ]);

          const mapped = this._formatPlantsOptions(plants, modules);
          this.log(`[Repair] Formatted ${mapped.length} plant option(s) for UI`);

          await session.emit('dataOptions', { options: mapped });
        } catch (e) {
          this.error('[Repair] Error during choose_plant handling:', e && e.message ? e.message : e);
        }
      }

      if (viewId === 'register_device') {
        try {
          this.log('[Repair] Proceeding with device registration; plantId=', plantId);
          if (plantId) {
            const gatewayId = await api.getGatewayModuleId(plantId);
            if (!gatewayId) {
              throw new Error(`No gateway module found for plantId ${plantId}`);
            }

            const res = await this.auth.registerDevice({
              plantId,
              gatewayId,
              forceCertificates: true,
              async: false,
              clientName: 'LG Homey Pro 2023'
            });
            this.log('[Repair] registerDevice completed successfully:', res);

            // Explicitly save settings to guarantee atomicity
            this.homey.settings.set('plantId', plantId);
            this.homey.settings.set('gatewayId', gatewayId);
            if (res && res.result) {
              this.homey.settings.set('sip_account', res.result);
            }
            if (res && res.certificates) {
              this.homey.settings.set('certificates', {
                cert: res.certificates.certPEM,
                key: res.certificates.privateKeyPem
              });
            }

            // Re-start SIP listener and restore all devices to available state
            await this.homey.app.startSipListener({ forceRestart: true });
            await this.homey.app.setDevicesAvailable();

            this.log('[Repair] Completed successfully, closing repair session');
            await session.done();
          } else {
            this.warn('[Repair] register_device view opened but no plantId selected');
            await session.showView('choose_plant');
          }
        } catch (e) {
          this.error('[Repair] registerDevice failed:', e && e.message ? e.message : e);
          try {
            await session.showView('choose_plant');
          } catch (_) {
            // Do not call session.done() on error
          }
        }
      }
    });
  }
};
