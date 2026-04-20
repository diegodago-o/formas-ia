import React, { useRef, useState, useEffect, useCallback } from 'react';
import styles from './CameraCapture.module.css';

/**
 * CameraCapture — visor en-app con soporte de flash/torch
 *
 * Android Chrome: torch controlable con el botón ⚡
 * iOS Safari:     visor funciona, torch no disponible desde browser
 *                 (iOS solo permite torch vía app nativa)
 */
export default function CameraCapture({ onCapture, onCancel }) {
  const videoRef       = useRef(null);
  const streamRef      = useRef(null);
  const [ready,        setReady]        = useState(false);
  const [torchSupport, setTorchSupport] = useState(false);
  const [torchOn,      setTorchOn]      = useState(false);
  const [capturing,    setCapturing]    = useState(false);
  const [error,        setError]        = useState('');

  const stopStream = () => {
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
  };

  const startCamera = useCallback(async () => {
    setError('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width:  { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }

      // Detectar soporte de torch (Android Chrome sí, iOS Safari no)
      const track        = stream.getVideoTracks()[0];
      const capabilities = track.getCapabilities?.() ?? {};
      setTorchSupport(!!capabilities.torch);
      setReady(true);
    } catch (err) {
      setError(
        err.name === 'NotAllowedError'
          ? 'Permiso de cámara denegado. Actívalo en la configuración del navegador.'
          : 'No se pudo acceder a la cámara.'
      );
    }
  }, []);

  useEffect(() => {
    startCamera();
    return () => stopStream();
  }, [startCamera]);

  const toggleTorch = async () => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    try {
      const next = !torchOn;
      await track.applyConstraints({ advanced: [{ torch: next }] });
      setTorchOn(next);
    } catch { /* ignorar si falla */ }
  };

  const capture = async () => {
    if (!videoRef.current || capturing) return;
    setCapturing(true);
    try {
      const video  = videoRef.current;
      const canvas = document.createElement('canvas');
      canvas.width  = video.videoWidth  || 1280;
      canvas.height = video.videoHeight || 720;
      canvas.getContext('2d').drawImage(video, 0, 0);

      canvas.toBlob(blob => {
        const file = new File([blob], `foto_${Date.now()}.jpg`, { type: 'image/jpeg' });
        stopStream();
        onCapture(file);
      }, 'image/jpeg', 0.92);
    } catch {
      setCapturing(false);
    }
  };

  const handleCancel = () => {
    stopStream();
    onCancel();
  };

  return (
    <div className={styles.overlay}>

      {/* Video feed */}
      <video
        ref={videoRef}
        className={styles.video}
        autoPlay
        playsInline
        muted
      />

      {/* Error */}
      {error && (
        <div className={styles.errorBox}>
          <p>{error}</p>
          <button className={styles.btnRetry} onClick={startCamera}>Reintentar</button>
          <button className={styles.btnCancel} onClick={handleCancel}>Cancelar</button>
        </div>
      )}

      {/* Controles */}
      {!error && (
        <div className={styles.controls}>
          {/* Botón cancelar */}
          <button className={styles.btnSide} onClick={handleCancel}>
            ✕
          </button>

          {/* Botón captura */}
          <button
            className={`${styles.btnCapture} ${capturing ? styles.btnCaptureActive : ''}`}
            onClick={capture}
            disabled={!ready || capturing}
          >
            {capturing ? '⏳' : ''}
          </button>

          {/* Botón torch */}
          {torchSupport ? (
            <button
              className={`${styles.btnSide} ${torchOn ? styles.btnTorchOn : ''}`}
              onClick={toggleTorch}
              title={torchOn ? 'Apagar flash' : 'Encender flash'}
            >
              {torchOn ? '🔦' : '⚡'}
            </button>
          ) : (
            /* Espacio vacío para mantener centrado el botón de captura en iOS */
            <div className={styles.btnSide} />
          )}
        </div>
      )}

      {/* Hint flash iOS */}
      {!error && ready && !torchSupport && (
        <div className={styles.iosHint}>
          Flash no disponible desde el navegador en este dispositivo
        </div>
      )}
    </div>
  );
}
