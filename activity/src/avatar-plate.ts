import * as THREE from "three";

const PLATE_SIZE = 128;
const LOAD_TIMEOUT_MS = 6000;

export const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[character] ?? character));

export const initialsOf = (name: string) => Array.from(name).slice(0, 2).join("") || "?";

export const loadImage = (url: string) => new Promise<HTMLImageElement>((resolve, reject) => {
  const image = new Image();
  image.decoding = "async";
  const timer = window.setTimeout(() => reject(new Error("avatar timeout")), LOAD_TIMEOUT_MS);
  image.onload = () => { window.clearTimeout(timer); resolve(image); };
  image.onerror = () => { window.clearTimeout(timer); reject(new Error("avatar failed")); };
  image.src = url;
});

/**
 * 원형으로 잘라낸 아바타 판. 구에 그대로 UV 매핑하면 얼굴이 왜곡되므로
 * 구 앞에 카메라를 향하는 판을 따로 붙인다. 사진이 없으면 이니셜로 채운다.
 */
export const plateTexture = (source: HTMLImageElement | null, fallback: string): THREE.Texture | null => {
  const canvas = document.createElement("canvas");
  canvas.width = PLATE_SIZE;
  canvas.height = PLATE_SIZE;
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.beginPath();
  context.arc(PLATE_SIZE / 2, PLATE_SIZE / 2, PLATE_SIZE / 2 - 1, 0, Math.PI * 2);
  context.closePath();
  context.clip();
  if (source) {
    const side = Math.min(source.naturalWidth, source.naturalHeight);
    context.drawImage(
      source, (source.naturalWidth - side) / 2, (source.naturalHeight - side) / 2, side, side,
      0, 0, PLATE_SIZE, PLATE_SIZE,
    );
  } else {
    context.fillStyle = "#223049";
    context.fillRect(0, 0, PLATE_SIZE, PLATE_SIZE);
    context.fillStyle = "#cfdbf2";
    context.font = "600 50px system-ui, -apple-system, sans-serif";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(fallback, PLATE_SIZE / 2, PLATE_SIZE / 2 + 2);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
};
