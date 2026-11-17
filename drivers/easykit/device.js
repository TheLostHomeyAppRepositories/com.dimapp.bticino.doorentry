'use strict';

const fs = require('fs');
const path = require('path');
const Homey = require('homey');
const { Readable } = require('stream');
const { openGate } = require('door-entry');

/**
 * BticinoGateDevice
 * Represents an EasyKit device in Homey (either a Gate / Lock or a dedicated Outdoor Camera).
 *
 * For Lock devices:
 * - Provides 'locked' capability with auto-close timer support and SIP actuation (openGate).
 *
 * For Camera devices:
 * - Device class is set to 'camera'.
 * - Provides live H.264 RTSP video streaming via BticinoVideoStreamer and snapshot extraction.
 *
 * @class BticinoGateDevice
 * @extends {Homey.Device}
 */
module.exports = class BticinoGateDevice extends Homey.Device {

  /**
   * Checks whether all required credentials and settings are present in Homey settings.
   *
   * @private
   * @returns {boolean} True if credentials are fully configured.
   *
   * @example
   * if (!this._hasRequiredCredentials()) { ... }
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
   * Initializes the device upon startup or pairing.
   * Detects whether this instance is a dedicated outdoor Camera or a Lock,
   * configures appropriate device class and capabilities, and starts background services.
   *
   * @public
   * @async
   * @returns {Promise<void>}
   */
  async onInit() {
    const data = (this.getData && this.getData()) || {};
    const storeDeviceType = this.getStoreValue('deviceType');
    const isCamera = data.deviceType === 'camera' || storeDeviceType === 'camera';

    this.log(`[BticinoGateDevice:onInit] Initializing ${isCamera ? 'Camera' : 'Lock'} device: ${this.getName()}`);

    // Check account status and set initial availability
    if (!this._hasRequiredCredentials()) {
      this.log('[BticinoGateDevice:onInit] Device credentials missing, marking device as unavailable');
      await this.setUnavailable(this.homey.__('device.account_disconnected')).catch(this.error);
    } else {
      await this.setAvailable().catch(this.error);
    }

    // Initialize either camera or lock behaviors
    if (isCamera) {
      await this._initAsCameraDevice();
    } else {
      await this._initAsLockDevice();
    }

    // Ensure SIP listener is started
    await this._ensureSipListenerStarted();
  }

  /**
   * Initializes this device instance as a dedicated outdoor camera device.
   * Configures camera class, removes lock capabilities, populates cameraId setting,
   * and initializes RTSP video streaming and snapshot extraction resources.
   *
   * @private
   * @async
   * @returns {Promise<void>}
   *
   * @example
   * await this._initAsCameraDevice();
   */
  async _initAsCameraDevice() {
    try {
      this.log(`[BticinoGateDevice:_initAsCameraDevice] Configuring ${this.getName()} as dedicated camera`);

      // 1. Ensure class is 'camera'
      if (this.getClass() !== 'camera') {
        this.log('[BticinoGateDevice:_initAsCameraDevice] Setting device class to camera');
        await this.setClass('camera').catch(this.error);
      }

      // 2. Remove 'locked' capability if present
      if (this.hasCapability('locked')) {
        this.log('[BticinoGateDevice:_initAsCameraDevice] Removing locked capability from camera device');
        await this.removeCapability('locked').catch(this.error);
      }

      // 3. Ensure moduleId and cameraIndex settings are populated from device data/store
      const currentCameraId = this.getSetting('moduleId') || this.getSetting('cameraId');
      const storeCameraId = this.getStoreValue('moduleId') || this.getStoreValue('cameraId');
      const dataId = (this.getData && this.getData().id) ? this.getData().id : null;
      const cleanDataId = dataId ? String(dataId).replace(/_cam\d+$/, '').trim() : null;
      const targetCameraId = currentCameraId || storeCameraId || cleanDataId;

      const currentCameraIndex = this.getSetting('cameraIndex');
      const storeCameraIndex = this.getStoreValue('cameraIndex');
      let targetCameraIndex = currentCameraIndex !== undefined && currentCameraIndex !== null
        ? Number(currentCameraIndex)
        : (storeCameraIndex !== undefined && storeCameraIndex !== null ? Number(storeCameraIndex) : null);

      if (!targetCameraIndex && dataId && /_cam(\d+)$/.test(String(dataId))) {
        targetCameraIndex = parseInt(String(dataId).match(/_cam(\d+)$/)[1], 10);
      }
      if (!targetCameraIndex || isNaN(targetCameraIndex)) {
        targetCameraIndex = 1;
      }

      const settingsToUpdate = {};
      const activeModuleId = this.getSetting('moduleId');
      if ((!activeModuleId || String(activeModuleId).trim() === '') && targetCameraId) {
        settingsToUpdate.moduleId = String(targetCameraId);
      }
      if (!currentCameraIndex || String(currentCameraIndex) !== String(targetCameraIndex)) {
        settingsToUpdate.cameraIndex = String(targetCameraIndex);
      }
      if (Object.keys(settingsToUpdate).length > 0) {
        await this.setSettings(settingsToUpdate).catch(this.error);
      }

      // 4. Initialize persistent Homey.Image slot for this camera device
      await this._ensureCameraImageSlot();

      // 5. Initialize RTSP video streaming resource (live stream view only, no snapshot card)
      await this._initCameraVideo();

      this.log(`[BticinoGateDevice:_initAsCameraDevice] Camera ${this.getName()} initialized successfully`);
    } catch (err) {
      this.error('[BticinoGateDevice:_initAsCameraDevice] Failed to configure camera device:', err && err.message);
    }
  }

  /**
   * Initializes this device instance as an EasyKit lock / gate device.
   * Configures lock class, ensures 'locked' capability is registered with listeners,
   * and configures auto-close timers.
   *
   * @private
   * @async
   * @returns {Promise<void>}
   *
   * @example
   * await this._initAsLockDevice();
   */
  async _initAsLockDevice() {
    try {
      this.log(`[BticinoGateDevice:_initAsLockDevice] Configuring ${this.getName()} as lock / gate`);

      // 1. Ensure class is 'lock'
      if (this.getClass() !== 'lock') {
        this.log('[BticinoGateDevice:_initAsLockDevice] Setting device class to lock');
        await this.setClass('lock').catch(this.error);
      }

      // 2. Ensure 'locked' capability is present
      if (!this.hasCapability('locked')) {
        this.log('[BticinoGateDevice:_initAsLockDevice] Adding locked capability to lock device');
        await this.addCapability('locked').catch(this.error);
      }

      // 3. Populate moduleId and cameraIndex settings from device data if not yet configured
      const currentModuleId = this.getSetting('moduleId') || this.getSetting('gateId');
      const dataId = (this.getData && this.getData().id) ? this.getData().id : null;
      const targetModuleId = currentModuleId || dataId;
      const currentCameraIndex = this.getSetting('cameraIndex');

      const settingsToUpdate = {};
      const activeModuleId = this.getSetting('moduleId');
      if ((!activeModuleId || String(activeModuleId).trim() === '') && targetModuleId) {
        settingsToUpdate.moduleId = String(targetModuleId);
      }
      if (currentCameraIndex === undefined || currentCameraIndex === null || String(currentCameraIndex) !== '0') {
        settingsToUpdate.cameraIndex = '0';
      }
      if (Object.keys(settingsToUpdate).length > 0) {
        await this.setSettings(settingsToUpdate).catch(this.error);
      }

      // 4. Initialize the 'locked' capability to true
      await this.setCapabilityValue('locked', true).catch(this.error);

      // 5. Register capability listener for 'locked'
      this.registerCapabilityListener('locked', async (value) => {
        this.log(`[BticinoGateDevice:_initAsLockDevice] Capability locked changed -> ${value}`);

        // Only trigger openGate when locked is set to false (unlock/open)
        try {
          if (!this._hasRequiredCredentials()) {
            await this.setUnavailable(this.homey.__('device.account_disconnected')).catch(this.error);
            throw new Error('Account disconnected or missing credentials');
          }

          const settingGateId = this.getSetting('moduleId') || this.getSetting('gateId');
          const defaultGateId = (this.getData && this.getData().id) ? this.getData().id : this.getId();
          const gateId = (settingGateId && String(settingGateId).trim() !== '')
            ? String(settingGateId).trim()
            : defaultGateId;
          const plantId = this.homey.settings.get('plantId');
          const certs = this.homey.settings.get('certificates');
          const sipAccount = this.homey.settings.get('sip_account');

          if (!gateId) throw new Error('Missing gateId for this device');

          const debugEnabled = this.homey.settings.get('debugEnabled') === true;

          this.log(`[BticinoGateDevice:_initAsLockDevice] Calling openGate for gateId=${gateId}, plantId=${plantId}`);
          await openGate(gateId, plantId, certs.cert, certs.key, sipAccount, { debug: debugEnabled });
          this.log('[BticinoGateDevice:_initAsLockDevice] openGate completed successfully');

          // Check autoClose setting and schedule capability reset if enabled
          const autoClose = this.getSetting('autoClose') || false;
          if (autoClose) {
            const delaySeconds = this.getSetting('autoCloseDelay') || 30;
            const delayMs = delaySeconds * 1000;
            this.log(`[BticinoGateDevice:_initAsLockDevice] Auto-close enabled: resetting locked to true after ${delaySeconds}s`);

            if (this._autoCloseTimeout) {
              clearTimeout(this._autoCloseTimeout);
            }

            this._autoCloseTimeout = setTimeout(() => {
              this.log('[BticinoGateDevice:_initAsLockDevice] Auto-close elapsed, resetting locked to true');
              this.setCapabilityValue('locked', true)
                .catch((err) => this.error('[BticinoGateDevice:_initAsLockDevice] Failed to reset locked:', err));
              this._autoCloseTimeout = null;
            }, delayMs);
          }

        } catch (err) {
          this.error('[BticinoGateDevice:_initAsLockDevice] openGate failed:', err && err.message ? err.message : err);
          await this.setCapabilityValue('locked', true).catch(this.error);
        }
      });

    } catch (err) {
      this.error('[BticinoGateDevice:_initAsLockDevice] Error during lock init:', err && err.message);
    }
  }

  /**
   * Ensures the SIP listener is started on application level.
   *
   * @private
   * @async
   * @returns {Promise<void>}
   */
  async _ensureSipListenerStarted() {
    try {
      const app = this.homey.app;
      if (!app || !app.auth) {
        this.log('[BticinoGateDevice:_ensureSipListenerStarted] App or auth not ready yet');
        return;
      }

      if (!this._hasRequiredCredentials()) {
        this.log('[BticinoGateDevice:_ensureSipListenerStarted] Missing credentials for SIP listener');
        return;
      }

      if (app.auth.hasSipListener() && app.auth.isSipListenerConnected()) {
        this.log('[BticinoGateDevice:_ensureSipListenerStarted] SIP Listener already running');
        return;
      }

      this.log('[BticinoGateDevice:_ensureSipListenerStarted] Ensuring SIP listener is started...');
      const started = await app.startSipListener();
      if (started) {
        this.log('[BticinoGateDevice:_ensureSipListenerStarted] SIP Listener confirmed running');
      } else {
        this.log('[BticinoGateDevice:_ensureSipListenerStarted] SIP Listener could not be started');
      }
    } catch (e) {
      this.error('[BticinoGateDevice:_ensureSipListenerStarted] Error ensuring SIP listener:', e && e.message);
    }
  }

  /**
   * Invoked when the user adds the device to Homey.
   *
   * @public
   * @async
   * @returns {Promise<void>}
   */
  async onAdded() {
    this.log(`[BticinoGateDevice:onAdded] Device added: ${this.getName()}`);
    await this.setAvailable().catch(this.error);
    await this._ensureSipListenerStarted();
  }

  /**
   * Invoked when settings are modified by the user.
   *
   * @public
   * @async
   * @param {Object} context - Settings context.
   * @param {Object} context.oldSettings - Previous settings.
   * @param {Object} context.newSettings - New settings.
   * @param {string[]} context.changedKeys - Changed keys.
   * @returns {Promise<void>}
   */
  async onSettings({ oldSettings, newSettings, changedKeys }) {
    this.log(`[BticinoGateDevice:onSettings] Device settings changed: ${changedKeys.join(', ')}`);
    await this._ensureSipListenerStarted();
  }

  /**
   * Initializes Homey RTSP video camera resources on this device.
   * Only registers the live video stream (no snapshot card in the device UI).
   *
   * @private
   * @async
   * @returns {Promise<void>}
   *
   * @example
   * await this._initCameraVideo();
   */
  async _initCameraVideo() {
    try {
      this.log('[BticinoGateDevice:_initCameraVideo] Initializing camera video RTSP stream...');

      // 1. Create RTSP video resource
      this._cameraVideo = await this.homey.videos.createVideoRTSP({
        acceptInvalidCertificates: true,
        demuxer: 'h264'
      });

      this._cameraVideo.registerVideoUrlListener(async () => {
        return this._handleVideoUrlRequest();
      });

      // 2. Register camera video with Homey (Live stream view only)
      const videoTitle = this.homey.__('device.camera_video_title') || 'Camera';
      await this.setCameraVideo('main', videoTitle, this._cameraVideo);

      this.log('[BticinoGateDevice:_initCameraVideo] Camera RTSP video registered successfully');
    } catch (err) {
      this.error('[BticinoGateDevice:_initCameraVideo] Failed to initialize camera video:', err && err.message);
    }
  }

  /**
   * Handles RTSP video stream URL requests from Homey video player.
   * Coordinates with BticinoAuthentication to create and start BticinoVideoStreamer.
   *
   * @private
   * @async
   * @returns {Promise<{url: string}>} RTSP loopback URL.
   *
   * @example
   * const { url } = await this._handleVideoUrlRequest();
   */
  async _handleVideoUrlRequest() {
    try {
      this.log('[BticinoGateDevice:_handleVideoUrlRequest] Video URL requested by Homey player');

      if (!this._hasRequiredCredentials()) {
        await this.setUnavailable(this.homey.__('device.account_disconnected')).catch(this.error);
        throw new Error('Account disconnected or missing credentials');
      }

      const sipAccount = this.homey.settings.get('sip_account');
      const certs = this.homey.settings.get('certificates');
      const app = this.homey.app;

      if (!app || !app.auth) {
        throw new Error('Application authentication orchestrator not available');
      }

      const debugEnabled = this.homey.settings.get('debugEnabled') === true;
      const localGatewayIp = this.getSetting('gatewayIp') || null;

      // Reset video streamer if it was previously stopped or inactive
      if (this._videoStreamer && !this._videoStreamer._activeStream) {
        this.log('[BticinoGateDevice:_handleVideoUrlRequest] Clearing inactive video streamer instance');
        this._videoStreamer = null;
      }

      // Obtain or create video streamer instance
      if (!this._videoStreamer) {
        this.log('[BticinoGateDevice:_handleVideoUrlRequest] Creating new BticinoVideoStreamer...');
        this._videoStreamer = app.auth.createVideoStreamer(sipAccount, certs, {
          debug: debugEnabled,
          localGatewayIp
        });

        this._videoStreamer.on('snapshot', (keyframeBuffer) => {
          this._handleSnapshotCaptured(keyframeBuffer);
        });

        this._videoStreamer.on('jpeg', (jpegBuffer) => {
          this._handleJpegSnapshotCaptured(jpegBuffer);
        });

        this._videoStreamer.on('error', (err) => {
          this.error('[BticinoGateDevice:_handleVideoUrlRequest] Video streamer error:', err && err.message);
        });

        this._videoStreamer.on('streamStopped', () => {
          this.log('[BticinoGateDevice:_handleVideoUrlRequest] Video stream stopped');
          this._videoStreamer = null;
        });
      }

      // Camera ID & Channel Index: resolve from settings, store, or device data
      const cameraId = await this._resolveCameraId();
      const cameraIndex = Number(this.getSetting('cameraIndex') || this.getStoreValue('cameraIndex') || 1);

      this.log(`[BticinoGateDevice:_handleVideoUrlRequest] Starting stream for cameraId: ${cameraId || 'default'} (channel: ${cameraIndex})`);
      const { rtspUrl } = await this._videoStreamer.startStream(cameraId, { cameraIndex });
      this.log(`[BticinoGateDevice:_handleVideoUrlRequest] RTSP stream ready at: ${rtspUrl}`);

      return { url: rtspUrl };
    } catch (err) {
      this.error('[BticinoGateDevice:_handleVideoUrlRequest] Failed to start video stream:', err && err.message);
      throw err;
    }
  }

  /**
   * Resolves the outdoor camera module UUID (audioVideoTerminal / EU) for this plant.
   * Checks device data, settings, store, and falls back to querying the Legrand API.
   *
   * @private
   * @async
   * @returns {Promise<string|null>} Resolved camera module ID or null.
   *
   * @example
   * const cameraId = await this._resolveCameraId();
   */
  async _resolveCameraId() {
    try {
      const data = (this.getData && this.getData()) || {};
      const storeDeviceType = this.getStoreValue('deviceType');
      const isCamera = data.deviceType === 'camera' || storeDeviceType === 'camera';

      // 1. Check moduleId or cameraId in device settings (strip optional _cam suffix)
      const settingCameraId = this.getSetting('moduleId') || this.getSetting('cameraId');
      if (settingCameraId && String(settingCameraId).trim() !== '') {
        return String(settingCameraId).trim().replace(/_cam\d+$/, '');
      }

      // 2. Check moduleId or cameraId in device store (strip optional _cam suffix)
      const storeCameraId = this.getStoreValue('moduleId') || this.getStoreValue('cameraId');
      if (storeCameraId && String(storeCameraId).trim() !== '') {
        return String(storeCameraId).trim().replace(/_cam\d+$/, '');
      }

      // 3. If this device is a camera, its data.id is the camera ID (strip optional _cam suffix)
      if (isCamera && data.id && String(data.id).trim() !== '') {
        return String(data.id).trim().replace(/_cam\d+$/, '');
      }

      // 4. Check cached ID in instance memory
      if (this._cachedCameraId) {
        return this._cachedCameraId;
      }

      // 5. Query Legrand API to discover the outdoor station module (EU or audioVideoTerminal with visible > 0)
      const plantId = this.homey.settings.get('plantId');
      const app = this.homey.app;
      if (!plantId || !app || !app.auth) {
        return null;
      }

      this.log(`[BticinoGateDevice:_resolveCameraId] Discovering camera module for plant ${plantId}...`);
      const api = app.auth.createApiClient();
      const modules = await api.getModules(plantId);

      if (Array.isArray(modules)) {
        const myDataId = (data && data.id) ? String(data.id) : null;
        const cameraModule = modules.find((m) => {
          if (!m) return false;
          if (myDataId && String(m.id || m.entityId || m.internalId) === myDataId) {
            return true;
          }
          return String(m.device) === 'audioVideoTerminal';
        });

        if (cameraModule && (cameraModule.id || cameraModule.entityId)) {
          const resolvedId = String(cameraModule.id || cameraModule.entityId);
          this._cachedCameraId = resolvedId;
          await this.setStoreValue('moduleId', resolvedId).catch(this.error);
          await this.setStoreValue('cameraId', resolvedId).catch(this.error);
          this.log(`[BticinoGateDevice:_resolveCameraId] Discovered and cached cameraId: ${resolvedId}`);
          return resolvedId;
        }
      }
    } catch (err) {
      this.error('[BticinoGateDevice:_resolveCameraId] Failed to resolve cameraId from API:', err && err.message);
    }

    return null;
  }

  /**
   * Handles incoming IDR keyframe snapshots emitted by the video streamer.
   * Updates cached snapshot buffer and triggers camera image refresh in Homey.
   *
   * @private
   * @param {Buffer} keyframeBuffer - Complete Annex-B H.264 IDR keyframe buffer.
   * @returns {void}
   */
  _handleSnapshotCaptured(keyframeBuffer) {
    if (!Buffer.isBuffer(keyframeBuffer) || keyframeBuffer.length === 0) return;
    this._lastSnapshotBuffer = keyframeBuffer;
    this.log(`[BticinoGateDevice:_handleSnapshotCaptured] Keyframe snapshot captured (${keyframeBuffer.length} bytes)`);
  }

  /**
   * Handles incoming decoded JPEG snapshots emitted by the video streamer during live streaming.
   * Caches the latest JPEG buffer so persistent image slots and Flow tokens have an instant snapshot available.
   *
   * @private
   * @param {Buffer} jpegBuffer - Complete JPEG image buffer.
   * @returns {void}
   */
  _handleJpegSnapshotCaptured(jpegBuffer) {
    if (!Buffer.isBuffer(jpegBuffer) || jpegBuffer.length === 0) return;
    this._latestJpegBuffer = jpegBuffer;
  }

  /**
   * Binds the live JPEG buffer stream callback to the provided Homey.Image slot
   * following the official Homey Apps SDK v3 Image streaming guidelines.
   *
   * @private
   * @param {Homey.Image} image - The Homey.Image slot instance.
   * @returns {void}
   *
   * @example
   * this._bindStreamToSlot(image);
   */
  _bindStreamToSlot(image) {
    if (!image || typeof image.setStream !== 'function') return;

    image.setStream(async (stream) => {
      const buffer = this._latestJpegBuffer;
      if (Buffer.isBuffer(buffer) && buffer.length > 0) {
        this.log(`[BticinoGateDevice:_bindStreamToSlot] Streaming snapshot to Homey (slot: ${image.id || 'default'}, size: ${buffer.length} bytes)...`);
        const readable = Readable.from(buffer);
        readable.on('error', (err) => {
          this.error('[BticinoGateDevice:_bindStreamToSlot] Error in snapshot readable stream:', err && err.message ? err.message : err);
          if (stream && typeof stream.destroy === 'function') {
            stream.destroy(err);
          }
        });
        return readable.pipe(stream);
      }

      const fallbackPath = path.join(__dirname, '..', '..', 'assets', 'images', 'large.png');
      this.log(`[BticinoGateDevice:_bindStreamToSlot] No snapshot captured yet for slot ${image.id || 'default'}, streaming placeholder image`);
      const fileStream = fs.createReadStream(fallbackPath);
      fileStream.on('error', (err) => {
        this.error('[BticinoGateDevice:_bindStreamToSlot] Error reading placeholder image:', err && err.message ? err.message : err);
        if (stream && typeof stream.destroy === 'function') {
          stream.destroy(err);
        }
      });
      return fileStream.pipe(stream);
    });
  }

  /**
   * Builds a deterministic, unique FlowToken identifier for this camera device.
   *
   * @private
   * @returns {string} The FlowToken ID for this camera device.
   *
   * @example
   * const tokenId = this._getCameraImageTokenId();
   */
  _getCameraImageTokenId() {
    const data = (this.getData && this.getData()) || {};
    const rawId = data.id || this.getSetting('moduleId') || this.getSetting('cameraId') || this.getStoreValue('moduleId') || this.getStoreValue('cameraId') || this.getName() || 'default';
    const sanitizedId = String(rawId).replace(/[^a-zA-Z0-9_]/g, '_');
    return `camera_snapshot_${sanitizedId}`;
  }

  /**
   * Ensures the persistent Homey.Image slot for this camera device is created and bound to its stream callback.
   * Note: setCameraImage is deliberately not called on the device so that the device UI card
   * displays exclusively the live RTSP video stream ('Telecamera'), without showing an extra static snapshot
   * tab ('Istantanea'). Snapshots are managed exclusively via Flows (e.g. 'take_snapshot' action card).
   *
   * @private
   * @async
   * @returns {Promise<Homey.Image>} The persistent Homey.Image instance for this camera.
   *
   * @example
   * const imageSlot = await this._ensureCameraImageSlot();
   */
  async _ensureCameraImageSlot() {
    if (!this._cameraImage) {
      const image = await this.homey.images.createImage();
      this._bindStreamToSlot(image);
      this._cameraImage = image;
      this.log(`[BticinoGateDevice:_ensureCameraImageSlot] Initialized persistent Homey.Image slot (id: ${image.id || 'default'}) for camera: ${this.getName()}`);
    }

    // Clean up any legacy app-level FlowToken to remove homey:app:com.dimapp.bticino.doorentry group from Flow Editor
    const legacyTokenId = this._getCameraImageTokenId();
    if (this.homey && this.homey.flow && typeof this.homey.flow.getToken === 'function') {
      try {
        const legacyToken = this.homey.flow.getToken(legacyTokenId);
        if (legacyToken && typeof legacyToken.unregister === 'function') {
          await legacyToken.unregister();
          this.log(`[BticinoGateDevice:_ensureCameraImageSlot] Cleaned up legacy app-level FlowToken: ${legacyTokenId}`);
        }
      } catch (_) {}
    }

    return this._cameraImage;
  }

  /**
   * Unregisters the active Homey.Image slot for this camera device and releases memory buffers.
   * Invoked when the camera device is uninstalled (onDeleted) or uninitialized (onUninit).
   *
   * @private
   * @async
   * @returns {Promise<void>}
   *
   * @example
   * await this._unregisterCameraImageSlot();
   */
  async _unregisterCameraImageSlot() {
    this._latestJpegBuffer = null;
    this._cameraImageRegistered = false;

    // Clean up legacy app token if present
    const legacyTokenId = this._getCameraImageTokenId();
    if (this.homey && this.homey.flow && typeof this.homey.flow.getToken === 'function') {
      try {
        const legacyToken = this.homey.flow.getToken(legacyTokenId);
        if (legacyToken && typeof legacyToken.unregister === 'function') {
          await legacyToken.unregister();
        }
      } catch (_) {}
    }

    if (this._cameraImage) {
      const imageToUnregister = this._cameraImage;
      this._cameraImage = null;
      try {
        if (typeof imageToUnregister.unregister === 'function') {
          await imageToUnregister.unregister();
          this.log(`[BticinoGateDevice:_unregisterCameraImageSlot] Unregistered Homey.Image slot (id: ${imageToUnregister.id || 'default'}) for camera: ${this.getName()}`);
        } else if (this.homey && this.homey.images && typeof this.homey.images.unregisterImage === 'function') {
          await this.homey.images.unregisterImage(imageToUnregister);
          this.log(`[BticinoGateDevice:_unregisterCameraImageSlot] Unregistered Homey.Image slot via ManagerImages (id: ${imageToUnregister.id || 'default'}) for camera: ${this.getName()}`);
        }
      } catch (err) {
        this.error('[BticinoGateDevice:_unregisterCameraImageSlot] Failed to unregister camera image slot:', err && err.message ? err.message : err);
      }
    }
  }

  /**
   * Returns the registered camera image instance for use in Flow tokens or poster rendering.
   *
   * @public
   * @returns {Homey.Image|null} Camera image resource or null.
   *
   * @example
   * const img = device.getCameraImage();
   */
  getCameraImage() {
    return this._cameraImage || null;
  }

  /**
   * Returns the registered FlowToken instance for this camera device.
   *
   * @public
   * @returns {Homey.FlowToken|null} Camera image FlowToken or null.
   *
   * @example
   * const token = device.getCameraImageToken();
   */
  getCameraImageToken() {
    return this._cameraImageToken || null;
  }

  /**
   * Captures a live snapshot from this camera device, updates the camera's persistent Homey.Image slot,
   * and returns the updated slot instance only after the update has completed.
   *
   * @public
   * @async
   * @param {Object} [options={}] - Snapshot capture options.
   * @param {boolean} [options.forceFresh=true] - Whether to require a new keyframe instead of cached snapshot.
   * @param {number} [options.timeoutMs=15000] - Snapshot acquisition timeout in milliseconds.
   * @param {number} [options.maxDialAttempts=6] - Maximum retry attempts when gateway reports 486 busy.
   * @param {number} [options.retryDelayMs=1500] - Delay in milliseconds between retry attempts.
   * @returns {Promise<Homey.Image>} The updated persistent Homey.Image slot for this camera device.
   * @throws {Error} If credentials are missing, device is not a camera, or capture fails.
   *
   * @example
   * const image = await cameraDevice.captureSnapshot({ forceFresh: true });
   */
  async captureSnapshot({ forceFresh = true, timeoutMs = 15000, maxDialAttempts = 6, retryDelayMs = 1500 } = {}) {
    if (this.getClass() !== 'camera') {
      throw new Error(this.homey.__('errors.device_not_camera') || 'Selected device is not a camera');
    }

    if (!this._hasRequiredCredentials()) {
      await this.setUnavailable(this.homey.__('device.account_disconnected')).catch(this.error);
      throw new Error(this.homey.__('device.account_disconnected') || 'Account disconnected');
    }

    const app = this.homey.app;
    if (!app || !app.auth) {
      throw new Error('Application authentication orchestrator not available');
    }

    const cameraId = await this._resolveCameraId();
    const cameraIndex = Number(this.getSetting('cameraIndex') || this.getStoreValue('cameraIndex') || 1);
    const sipAccount = this.homey.settings.get('sip_account');
    const certs = this.homey.settings.get('certificates');
    const localGatewayIp = this.getSetting('gatewayIp') || null;

    this.log(`[BticinoGateDevice:captureSnapshot] Capturing snapshot for cameraId: ${cameraId || 'default'} (channel: ${cameraIndex}, forceFresh: ${forceFresh})`);

    try {
      const jpegBuffer = await app.auth.captureCameraSnapshot(cameraId, {
        cameraIndex,
        timeoutMs,
        forceFresh,
        maxDialAttempts,
        retryDelayMs,
        sipAccount,
        certs,
        localGatewayIp
      });

      if (!Buffer.isBuffer(jpegBuffer) || jpegBuffer.length === 0) {
        throw new Error(this.homey.__('errors.snapshot_empty') || 'Received empty JPEG buffer from snapshot capture');
      }

      // Store the fresh JPEG buffer for this camera's persistent image slot
      this._latestJpegBuffer = jpegBuffer;

      // Obtain the persistent Homey.Image slot owned by this camera device (created at initialization)
      const imageSlot = await this._ensureCameraImageSlot();

      // Notify Homey that the image slot content has been updated and wait until the slot update completes
      if (typeof imageSlot.update === 'function') {
        await imageSlot.update();
      }

      this.log(`[BticinoGateDevice:captureSnapshot] Snapshot captured (${jpegBuffer.length} bytes) and persistent slot updated (slot: ${imageSlot.id || 'default'}) for ${this.getName()}`);

      return this._cameraImage;
    } catch (err) {
      this.error('[BticinoGateDevice:captureSnapshot] Snapshot capture failed:', err && err.message ? err.message : err);
      throw err;
    }
  }

  /**
   * Invoked when the user deletes the device from Homey.
   * Cleans up timers, tears down active video streamer, and unregisters the persistent image slot.
   *
   * @public
   * @async
   * @returns {Promise<void>}
   */
  async onDeleted() {
    this.log(`[BticinoGateDevice:onDeleted] Device deleted: ${this.getName()}`);
    if (this._autoCloseTimeout) {
      clearTimeout(this._autoCloseTimeout);
      this._autoCloseTimeout = null;
    }
    if (this._videoStreamer) {
      try {
        await this._videoStreamer.stopStream();
      } catch (_) {}
      this._videoStreamer = null;
    }
    await this._unregisterCameraImageSlot();
  }

  /**
   * Invoked when the device is uninitialized (e.g. app restart or uninstall).
   *
   * @public
   * @async
   * @returns {Promise<void>}
   */
  async onUninit() {
    this.log(`[BticinoGateDevice:onUninit] Cleaning up device resources: ${this.getName()}`);
    if (this._autoCloseTimeout) {
      clearTimeout(this._autoCloseTimeout);
      this._autoCloseTimeout = null;
    }
    if (this._videoStreamer) {
      try {
        await this._videoStreamer.stopStream();
      } catch (_) {}
      this._videoStreamer = null;
    }
    await this._unregisterCameraImageSlot();
  }

};
