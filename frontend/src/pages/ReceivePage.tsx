import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Download, FileText, Loader2, AlertCircle, CheckCircle, Home, Lock, Files } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { InputOTP, InputOTPGroup, InputOTPSeparator, InputOTPSlot } from '@/components/ui/input-otp';
import { toast } from 'sonner';
import { ApiService } from '@/services/api';
import type { RoomInfo } from '@/services/api';
import { WebRTCService } from '@/services/webrtc';
import type { FileInfo, TransferProgress, MultipleFileInfo, FileTransferState } from '@/services/webrtc';
import { formatFileSize } from '@/lib/utils';

export function ReceivePage() {
  const { roomId } = useParams<{ roomId: string }>();
  const navigate = useNavigate();
  const [roomInfo, setRoomInfo] = useState<RoomInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>('');
  const [connectionState, setConnectionState] = useState<RTCPeerConnectionState>('new');
  const [fileInfo, setFileInfo] = useState<FileInfo | null>(null);
  const [transferProgress, setTransferProgress] = useState<TransferProgress | null>(null);
  const [receivedFile, setReceivedFile] = useState<File | null>(null);
  const [participantCount, setParticipantCount] = useState(0);
  const [isReceiving, setIsReceiving] = useState(false);
  const webrtcRef = useRef<WebRTCService | null>(null);

  const [multipleFilesInfo, setMultipleFilesInfo] = useState<MultipleFileInfo | null>(null);
  const [receivedFiles, setReceivedFiles] = useState<File[]>([]);
  const [fileTransferState, setFileTransferState] = useState<FileTransferState | null>(null);
  const [passcodeRequired, setPasscodeRequired] = useState(false);
  const [passcode, setPasscode] = useState('');
  const [passcodeValidated, setPasscodeValidated] = useState(false);
  const [allFilesReceived, setAllFilesReceived] = useState(false);

  useEffect(() => {
    if (!roomId) {
      setError('Invalid room ID');
      setLoading(false);
      return;
    }

    loadRoomInfo();

    return () => {
      if (webrtcRef.current) {
        webrtcRef.current.disconnect();
        webrtcRef.current = null;
      }
    };
  }, [roomId]);

  const loadRoomInfo = async () => {
    try {
      setError('');
      setLoading(true);
      const info = await ApiService.getRoomInfo(roomId!);
      setRoomInfo(info);

      if (info.fileInfo) {
        setFileInfo(info.fileInfo as FileInfo);
      }

      if (info.multipleFilesInfo) {
        setMultipleFilesInfo(info.multipleFilesInfo as MultipleFileInfo);
        if (info.multipleFilesInfo.hasPasscode) {
          setPasscodeRequired(true);
        }
      }

      const webrtc = new WebRTCService();
      webrtcRef.current = webrtc;

      webrtc.onConnectionStateChange = (state) => {
        setConnectionState(state);
      };

      webrtc.onUserJoined = (count) => setParticipantCount(count);
      webrtc.onUserLeft = (count) => setParticipantCount(count);

      webrtc.onFileInfoReceived = (info) => {
        setFileInfo(info);
      };

      webrtc.onMultipleFilesInfoReceived = (filesInfo) => {
        setMultipleFilesInfo(filesInfo);
        if (filesInfo.hasPasscode || filesInfo.passcode) {
          setPasscodeRequired(true);
        }
      };

      webrtc.onTransferProgress = (progress) => {
        setTransferProgress(progress);
        setIsReceiving(true);
      };

      webrtc.onFileReceived = (file) => {
        if (multipleFilesInfo || receivedFiles.length > 0) {
          setReceivedFiles(prev => [...prev, file]);
        } else {
          setReceivedFile(file);
        }
        setIsReceiving(false);
      };

      webrtc.onAllFilesReceived = (files) => {
        setReceivedFiles(files);
        setAllFilesReceived(true);
        setIsReceiving(false);
        toast.success(`received ${files.length} files`);
      };

      webrtc.onPasscodeRequired = () => {
        setPasscodeRequired(true);
      };

      webrtc.onPasscodeValidated = (isValid) => {
        setPasscodeValidated(isValid);
        if (isValid) {
          toast.success('Passcode accepted');
        } else {
          toast.error('Wrong passcode');
          setPasscode('');
        }
      };

      webrtc.onFileTransferStateChanged = (state) => {
        setFileTransferState(state);
      };

      webrtc.onError = (err) => {
        setError(err);
        toast.error(err);
      };

      await webrtc.joinRoom(roomId!, false);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to load room';
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const downloadFile = (file: File) => {
    const url = URL.createObjectURL(file);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const downloadAllFiles = () => {
    if (receivedFiles.length === 0) return;

    receivedFiles.forEach((file, i) => {
      setTimeout(() => downloadFile(file), i * 300);
    });

    toast.success(`downloading ${receivedFiles.length} files`);
  };

  const handlePasscodeSubmit = () => {
    if (!webrtcRef.current || passcode.length !== 6) {
      toast.error('Enter a 6-digit passcode');
      return;
    }

    webrtcRef.current.validatePasscode(passcode);
  };

  const getStatusText = () => {
    if (allFilesReceived || receivedFile) return 'Transfer complete';
    if (isReceiving) return 'Receiving...';
    switch (connectionState) {
      case 'connecting': return 'Connecting to sender...';
      case 'connected': return 'Connected';
      case 'disconnected': return 'Disconnected';
      case 'failed': return 'Connection failed';
      default: return 'Waiting for connection...';
    }
  };

  const getStatusColor = () => {
    if (allFilesReceived || receivedFile) return 'text-green-400';
    if (isReceiving) return 'text-blue-400';
    switch (connectionState) {
      case 'connected': return 'text-green-400';
      case 'connecting': return 'text-yellow-400';
      case 'failed': return 'text-red-400';
      default: return 'text-muted-foreground';
    }
  };

  if (loading) {
    return (
      <div className="container mx-auto px-4 py-4 sm:py-8 max-w-2xl">
        <div className="flex items-center justify-center min-h-[300px] sm:min-h-[400px]">
          <div className="text-center space-y-4">
            <Loader2 className="h-6 w-6 sm:h-8 sm:w-8 animate-spin mx-auto" />
            <p className="text-sm sm:text-base text-muted-foreground px-4">loading...</p>
          </div>
        </div>
      </div>
    );
  }

  if (error && !roomInfo) {
    return (
      <div className="container mx-auto px-4 py-4 sm:py-8 max-w-2xl">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-red-400 text-lg sm:text-xl">
              <AlertCircle className="h-5 w-5" />
              error
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm sm:text-base text-muted-foreground mb-4 px-2">{error}</p>
            <div className="flex flex-col sm:flex-row gap-3 sm:gap-2">
              <Button onClick={() => navigate('/')} variant="outline" className="h-12 text-base">
                <Home className="h-4 w-4 mr-2" />
                go home
              </Button>
              <Button onClick={loadRoomInfo} className="h-12 text-base">
                try again
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-4 sm:py-8 max-w-2xl">
      <div className="text-center mb-6 sm:mb-8">
        <h1 className="text-2xl sm:text-4xl font-bold mb-2 px-2">receive files</h1>
        <p className="text-sm sm:text-base text-muted-foreground px-4">
          peer-to-peer file transfer
        </p>
      </div>

      <div className="space-y-6">
        {passcodeRequired && !passcodeValidated && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg sm:text-xl">
                <Lock className="h-5 w-5" />
                enter passcode
              </CardTitle>
              <CardDescription className="text-sm sm:text-base px-2">
                this transfer is passcode-protected
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4 sm:space-y-6">
                <div className="flex justify-center">
                  <InputOTP maxLength={6} value={passcode} onChange={setPasscode}>
                    <InputOTPGroup className="gap-1 sm:gap-2">
                      <InputOTPSlot index={0} className="w-10 h-10 sm:w-12 sm:h-12 text-base sm:text-lg" />
                      <InputOTPSlot index={1} className="w-10 h-10 sm:w-12 sm:h-12 text-base sm:text-lg" />
                      <InputOTPSlot index={2} className="w-10 h-10 sm:w-12 sm:h-12 text-base sm:text-lg" />
                    </InputOTPGroup>
                    <InputOTPSeparator />
                    <InputOTPGroup className="gap-1 sm:gap-2">
                      <InputOTPSlot index={3} className="w-10 h-10 sm:w-12 sm:h-12 text-base sm:text-lg" />
                      <InputOTPSlot index={4} className="w-10 h-10 sm:w-12 sm:h-12 text-base sm:text-lg" />
                      <InputOTPSlot index={5} className="w-10 h-10 sm:w-12 sm:h-12 text-base sm:text-lg" />
                    </InputOTPGroup>
                  </InputOTP>
                </div>
                <Button
                  onClick={handlePasscodeSubmit}
                  disabled={passcode.length !== 6}
                  className="w-full h-12 text-base"
                >
                  validate
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {multipleFilesInfo && multipleFilesInfo.files && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg sm:text-xl">
                <Files className="h-5 w-5" />
                {multipleFilesInfo.files.length} files
              </CardTitle>
              <CardDescription className="text-sm sm:text-base px-2">
                {formatFileSize(multipleFilesInfo.totalSize)} total
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-2 sm:space-y-3">
                {multipleFilesInfo.files.map((file, index) => (
                  <div key={file.id || index} className="flex items-center justify-between p-3 sm:p-4 bg-muted rounded-lg">
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <FileText className="h-4 w-4 sm:h-5 sm:w-5 text-muted-foreground flex-shrink-0" />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm sm:text-base font-medium truncate">{file.name}</p>
                        <p className="text-xs sm:text-sm text-muted-foreground">{formatFileSize(file.size)}</p>
                      </div>
                    </div>
                    <div className="flex-shrink-0 ml-2">
                      {fileTransferState && index < fileTransferState.completedFiles && (
                        <CheckCircle className="h-4 w-4 sm:h-5 sm:w-5 text-green-500" />
                      )}
                      {fileTransferState && index === fileTransferState.currentFileIndex && isReceiving && (
                        <Loader2 className="h-4 w-4 sm:h-5 sm:w-5 animate-spin text-blue-500" />
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {fileInfo && !multipleFilesInfo && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg sm:text-xl">
                <FileText className="h-5 w-5" />
                file info
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3 sm:space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm sm:text-base font-medium">name:</span>
                  <span className="text-sm sm:text-base text-muted-foreground font-mono truncate max-w-[60%]">
                    {fileInfo.name}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm sm:text-base font-medium">size:</span>
                  <span className="text-sm sm:text-base text-muted-foreground">
                    {formatFileSize(fileInfo.size)}
                  </span>
                </div>
                {fileInfo.type && (
                  <div className="flex items-center justify-between">
                    <span className="text-sm sm:text-base font-medium">type:</span>
                    <span className="text-sm sm:text-base text-muted-foreground">
                      {fileInfo.type}
                    </span>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg sm:text-xl">
              <Download className="h-5 w-5" />
              connection
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4 sm:space-y-6">
              <div className="flex items-center justify-between">
                <span className="text-sm sm:text-base font-medium">status:</span>
                <span className={`text-xs sm:text-sm ${getStatusColor()}`}>
                  {getStatusText()}
                </span>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-sm sm:text-base font-medium">participants:</span>
                <span className="text-sm sm:text-base text-muted-foreground">
                  {participantCount}/2
                </span>
              </div>

              {transferProgress && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">
                      {multipleFilesInfo && fileTransferState
                        ? `file ${fileTransferState.currentFileIndex + 1}/${fileTransferState.totalFiles}:`
                        : 'progress:'}
                    </span>
                    <span className="text-sm text-muted-foreground">
                      {transferProgress.percentage.toFixed(1)}%
                    </span>
                  </div>
                  {multipleFilesInfo && transferProgress.currentFileName && (
                    <p className="text-xs text-muted-foreground truncate">
                      receiving: {transferProgress.currentFileName}
                    </p>
                  )}
                  <Progress value={transferProgress.percentage} className="w-full" />
                  <div className="text-xs text-muted-foreground text-center">
                    {formatFileSize(transferProgress.transferred)} / {formatFileSize(transferProgress.total)}
                  </div>
                  {multipleFilesInfo && fileTransferState && (
                    <div className="text-xs text-muted-foreground text-center">
                      {fileTransferState.completedFiles} of {fileTransferState.totalFiles} files done
                    </div>
                  )}
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {receivedFile && receivedFiles.length === 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-green-400">
                <CheckCircle className="h-5 w-5" />
                file received
              </CardTitle>
              <CardDescription>
                {receivedFile.name} - {formatFileSize(receivedFile.size)}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex gap-2">
                <Button onClick={() => downloadFile(receivedFile)} className="flex-1" size="lg">
                  <Download className="h-4 w-4 mr-2" />
                  download
                </Button>
                <Button variant="outline" onClick={() => navigate('/')}>
                  <Home className="h-4 w-4 mr-2" />
                  home
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {receivedFiles.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-green-400">
                <CheckCircle className="h-5 w-5" />
                {allFilesReceived ? 'all files received' : `${receivedFiles.length} files received`}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="space-y-2">
                  {receivedFiles.map((file, index) => (
                    <div key={index} className="flex items-center gap-3 p-3 bg-muted rounded-lg">
                      <FileText className="h-5 w-5 text-accent flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm truncate">{file.name}</p>
                        <p className="text-xs text-muted-foreground">{formatFileSize(file.size)}</p>
                      </div>
                      <Button variant="ghost" size="sm" onClick={() => downloadFile(file)}>
                        <Download className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
                <div className="flex gap-2">
                  <Button onClick={downloadAllFiles} className="flex-1" size="lg">
                    <Download className="h-4 w-4 mr-2" />
                    download all
                  </Button>
                  <Button variant="outline" onClick={() => navigate('/')}>
                    <Home className="h-4 w-4 mr-2" />
                    home
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {!fileInfo && !multipleFilesInfo && !error && (
          <Card>
            <CardContent className="pt-6">
              <div className="text-center space-y-4">
                <Loader2 className="h-8 w-8 animate-spin mx-auto text-muted-foreground" />
                <p className="text-muted-foreground">
                  waiting for sender...
                </p>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
