# Installing Geode UI

Geode UI ships in two complementary packages:

| Package | Audience | Install |
|---|---|---|
| `geode-ui` | Headless service (run alongside `geode` on a server or workstation). systemd-managed; listens on 127.0.0.1:8080 by default. | `sudo apt install geode-ui` |
| `geode-ui-desktop` | Electron desktop wrapper. Talks to any reachable `geode-ui` HTTP origin. | `sudo apt install ./geode-ui-desktop_<version>_<arch>.deb` |

Most operators install both: `geode-ui` runs the API server, and
`geode-ui-desktop` is the GUI that connects to it.

## 1. Headless service via apt (Debian/Ubuntu)

```bash
# Add the Geode apt repository (one-time).
curl -fsSL https://gitlab.com/devnw/codepros/geode/geode-ui/-/raw/main/deployment/apt-key.gpg \
  | sudo gpg --dearmor -o /usr/share/keyrings/geode-archive-keyring.gpg
echo "deb [signed-by=/usr/share/keyrings/geode-archive-keyring.gpg] https://apt.geodedb.com stable main" \
  | sudo tee /etc/apt/sources.list.d/geode.list

# Install the service.
sudo apt update
sudo apt install geode-ui
```

The postinstall:

1. Creates the `geode-ui` system user.
2. Drops `/lib/systemd/system/geode-ui.service` and enables it.
3. If `geode` is installed on the same host, writes
   `/etc/geode-ui/seed-profiles.d/10-local-geode.json` pointing at
   `quic://localhost:3141`. On first launch the server seeds this as
   a `scope=system` profile so the SPA shows it in the connection
   picker out of the box.
4. Starts `geode-ui.service`. Verify with:

```bash
systemctl status geode-ui.service
curl http://127.0.0.1:8080/api/v1/healthz
```

## 2. Headless service via direct dpkg

```bash
curl -fLO https://gitlab.com/devnw/codepros/geode/geode-ui/-/releases/v<version>/downloads/geode-ui_<version>_Linux_x86_64.deb
sudo dpkg -i geode-ui_<version>_Linux_x86_64.deb
```

## 3. Desktop app via apt

```bash
sudo apt install geode-ui-desktop
geode-ui-desktop  # launches the electron window
```

If `geode-ui` is also installed locally, the desktop app auto-connects
to `http://127.0.0.1:8080`. To point at a remote host, set the
`GEODE_SERVER_URL` env var (e.g. via a `.desktop` file or a wrapper
script).

## 4. Co-resident with `geode`

The intended pairing is `apt install geode geode-ui` on the same host:

```bash
sudo apt install geode geode-ui
```

apt installs both binaries, starts both systemd services, and the
geode-ui postinstall seeds the local-geode profile. Open the SPA at
`http://127.0.0.1:8080` and the connection picker already shows
`local-geode`.

## 5. Configuration

Edit `/etc/geode-ui/geode-ui.conf` and restart:

```bash
sudo systemctl restart geode-ui.service
```

The conf file documents every knob inline. Common overrides:

- `GEODE_UI_LISTEN=0.0.0.0:8080` to expose on the LAN.
- `GEODE_UI_PROFILE_SEED_DIR=` to disable the drop-in scanner.

## 6. Removal

```bash
sudo apt remove geode-ui        # stops + removes the service; keeps /var/lib/geode-ui
sudo apt purge geode-ui         # also wipes profile store + uploads
```
