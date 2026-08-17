export const consumeVerificationSql = `DELETE FROM email_verifications
  WHERE challenge_hash = ? AND code_hash = ? AND expires_at >= ? AND attempts < 5
  RETURNING email_key`;

export const incrementVerificationAttemptSql = `UPDATE email_verifications
  SET attempts = attempts + 1
  WHERE challenge_hash = ? AND expires_at >= ? AND attempts < 5
  RETURNING attempts`;

export const incrementVerificationRateSql = `INSERT INTO verification_rate_limits
  (scope_key, window_start, request_count) VALUES (?, ?, 1)
  ON CONFLICT(scope_key, window_start) DO UPDATE SET request_count = request_count + 1
  RETURNING request_count`;
