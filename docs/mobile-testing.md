# Testing on phones (WebAuthn + camera over HTTPS)

Fingerprint sign-in (WebAuthn) and the camera both need a **secure context**. `http://localhost`
counts as secure on the computer itself, but a phone on your Wi-Fi reaching `http://192.168.x.x`
does not, and WebAuthn **never** works on a bare IP address. So phones need a real HTTPS domain.

The simplest way is a free HTTPS tunnel to the Vite dev server. The page and the API come from
the same origin, because Vite proxies `/api` to the backend.

## 1. Start the tunnel

Install [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/)
(no account needed for a quick tunnel), then:

```bash
cloudflared tunnel --url http://localhost:5173
```

It prints a URL like `https://plain-words-here.trycloudflare.com`. Use that host below.

(ngrok works too: `ngrok http 5173`.)

## 2. Point the app at that domain

In `.env`:

```bash
WEBAUTHN_RP_ID=plain-words-here.trycloudflare.com
WEBAUTHN_ORIGINS=https://plain-words-here.trycloudflare.com
CORS_ORIGIN=https://plain-words-here.trycloudflare.com
```

Restart the backend. Start the frontend allowing that host:

```bash
cd frontend
VITE_ALLOWED_HOSTS=plain-words-here.trycloudflare.com npm run dev
# PowerShell: $env:VITE_ALLOWED_HOSTS="plain-words-here.trycloudflare.com"; npm run dev
```

## 3. Test on the phone

Open the tunnel URL on the phone:

1. **Register** (`/register`): camera permission → follow the blink / head-turn prompts.
2. Approve the voter in the admin panel (on the computer, same tunnel URL + `/admin`).
3. **Sign in** (`/login`) on the phone: face check → **Set up this device** → the phone asks for
   your fingerprint / Face ID / screen lock. You are now signed in.
4. Sign out and sign in again → **Use fingerprint** uses the same credential.

Check in both **Chrome on Android** and **Safari on iOS**:

| Check | Expected |
|---|---|
| Camera preview appears, mirrored | yes |
| "Turn your head to your left" passes when you turn to *your* left | yes — if it fails only for left/right, the yaw sign needs flipping (`ai-service/app/face_engine.py`) |
| Device setup prompts for fingerprint / Face ID | yes |
| Second sign-in uses the same credential without re-setup | yes |
| Cancel the fingerprint prompt | readable error, button works again |

## Things that will surprise you

- **Credentials are bound to the domain (RP ID).** A device set up on `localhost` won't work on the
  tunnel domain, and a quick-tunnel URL changes every time you restart cloudflared. Then the voter's
  old credential is useless and they need **device recovery**: sign in → "Lost the device…" →
  approve in admin → set up again. For repeated demos, use a fixed domain (a named Cloudflare
  tunnel or an ngrok reserved domain) so credentials survive restarts.
- **iOS Safari** only offers platform passkeys (Face ID / Touch ID) after the user taps a button.
  That's why setup and sign-in are always behind a button, never automatic.
- Passkeys synced through iCloud Keychain or Google Password Manager may report a signature
  counter of 0 every time. That's normal; the cloned-credential check only fires when the counter
  goes *down*, or stays the same after having been above 0.

## Local HTTPS without a tunnel (computer only)

`http://localhost` already works for camera and WebAuthn on the development machine, so mkcert is
only needed if you want to test with a custom local hostname. Tunnels are simpler for phones,
because mkcert's root certificate would also have to be installed on each phone.
