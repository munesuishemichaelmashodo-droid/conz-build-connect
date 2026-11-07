// Retry for the "photo uploaded but not recorded" step.
//
// A delivery photo is uploaded to storage first, then recorded with the record_job_evidence database
// function. On a weak connection the upload can succeed and the record call fail, which used to make
// the driver take and upload the photo again. The record call is cheap and safe to repeat: the
// evidence table has a unique key on storage_path, so repeating a call that had in fact worked is
// refused as a duplicate rather than creating a second row. In that case the saved row is returned.

export type RecordError = { message?: string; code?: string };
export type RecordResult<T> = { data: T | null; error: RecordError | null };

export function isTransientNetworkError(message: string | undefined): boolean {
  return (
    !!message &&
    /failed to fetch|fetch failed|networkerror|network error|load failed|timed? ?out|\b50[234]\b|econn|offline/i.test(
      message,
    )
  );
}

export function isDuplicateEvidenceError(error: RecordError): boolean {
  return (
    error.code === "23505" ||
    /duplicate key|job_evidence_storage_path_key/i.test(error.message ?? "")
  );
}

type Options = { attempts?: number; delayMs?: number; sleep?: (ms: number) => Promise<void> };

/**
 * Runs the record call, retrying only network failures (waiting a little longer each time).
 * `findSaved` looks up the row for this photo so a "duplicate" answer can be treated as success.
 */
export async function recordWithRetry<T>(
  call: () => PromiseLike<RecordResult<T>>,
  findSaved: () => Promise<T | null>,
  {
    attempts = 3,
    delayMs = 600,
    sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  }: Options = {},
): Promise<T> {
  let lastMessage = "unknown error";
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const { data, error } = await call();
    if (!error && data) return data;

    lastMessage = error?.message ?? lastMessage;
    if (error && isDuplicateEvidenceError(error)) {
      const saved = await findSaved();
      if (saved) return saved;
      throw new Error(lastMessage);
    }
    if (!error || !isTransientNetworkError(error.message) || attempt === attempts) break;
    await sleep(delayMs * attempt);
  }
  throw new Error(lastMessage);
}
