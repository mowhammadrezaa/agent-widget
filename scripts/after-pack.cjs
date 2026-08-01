/**
 * Trim packaged macOS app size after electron-builder packs the .app.
 * Electron ships ~40MB of Chromium locale packs we never use.
 */
const fs = require("fs");
const path = require("path");

const KEEP_LPROJ = new Set(["en.lproj", "Base.lproj", "English.lproj"]);

function rm(target) {
  try {
    fs.rmSync(target, { recursive: true, force: true });
  } catch {
    // ignore
  }
}

function stripLproj(dir) {
  if (!dir || !fs.existsSync(dir)) return 0;
  let removed = 0;
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith(".lproj") || KEEP_LPROJ.has(name)) continue;
    rm(path.join(dir, name));
    removed += 1;
  }
  return removed;
}

function walkStripLproj(root) {
  let total = 0;
  if (!fs.existsSync(root)) return 0;
  total += stripLproj(root);
  for (const name of fs.readdirSync(root, { withFileTypes: true })) {
    if (!name.isDirectory()) continue;
    total += walkStripLproj(path.join(root, name.name));
  }
  return total;
}

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== "darwin") return;

  const appName = context.packager.appInfo.productFilename;
  const appPath = path.join(context.appOutDir, `${appName}.app`);
  const contents = path.join(appPath, "Contents");

  const removedLocales = walkStripLproj(contents);

  // Software Vulkan fallback (~16MB) — unused for this UI widget.
  const frameworks = path.join(contents, "Frameworks", "Electron Framework.framework", "Versions", "A", "Libraries");
  for (const name of ["libvk_swiftshader.dylib", "vk_swiftshader_icd.json"]) {
    rm(path.join(frameworks, name));
  }

  // Drop map / TypeScript sources if any slipped into Resources.
  const resources = path.join(contents, "Resources");
  for (const name of ["app.asar.unpacked"]) {
    const unpacked = path.join(resources, name);
    if (!fs.existsSync(unpacked)) continue;
    // nothing locale-related there; node-pty stays
  }

  console.log(
    `afterPack: removed ${removedLocales} locale packs + swiftshader from ${appName}.app`
  );
};
