'use strict';

// Password resets: the public "forgot password" pair (Cognito emails a code,
// then the code + a new password) and an admin setting someone's password.
// Each *ErrorReply maps a Cognito error to { status, body }, or null when the
// handler should rethrow it.

// Mirrors the pool's password policy in cloud/terraform/cognito.tf.
const PASSWORD_RULES =
  'Use at least 12 characters, with an uppercase letter, a lowercase letter, a number and a symbol.';
const FORGOT_SENT  = { message: 'If that email has an account, a reset code is on its way.' };
const TOO_MANY     = 'Too many attempts. Wait a few minutes and try again.';
const BAD_CODE     = 'That code is not right. Check the email, or ask for a new code.';
const EXPIRED_CODE = 'That code has expired. Ask for a new one.';

const THROTTLED = ['LimitExceededException', 'TooManyRequestsException', 'TooManyFailedAttemptsException'];

const reply = (status, error) => ({ status, body: { error } });
const trimmed = (v) => (typeof v === 'string' ? v.trim() : '');

function parseJson(rawBody) {
  try {
    const body = JSON.parse(rawBody);
    return body && typeof body === 'object' ? body : null;
  } catch { return null; }
}

// POST /auth/forgot-password { email }
function parseForgotBody(rawBody) {
  const body = parseJson(rawBody);
  if (!body) return { error: 'Invalid JSON' };
  const email = trimmed(body.email);
  if (!email) return { error: 'email required' };
  return { email };
}

// POST /auth/reset-password { email, code, password }. The password is passed
// through untouched so Cognito judges exactly what was typed.
function parseResetBody(rawBody) {
  const body = parseJson(rawBody);
  if (!body) return { error: 'Invalid JSON' };
  const email = trimmed(body.email);
  const code  = trimmed(body.code);
  const password = typeof body.password === 'string' ? body.password : '';
  if (!email)    return { error: 'email required' };
  if (!code)     return { error: 'code required' };
  if (!password) return { error: 'password required' };
  return { email, code, password };
}

// POST /fleet/users/{email}/password { password }. Whose password comes from
// the path, never the body.
function parseSetPasswordBody(rawBody) {
  const body = parseJson(rawBody);
  if (!body) return { error: 'Invalid JSON' };
  if (typeof body.password !== 'string' || !body.password) return { error: 'password required' };
  return { password: body.password };
}

// No account, a disabled one, or no verified email all answer as if a code
// went out, so the endpoint can't be used to find out who has an account.
function forgotErrorReply(e) {
  if (THROTTLED.includes(e.name)) return reply(429, TOO_MANY);
  if (['UserNotFoundException', 'NotAuthorizedException', 'InvalidParameterException'].includes(e.name))
    return { status: 200, body: FORGOT_SENT };
  return null;
}

function resetErrorReply(e) {
  if (THROTTLED.includes(e.name)) return reply(429, TOO_MANY);
  switch (e.name) {
    case 'CodeMismatchException':
    case 'UserNotFoundException':
    case 'NotAuthorizedException':    return reply(400, BAD_CODE);
    case 'ExpiredCodeException':      return reply(400, EXPIRED_CODE);
    // InvalidParameterException: Cognito's pattern check, e.g. a leading space
    case 'InvalidPasswordException':
    case 'InvalidParameterException': return reply(400, PASSWORD_RULES);
    default:                          return null;
  }
}

function setPasswordErrorReply(e) {
  if (THROTTLED.includes(e.name)) return reply(429, TOO_MANY);
  switch (e.name) {
    case 'InvalidPasswordException':
    case 'InvalidParameterException': return reply(400, PASSWORD_RULES);
    case 'UserNotFoundException':     return reply(404, 'User not found');
    default:                          return null;
  }
}

module.exports = {
  parseForgotBody, parseResetBody, parseSetPasswordBody,
  forgotErrorReply, resetErrorReply, setPasswordErrorReply,
  FORGOT_SENT, PASSWORD_RULES,
};
