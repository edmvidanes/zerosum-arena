import fs from 'node:fs';
import path from 'node:path';

const logFile = process.env.LOG_FILE;
if (logFile) fs.mkdirSync(path.dirname(logFile), { recursive: true });

export function log(level, event, fields = {}) {
  const entry = { timestamp: new Date().toISOString(), level, event, ...fields };
  const line = JSON.stringify(entry);
  if (level === 'ERROR') console.error(line);
  else console.log(line);
  if (logFile) {
    try { fs.appendFileSync(logFile, `${line}\n`, { encoding: 'utf8' }); }
    catch (error) { console.error(JSON.stringify({ timestamp: new Date().toISOString(), level: 'ERROR', event: 'LOG_WRITE_FAILED', message: error.message })); }
  }
}
