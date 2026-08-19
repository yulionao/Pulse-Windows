const fs = require('node:fs');
const https = require('node:https');
const path = require('node:path');
const extract = require('extract-zip');

const version = '3.12.13';
const projectRoot = path.resolve(__dirname, '..');
const archivePath = path.join(projectRoot, '.cache', `python-${version}-embed-amd64.zip`);
const destinationPath = path.join(projectRoot, 'vendor', 'python');
const downloadURL = `https://www.python.org/ftp/python/${version}/python-${version}-embed-amd64.zip`;

function download(url, target, redirects = 0) {
  return new Promise((resolve, reject) => {
    https.get(url, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location && redirects < 5) {
        response.resume();
        download(new URL(response.headers.location, url), target, redirects + 1).then(resolve, reject);
        return;
      }
      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`Python download failed with HTTP ${response.statusCode}`));
        return;
      }
      const output = fs.createWriteStream(target);
      response.pipe(output);
      output.on('finish', () => output.close(resolve));
      output.on('error', reject);
    }).on('error', reject);
  });
}

async function main() {
  if (fs.existsSync(path.join(destinationPath, 'python.exe'))) {
    console.log(`Python runtime already exists at ${destinationPath}`);
    return;
  }
  fs.mkdirSync(path.dirname(archivePath), { recursive: true });
  fs.mkdirSync(destinationPath, { recursive: true });
  if (!fs.existsSync(archivePath)) {
    console.log(`Downloading Python ${version} embedded runtime...`);
    await download(downloadURL, archivePath);
  }
  await extract(archivePath, { dir: destinationPath });
  console.log(`Python ${version} is ready at ${destinationPath}`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
