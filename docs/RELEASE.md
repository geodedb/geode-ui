## Two-package release contract

The geode-ui repo emits TWO debian packages per release:

| Built by | Filename | Installs |
|---|---|---|
| goreleaser (`.goreleaser.yaml` nfpms) | `geode-ui_<version>_Linux_<arch>.deb` | `/usr/bin/geode-ui` + systemd unit + `/etc/geode-ui/`. |
| electron-builder (`electron-builder.yml`) | `geode-ui-desktop_<version>_<arch>.deb` | `/opt/Geode UI Desktop/geode-ui-desktop` + `.desktop` launcher. |

Both .deb files are uploaded to the same GitLab Release page and to
the public apt repo. The apt-repo `Packages` file lists both under
distinct `Package:` names. Operators may install either or both.

### Postinstall geode-detection

`geode-ui`'s postinstall runs
`/usr/share/geode-ui/packaging/detect-local-geode.sh` and, on a
positive hit, writes `10-local-geode.json` into
`/etc/geode-ui/seed-profiles.d/`. The detector is filesystem-only
(no network probe) so it works in chrooted package-build environments.
The server-side scan that picks the drop-in up lives in
`cmd/server/profileseed_dropin.go`.
