#include <metal_stdlib>
using namespace metal;

// The Dock's Genie effect: the card bends into a funnel whose neck is the dot and pours into it.
// `card` is the card's rect (minX, minY, maxX, maxY) inside the view, `target` the dot's centre beyond the card's
// top edge, or its bottom edge when `flip` is 1. At `p` 0 the card is untouched; up to 0.5 its sides curve into
// the funnel, and from 0.3 on it slides through the neck until it has gone into the dot at 1.
[[ stitchable ]] float2 genie(float2 position, float2 size, float4 card, float2 target, float p, float flip) {
  float2 pos = position;
  float4 c = card;
  float2 t = target;
  if (flip > 0.5) {
    pos.y = size.y - pos.y;
    c = float4(card.x, size.y - card.w, card.z, size.y - card.y);
    t.y = size.y - target.y;
  }
  if (pos.y < t.y) return float2(-100000.0);
  // Up to the view's far edge rather than the card's, so the shadow below the card pours in with it.
  float span = max(size.y - t.y, 1.0);
  float u = clamp((pos.y - t.y) / span, 0.0, 1.0);
  float profile = smoothstep(0.0, 1.0, u);
  float bend = smoothstep(0.0, 0.5, p);
  float slide = smoothstep(0.3, 1.0, p);
  float centre = (c.x + c.z) * 0.5;
  float half0 = (c.z - c.x) * 0.5;
  float half1 = mix(half0, mix(4.0, half0, profile), bend);
  float x = mix(centre, mix(t.x, centre, profile), bend);
  float2 source = float2(centre + (pos.x - x) / half1 * half0, pos.y + slide * span);
  if (flip > 0.5) source.y = size.y - source.y;
  return source;
}
