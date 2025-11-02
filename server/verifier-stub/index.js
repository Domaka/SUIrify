const express = require('express');
const bodyParser = require('body-parser');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
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

// Optional Sui RPC config for on-chain minting
const SUI_RPC = process.env.SUI_RPC || null; // e.g., https://fullnode.devnet.sui.io:443
const PACKAGE_ID = process.env.PACKAGE_ID || null; // Move package id with mint_attestation function

// Issuer identity / keys for signing attestations
let issuerId = process.env.ISSUER_ID || 'verifier-stub';
let issuerKeyId = process.env.ISSUER_KEY_ID || 'verifier-stub#key-1';
let issuerPrivateKeyObj = null;
let issuerPublicKeyBase64 = null;
if (process.env.PRIVATE_KEY_PEM) {
  try {
    issuerPrivateKeyObj = crypto.createPrivateKey(process.env.PRIVATE_KEY_PEM);
    issuerPublicKeyBase64 = crypto.createPublicKey(issuerPrivateKeyObj).export({ type: 'spki', format: 'der' }).toString('base64');
    console.log('Loaded issuer private key from env (PEM)');
  } catch (e) {
    console.warn('Failed to load PRIVATE_KEY_PEM, falling back to ephemeral key', e);
  }
}
// Persist/load key file to keep signatures stable across restarts
const keysDir = path.join(__dirname, 'keys');
if (!fs.existsSync(keysDir)) fs.mkdirSync(keysDir, { recursive: true });
const issuerPemPath = path.join(keysDir, 'issuer.pem');
// If no env PEM provided but a persisted key file exists, load it
if (!issuerPrivateKeyObj && fs.existsSync(issuerPemPath)) {
  try {
    const pem = fs.readFileSync(issuerPemPath, 'utf8');
    issuerPrivateKeyObj = crypto.createPrivateKey(pem);
    issuerPublicKeyBase64 = crypto.createPublicKey(issuerPrivateKeyObj).export({ type: 'spki', format: 'der' }).toString('base64');
    console.log('Loaded issuer private key from persisted file:', issuerPemPath);
  } catch (e) {
    console.warn('Failed to load persisted issuer key, will generate or use ephemeral', e);
  }
}
if (!issuerPrivateKeyObj) {
  // generate an ephemeral ed25519 keypair for demo purposes
  try {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
    issuerPrivateKeyObj = privateKey;
    issuerPublicKeyBase64 = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
    // Persist this generated key so signatures persist across restarts
    try {
      const pem = privateKey.export({ type: 'pkcs8', format: 'pem' });
      fs.writeFileSync(issuerPemPath, pem, { mode: 0o600 });
      console.log('Generated and persisted issuer keypair to', issuerPemPath);
    } catch (e) {
      console.log('Generated ephemeral issuer keypair for verifier-stub (failed to persist):', e?.message || e);
    }
  } catch (e) {
    console.warn('Unable to generate ed25519 keypair; attestations will be unsigned', e);
  }
}

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

// Load any reference photos placed in `reference_photos/` at startup.
// Filename convention: <Country>_<ID>.<ext> or <Country>-<ID>.<ext>
// Example: Nigeria_12345678901.png or Ghana-GHA-123456789.jpg
function loadReferencePhotos() {
  try {
    const photosDir = path.join(__dirname, 'reference_photos');
    if (!fs.existsSync(photosDir)) return;
    const files = fs.readdirSync(photosDir);
    for (const f of files) {
      const m = f.match(/^([A-Za-z]+)[_-](.+)\.(jpg|jpeg|png)$/i);
      if (!m) continue;
      const country = m[1];
      const idNumber = m[2];
      const fullPath = path.join(photosDir, f);
      try {
        const data = fs.readFileSync(fullPath);
        const ext = path.extname(f).slice(1).toLowerCase();
        const b64 = data.toString('base64');
        const dataUrl = `data:image/${ext};base64,${b64}`;
        if (!govMockDB[country]) govMockDB[country] = {};
        const rec = govMockDB[country][idNumber] || { fullName: `User ${idNumber}`, dateOfBirth: '1970-01-01', photoReference: '' };
        rec.photoReference = dataUrl;
        govMockDB[country][idNumber] = rec;
        console.log(`Loaded reference photo for ${country}/${idNumber} from ${f}`);
      } catch (e) {
        console.warn('Failed to load reference photo', f, e);
      }
    }
  } catch (e) {
    console.warn('Error reading reference_photos directory', e);
  }
}

