import fs from 'node:fs';
import path from 'node:path';

const logFile = process.env.LOG_FILE;
const maxBytes = Math.max(1024 * 1024, Number(process.env.LOG_MAX_BYTES ?? 5 * 1024 * 1024));
const maxFiles = Math.max(1, Number(process.env.LOG_MAX_FILES ?? 3));
if (logFile) fs.mkdirSync(path.dirname(logFile), { recursive: true });

// Size-based rotation keeps at most LOG_MAX_FILES archived files
// (app.log.1 .. app.log.3), so log storage stays bounded on small servers.
function rotateIfNeeded(incomingBytes) {
  if (!logFile) return;
  try {
    const size = fs.existsSync(logFile) ? fs.statSync(logFile).size : 0;
    if (size + incomingBytes <= maxBytes) return;
    const oldest = `${logFile}.${maxFiles}`;
    if (fs.existsSync(oldest)) fs.rmSync(oldest, { force: true });
    for (let index = maxFiles - 1; index >= 1; index -= 1) {
      const from = `${logFile}.${index}`;
      if (fs.existsSync(from)) fs.renameSync(from, `${logFile}.${index + 1}`);
    }
    if (fs.existsSync(logFile)) fs.renameSync(logFile, `${logFile}.1`);
  } catch { /* rotation must never crash the app */ }
}

export function log(level, event, fields = {}) {
  const entry = { timestamp: new Date().toISOString(), level, event, ...fields };
  const line = JSON.stringify(entry);
  if (level === 'ERROR') console.error(line);
  else console.log(line);
  if (logFile) {
    try {
      rotateIfNeeded(Buffer.byteLength(line) + 1);
      fs.appendFileSync(logFile, `${line}\n`, { encoding: 'utf8' });
    } catch (error) { console.error(JSON.stringify({ timestamp: new Date().toISOString(), level: 'ERROR', event: 'LOG_WRITE_FAILED', message: error.message })); }
  }
}
