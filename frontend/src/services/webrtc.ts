import { io, Socket } from 'socket.io-client';

export interface FileInfo {
  name: string;
  size: number;
  type: string;
  id?: string;
}

export interface MultipleFileInfo {
  files: FileInfo[];
  totalSize: number;
  passcode?: string;
}

export interface TransferProgress {
  transferred: number;
  total: number;
  percentage: number;
  currentFileIndex?: number;
  currentFileName?: string;
}

export interface FileTransferState {
  currentFileIndex: number;
  completedFiles: File[];
  totalFiles: number;
}

export class WebRTCService {
  private socket: Socket;
  private peerConnection: RTCPeerConnection;
  private dataChannel: RTCDataChannel | null = null;
  private roomId: string | null = null;
  private isInitiator = false;
  private isNegotiating = false;
  private hasCreatedOffer = false;
  
  // Callbacks
  public onConnectionStateChange?: (state: RTCPeerConnectionState) => void;
  public onDataChannelOpen?: () => void;
  public onDataChannelClose?: () => void;
  public onFileReceived?: (file: File) => void;
  public onTransferProgress?: (progress: TransferProgress) => void;
  public onError?: (error: string) => void;
  public onUserJoined?: (participantCount: number) => void;
  public onUserLeft?: (participantCount: number) => void;
  public onFileInfoReceived?: (fileInfo: FileInfo) => void;
  public onMultipleFilesInfoReceived?: (filesInfo: MultipleFileInfo) => void;
  public onAllFilesReceived?: (files: File[]) => void;
  public onPasscodeRequired?: () => void;
  public onPasscodeValidated?: (isValid: boolean) => void;
  public onFileTransferStateChanged?: (state: FileTransferState) => void;

