const COMMON_PASSWORDS = new Set([
  "password",
  "password123",
  "123456789",
  "qwerty123",
  "letmein",
  "welcome123",
  "admin123",
  "changeme",
]);

export interface PasswordPolicyResult {
  valid: boolean;
  errors: string[];
}

export function validatePassword(
  password: string,
  identityHint?: string,
): PasswordPolicyResult {
  const minimum = Number(process.env.ZOLT_PASSWORD_MIN_LENGTH ?? 12);
  const maximum = Number(process.env.ZOLT_PASSWORD_MAX_LENGTH ?? 128);
  const errors: string[] = [];
  if (password.length < minimum)
    errors.push(`Password must contain at least ${minimum} characters`);
  if (password.length > maximum)
    errors.push(`Password must contain at most ${maximum} characters`);
  if (!/[a-z]/.test(password))
    errors.push("Password must contain a lowercase letter");
  if (!/[A-Z]/.test(password))
    errors.push("Password must contain an uppercase letter");
  if (!/\d/.test(password)) errors.push("Password must contain a number");
  if (!/[^A-Za-z0-9]/.test(password))
    errors.push("Password must contain a symbol");
  const normalized = password.toLowerCase();
  if (
    COMMON_PASSWORDS.has(normalized) ||
    /(.)\1{4,}/.test(password) ||
    /123456|abcdef|qwerty/i.test(password)
  ) {
    errors.push("Password is known to be weak or compromised");
  }
  const identity = identityHint?.split("@")[0]?.toLowerCase();
  if (identity && identity.length >= 4 && normalized.includes(identity)) {
    errors.push("Password must not contain the account identifier");
  }
  return { valid: errors.length === 0, errors };
}

export function assertPasswordPolicy(
  password: string,
  identityHint?: string,
): void {
  const result = validatePassword(password, identityHint);
  if (!result.valid) {
    throw new Error(`PASSWORD_POLICY:${result.errors.join(";")}`);
  }
}
