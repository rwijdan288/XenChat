'use strict';

const AppError = require('../utils/AppError');

function notFound(req, res, next) {
  next(new AppError(404, 'Endpoint tidak ditemukan.'));
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json({ message: 'Format data tidak valid.' });
  }
  if (err && err.type === 'entity.too.large') {
    return res.status(413).json({ message: 'Data terlalu besar.' });
  }
  if (err && err.name === 'ValidationError') {
    return res.status(400).json({ message: 'Data tidak valid.' });
  }
  if (err instanceof AppError) {
    const body = { message: err.message };
    if (err.fields) body.fields = err.fields;
    return res.status(err.status).json(body);
  }
  console.error('[error]', err); // stack trace hanya di log server
  return res.status(500).json({ message: 'Terjadi kesalahan. Silakan coba lagi.' });
}

module.exports = { notFound, errorHandler };
