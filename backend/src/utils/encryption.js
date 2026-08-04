// src/utils/encryption.js
const bcrypt = require("bcryptjs");

// Hash password with bcrypt (for new passwords)
async function hashPassword(password) {
  try {
    const saltRounds = 12; // Higher = more secure but slower
    const hashedPassword = await bcrypt.hash(password, saltRounds);
    return hashedPassword;
  } catch (error) {
    throw new Error("Password hashing failed: " + error.message);
  }
}

/**
 * Compare a plain password with a stored hash.
 *
 * Returns false — never throws — when either side is missing. bcrypt.compare
 * rejects with "Illegal arguments" on a null hash, and that path was reachable
 * in production: userController stores `Password ? await hashPassword(...) : null`,
 * so any user created without one has `Password = NULL`, and authController then
 * called straight into here. The result was a 500 "Password comparison failed"
 * on what is simply a failed login.
 *
 * A missing hash means "this account cannot be logged into with a password",
 * which is a false, not an error.
 */
async function comparePassword(plainPassword, hashedPassword) {
  if (!plainPassword || !hashedPassword) return false;

  try {
    const isMatch = await bcrypt.compare(plainPassword, hashedPassword);
    return isMatch;
  } catch (error) {
    throw new Error("Password comparison failed: " + error.message);
  }
}

module.exports = {
  hashPassword,
  comparePassword,
};
