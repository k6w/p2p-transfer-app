import { useState, useRef, useEffect } from 'react';
import { Upload, Share2, FileText, Loader2, X, Lock, Files, Copy, Check, RotateCcw, Users, Minus, Plus } from 'lucide-react';
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
  const [transferComplete, setTransferComplete] = useState(false);
  const [usePasscode, setUsePasscode] = useState(false);
  const [passcode, setPasscode] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [copied, setCopied] = useState(false);
  const [waitingForPasscode, setWaitingForPasscode] = useState(false);
  const [maxReceivers, setMaxReceivers] = useState(1);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const webrtcRef = useRef<WebRTCService | null>(null);
  const roomIdRef = useRef<string | null>(null);

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
      setSelectedFiles(prev => {
        const existing = new Set(prev.map(f => `${f.name}-${f.size}`));
        const newFiles = files.filter(f => !existing.has(`${f.name}-${f.size}`));
        return [...prev, ...newFiles];
      });
    }
  };

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);
    const files = Array.from(event.dataTransfer.files);
    if (files.length > 0) {
      setSelectedFiles(prev => {
        const existing = new Set(prev.map(f => `${f.name}-${f.size}`));
        const newFiles = files.filter(f => !existing.has(`${f.name}-${f.size}`));
        return [...prev, ...newFiles];
      });
    }
  };

  const removeFile = (index: number) => {
    setSelectedFiles(prev => prev.filter((_, i) => i !== index));
  };

  const getTotalSize = () => {
    return selectedFiles.reduce((total, file) => total + file.size, 0);
  };

  const createShareLink = async () => {
    if (selectedFiles.length === 0) return;
    if (usePasscode && passcode.length !== 6) {
      toast.error('please enter a 6-digit passcode');
      return;
    }

    setIsCreatingRoom(true);
    try {
      const { roomId, shareUrl } = await ApiService.createRoom(maxReceivers);
      setShareUrl(shareUrl);
      roomIdRef.current = roomId;

      const webrtc = new WebRTCService();
      webrtcRef.current = webrtc;

      const hasPasscode = usePasscode && passcode.length === 6;

      if (hasPasscode) {
        webrtc.setSenderPasscode(passcode, selectedFiles);
      }

      webrtc.onConnectionStateChange = (state) => {
        setConnectionState(state);
        if (state === 'connected') {
          if (hasPasscode) {
            setWaitingForPasscode(true);
          } else {
            setIsTransferring(true);
            if (selectedFiles.length === 1) {
              webrtc.sendFile(selectedFiles[0]);
            } else {
              webrtc.sendMultipleFiles(selectedFiles);
            }
          }
        }
      };

      webrtc.onPasscodeAccepted = () => {
        setWaitingForPasscode(false);
        setIsTransferring(true);
      };

      webrtc.onUserJoined = (count) => setParticipantCount(count);
      webrtc.onUserLeft = (count) => setParticipantCount(count);

      webrtc.onTransferProgress = (progress) => {
        setTransferProgress(progress);
        if (progress.percentage >= 100 && selectedFiles.length === 1) {
          setIsTransferring(false);
          setTransferComplete(true);
          toast.success('transfer complete');
        }
      };

      webrtc.onFileTransferStateChanged = (state) => {
        if (state.completedFiles === state.totalFiles) {
          setIsTransferring(false);
          setTransferComplete(true);
          toast.success(`all ${state.totalFiles} files transferred`);
        }
      };

      webrtc.onError = (error) => {
        toast.error(error);
      };

      await webrtc.joinRoom(roomId, true);

      const multipleFileInfo: MultipleFileInfo = {
        files: selectedFiles.map((file, index) => ({
          id: `file-${index}`,
          name: file.name,
          size: file.size,
          type: file.type,
        })),
        totalSize: getTotalSize(),
        passcode: hasPasscode ? passcode : undefined,
      };
      webrtc.setMultipleFilesInfo(multipleFileInfo);
    } catch (error) {
      toast.error('failed to create share link. is the server running?');
    } finally {
      setIsCreatingRoom(false);
    }
  };

  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      toast.success('link copied');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('failed to copy. select and copy manually.');
    }
  };

  const cancelTransfer = () => {
    if (webrtcRef.current) {
      webrtcRef.current.cancelTransfer();
    }
    setIsTransferring(false);
    toast('transfer cancelled');
  };

  const resetForm = () => {
    setSelectedFiles([]);
    setShareUrl('');
    setConnectionState('new');
    setTransferProgress(null);
    setParticipantCount(0);
    setIsTransferring(false);
    setTransferComplete(false);
    setUsePasscode(false);
    setPasscode('');
    setCopied(false);
    setWaitingForPasscode(false);
    setMaxReceivers(1);
    if (webrtcRef.current) {
      webrtcRef.current.disconnect();
      webrtcRef.current = null;
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const getStatusText = () => {
    if (transferComplete) return 'transfer complete';
    if (waitingForPasscode) return 'waiting for recipient passcode...';
    if (isTransferring) return 'transferring...';
    switch (connectionState) {
      case 'connecting': return 'connecting to recipient...';
      case 'connected': return 'connected - transferring';
      case 'disconnected': return 'disconnected';
      case 'failed': return 'connection failed';
      default: return 'waiting for recipient...';
    }
  };

  const getStatusColor = () => {
    if (transferComplete) return 'text-green-400';
    if (waitingForPasscode) return 'text-yellow-400';
    if (isTransferring) return 'text-blue-400';
    switch (connectionState) {
      case 'connected': return 'text-green-400';
      case 'connecting': return 'text-yellow-400';
      case 'failed': return 'text-red-400';
      default: return 'text-muted-foreground';
    }
  };

  return (
    <div className="container mx-auto px-4 py-4 sm:py-8 max-w-2xl">
      <div className="text-center mb-6 sm:mb-8">
        <h1 className="text-2xl sm:text-3xl lg:text-4xl font-bold mb-2">p2p file transfer</h1>
        <p className="text-sm sm:text-base text-muted-foreground px-2">
          share files directly between browsers - no server storage, no size limits
        </p>
      </div>

      {!shareUrl ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              {selectedFiles.length > 1 ? <Files className="h-5 w-5" /> : <Upload className="h-5 w-5" />}
              {selectedFiles.length > 0
                ? `${selectedFiles.length} file${selectedFiles.length > 1 ? 's' : ''} selected`
                : 'select files'}
            </CardTitle>
            <CardDescription>
              drag and drop or click to browse
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div
              className={`border-2 border-dashed rounded-lg p-4 sm:p-6 lg:p-8 text-center transition-colors cursor-pointer touch-manipulation ${
                isDragging
                  ? 'border-primary bg-primary/5'
                  : 'border-border hover:border-accent'
              }`}
              onDrop={handleDrop}
              onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
              onDragEnter={() => setIsDragging(true)}
              onDragLeave={() => setIsDragging(false)}
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
                <div className="space-y-2">
                  <FileText className="h-8 w-8 sm:h-10 sm:w-10 mx-auto text-accent" />
                  <p className="font-medium text-sm sm:text-base">
                    {selectedFiles.length} file{selectedFiles.length > 1 ? 's' : ''} - {formatFileSize(getTotalSize())}
                  </p>
                  <p className="text-xs text-muted-foreground">drop more files or click to add</p>
                </div>
              ) : (
                <div className="space-y-2">
                  <Upload className="h-8 w-8 sm:h-10 sm:w-10 lg:h-12 lg:w-12 mx-auto text-muted-foreground" />
                  <p className="text-base sm:text-lg font-medium px-2">
                    {isDragging ? 'drop files here' : 'drop files here or tap to browse'}
                  </p>
                  <p className="text-xs sm:text-sm text-muted-foreground px-2">
                    any file type, any size, multiple files
                  </p>
                </div>
              )}
            </div>

            {selectedFiles.length > 0 && (
              <div className="mt-4 space-y-2 max-h-48 overflow-y-auto">
                {selectedFiles.map((file, index) => (
                  <div key={`${file.name}-${file.size}`} className="flex items-center justify-between p-3 sm:p-4 bg-muted rounded-lg">
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

            {selectedFiles.length > 0 && (
              <div className="mt-6 space-y-4">
                <div className="flex items-center space-x-3 p-2">
                  <Checkbox
                    id="use-passcode"
                    checked={usePasscode}
                    onCheckedChange={(checked) => setUsePasscode(checked === true)}
                    className="h-5 w-5"
                  />
                  <label htmlFor="use-passcode" className="text-sm sm:text-base font-medium flex items-center gap-2 cursor-pointer">
                    <Lock className="h-4 w-4" />
                    protect with passcode
                  </label>
                </div>

                {usePasscode && (
                  <div className="space-y-3 px-2">
                    <label className="text-sm sm:text-base font-medium block text-center">enter 6-digit passcode:</label>
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

                <div className="flex items-center justify-between p-2">
                  <label className="text-sm sm:text-base font-medium flex items-center gap-2">
                    <Users className="h-4 w-4" />
                    max receivers
                  </label>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 w-8 p-0"
                      onClick={(e) => { e.stopPropagation(); setMaxReceivers(prev => Math.max(1, prev - 1)); }}
                      disabled={maxReceivers <= 1}
                    >
                      <Minus className="h-3 w-3" />
                    </Button>
                    <span className="text-sm font-mono w-6 text-center">{maxReceivers}</span>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 w-8 p-0"
                      onClick={(e) => { e.stopPropagation(); setMaxReceivers(prev => Math.min(50, prev + 1)); }}
                      disabled={maxReceivers >= 50}
                    >
                      <Plus className="h-3 w-3" />
                    </Button>
                  </div>
                </div>

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
                        creating link...
                      </>
                    ) : (
                      <>
                        <Share2 className="h-4 w-4 mr-2" />
                        create share link
                      </>
                    )}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => { setSelectedFiles([]); if (fileInputRef.current) fileInputRef.current.value = ''; }}
                    className="w-full h-12 text-base"
                  >
                    clear files
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
                share link
              </CardTitle>
              <CardDescription>
                send this to the recipient
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div
                  className="p-3 sm:p-4 bg-muted rounded-lg break-all text-xs sm:text-sm font-mono cursor-pointer select-all"
                  onClick={copyToClipboard}
                >
                  {shareUrl}
                </div>
                <div className="flex flex-col sm:flex-row gap-3 sm:gap-2">
                  <Button onClick={copyToClipboard} className="flex-1 h-12 text-base">
                    {copied ? <Check className="h-4 w-4 mr-2" /> : <Copy className="h-4 w-4 mr-2" />}
                    {copied ? 'copied' : 'copy link'}
                  </Button>
                  <Button variant="outline" onClick={resetForm} className="h-12 text-base">
                    <RotateCcw className="h-4 w-4 mr-2" />
                    start over
                  </Button>
                </div>

                {usePasscode && (
                  <p className="text-xs text-muted-foreground text-center">
                    passcode protected - share the code separately: <span className="font-mono font-bold">{passcode}</span>
                  </p>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>transfer status</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">status:</span>
                  <span className={`text-sm ${getStatusColor()}`}>
                    {getStatusText()}
                  </span>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">participants:</span>
                  <span className="text-sm text-muted-foreground">
                    {participantCount}/{1 + maxReceivers}
                  </span>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">files:</span>
                  <span className="text-sm text-muted-foreground">
                    {selectedFiles.length} file{selectedFiles.length > 1 ? 's' : ''} ({formatFileSize(getTotalSize())})
                  </span>
                </div>

                {transferProgress && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">progress:</span>
                      <span className="text-sm text-muted-foreground">
                        {transferProgress.percentage.toFixed(1)}%
                      </span>
                    </div>
                    {transferProgress.currentFileName && selectedFiles.length > 1 && (
                      <p className="text-xs text-muted-foreground truncate">
                        sending: {transferProgress.currentFileName}
                      </p>
                    )}
                    <Progress value={transferProgress.percentage} className="w-full" />
                    <div className="text-xs text-muted-foreground text-center">
                      {formatFileSize(transferProgress.transferred)} / {formatFileSize(transferProgress.total)}
                    </div>
                  </div>
                )}

                {isTransferring && (
                  <Button variant="destructive" onClick={cancelTransfer} className="w-full">
                    cancel transfer
                  </Button>
                )}

                {transferComplete && (
                  <Button variant="outline" onClick={resetForm} className="w-full">
                    <RotateCcw className="h-4 w-4 mr-2" />
                    send more files
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
