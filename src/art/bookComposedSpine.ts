/** Complete shelf-facing bindings. One programme owns the whole back. */
import { FLAT, contactShadow, type FlatCtx } from './flat';
import { bookPainterColours, bookPresetAuthoredFocalGlyph, type BookDesign, type DesignBox } from './bookDesign';
import { bindingEmblemIndexForAuthoredFocal } from './bookBindingIdentity';
import { paintRemasteredEmblem } from './bookEmblemArtwork';
import type { BookSpineCharacter } from './bookCompositions';

export function drawComposedSpine(
  ctx: FlatCtx, box: DesignBox, design: BookDesign,
  character: BookSpineCharacter, optionalEmblem: number,
): void {
  const {x, y, w, h} = box;
  const {base, accent} = bookPainterColours(design);
  const ink = Math.max(.85, Math.min(1.8, w * .055));
  const tool = design.tooling ?? (design.gilt ? '#d9bf83' : FLAT.ink);
  const inset = Math.max(ink * 2.4, w * .17);
  const cx = x + w / 2;
  const left = x + inset, right = x + w - inset;
  const rule = (at: number, doubled = false, colour = tool) => {
    ctx.strokeStyle = colour; ctx.lineWidth = Math.max(.65, ink * .55);
    ctx.beginPath(); ctx.moveTo(left, y + h * at); ctx.lineTo(right, y + h * at); ctx.stroke();
    if (doubled) {
      ctx.beginPath(); ctx.moveTo(left, y + h * at + ink * 2.1);
      ctx.lineTo(right, y + h * at + ink * 2.1); ctx.stroke();
    }
  };
  const silhouette = () => {
    const r = Math.min(3, w * .1), a = ink / 2;
    ctx.beginPath();
    ctx.moveTo(x + a + r, y + a);
    ctx.lineTo(x + w - a - r, y + a);
    ctx.quadraticCurveTo(x + w - a, y + a, x + w - a, y + a + r);
    ctx.lineTo(x + w - a, y + h - a - r);
    ctx.quadraticCurveTo(x + w - a, y + h - a, x + w - a - r, y + h - a);
    ctx.lineTo(x + a + r, y + h - a);
    ctx.quadraticCurveTo(x + a, y + h - a, x + a, y + h - a - r);
    ctx.lineTo(x + a, y + a + r);
    ctx.quadraticCurveTo(x + a, y + a, x + a + r, y + a);
    ctx.closePath();
  };
  const emblemIndex = bindingEmblemIndexForAuthoredFocal(bookPresetAuthoredFocalGlyph(design.preset)) ?? optionalEmblem;
  const emblem = (at: number, width = .7) => {
    if (emblemIndex >= 0) paintRemasteredEmblem(ctx, emblemIndex, cx, y + h * at, w * width / 2, design.emblem ?? tool);
  };
  const cord = (at: number) => {
    const bh = Math.max(2, h * .015);
    ctx.fillStyle = accent;
    ctx.fillRect(x + ink, y + h * at - bh / 2, w - ink * 2, bh);
    rule(at - bh / h / 2, false, FLAT.ink);
    rule(at + bh / h / 2, false, FLAT.ink);
  };
  ctx.save();
  silhouette(); ctx.fillStyle = base; ctx.fill(); ctx.save(); ctx.clip();
  // A narrow flat joint is construction, not a specular highlight.
  ctx.fillStyle = accent; ctx.fillRect(x, y, Math.max(2, w * .09), h);
  switch (character) {
    case 'quiet':
      // Unbroken cloth is the design. Only the tucked-in ends articulate it.
      rule(.055, false, accent); rule(.945, false, accent);
      break;
    case 'cosy':
      ctx.strokeStyle = accent; ctx.lineWidth = ink * .7;
      ctx.beginPath(); ctx.moveTo(right + ink, y + h * .045);
      ctx.lineTo(right + ink, y + h * .955); ctx.stroke();
      rule(.075, false, accent); rule(.925, false, accent);
      break;
    case 'rustic':
      ctx.fillStyle = accent;
      ctx.fillRect(x, y, w, h * .055); ctx.fillRect(x, y + h * .945, w, h * .055);
      rule(.11, false, FLAT.ink); rule(.89, false, FLAT.ink);
      break;
    case 'antique':
      cord(.14); cord(.86);
      rule(.185, true); rule(.805, true);
      break;
    case 'formal':
      rule(.12, true); rule(.86, true);
      emblem(.43, .63);
      break;
    case 'storybook':
      rule(.10, true); rule(.88, true);
      emblem(.40, .79);
      break;
    case 'botanical':
      rule(.085); rule(.915);
      emblem(.43, .82);
      break;
    case 'grand': {
      // A continuous perimeter and symmetric terminal scrolls form one system.
      ctx.strokeStyle = tool; ctx.lineWidth = Math.max(.75, ink * .6);
      ctx.strokeRect(left, y + h * .065, right - left, h * .87);
      rule(.21, true); rule(.78, true);
      emblem(.43, .75);
      const scroll = (at: number, flip: number) => {
        const yy = y + h * at, s = (right - left) * .5;
        ctx.beginPath();
        ctx.moveTo(cx, yy + flip * s * .58);
        ctx.bezierCurveTo(cx - s * .3, yy - flip * s * .55, left, yy - flip * s * .65, left + s * .18, yy);
        ctx.bezierCurveTo(left + s * .3, yy + flip * s * .33, cx - s * .2, yy + flip * s * .10, cx, yy + flip * s * .58);
        ctx.bezierCurveTo(cx + s * .3, yy - flip * s * .55, right, yy - flip * s * .65, right - s * .18, yy);
        ctx.bezierCurveTo(right - s * .3, yy + flip * s * .33, cx + s * .2, yy + flip * s * .10, cx, yy + flip * s * .58);
        ctx.stroke();
        ctx.fillStyle = tool;
        // Small opposing leaves grow from the scroll; their solid silhouettes
        // survive shelf scale better than another stack of hairline rules.
        for (const side of [-1, 1]) {
          for (const station of [.35, .70]) {
            const lx = cx + side * s * station;
            const ly = yy - flip * s * (.10 + station * .28);
            ctx.beginPath(); ctx.moveTo(lx, ly);
            ctx.quadraticCurveTo(lx - side * s * .18, ly - flip * s * .33,
              lx + side * s * .13, ly - flip * s * .40);
            ctx.quadraticCurveTo(lx + side * s * .24, ly - flip * s * .12, lx, ly);
            ctx.fill();
          }
        }
      };
      if (w >= 18) { scroll(.135, 1); scroll(.865, -1); }
      rule(.955); rule(.045);
      break;
    }
  }
  ctx.restore(); silhouette(); ctx.strokeStyle = FLAT.ink; ctx.lineWidth = ink; ctx.stroke();
  ctx.restore();
  contactShadow(ctx, cx, y + h, w * .53, Math.max(1.2, w * .07), .15);
}
