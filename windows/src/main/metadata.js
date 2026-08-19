const fs = require('node:fs');

const BEGIN_MARKER = 'UsageBoardPlugin:';
const END_MARKER = '/UsageBoardPlugin';

function stripCommentPrefix(line) {
  const trimmed = line.trimStart();
  return trimmed.startsWith('#') ? trimmed.slice(1).trimStart() : line;
}

function parseMetadataText(text) {
  let collecting = false;
  let closed = false;
  const lines = [];

  for (const rawLine of text.split(/\r?\n/).slice(0, 80)) {
    const line = stripCommentPrefix(rawLine);
    const trimmed = line.trim();
    if (trimmed.startsWith(BEGIN_MARKER)) {
      collecting = true;
      const remainder = line.slice(line.indexOf(BEGIN_MARKER) + BEGIN_MARKER.length).trim();
      if (remainder) lines.push(remainder);
      continue;
    }
    if (trimmed.startsWith(END_MARKER)) {
      closed = true;
      break;
    }
    if (collecting) lines.push(line);
  }

  if (!collecting || !closed) return null;
  try {
    return JSON.parse(lines.join('\n').trim());
  } catch {
    return null;
  }
}

function parseMetadataFile(filePath) {
  try {
    return parseMetadataText(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function localizedField(object, field, language) {
  if (!object) return '';
  return String(object[`${field}@${language}`] || object[field] || '').trim();
}

module.exports = { parseMetadataText, parseMetadataFile, localizedField };
