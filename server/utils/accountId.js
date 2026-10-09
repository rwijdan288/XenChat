'use strict';

const crypto = require('crypto');

// 8 digit acak, tidak diawali 0 (10000000 - 99999999).
function generateAccountId() {
  return String(crypto.randomInt(10000000, 100000000));
}

module.exports = { generateAccountId };
