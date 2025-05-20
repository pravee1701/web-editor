import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import { Server } from 'socket.io';
import http from 'http';
import connectDB from './config/db.js';
import authRoutes from './routes/authRoutes.js';
import fileRoutes from './routes/fileRoutes.js';
import vfsRoutes from './routes/vfsRoutes.js';
import { setupTerminalSocket } from './controllers/terminalController.js';
import { setupEditorSocket } from './controllers/editorController.js';
import { cleanupContainers } from './controllers/dockerController.js';
import { setupCollaborationSocket } from './controllers/collaborationController.js'; 
import cookieParser from 'cookie-parser';
import fsRoutes from './routes/fsRoutes.js'; 
import mongoose from 'mongoose';

// Load environment variables
dotenv.config();

// Connect to MongoDB
connectDB();

const app = express();

// Middleware
app.use(cors({
  origin: process.env.CORS_ORIGIN_URI || 'http://localhost:5173',
  credentials: true,
}));
app.use(express.json()); // Parse JSON request bodies
app.use(cookieParser());

// API Routes
app.get('/', (req, res) => {
  res.send('API is running...');
});

// Create HTTP server
const server = http.createServer(app);

// Create Socket.IO server
const io = new Server(server, {
  cors: {
    origin: process.env.CORS_ORIGIN_URI || 'http://localhost:5173',
    methods: ['GET', 'POST'],
    credentials: true,
  },
});

setupEditorSocket(io);
setupTerminalSocket(io); 
setupCollaborationSocket(io);


// WebSocket Events
io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`);

  socket.on('codeChange', (code) => {
    socket.broadcast.emit('codeChange', code);
  });

  socket.on('disconnect', () => {
    console.log(`User disconnected: ${socket.id}`);
  });
});

app.use('/api/auth', authRoutes);
app.use('/api/files', fileRoutes);
app.use('/api/fs', fsRoutes);
app.use('/api/vfs', vfsRoutes); 

// Start the main server
const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  console.log(`Server running in ${process.env.NODE_ENV} mode on port ${PORT}`);
});

// Graceful shutdown
async function gracefulShutdown(signal) {
  console.log(`\n${signal} received. Starting graceful shutdown...`);
  try {
    await cleanupContainers();
    console.log('Docker containers cleaned up.');
  } catch (err) {
    console.error('Error during container cleanup:', err);
  }
  
  // Close both servers
  server.close(() => {
    console.log('Main HTTP server closed.');
      mongoose.disconnect().then(() => {
        console.log('MongoDB connection closed.');
        process.exit(0);
      }).catch(err => {
        console.error('Error closing MongoDB connection:', err);
        process.exit(1);
      });
    });
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));