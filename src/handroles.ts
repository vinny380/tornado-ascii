// Decide which detected hand steers the tornado tip and which (if any) drives
// the color sweep. Steering prefers the user's right hand; the other hand, when
// a second is present, controls color. With a single hand, that hand steers and
// there is no color control. Labels come from MediaPipe handedness
// ("Left"/"Right"); the model sees the un-mirrored frame, so labels match the
// real hands. Caller must not pass an empty list (no hands -> nothing to do).
export function assignRoles(labels: string[]): {
  steer: number;
  color: number | null;
} {
  if (labels.length <= 1) return { steer: 0, color: null };
  const right = labels.indexOf("Right");
  const steer = right >= 0 ? right : 0;
  return { steer, color: steer === 0 ? 1 : 0 };
}
