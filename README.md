# Peer-to-Peer File Transfer

A modern, secure peer-to-peer file transfer application that enables direct file sharing between browsers using WebRTC technology. No files are stored on servers - everything happens directly between users.

## ✨ Features

- 🔄 **Direct P2P Transfer**: Files are transferred directly between browsers using WebRTC
- 🔗 **Simple Sharing**: Generate shareable links for easy file distribution
- 📱 **Responsive Design**: Works seamlessly on desktop and mobile devices
- 🚀 **No Size Limits**: Transfer files of any size (limited only by browser memory)
- 🔒 **Privacy First**: No files stored on servers - completely private transfers
- ⚡ **Real-time Progress**: Live transfer progress and status updates
- 🎨 **Modern UI**: Beautiful interface built with shadcn/ui components
- 🌙 **Dark Mode**: Toggle between light and dark themes

## 🏗️ Architecture

This is a monorepo workspace containing:

### Frontend (`/frontend`)
- **Framework**: React 19 with TypeScript
- **Build Tool**: Vite 7
- **Styling**: Tailwind CSS with shadcn/ui components
- **Routing**: React Router DOM
- **WebRTC**: Native WebRTC APIs for peer connections
- **Real-time**: Socket.io client for signaling

### Backend (`/backend`)
- **Runtime**: Node.js with Express
- **WebSocket**: Socket.io for WebRTC signaling
- **Purpose**: Lightweight signaling server for peer discovery
- **CORS**: Configured for cross-origin requests

## 🚀 Quick Start

### Prerequisites
- Node.js 18+ 
- npm or yarn or pnpm

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/k6w/p2p-transfer-app
   cd peer-to-peer
   ```

2. **Install all dependencies**
   ```bash
   npm run install:all
   ```

3. **Start development servers**
   ```bash
   npm run dev
   ```

4. **Open your browser**
   - Frontend: http://localhost:5173
   - Backend: http://localhost:3001

### Available Scripts

```bash
# Install dependencies for all workspaces
npm run install:all

# Start both frontend and backend in development mode
npm run dev

# Start only frontend
npm run dev:frontend

# Start only backend
npm run dev:backend

# Build for production
npm run build
```

## 🔧 How It Works

1. **File Upload**: User selects a file and uploads it to the sender's browser
2. **Link Generation**: A unique share link is generated and can be sent to recipients
3. **Peer Discovery**: Both users connect to the signaling server via WebSocket
4. **WebRTC Handshake**: Direct peer-to-peer connection is established using WebRTC
5. **File Transfer**: File is transferred directly between browsers in chunks
6. **Download**: Recipient receives the file directly in their browser

## 🛠️ Technology Stack

### Frontend Dependencies
- **React 19** - Modern React with concurrent features
- **TypeScript** - Type-safe development
- **Vite** - Fast build tool and dev server
- **Tailwind CSS** - Utility-first CSS framework
- **shadcn/ui** - High-quality React components
- **React Router DOM** - Client-side routing
- **Socket.io Client** - Real-time communication
- **Lucide React** - Beautiful icons

### Backend Dependencies
- **Express** - Web application framework
- **Socket.io** - Real-time bidirectional communication
- **CORS** - Cross-origin resource sharing
- **UUID** - Unique identifier generation
- **Nodemon** - Development auto-restart

## 📁 Project Structure

```
peer-to-peer/
├── README.md
├── package.json          # Root workspace configuration
├── .gitignore           # Root gitignore
├── frontend/            # React frontend application
│   ├── src/
│   │   ├── components/  # Reusable UI components
│   │   ├── pages/       # Page components
│   │   ├── services/    # API and WebRTC services
│   │   ├── lib/         # Utility functions
│   │   └── assets/      # Static assets
│   ├── public/          # Public assets
│   ├── package.json     # Frontend dependencies
│   └── .gitignore       # Frontend-specific gitignore
└── backend/             # Node.js signaling server
    ├── src/
    │   └── server.js    # Express server with Socket.io
    ├── package.json     # Backend dependencies
    └── .gitignore       # Backend-specific gitignore
```

## 🔒 Security & Privacy

- **No Server Storage**: Files never touch the server - they go directly between browsers
- **WebRTC Encryption**: All transfers are encrypted by default via WebRTC
- **Temporary Links**: Share links can be configured to expire
- **No Tracking**: No user data is collected or stored

## 🌐 Browser Support

- Chrome 60+
- Firefox 55+
- Safari 11+
- Edge 79+

*WebRTC support required*

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- [WebRTC](https://webrtc.org/) for peer-to-peer communication
- [Socket.io](https://socket.io/) for real-time signaling
- [shadcn/ui](https://ui.shadcn.com/) for beautiful UI components
- [Vite](https://vitejs.dev/) for lightning-fast development