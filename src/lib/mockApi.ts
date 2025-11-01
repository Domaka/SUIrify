// Mock backend API for hackathon/demo
// Simulates government data verification, face match, and attestation mint

export type GovernmentData = {
  fullName: string;
  dateOfBirth: string; // ISO
  photoReference: string; // data URL or URL
};

export const fetchGovernmentData = async (
  params: { country: string; idNumber: string; walletAddress: string }
): Promise<{ success: boolean; data?: GovernmentData; message?: string }> => {
  // Try backend gov-verify endpoint first (if developer has the verifier stub running)
  const GOV_URL = (import.meta.env.VITE_VERIFIER_URL as string) || "http://localhost:4001";
  try {
    const resp = await fetch(`${GOV_URL}/gov-verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ country: params.country, idNumber: params.idNumber }),
    });
    if (resp.ok) {
      const j = await resp.json();
      if (j.success && j.data) {
        return { success: true, data: j.data };
      }
    }
    // fall through to local mock if remote returns 4xx/5xx or not found
  } catch (e) {
    // network error or server not running; fallback to local mock
  }

  // Fallback local deterministic mock (same as before)
  await sleep(1000);
  // Basic format checks mirroring UI validation
  const { country, idNumber } = params;
  const passes =
    (country === "Nigeria" && /^\d{11}$/.test(idNumber)) ||
    (country === "Ghana" && /^GHA-\w{9}$/.test(idNumber)) ||
    (country === "Kenya" && /^\d{8}$/.test(idNumber));

  if (!passes) return { success: false, message: "Invalid ID format" };

  // Return deterministic mock data based on id
  const mockFullName = pickNameFromId(idNumber);
  const mockDOB = pickDOBFromId(idNumber);
  const mockPhoto = generatePlaceholderAvatar(mockFullName);

  return {
    success: true,
    data: {
      fullName: mockFullName,
      dateOfBirth: mockDOB,
      photoReference: mockPhoto,
    },
  };
};

export const faceMatch = async (
  params: { livePhoto: string; referencePhoto: string; sessionId: string }
): Promise<{ match: boolean; similarity: number }> => {
  await sleep(1200);
  // Simulate a good match 85% of the time
  const rnd = seededRandom(params.sessionId);
  const similarity = 0.7 + 0.3 * rnd;
  const match = similarity > 0.8;
  return { match, similarity };
};

export const mintAttestation = async (
  params: {
    walletAddress: string;
    fullName: string;
    country: string;
    verificationLevel: number; // 1 -> L1
    claims: { is_human_verified: boolean; is_over_18: boolean };
  }
): Promise<{ success: boolean; transactionDigest?: string; attestationObjectId?: string }> => {
  await sleep(1500);
  // Simulate mint success; store to localStorage for dashboard fallback
  const transactionDigest = `0x${cryptoLikeHash(`${params.walletAddress}-${Date.now()}`)}`;
  const attestationObjectId = `0x${cryptoLikeHash(`att-${params.walletAddress}`)}`;

  const issue = Date.now();
  const oneYear = 365 * 24 * 60 * 60 * 1000;
  const expiry = issue + oneYear;

  const local = {
    objectId: attestationObjectId,
    tx: transactionDigest,
    content: {
      fields: {
        status: "ACTIVE",
        verification_level: params.verificationLevel,
        issue_time_ms: String(issue),
        expiry_time_ms: String(expiry),
        is_human_verified: params.claims.is_human_verified,
        is_over_18: params.claims.is_over_18,
      },
    },
  };
  try {
    localStorage.setItem("suirify:lastAttestation", JSON.stringify(local));
  } catch {}

  return { success: true, transactionDigest, attestationObjectId };
};

export const getLastLocalAttestation = (): any | null => {
  try {
    const s = localStorage.getItem("suirify:lastAttestation");
    return s ? JSON.parse(s) : null;
  } catch {
    return null;
  }
};

// --- Helpers ---
const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

function pickNameFromId(id: string) {
  const names = [
    "Adaobi Nnaji",
    "Kwame Mensah",
    "Achieng Odinga",
    "Chinonso Okeke",
    "Yaa Osei",
  ];
  const idx = Math.abs(hashCode(id)) % names.length;
  return names[idx];
}

function pickDOBFromId(id: string) {
  const baseYear = 1985;
  const year = baseYear + (Math.abs(hashCode(id)) % 15); // 1985..1999
  const month = 1 + (Math.abs(hashCode(id + "m")) % 12);
  const day = 1 + (Math.abs(hashCode(id + "d")) % 28);
  const m = String(month).padStart(2, "0");
  const d = String(day).padStart(2, "0");
  return `${year}-${m}-${d}`;
}

function generatePlaceholderAvatar(name: string) {
  // Simple SVG data URL avatar
  const initials = name
    .split(" ")
    .map((n) => n[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  const color = `hsl(${Math.abs(hashCode(name)) % 360},70%,60%)`;
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='200' height='200'>
    <rect width='100%' height='100%' rx='16' fill='${color}' />
    <text x='50%' y='54%' dominant-baseline='middle' text-anchor='middle' font-size='72' font-family='sans-serif' fill='#fff'>${initials}</text>
  </svg>`;
  return `data:image/svg+xml;base64,${btoa(svg)}`;
}

function hashCode(str: string) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h << 5) - h + str.charCodeAt(i);
  return h | 0;
}

function cryptoLikeHash(input: string) {
  // Simple, non-cryptographic hash to build mock ids
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h += (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24);
  }
  return Math.abs(h).toString(16).padStart(64, "0");
}

function seededRandom(seed: string) {
  let x = Math.abs(hashCode(seed)) || 123456;
  x ^= x << 13;
  x ^= x >> 17;
  x ^= x << 5;
  return (x >>> 0) / 4294967295;
}
