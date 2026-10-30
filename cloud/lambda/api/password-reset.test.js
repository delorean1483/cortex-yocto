'use strict';
// Run: node cloud/lambda/api/password-reset.test.js
const assert = require('node:assert');
const {
  parseForgotBody, parseResetBody, parseSetPasswordBody,
  forgotErrorReply, resetErrorReply, setPasswordErrorReply,
  FORGOT_SENT, PASSWORD_RULES,
} = require('./password-reset');

let failed = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  [PASS] ${name}`); }
  catch (e) { failed++; console.error(`  [FAIL] ${name}: ${e.message}`); }
};
const cognitoError = (name) => Object.assign(new Error(name), { name });

check('forgot: takes a trimmed email', () => {
  assert.deepStrictEqual(parseForgotBody('{"email":"  a@b.co "}'), { email: 'a@b.co' });
});

check('forgot: rejects a missing email or bad JSON', () => {
  for (const body of ['{}', '{"email":""}', '{"email":7}', 'not json', undefined, 'null']) {
    assert.strictEqual(typeof parseForgotBody(body).error, 'string', `body ${body}`);
  }
});

check('reset: takes email, code and password; trims the email and code only', () => {
  assert.deepStrictEqual(
    parseResetBody('{"email":" a@b.co","code":" 123456 ","password":" Pw-123456789 "}'),
    { email: 'a@b.co', code: '123456', password: ' Pw-123456789 ' });
});

check('reset: each field is required', () => {
  for (const body of [
    '{"code":"1","password":"p"}', '{"email":"a@b.co","password":"p"}',
    '{"email":"a@b.co","code":"1"}', '{"email":"a@b.co","code":"1","password":""}', 'not json',
  ]) {
    assert.strictEqual(typeof parseResetBody(body).error, 'string', `body ${body}`);
  }
});

check('admin set: takes the password and nothing else', () => {
  assert.deepStrictEqual(parseSetPasswordBody('{"password":"Pw-123456789","email":"x@y"}'),
    { password: 'Pw-123456789' });
  for (const body of ['{}', '{"password":""}', '{"password":5}', 'not json']) {
    assert.strictEqual(typeof parseSetPasswordBody(body).error, 'string', `body ${body}`);
  }
});

check('forgot: no account, disabled or unverified email all look like a sent code', () => {
  for (const name of ['UserNotFoundException', 'NotAuthorizedException', 'InvalidParameterException']) {
    assert.deepStrictEqual(forgotErrorReply(cognitoError(name)), { status: 200, body: FORGOT_SENT }, name);
  }
});

check('forgot: throttling is a 429', () => {
  for (const name of ['LimitExceededException', 'TooManyRequestsException']) {
    assert.strictEqual(forgotErrorReply(cognitoError(name)).status, 429, name);
  }
});

check('reset: wrong or expired code and a weak password are 400s with their own message', () => {
  const bad = resetErrorReply(cognitoError('CodeMismatchException'));
  const expired = resetErrorReply(cognitoError('ExpiredCodeException'));
  const weak = resetErrorReply(cognitoError('InvalidPasswordException'));
  for (const r of [bad, expired, weak]) assert.strictEqual(r.status, 400);
  assert.notStrictEqual(bad.body.error, expired.body.error);
  assert.strictEqual(weak.body.error, PASSWORD_RULES);
});

check('reset: an unknown email reads the same as a wrong code', () => {
  assert.deepStrictEqual(resetErrorReply(cognitoError('UserNotFoundException')),
    resetErrorReply(cognitoError('CodeMismatchException')));
});

check('reset: too many tries is a 429', () => {
  for (const name of ['LimitExceededException', 'TooManyFailedAttemptsException']) {
    assert.strictEqual(resetErrorReply(cognitoError(name)).status, 429, name);
  }
});

check('admin set: weak password is a 400, missing user a 404', () => {
  assert.deepStrictEqual(setPasswordErrorReply(cognitoError('InvalidPasswordException')),
    { status: 400, body: { error: PASSWORD_RULES } });
  assert.strictEqual(setPasswordErrorReply(cognitoError('UserNotFoundException')).status, 404);
});

check('anything unexpected is rethrown (null)', () => {
  for (const fn of [forgotErrorReply, resetErrorReply, setPasswordErrorReply]) {
    assert.strictEqual(fn(cognitoError('InternalErrorException')), null);
    assert.strictEqual(fn(new Error('socket hang up')), null);
  }
});

if (failed) { console.error(`password-reset.test.js: ${failed} failed`); process.exit(1); }
console.log('password-reset.test.js: all checks passed');
