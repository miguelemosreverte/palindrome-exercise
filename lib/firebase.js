const FIREBASE_URL = process.env.FIREBASE_DATABASE_URL || 'https://signaling-dcfad-default-rtdb.europe-west1.firebasedatabase.app';
const NAMESPACE = 'mercadopago-bridge/payments';

async function writePayment(ref, data) {
  const res = await fetch(`${FIREBASE_URL}/${NAMESPACE}/${ref}.json`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`Firebase write failed: ${res.status}`);
  return res.json();
}

async function readPayment(ref) {
  const res = await fetch(`${FIREBASE_URL}/${NAMESPACE}/${ref}.json`);
  if (!res.ok) throw new Error(`Firebase read failed: ${res.status}`);
  return res.json();
}

module.exports = { writePayment, readPayment };
