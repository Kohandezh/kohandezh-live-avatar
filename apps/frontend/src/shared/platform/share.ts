export interface ShareService {
  share(title: string, text?: string, url?: string): Promise<void>;
}
