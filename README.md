# BTicino Door Entry for Homey

A Homey app to automate BTicino devices (locks/gates) that use the BTicino Door Entry service.

## Features

- **Seamless Authentication**: OAuth2 authentication via BTicino's Azure AD B2C service
- **Multi-Plant Support**: Manage devices across multiple BTicino plants/installations
- **Automatic Device Discovery**: Discover all BTicino locks/gates available on your account
- **Secure SIP Control**: TLS-encrypted SIP communication for gate/lock control
- **Auto-Close Support**: Optional automatic lock closing with configurable delay

## Requirements

- Homey (SDK 3, compatibility >= 12.4.0)
- Active BTicino Door Entry account with registered devices

## Pairing Flow

### First-Time Setup

1. In Homey, add a new **BTicino Lock** device
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

### Subsequent Pairing Sessions

- If credentials are already cached, Homey skips login and plant selection
- Cached data includes: authentication tokens, SIP account info, and certificates

## Device Capabilities

### Locked Capability
- **Lock/Unlock**: Close/Opens the gate/lock via SIP

### Auto-Close Setting
- **Auto-Close Lock**: Enable automatic gate closing after unlock
- **Auto-Close Delay**: Configurable delay (0-600 seconds, default: 30)

### Troubleshooting Connection Issues

If the login link is unreachable:
1. Verify your pairing device can reach Homey's local IP on port 3123
2. Check firewall rules on your network
3. Ensure Homey and pairing device are on the same network

## Security

- **OAuth2 Authentication**: Industry-standard credential management via Azure AD B2C
- **TLS Encryption**: SIP communications are encrypted with provisioned client certificates
- **Token Caching**: Tokens are securely stored in Homey settings (encrypted by Homey's native storage)

## Configuration

### Device Settings
- `autoClose` (boolean): Enable/disable auto-closing after unlock
- `autoCloseDelay` (number): Delay in seconds before auto-closing (0-600, default: 30)

## Troubleshooting

### Pairing Fails at Login
- Ensure your BTicino account credentials are correct
- Check that Homey has internet connectivity

### Pairing Fails at Plant Selection
- Ensure your BTicino account has at least one registered plant/installation
- Check Homey logs for API errors
- Restart pairing and try again

### Gate/Lock Control Not Working
- Verify the lock is online in the BTicino app
- Check that SIP account registration succeeded during pairing (check Homey logs)
- Ensure certificates are provisioned (check Homey logs)
- Restart the device or Homey if control fails sporadically

## Development

### Architecture

- **App** (`app.js`): Handles authentication setup and token/certificate lifecycle
- **Driver** (`drivers/lock/driver.js`): Manages pairing flow and device discovery
- **Device** (`drivers/lock/device.js`): Controls individual locks via SIP

### Building & Testing

```bash
# Install dependencies
npm install

# Homey CLI commands
homey app run --r             # Run app in development
```

### Dependencies

- `door-entry`: BTicino Door Entry SDK (GitHub: `s-dimaio/BTicinoDoorEntry`)

## License

GNU General Public License v3.0 - See [LICENSE](LICENSE) file for details.

## Contributing

Contributions are welcome! Please refer to [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## Support

For issues, feature requests, or questions:
1. Check this README and troubleshooting section
2. Review existing GitHub issues
3. Open a new issue with detailed logs and steps to reproduce

## Author

**Simone Di Maio**  
Email: simone.dimaio77@gmail.com

## Changelog

### v1.0.0
- Initial release
- Full pairing flow with OAuth2 authentication
- Device discovery and SIP control
- Auto-close functionality with configurable delay
- Multi-plant support
