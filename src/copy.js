// What the break says. Each entry is [the line, the question that follows].
// Milestone lines run in this order, one per break, then go round again.

export const MILESTONE = [
  ['You are working so hard.', 'Cool down for a second? 😂'],
  ['Easy, champ. The wrap isn’t going anywhere.', 'Quick breather?'],
  ['Your fingers have filed a complaint.', 'Give them a minute?'],
  ['At this point it counts as cardio.', 'Catch your breath?'],
  ['Somewhere, a parcel is travelling completely unprotected.', 'Worth it, though?'],
  ['Not a single one saw it coming.', 'Feeling a little lighter?'],
  ['That’s a lot of feelings for one roll of plastic.', 'Better now?'],
  ['The bubbles would like to negotiate.', 'Hear them out?'],
];

// For a single sheet that's been popped clean.
export const EMPTY = [
  ['Not one survivor.', 'Feeling a little lighter?'],
  ['Well. That sheet had it coming.', 'Better now?'],
  ['Clean sweep. Very thorough.', 'Feeling a little lighter?'],
];

export function milestoneCopy(nth) {
  // Falls back to the first line rather than ever leaving the break blank.
  return MILESTONE[(Math.max(1, nth | 0) - 1) % MILESTONE.length] || MILESTONE[0];
}

export function emptyCopy() {
  return EMPTY[Math.floor(Math.random() * EMPTY.length)];
}
