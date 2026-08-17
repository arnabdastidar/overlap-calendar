export type MergeableConnection = {
  provider: string;
  accountRef: string;
  encryptedRefreshToken: string | null;
  createdAt: number;
};

function connectionQuality(connection: MergeableConnection) {
  if (connection.provider === "google" || connection.provider === "microsoft") {
    if (connection.encryptedRefreshToken) return 3;
    if (!connection.accountRef.startsWith("demo:")) return 2;
    return 1;
  }
  return connection.accountRef.trim() ? 2 : 0;
}

export function preferSourceConnection(source: MergeableConnection, target: MergeableConnection) {
  const sourceQuality = connectionQuality(source);
  const targetQuality = connectionQuality(target);
  return sourceQuality > targetQuality || (sourceQuality === targetQuality && source.createdAt > target.createdAt);
}
