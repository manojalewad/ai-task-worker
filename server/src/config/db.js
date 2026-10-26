const mongoose = require('mongoose');
let memoryServer;
async function connectDB(uri = process.env.MONGODB_URI) {
  mongoose.set('strictQuery', true);
  if (!uri || uri === 'memory') {
    try {
      const { MongoMemoryServer } = require('mongodb-memory-server');
      memoryServer = await MongoMemoryServer.create();
      uri = memoryServer.getUri('company_ai_worker');
      console.log('MongoDB: using an in-memory database (data resets on restart). Set MONGODB_URI to persist.');
      process.env.__MEMORY_DB = '1';
    } catch (e) {
      throw new Error('MONGODB_URI is not set and the in-memory fallback is unavailable (' + e.message + '). Set MONGODB_URI to a MongoDB Atlas/local URI.');
    }
  }
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 12000 });
  console.log('MongoDB connected');
}
async function disconnectDB() { await mongoose.disconnect(); if (memoryServer) await memoryServer.stop(); }
module.exports = connectDB; module.exports.disconnectDB = disconnectDB;
