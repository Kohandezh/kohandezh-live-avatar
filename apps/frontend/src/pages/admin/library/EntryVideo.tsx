import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Spinner } from '@heroui/react';
import { fetchLibraryEntryVideo } from '@/entities/library-entry';
import { InlineAlert } from '@/shared/ui';

interface VideoResult {
  /** Which download this result belongs to, so a new video or a retry starts as loading. */
  attemptKey: string;
  url: string | null;
}

/**
 * The video of an entry under review (REQ-032). The whole MP4 is downloaded as a blob through the
 * shared client and shown from an object URL, which is revoked when the panel closes. The blob is
 * not put in the query cache.
 */
export function EntryVideo({
  videoAssetId,
  entryKey,
}: {
  videoAssetId: string;
  entryKey: string;
}) {
  const { t } = useTranslation('admin');
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<VideoResult | null>(null);
  const attemptKey = `${videoAssetId}#${attempt}`;
  const current = result?.attemptKey === attemptKey ? result : null;

  useEffect(() => {
    const controller = new AbortController();
    let url: string | null = null;

    fetchLibraryEntryVideo(videoAssetId, controller.signal).then(
      (blob) => {
        url = URL.createObjectURL(blob);
        setResult({ attemptKey, url });
      },
      () => {
        if (!controller.signal.aborted) setResult({ attemptKey, url: null });
      },
    );

    return () => {
      controller.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [videoAssetId, attemptKey]);

  if (!current) {
    return (
      <div
        role="status"
        className="flex aspect-video w-full flex-col items-center justify-center gap-2 rounded-lg bg-default text-sm text-muted"
      >
        <Spinner />
        {t('library.panel.videoLoading')}
      </div>
    );
  }

  if (!current.url) {
    return (
      <InlineAlert
        status="danger"
        title={t('library.panel.videoError')}
        onRetry={() => setAttempt((value) => value + 1)}
      />
    );
  }

  return (
    <video
      src={current.url}
      controls
      playsInline
      preload="metadata"
      aria-label={t('library.panel.videoLabel', { key: entryKey })}
      className="aspect-video w-full rounded-lg bg-default"
    />
  );
}
