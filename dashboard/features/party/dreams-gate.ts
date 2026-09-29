import { cachedMapImage } from './cached-map-image';
// The native dreams_gate is a composite, not its G.positions placeholder.
// Match generated_zones.js's atlas pieces and 120 ms flame/star cadence.
export function drawDreamsGate(ctx: CanvasRenderingContext2D, tilesets: Record<string, { file: string }>, now: number) {
  const piece = (sheet: string, sx: number, sy: number, w: number, h: number, x: number, y: number) => {
    const image = cachedMapImage(tilesets[sheet]?.file || '');
    if (image?.complete && image.naturalWidth) ctx.drawImage(image, sx, sy, w, h, x, y, w, h);
  };
  const stone = (x: number, y: number, w: number, h: number, left: boolean, right: boolean, sx = 224) => {
    const l = left ? 4 : 0, r = right ? 4 : 0;
    piece('dungeon', sx + l, 176, w - l - r, 4, x + l, y);
    piece('dungeon', sx, 180, w, h - 4, x, y + 4);
    if (left) piece('dungeon', 226, 130, 4, 4, x, y);
    if (right) piece('dungeon', 266, 130, 4, 4, x + w - 4, y);
  };
  for (const side of [-1, 1]) {
    for (let y = -24; y < 8; y += 8) {
      const sx = 224 + (y % 16 === 0 ? 0 : 8), x = side < 0 ? -32 : 24;
      if (y === -24) stone(x, y, 8, 8, side < 0, side > 0, sx);
      else piece('dungeon', sx, 176, 8, 8, x, y);
    }
    for (let y = -32; y < 8; y += 8) piece('dungeon', 224, 184, 8, 8, side < 0 ? -24 : 16, y);
    stone(side < 0 ? -24 : 8, -40, 16, 16, side < 0, side > 0);
    stone(side < 0 ? -16 : 0, -48, 16, 16, side < 0, side > 0);
  }
  stone(-8, -52, 16, 8, true, true);
  for (const x of [-30, 17]) piece('outside', 736, 560, 16, 32, x, -43);
  piece('outside', 736, 560, 16, 32, -8, -60);
  const frame = Math.floor(now / 120);
  portal(ctx, frame);
  [-48, 32].forEach((x, i) => {
    piece('dungeon', 16, 304, 16, 32, x, -12);
    piece('custom_a', ((frame + i) % 3) * 16, 0, 16, 16, x, -12);
  });
}
function portal(ctx: CanvasRenderingContext2D, frame: number) {
  ctx.fillStyle = '#222638'; ctx.beginPath();
  const points = [[-16,0],[-16,-24],[-12,-24],[-12,-32],[-6,-32],[-6,-36],[6,-36],[6,-32],[12,-32],[12,-24],[16,-24],[16,0]];
  points.forEach(([x,y], i) => i ? ctx.lineTo(x,y) : ctx.moveTo(x,y)); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#30354d'; ctx.fillRect(-14,-22,2,22); ctx.fillRect(12,-22,2,22);
  for (let i = 0; i < 16; i++) {
    const x = ((i * 17 + frame) % 26) - 13, y = -30 + ((i * 11 + frame) % 28);
    if (y < -24 && Math.abs(x) > 6) continue;
    ctx.fillStyle = ['#729d9e','#a7d3d0','#686c9c','#d8ebcf'][(i + frame) % 4]; ctx.fillRect(x,y,1,1);
  }
}
