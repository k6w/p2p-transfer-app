import { useState, useRef, useEffect } from 'react';
import { Upload, Share2, FileText, Loader2, X, Lock, Files } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { InputOTP, InputOTPGroup, InputOTPSeparator, InputOTPSlot } from '@/components/ui/input-otp';
import { Checkbox } from '@/components/ui/checkbox';
import { toast } from 'sonner';
import { ApiService } from '@/services/api';
import { WebRTCService } from '@/services/webrtc';
import type { FileInfo, TransferProgress, MultipleFileInfo } from '@/services/webrtc';
import { formatFileSize } from '@/lib/utils';

export function HomePage() {
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [shareUrl, setShareUrl] = useState<string>('');
  const [isCreatingRoom, setIsCreatingRoom] = useState(false);
  const [connectionState, setConnectionState] = useState<RTCPeerConnectionState>('new');
  const [transferProgress, setTransferProgress] = useState<TransferProgress | null>(null);
  const [participantCount, setParticipantCount] = useState(0);
  const [isTransferring, setIsTransferring] = useState(false);
  const [usePasscode, setUsePasscode] = useState(false);
  const [passcode, setPasscode] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const webrtcRef = useRef<WebRTCService | null>(null);
  const roomIdRef = useRef<string | null>(null);

  // Cleanup on component unmount
  useEffect(() => {
    return () => {
      if (webrtcRef.current) {
        webrtcRef.current.disconnect();
        webrtcRef.current = null;
      }
    };
  }, []);

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    if (files.length > 0) {
      setSelectedFiles(files);
    }
  };

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const files = Array.from(event.dataTransfer.files);
    if (files.length > 0) {
      setSelectedFiles(files);
    }
  };

  const removeFile = (index: number) => {
    setSelectedFiles(prev => prev.filter((_, i) => i !== index));
  };

  const getTotalSize = () => {
    return selectedFiles.reduce((total, file) => total + file.size, 0);
  };

  const handleDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
  };

  const createShareLink = async () => {
    if (selectedFiles.length === 0) return;
    if (usePasscode && passcode.length !== 6) {
      toast.error('Please enter a 6-digit passcode');
      return;
    }

    setIsCreatingRoom(true);
    try {
      const { roomId, shareUrl } = await ApiService.createRoom();
      setShareUrl(shareUrl);
      roomIdRef.current = roomId;

      // Initialize WebRTC as the sender
      const webrtc = new WebRTCService();
      webrtcRef.current = webrtc;

      // Set up event listeners
      webrtc.onConnectionStateChange = (state) => {
        setConnectionState(state);
        if (state === 'connected') {
          // Start file transfer when connected
          setIsTransferring(true);
          if (selectedFiles.length === 1) {
            webrtc.sendFile(selectedFiles[0]);
          } else {
            webrtc.sendMultipleFiles(selectedFiles);
          }
        }
      };

      webrtc.onUserJoined = (count) => {
        setParticipantCount(count);
      };

      webrtc.onUserLeft = (count) => {
        setParticipantCount(count);
      };

      webrtc.onTransferProgress = (progress) => {
        setTransferProgress(progress);
        if (progress.percentage >= 100) {
          setIsTransferring(false);
          toast.success('File transfer completed successfully!');
        }
      };

      webrtc.onError = (error) => {
        console.error('WebRTC error:', error);
        toast.error(`Error: ${error}`);
      };

      // Join room as initiator
      await webrtc.joinRoom(roomId, true);

      // Set file info for the room
      if (selectedFiles.length === 1) {
        const fileInfo: FileInfo = {
          name: selectedFiles[0].name,
          size: selectedFiles[0].size,
          type: selectedFiles[0].type,
        };
        webrtc.setFileInfo(fileInfo);
      } else {
        const multipleFileInfo: MultipleFileInfo = {
          files: selectedFiles.map((file, index) => ({
            id: `file-${index}`,
            name: file.name,
            size: file.size,
            type: file.type,
          })),
          totalSize: getTotalSize(),
          passcode: usePasscode ? passcode : undefined,
        };
        webrtc.setMultipleFilesInfo(multipleFileInfo);
      }

    } catch (error) {
      console.error('Error creating room:', error);
      toast.error('Failed to create share link. Please try again.');
    } finally {
      setIsCreatingRoom(false);
    }
  };

  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      toast.success('Share link copied to clipboard!');
    } catch (error) {
      console.error('Failed to copy to clipboard:', error);
      toast.error('Failed to copy link. Please copy it manually.');
    }
  };

  const resetForm = () => {
    setSelectedFiles([]);
    setShareUrl('');
    setConnectionState('new');
    setTransferProgress(null);
    setParticipantCount(0);
    setIsTransferring(false);
    setUsePasscode(false);
    setPasscode('');
    if (webrtcRef.current) {
      webrtcRef.current.disconnect();
      webrtcRef.current = null;
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const getConnectionStatusText = () => {
    switch (connectionState) {
      case 'connecting':
        return 'Connecting to recipient...';
      case 'connected':
        return 'Connected! Transfer will start automatically.';
      case 'disconnected':
        return 'Disconnected';
      case 'failed':
        return 'Connection failed';
      default:
        return 'Waiting for recipient...';
    }
  };

  const getConnectionStatusColor = () => {
    switch (connectionState) {
      case 'connected':
        return 'text-green-400';
      case 'connecting':
        return 'text-yellow-400';
      case 'failed':
        return 'text-red-400';
      default:
        return 'text-muted-foreground';
    }
  };

  return (
    <div className="container mx-auto px-4 py-4 sm:py-8 max-w-2xl">
      <div className="text-center mb-6 sm:mb-8">
        <h1 className="text-2xl sm:text-3xl lg:text-4xl font-bold mb-2">Peer-to-Peer File Transfer</h1>
        <p className="text-sm sm:text-base text-muted-foreground px-2">
          Share files directly between browsers with no size limits
        </p>
      </div>

      {!shareUrl ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              {selectedFiles.length > 1 ? <Files className="h-5 w-5" /> : <Upload className="h-5 w-5" />}
              {selectedFiles.length > 1 ? 'Upload Multiple Files' : 'Upload File'}
            </CardTitle>
            <CardDescription>
              Select one or more files to share with someone else
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div
              className="border-2 border-dashed border-border rounded-lg p-4 sm:p-6 lg:p-8 text-center hover:border-accent transition-colors cursor-pointer touch-manipulation"
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onClick={() => fileInputRef.current?.click()}
            >
              <input
                ref={fileInputRef}
                type="file"
                multiple
                onChange={handleFileSelect}
                className="hidden"
              />
              {selectedFiles.length > 0 ? (
                <div className="space-y-4">
                  {selectedFiles.length === 1 ? (
                    <div className="space-y-2">
                      <FileText className="h-8 w-8 sm:h-10 sm:w-10 lg:h-12 lg:w-12 mx-auto text-accent" />
                      <p className="font-medium text-sm sm:text-base break-all px-2">{selectedFiles[0].name}</p>
                      <p className="text-xs sm:text-sm text-muted-foreground">
                        {formatFileSize(selectedFiles[0].size)}
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <Files className="h-8 w-8 sm:h-10 sm:w-10 lg:h-12 lg:w-12 mx-auto text-accent" />
                      <p className="font-medium text-sm sm:text-base">{selectedFiles.length} files selected</p>
                      <p className="text-xs sm:text-sm text-muted-foreground">
                        Total size: {formatFileSize(getTotalSize())}
                      </p>
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-2">
                  <Upload className="h-8 w-8 sm:h-10 sm:w-10 lg:h-12 lg:w-12 mx-auto text-muted-foreground" />
                  <p className="text-base sm:text-lg font-medium px-2">Drop files here or tap to browse</p>
                  <p className="text-xs sm:text-sm text-muted-foreground px-2">
                    Any file type, any size, multiple files supported
                  </p>
                </div>
              )}
            </div>

            {/* Selected Files List */}
            {selectedFiles.length > 1 && (
              <div className="mt-4 space-y-2 max-h-48 overflow-y-auto">
                {selectedFiles.map((file, index) => (
                  <div key={index} className="flex items-center justify-between p-3 sm:p-4 bg-muted rounded-lg">
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <FileText className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium truncate">{file.name}</p>
                        <p className="text-xs text-muted-foreground">{formatFileSize(file.size)}</p>
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="ml-2 h-8 w-8 p-0 flex-shrink-0"
                      onClick={(e) => {
                        e.stopPropagation();
                        removeFile(index);
                      }}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            )}

            {/* Passcode Option */}
            {selectedFiles.length > 0 && (
              <div className="mt-6 space-y-4">
                <div className="flex items-center space-x-3 p-2">
                  <Checkbox
                    id="use-passcode"
                    checked={usePasscode}
                    onCheckedChange={setUsePasscode}
                    className="h-5 w-5"
                  />
                  <label htmlFor="use-passcode" className="text-sm sm:text-base font-medium flex items-center gap-2 cursor-pointer">
                    <Lock className="h-4 w-4" />
                    Protect with passcode
                  </label>
                </div>
                
                {usePasscode && (
                  <div className="space-y-3 px-2">
                    <label className="text-sm sm:text-base font-medium block text-center">Enter 6-digit passcode:</label>
                    <div className="flex justify-center">
                      <InputOTP maxLength={6} value={passcode} onChange={setPasscode}>
                        <InputOTPGroup>
                          <InputOTPSlot index={0} className="h-10 w-10 sm:h-12 sm:w-12" />
                          <InputOTPSlot index={1} className="h-10 w-10 sm:h-12 sm:w-12" />
                          <InputOTPSlot index={2} className="h-10 w-10 sm:h-12 sm:w-12" />
                        </InputOTPGroup>
                        <InputOTPSeparator />
                        <InputOTPGroup>
                          <InputOTPSlot index={3} className="h-10 w-10 sm:h-12 sm:w-12" />
                          <InputOTPSlot index={4} className="h-10 w-10 sm:h-12 sm:w-12" />
                          <InputOTPSlot index={5} className="h-10 w-10 sm:h-12 sm:w-12" />
                        </InputOTPGroup>
                      </InputOTP>
                    </div>
                  </div>
                )}

                <div className="space-y-3">
                  <Button
                    onClick={createShareLink}
                    disabled={isCreatingRoom || (usePasscode && passcode.length !== 6)}
                    className="w-full h-12 text-base"
                    size="lg"
                  >
                    {isCreatingRoom ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Creating Share Link...
                      </>
                    ) : (
                      <>
                        <Share2 className="h-4 w-4 mr-2" />
                        Create Share Link
                      </>
                    )}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={resetForm}
                    className="w-full h-12 text-base"
                  >
                    Choose Different Files
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Share2 className="h-5 w-5" />
                Share Link Created
              </CardTitle>
              <CardDescription>
                Send this link to the person you want to share the file with
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="p-3 sm:p-4 bg-muted rounded-lg break-all text-xs sm:text-sm font-mono">
                  {shareUrl}
                </div>
                <div className="flex flex-col sm:flex-row gap-3 sm:gap-2">
                  <Button onClick={copyToClipboard} className="flex-1 h-12 text-base">
                    Copy Link
                  </Button>
                  <Button variant="outline" onClick={resetForm} className="h-12 text-base">
                    New File
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Transfer Status</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Connection:</span>
                  <span className={`text-sm ${getConnectionStatusColor()}`}>
                    {getConnectionStatusText()}
                  </span>
                </div>
                
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Participants:</span>
                  <span className="text-sm text-muted-foreground">
                    {participantCount}/2
                  </span>
                </div>

                {selectedFiles.length > 0 && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">Files:</span>
                      <span className="text-sm text-muted-foreground">
                        {selectedFiles.length} file{selectedFiles.length > 1 ? 's' : ''} ({formatFileSize(getTotalSize())})
                      </span>
                    </div>
                  </div>
                )}

                {transferProgress && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">Progress:</span>
                      <span className="text-sm text-muted-foreground">
                        {transferProgress.percentage.toFixed(1)}%
                      </span>
                    </div>
                    <Progress value={transferProgress.percentage} className="w-full" />
                    <div className="text-xs text-muted-foreground text-center">
                      {formatFileSize(transferProgress.transferred)} / {formatFileSize(transferProgress.total)}
                    </div>
                  </div>
                )}


              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}