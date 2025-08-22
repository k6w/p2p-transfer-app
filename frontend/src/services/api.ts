const API_BASE_URL = 'http://localhost:3001';

export interface CreateRoomResponse {
  roomId: string;
  shareUrl: string;
}

export interface RoomInfo {
  roomId: string;
  participantCount: number;
  hasFile: boolean;
  fileInfo?: {
    name: string;
    size: number;
    type: string;
  };
}

export class ApiService {
  static async createRoom(): Promise<CreateRoomResponse> {
    const response = await fetch(`${API_BASE_URL}/create-room`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error('Failed to create room');
    }

    return response.json();
  }

  static async getRoomInfo(roomId: string): Promise<RoomInfo> {
    const response = await fetch(`${API_BASE_URL}/room/${roomId}`);

    if (!response.ok) {
      if (response.status === 404) {
        throw new Error('Room not found');
      }
      throw new Error('Failed to get room info');
    }

    return response.json();
  }

  static async checkHealth(): Promise<{ status: string; timestamp: string }> {
    const response = await fetch(`${API_BASE_URL}/health`);

    if (!response.ok) {
      throw new Error('Health check failed');
    }

    return response.json();
  }
}