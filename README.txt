Homey app to automate BTicino devices that uses Door Entry app.

## Pairing flow

1. Add the **BTicino Lock** driver from Homey and wait for the login screen.
2. Click **Open login page** to launch the temporary BTicino proxy running on your Homey and sign in with the same credentials used for the Door Entry mobile app.
3. After the Azure AD B2C flow redirects back to the proxy, return to Homey and press **I signed in**.
4. Homey automatically discovers all BTicino locks available on your account, registers a dedicated SIP account for Homey, and provisions TLS client certificates for secure SIP control.
5. Select the gate/lock you want to expose in Homey and finish the wizard. Each device keeps its SIP credentials and certificates in the device store so you can trigger the *locked* capability to open the gate.

> **Tip:** if the login link is not reachable from your browser, make sure the device you are pairing from can reach the Homey IP address on the local network (port 3123 by default).
