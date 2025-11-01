import React, { useState } from "react";
import type { VerificationForm } from "../VerificationPortal.tsx";
import LoadingSpinner from "../../ui/LoadingSpinner";
import { fetchGovernmentData } from "@/lib/mockApi";
import { useCurrentAccount } from "@mysten/dapp-kit";
import { calculateAge } from "@/lib/identityUtils";

/**
 * Step 2: Government Data Verification (Mock)
 * - Calls a mock API with country + idNumber + wallet address.
 * - Populates fullName, dateOfBirth, and photoReference on success.
 * - Blocks progression if age < 18.
 */
const DataFetchStep: React.FC<{
  formData: VerificationForm;
  setFormData: React.Dispatch<React.SetStateAction<VerificationForm>>;
  onNext: () => void;
  onBack: () => void;
}> = ({ formData, setFormData, onNext, onBack }) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const account = useCurrentAccount();

  // keep the shared formData.walletAddress in sync with the connected account
  React.useEffect(() => {
    if (account?.address) {
      setFormData((prev) => ({ ...prev, walletAddress: account.address }));
    }
  }, [account?.address, setFormData]);

  const fetchData = async () => {
    if (!account) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetchGovernmentData({
        country: formData.country,
        idNumber: formData.idNumber,
        walletAddress: account.address,
      });
      if (res.success && res.data) {
        setFormData((prev) => ({
          ...prev,
          fullName: res.data!.fullName,
          dateOfBirth: res.data!.dateOfBirth,
          photoReference: res.data!.photoReference,
        }));
      } else {
        setError(res.message || "Failed to verify your ID");
      }
    } catch (e) {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const age = formData.dateOfBirth ? calculateAge(formData.dateOfBirth) : null;

  return (
    <div>
      <h2 className="v-section-title">Verify Your Identity</h2>

      {loading ? (
        <LoadingSpinner message="Verifying your ID with government database..." />
      ) : (
        <>
          {formData.fullName ? (
            <div className="v-grid">
              <div>
                <label>Full Name</label>
                <input type="text" value={formData.fullName} disabled className="v-input" />
                <span className="v-success"> ✓ Verified</span>
              </div>

              <div>
                <label>Date of Birth</label>
                <input type="text" value={formData.dateOfBirth} disabled className="v-input" />
                <span className="v-success"> ✓ Verified</span>
              </div>

              <div>
                {age !== null && (
                  <div className={age >= 18 ? "v-success" : "v-error v-strong"}>
                    {age >= 18 ? `✓ Age verified (${age} years)` : `✗ Must be 18 or older (${age} years)`}
                  </div>
                )}
              </div>

              {age !== null && age >= 18 ? (
                <button onClick={onNext} className="v-btn-primary">
                  Continue to Face Verification
                </button>
              ) : (
                <div className="v-error">You must be 18 or older to use SUIrify services.</div>
              )}
            </div>
          ) : (
            <>
              <button onClick={fetchData} className="v-btn-primary">
                Fetch My Verified Data
              </button>
              {error && <div className="v-error v-margin-top">{error}</div>}
            </>
          )}

          <button onClick={onBack} className="v-btn-secondary v-margin-top">
            Back
          </button>
        </>
      )}
    </div>
  );
};

export default DataFetchStep;