// attempt to load photos now
loadReferencePhotos();

function govLookup(country, idNumber) {
  if (!country || !idNumber) return null;
  const db = govMockDB[country];
  if (!db) return null;
  return db[idNumber] || null;
}

// Allow registering a reference photo for a given country+id in the mock DB
app.post('/gov-register-photo', (req, res) => {
  const { country, idNumber, photoData } = req.body || {};
  if (!country || !idNumber || !photoData) return res.status(400).json({ success: false, message: 'missing fields' });
  if (!govMockDB[country]) govMockDB[country] = {};
  // attach or create record
  const existing = govMockDB[country][idNumber] || { fullName: `User ${idNumber}`, dateOfBirth: '1970-01-01', photoReference: '' };
  existing.photoReference = photoData;
  govMockDB[country][idNumber] = existing;
  return res.json({ success: true, data: existing });
});

// Admin/debug: list govMockDB entries and whether they have reference photos
app.get('/gov-list', (req, res) => {
  const out = {};
  for (const country of Object.keys(govMockDB)) {
    out[country] = Object.entries(govMockDB[country]).map(([id, rec]) => ({ id, hasPhoto: !!rec.photoReference }));
  }
  res.json({ success: true, data: out });
});

function sha256Hex(input) {
  return crypto.createHash('sha256').update(input).digest('hex');
}

// Deterministic canonical JSON serializer (sorts object keys recursively)
function canonicalize(obj) {
  if (obj === null || obj === undefined) return JSON.stringify(obj);
  if (typeof obj !== 'object') return JSON.stringify(obj);
  if (Array.isArray(obj)) return '[' + obj.map((v) => canonicalize(v)).join(',') + ']';
  const keys = Object.keys(obj).sort();
  const parts = keys.map((k) => JSON.stringify(k) + ':' + canonicalize(obj[k]));
  return '{' + parts.join(',') + '}';
}

