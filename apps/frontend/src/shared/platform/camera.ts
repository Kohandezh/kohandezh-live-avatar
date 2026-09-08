export interface CameraService {
  scan(): Promise<string | null>;
}
