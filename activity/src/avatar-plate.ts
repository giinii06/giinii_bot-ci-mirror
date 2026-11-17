import * as THREE from "three";

const ORB_SIZE = 256;
const HALO_SIZE = 128;
const RING_SIZE = 256;
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

const canvasTexture = (
  size: number,
  draw: (context: CanvasRenderingContext2D, size: number) => void,
): THREE.Texture | null => {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (!context) return null;
  draw(context, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
};

export const orbTexture = (
  source: HTMLImageElement | null,
  fallback: string,
  communityColor: string,
): THREE.Texture | null =>
  canvasTexture(ORB_SIZE, (context, size) => {
    const centerTint = `#${new THREE.Color("#0e162a").lerp(new THREE.Color(communityColor), 0.36).getHexString()}`;
    const edgeTint = "#0e162a";
    const gradient = context.createRadialGradient(
      size * 0.5, size * 0.44, size * 0.06,
      size * 0.5, size * 0.5, size * 0.68,
    );
    gradient.addColorStop(0, centerTint);
    gradient.addColorStop(1, edgeTint);
    context.fillStyle = gradient;
    context.fillRect(0, 0, size, size);

    if (source) {
      const side = Math.min(source.naturalWidth, source.naturalHeight);
      context.drawImage(
        source,
        (source.naturalWidth - side) / 2,
        (source.naturalHeight - side) / 2,
        side,
        side,
        0,
        0,
        size,
        size,
      );
      return;
    }

    context.fillStyle = "#f0f2ff";
    context.font = "700 84px system-ui, -apple-system, sans-serif";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(fallback, size / 2, size / 2 + 2, size * 0.58);
  });

export const haloTexture = (): THREE.Texture | null =>
  canvasTexture(HALO_SIZE, (context, size) => {
    const half = size / 2;
    const gradient = context.createRadialGradient(half, half, 0, half, half, half);
    gradient.addColorStop(0, "rgba(255, 255, 255, 0.85)");
    gradient.addColorStop(0.28, "rgba(255, 255, 255, 0.42)");
    gradient.addColorStop(0.62, "rgba(255, 255, 255, 0.10)");
    gradient.addColorStop(1, "rgba(255, 255, 255, 0)");
    context.fillStyle = gradient;
    context.fillRect(0, 0, size, size);
  });

export const ringTexture = (color: string): THREE.Texture | null =>
  canvasTexture(RING_SIZE, (context, size) => {
    context.beginPath();
    context.arc(size / 2, size / 2, size / 2 - 10, 0, Math.PI * 2);
    context.lineWidth = 10;
    context.strokeStyle = color;
    context.stroke();
  });
