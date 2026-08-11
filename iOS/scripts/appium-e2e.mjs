// End-to-end test: signup → tunnel installed → first LLM question
// answered.
//
// Where this runs:
//   Meaningful runs must target a **physical iPhone** — the iOS
//   Simulator can host our packet-tunnel extension but doesn't route
//   any packets through the utun interface, so 10.10.0.1:3000 is never
//   reachable and the WKWebView step of the flow can't finish.
//
// Prereqs on `mac-mini`:
//   1. Xcode 26 + Command Line Tools.
//   2. Node 22 + Appium 3.x + xcuitest driver installed
//      (see .pi/agent/skills/appium/SKILL.md).
//   3. The physical iPhone paired with the Mac (visible in
//      `xcrun devicectl list devices`).
//   4. ConceptsOS.app installed on the phone via
//      `iOS/scripts/wifi-install.sh` (this script does not build/install
//      the app itself).
//   5. WebDriverAgent signed for the same physical device. First-time
//      only:
//         cd ~/Library/Developer/Xcode/DerivedData
//         # Appium will build+sign WDA on first `driver.remote()`
//         # against the device UDID, using DEVELOPMENT_TEAM=2U53525V55.
//
// Invocation from the Linux box:
//   scp iOS/scripts/appium-e2e.mjs mac-mini:/tmp/appium-e2e.mjs
//   ssh mac-mini "bash -lc '
//     pkill -f appium 2>/dev/null; sleep 1
//     nohup appium > /tmp/appium.log 2>&1 & disown
//     sleep 6
//     cd /tmp && [ -f package.json ] || npm init -y >/dev/null
//     npm ls webdriverio >/dev/null 2>&1 || npm install webdriverio >/dev/null
//     UDID=C2650D26-5054-5718-943E-FDB32ADCE1C9 node appium-e2e.mjs
//   '"
//   scp 'mac-mini:/tmp/e2e_*.png' /tmp/
//
// What it covers (end-to-end on device):
//   1. Launch app → Welcome view visible.
//   2. Tap "Sign in with Apple" → system Apple ID sheet.
//      (The tester must already be signed into iCloud on the phone.)
//   3. Confirm → app progresses to ProvisioningView.
//   4. Wait for VM ready → InstallTunnelView appears.
//   5. iOS "AllowVPN Configuration" system alert appears → dismiss
//      with Allow.
//   6. Wait for tunnel connected → WKWebView loads the pod's UI.
//   7. Type "What is the capital of France?" and submit.
//   8. Verify the assistant renders a response.
//
// Screenshots are saved to /tmp/e2e_<step>.png so failures are
// diagnosable after the fact.

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
  // Real-device WebDriverAgent signing:
  'appium:xcodeOrgId': '2U53525V55',
  'appium:xcodeSigningId': 'iPhone Developer',
  'appium:updatedWDABundleId': 'ai.humata.WDA',
  'appium:noReset': true,
  'appium:newCommandTimeout': 600,
  // We want the app to be launched even if it's already running so we
  // land on the current top view.
  'appium:forceAppLaunch': true,
  'appium:shouldTerminateApp': true,
  'appium:autoAcceptAlerts': false, // we handle the VPN alert ourselves
};

const driver = await remote({
  hostname: '127.0.0.1', port: 4723, path: '/',
  capabilities: caps, logLevel: 'warn',
});

async function shot(name) {
  const b64 = await driver.takeScreenshot();
  const path = `/tmp/e2e_${name}.png`;
  execSync(`echo ${b64} | base64 -D > ${path}`);
  console.log('shot:', path);
}

async function tapButtonByLabel(label, { timeout = 15_000 } = {}) {
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

async function waitForAcc(id, timeoutMs = 60_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const el = await driver.$(`~${id}`).catch(() => null);
    if (el && await el.isExisting()) return el;
    await new Promise(r => setTimeout(r, 750));
  }
  throw new Error(`timeout waiting for a11y id "${id}"`);
}

try {
  console.log('== step 1: welcome view ==');
  await waitForAcc('welcomeView', 30_000);
  await shot('01_welcome');

  console.log('== step 2: sign in with apple ==');
  await tapButtonByLabel('signInWithAppleButton');
  await shot('02_apple_sheet');
  // Apple ID sheet is a system UI — press Continue via the SpringBoard.
  await tapButtonByLabel('Continue');
  await tapButtonByLabel('Continue with Password');
  // Face ID / passcode may prompt; user pre-approved on this device.
  await new Promise(r => setTimeout(r, 4000));
  await shot('03_after_apple');

  console.log('== step 3–4: wait for InstallTunnelView ==');
  await waitForAcc('installTunnelView', 120_000);
  await shot('04_install_tunnel');

  console.log('== step 5: allow VPN alert ==');
  // NETunnelProviderManager.saveToPreferences() causes iOS to show a
  // system alert with Allow / Don't Allow buttons. XCUITest surfaces
  // it as a top-level alert element.
  const allowed = await tapButtonByLabel('Allow', { timeout: 30_000 });
  if (!allowed) {
    // Retry via native alert accept
    try { await driver.acceptAlert(); } catch {}
  }
  await shot('05_vpn_allowed');

  console.log('== step 6: wait for WKWebView ==');
  await waitForAcc('webAppView', 90_000);
  await shot('06_webview');
  // Give the pod a moment to serve its first paint.
  await new Promise(r => setTimeout(r, 5000));
  await shot('07_webview_settled');

  console.log('== step 7: ask a question ==');
  // Switch context to the WebView. XCUITest exposes it as a WEBVIEW_<...>.
  const ctxs = await driver.getContexts();
  console.log('contexts:', ctxs);
  const webCtx = ctxs.find(c => String(c).startsWith('WEBVIEW_'));
  if (webCtx) {
    await driver.switchContext(webCtx);
    const ta = await driver.$('//textarea | //input[@type="text"]');
    await ta.click();
    await ta.setValue('What is the capital of France?');
    await shot('08_typed');
    // Find + tag the Send button by proximity to the textarea (see the
    // agent-browser skill's chat-form gotcha).
    await driver.execute(() => {
      const ta = document.querySelector('textarea, input[type="text"]');
      if (!ta) return;
      const taR = ta.getBoundingClientRect();
      const cand = [...document.querySelectorAll('button')]
        .map(b => ({ b, r: b.getBoundingClientRect() }))
        .filter(x => Math.abs(x.r.top - taR.top) < 100
                  && x.r.left > taR.left + 100)[0];
      if (cand) cand.b.setAttribute('data-e2e-send', '1');
    });
    await (await driver.$('button[data-e2e-send="1"]')).click();
    await new Promise(r => setTimeout(r, 20_000));
    await shot('09_answer');
    await driver.switchContext(ctxs[0]); // back to NATIVE_APP
  }

  console.log('== DONE ==');
} catch (e) {
  console.error('FAIL:', e.stack || e.message);
  await shot('ZZ_error').catch(() => {});
  process.exitCode = 1;
} finally {
  await driver.deleteSession().catch(() => {});
}
