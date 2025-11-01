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
