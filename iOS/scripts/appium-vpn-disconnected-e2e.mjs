// End-to-end test: VPN disconnected page.
//
// What it covers:
//   1. App is already installed AND has completed the tunnel install
//      flow at least once (i.e. `vmState.tunnelInstalled == true` in
//      UserDefaults). See appium-e2e.mjs for the full first-run flow.
//   2. Turn the VPN off from outside the app (via `scutil --nc stop`
//      on the paired device isn't possible; instead we drive iOS
//      Settings → VPN toggle with XCUITest by launching Settings and
//      tapping the VPN switch).
//   3. Relaunch ConceptsOS. Because the tunnel is now disconnected but
//      `tunnelInstalled` is still true, ContentView must render
//      VPNDisconnectedView instead of WebAppView.
//   4. Assert the disconnected view + its Reconnect button exist.
//   5. Tap Reconnect. The button switches to "Connecting…".
//   6. Wait for tunnel to reconnect → we should land back on
//      WebAppView.
//
// Where this runs:
//   Physical iPhone via `mac-mini` — same prereqs as appium-e2e.mjs.
//
// Invocation from the Linux box:
//   scp iOS/scripts/appium-vpn-disconnected-e2e.mjs mac-mini:/tmp/
//   ssh mac-mini "bash -lc '
//     pkill -f appium 2>/dev/null; sleep 1
//     nohup appium > /tmp/appium.log 2>&1 & disown
//     sleep 6
//     cd /tmp && [ -f package.json ] || npm init -y >/dev/null
//     npm ls webdriverio >/dev/null 2>&1 || npm install webdriverio >/dev/null
//     UDID=C2650D26-5054-5718-943E-FDB32ADCE1C9 \\
//       node appium-vpn-disconnected-e2e.mjs
//   '"
//   scp 'mac-mini:/tmp/vpn_e2e_*.png' /tmp/
//
// Screenshots are saved to /tmp/vpn_e2e_<step>.png.

import { remote } from 'webdriverio';
import { execSync } from 'node:child_process';

const UDID = process.env.UDID
  || 'C2650D26-5054-5718-943E-FDB32ADCE1C9'; // Dan's iPhone 17 Pro Max
const BUNDLE = 'ai.humata.ConceptsOS';

const caps = {
  platformName: 'iOS',
  'appium:automationName': 'XCUITest',
  'appium:udid': UDID,
  'appium:bundleId': BUNDLE,
  'appium:xcodeOrgId': '2U53525V55',
  'appium:xcodeSigningId': 'iPhone Developer',
  'appium:updatedWDABundleId': 'ai.humata.WDA',
  'appium:noReset': true,
  'appium:newCommandTimeout': 600,
  'appium:forceAppLaunch': true,
  'appium:shouldTerminateApp': true,
  'appium:autoAcceptAlerts': false,
};

const driver = await remote({
  hostname: '127.0.0.1', port: 4723, path: '/',
  capabilities: caps, logLevel: 'warn',
});

async function shot(name) {
  const b64 = await driver.takeScreenshot();
  const path = `/tmp/vpn_e2e_${name}.png`;
  execSync(`echo ${b64} | base64 -D > ${path}`);
  console.log('shot:', path);
}

async function findAcc(id) {
  const el = await driver.$(`~${id}`).catch(() => null);
  if (el && await el.isExisting()) return el;
  return null;
}

async function waitForAcc(id, timeoutMs = 60_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const el = await findAcc(id);
    if (el) return el;
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error(`timeout waiting for a11y id "${id}"`);
}

async function tapByLabel(label, { timeout = 10_000 } = {}) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const el = await driver.$(`~${label}`).catch(() => null);
    if (el && await el.isExisting() && await el.isDisplayed().catch(() => false)) {
      await el.click();
      return true;
    }
    await new Promise(r => setTimeout(r, 500));
  }
  return false;
}

