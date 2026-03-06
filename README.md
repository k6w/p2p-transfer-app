# p2p file transfer

a modern peer-to-peer file transfer app that sends files directly between browsers using webrtc. no files are stored on servers - everything goes directly between users.

## features

- **direct p2p transfer** - files sent directly between browsers via webrtc data channels
- **no size limits** - transfer files of any size (limited only by browser memory)
- **multiple files** - send multiple files in a single session
- **passcode protection** - optional 6-digit passcode to protect transfers
- **real-time progress** - live transfer progress and status updates
- **dark mode** - toggle between light and dark themes
- **responsive** - works on desktop and mobile
- **no server storage** - files never touch the server

## architecture

monorepo with two workspaces:

### frontend (`/frontend`)
- react 19 + typescript
- vite 7
- tailwind css + shadcn/ui
- react router dom
- socket.io client for signaling
- native webrtc apis

### backend (`/backend`)
- node.js + express
- socket.io for webrtc signaling
- lightweight signaling server for peer discovery
- rate limiting and input validation

## quick start

### prerequisites
- node.js 18+
- npm

### installation

```bash
git clone https://github.com/k6w/p2p-transfer-app
cd p2p-transfer-app
npm run install:all
```

### development

```bash
npm run dev
```

- frontend: http://localhost:5173
- backend: http://localhost:3001

### environment variables

backend:
- `PORT` - server port (default: 3001)
- `FRONTEND_URL` - frontend origin for cors (default: http://localhost:5173)

frontend (`.env`):
- `VITE_API_URL` - backend api url (default: http://localhost:3001)

### scripts

```bash
npm run install:all    # install all dependencies
npm run dev            # start both frontend and backend
npm run dev:frontend   # start frontend only
npm run dev:backend    # start backend only
npm run build          # build for production
```

## how it works

1. sender selects files and creates a share link
2. share link is sent to recipient (out of band)
3. both users connect to the signaling server via websocket
4. webrtc peer connection is established (offer/answer/ice)
5. files are transferred directly between browsers in chunks
6. recipient downloads the files from their browser

## security

- files never touch the server - direct browser-to-browser transfer
- webrtc encrypts all data channel traffic (dtls)
- optional passcode protection for transfers
- rate limiting on room creation
- input validation on all server endpoints
- rooms auto-expire after 24 hours

## browser support

- chrome 60+
- firefox 55+
- safari 11+
- edge 79+

webrtc support required.

## license

mit
