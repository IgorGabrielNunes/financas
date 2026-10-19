import { api } from '../api';

// Foto de celular tem 3–8 MB. Reduzimos no navegador (lado maior 1600px, JPEG 0.82 ≈ 200–400 KB)
// antes de subir: economiza storage, banda móvel e mantém o recibo legível.
// PDF e HEIC (que o canvas não decodifica em todo navegador) sobem como vieram.
export async function comprimirImagem(arquivo: File): Promise<File> {
  if (!/^image\/(jpeg|png|webp)$/.test(arquivo.type) || arquivo.size < 400 * 1024) return arquivo;
  try {
    const bitmap = await createImageBitmap(arquivo);
    const escala = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * escala);
    canvas.height = Math.round(bitmap.height * escala);
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.82));
    if (!blob || blob.size >= arquivo.size) return arquivo;
    return new File([blob], arquivo.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' });
  } catch {
    return arquivo;
  }
}

export async function enviarComprovante(lancamentoId: string, arquivo: File) {
  const fd = new FormData();
  fd.append('arquivo', await comprimirImagem(arquivo));
  await api.post(`/lancamentos/${lancamentoId}/comprovantes`, fd);
}
