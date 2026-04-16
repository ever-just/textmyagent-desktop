const path = require('path');
const fs = require('fs');
const os = require('os');

exports.default = async function notarizing(context) {
  const { electronPlatformName, appOutDir } = context;

  if (electronPlatformName !== 'darwin') return;
  if (process.env.SKIP_NOTARIZATION === 'true') {
    console.log('Skipping notarization: SKIP_NOTARIZATION=true');
    return;
  }

  const { notarize } = await import('@electron/notarize');
  const appName = context.packager.appInfo.productFilename;
  const appPath = path.join(appOutDir, `${appName}.app`);

  console.log(`Notarizing ${appPath}...`);

  let tempKeyFile = null;

  try {
    // CI: use App Store Connect API key (set via GitHub secrets)
    if (process.env.APPLE_API_KEY && process.env.APPLE_API_KEY_ID && process.env.APPLE_API_ISSUER) {
      console.log('Using App Store Connect API key for notarization (CI mode)');

      // APPLE_API_KEY is base64-encoded .p8 content — write to temp file
      tempKeyFile = path.join(os.tmpdir(), `AuthKey_${process.env.APPLE_API_KEY_ID}.p8`);
      fs.writeFileSync(tempKeyFile, Buffer.from(process.env.APPLE_API_KEY, 'base64'), { mode: 0o600 });

      await notarize({
        appPath,
        appleApiKey: tempKeyFile,
        appleApiKeyId: process.env.APPLE_API_KEY_ID,
        appleApiIssuer: process.env.APPLE_API_ISSUER,
      });
    } else {
      // Local: use keychain profile (fastest for dev machines)
      // Set up once via: xcrun notarytool store-credentials "textmyagent-notarize" \
      //   --key ~/.appstoreconnect/private_keys/AuthKey_578PPBSM69.p8 \
      //   --key-id 578PPBSM69 --issuer 858e0667-11ee-48aa-9e2e-c750c81d1361
      const keychainProfile = process.env.KEYCHAIN_PROFILE || 'textmyagent-notarize';
      console.log(`Using keychain profile: ${keychainProfile}`);
      await notarize({ appPath, keychainProfile });
    }
    console.log('Notarization complete!');
  } catch (error) {
    console.error('Notarization failed:', error);
    throw error;
  } finally {
    // Clean up temp key file
    if (tempKeyFile && fs.existsSync(tempKeyFile)) {
      fs.unlinkSync(tempKeyFile);
    }
  }
};
