const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

export interface CreateRoomResponse {
  roomId: string;
  shareUrl: string;
  maxReceivers: number;
}

export interface RoomInfo {
  roomId: string;
  participantCount: number;
  maxReceivers: number;
  hasFile: boolean;
  fileInfo?: {
    name: string;
    size: number;
    type: string;
  };
  multipleFilesInfo?: {
    files: Array<{
      id: string;
      name: string;
      size: number;
      type: string;
    }>;
    totalSize: number;
    hasPasscode: boolean;
  };
}

export class ApiService {
  static async createRoom(maxReceivers = 1): Promise<CreateRoomResponse> {
    const response = await fetch(`${API_BASE_URL}/create-room`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ maxReceivers }),
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || 'Failed to create room');
    }

    return response.json();
  }

  static async getRoomInfo(roomId: string): Promise<RoomInfo> {
    const response = await fetch(`${API_BASE_URL}/room/${encodeURIComponent(roomId)}`);

    if (!response.ok) {
      if (response.status === 404) {
        throw new Error('Room not found or expired');
      }
      if (response.status === 400) {
        throw new Error('Invalid room link');
      }
      throw new Error('Failed to get room info');
    }

    return response.json();
  }
}
