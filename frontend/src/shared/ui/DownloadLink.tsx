import { useState, type ReactNode } from 'react';
import { safeArtifactUrl } from '../api/transport';
import { interceptedDownload } from '../api/download';
import { ErrorState } from './common';

export function DownloadLink({
  path,
  name,
  contentType,
  children,
}: {
  path: string;
  name: string;
  contentType: string;
  children: ReactNode;
}) {
  const [error, setError] = useState<unknown>();
  let url: string;
  try {
    url = safeArtifactUrl(path);
  } catch (error) {
    return <ErrorState error={error} />;
  }
  return (
    <>
      <a
        className="button primary"
        href={url}
        download={name}
        onClick={(event) => {
          setError(undefined);
          const pending = interceptedDownload(path, name, contentType);
          if (pending) {
            event.preventDefault();
            void pending.catch(setError);
          }
        }}
      >
        {children}
      </a>
      {error && <ErrorState error={error} />}
    </>
  );
}
