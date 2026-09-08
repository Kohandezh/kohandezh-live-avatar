export interface NotificationService {
  requestPermission(): Promise<boolean>;
}
