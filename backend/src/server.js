import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { v4 as uuidv4 } from 'uuid';

const app = express();
const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: "http://localhost:5173",
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Store active rooms and their participants
const rooms = new Map();

// Track socket to room mapping for cleanup
const socketRoomMap = new Map();

// Routes
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Create a new room for file sharing
app.post('/create-room', (req, res) => {
  const roomId = uuidv4();
  rooms.set(roomId, {
    id: roomId,
    participants: [],
    createdAt: new Date(),
    fileInfo: null
  });
  
  res.json({ 
    roomId, 
    shareUrl: `http://localhost:5173/receive/${roomId}` 
  });
});

// Get room info
app.get('/room/:roomId', (req, res) => {
  const { roomId } = req.params;
  const room = rooms.get(roomId);
  
  if (!room) {
    return res.status(404).json({ error: 'Room not found' });
  }
  
  res.json({
    roomId: room.id,
    participantCount: room.participants.length,
    hasFile: !!room.fileInfo,
    fileInfo: room.fileInfo
  });
});

// Socket.io connection handling
io.on('connection', (socket) => {
  
  // Join a room
  socket.on('join-room', (roomId) => {
    const room = rooms.get(roomId);
    if (!room) {
      socket.emit('error', 'Room not found');
      return;
    }
    
    // Check if this socket is already in a room and clean up
    const existingRoomId = socketRoomMap.get(socket.id);
    if (existingRoomId && existingRoomId !== roomId) {
      const existingRoom = rooms.get(existingRoomId);
      if (existingRoom) {
        const participantIndex = existingRoom.participants.findIndex(p => p.id === socket.id);
        if (participantIndex !== -1) {
          existingRoom.participants.splice(participantIndex, 1);
          socket.to(existingRoomId).emit('user-left', {
            userId: socket.id,
            participantCount: existingRoom.participants.length
          });
        }
      }
      socket.leave(existingRoomId);
    }
    
    socket.join(roomId);
    socketRoomMap.set(socket.id, roomId);
    
    // Check if user is already in the room (reconnection)
    const existingParticipant = room.participants.find(p => p.id === socket.id);
    if (!existingParticipant) {
      room.participants.push({
        id: socket.id,
        joinedAt: new Date()
      });
    }
    
    // Notify others in the room
    socket.to(roomId).emit('user-joined', {
      userId: socket.id,
      participantCount: room.participants.length
    });
    
    // Send current room state to the new user
    socket.emit('room-joined', {
      roomId,
      participantCount: room.participants.length,
      fileInfo: room.fileInfo
    });
  });
  
  // Set file info for a room (sender)
  socket.on('set-file-info', ({ roomId, fileInfo }) => {
    const room = rooms.get(roomId);
    if (room) {
      room.fileInfo = fileInfo;
      socket.to(roomId).emit('file-info-updated', fileInfo);
    }
  });
  
  // WebRTC signaling
  socket.on('offer', ({ roomId, offer }) => {
    socket.to(roomId).emit('offer', { offer, senderId: socket.id });
  });
  
  socket.on('answer', ({ roomId, answer }) => {
    socket.to(roomId).emit('answer', { answer, senderId: socket.id });
  });
  
  socket.on('ice-candidate', ({ roomId, candidate }) => {
    socket.to(roomId).emit('ice-candidate', { candidate, senderId: socket.id });
  });
  
  // Handle disconnection
  socket.on('disconnect', () => {
    
    // Get the room this socket was in
    const roomId = socketRoomMap.get(socket.id);
    if (roomId) {
      const room = rooms.get(roomId);
      if (room) {
        const participantIndex = room.participants.findIndex(p => p.id === socket.id);
        if (participantIndex !== -1) {
          room.participants.splice(participantIndex, 1);
          socket.to(roomId).emit('user-left', {
            userId: socket.id,
            participantCount: room.participants.length
          });
          
          // Clean up empty rooms after 5 minutes
          if (room.participants.length === 0) {
            setTimeout(() => {
              if (rooms.has(roomId) && rooms.get(roomId).participants.length === 0) {
                rooms.delete(roomId);
              }
            }, 5 * 60 * 1000);
          }
        }
      }
      // Clean up socket mapping
      socketRoomMap.delete(socket.id);
    }
  });
});

// Clean up old rooms periodically (24 hours)
setInterval(() => {
  const now = new Date();
  rooms.forEach((room, roomId) => {
    const ageInHours = (now - room.createdAt) / (1000 * 60 * 60);
    if (ageInHours > 24) {
      rooms.delete(roomId);
    }
  });
}, 60 * 60 * 1000); // Run every hour

server.listen(PORT, () => {
});