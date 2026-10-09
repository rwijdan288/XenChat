'use strict';

const mongoose = require('mongoose');
const config = require('./config');

async function connectDB() {
  mongoose.set('strictQuery', true);
  await mongoose.connect(config.mongoUri);
  console.log('[db] MongoDB terhubung');
}

module.exports = connectDB;
