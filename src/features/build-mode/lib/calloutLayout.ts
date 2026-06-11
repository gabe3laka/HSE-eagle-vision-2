import type { BlueprintNote } from "../types";

/**
 * External callout placement — pure geometry so it's unit-testable.
 *
 * Instruction/note text must NOT sit inside the cropped blueprint (too small to
 * read on a phone). Each note becomes a readable card OUTSIDE the ghost,
 * connected back to its marker by a leader line. This module decides which side
 * the cards stack on and where each card + leader endpoint land. All
 * coordinates are card-space 0..1.
 */

export interface CardBounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type CalloutSide = "left" | "right" | "bottom";

export interface PlacedCallout {
  id: string;
  type: BlueprintNote["type"];
  text: string;
  side: CalloutSide;
  /** Leader start — the note's marker, in card space. */
  anchor: { x: number; y: number };
  /** Leader end / where the card attaches, in card space. */
  connect: { x: number; y: number };
}

// Rails: the inner edge the cards attach to, leaving a readable column to the
// screen edge. Tuned for a portrait phone card.
const RAIL_RIGHT = 0.58;
const RAIL_LEFT = 0.42;
const RAIL_BOTTOM = 0.72;
const MIN_GAP = 0.155; // vertical spacing so stacked cards don't overlap
const Y_MIN = 0.08;
const Y_MAX = 0.94;

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * Pick the side with the most empty room around the ghost. A ghost that spans
 * most of the width leaves no horizontal room → stack along the bottom.
 */
export function chooseCalloutSide(bounds: CardBounds): CalloutSide {
  const rightRoom = 1 - (bounds.x + bounds.w);
  const leftRoom = bounds.x;
  if (Math.max(leftRoom, rightRoom) < 0.16) return "bottom";
  return rightRoom >= leftRoom ? "right" : "left";
}

/**
 * Lay out callouts for the chosen side: cards are ordered by their marker
 * position and spread so they never overlap, with the leader endpoints on the
 * rail. Empty notes are dropped.
 */
export function layoutCallouts(bounds: CardBounds, notes: BlueprintNote[]): PlacedCallout[] {
  const usable = notes.filter((n) => n.text && n.text.trim().length > 0);
  if (usable.length === 0) return [];
  const side = chooseCalloutSide(bounds);

  const withAnchor = usable.map((n) => ({
    note: n,
    anchor: {
      x: clamp(bounds.x + n.x * bounds.w, 0, 1),
      y: clamp(bounds.y + n.y * bounds.h, 0, 1),
    },
  }));

  if (side === "bottom") {
    // Spread horizontally by marker x along the bottom rail.
    const sorted = [...withAnchor].sort((a, b) => a.anchor.x - b.anchor.x);
    let lastX = -Infinity;
    return sorted.map(({ note, anchor }) => {
      const x = Math.max(clamp(anchor.x, 0.12, 0.88), lastX + 0.24);
      lastX = x;
      return {
        id: note.id,
        type: note.type,
        text: note.text,
        side,
        anchor,
        connect: { x: clamp(x, 0.12, 0.92), y: RAIL_BOTTOM },
      };
    });
  }

  const railX = side === "right" ? RAIL_RIGHT : RAIL_LEFT;
  const sorted = [...withAnchor].sort((a, b) => a.anchor.y - b.anchor.y);
  let lastY = -Infinity;
  return sorted.map(({ note, anchor }) => {
    const y = Math.max(clamp(anchor.y, Y_MIN, Y_MAX), lastY + MIN_GAP);
    lastY = y;
    return {
      id: note.id,
      type: note.type,
      text: note.text,
      side,
      anchor,
      connect: { x: railX, y: clamp(y, Y_MIN, Y_MAX) },
    };
  });
}
