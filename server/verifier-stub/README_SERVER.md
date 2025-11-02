# SUIrify Verifier Stub

This is a minimal Express-based verifier stub for local development and hackathon demos.

Run (PowerShell):

```powershell
Set-Location 'c:\Users\Domaka\Documents\GitHub\SUIrify\server\verifier-stub'
npm install
npm start
```

Configure environment variables by copying `.env.example` to `.env` and filling the placeholders.

Notes:
- This stub is deliberately simple and uses an in-memory map for privacy records. For production use a real database and a KMS/HSM for signing.

Reference photos for mocking government records
------------------------------------------------
- You can drop sample reference photos into `server/verifier-stub/reference_photos/`.
- Filename convention: `<Country>_<ID>.<ext>` or `<Country>-<ID>.<ext>` (e.g. `Nigeria_12345678901.png`, `Ghana-GHA-123456789.jpg`).
- On server start the stub will load any files in that folder and attach them to the mock gov DB (used for face matching).
- These images are stored in-memory as data URLs for demo purposes only and are not secure. Do not use real PII here for public demos.

