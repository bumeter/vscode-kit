import * as path from 'node:path';

/** A workspace is a project the way Bumeter names them: the folder's own name (the last part of the session's cwd). */
export function projectOf(folders: readonly { uri: { fsPath: string } }[] | undefined): string | null {
  const first = folders?.[0];
  return first ? path.basename(first.uri.fsPath) || null : null;
}
