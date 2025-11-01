const express = require('express');
const bodyParser = require('body-parser');
const crypto = require('crypto');
require('dotenv').config();

const app = express();
app.use(bodyParser.json());

// Simple permissive CORS for local dev (adjust for production)
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

const PORT = process.env.PORT || 4001;
const SECRET_PEPPER = process.env.SECRET_PEPPER || 'demo_pepper';

// In-memory privacy-safe store mapping identifier_hash -> record
// identifier_hash = sha256(nin + SECRET_PEPPER)
const privacyStore = new Map();

// Mock government databases keyed by country code
const govMockDB = {
  Nigeria: {
    // NIN: record
    '12345678901': { fullName: 'Aisha Doe', dateOfBirth: '1990-05-12', photoReference: '' },
    '11122233344': { fullName: 'Chinonso Okeke', dateOfBirth: '1988-07-01', photoReference: '' },
  },
  Ghana: {
    'GHA-123456789': { fullName: 'Kwame Mensah', dateOfBirth: '1992-03-04', photoReference: '' },
    'GHA-987654321': { fullName: 'Yaa Osei', dateOfBirth: '1994-09-10', photoReference: '' },
  },
  Kenya: {
    '12345678': { fullName: 'Achieng Odinga', dateOfBirth: '1986-11-02', photoReference: '' },
    '87654321': { fullName: 'Njeri Kamau', dateOfBirth: '1991-01-20', photoReference: '' },
  },
};

function govLookup(country, idNumber) {
  if (!country || !idNumber) return null;
  const db = govMockDB[country];
  if (!db) return null;
  return db[idNumber] || null;
}

function sha256Hex(input) {
  return crypto.createHash('sha256').update(input).digest('hex');
}

function normalizeName(name) {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

// GOV verify: look up in mock DB by country then idNumber
function mockGovValidate(country, idNumber) {
  const record = govLookup(country, idNumber);
  return record !== null;
}

// Endpoint specifically for government mock verification
app.post('/gov-verify', (req, res) => {
  const { country, idNumber } = req.body || {};
  if (!country || !idNumber) return res.status(400).json({ success: false, message: 'missing fields' });
  const record = govLookup(country, idNumber);
  if (!record) return res.status(404).json({ success: false, message: 'not_found' });
  return res.json({ success: true, data: record });
});

app.get('/health', (req, res) => res.json({ status: 'ok' }));

// POST /verify
// body: { name, nin, walletAddress }
// returns: { success, name_hash, identifier_hash, tx: { simulated: true, txId } }
// Main verify endpoint: accepts either { country, idNumber, walletAddress }
// or legacy { name, nin, walletAddress } for compatibility.
app.post('/verify', (req, res) => {
  const { name, nin, walletAddress, country, idNumber } = req.body || {};

  // If country + idNumber provided, run gov mock lookup first
  let govRecord = null;
  if (country && idNumber) {
    govRecord = govLookup(country, idNumber);
    if (!govRecord) return res.status(422).json({ success: false, reason: 'gov_not_found' });
  }

  // If govRecord present, use that name; else fallback to provided name/nin legacy flow
  if (govRecord) {
    const normalized = normalizeName(govRecord.fullName);
    const name_hash = sha256Hex(normalized + walletAddress + SECRET_PEPPER);
    const identifier_hash = sha256Hex(idNumber + SECRET_PEPPER);

    if (privacyStore.has(identifier_hash)) {
      return res.status(409).json({ success: false, reason: 'already_verified' });
    }

    const txId = 'simulated-tx-' + crypto.randomBytes(6).toString('hex');
    const record = {
      name_hash,
      identifier_hash,
      walletAddress,
      createdAt: Date.now(),
      txId,
      gov: { country, idNumber },
    };
    privacyStore.set(identifier_hash, record);
    return res.json({ success: true, name_hash, identifier_hash, tx: { simulated: true, txId } });
  }

  // Legacy path: require name + nin + walletAddress
  if (!name || !nin || !walletAddress) return res.status(400).json({ error: 'missing fields' });
  // Basic legacy check: normalize name and compare to known sample
  const nimcOk = normalizeName(name) === 'aisha doe' && nin === '12345678901';
  if (!nimcOk) return res.status(422).json({ success: false, reason: 'nimc_check_failed' });

  const normalized = normalizeName(name);
  const name_hash = sha256Hex(normalized + walletAddress + SECRET_PEPPER);
  const identifier_hash = sha256Hex(nin + SECRET_PEPPER);

  if (privacyStore.has(identifier_hash)) {
    return res.status(409).json({ success: false, reason: 'already_verified' });
  }

  const txId = 'simulated-tx-' + crypto.randomBytes(6).toString('hex');
  const record = {
    name_hash,
    identifier_hash,
    walletAddress,
    createdAt: Date.now(),
    txId,
  };
  privacyStore.set(identifier_hash, record);

  return res.json({ success: true, name_hash, identifier_hash, tx: { simulated: true, txId } });
});

// POST /check-name-match
// body: { name, walletAddress }
// returns whether computed name_hash matches any stored records for that wallet
app.post('/check-name-match', (req, res) => {
  const { name, walletAddress } = req.body;
  if (!name || !walletAddress) return res.status(400).json({ error: 'missing fields' });

  const normalized = normalizeName(name);
  const name_hash = sha256Hex(normalized + walletAddress + SECRET_PEPPER);

  // Search for matching name_hash in records (privacy-preserving: we only compare hashes)
  for (const record of privacyStore.values()) {
    if (record.name_hash === name_hash && record.walletAddress === walletAddress) {
      return res.json({ match: true, txId: record.txId });
    }
  }

  return res.json({ match: false });
});

app.listen(PORT, () => console.log(`Verifier stub listening on port ${PORT}`));
