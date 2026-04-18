// src/styles/motion.js
//
// Framer Motion presets. Import these variants into every component
// that animates so the whole app moves with the same cadence.

import { motion as tokens } from "./tokens";

const d = (ms) => ms / 1000;

export const ease = {
  standard: [0.4, 0, 0.2, 1],
  emphasized: [0.2, 0, 0, 1],
  decelerate: [0, 0, 0.2, 1],
  accelerate: [0.4, 0, 1, 1],
};

export const fadeIn = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: { duration: d(tokens.duration.base), ease: ease.standard } },
  exit: { opacity: 0, transition: { duration: d(tokens.duration.fast), ease: ease.standard } },
};

export const fadeScale = {
  initial: { opacity: 0, scale: 0.97 },
  animate: {
    opacity: 1,
    scale: 1,
    transition: { duration: d(tokens.duration.slow), ease: ease.emphasized },
  },
  exit: {
    opacity: 0,
    scale: 0.98,
    transition: { duration: d(tokens.duration.fast), ease: ease.standard },
  },
};

export const slideUp = {
  initial: { opacity: 0, y: 8 },
  animate: {
    opacity: 1,
    y: 0,
    transition: { duration: d(tokens.duration.slow), ease: ease.emphasized },
  },
  exit: {
    opacity: 0,
    y: 4,
    transition: { duration: d(tokens.duration.fast), ease: ease.standard },
  },
};

export const slideDown = {
  initial: { opacity: 0, y: -8 },
  animate: {
    opacity: 1,
    y: 0,
    transition: { duration: d(tokens.duration.slow), ease: ease.emphasized },
  },
  exit: {
    opacity: 0,
    y: -4,
    transition: { duration: d(tokens.duration.fast), ease: ease.standard },
  },
};

export const pagePresence = {
  initial: { opacity: 0, y: 4 },
  animate: {
    opacity: 1,
    y: 0,
    transition: { duration: d(tokens.duration.slow), ease: ease.emphasized },
  },
  exit: {
    opacity: 0,
    transition: { duration: d(tokens.duration.fast), ease: ease.standard },
  },
};

// Tap / hover for buttons + cards. Mellow — no big scale.
export const tap = { scale: 0.99 };
export const hover = { y: -1 };

export const staggerChildren = (delayMs = 40) => ({
  animate: { transition: { staggerChildren: delayMs / 1000 } },
});

// Helper: attach to <motion.*> with the respective variant.
// Example: <motion.div {...fadeScale}>...</motion.div>
