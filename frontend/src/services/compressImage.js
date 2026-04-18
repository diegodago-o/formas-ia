/**
 * Comprime una imagen conservando calidad suficiente para OCR.
 * - Máximo 1920px en el lado más largo
 * - JPEG calidad 0.82
 * - Resultado: típicamente 200–500KB desde 8–15MB originales
 */
export async function compressImage(file, { maxDim = 1920, quality = 0.82 } = {}) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(url);

      let { width, height } = img;

      // Escalar manteniendo proporción si supera maxDim
      if (width > maxDim || height > maxDim) {
        if (width >= height) {
          height = Math.round((height * maxDim) / width);
          width  = maxDim;
        } else {
          width  = Math.round((width * maxDim) / height);
          height = maxDim;
        }
      }

      const canvas = document.createElement('canvas');
      canvas.width  = width;
      canvas.height = height;

      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);

      canvas.toBlob(
        blob => {
          if (!blob) { reject(new Error('Error al comprimir imagen')); return; }
          // Crear File conservando el nombre original
          const compressed = new File([blob], file.name.replace(/\.[^.]+$/, '.jpg'), {
            type: 'image/jpeg',
            lastModified: Date.now(),
          });
          resolve(compressed);
        },
        'image/jpeg',
        quality
      );
    };

    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Error al leer imagen')); };
    img.src = url;
  });
}
