const FIREBASE_URL =
  process.env.FIREBASE_DATABASE_URL ||
  'https://signaling-dcfad-default-rtdb.europe-west1.firebasedatabase.app';
const ROOT = 'mercadopago-bridge';
const PAYMENTS_PATH = `${ROOT}/payments`;

function buildUrl(path) {
  return `${FIREBASE_URL}/${path}.json`;
}

async function readPath(path) {
  const res = await fetch(buildUrl(path));
  if (!res.ok) throw new Error(`Firebase read failed: ${res.status}`);
  return res.json();
}

async function writePath(path, data) {
  const res = await fetch(buildUrl(path), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`Firebase write failed: ${res.status}`);
  return res.json();
}

async function patchPath(path, data) {
  const res = await fetch(buildUrl(path), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`Firebase patch failed: ${res.status}`);
  return res.json();
}

async function pushPath(path, data) {
  const res = await fetch(buildUrl(path), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`Firebase push failed: ${res.status}`);
  return res.json();
}

async function writePayment(ref, data) {
  return writePath(`${PAYMENTS_PATH}/${ref}`, data);
}

async function patchPayment(ref, data) {
  return patchPath(`${PAYMENTS_PATH}/${ref}`, data);
}

async function readPayment(ref) {
  return readPath(`${PAYMENTS_PATH}/${ref}`);
}

module.exports = {
  FIREBASE_URL,
  ROOT,
  PAYMENTS_PATH,
  buildUrl,
  readPath,
  writePath,
  patchPath,
  pushPath,
  writePayment,
  patchPayment,
  readPayment,
};
