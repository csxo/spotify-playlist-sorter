/**
 * package-extension.js
 * Automatically packages the extension/ folder into spotify-playlist-sorter-chrome-extension.zip
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT_DIR = __dirname;
const EXT_DIR = path.join(ROOT_DIR, 'extension');
const ZIP_FILE = path.join(ROOT_DIR, 'spotify-playlist-sorter-chrome-extension.zip');

if (fs.existsSync(ZIP_FILE)) {
  fs.unlinkSync(ZIP_FILE);
}

// Use powershell Compress-Archive on Windows
try {
  execSync(`powershell -NoProfile -Command "Compress-Archive -Path '${EXT_DIR}/*' -DestinationPath '${ZIP_FILE}'"`, {
    stdio: 'inherit'
  });
  console.log('✓ Successfully created:', ZIP_FILE);
} catch (e) {
  console.error('Failed to create zip archive:', e);
}