  constructor() {
    this.socket = io('http://localhost:3001');
    this.peerConnection = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
      ],
    });

    this.setupSocketListeners();
    this.setupPeerConnectionListeners();
  }

  private setupSocketListeners() {
    this.socket.on('room-joined', ({ participantCount, fileInfo }) => {
      if (fileInfo) {
        this.onFileInfoReceived?.(fileInfo);
      }
    });

    this.socket.on('user-joined', ({ participantCount }) => {
      this.onUserJoined?.(participantCount);
      
      // If we're the initiator and exactly 2 participants (us + 1 receiver), create an offer
      if (this.isInitiator && participantCount === 2 && 
          this.peerConnection.signalingState === 'stable' && 
          !this.hasCreatedOffer && !this.isNegotiating) {
        this.createOffer();
      }
    });

    this.socket.on('user-left', ({ participantCount }) => {
      this.onUserLeft?.(participantCount);
    });

    this.socket.on('file-info-updated', (fileInfo: FileInfo) => {
      this.onFileInfoReceived?.(fileInfo);
    });

    this.socket.on('offer', async ({ offer }) => {
      await this.handleOffer(offer);
    });

    this.socket.on('answer', async ({ answer }) => {
      await this.handleAnswer(answer);
    });

    this.socket.on('ice-candidate', async ({ candidate }) => {
      await this.handleIceCandidate(candidate);
    });

    this.socket.on('error', (error: string) => {
       this.onError?.(error);
     });
  }

  private setupPeerConnectionListeners() {
    this.peerConnection.onconnectionstatechange = () => {
      console.log(`Peer connection state changed to: ${this.peerConnection.connectionState}`);
      
      // Reset negotiation state on connection failure or close
      if (this.peerConnection.connectionState === 'failed' || 
          this.peerConnection.connectionState === 'closed' ||
          this.peerConnection.connectionState === 'disconnected') {
        this.resetConnectionState();
      }
      
      this.onConnectionStateChange?.(this.peerConnection.connectionState);
    };
    
    this.peerConnection.onsignalingstatechange = () => {
      console.log(`Signaling state changed to: ${this.peerConnection.signalingState}`);
    };
    
    this.peerConnection.onicegatheringstatechange = () => {
      console.log(`ICE gathering state changed to: ${this.peerConnection.iceGatheringState}`);
    };
    
    this.peerConnection.oniceconnectionstatechange = () => {
      console.log(`ICE connection state changed to: ${this.peerConnection.iceConnectionState}`);
    };

    this.peerConnection.onicecandidate = (event) => {
      if (event.candidate && this.roomId) {
        this.socket.emit('ice-candidate', {
          roomId: this.roomId,
          candidate: event.candidate,
        });
      }
    };

    this.peerConnection.ondatachannel = (event) => {
      this.setupDataChannel(event.channel);
    };
  }

  private setupDataChannel(channel: RTCDataChannel) {
    this.dataChannel = channel;
    
    // Configure buffer settings for better flow control
    channel.bufferedAmountLowThreshold = 8 * 1024 * 1024; // 8MB threshold
    
    channel.onopen = () => {
      console.log('Data channel opened successfully');
      this.onDataChannelOpen?.();
    };
    
    channel.onclose = () => {
      console.log('Data channel closed');
      this.onDataChannelClose?.();
    };
    
    channel.onmessage = (event) => {
      this.handleDataChannelMessage(event.data);
    };
    
    channel.onerror = (error) => {
      console.error('Data channel error:', error);
      this.onError?.(`Data channel error: ${error}`);
    };
    
    channel.onbufferedamountlow = () => {
      // Buffer is ready for more data
      console.log('Data channel buffer ready for more data');
    };
  }

  private receivedChunks: ArrayBuffer[] = [];
  private expectedFileSize = 0;
  private receivedSize = 0;
  private expectedFileName = '';
  private expectedFileType = '';
  private fileWriter: WritableStreamDefaultWriter<Uint8Array> | null = null;
  private downloadStream: ReadableStream<Uint8Array> | null = null;
  private isLargeFile = false;
  private readonly LARGE_FILE_THRESHOLD = 100 * 1024 * 1024; // 100MB threshold for streaming
  
  // Multiple files support
  private multipleFilesInfo: MultipleFileInfo | null = null;
  private currentFileIndex = 0;
  private completedFiles: File[] = [];
  private totalTransferred = 0;
  private passcode: string | null = null;
  private isPasscodeValidated = false;

  private handleDataChannelMessage(data: any) {
    if (typeof data === 'string') {
      // Control message
      const message = JSON.parse(data);
      
      if (message.type === 'file-start') {
        this.receivedSize = 0;
        this.expectedFileSize = message.size;
        this.expectedFileName = message.name;
        this.expectedFileType = message.fileType;
        this.isLargeFile = message.size > this.LARGE_FILE_THRESHOLD;
        
        if (this.isLargeFile) {
          // Use streaming for large files
          this.initializeStreamingDownload();
        } else {
          // Use in-memory chunks for smaller files
          this.receivedChunks = [];
        }
      } else if (message.type === 'file-end') {
        if (this.isLargeFile) {
          this.finalizeStreamingDownload();
        } else {
          this.reconstructFile();
        }
      }
    } else {
      // File chunk
      if (this.isLargeFile) {
        this.writeStreamChunk(data);
      } else {
        this.receivedChunks.push(data);
      }
      
      this.receivedSize += data.byteLength;
      
      const progress: TransferProgress = {
        transferred: this.receivedSize,
        total: this.expectedFileSize,
        percentage: (this.receivedSize / this.expectedFileSize) * 100,
      };
      
      this.onTransferProgress?.(progress);
    }
  }

  private reconstructFile() {
    const blob = new Blob(this.receivedChunks, { type: this.expectedFileType });
    const file = new File([blob], this.expectedFileName, { type: this.expectedFileType });
    this.onFileReceived?.(file);
  }

  private initializeStreamingDownload() {
    const chunks: Uint8Array[] = [];
    
    this.downloadStream = new ReadableStream({
      start(controller) {
        // Stream will be populated as chunks arrive
      },
      pull(controller) {
        // Handle backpressure if needed
      },
      cancel() {
        // Stream cancelled
      }
    });

    // Create a writable stream to collect chunks
    const writableStream = new WritableStream({
      write: (chunk: Uint8Array) => {
        chunks.push(chunk);
      },
      close: () => {
        // Create blob from all chunks when complete
        const blob = new Blob(chunks, { type: this.expectedFileType });
        const file = new File([blob], this.expectedFileName, { type: this.expectedFileType });
        this.onFileReceived?.(file);
      }
    });

    this.fileWriter = writableStream.getWriter();
  }

  private async writeStreamChunk(data: ArrayBuffer) {
    if (this.fileWriter) {
      try {
        await this.fileWriter.write(new Uint8Array(data));
      } catch (error) {
          this.onError?.('Failed to write file chunk');
        }
    }
  }

  private async finalizeStreamingDownload() {
    if (this.fileWriter) {
      try {
        await this.fileWriter.close();
        this.fileWriter = null;
        this.downloadStream = null;
      } catch (error) {
          this.onError?.('Failed to finalize file download');
        }
    }
  }

  async joinRoom(roomId: string, asInitiator = false) {
    this.roomId = roomId;
    this.isInitiator = asInitiator;
    
    if (asInitiator) {
      // Create data channel for the initiator with optimized settings
      this.dataChannel = this.peerConnection.createDataChannel('fileTransfer', {
        ordered: true,
        maxRetransmits: 3,
      });
      this.setupDataChannel(this.dataChannel);
    }
    
    this.socket.emit('join-room', roomId);
  }

  async createOffer() {
    try {
      if (this.isNegotiating || this.hasCreatedOffer) {
        console.log('Already negotiating or offer created, skipping');
        return;
      }
      
      this.isNegotiating = true;
      console.log('Creating WebRTC offer as initiator');
      
      // Create data channel before creating offer (initiator must create the data channel)
      if (!this.dataChannel) {
        console.log('Creating data channel for file transfer');
        const channel = this.peerConnection.createDataChannel('fileTransfer', {
          ordered: true,
          maxRetransmits: 3
        });
        this.setupDataChannel(channel);
      }
      
      const offer = await this.peerConnection.createOffer();
      await this.peerConnection.setLocalDescription(offer);
      this.hasCreatedOffer = true;
      console.log('Created and set local offer description');
      
      if (this.roomId) {
        this.socket.emit('offer', {
          roomId: this.roomId,
          offer: offer,
        });
        console.log('Sent offer to room:', this.roomId);
      }
    } catch (error) {
      console.error('Error creating offer:', error);
      this.isNegotiating = false;
      this.onError?.(`Failed to create offer: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async handleOffer(offer: RTCSessionDescriptionInit) {
    try {
      // Only handle offer if we are not the initiator and in the right state
      if (this.isInitiator) {
        return;
      }
      
      if (this.peerConnection.signalingState !== 'stable') {
        return;
      }
      
      await this.peerConnection.setRemoteDescription(offer);
      const answer = await this.peerConnection.createAnswer();
      await this.peerConnection.setLocalDescription(answer);
      
      if (this.roomId) {
        this.socket.emit('answer', {
          roomId: this.roomId,
          answer: answer,
        });
      }
    } catch (error) {
        this.onError?.('Failed to handle offer');
      }
  }

  async handleAnswer(answer: RTCSessionDescriptionInit) {
    try {
      // Only handle answer if we are the initiator and in the right state
      if (!this.isInitiator) {
        console.warn('Received answer but not initiator, ignoring');
        return;
      }
      
      if (this.peerConnection.signalingState !== 'have-local-offer') {
        console.warn(`Cannot handle answer in signaling state: ${this.peerConnection.signalingState}`);
        return;
      }
      
      if (!this.isNegotiating) {
        console.warn('Received answer but not currently negotiating, ignoring');
        return;
      }
      
      await this.peerConnection.setRemoteDescription(answer);
      this.isNegotiating = false;
      console.log('Successfully set remote description from answer');
    } catch (error) {
      console.error('Error handling answer:', error);
      this.isNegotiating = false;
      this.onError?.(`Failed to handle answer: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async handleIceCandidate(candidate: RTCIceCandidateInit) {
    try {
      // Only add ICE candidates if we have a remote description
      if (this.peerConnection.remoteDescription) {
        await this.peerConnection.addIceCandidate(candidate);
      }
    } catch (error) {
        // Ignore ICE candidate errors
      }
  }

  async sendFile(file: File) {
    if (!this.dataChannel) {
      this.onError?.('Data channel not created');
      return;
    }
    
    // Wait for data channel to be open (with timeout)
    if (this.dataChannel.readyState !== 'open') {
      console.log(`Data channel state: ${this.dataChannel.readyState}, waiting for open state...`);
      
      const waitForOpen = new Promise<boolean>((resolve) => {
        const timeout = setTimeout(() => resolve(false), 10000); // 10 second timeout
        
        if (this.dataChannel?.readyState === 'open') {
          clearTimeout(timeout);
          resolve(true);
          return;
        }
        
        const onOpen = () => {
          clearTimeout(timeout);
          this.dataChannel?.removeEventListener('open', onOpen);
          resolve(true);
        };
        
        this.dataChannel?.addEventListener('open', onOpen);
      });
      
      const isOpen = await waitForOpen;
      if (!isOpen) {
        this.onError?.(`Data channel failed to open within timeout. Current state: ${this.dataChannel.readyState}`);
        return;
      }
    }

    const chunkSize = 16384; // 16KB chunks (reduced from 64KB) to prevent buffer overflow
    const fileReader = new FileReader();
    let offset = 0;

    // Send file metadata
    const startMessage = {
      type: 'file-start',
      name: file.name,
      size: file.size,
      fileType: file.type,
    };
    
    this.dataChannel.send(JSON.stringify(startMessage));

    const sendChunk = () => {
      const chunk = file.slice(offset, offset + chunkSize);
      fileReader.readAsArrayBuffer(chunk);
    };

    const processSendProgress = () => {
      offset += chunkSize;
      
      const progress: TransferProgress = {
        transferred: offset,
        total: file.size,
        percentage: Math.min((offset / file.size) * 100, 100),
      };
      
      this.onTransferProgress?.(progress);

      if (offset < file.size) {
        sendChunk();
      } else {
        // Send end message
        const endMessage = { type: 'file-end' };
        this.dataChannel?.send(JSON.stringify(endMessage));
      }
    };

    fileReader.onload = (event) => {
      if (event.target?.result && this.dataChannel) {
        const data = event.target.result as ArrayBuffer;
        
        // Check data channel buffer to prevent overwhelming it
        const bufferThreshold = 16 * 1024 * 1024; // 16MB buffer limit
        
        if (this.dataChannel.bufferedAmount > bufferThreshold) {
          // Set up bufferedamountlow event to wait for buffer to drain
          const lowThreshold = bufferThreshold / 2; // 8MB
          this.dataChannel.bufferedAmountLowThreshold = lowThreshold;
          
          const onBufferLow = () => {
            if (this.dataChannel) {
              this.dataChannel.removeEventListener('bufferedamountlow', onBufferLow);
              try {
                this.dataChannel.send(data);
                processSendProgress();
              } catch (error) {
                  this.onError?.('Failed to send file data');
                }
            }
          };
          
          this.dataChannel.addEventListener('bufferedamountlow', onBufferLow);
        } else {
          try {
            this.dataChannel.send(data);
            processSendProgress();
          } catch (error) {
            this.onError?.('Failed to send file data');
          }
        }
      }
    };

    sendChunk();
  }

  setFileInfo(fileInfo: FileInfo) {
    if (this.roomId) {
      this.socket.emit('set-file-info', {
        roomId: this.roomId,
        fileInfo,
      });
    }
  }

  setMultipleFilesInfo(filesInfo: MultipleFileInfo) {
    this.multipleFilesInfo = filesInfo;
    if (this.roomId) {
      this.socket.emit('set-multiple-files-info', {
        roomId: this.roomId,
        filesInfo,
      });
    }
  }

  validatePasscode(passcode: string): boolean {
    if (!this.multipleFilesInfo?.passcode) {
      this.isPasscodeValidated = true;
      return true;
    }
    
    const isValid = passcode === this.multipleFilesInfo.passcode;
    this.isPasscodeValidated = isValid;
    this.onPasscodeValidated?.(isValid);
    return isValid;
  }

  async sendMultipleFiles(files: File[], passcode?: string) {
    if (!this.dataChannel || this.dataChannel.readyState !== 'open') {
      this.onError?.('Data channel not ready');
      return;
    }

    const filesInfo: MultipleFileInfo = {
      files: files.map((file, index) => ({
        name: file.name,
        size: file.size,
        type: file.type,
        id: `file-${index}`,
      })),
      totalSize: files.reduce((total, file) => total + file.size, 0),
      passcode,
    };

    this.setMultipleFilesInfo(filesInfo);

    // Send files sequentially
    for (let i = 0; i < files.length; i++) {
      this.currentFileIndex = i;
      await this.sendFile(files[i]);
      
      // Update transfer state
      this.onFileTransferStateChanged?.({
        currentFileIndex: i,
        completedFiles: this.completedFiles,
        totalFiles: files.length,
      });
    }
  }

  private resetConnectionState() {
    this.isNegotiating = false;
    this.hasCreatedOffer = false;
    
    if (this.dataChannel) {
      this.dataChannel.close();
      this.dataChannel = null;
    }
    
    // Reset file transfer state
    this.receivedChunks = [];
    this.expectedFileSize = 0;
    this.receivedSize = 0;
    this.expectedFileName = '';
    this.expectedFileType = '';
    this.multipleFilesInfo = null;
    this.currentFileIndex = 0;
    this.completedFiles = [];
    this.totalTransferred = 0;
    this.passcode = null;
    this.isPasscodeValidated = false;
    
    if (this.fileWriter) {
      this.fileWriter.close();
      this.fileWriter = null;
    }
    
    this.downloadStream = null;
    this.isLargeFile = false;
  }

  disconnect() {
    this.resetConnectionState();
    
    // Clean up peer connection
    this.peerConnection.close();
    
    // Clean up socket connection
    if (this.socket && this.socket.connected) {
      this.socket.disconnect();
    }
    
    // Reset room state
    this.roomId = null;
    this.isInitiator = false;
  }
}