# BTicino Door Entry EasyKit for Homey

Control your BTicino Door Entry EasyKit system through Homey. This app integrates gates, locks, and outdoor video intercom cameras via BTicino's Door Entry cloud and SIP/TLS infrastructure.

> **Note:** This app requires a BTicino **EasyKit** (or compatible) system configured with the **Door Entry EASYKIT** mobile app and cannot be used with unrelated BTicino/Legrand apps.

## Features

- **Seamless Authentication**: OAuth2 authentication via BTicino's Azure AD B2C service with automatic token refresh
- **Multi-Plant Support**: Manage devices across multiple BTicino plants/installations
- **Automatic Device Discovery**: Automatically discovers gates/locks and outdoor video cameras (including secondary camera channels) with dedicated icons
- **Gate & Lock Control**: Secure mTLS-encrypted SIP control with optional configurable auto-close delay
- **Live Camera Video Streaming**: Real-time H.264 RTSP live video stream directly inside Homey camera devices
- **On-Demand Snapshot Flows**: Capture fresh JPEG snapshots from your outdoor camera inside Flows and send them via push notifications or other image-capable cards
- **Real-Time Doorbell & Missed Call Detection**: Persistent SIP/TLS listener detects incoming doorbell rings and unanswered calls in real time
- **Comprehensive Flow Cards**: Triggers for doorbell rang, missed call, service connected/disconnected; condition for service connection state; action card for camera snapshot capture
- **Device Repair Workflow**: Re-authenticate and refresh tokens/certificates without deleting devices or breaking existing Flows
- **Modern App Settings (SPA)**: Single Page Application with live SIP status, debug logging toggle, API diagnostics JSON export/download, and safe account disconnection

## Requirements

- Homey Pro (SDK 3, compatibility `>= 12.4.0`, local platform)
- BTicino system using the **Door Entry EASYKIT** mobile app
- Active BTicino / Legrand account with registered devices

## Pairing & Repair Flow

### First-Time Setup (Pairing)

1. In Homey, add a new **EasyKit** device under **BTicino Door Entry EasyKit**
2. Click **Open login page** to authenticate with your BTicino account
   - A temporary OAuth2 proxy runs on your Homey during pairing
   - Use the same credentials as your Door Entry mobile app
3. After successful Azure AD B2C authentication, return to Homey
4. Select your BTicino plant from the list
5. Homey will automatically:
   - Register a dedicated SIP account
   - Provision mTLS client certificates (ECC P-256) for secure communication
   - Discover all available locks/gates and outdoor cameras
6. Select the devices you want to add to Homey and complete the wizard

### Repair Flow (Reconnection)

If your account credentials expire or you disconnected your account:
1. Open the device settings in the Homey app and tap **Repair** (or **Maintenance**)
2. Log in with your BTicino credentials and select your plant
3. Homey will refresh your tokens and certificates, reconnect the SIP listener, and restore your devices to the **Available** state without deleting them or breaking existing Flows

## Supported Device Types

### Locks & Gates (`class: "lock"`)
- **Locked Capability**: Unlock/open your pedestrian gate or door lock via SIP/TLS
- **Auto-Close Lock**: Automatically reset the `locked` capability after a configurable delay (`0–600` seconds, default: `30`)

### Outdoor Cameras (`class: "camera"`)
- **Live Video Stream**: View the outdoor station live H.264 video feed directly in the Homey Mobile & Web app
- **Flow Snapshots**: Capture live JPEG snapshots on demand via the **Take a snapshot** Flow action card

### Device Settings
- **Module ID (`moduleId`)**: Unique BTicino module UUID associated with the device (can be inspected or overridden from App Settings diagnostics)
- **Channel Index (`cameraIndex`)**: Device channel (`0` = Lock/Gate, `1` = Main outdoor camera, `>1` = Secondary cameras)
- **Auto-Close Lock (`autoClose`)**: Enable/disable automatic lock state reset (for lock devices)
- **Auto-Close Delay (`autoCloseDelay`)**: Delay in seconds before auto-close resets (for lock devices)

## Flow Cards

### Trigger Cards

#### Doorbell rang (`doorbell_rang`)
Triggers immediately when someone rings the doorbell.

**Tokens:**
- `timestamp` (`string`): Time when the doorbell rang, formatted using Homey's language and timezone

