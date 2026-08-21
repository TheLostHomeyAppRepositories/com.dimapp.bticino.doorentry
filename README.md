# BTicino Door Entry EasyKit for Homey

Control your BTicino Door Entry EasyKit system through Homey. This app requires the BTicino Door Entry service and cannot be used with other BTicino/Legrand systems or mobile apps.

## Features

- **Seamless Authentication**: OAuth2 authentication via BTicino's Azure AD B2C service
- **Multi-Plant Support**: Manage devices across multiple BTicino plants/installations
- **Automatic Device Discovery**: Discover all BTicino locks/gates available on your account
- **Secure SIP Control**: TLS-encrypted SIP communication for gate/lock control
- **Real-Time Doorbell Notifications**: SIP listener automatically detects when someone rings the doorbell
- **Flow Integration**: Trigger automations when the doorbell rings, and when service connects or disconnects (with timestamp tokens)
- **Auto-Close Support**: Optional automatic lock closing with configurable delay
- **Device Repair Workflow**: Easily re-authenticate and repair devices without deleting them or breaking existing Flows
- **Modern App Settings**: Single Page Application (SPA) with live service diagnostics, debug controls, and account management

## Requirements

- Homey (SDK 3, compatibility >= 12.4.0)
- BTicino system using the Door Entry mobile app (e.g., EasyKit systems)
- Active Door Entry account with registered devices

## Pairing & Repair Flow

### First-Time Setup (Pairing)

1. In Homey, add a new **BTicino EasyKit** device
2. Click **Open login page** to authenticate with your BTicino account
   - A temporary OAuth2 proxy runs on your Homey (port 3123 by default)
   - Use the same credentials as your Door Entry mobile app
3. After successful Azure AD B2C authentication, return to Homey
4. Select your BTicino plant from the list
5. Homey will automatically:
   - Register a dedicated SIP account
   - Provision TLS client certificates for secure communication
   - Discover all available locks/gates
6. Select the devices you want to expose in Homey and complete the wizard

### Repair Flow (Reconnection)

If your account credentials expire or you disconnected your account:
1. Open the device settings in the Homey app and tap **Repair** (or **Maintenance**)
2. Log in with your BTicino credentials
3. Select your plant
4. Homey will refresh your tokens and certificates, reconnect the SIP listener, and restore all your devices to the **Available** state without deleting your devices or breaking existing Flows!

## Device Capabilities

### Locked Capability
- **Lock/Unlock**: Opens/closes the gate or lock via SIP TLS

### Auto-Close Setting
- **Auto-Close Lock**: Enable automatic gate closing after unlock
- **Auto-Close Delay**: Configurable delay (0-600 seconds, default: 30)

## Flow Cards

### Trigger Cards

#### Doorbell Rang
Triggers when someone rings the doorbell. The SIP listener automatically detects incoming calls and triggers this flow card.

**Tokens:**
- `timestamp`: The time when the doorbell rang, formatted according to your Homey's language and timezone settings

#### Service Connected
Triggers when the app successfully connects and registers to the BTicino SIP cloud service.

**Tokens:**
- `timestamp`: The formatted time when the service connected

#### Service Disconnected
Triggers when the connection to the BTicino SIP cloud service is lost or the account is disconnected.

**Tokens:**
- `timestamp`: The formatted time when the service disconnected

## App Settings

The app features a modern, responsive Single Page Application (SPA) accessible under Homey Settings:
- **Service Status**: View live SIP connection and authentication status
- **Diagnostic Tools**: Quick status overview and debug logging toggle
- **Account Management**: Safely disconnect your account without deleting your devices

## Security

- **OAuth2 Authentication**: Industry-standard credential management via Azure AD B2C
- **TLS Encryption**: SIP communications are encrypted with provisioned mTLS client certificates
- **Secure Storage**: Tokens and certificates are securely stored in encrypted Homey settings

## Development

### Building & Running

```bash
# Install dependencies from GitHub
npm install

# Run app in development mode with live streaming logs
homey app run --r

# Validate app for publication
homey app validate --level publish
```

### Dependencies

- `door-entry`: BTicino Door Entry SDK (GitHub: `s-dimaio/BTicinoDoorEntry`)

## License

GNU General Public License v3.0 - See [LICENSE](LICENSE) file for details.

## Contributing

Contributions are welcome! Please refer to [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## Author

**Simone Di Maio**  
Email: simone.dimaio77@gmail.com

## Changelog

### v1.2.0
- Added Flow trigger cards to receive notifications on BTicino service connection status (connected / disconnected)
- Redesigned App Settings with a modern Single Page Application (SPA) interface and toast notifications
- Added account disconnection feature without deleting existing devices or breaking Flows
- Added full support for device repair to reconnect without losing devices or Flows
- Migrated driver to `easykit` and updated `door-entry` SDK to v2.0.10
- General performance improvements and optimizations

### v1.1.1
- Added real-time doorbell notifications via SIP listener
- Added Flow trigger card "Doorbell rang" with timestamp token
- Improved credential caching for faster subsequent pairings
- Added automatic SIP listener reconnection on connection loss
- Added timezone and language-aware timestamp formatting
- Improved error handling and logging throughout the app

### v1.0.0
- Initial release
- Full pairing flow with OAuth2 authentication
- Device discovery and SIP control
- Auto-close functionality with configurable delay
- Multi-plant support
