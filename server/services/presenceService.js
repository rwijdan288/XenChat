'use strict';

// Pelacak koneksi per user (multi-tab/device): online selama jumlah koneksi > 0.
const connections = new Map();

function add(userId) {
  const n = (connections.get(userId) || 0) + 1;
  connections.set(userId, n);
  return n === 1; // true jika ini koneksi pertama (baru online)
}

function remove(userId) {
  const n = (connections.get(userId) || 0) - 1;
  if (n <= 0) {
    connections.delete(userId);
    return true; // true jika koneksi terakhir (baru offline)
  }
  connections.set(userId, n);
  return false;
}

const count = () => connections.size;
const isOnline = (userId) => connections.has(userId);

module.exports = { add, remove, isOnline, count };
