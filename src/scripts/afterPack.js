const fetch = require("node-fetch");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// Driver installers bundled into the setup. Versions are pinned and checked against a
// SHA-256 so a build never ships an unexpected or tampered installer. To update one,
// change the URL and put the new file's hash here.
const INSTALLERS = [
  {
    name: "ViGEmBus",
    // Last release; the ViGEmBus repository was archived in Nov 2023.
    url: "https://github.com/nefarius/ViGEmBus/releases/download/v1.22.0/ViGEmBus_1.22.0_x64_x86_arm64.exe",
    file: "ViGEmBusSetup.exe",
    sha256: "89220a7865076b342892f98865f3499fb7c4cfd673159e89d352c360fd014c6a",
  },
  {
    name: "Wooting Analog SDK",
    // Matches the v0.7 SDK wrapper the native module is built against.
    url: "https://github.com/WootingKb/wooting-analog-sdk/releases/download/v0.7.5/wooting_analog_sdk-0.7.5-x86_64.msi",
    file: "wooting_analog_sdk.msi",
    sha256: "1c8a8d74be25780219a00a839123f11a99e8f492280f264dc893ea4800d8fd39",
  },
];

const INSTALLER_DIR = path.join("build", "installers");

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

async function ensureInstaller({ name, url, file, sha256: expected }) {
  const target = path.join(INSTALLER_DIR, file);

  // Reuse a previously downloaded copy if it's the right file.
  if (fs.existsSync(target) && sha256(fs.readFileSync(target)) === expected) {
    console.log(`${name}: using cached ${target}`);
    return;
  }

  console.log(`${name}: downloading ${url}`);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${name}: download failed (${response.status})`);
  }
  const data = await response.buffer();
  const actual = sha256(data);
  if (actual !== expected) {
    throw new Error(
      `${name}: checksum mismatch, refusing to bundle it.\n  expected ${expected}\n  got      ${actual}`
    );
  }

  fs.mkdirSync(INSTALLER_DIR, { recursive: true });
  fs.writeFileSync(target, data);
  console.log(`${name}: verified and saved to ${target}`);
}

exports.default = async function (context) {
  if (context.electronPlatformName === "win32") {
    for (const installer of INSTALLERS) {
      await ensureInstaller(installer);
    }
  }
};
