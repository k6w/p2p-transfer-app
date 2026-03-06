import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { v4 as uuidv4, validate as uuidValidate } from 'uuid';

const app = express();
const server = createServer(app);

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';
const PORT = process.env.PORT || 3001;
const MAX_ROOMS = 1000;
const DEFAULT_MAX_RECEIVERS = 1;
const ABSOLUTE_MAX_RECEIVERS = 50;
const ROOM_TTL_HOURS = 24;
const EMPTY_ROOM_CLEANUP_MS = 5 * 60 * 1000;

const io = new Server(server, {
  cors: {
    origin: FRONTEND_URL,
    methods: ['GET', 'POST']
  }
});

const allowedOrigins = [FRONTEND_URL];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  }
}));

app.use(express.json({ limit: '1kb' }));

app.disable('x-powered-by');

const rooms = new Map();
const socketRoomMap = new Map();

const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 20;

function rateLimit(req, res, next) {
  const ip = req.ip || req.connection.remoteAddress;
  const now = Date.now();
  const windowStart = now - RATE_LIMIT_WINDOW_MS;

  if (!rateLimitMap.has(ip)) {
    rateLimitMap.set(ip, []);
  }

  const requests = rateLimitMap.get(ip).filter(t => t > windowStart);
  rateLimitMap.set(ip, requests);

  if (requests.length >= RATE_LIMIT_MAX_REQUESTS) {
    return res.status(429).json({ error: 'Too many requests' });
  }

  requests.push(now);
  next();
}

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.post('/create-room', rateLimit, (req, res) => {
  if (rooms.size >= MAX_ROOMS) {
    return res.status(503).json({ error: 'Server is at capacity, try again later' });
  }

  let maxReceivers = DEFAULT_MAX_RECEIVERS;
  if (req.body && typeof req.body.maxReceivers === 'number') {
    maxReceivers = Math.max(1, Math.min(Math.floor(req.body.maxReceivers), ABSOLUTE_MAX_RECEIVERS));
  }

  const roomId = uuidv4();
  rooms.set(roomId, {
    id: roomId,
    participants: [],
    createdAt: new Date(),
    fileInfo: null,
    multipleFilesInfo: null,
    maxReceivers
  });

  res.json({
    roomId,
    shareUrl: `${FRONTEND_URL}/receive/${roomId}`,
    maxReceivers
  });
});

app.get('/room/:roomId', (req, res) => {
  const { roomId } = req.params;

  if (!uuidValidate(roomId)) {
    return res.status(400).json({ error: 'Invalid room ID format' });
  }

  const room = rooms.get(roomId);

  if (!room) {
    return res.status(404).json({ error: 'Room not found' });
  }

  res.json({
    roomId: room.id,
    participantCount: room.participants.length,
    maxReceivers: room.maxReceivers,
    hasFile: !!(room.fileInfo || room.multipleFilesInfo),
    fileInfo: room.fileInfo,
    multipleFilesInfo: room.multipleFilesInfo
  });
});

io.on('connection', (socket) => {
  socket.on('join-room', (roomId) => {
    if (!roomId || typeof roomId !== 'string' || !uuidValidate(roomId)) {
      socket.emit('error', 'invalid room id');
      return;
    }

    const room = rooms.get(roomId);
    if (!room) {
      socket.emit('error', 'room not found');
      return;
    }

    const maxTotal = 1 + room.maxReceivers;
    if (room.participants.length >= maxTotal &&
        !room.participants.find(p => p.id === socket.id)) {
      socket.emit('error', 'room is full');
      return;
    }

    const existingRoomId = socketRoomMap.get(socket.id);
    if (existingRoomId && existingRoomId !== roomId) {
      const existingRoom = rooms.get(existingRoomId);
      if (existingRoom) {
        const idx = existingRoom.participants.findIndex(p => p.id === socket.id);
        if (idx !== -1) {
          existingRoom.participants.splice(idx, 1);
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

    if (!room.participants.find(p => p.id === socket.id)) {
      room.participants.push({
        id: socket.id,
        joinedAt: new Date()
      });
    }

    socket.to(roomId).emit('user-joined', {
      userId: socket.id,
      participantCount: room.participants.length
    });

    socket.emit('room-joined', {
      roomId,
      participantCount: room.participants.length,
      maxReceivers: room.maxReceivers,
      fileInfo: room.fileInfo,
      multipleFilesInfo: room.multipleFilesInfo
    });
  });

  socket.on('set-file-info', ({ roomId, fileInfo }) => {
    if (!roomId || !fileInfo) return;
    const room = rooms.get(roomId);
    if (room) {
      room.fileInfo = {
        name: String(fileInfo.name || '').slice(0, 500),
        size: Number(fileInfo.size) || 0,
        type: String(fileInfo.type || '').slice(0, 200)
      };
      socket.to(roomId).emit('file-info-updated', room.fileInfo);
    }
  });

  socket.on('set-multiple-files-info', ({ roomId, filesInfo }) => {
    if (!roomId || !filesInfo) return;
    const room = rooms.get(roomId);
    if (room && Array.isArray(filesInfo.files)) {
      room.multipleFilesInfo = {
        files: filesInfo.files.slice(0, 100).map((f, i) => ({
          id: `file-${i}`,
          name: String(f.name || '').slice(0, 500),
          size: Number(f.size) || 0,
          type: String(f.type || '').slice(0, 200)
        })),
        totalSize: Number(filesInfo.totalSize) || 0,
        hasPasscode: !!filesInfo.passcode
      };
      socket.to(roomId).emit('multiple-files-info-updated', room.multipleFilesInfo);
    }
  });

  socket.on('offer', ({ roomId, offer }) => {
    if (!roomId || !offer) return;
    socket.to(roomId).emit('offer', { offer, senderId: socket.id });
  });

  socket.on('answer', ({ roomId, answer }) => {
    if (!roomId || !answer) return;
    socket.to(roomId).emit('answer', { answer, senderId: socket.id });
  });

  socket.on('ice-candidate', ({ roomId, candidate }) => {
    if (!roomId || !candidate) return;
    socket.to(roomId).emit('ice-candidate', { candidate, senderId: socket.id });
  });

  socket.on('disconnect', () => {
    const roomId = socketRoomMap.get(socket.id);
    if (roomId) {
      const room = rooms.get(roomId);
      if (room) {
        const idx = room.participants.findIndex(p => p.id === socket.id);
        if (idx !== -1) {
          room.participants.splice(idx, 1);
          socket.to(roomId).emit('user-left', {
            userId: socket.id,
            participantCount: room.participants.length
          });

          if (room.participants.length === 0) {
            setTimeout(() => {
              if (rooms.has(roomId) && rooms.get(roomId).participants.length === 0) {
                rooms.delete(roomId);
              }
            }, EMPTY_ROOM_CLEANUP_MS);
          }
        }
      }
      socketRoomMap.delete(socket.id);
    }
  });
});

setInterval(() => {
  const now = new Date();
  for (const [roomId, room] of rooms) {
    const ageInHours = (now - room.createdAt) / (1000 * 60 * 60);
    if (ageInHours > ROOM_TTL_HOURS) {
      rooms.delete(roomId);
    }
  }

  const windowStart = Date.now() - RATE_LIMIT_WINDOW_MS;
  for (const [ip, requests] of rateLimitMap) {
    const filtered = requests.filter(t => t > windowStart);
    if (filtered.length === 0) {
      rateLimitMap.delete(ip);
    } else {
      rateLimitMap.set(ip, filtered);
    }
  }
}, 60 * 60 * 1000);

server.listen(PORT, () => {});
