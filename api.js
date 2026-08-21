'use strict';

const fs = require('fs').promises;
const path = require('path');

module.exports = {
  /**
   * Get the current BTicino account and SIP listener connection status.
   * @public
   * @async
   * @param {Object} context - Homey API context
   * @param {Object} context.homey - Homey app instance
   * @returns {Promise<{connected: boolean, plantId: string|null, gatewayId: string|null, sipConnected: boolean, tokenExpiresAt: string|null}>}
   * @example
   * const status = await Homey.api('GET', '/account/status');
   */
  async getAccountStatus({ homey }) {
    try {
      const token = homey.settings.get('token');
      const sipAccount = homey.settings.get('sip_account');
      const certs = homey.settings.get('certificates');
      const plantId = homey.settings.get('plantId');
      const gatewayId = homey.settings.get('gatewayId');

      const isConnected = !!(token && sipAccount && certs && plantId && gatewayId);
      let isSipConnected = false;

      if (homey.app.auth && typeof homey.app.auth.isSipListenerConnected === 'function') {
        isSipConnected = homey.app.auth.isSipListenerConnected();
      }

      return {
        connected: isConnected,
        plantId: plantId || null,
        gatewayId: gatewayId || null,
        sipConnected: isSipConnected,
        tokenExpiresAt: token?.expiresAt || null
      };
    } catch (error) {
      homey.app.error('[API] Failed to get account status:', error.message);
      return {
        connected: false,
        plantId: null,
        gatewayId: null,
        sipConnected: false,
        error: error.message
      };
    }
  },

  /**
   * Disconnect BTicino account, stopping the SIP listener and marking devices unavailable.
   * @public
   * @async
   * @param {Object} context - Homey API context
   * @param {Object} context.homey - Homey app instance
   * @returns {Promise<{success: boolean, error?: string}>}
   * @example
   * const result = await Homey.api('POST', '/account/disconnect');
   */
  async disconnectAccount({ homey }) {
    try {
      await homey.app.disconnectAccount();
      return { success: true };
    } catch (error) {
      homey.app.error('[API] Failed to disconnect account:', error.message);
      return { success: false, error: error.message };
    }
  },

  /**
   * Fetch plants from BTicino API and save to /userdata/
   */
  async getDiagnosticPlants({ homey }) {
    try {
      const auth = homey.app.auth;
      
      if (!auth) {
        throw new Error('Authentication not initialized');
      }

      // Create API client
      const api = auth.createApiClient();
      
      // Fetch plants
      const plants = await api.getPlants();
      
      // Prepare data
      const data = {
        timestamp: new Date().toISOString(),
        statusCode: 200,
        data: plants
      };
      
      // Save to userdata
      const filename = 'plants.json';
      const filepath = path.join('/userdata', filename);
      await fs.writeFile(filepath, JSON.stringify(data, null, 2), 'utf8');
      
      homey.app.log(`[API] Saved plants diagnostic to ${filename}`);
      
      // Get local IP for download URL
      const localAddress = await homey.cloud.getLocalAddress();
      const ipAddress = localAddress.split(':')[0];
      const downloadUrl = `http://${ipAddress}/app/${homey.manifest.id}/userdata/${filename}`;
      
      return {
        success: true,
        filename,
        url: downloadUrl,
        recordCount: Array.isArray(plants) ? plants.length : 0
      };
      
    } catch (error) {
      homey.app.error('[API] Failed to fetch plants:', error.message);
      
      // Save error to file for debugging
      const errorData = {
        timestamp: new Date().toISOString(),
        error: error.message,
        statusCode: error.response?.status || 500,
        responseData: error.response?.data || null
      };
      
      const filename = 'plants_error.json';
      const filepath = path.join('/userdata', filename);
      await fs.writeFile(filepath, JSON.stringify(errorData, null, 2), 'utf8');
      
      const localAddress = await homey.cloud.getLocalAddress();
      const ipAddress = localAddress.split(':')[0];
      const downloadUrl = `http://${ipAddress}/app/${homey.manifest.id}/userdata/${filename}`;
      
      return {
        success: false,
        filename,
        url: downloadUrl,
        error: error.message
      };
    }
  },

  /**
   * Fetch modules for a specific plant from BTicino API and save to /userdata/
   */
  async getDiagnosticModules({ homey }) {
    try {
      // Get plantId from Homey settings
      const plantId = homey.settings.get('plantId');
      
      if (!plantId) {
        throw new Error('No plantId found in settings. Please pair a device first.');
      }

      const auth = homey.app.auth;
      
      if (!auth) {
        throw new Error('Authentication not initialized');
      }

      // Create API client
      const api = auth.createApiClient();
      
      // Fetch modules
      const modules = await api.getModules(plantId);
      
      // Prepare data
      const data = {
        timestamp: new Date().toISOString(),
        plantId,
        statusCode: 200,
        data: modules
      };
      
      // Save to userdata
      const filename = 'modules.json';
      const filepath = path.join('/userdata', filename);
      await fs.writeFile(filepath, JSON.stringify(data, null, 2), 'utf8');
      
      homey.app.log(`[API] Saved modules diagnostic to ${filename}`);
      
      const localAddress = await homey.cloud.getLocalAddress();
      const ipAddress = localAddress.split(':')[0];
      const downloadUrl = `http://${ipAddress}/app/${homey.manifest.id}/userdata/${filename}`;
      
      return {
        success: true,
        filename,
        url: downloadUrl,
        recordCount: Array.isArray(modules) ? modules.length : 0
      };
      
    } catch (error) {
      homey.app.error('[API] Failed to fetch modules:', error.message);
      
      // Save error to file
      const errorData = {
        timestamp: new Date().toISOString(),
        plantId: homey.settings.get('plantId'),
        error: error.message,
        statusCode: error.response?.status || 500,
        responseData: error.response?.data || null
      };
      
      const filename = 'modules_error.json';
      const filepath = path.join('/userdata', filename);
      await fs.writeFile(filepath, JSON.stringify(errorData, null, 2), 'utf8');
      
      const localAddress = await homey.cloud.getLocalAddress();
      const ipAddress = localAddress.split(':')[0];
      const downloadUrl = `http://${ipAddress}/app/${homey.manifest.id}/userdata/${filename}`;
      
      return {
        success: false,
        filename,
        url: downloadUrl,
        error: error.message
      };
    }
  },

  /**
   * Fetch SIP accounts from BTicino API and save to /userdata/
   */
  async getDiagnosticSipAccounts({ homey }) {
    try {
      const auth = homey.app.auth;
      
      if (!auth) {
        throw new Error('Authentication not initialized');
      }

      // Get gatewayId from Homey settings
      const gatewayId = homey.settings.get('gatewayId');
      
      if (!gatewayId) {
        throw new Error('No gatewayId found in settings. Please pair a device first.');
      }

      // Create API client
      const api = auth.createApiClient();
      
      // Fetch SIP accounts with gatewayId
      const sipAccounts = await api.getSipAccounts(gatewayId);
      
      // Prepare data
      const data = {
        timestamp: new Date().toISOString(),
        statusCode: 200,
        data: sipAccounts
      };
      
      // Save to userdata
      const filename = 'sip_accounts.json';
      const filepath = path.join('/userdata', filename);
      await fs.writeFile(filepath, JSON.stringify(data, null, 2), 'utf8');
      
      homey.app.log(`[API] Saved SIP accounts diagnostic to ${filename}`);
      
      const localAddress = await homey.cloud.getLocalAddress();
      const ipAddress = localAddress.split(':')[0];
      const downloadUrl = `http://${ipAddress}/app/${homey.manifest.id}/userdata/${filename}`;
      
      return {
        success: true,
        filename,
        url: downloadUrl,
        recordCount: Array.isArray(sipAccounts) ? sipAccounts.length : 0
      };
      
    } catch (error) {
      homey.app.error('[API] Failed to fetch SIP accounts:', error.message);
      
      // Save error to file
      const errorData = {
        timestamp: new Date().toISOString(),
        error: error.message,
        statusCode: error.response?.status || 500,
        responseData: error.response?.data || null
      };
      
      const filename = 'sip_accounts_error.json';
      const filepath = path.join('/userdata', filename);
      await fs.writeFile(filepath, JSON.stringify(errorData, null, 2), 'utf8');
      
      const localAddress = await homey.cloud.getLocalAddress();
      const ipAddress = localAddress.split(':')[0];
      const downloadUrl = `http://${ipAddress}/app/${homey.manifest.id}/userdata/${filename}`;
      
      return {
        success: false,
        filename,
        url: downloadUrl,
        error: error.message
      };
    }
  },

  /**
   * List all diagnostic files in /userdata/
   */
  async listDiagnosticFiles({ homey }) {
    try {
      const files = await fs.readdir('/userdata');
      
      const diagnosticFiles = [];
      const localAddress = await homey.cloud.getLocalAddress();
      const ipAddress = localAddress.split(':')[0];
      
      for (const file of files) {
        // Include both .json and .log files
        if (file.endsWith('.json') || file.endsWith('.log')) {
          const filepath = path.join('/userdata', file);
          const stats = await fs.stat(filepath);
          
          diagnosticFiles.push({
            filename: file,
            url: `http://${ipAddress}/app/${homey.manifest.id}/userdata/${file}`,
            size: stats.size,
            created: stats.birthtime.toISOString()
          });
        }
      }
      
      // Sort by creation date (newest first)
      diagnosticFiles.sort((a, b) => new Date(b.created) - new Date(a.created));
      
      return {
        success: true,
        files: diagnosticFiles,
        count: diagnosticFiles.length
      };
      
    } catch (error) {
      homey.app.error('[API] Failed to list diagnostic files:', error.message);
      return {
        success: false,
        error: error.message,
        files: [],
        count: 0
      };
    }
  },

  /**
   * Delete a diagnostic file from /userdata/
   */
  async deleteDiagnosticFile({ homey, params }) {
    try {
      let { filename } = params;
      
      if (!filename) {
        throw new Error('filename parameter is required');
      }

      // Decode filename if it was URL encoded
      filename = decodeURIComponent(filename);

      // Security: prevent directory traversal
      if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
        throw new Error('Invalid filename');
      }

      const filepath = path.join('/userdata', filename);
      
      // Check if file exists
      try {
        await fs.access(filepath);
      } catch (err) {
        return {
          success: false,
          error: `File not found: ${filename}`
        };
      }
      
      await fs.unlink(filepath);
      
      homey.app.log(`[API] Deleted diagnostic file: ${filename}`);
      
      return {
        success: true,
        message: `File ${filename} deleted successfully`,
        deletedFile: filename
      };
      
    } catch (error) {
      homey.app.error('[API] Failed to delete diagnostic file:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  },

  /**
   * Delete all diagnostic files from /userdata/
   */
  async deleteAllDiagnosticFiles({ homey }) {
    try {
      const files = await fs.readdir('/userdata');
      
      let deletedCount = 0;
      
      for (const file of files) {
        if (file.endsWith('.json')) {
          const filepath = path.join('/userdata', file);
          await fs.unlink(filepath);
          deletedCount++;
        }
      }
      
      homey.app.log(`[API] Deleted ${deletedCount} diagnostic files`);
      
      return {
        success: true,
        message: `${deletedCount} file(s) deleted successfully`,
        deletedCount
      };
      
    } catch (error) {
      homey.app.error('[API] Failed to delete diagnostic files:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }
};
