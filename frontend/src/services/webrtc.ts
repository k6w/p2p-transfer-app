import { io, Socket } from 'socket.io-client';

const SIGNALING_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

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
  hasPasscode?: boolean;
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
  completedFiles: number;
  totalFiles: number;
}

const CHUNK_SIZE = 16384;
const BUFFER_THRESHOLD = 16 * 1024 * 1024;
const LARGE_FILE_THRESHOLD = 100 * 1024 * 1024;
const DATA_CHANNEL_TIMEOUT = 15000;

export class WebRTCService {
  private socket: Socket;
  private peerConnection: RTCPeerConnection;
  private dataChannel: RTCDataChannel | null = null;
  private roomId: string | null = null;
  private isInitiator = false;
  private isNegotiating = false;
  private hasCreatedOffer = false;
  private cancelled = false;

  private senderPasscode: string | null = null;
  private senderFiles: File[] | null = null;
  private passcodeGateActive = false;
  private dataChannelReadyResolvers: Array<() => void> = [];

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
  public onWaitingForPasscode?: () => void;
  public onPasscodeAccepted?: () => void;

  constructor() {
    this.socket = io(SIGNALING_URL);
    this.peerConnection = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
      ],
    });

    this.setupSocketListeners();
    this.setupPeerConnectionListeners();
  }

  setSenderPasscode(passcode: string, files: File[]) {
    this.senderPasscode = passcode;
    this.senderFiles = files;
    this.passcodeGateActive = true;
  }

  private setupSocketListeners() {
    this.socket.on('room-joined', ({ participantCount, fileInfo, multipleFilesInfo }) => {
      if (multipleFilesInfo) {
        this.multipleFilesInfo = multipleFilesInfo;
        this.onMultipleFilesInfoReceived?.(multipleFilesInfo);
        if (multipleFilesInfo.hasPasscode) {
          this.onPasscodeRequired?.();
        }
      } else if (fileInfo) {
        this.onFileInfoReceived?.(fileInfo);
      }
    });

    this.socket.on('user-joined', ({ participantCount }) => {
      this.onUserJoined?.(participantCount);

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

    this.socket.on('multiple-files-info-updated', (filesInfo: MultipleFileInfo) => {
      this.multipleFilesInfo = filesInfo;
      this.onMultipleFilesInfoReceived?.(filesInfo);
      if (filesInfo.hasPasscode) {
        this.onPasscodeRequired?.();
      }
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
      if (this.peerConnection.connectionState === 'failed' ||
          this.peerConnection.connectionState === 'closed' ||
          this.peerConnection.connectionState === 'disconnected') {
        this.resetConnectionState();
      }

      this.onConnectionStateChange?.(this.peerConnection.connectionState);
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
    channel.bufferedAmountLowThreshold = 8 * 1024 * 1024;

    channel.onopen = () => {
      this.onDataChannelOpen?.();
      for (const resolve of this.dataChannelReadyResolvers) {
        resolve();
      }
      this.dataChannelReadyResolvers = [];
    };

    channel.onclose = () => {
      this.onDataChannelClose?.();
    };

    channel.onmessage = (event) => {
      this.handleDataChannelMessage(event.data);
    };

    channel.onerror = () => {
      this.onError?.('data channel error');
    };
  }

  private receivedChunks: ArrayBuffer[] = [];
  private expectedFileSize = 0;
  private receivedSize = 0;
  private expectedFileName = '';
  private expectedFileType = '';
  private fileWriter: WritableStreamDefaultWriter<Uint8Array> | null = null;
  private isLargeFile = false;

  private multipleFilesInfo: MultipleFileInfo | null = null;
  private currentFileIndex = 0;
  private completedFiles: File[] = [];
  private totalTransferred = 0;
  private isReceivingMultiple = false;
  private expectedTotalFiles = 0;
  private isPasscodeValidated = false;

  private handleDataChannelMessage(data: any) {
    if (typeof data === 'string') {
      const message = JSON.parse(data);

      if (message.type === 'passcode-submit') {
        this.handlePasscodeSubmitFromReceiver(message.passcode);
        return;
      }

      if (message.type === 'passcode-result') {
        const isValid = message.valid;
        this.isPasscodeValidated = isValid;
        this.onPasscodeValidated?.(isValid);
        return;
      }

      if (message.type === 'file-start') {
        this.receivedSize = 0;
        this.expectedFileSize = message.size;
        this.expectedFileName = message.name;
        this.expectedFileType = message.fileType;
        this.isLargeFile = message.size > LARGE_FILE_THRESHOLD;

        if (message.fileIndex !== undefined) {
          this.isReceivingMultiple = true;
          this.currentFileIndex = message.fileIndex;
          this.expectedTotalFiles = message.totalFiles || this.expectedTotalFiles;
        }

        if (this.isLargeFile) {
          this.initializeStreamingDownload();
        } else {
          this.receivedChunks = [];
        }

        this.onFileTransferStateChanged?.({
          currentFileIndex: this.currentFileIndex,
          completedFiles: this.completedFiles.length,
          totalFiles: this.expectedTotalFiles,
        });
      } else if (message.type === 'file-end') {
        if (this.isLargeFile) {
          this.finalizeStreamingDownload();
        } else {
          this.reconstructFile();
        }
      } else if (message.type === 'all-files-complete') {
        this.onAllFilesReceived?.(this.completedFiles);
      }
    } else {
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
        currentFileIndex: this.isReceivingMultiple ? this.currentFileIndex : undefined,
        currentFileName: this.expectedFileName,
      };

      this.onTransferProgress?.(progress);
    }
  }

  private handlePasscodeSubmitFromReceiver(submittedPasscode: string) {
    if (!this.senderPasscode) return;

    const isValid = submittedPasscode === this.senderPasscode;

    if (this.dataChannel?.readyState === 'open') {
      this.dataChannel.send(JSON.stringify({
        type: 'passcode-result',
        valid: isValid,
      }));
    }

    if (isValid) {
      this.onPasscodeAccepted?.();
      if (this.senderFiles) {
        if (this.senderFiles.length === 1) {
          this.sendFile(this.senderFiles[0]);
        } else {
          this.sendMultipleFiles(this.senderFiles);
        }
      }
    }
  }

  async submitPasscode(passcode: string) {
    const isReady = await this.waitForDataChannel();
    if (!isReady || !this.dataChannel) {
      this.onError?.('not connected to sender yet. try again.');
      return;
    }

    this.dataChannel.send(JSON.stringify({
      type: 'passcode-submit',
      passcode,
    }));
  }

  private reconstructFile() {
    const blob = new Blob(this.receivedChunks, { type: this.expectedFileType });
    const file = new File([blob], this.expectedFileName, { type: this.expectedFileType });

    if (this.isReceivingMultiple) {
      this.completedFiles.push(file);
      this.onFileTransferStateChanged?.({
        currentFileIndex: this.currentFileIndex,
        completedFiles: this.completedFiles.length,
        totalFiles: this.expectedTotalFiles,
      });
    }

    this.onFileReceived?.(file);
    this.receivedChunks = [];
  }

  private initializeStreamingDownload() {
    const chunks: Uint8Array[] = [];

    const writableStream = new WritableStream({
      write: (chunk: Uint8Array) => {
        chunks.push(chunk);
      },
      close: () => {
        const blob = new Blob(chunks, { type: this.expectedFileType });
        const file = new File([blob], this.expectedFileName, { type: this.expectedFileType });

        if (this.isReceivingMultiple) {
          this.completedFiles.push(file);
          this.onFileTransferStateChanged?.({
            currentFileIndex: this.currentFileIndex,
            completedFiles: this.completedFiles.length,
            totalFiles: this.expectedTotalFiles,
          });
        }

        this.onFileReceived?.(file);
      }
    });

    this.fileWriter = writableStream.getWriter();
  }

  private async writeStreamChunk(data: ArrayBuffer) {
    if (this.fileWriter) {
      try {
        await this.fileWriter.write(new Uint8Array(data));
      } catch {
        this.onError?.('failed to write file chunk');
      }
    }
  }

  private async finalizeStreamingDownload() {
    if (this.fileWriter) {
      try {
        await this.fileWriter.close();
        this.fileWriter = null;
      } catch {
        this.onError?.('failed to finalize file download');
      }
    }
  }

  private async waitForDataChannel(): Promise<boolean> {
    if (this.dataChannel?.readyState === 'open') {
      return true;
    }

    return new Promise<boolean>((resolve) => {
      const timeout = setTimeout(() => {
        this.dataChannelReadyResolvers = this.dataChannelReadyResolvers.filter(r => r !== onReady);
        resolve(false);
      }, DATA_CHANNEL_TIMEOUT);

      const onReady = () => {
        clearTimeout(timeout);
        resolve(true);
      };

      this.dataChannelReadyResolvers.push(onReady);
    });
  }

  async joinRoom(roomId: string, asInitiator = false) {
    this.roomId = roomId;
    this.isInitiator = asInitiator;

    if (asInitiator) {
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
      if (this.isNegotiating || this.hasCreatedOffer) return;

      this.isNegotiating = true;

      if (!this.dataChannel) {
        const channel = this.peerConnection.createDataChannel('fileTransfer', {
          ordered: true,
          maxRetransmits: 3
        });
        this.setupDataChannel(channel);
      }

      const offer = await this.peerConnection.createOffer();
      await this.peerConnection.setLocalDescription(offer);
      this.hasCreatedOffer = true;

      if (this.roomId) {
        this.socket.emit('offer', {
          roomId: this.roomId,
          offer: offer,
        });
      }
    } catch (error) {
      this.isNegotiating = false;
      this.onError?.(`failed to create connection: ${error instanceof Error ? error.message : 'unknown error'}`);
    }
  }

  async handleOffer(offer: RTCSessionDescriptionInit) {
    try {
      if (this.isInitiator) return;
      if (this.peerConnection.signalingState !== 'stable') return;

      await this.peerConnection.setRemoteDescription(offer);
      const answer = await this.peerConnection.createAnswer();
      await this.peerConnection.setLocalDescription(answer);

      if (this.roomId) {
        this.socket.emit('answer', {
          roomId: this.roomId,
          answer: answer,
        });
      }
    } catch {
      this.onError?.('failed to handle connection offer');
    }
  }

  async handleAnswer(answer: RTCSessionDescriptionInit) {
    try {
      if (!this.isInitiator) return;
      if (this.peerConnection.signalingState !== 'have-local-offer') return;
      if (!this.isNegotiating) return;

      await this.peerConnection.setRemoteDescription(answer);
      this.isNegotiating = false;
    } catch (error) {
      this.isNegotiating = false;
      this.onError?.(`connection failed: ${error instanceof Error ? error.message : 'unknown error'}`);
    }
  }

  async handleIceCandidate(candidate: RTCIceCandidateInit) {
    try {
      if (this.peerConnection.remoteDescription) {
        await this.peerConnection.addIceCandidate(candidate);
      }
    } catch {
      // non-fatal
    }
  }

  async sendFile(file: File, fileIndex?: number, totalFiles?: number) {
    const isReady = await this.waitForDataChannel();
    if (!isReady || !this.dataChannel || this.cancelled) {
      if (!this.cancelled) {
        this.onError?.('data channel failed to open');
      }
      return;
    }

    let offset = 0;

    const startMessage: Record<string, any> = {
      type: 'file-start',
      name: file.name,
      size: file.size,
      fileType: file.type,
    };

    if (fileIndex !== undefined) {
      startMessage.fileIndex = fileIndex;
      startMessage.totalFiles = totalFiles;
    }

    this.dataChannel.send(JSON.stringify(startMessage));

    const sendNextChunk = (): Promise<void> => {
      return new Promise((resolve, reject) => {
        if (this.cancelled) {
          reject(new Error('transfer cancelled'));
          return;
        }

        if (offset >= file.size) {
          this.dataChannel?.send(JSON.stringify({ type: 'file-end' }));
          resolve();
          return;
        }

        const chunk = file.slice(offset, offset + CHUNK_SIZE);
        const reader = new FileReader();

        reader.onload = (event) => {
          if (!event.target?.result || !this.dataChannel) {
            reject(new Error('read error'));
            return;
          }

          const data = event.target.result as ArrayBuffer;

          const trySend = () => {
            if (this.cancelled) {
              reject(new Error('transfer cancelled'));
              return;
            }

            try {
              if (this.dataChannel!.bufferedAmount > BUFFER_THRESHOLD) {
                this.dataChannel!.bufferedAmountLowThreshold = BUFFER_THRESHOLD / 2;
                const onLow = () => {
                  this.dataChannel?.removeEventListener('bufferedamountlow', onLow);
                  trySend();
                };
                this.dataChannel!.addEventListener('bufferedamountlow', onLow);
                return;
              }

              this.dataChannel!.send(data);
              offset += data.byteLength;

              this.onTransferProgress?.({
                transferred: Math.min(offset, file.size),
                total: file.size,
                percentage: Math.min((offset / file.size) * 100, 100),
                currentFileIndex: fileIndex,
                currentFileName: file.name,
              });

              sendNextChunk().then(resolve).catch(reject);
            } catch {
              reject(new Error('failed to send data'));
            }
          };

          trySend();
        };

        reader.onerror = () => reject(new Error('failed to read file'));
        reader.readAsArrayBuffer(chunk);
      });
    };

    try {
      await sendNextChunk();
    } catch (error) {
      if (!this.cancelled) {
        this.onError?.(error instanceof Error ? error.message : 'transfer failed');
      }
    }
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

  async sendMultipleFiles(files: File[]) {
    const isReady = await this.waitForDataChannel();
    if (!isReady || !this.dataChannel) {
      this.onError?.('data channel not ready');
      return;
    }

    for (let i = 0; i < files.length; i++) {
      if (this.cancelled) break;

      this.currentFileIndex = i;
      this.onFileTransferStateChanged?.({
        currentFileIndex: i,
        completedFiles: i,
        totalFiles: files.length,
      });

      await this.sendFile(files[i], i, files.length);
    }

    if (!this.cancelled && this.dataChannel?.readyState === 'open') {
      this.dataChannel.send(JSON.stringify({ type: 'all-files-complete' }));
    }
  }

  cancelTransfer() {
    this.cancelled = true;
  }

  private resetConnectionState() {
    this.isNegotiating = false;
    this.hasCreatedOffer = false;

    if (this.dataChannel) {
      this.dataChannel.close();
      this.dataChannel = null;
    }

    this.receivedChunks = [];
    this.expectedFileSize = 0;
    this.receivedSize = 0;
    this.expectedFileName = '';
    this.expectedFileType = '';
    this.multipleFilesInfo = null;
    this.currentFileIndex = 0;
    this.completedFiles = [];
    this.totalTransferred = 0;
    this.isPasscodeValidated = false;
    this.isReceivingMultiple = false;
    this.expectedTotalFiles = 0;
    this.cancelled = false;
    this.senderPasscode = null;
    this.senderFiles = null;
    this.passcodeGateActive = false;

    if (this.fileWriter) {
      this.fileWriter.close().catch(() => {});
      this.fileWriter = null;
    }

    this.isLargeFile = false;
  }

  disconnect() {
    this.cancelled = true;
    this.resetConnectionState();
    this.peerConnection.close();

    if (this.socket?.connected) {
      this.socket.disconnect();
    }

    this.roomId = null;
    this.isInitiator = false;
  }
}