function signAttestationPayload(payloadString) {
  if (!issuerPrivateKeyObj) return null;
  try {
    // For ed25519 key objects, sign the raw payload bytes
    const sig = crypto.sign(null, Buffer.from(payloadString, 'utf8'), issuerPrivateKeyObj);
    return sig.toString('base64');
  } catch (e) {
    console.warn('signAttestationPayload failed', e);
    return null;
  }
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

// POST /mint-on-chain
// body: { identifier_hash } OR { attestation }
// Requires env: SUI_RPC, PACKAGE_ID and persisted issuer key
app.post('/mint-on-chain', async (req, res) => {
  if (!SUI_RPC || !PACKAGE_ID) return res.status(500).json({ success: false, message: 'SUI_RPC or PACKAGE_ID not configured on server' });
  const { identifier_hash, attestation } = req.body || {};
  let record = null;
  if (identifier_hash) record = privacyStore.get(identifier_hash) || null;
  if (!record && attestation) {
    // attestation provided directly
    record = { attestation };
  }
  if (!record || !record.attestation) return res.status(404).json({ success: false, message: 'attestation not found' });

  // Build the transaction arguments
  const a = record.attestation;
  const subjectWallet = a.subjectWallet;
  const subjectIdHashHex = a.subjectIdHash; // already hex string
  const subjectNameHashHex = a.subjectNameHash;
  const evidenceHashHex = a.evidenceHash || null;
  const signatureB64 = a.signature;
  const issuerPubB64 = a.issuerPublicKey;
  const issuedAt = a.issuedAt;

  // Lazy-load sui client to avoid a hard dependency when not used
  // Lazy-load sui client to avoid a hard dependency when not used. The real import happens below.

  // Now attempt to construct and send transaction using @mysten/sui
  try {
    const sui = await import('@mysten/sui.js');
    const { JsonRpcProvider, RawSigner, Ed25519Keypair, fromB64 } = sui;
    const provider = new JsonRpcProvider({ fullnode: SUI_RPC });

    // Load issuer private key for signing transaction (must be an Ed25519 Keypair compatible PEM)
    let issuerKeypair = null;
    try {
      // Try to create an Ed25519Keypair from persisted PEM
      const pem = fs.readFileSync(issuerPemPath, 'utf8');
      // Convert PEM pkcs8 to raw seed (not trivial). Instead, support env PRIVATE_KEY_B64_RAW (raw 32-byte seed in base64)
    } catch (e) {
      // ignore
    }

    // Fallback: if PRIVATE_KEY_B64_RAW env provided, use that to construct keypair
    let signer = null;
    if (process.env.PRIVATE_KEY_B64_RAW) {
      const seed = Buffer.from(process.env.PRIVATE_KEY_B64_RAW, 'base64');
      const kp = Ed25519Keypair.fromSeed(seed);
      signer = new RawSigner(kp, provider);
    }

    if (!signer) return res.status(500).json({ success: false, message: 'Server does not have a usable issuer key for signing Sui transactions. Set PRIVATE_KEY_B64_RAW or configure signer.' });

    // Prepare arguments: convert hex strings to bytes arrays
    const hexToBytes = (h) => { if (!h) return []; return Array.from(Buffer.from(h.replace(/^0x/, ''), 'hex')); };
    const sigBytes = signatureB64 ? Array.from(Buffer.from(signatureB64, 'base64')) : [];
    const issuerPubBytes = issuerPubB64 ? Array.from(Buffer.from(issuerPubB64, 'base64')) : [];

    // Build move call transaction for PACKAGE_ID::protocol::mint_attestation
    const tx = {
      packageObjectId: PACKAGE_ID.split('::')[0] || PACKAGE_ID,
      module: 'protocol',
      function: 'mint_attestation',
      typeArguments: [],
      arguments: [subjectWallet, subjectIdHashHex, subjectNameHashHex, evidenceHashHex || '', sigBytes, issuerPubBytes, String(issuedAt)],
    };

    console.log('Submitting on-chain mint tx for attestation subject=', subjectWallet);
    // NOTE: using signer.executeMoveCall requires proper argument types; here we call a generic RPC
    const txResult = await signer.executeMoveCall({ packageObjectId: PACKAGE_ID, module: 'protocol', function: 'mint_attestation', typeArguments: [], arguments: [subjectWallet, subjectIdHashHex, subjectNameHashHex, evidenceHashHex || '', sigBytes, issuerPubBytes, issuedAt], gasBudget: 30000 });

    console.log('--- On-chain transaction response ---');
    console.log(JSON.stringify(txResult, null, 2));
    console.log('--- End tx response ---');

    return res.json({ success: true, onChain: true, result: txResult });
  } catch (e) {
    console.error('Mint-on-chain failed', e);
    return res.status(500).json({ success: false, message: 'mint_on_chain_failed', error: String(e) });
  }
});

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
    // Build a minimal attestation and sign it
    try {
      const sessionId = 's-' + crypto.randomBytes(6).toString('hex');
      const photoHash = govRecord.photoReference ? sha256Hex(govRecord.photoReference) : null;
      const evidenceBundle = {
        country,
        idHash: identifier_hash,
        photoReferenceHash: photoHash,
        liveness: { type: 'blink', outcome: 'passed' },
        verifierVersion: 'verifier-stub-1.0.0',
        sessionId,
      };
      const evidenceCanonical = canonicalize(evidenceBundle);
      const evidenceHash = sha256Hex(evidenceCanonical);

      const issuedAt = Math.floor(Date.now() / 1000);
      const attestationPayload = {
        issuerId,
        issuerKeyId,
        subjectWallet: walletAddress,
        subjectIdHash: identifier_hash,
        subjectNameHash: name_hash,
        verificationType: 'gov-id+face-liveness',
        issuedAt,
        expiresAt: null,
        evidenceHash,
        sessionId,
      };
      const payloadCanonical = canonicalize(attestationPayload);
      const signature = signAttestationPayload(payloadCanonical);
      const attestation = Object.assign({}, attestationPayload, { signature, issuerPublicKey: issuerPublicKeyBase64 });

      record.attestation = attestation;
      privacyStore.set(identifier_hash, record);
      // Log detailed mint intent and attestation info to the terminal so developers can see what would be minted
      try {
        console.log('--- VERIFICATION COMPLETE - Attestation ---');
        console.log('Subject wallet:', attestation.subjectWallet);
        console.log('SubjectIdHash:', attestation.subjectIdHash);
        console.log('SubjectNameHash:', attestation.subjectNameHash);
        console.log('Verification type:', attestation.verificationType);
        console.log('IssuedAt:', attestation.issuedAt, 'Session:', attestation.sessionId);
        console.log('Evidence canonical:', evidenceCanonical);
        console.log('EvidenceHash:', evidenceHash);
        console.log('Attestation payload (canonical):', payloadCanonical);
        console.log('Signature (base64):', signature);
        console.log('Issuer public key (base64):', issuerPublicKeyBase64);
        // Show the intended on-chain Move call that would mint this attestation
        const packageId = process.env.PACKAGE_ID || '<PACKAGE_ID_NOT_SET>';
        console.log('On-chain mint intent: call', `${packageId}::protocol::mint_attestation`);
        console.log('Move call args (human-friendly): subjectWallet, subjectIdHash (hex), subjectNameHash (hex), evidenceHash (hex), signature (base64), issuerPublicKey (base64), issuedAt (u64)');
        console.log('--- END Attestation ---');
      } catch (e) {
        console.warn('Failed to log attestation details', e);
      }
      return res.json({ success: true, name_hash, identifier_hash, tx: { simulated: true, txId }, attestation });
    } catch (e) {
      console.warn('attestation generation failed', e);
      privacyStore.set(identifier_hash, record);
      return res.json({ success: true, name_hash, identifier_hash, tx: { simulated: true, txId } });
    }
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
  // Legacy path: also create a minimal attestation (without gov fields)
  try {
    const sessionId = 's-' + crypto.randomBytes(6).toString('hex');
    const evidenceBundle = {
      idHash: identifier_hash,
      liveness: { type: 'blink', outcome: 'passed' },
      verifierVersion: 'verifier-stub-1.0.0',
      sessionId,
    };
    const evidenceCanonical = canonicalize(evidenceBundle);
    const evidenceHash = sha256Hex(evidenceCanonical);
    const issuedAt = Math.floor(Date.now() / 1000);
    const attestationPayload = {
      issuerId,
      issuerKeyId,
      subjectWallet: walletAddress,
      subjectIdHash: identifier_hash,
      subjectNameHash: name_hash,
      verificationType: 'legacy-nimc-mock',
      issuedAt,
      expiresAt: null,
      evidenceHash,
      sessionId,
    };
    const payloadCanonical = canonicalize(attestationPayload);
    const signature = signAttestationPayload(payloadCanonical);
    const attestation = Object.assign({}, attestationPayload, { signature, issuerPublicKey: issuerPublicKeyBase64 });

    record.attestation = attestation;
    privacyStore.set(identifier_hash, record);
    // Log for legacy path as well
    try {
      console.log('--- VERIFICATION COMPLETE - Legacy Attestation ---');
      console.log('Subject wallet:', attestation.subjectWallet);
      console.log('SubjectIdHash:', attestation.subjectIdHash);
      console.log('SubjectNameHash:', attestation.subjectNameHash);
      console.log('EvidenceHash:', evidenceHash);
      console.log('Signature (base64):', signature);
      console.log('Issuer public key (base64):', issuerPublicKeyBase64);
      console.log('On-chain mint intent: call', `${process.env.PACKAGE_ID || '<PACKAGE_ID_NOT_SET>'}::protocol::mint_attestation`);
      console.log('--- END Legacy Attestation ---');
    } catch (e) {
      console.warn('Failed to log legacy attestation details', e);
    }
    return res.json({ success: true, name_hash, identifier_hash, tx: { simulated: true, txId }, attestation });
  } catch (e) {
    console.warn('legacy attestation failure', e);
    privacyStore.set(identifier_hash, record);
    return res.json({ success: true, name_hash, identifier_hash, tx: { simulated: true, txId } });
  }
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
