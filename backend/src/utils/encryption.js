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

// Compare plain password with hashed password
async function comparePassword(plainPassword, hashedPassword) {
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
