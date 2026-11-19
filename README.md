# EventMesh

EventMesh runs across four devices on the same trusted Wi-Fi/LAN:

- **Laptop 1:** API server and SQLite database
- **Laptop 2:** Event and seat management
- **Laptop 3:** Ticket validation and QR scanning
- **Laptop 4:** Attendee booking and downloadable QR tickets

Laptop 2 can mark an event as requiring a demo payment, set its PHP ticket
price, and choose accepted eWallets. Laptop 4 requires the attendee to confirm
the exact amount with one of those wallets before booking. This is presentation
only: no payment provider or real money is involved. The eWallet account field
is used only to validate the demo form and is not saved with the ticket; use a
demo value and never enter a PIN or OTP.

Each device needs Node.js LTS and npm. Laptop 1 keeps the server project. For
the other devices, distribute only the matching app folder:

- Laptop 2 gets `laptop2-ticketing/`
- Laptop 3 gets `laptop3-attendee/`
- Laptop 4 gets `laptop4-attendee/`

Each app folder includes its source, assets, package files, and `.env.example`.
Do not distribute Laptop 1's `.env` or `data/eventmesh.sqlite`; those contain
the server secret and database. Do not copy `node_modules` or build folders.

## 1. Start Laptop 1 (server)

On Laptop 1, open PowerShell, Terminal, or Command Prompt in the
`laptop1-server` folder:

```sh
npm ci
```

If `laptop1-server/.env` does not already exist, create it from the template.
Keep an existing server `.env` unchanged when it already contains the secret
used to sign tickets in the current database.

**Windows PowerShell**

```powershell
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
notepad .env
```

**macOS/Linux**

```sh
test -f .env || cp .env.example .env
```

Set `HMAC_SECRET` to a private, random, stable value in that file. For example,
generate one with Node.js:

```sh
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Keep the same secret while using this database; changing it makes already
issued QR signatures fail validation. Do not share the server `.env`.

Find Laptop 1's IPv4 address:

- **Windows:** run `ipconfig` and use the IPv4 address for the Wi-Fi adapter.
- **macOS:** run `ipconfig getifaddr en0` (if that returns nothing, check
  `ifconfig` for the active Wi-Fi interface).
- **Linux:** run `hostname -I` and use the LAN address.

Start the server:

```sh
npm start
```

The server listens on port `5001` and stores data in
`laptop1-server/data/eventmesh.sqlite`.

### Windows firewall

If Windows asks whether Node.js can accept connections, allow it on **Private
networks only**. If the prompt was dismissed, open PowerShell as Administrator
on Laptop 1 and run:

```powershell
New-NetFirewallRule -DisplayName "EventMesh API 5001" -Direction Inbound -Protocol TCP -LocalPort 5001 -Action Allow -Profile Private
```

Do not expose port `5001` to public networks or the internet.

## 2. Configure and run each client laptop

On each client device, extract its distributed app folder and open a terminal
in that folder. For example, on Laptop 2 the terminal should be inside
`laptop2-ticketing/`. Create `.env` from `.env.example` if it does not exist,
then set `REACT_APP_SERVER_IP` to Laptop 1's IPv4 address and keep
`REACT_APP_SERVER_PORT=5001`.

**Windows PowerShell:** Run the matching block inside the corresponding
distributed app folder. Edit `.env` to set the server IP.

```powershell
# Laptop 2
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
notepad .env
npm ci
npm start
```

```powershell
# Laptop 3
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
notepad .env
npm ci
npm start
```

```powershell
# Laptop 4
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
notepad .env
npm ci
npm start
```

**macOS/Linux:** Likewise, run the matching block inside that app's folder.

```sh
# Laptop 2
test -f .env || cp .env.example .env
nano .env
npm ci
npm start
```

```sh
# Laptop 3
test -f .env || cp .env.example .env
nano .env
npm ci
npm start
```

```sh
# Laptop 4
test -f .env || cp .env.example .env
nano .env
npm ci
npm start
```

In each app's `.env`, replace the example `REACT_APP_SERVER_IP` with Laptop
1's LAN IP. Leave the terminal open while the app runs.

| Device | Folder | Local browser address |
|---|---|---|
| Laptop 2 | `laptop2-ticketing` | `http://localhost:3002` |
| Laptop 3 | `laptop3-attendee` | `http://localhost:3003` |
| Laptop 4 | `laptop4-attendee` | `http://localhost:3004` |

Keep each laptop's terminal open while its app is in use. After changing a
client `.env`, restart that app.

Laptop 3's camera scanner needs camera permission. Open the app on Laptop 3 at
`http://localhost:3003` (not through another laptop's IP); localhost is
necessary for browser camera access over this local development setup.

## 3. Check the connection

On each client laptop, open:

```text
http://<LAPTOP1-IP>:5001/api/v1/health
```

It should return a small JSON response with `"status":"ONLINE"`. If it does
not, confirm the laptops are on the same Wi-Fi/LAN, recheck Laptop 1's IP, and
check the firewall rule. In Windows PowerShell, test the port with:

```powershell
Test-NetConnection <LAPTOP1-IP> -Port 5001
```

If the health check fails, verify the client app `.env` has the correct server
IP and restart the client app.

## Run everything on one computer

For local development only, when the complete repository is on one computer,
install dependencies from the project folder:

```sh
npm ci
npm --prefix laptop1-server ci
npm --prefix laptop2-ticketing ci
npm --prefix laptop3-attendee ci
npm --prefix laptop4-attendee ci
npm run start:all
```

Set the three client `.env` files' `REACT_APP_SERVER_IP` to `localhost` first.
This starts all four services on the same computer. It is not the command for
distributing the roles across separate devices.

See [laptop1-server/LOCAL_STORAGE.md](./laptop1-server/LOCAL_STORAGE.md) for
database backup and storage details.
