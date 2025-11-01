import React, { useEffect, useState } from "react";
import type { VerificationForm } from "../VerificationPortal.tsx";
import LoadingSpinner from "../../ui/LoadingSpinner";
import { mintAttestation } from "@/lib/mockApi";
import { explorer } from "@/lib/config";

/**
 * Step 5: Attestation Minting (Mock)
 * - Calls mock mint API, shows success with links, then redirects to /dashboard.
 */
const MintingStep: React.FC<{
  formData: VerificationForm;
  onNext: () => void;
}> = ({ formData }) => {
  const [status, setStatus] = useState<"minting" | "success" | "error">("minting");
  const [transactionDigest, setTransactionDigest] = useState("");
  const [attestationId, setAttestationId] = useState("");

  useEffect(() => {
    const run = async () => {
      try {
        const res = await mintAttestation({
          walletAddress: formData.walletAddress || "",
          fullName: formData.fullName,
          country: formData.country,
          verificationLevel: 1,
          claims: { is_human_verified: true, is_over_18: true },
        });
        if (res.success) {
          setTransactionDigest(res.transactionDigest || "");
          setAttestationId(res.attestationObjectId || "");
          setStatus("success");
          setTimeout(() => {
            window.location.href = "/dashboard";
          }, 3000);
        } else {
          setStatus("error");
        }
      } catch {
        setStatus("error");
      }
    };
    run();
  }, []);

  if (status === "minting") {
    return (
      <div>
        <LoadingSpinner message="Minting your SUIrify Attestation..." />
        <p>This may take a few moments. Please don't close this window.</p>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div>
        <div className="v-error">
          <h3>Minting Failed</h3>
          <p>There was an error creating your attestation. Please try again.</p>
          <button onClick={() => window.location.reload()} className="v-btn-primary">
            Retry Minting
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div>🎉</div>
      <h2>Verification Complete!</h2>
      <p>Your SUIrify Attestation has been successfully minted.</p>

      <div className="v-card v-margin-top">
        <div className="v-margin-bottom">
          <strong>Level:</strong> L1 - {formData.country} {formData.country === "Nigeria" ? "NIN" : "ID"} Verified
        </div>
        <div className="v-margin-bottom">
          <strong>Status:</strong> <span className="v-success">Active</span>
        </div>
        <div className="v-margin-bottom">
          <strong>Expires:</strong> 1 year
        </div>
        <div>
          <strong>Claims:</strong> Human ✓ | Over 18 ✓
        </div>
      </div>

      <div className="v-row v-margin-top">
        {transactionDigest && (
          <a href={explorer.tx(transactionDigest)} target="_blank" rel="noreferrer" className="v-link">
            View Transaction on Explorer
          </a>
        )}
        {attestationId && (
          <a href={explorer.object(attestationId)} target="_blank" rel="noreferrer" className="v-link">
            View Attestation Object
          </a>
        )}
      </div>

      <div className="v-margin-top">
        <p>Redirecting to your dashboard in 3 seconds...</p>
        <button onClick={() => (window.location.href = "/dashboard")} className="v-btn-primary">
          Go to Dashboard Now
        </button>
      </div>
    </div>
  );
};

export default MintingStep;
