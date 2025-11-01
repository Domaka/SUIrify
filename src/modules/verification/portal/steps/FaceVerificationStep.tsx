import React, { useState, useRef } from "react";
import type { VerificationForm } from "../VerificationPortal.tsx";
import LoadingSpinner from "../../ui/LoadingSpinner";
import WebcamFeed, { WebcamHandle } from "../../ui/WebcamFeed";
import { faceMatch } from "@/lib/mockApi";

/**
 * Step 3: Face Verification (Mock)
 * - Shows instructions, simulates webcam capture, calls mock faceMatch.
 * - Auto-advances on success; allows retry on failure.
 */
const FaceVerificationStep: React.FC<{
  formData: VerificationForm;
  setFormData: React.Dispatch<React.SetStateAction<VerificationForm>>;
  onNext: () => void;
  onBack: () => void;
}> = ({ formData, setFormData, onNext, onBack }) => {
  const [status, setStatus] = useState<"idle" | "capturing" | "verifying" | "success" | "error">("idle");
  const [error, setError] = useState("");

  const generateSessionId = () => Math.random().toString(36).slice(2);
  const webcamRef = useRef<WebcamHandle | null>(null);

  const captureLivePhoto = async (): Promise<string> => {
    if (webcamRef.current) {
      return await webcamRef.current.capture();
    }
    // fallback stub
    await new Promise((r) => setTimeout(r, 700));
    return formData.photoReference || "data:image/png;base64,stub";
  };

  // Lazy-loaded face-api wrapper
  let modelsLoaded = false;
  const loadFaceApiModels = async () => {
    // dynamic import to avoid adding heavy deps at initial load
    try {
      // @ts-ignore
      const faceapi = await import('@vladmandic/face-api');
      // models should be hosted at /models in the public folder
      const modelPath = (import.meta.env.VITE_FACE_MODELS_PATH as string) || '/models';
      await faceapi.nets.ssdMobilenetv1.loadFromUri(modelPath);
      await faceapi.nets.faceLandmark68Net.loadFromUri(modelPath);
      await faceapi.nets.faceRecognitionNet.loadFromUri(modelPath);
      modelsLoaded = true;
      return faceapi;
    } catch (e) {
      console.warn('face-api load failed, falling back to mock', e);
      throw e;
    }
  };

  const computeDescriptor = async (faceapi: any, imageSrc: string) => {
    const img = await faceapi.fetchImage(imageSrc);
    const detection = await faceapi.detectSingleFace(img).withFaceLandmarks().withFaceDescriptor();
    if (!detection) return null;
    return detection.descriptor as Float32Array;
  };

  const cosineSimilarity = (a: Float32Array, b: Float32Array) => {
    let dot = 0;
    let na = 0;
    let nb = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      na += a[i] * a[i];
      nb += b[i] * b[i];
    }
    return dot / (Math.sqrt(na) * Math.sqrt(nb));
  };

  const startFaceVerification = async () => {
    setStatus("capturing");
    try {
      const livePhoto = await captureLivePhoto();
      setStatus("verifying");
      // Try to perform client-side embedding comparison using face-api
      try {
        const faceapi = await loadFaceApiModels();
        const refPhoto = formData.photoReference || '';
        const [refDesc, liveDesc] = await Promise.all([
          computeDescriptor(faceapi, refPhoto),
          computeDescriptor(faceapi, livePhoto),
        ]);
        if (!refDesc || !liveDesc) {
          throw new Error('no_face_detected');
        }
        const sim = cosineSimilarity(refDesc, liveDesc);
        const threshold = parseFloat((import.meta.env.VITE_FACE_SIM_THRESHOLD as string) || '0.78');
        if (sim >= threshold) {
          setFormData((p) => ({ ...p, faceVerified: true }));
          setStatus('success');
          setTimeout(() => onNext(), 1200);
        } else {
          setStatus('error');
          setError(`Face did not match (similarity ${sim.toFixed(3)}). Try again.`);
        }
      } catch (e) {
        // If face-api isn't available or failed, fall back to the mock API
        console.warn('Client-side face verification failed, falling back to mock:', e);
        const result = await faceMatch({ livePhoto, referencePhoto: formData.photoReference || '', sessionId: generateSessionId() });
        if (result.match) {
          setFormData((p) => ({ ...p, faceVerified: true }));
          setStatus('success');
          setTimeout(() => onNext(), 1200);
        } else {
          setStatus('error');
          setError('Face verification failed. Please ensure good lighting and try again.');
        }
      }
    } catch (e) {
      setStatus("error");
      setError("Face verification failed. Please try again.");
    }
  };

  return (
    <div>
      <h2 className="v-section-title">Face Verification</h2>

      {status === "idle" && (
        <div>
          <h3>Instructions:</h3>
          <ul className="v-muted">
            <li>Ensure good lighting</li>
            <li>Look straight at the camera</li>
            <li>Remove glasses and hats</li>
            <li>We'll compare with your government photo</li>
          </ul>
          <button onClick={startFaceVerification} className="v-btn-primary">
            Start Face Verification
          </button>
        </div>
      )}

      {status === "capturing" && (
        <div>
          <WebcamFeed ref={webcamRef} />
          <p>Please look straight at the camera...</p>
        </div>
      )}

      {status === "verifying" && <LoadingSpinner message="Verifying your face match..." />}

      {status === "success" && (
        <div className="v-success">
          <div>✓</div>
          <h3>Face Verification Successful!</h3>
          <p>Redirecting to next step...</p>
        </div>
      )}

      {status === "error" && (
        <div className="v-error">
          <div>✗</div>
          <h3>Verification Failed</h3>
          <p>{error}</p>
          <button onClick={() => setStatus("idle")} className="v-btn-secondary">
            Try Again
          </button>
        </div>
      )}

      <button onClick={onBack} className="v-btn-secondary v-margin-top">
        Back
      </button>
    </div>
  );
};

export default FaceVerificationStep;
