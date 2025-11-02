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
  const [challenge, setChallenge] = useState<string | null>(null);
  const [challengeStatus, setChallengeStatus] = useState<string | null>(null);
  const [challengeCountdown, setChallengeCountdown] = useState<number>(0);

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

  const registerReferencePhoto = async (photoDataUrl: string) => {
    const GOV_URL = (import.meta.env.VITE_VERIFIER_URL as string) || 'http://localhost:4001';
    try {
      const resp = await fetch(`${GOV_URL}/gov-register-photo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ country: formData.country, idNumber: formData.idNumber, photoData: photoDataUrl }),
      });
      if (!resp.ok) throw new Error('register failed');
      const j = await resp.json();
      if (j.success && j.data) {
        setFormData((p) => ({ ...p, photoReference: j.data.photoReference }));
        return true;
      }
    } catch (e) {
      console.warn('gov register photo failed', e);
    }
    return false;
  };

  const startChallenge = async () => {
  // For demo/privacy: only use blink challenge
  const pick = 'blink';
    setChallenge(pick);
    setChallengeStatus('pending');
    // give user time to read the prompt
    const prepSeconds = 4;
    setChallengeCountdown(prepSeconds);
    for (let i = prepSeconds; i > 0; i--) {
      setChallengeCountdown(i);
      // small sleep
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => setTimeout(r, 1000));
    }
    setChallengeCountdown(0);
    // run lightweight challenge
    try {
      // Attempt to load face-api; if unavailable, we'll run a visual fallback
      let faceapi = null as any | null;
      try {
        faceapi = await loadFaceApiModels();
      } catch (err) {
        console.warn('face-api not available, using visual fallback for challenge', err);
        faceapi = null;
      }

      if (pick === 'blink') {
        if (faceapi) {
          // capture frames and detect blink — give 5 seconds to blink
          const frames: any[] = [];
          const total = 12;
          for (let i = 0; i < total; i++) {
            const img = await webcamRef.current!.capture();
            // eslint-disable-next-line no-await-in-loop
            const det = await faceapi.detectSingleFace(await faceapi.fetchImage(img)).withFaceLandmarks();
            frames.push(det?.landmarks);
            // eslint-disable-next-line no-await-in-loop
            await new Promise((r) => setTimeout(r, 400));
          }
          // compute EAR over frames, detect a drop and recovery
          const earValues = frames.map((lm) => (lm ? eyeAspectRatio(lm.getLeftEye()) : 1));
          const minEar = Math.min(...earValues.filter((v) => v != null));
          if (minEar < 0.22) {
            setChallengeStatus('passed');
            return true;
          }
          setChallengeStatus('failed');
          return false;
        }

        // Fallback: simple pixel-difference blink detector
        try {
          const total = 12;
          let baseline: string | null = null;
          let passed = false;
          for (let i = 0; i < total; i++) {
            const img = await webcamRef.current!.capture();
            if (!baseline) baseline = img;
            // compare baseline to new frame
            // small delay between frames
            // eslint-disable-next-line no-await-in-loop
            await new Promise((r) => setTimeout(r, 400));
            const diff = await pixelDifferencePercent(baseline, img);
            // blinking should cause a moderate local change; tuned threshold
            // percent difference — require a small but visible change
            if (diff > 3) { passed = true; break; }
          }
          if (passed) { setChallengeStatus('passed'); return true; }
          setChallengeStatus('failed'); return false;
        } catch (err) {
          console.warn('visual fallback blink failed', err);
          setChallengeStatus('failed'); return false;
        }
      } else {
        // turn-left / turn-right
        if (faceapi) {
          // instruct the user to slowly turn their head; capture over ~3 seconds
          const snapshots: any[] = [];
          const total = 10;
          for (let i = 0; i < total; i++) {
            const img = await webcamRef.current!.capture();
            // eslint-disable-next-line no-await-in-loop
            const det = await faceapi.detectSingleFace(await faceapi.fetchImage(img)).withFaceLandmarks();
            if (!det) { snapshots.push(null); } else { snapshots.push(det.landmarks.getNose()[3]); }
            // eslint-disable-next-line no-await-in-loop
            await new Promise((r) => setTimeout(r, 300));
          }
          const xs = snapshots.map((p) => (p ? p.x : null));
          const validXs = xs.filter((v) => v != null) as number[];
          if (validXs.length < 2) { setChallengeStatus('failed'); return false; }
          // use average of first two and last two valid samples to reduce noise
          const firstVals = validXs.slice(0, 2);
          const lastVals = validXs.slice(-2);
          const firstAvg = firstVals.reduce((s, v) => s + v, 0) / firstVals.length;
          const lastAvg = lastVals.reduce((s, v) => s + v, 0) / lastVals.length;
          const diff = lastAvg - firstAvg;
          console.log('turn detection', { pick, xs: validXs, firstAvg, lastAvg, diff });
          // relaxed threshold (pixels) to account for different cameras/resolutions
          const threshold = 8;
          if (pick === 'turn-left' && diff < -threshold) { setChallengeStatus('passed'); return true; }
          if (pick === 'turn-right' && diff > threshold) { setChallengeStatus('passed'); return true; }
          setChallengeStatus('failed');
          return false;
        }

        // Fallback: compute center-of-brightness x and see it move
        try {
          const centers: number[] = [];
          const total = 10;
          for (let i = 0; i < total; i++) {
            const img = await webcamRef.current!.capture();
            // eslint-disable-next-line no-await-in-loop
            const cx = await computeCenterX(img);
            centers.push(cx);
            // eslint-disable-next-line no-await-in-loop
            await new Promise((r) => setTimeout(r, 300));
          }
          const valid = centers.filter((v) => !Number.isNaN(v));
          if (valid.length < 2) { setChallengeStatus('failed'); return false; }
          const firstAvg = valid.slice(0, 2).reduce((s, v) => s + v, 0) / Math.min(2, valid.length);
          const lastAvg = valid.slice(-2).reduce((s, v) => s + v, 0) / Math.min(2, valid.length);
          const diff = lastAvg - firstAvg;
          console.log('turn fallback centers', { pick, centers: valid, firstAvg, lastAvg, diff });
          // relaxed threshold (pixels) to account for different cameras/resolutions
          const threshold = 12;
          if (pick === 'turn-left' && diff < -threshold) { setChallengeStatus('passed'); return true; }
          if (pick === 'turn-right' && diff > threshold) { setChallengeStatus('passed'); return true; }
          setChallengeStatus('failed'); return false;
        } catch (err) {
          console.warn('visual fallback turn detection failed', err);
          setChallengeStatus('failed'); return false;
        }
      }
    } catch (e) {
      console.warn('challenge failed', e);
      setChallengeStatus('failed');
      return false;
    }
  };

  function eyeAspectRatio(eyePoints: any[]) {
    if (!eyePoints || eyePoints.length < 6) return 1;
    const dist = (a: any, b: any) => Math.hypot(a.x - b.x, a.y - b.y);
    const A = dist(eyePoints[1], eyePoints[5]);
    const B = dist(eyePoints[2], eyePoints[4]);
    const C = dist(eyePoints[0], eyePoints[3]);
    return (A + B) / (2.0 * C);
  }

  // Visual fallback helpers (work without face-api)
  const pixelDifferencePercent = async (aDataUrl: string, bDataUrl: string) => {
    // Draw both images to canvases and compute a simple normalized pixel difference
    const loadImg = (src: string) => new Promise<HTMLImageElement>((res, rej) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => res(img);
      img.onerror = rej;
      img.src = src;
    });
    const [ia, ib] = await Promise.all([loadImg(aDataUrl), loadImg(bDataUrl)]);
    const w = Math.min(ia.width, ib.width, 320);
    const h = Math.min(ia.height, ib.height, 240);
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(ia, 0, 0, w, h);
    const aPixels = ctx.getImageData(0, 0, w, h).data;
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(ib, 0, 0, w, h);
    const bPixels = ctx.getImageData(0, 0, w, h).data;
    let diff = 0;
    for (let i = 0; i < aPixels.length; i += 4) {
      const ar = aPixels[i], ag = aPixels[i+1], ab = aPixels[i+2];
      const br = bPixels[i], bg = bPixels[i+1], bb = bPixels[i+2];
      diff += Math.abs(ar - br) + Math.abs(ag - bg) + Math.abs(ab - bb);
    }
    const max = w * h * 3 * 255;
    return (diff / max) * 100; // percent difference (0-100)
  };

  const computeCenterX = async (dataUrl: string) => {
    // Very simple center-of-brightness calculation to approximate head movement
    const loadImg = (src: string) => new Promise<HTMLImageElement>((res, rej) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => res(img);
      img.onerror = rej;
      img.src = src;
    });
    const img = await loadImg(dataUrl);
    const w = Math.min(img.width, 320);
    const h = Math.min(img.height, 240);
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(img, 0, 0, w, h);
    const data = ctx.getImageData(0, 0, w, h).data;
    let sumX = 0; let sumVal = 0;
    for (let y = 0; y < h; y += 4) {
      for (let x = 0; x < w; x += 4) {
        const i = (y * w + x) * 4;
        const r = data[i], g = data[i+1], b = data[i+2];
        const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        sumX += x * lum;
        sumVal += lum;
      }
    }
    if (sumVal === 0) return NaN;
    return sumX / sumVal; // pixel coordinate of center-of-brightness
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
      // If gov has no stored reference photo, capture and register one
      if (!formData.photoReference) {
        // capture reference photo
        const ref = await captureLivePhoto();
        const ok = await registerReferencePhoto(ref);
        if (!ok) {
          setStatus('error');
          setError('Unable to register reference photo. Please try again.');
          return;
        }
      }

      // Run challenge-response liveness before matching
      const chOk = await startChallenge();
      if (!chOk) {
        setStatus('error');
        setError('Liveness challenge failed. Please try again.');
        return;
      }

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
          <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
            <div>
              <WebcamFeed ref={webcamRef} />
              <p>Please look straight at the camera...</p>
            </div>
            <div style={{ maxWidth: 260 }}>
              {/* Reference photo intentionally hidden in the UI for privacy. It is used server-side for matching but not displayed here. */}
              <div className="v-muted">Reference photo is kept private and will not be shown here.</div>
              <div style={{ marginTop: 12 }}>
                {challenge && (
                  <div>
                    <strong>Challenge:</strong> {challenge.replace('-', ' ')}
                    {challengeCountdown > 0 ? (
                      <div style={{ marginTop: 8 }}>Get ready... {challengeCountdown}</div>
                    ) : (
                      <div style={{ marginTop: 8 }}>Now: please {challenge.replace('-', ' ')} slowly</div>
                    )}
                    {challengeStatus && (
                      <div style={{ marginTop: 8 }}>
                        Status: {challengeStatus}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
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
