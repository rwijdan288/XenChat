'use strict';

// Pembatas sederhana (sliding window) per user per bucket, di memori proses.
const hits = new Map();

function allow(userId, bucket, limit, windowMs) {
  const key = `${userId}:${bucket}`;
  const now = Date.now();
  const arr = (hits.get(key) || []).filter((t) => now - t < windowMs);
  if (arr.length >= limit) {
    hits.set(key, arr);
    return false;
  }
  arr.push(now);
  hits.set(key, arr);
  return true;
}

setInterval(() => {
  const now = Date.now();
  for (const [key, arr] of hits) {
    if (!arr.length || now - arr[arr.length - 1] > 120000) hits.delete(key);
  }
}, 60000).unref();

module.exports = { allow };
