# Deploy Guide — TextMyAgent Desktop

## Quick Reference

| Command | What | Time | Use When |
|---|---|---|---|
| `npm run dist:mac:fast` | arm64 zip, no notarize | ~2 min | Day-to-day dev testing |
| `npm run dist:mac:arm64` | arm64 dmg+zip, notarized | ~15 min | Testing on Apple Silicon |
| `npm run dist:mac:x64` | x64 dmg+zip, notarized | ~15 min | Testing on Intel Macs |
| `npm run dist:mac:release` | Both archs, full build | ~30 min | GitHub release |

## Prerequisites

### 1. Apple Developer Certificate

You need a **Developer ID Application** certificate installed in your Keychain:
```
EVERJUST COMPANY (8769U6225R)
```

Verify it's installed:
```bash
security find-identity -v -p codesigning | grep "EVERJUST"
```

### 2. Notarization Keychain Profile

Set up once (already done on this machine):
```bash
xcrun notarytool store-credentials "textmyagent-notarize" \
  --key ~/.appstoreconnect/private_keys/AuthKey_578PPBSM69.p8 \
  --key-id 578PPBSM69 \
  --issuer 858e0667-11ee-48aa-9e2e-c750c81d1361
```

### 3. node-llama-cpp Custom Build

Gemma 4 requires a recent llama.cpp build. Build once after `npm install`:
```bash
npx --no node-llama-cpp source download --release latest
npx --no node-llama-cpp source build --gpu metal
```

This creates a local build at `node_modules/node-llama-cpp/llama/localBuilds/mac-arm64-metal/`.

## Dev Build (Fast)

For quick testing on your M-series Mac:
```bash
npm run dist:mac:fast
```

Output: `build/TextMyAgent-2.x.x-arm64.zip`

Unzip and run — no notarization, so macOS may warn about unsigned app. Right-click → Open to bypass.

## Release Build

### Local Release

```bash
npm run dist:mac:release
```

Produces 4 artifacts in `build/`:
- `TextMyAgent-2.x.x-arm64.dmg`
- `TextMyAgent-2.x.x-arm64.zip`
- `TextMyAgent-2.x.x-x64.dmg` (cross-compiled for Intel)
- `TextMyAgent-2.x.x-x64.zip`

### GitHub Release (CI/CD)

Push a version tag to trigger the automated release:
```bash
# Bump version in package.json first
npm version patch  # or minor, major
git push origin main --tags
```

The GitHub Actions workflow will:
1. Run tests
2. Build for both architectures
3. Sign and notarize
4. Create a GitHub Release with all artifacts

### Manual GitHub Release

```bash
# Build locally
npm run dist:mac:release

# Create release on GitHub
gh release create v2.x.x build/*.dmg build/*.zip --title "v2.x.x" --notes "Release notes here"
```

## Environment Variables

| Variable | Purpose | Required |
|---|---|---|
| `SKIP_NOTARIZATION=true` | Skip Apple notarization | No (dev only) |
| `NODE_LLAMA_CPP_DEBUG=true` | Enable llama.cpp debug logs | No |
| `CSC_LINK` | Path to .p12 cert (CI) | CI only |
| `CSC_KEY_PASSWORD` | Cert password (CI) | CI only |
| `APPLE_API_KEY` | App Store Connect key path (CI) | CI only |
| `APPLE_API_KEY_ID` | API key ID (CI) | CI only |
| `APPLE_API_ISSUER` | API issuer ID (CI) | CI only |

## CI/CD (GitHub Actions)

Two workflows in `.github/workflows/`:

### `ci.yml` — Runs on every push/PR to `main`
- Installs dependencies
- Runs all tests (`npm test`)
- TypeScript type-check

### `release.yml` — Runs when you push a version tag
- Runs tests
- Builds arm64 on `macos-14` (Apple Silicon runner)
- Builds x64 on `macos-13` (Intel runner)
- Signs, notarizes, and creates GitHub Release with all artifacts

### Setting Up GitHub Secrets

Go to **Settings → Secrets and variables → Actions** in your GitHub repo and add:

| Secret | Value | How to get it |
|---|---|---|
| `CSC_LINK` | Base64-encoded .p12 certificate | `base64 -i cert.p12 \| pbcopy` |
| `CSC_KEY_PASSWORD` | Password for the .p12 file | Set when exporting from Keychain |
| `APPLE_API_KEY` | Base64-encoded App Store Connect .p8 key | `base64 -i AuthKey_578PPBSM69.p8 \| pbcopy` |
| `APPLE_API_KEY_ID` | API Key ID | `578PPBSM69` |
| `APPLE_API_ISSUER` | Issuer ID | `858e0667-11ee-48aa-9e2e-c750c81d1361` |

### Creating a Release

```bash
# 1. Bump version
npm version patch  # or minor, major

# 2. Push with tag
git push origin main --tags
```

The release workflow triggers automatically on the `v*` tag push.

### Running Without Secrets (Skip Notarize)

If secrets aren't configured, the build will fail at notarization. To test CI without notarization, you can temporarily add `SKIP_NOTARIZATION: 'true'` to the env block in the workflow.

## Troubleshooting

### "App is damaged" on macOS
The app wasn't notarized. Either:
- Build with notarization: `npm run dist:mac:arm64`
- Or right-click → Open → Open to bypass Gatekeeper

### Notarization fails
```bash
# Check notarization log
xcrun notarytool log <submission-id> --keychain-profile "textmyagent-notarize"
```

### Model fails to load in packaged app
1. Check that `asarUnpack` includes node-llama-cpp bins and localBuilds
2. Check that the custom llama.cpp build was done before packaging
3. Enable debug: `NODE_LLAMA_CPP_DEBUG=true`

### Build is slow
Use `npm run dist:mac:fast` for dev. The full release build is slower because it:
- Builds 2 architectures (arm64 + x64)
- Creates DMG + ZIP for each
- Notarizes each architecture separately