#### Doorbell call missed (`doorbell_call_missed`)
Triggers when someone rings the doorbell and nobody answers before the call ends.

**Tokens:**
- `timestamp` (`string`): Time of the missed call, formatted using Homey's language and timezone

#### BTicino service connected (`service_connected`)
Triggers when the app connects and registers with the BTicino SIP cloud service.

**Tokens:**
- `timestamp` (`string`): Formatted connection timestamp

#### BTicino service disconnected (`service_disconnected`)
Triggers when the connection to the BTicino SIP cloud service is lost or the account is disconnected.

**Tokens:**
- `timestamp` (`string`): Formatted disconnection timestamp

### Condition Cards

#### BTicino service is / is not connected (`service_is_connected`)
Checks whether the app is currently connected and registered to the BTicino SIP cloud service.

### Action Cards

#### Take a snapshot (`take_snapshot`)
Captures a fresh JPEG snapshot from a selected EasyKit camera device.

**Arguments:**
- `device`: Target camera device (`driver_id=easykit&class=camera`)

**Tokens (available under *This Flow*):**
- `snapshot` (`image`): The captured JPEG snapshot image, ready for push notifications or other image-accepting Flow cards

## App Settings

Accessible in Homey under **Apps > BTicino Door Entry EasyKit > Configure**:
- **Account**: View Plant ID, Gateway ID, live SIP listener status, and safely disconnect your account without removing devices
- **Debug & Diagnostics**: Toggle detailed debug logging and fetch/download/delete diagnostic API dumps (Plants, Modules, SIP Accounts) for troubleshooting

## Security

- **OAuth2 Authentication**: Standard credential management via Azure AD B2C (credentials are never stored in plain text)
- **mTLS Encryption**: All SIP signaling and SRTP video communications are encrypted with provisioned client certificates and ECC P-256 private keys
- **Encrypted Storage**: Tokens, SIP credentials, and certificates are stored securely in Homey app settings
- **Clean Git Ignore**: Build outputs, local logs, diagnostic dumps, credentials, and dev-only scripts are excluded via `.gitignore` and `.homeyignore`

## Development

### Building & Running from GitHub

```bash
# Install dependencies (fetches door-entry SDK from GitHub)
npm install

# Run app in development mode with live logs
homey app run --r
# or using the npm script:
npm run debug:github

# Validate app for publication
homey app validate --level publish
```

### Dependencies

- `door-entry`: BTicino Door Entry Node.js SDK (`github:s-dimaio/BTicinoDoorEntry`)
- `h264decoder`: WebAssembly H.264 decoder for keyframe snapshot extraction
- `jpeg-js`: Pure JavaScript JPEG encoder

## License

GNU General Public License v3.0 — See the [LICENSE](LICENSE) file for details.

## Contributing

Contributions are welcome! Please refer to [CONTRIBUTING.md](CONTRIBUTING.md) and [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

## Author

**Simone Di Maio**  
Email: simone.dimaio77@gmail.com  
GitHub: [s-dimaio](https://github.com/s-dimaio)

## Changelog

### v2.0.0
- Added support for outdoor intercom cameras (`class: "camera"`) with live H.264 RTSP video streaming
- Added Flow action card **Take a snapshot** (`take_snapshot`) providing an image token for notifications
- Added Flow trigger card **Doorbell call missed** (`doorbell_call_missed`) with timestamp token
- Added dedicated custom vector icons for camera and lock devices
- Updated `door-entry` SDK dependency to `v2.1.0`
- General improvements and optimizations

### v1.2.3
- Added Flow condition card to check BTicino service connection status (`connected` / `disconnected`)
- General improvements and optimizations

### v1.2.2
- Added configurable Gate Module ID (`moduleId`) in device settings
- Settings UI alignment and dependency updates

### v1.2.0
- Added Flow trigger cards for BTicino service connection status (`service_connected`, `service_disconnected`)
- Redesigned App Settings as a modern Single Page Application (SPA)
- Added safe account disconnection without deleting devices or breaking Flows
- Added full device repair workflow to reconnect without losing devices or Flows
- Migrated driver to `easykit`

### v1.1.x
- Added real-time doorbell notifications via SIP listener (`doorbell_rang`)
- Added timezone and language-aware timestamp tokens
- Added debug logging & diagnostics settings

### v1.0.0
- Initial release with OAuth2 pairing, device discovery, SIP lock control, auto-close, and multi-plant support