// Toggle the ConceptsOS VPN off via the iOS Settings app.
// iOS surfaces our profile as a row named after `manager.localizedDescription`
// which we set to "ConceptsOS" in TunnelManager.install().
async function turnVpnOffViaSettings() {
  console.log('  → launching Settings…');
  await driver.execute('mobile: launchApp', { bundleId: 'com.apple.Preferences' });
  await new Promise(r => setTimeout(r, 1500));

  // Settings root → tap "General"
  const general = await driver.$('~General').catch(() => null);
  if (general && await general.isExisting()) await general.click();
  await new Promise(r => setTimeout(r, 800));

  // General → VPN & Device Management  (iOS 16+)
  const vpnRow = await driver.$('~VPN & Device Management').catch(() => null);
  if (vpnRow && await vpnRow.isExisting()) {
    await vpnRow.click();
    await new Promise(r => setTimeout(r, 800));
    const vpn = await driver.$('~VPN').catch(() => null);
    if (vpn && await vpn.isExisting()) {
      await vpn.click();
      await new Promise(r => setTimeout(r, 800));
    }
  }

  // Now the VPN configurations page. The Status row's switch is the
  // first cell — flip it off if currently on.
  const statusSwitch = await driver.$(
    '//XCUIElementTypeSwitch[1]'
  ).catch(() => null);
  if (statusSwitch && await statusSwitch.isExisting()) {
    const val = await statusSwitch.getAttribute('value').catch(() => null);
    console.log('  → VPN switch current value:', val);
    if (val === '1') {
      await statusSwitch.click();
      await new Promise(r => setTimeout(r, 1500));
      console.log('  → VPN toggled off');
    } else {
      console.log('  → VPN already off');
    }
  } else {
    console.warn('  ! could not find VPN status switch in Settings');
  }

  // Send Settings to background so we can foreground our app fresh.
  await driver.execute('mobile: terminateApp', { bundleId: 'com.apple.Preferences' });
}

try {
  console.log('== step 1: turn VPN off in Settings ==');
  await turnVpnOffViaSettings();
  await shot('01_vpn_toggled_off');

  console.log('== step 2: relaunch ConceptsOS ==');
  await driver.execute('mobile: terminateApp', { bundleId: BUNDLE });
  await new Promise(r => setTimeout(r, 800));
  await driver.execute('mobile: launchApp', { bundleId: BUNDLE });
  await shot('02_relaunched');

  console.log('== step 3: assert VPNDisconnectedView is showing ==');
  // If the user was previously fully set up, tunnelInstalled == true
  // AND session is present, so ContentView should route straight to
  // VPNDisconnectedView (skipping Welcome / Provisioning / Install).
  const view = await waitForAcc('vpnDisconnectedView', 20_000);
  console.log('  ✓ vpnDisconnectedView visible');
  await waitForAcc('vpnDisconnectedHeadline');
  await waitForAcc('vpnDisconnectedSubhead');
  await waitForAcc('vpnReconnectButton');
  await waitForAcc('vpnOpenSettingsButton');
  await waitForAcc('vpnSignOutButton');
  await shot('03_disconnected_view');

  // The WebAppView must NOT be rendered while disconnected.
  const web = await findAcc('webAppView');
  if (web) throw new Error('webAppView is showing while VPN is disconnected — regression!');
  console.log('  ✓ webAppView correctly absent');

  console.log('== step 4: tap Reconnect ==');
  const ok = await tapByLabel('vpnReconnectButton');
  if (!ok) throw new Error('could not tap vpnReconnectButton');
  await shot('04_after_reconnect_tap');

  console.log('== step 5: wait for WebAppView (tunnel came up) ==');
  await waitForAcc('webAppView', 60_000);
  await shot('05_reconnected_webapp');

  console.log('== DONE ==');
} catch (e) {
  console.error('FAIL:', e.stack || e.message);
  await shot('ZZ_error').catch(() => {});
  process.exitCode = 1;
} finally {
  await driver.deleteSession().catch(() => {});
}
