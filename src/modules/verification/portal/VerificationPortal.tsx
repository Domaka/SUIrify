import React, { useState, useEffect } from "react";
import { useCurrentAccount } from "@mysten/dapp-kit";
import ProgressIndicator from "../ui/ProgressIndicator";
import CountryIDStep from "./steps/CountryIDStep";
import DataFetchStep from "./steps/DataFetchStep";
import FaceVerificationStep from "./steps/FaceVerificationStep";
import ReviewConsentStep from "./steps/ReviewConsentStep";
import MintingStep from "./steps/MintingStep";

export type VerificationForm = {
  country: string;
  idNumber: string;
  fullName: string;
  dateOfBirth: string;
  photoReference?: string;
  faceVerified: boolean;
  walletAddress?: string;
};

/**
 * VerificationPortal
 * Container for the 5-step verification process.
 * Manages step index and shared formData state.
 */
const VerificationPortal: React.FC = () => {
  const [currentStep, setCurrentStep] = useState(0);
  const [formData, setFormData] = useState<VerificationForm>({
    country: "",
    idNumber: "",
    fullName: "",
    dateOfBirth: "",
    faceVerified: false,
    walletAddress: "",
  });

  const account = useCurrentAccount();

  // Ensure the connected wallet address is stored with the form as soon as it's available
  useEffect(() => {
    if (account?.address) {
      setFormData((prev) => ({ ...prev, walletAddress: account.address }));
    }
  }, [account?.address]);

  const steps = [
    { component: CountryIDStep, title: "Country & ID" },
    { component: DataFetchStep, title: "Data Verification" },
    { component: FaceVerificationStep, title: "Face Check" },
    { component: ReviewConsentStep, title: "Review & Consent" },
    { component: MintingStep, title: "Minting" },
  ];

  const CurrentStepComponent: any = steps[currentStep].component;

  return (
    <div className="v-container">
      <h1 className="v-title">SUIrify Verification</h1>
      <ProgressIndicator
        currentStep={currentStep}
        totalSteps={steps.length}
        stepTitles={steps.map((s) => s.title)}
      />

      <div className="v-card">
        <CurrentStepComponent
          formData={formData}
          setFormData={setFormData}
          onNext={() => setCurrentStep((p: number) => Math.min(p + 1, steps.length - 1))}
          onBack={() => setCurrentStep((p: number) => Math.max(p - 1, 0))}
        />
      </div>
    </div>
  );
};

export default VerificationPortal;
