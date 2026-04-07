const path = require('path');

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

  // Method 1: Keychain profile (fastest, recommended)
  // Set up once via: xcrun notarytool store-credentials "textmyagent-notarize" \
  //   --key ~/.appstoreconnect/private_keys/AuthKey_578PPBSM69.p8 \
  //   --key-id 578PPBSM69 --issuer 858e0667-11ee-48aa-9e2e-c750c81d1361
  const keychainProfile = process.env.KEYCHAIN_PROFILE || 'textmyagent-notarize';

  try {
    console.log(`Using keychain profile: ${keychainProfile}`);
    await notarize({ appPath, keychainProfile });
    console.log('Notarization complete!');
  } catch (error) {
    console.error('Notarization failed:', error);
    throw error;
  }
};
