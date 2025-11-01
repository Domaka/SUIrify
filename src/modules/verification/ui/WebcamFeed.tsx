import React, { forwardRef, useRef, useState, useEffect, useImperativeHandle } from 'react';

export type WebcamHandle = {
  capture: () => Promise<string>;
};

const WebcamFeed = forwardRef<WebcamHandle>((_props, ref) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [streamActive, setStreamActive] = useState(false);

  useImperativeHandle(ref, () => ({
    capture: async () => {
      if (!videoRef.current) throw new Error('video not ready');
      const video = videoRef.current;
      const w = video.videoWidth || 640;
      const h = video.videoHeight || 480;
      if (!canvasRef.current) canvasRef.current = document.createElement('canvas');
      const canvas = canvasRef.current;
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('canvas context unavailable');
      ctx.drawImage(video, 0, 0, w, h);
      return canvas.toDataURL('image/png');
    },
  }));

  useEffect(() => {
    let mounted = true;
    const start = async () => {
      try {
        const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false });
        if (!mounted) { s.getTracks().forEach(t => t.stop()); return; }
        if (videoRef.current) {
          videoRef.current.srcObject = s;
          await videoRef.current.play();
          setStreamActive(true);
        }
      } catch (e) {
        setStreamActive(false);
      }
    };
    start();
    return () => {
      mounted = false;
      if (videoRef.current && videoRef.current.srcObject) {
        const st = videoRef.current.srcObject as MediaStream;
        st.getTracks().forEach((t) => t.stop());
      }
    };
  }, []);

  return (
    <div>
      <div style={{ width: 320, height: 240, borderRadius: 12, overflow: 'hidden', background: '#000' }}>
        <video ref={videoRef} style={{ width: '100%', height: '100%', objectFit: 'cover' }} playsInline muted />
      </div>
      {!streamActive && (
        <div className="v-error v-small" style={{ marginTop: 8 }}>
          Camera unavailable. Please allow camera access or use a supported device.
        </div>
      )}
    </div>
  );
});

export default WebcamFeed;
